# 경북전문대학교 간호학과 입시상담 챗봇

지원자·학부모가 휴대폰으로 접속해 간호학과 입시 질문을 하면 Claude가 학과 자료를 바탕으로 답합니다.

## 구성
| 파일 | 역할 |
|---|---|
| `public/index.html` | 모바일 채팅 화면 (홈페이지·유튜브·인스타그램·전화 버튼, D-day 배너, 빠른 질문) |
| `worker/worker.js` | Cloudflare Worker용 — API 키를 숨긴 채 Claude 호출 (자동 생성) |
| `public/config.js` | Worker 주소 설정 |
| `server.js` | (선택) Node 서버 하나로 화면+API 운영 |
| `knowledge.js` | **챗봇이 아는 내용(지식베이스)과 답변 규칙** — 내용 수정은 여기서 |
| `.env.example` | 환경변수 예시 |

외부 패키지가 없어 `npm install` 없이 Node 18 이상이면 바로 실행됩니다.

## 내 컴퓨터에서 실행
```bash
cp .env.example .env        # .env 에 API 키 입력
node server.js              # http://localhost:3000
npm run dev                 # API 키 없이 화면만 확인 (모의 답변)
```

## 배포 (GitHub Pages + Cloudflare Worker, 무료)
화면은 GitHub Pages, API 키는 Cloudflare Worker에 보관합니다. **API 키는 GitHub에 절대 올리지 않습니다.**

### 1) 화면 — GitHub Pages
- main 브랜치에 push하면 `.github/workflows/pages.yml`이 `public/` 폴더를 자동 배포합니다.
- 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정
- 주소: `https://<아이디>.github.io/kbc-nursing-chatbot/`

### 2) API 키 보관 서버 — Cloudflare Worker
1. dash.cloudflare.com 가입 → Workers & Pages → Create → Worker → 이름 `kbc-nursing-chatbot` → Deploy
2. Edit code → 기존 코드를 모두 지우고 `worker/worker.js` 내용을 붙여넣기 → Deploy
3. Settings → Variables and Secrets
   - `ANTHROPIC_API_KEY` (**Secret**) = Claude API 키
   - `ALLOWED_ORIGIN` (Text) = `https://<아이디>.github.io`
4. Worker 주소(`https://kbc-nursing-chatbot.<계정>.workers.dev`)를 `public/config.js`의 `CHAT_API_URL`에 넣고 push

확인: Worker 주소를 브라우저로 열어 `"keySet":true`가 보이면 정상입니다.

### 지식베이스를 고친 뒤
`knowledge.js` 수정 → `npm run build:worker` → 새 `worker/worker.js`를 Cloudflare에 다시 붙여넣기

### (선택) 서버 한 대로 운영
Railway 등 Node 서버가 있으면 `server.js` 하나로 화면+API를 함께 운영할 수 있습니다(`ANTHROPIC_API_KEY` 환경변수 설정).

## 내용 바꾸는 법
- 모집인원·일정·장학금 등이 바뀌면 `knowledge.js`의 해당 줄만 고치세요.
- 상단 D-day 일정은 `public/index.html`의 `SCHEDULE`, 빠른 질문은 `QUESTIONS`에서 바꿉니다.
- 링크 버튼 주소는 `public/index.html`의 `<nav class="links">` 안에 있습니다.

## 비용·안전 장치
- IP당 10분에 질문 20회 제한, 질문 600자 제한, 최근 대화 12개만 전송
- 지식베이스를 프롬프트 캐시로 보내 반복 비용 절감
- Anthropic 콘솔에서 월 사용 한도(Spend limit)를 꼭 설정해 두세요.
- 대화 내용은 서버에 저장하지 않습니다.
