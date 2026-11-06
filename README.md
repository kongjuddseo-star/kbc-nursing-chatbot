# 경북전문대학교 간호학과 입시상담 챗봇

지원자·학부모가 휴대폰으로 접속해 간호학과 입시 질문을 하면 Claude가 학과 자료를 바탕으로 답합니다.

## 구성
| 파일 | 역할 |
|---|---|
| `public/index.html` | 모바일 채팅 화면 (홈페이지·유튜브·인스타그램·전화 버튼, D-day 배너, 빠른 질문) |
| `server.js` | 화면 제공 + Claude API 대신 호출 (API 키를 브라우저에 노출하지 않음) |
| `knowledge.js` | **챗봇이 아는 내용(지식베이스)과 답변 규칙** — 내용 수정은 여기서 |
| `.env.example` | 환경변수 예시 |

외부 패키지가 없어 `npm install` 없이 Node 18 이상이면 바로 실행됩니다.

## 내 컴퓨터에서 실행
```bash
cp .env.example .env        # .env 에 API 키 입력
node server.js              # http://localhost:3000
npm run dev                 # API 키 없이 화면만 확인 (모의 답변)
```

## Railway 배포 (GitHub 연결)
1. 이 폴더를 GitHub 새 저장소에 올립니다. (`.env`는 `.gitignore`로 제외됨)
2. Railway → New Project → Deploy from GitHub repo → 저장소 선택
3. Variables 탭에 추가
   - `ANTHROPIC_API_KEY` = 발급받은 키 (console.anthropic.com)
   - `CLAUDE_MODEL` = `claude-sonnet-5-5` (비용을 줄이려면 `claude-haiku-5-5`)
4. Settings → Networking → Generate Domain → 나온 주소를 QR코드로 만들어 홍보물에 넣으면 됩니다.
5. 이후 GitHub에 push하면 자동 재배포됩니다.

상태 확인: `https://<도메인>/health`

## 내용 바꾸는 법
- 모집인원·일정·장학금 등이 바뀌면 `knowledge.js`의 해당 줄만 고치세요.
- 상단 D-day 일정은 `public/index.html`의 `SCHEDULE`, 빠른 질문은 `QUESTIONS`에서 바꿉니다.
- 링크 버튼 주소는 `public/index.html`의 `<nav class="links">` 안에 있습니다.

## 비용·안전 장치
- IP당 10분에 질문 20회 제한, 질문 600자 제한, 최근 대화 12개만 전송
- 지식베이스를 프롬프트 캐시로 보내 반복 비용 절감
- Anthropic 콘솔에서 월 사용 한도(Spend limit)를 꼭 설정해 두세요.
- 대화 내용은 서버에 저장하지 않습니다.
