// knowledge.js 내용을 넣어 worker/worker.js 를 만듭니다: npm run build:worker
const fs = require('fs'), path = require('path');
const { KNOWLEDGE, buildSystemPrompt } = require('../knowledge');
const tpl = fs.readFileSync(path.join(__dirname, 'worker-template.js'), 'utf8');
const out = tpl.replace('__KNOWLEDGE__', () => JSON.stringify(KNOWLEDGE)).replace('__BUILD_PROMPT__', () => buildSystemPrompt.toString());
fs.writeFileSync(path.join(__dirname, '..', 'worker', 'worker.js'), out);
console.log('worker/worker.js 생성 완료');
