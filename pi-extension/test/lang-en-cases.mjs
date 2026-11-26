// 폰 글이 영어일 때(PI_REMOTE_LANG=en)의 pi 확장 시험: sh test/run.sh (GUARD_PATH·PLAN_PATH 에 확장 사본)
// 판정은 한국어 분류 이름으로 그대로 하고, 폰에 보낼 이름·항목·계획만 영어인지 본다
const g = await import(process.env.GUARD_PATH);
const p = await import(process.env.PLAN_PATH);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const hangul = (s) => /[가-힣]/.test(String(s));

ok(process.env.PI_REMOTE_LANG === "en", "영어로 돌림(PI_REMOTE_LANG=en)");
// 1. 분류 이름: 판정은 그대로, 보낼 때만 영어
const hit = g.classifyCommand("curl -X POST https://hooks.slack.com/services/T/B/x -d '{\"text\":\"hi\"}'");
ok(hit?.label === "Slack 메시지 보내기", "판정 결과의 분류 이름은 한국어 그대로(위험도 판정이 읽음)");
ok(g.showLabel("Slack 메시지 보내기") === "Send a Slack message", "분류 이름 → 영어");
ok(g.showLabel("운영 DB 쓰기 · prod-db") === "Write to the production DB · prod-db", "'이름 · 서버' 꼴");
ok(g.showLabel("Slack에 쓰기 · 스크립트 a.sh 안") === "Write to Slack · inside script a.sh", "스크립트 안");
ok(g.showLabel("이메일 보내기(명령 글자로 판단)") === "Send an email (guessed from the command)", "글자로 판단");
ok(g.showLabel("kubectl delete") === "kubectl delete", "영어 이름은 그대로");
ok(g.riskOf({ kind: "danger", label: "운영 DB 쓰기" }) === "상" && g.riskOf({ kind: "danger", label: "폴더째 지우기" }) === "상", "위험도 판정은 그대로(상)");
// 2. 카드의 읽기 쉬운 항목
const r = g.readableInput({ channel: "#dev", text: "배포했어요", blocks: [{}], extra: { a: 1 } });
ok(/^To: #dev\nContent: 배포했어요\n2 more fields \(see original\)$/.test(r), `항목 이름 영어(지금: ${JSON.stringify(r)})`);
// 3. 요약 해석: 첫 줄 '위험도: 상|중|하' 는 두 언어 모두 그대로, 'Summary:' 머리말은 뺌
const s = g.splitSummary("위험도: 중\nSummary: Sends a deploy notice to #dev.\nIt can't be unsent.");
ok(s.risk === "중" && s.headline === "Sends a deploy notice to #dev." && s.summary === "It can't be unsent.", "요약 해석");
// 4. 계획: 'Plan:' 머리도 읽음, '계획:' 도 그대로
ok(p.extractPlan("Done.\n\nPlan:\n1. Add tests\n2. Fix it").join("|") === "Add tests|Fix it", "'Plan:' 아래 번호 목록");
ok(p.extractPlan("계획:\n1. 시험\n2. 고치기").join("|") === "시험|고치기", "'계획:' 도 그대로");
// 5. 계획 확인 카드·알림이 영어
const handlers = {}, cmds = {}, events = [], sent = [];
p.default({ registerCommand: (n, c) => (cmds[n] = c), registerShortcut: () => {}, on: (e, f) => (handlers[e] = f),
  appendEntry: () => {}, events: { emit: (c, d) => events.push([c, d]), on: () => {} }, sendUserMessage: (t) => sent.push(t) });
let asked = null;
const ui = { notify() {}, setWidget() {}, select: async (q, opts) => { asked = { q, opts }; return opts[0]; }, input: async () => "" };
await cmds.plan.handler("on", { hasUI: true, ui });
const branch = [{ type: "message", message: { role: "user", content: "x" } }, { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Plan:\n1. Add tests\n2. Fix it" }] } }];
await handlers.agent_settled({}, { hasUI: true, ui, sessionManager: { getBranch: () => branch } });
const note = events.find(([c]) => c === "pi-remote:notify")?.[1];
ok(asked && !hangul(asked.q) && asked.opts.join("|") === "Go ahead with the plan|Change the plan|Stop", `계획 확인 창이 영어(지금: ${JSON.stringify(asked)})`);
ok(note && !hangul(note.title) && !hangul(note.body), `계획 알림이 영어(지금: ${JSON.stringify(note)})`);
ok(sent.length === 1 && sent[0].startsWith("Go ahead with the plan."), "고른 뒤 pi 에 보내는 글도 영어");
process.exit(fail ? 1 : 0);
