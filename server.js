// 경북전문대학교 간호학과 입시상담 챗봇 서버 (외부 패키지 없이 Node 18+ 에서 실행)
// - public/ 폴더의 화면을 제공하고
// - /api/chat 요청을 Claude API로 대신 보내 API 키가 브라우저에 노출되지 않게 합니다.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSystemPrompt } = require('./knowledge');

// .env 파일이 있으면 읽기 (로컬 테스트용)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) {}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MOCK = process.env.MOCK === '1';
const MAX_MSG_CHARS = 600;     // 한 번에 보낼 수 있는 질문 길이
const MAX_HISTORY = 12;        // 기억하는 최근 대화 수
const RATE_LIMIT = 20;         // IP당 10분에 최대 질문 수
const RATE_WINDOW_MS = 10 * 60 * 1000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// ---- 간단한 사용량 제한 (API 비용 보호) ----
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (!list.some(t => now - t < RATE_WINDOW_MS)) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

function todayKST() {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date());
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? MAX_MSG_CHARS : 4000).trim() }))
    .filter(m => m.content)
    .slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  // 같은 역할이 연속되면 합치기 (API 규칙)
  const merged = [];
  for (const m of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else merged.push({ ...m });
  }
  return merged;
}

async function handleChat(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) {
    return sendJSON(res, 429, { error: '질문이 너무 많아요. 잠시 후 다시 시도해 주세요. 급한 문의는 054-630-5133으로 연락 주세요.' });
  }
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: '요청 형식이 올바르지 않아요.' }); }
  const messages = cleanMessages(body.messages);
  if (!messages) return sendJSON(res, 400, { error: '질문을 입력해 주세요.' });

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });

  if (MOCK) return mockStream(res, messages[messages.length - 1].content);

  if (!API_KEY) {
    res.end('⚠️ 서버에 Claude API 키가 설정되지 않았어요. 관리자에게 알려 주세요.');
    return;
  }

  const controller = new AbortController();
  req.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        stream: true,
        // 시스템 프롬프트(지식베이스)를 캐시해서 비용과 응답 시간을 줄임
        system: [{ type: 'text', text: buildSystemPrompt(todayKST()), cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });

    if (!apiRes.ok || !apiRes.body) {
      const errText = await apiRes.text().catch(() => '');
      console.error('[Claude API error]', apiRes.status, errText.slice(0, 500));
      res.end('죄송해요, 지금 답변을 불러오지 못했어요. 잠시 후 다시 시도하시거나 054-630-5133으로 문의해 주세요.');
      return;
    }

    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of apiRes.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
            res.write(ev.delta.text);
          } else if (ev.type === 'error') {
            console.error('[Claude stream error]', ev.error);
            res.write('\n\n(답변 중 오류가 생겼어요. 다시 시도해 주세요.)');
          }
        } catch (_) {}
      }
    }
    res.end();
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[chat error]', err);
    if (!res.writableEnded) res.end('죄송해요, 연결에 문제가 생겼어요. 다시 시도해 주세요.');
  }
}

// 테스트용 모의 답변 (MOCK=1)
async function mockStream(res, q) {
  const text = `**수시 2차** 원서접수는 **2026년 11월 11일(수)부터 11월 25일(수)**까지예요.\n\n- 면접: 12월 4일(금)\n- 합격발표: 12월 9일(수)\n- 간호학과 수시 2차 모집인원: **20명**(일반전형)\n\n원서는 입학홈페이지 http://ipsi.kbc.ac.kr 에서 접수할 수 있고, 전형료는 없어요. 면접 준비 방법도 알려드릴까요?\n\n(질문: ${q.slice(0, 40)})`;
  for (const ch of text.match(/[\s\S]{1,4}/g)) {
    res.write(ch);
    await new Promise(r => setTimeout(r, 15));
  }
  res.end();
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.url === '/api/chat' && req.method === 'POST') return handleChat(req, res);
  if (req.url === '/health') return sendJSON(res, 200, { ok: true, model: MODEL, mock: MOCK, keySet: !!API_KEY });
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  console.log(`간호학과 입시상담 챗봇 실행 중 → http://localhost:${PORT}  (model: ${MODEL}${MOCK ? ', MOCK 모드' : ''}${API_KEY ? '' : ', ⚠ API 키 없음'})`);
});
