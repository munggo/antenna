// 계획 모드 시험: sh test/run.sh (PLAN_PATH 에 확장 사본)
const m = await import(process.env.PLAN_PATH);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const ro = m.isReadOnlyCommand;

// 1. 읽기 전용 명령
ok(ro("# 파일 보기\ncat a.txt | head -20") && ro("ls -la 2>/dev/null; git status && git log --oneline -5") && ro("rg -n foo src | wc -l"), "주석·출력 버리기·파이프 읽기 명령은 허용");
ok(ro("cd ~/works && grep -rn x . 2>&1 | head") && ro("sed -n 1,20p a.ts") && ro("curl -s https://example.com | jq .") && ro("gh pr view 12"), "cd·sed -n·curl 조회·gh 보기 허용");
ok(!ro("echo hi > a.txt") && !ro("cat a >> b") && !ro("rm -rf build") && !ro("git commit -m x") && !ro("sed -i '' s/a/b/ f"), "파일 쓰기·지우기·커밋·sed -i 는 막음");
ok(!ro("npm install x") && !ro("curl -X POST https://x -d a=1") && !ro("python3 script.py") && !ro("sudo ls") && !ro("open report.html"), "설치·POST·스크립트 실행·sudo·open 은 막음");
ok(ro("") && ro("# 주석만"), "빈 명령·주석만은 허용");

// 2. 계획 뽑기
ok(JSON.stringify(m.extractPlan("조사했어요.\n\n계획:\n1. 시험 추가\n2. 고치기\n3. 설치\n\n이상이에요.")) === '["시험 추가","고치기","설치"]', "계획: 아래 번호 목록");
ok(m.extractPlan("## **계획**\n1) **환경** 준비\n2) 실행").join("|") === "환경 준비|실행", "꾸밈 붙은 제목·1) 형식");
ok(m.extractPlan("1. 그냥 목록\n2. 계획 없음").length === 0 && m.extractPlan("").length === 0, "'계획:' 이 없으면 계획 아님");

// 3. 막기·켜기·끄기·되살리기
const handlers = {}, cmds = {}, entries = [], events = [], widgets = [];
m.default({ registerCommand: (n, c) => (cmds[n] = c), registerShortcut: () => {}, on: (e, f) => (handlers[e] = f),
  appendEntry: (t, d) => entries.push({ type: "custom", customType: t, data: d }), events: { emit: (c, d) => events.push([c, d]), on: () => {} }, sendUserMessage: () => {} });
const ui = { notify() {}, setWidget: (k, v) => widgets.push(v) };
const call = (toolName, input) => handlers.tool_call({ toolName, input });
ok((await call("edit", {})) === undefined, "꺼져 있으면 막지 않음");
await cmds.plan.handler("on", { hasUI: true, ui });
ok(entries.at(-1)?.data?.on === true && events.at(-1)?.[1]?.on === true && widgets.at(-1)?.[0]?.includes("계획 모드"), "/plan on: 기록·알림·입력창 위 표시");
ok((await call("edit", {}))?.block && (await call("write", {}))?.block, "켜져 있으면 수정·작성 막음");
ok((await call("bash", { command: "rm -rf x" }))?.block && (await call("bash", { command: "# 보기\nls" })) === undefined, "명령: 읽기만 허용");
ok((await call("subagent", { agent: "worker", task: "x" }))?.block && (await call("subagent", { tasks: [{ agent: "scout" }, { agent: "reviewer" }] })) === undefined, "하위 에이전트: 조사·검토만");
ok((await call("read", { path: "a" })) === undefined && (await call("todo_write", {})) === undefined, "읽기·할 일 목록은 허용");
const g = []; await handlers.before_agent_start({ systemPromptOptions: { promptGuidelines: g } });
ok(g.some((x) => x.startsWith("PLAN MODE IS ON")), "켜져 있으면 계획 모드 지침");
await cmds.plan.handler("", { hasUI: true, ui });
await handlers.before_agent_start({ systemPromptOptions: { promptGuidelines: g } });
ok(!g.some((x) => x.startsWith("PLAN MODE IS ON")) && (await call("edit", {})) === undefined, "끄면 지침 빼고 막지 않음");
await handlers.session_start({}, { hasUI: true, ui, sessionManager: { getBranch: () => [{ type: "custom", customType: "plan-mode", data: { on: false } }, { type: "custom", customType: "plan-mode", data: { on: true } }] } });
ok((await call("write", {}))?.block, "다시 열면 기록의 마지막 상태(켜짐)로");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
