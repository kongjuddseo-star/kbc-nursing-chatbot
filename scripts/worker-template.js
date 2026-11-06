// ⚠ 자동 생성 파일입니다. 내용 수정은 knowledge.js 에서 하고 `npm run build:worker` 를 실행하세요.
// Cloudflare Worker — 간호학과 입시상담 챗봇의 API 키 보관 서버
// 필요한 설정 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets)
//   ANTHROPIC_API_KEY (Secret)  : Claude API 키
//   ALLOWED_ORIGIN    (Text)    : 챗봇 화면 주소, 예) https://kongjuddseo-star.github.io
//   CLAUDE_MODEL      (Text, 선택): 기본 claude-sonnet-5-5

const KNOWLEDGE = __KNOWLEDGE__;
__BUILD_PROMPT__

const MAX_MSG_CHARS = 600, MAX_HISTORY = 12, RATE_LIMIT = 20, RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // 같은 Worker 인스턴스 안에서만 유지되는 간단한 제한

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_LIMIT;
}
function todayKST() {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}
function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? MAX_MSG_CHARS : 4000).trim() }))
    .filter(m => m.content).slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  const merged = [];
  for (const m of msgs) { const l = merged[merged.length - 1]; if (l && l.role === m.role) l.content += '\n' + m.content; else merged.push({ ...m }); }
  return merged;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? (origin || '*') : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return json(200, { ok: true, keySet: !!env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || 'claude-sonnet-5-5' });
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    if (!okOrigin) return json(403, { error: '허용되지 않은 접속입니다.' });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json(429, { error: '질문이 너무 많아요. 잠시 후 다시 시도해 주세요. 급한 문의는 054-630-5133으로 연락 주세요.' });

    let body; try { body = await request.json(); } catch { return json(400, { error: '요청 형식이 올바르지 않아요.' }); }
    const messages = cleanMessages(body && body.messages);
    if (!messages) return json(400, { error: '질문을 입력해 주세요.' });
    if (!env.ANTHROPIC_API_KEY) return json(500, { error: '서버에 API 키가 설정되지 않았어요. 관리자에게 알려 주세요.' });

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 1024, stream: true,
        system: [{ type: 'text', text: buildSystemPrompt(todayKST()), cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!apiRes.ok || !apiRes.body) {
      console.log('Claude API error', apiRes.status, (await apiRes.text().catch(() => '')).slice(0, 500));
      return json(502, { error: '죄송해요, 지금 답변을 불러오지 못했어요. 잠시 후 다시 시도하시거나 054-630-5133으로 문의해 주세요.' });
    }

    // Claude의 스트리밍(SSE)을 글자만 뽑아 그대로 흘려보냄
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter(), enc = new TextEncoder(), dec = new TextDecoder();
    ctx.waitUntil((async () => {
      let buf = '';
      try {
        for await (const chunk of apiRes.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') await writer.write(enc.encode(ev.delta.text));
              else if (ev.type === 'error') await writer.write(enc.encode('\n\n(답변 중 오류가 생겼어요. 다시 시도해 주세요.)'));
            } catch {}
          }
        }
      } catch (e) { console.log('stream error', e); }
      finally { await writer.close().catch(() => {}); }
    })());
    return new Response(readable, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } });
  },
};
