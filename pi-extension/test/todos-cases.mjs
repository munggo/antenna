// 할 일 목록 확장 시험: sh test/run.sh (TODO_PATH 에 확장 사본)
const m = await import(process.env.TODO_PATH);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const T = (content, status, activeForm) => ({ content, status, ...(activeForm ? { activeForm } : {}) });
const tr = (todos, extra = {}) => ({ type: "message", message: { role: "toolResult", toolName: "todo_write", details: { todos }, ...extra } });

// 1. 목록 읽기
ok(m.latestTodos([tr([T("가", "completed")]), tr([T("나", "pending")]), tr([T("다", "pending")], { isError: true })])[0].content === "나", "마지막 목록(실패한 것은 뺌)");
ok(m.latestTodos([]).length === 0, "없으면 빈 목록");

// 2. 입력창 위 줄
const short = m.widgetLines([T("환경 준비", "completed"), T("시험 추가", "in_progress", "시험 추가하는 중"), T("설치", "pending")]);
ok(short.join("|") === " 할 일 1/3| ✅ 환경 준비| ⏳ 시험 추가하는 중| ⬜ 설치", "짧은 목록: 제목·상태 표시·진행형 문구");
const long = Array.from({ length: 15 }, (_, i) => T(`단계 ${i + 1}`, i < 9 ? "completed" : i === 9 ? "in_progress" : "pending"));
const ll = m.widgetLines(long);
ok(ll.length <= 10 && ll[0] === " 할 일 9/15" && ll.some((l) => l.includes("⏳ 단계 10")) && ll.some((l) => l.includes("끝난")) && ll.some((l) => l.includes("남은")), "긴 목록: 하는 중 둘레만, 앞뒤는 개수");
ok(m.widgetLines([]).length === 0, "빈 목록은 줄 없음");

// 2-1. 접힌 한 줄·펼친 목록
ok(m.collapsedLine([T("가", "completed"), T("나", "in_progress", "나 하는 중"), T("다", "pending")]) === " ▸ 할 일 1/3 · 나 하는 중", "접힌 줄: 하는 중(진행형 문구)");
ok(m.collapsedLine([T("가", "completed"), T("나", "in_progress")]) === " ▸ 할 일 1/2 · 나", "접힌 줄: 진행형 문구가 없으면 할 일 이름");
ok(m.collapsedLine([T("가", "completed"), T("나", "pending")]) === " ▸ 할 일 1/2 · 다음: 나", "접힌 줄: 하는 중이 없으면 다음 할 일");
ok(m.collapsedLine([T("가", "completed")]) === " ▸ 할 일 1/1 · 모두 끝남", "접힌 줄: 다 끝남");
const three = [T("가", "completed"), T("나", "in_progress"), T("다", "pending")];
const c1 = m.todoWidget(three, true, (x) => `[${x}]`);
ok(c1.length === 1 && c1[0] === " ▸ 할 일 1/3 · 나  [클릭해 펼치기]", "접힘: 한 줄 + 펼치기 안내(흐린 글씨 자리)");
const e1 = m.todoWidget(three, false, (x) => `[${x}]`);
ok(e1.length === 4 && e1[0] === " ▾ 할 일 1/3  [클릭해 접기]" && e1[2] === " ⏳ 나", "펼침: 제목 + 목록 + 접기 안내");
ok(m.todoWidget([], true).length === 0 && m.todoWidget([], false).length === 0, "빈 목록은 접힘·펼침 모두 줄 없음");
const many = m.todoWidget(long, false);
ok(many.length <= 10 && many[0].startsWith(" ▾ 할 일 9/15"), "펼친 긴 목록도 하는 중 둘레만");

// 3. 도구·접기
const tools = {}, handlers = {}, widgets = [], commands = {}, notes = [];
let comp;   // 마지막 위젯 부품(클릭 시험)
m.default({ registerTool: (t) => (tools[t.name] = t), registerCommand: (n, c) => (commands[n] = c), on: (e, f) => (handlers[e] = f) });
// 위젯은 부품 팩토리: 그려서 줄로 기록
const theme = { fg: (c, t) => `<${c}>${t}` };
const ui = {
  setWidget: (k, v) => { if (typeof v === "function") { comp = v({}, theme); widgets.push(comp.render(200)); } else widgets.push(v); },
  notify: (t) => notes.push(t),
};
const click = (extra = {}) => comp.handleMouse({ type: "click", button: "left", x: 3, y: 0, ...extra });
const r = await tools.todo_write.execute("1", { todos: [T(" 가 ", "completed"), T("나", "in_progress"), T("", "pending"), { content: "라", status: "weird" }] }, undefined, undefined, { hasUI: true, ui });
ok(r.details.todos.length === 3 && r.details.todos[0].content === "가" && r.details.todos[2].status === "pending", "도구: 빈 항목 빼고, 이상한 상태는 할 일로");
ok(r.content[0].text === "할 일 목록을 바꿨다: 끝 1 · 하는 중 1 · 남음 1 (지금: 나)", "도구: 결과 글");
ok(widgets.at(-1)?.length === 1 && widgets.at(-1)[0] === " ▸ 할 일 1/3 · 나  <dim>클릭해 펼치기", "기본은 접힌 한 줄(안내는 흐린 글씨)");
const res = click();
ok(res?.handled === true && res.render === true && comp.render(200).length === 4 && comp.render(200)[0].startsWith(" ▾ 할 일 1/3"), "클릭하면 펼침(다시 그림 요청)");
ok(click({ type: "wheel" }) === undefined && click({ button: "right" }) === undefined && comp.render(200).length === 4, "휠·오른쪽 클릭은 무시(스크롤은 대화로)");
click();
ok(comp.render(200).length === 1, "다시 클릭하면 접힘");
ok(comp.render(20).every((l) => l.replace(/<[a-z]+>/g, "").length <= 20 + 6), "좁은 폭에서도 줄이 폭 안으로 잘림");
await commands.todos.handler("", { hasUI: true, ui });
ok(widgets.at(-1)?.length === 4, "/todos 로 펼침");
await commands.todos.handler("", { hasUI: true, ui });
ok(widgets.at(-1)?.length === 1, "/todos 로 다시 접음");
await tools.todo_write.execute("1b", { todos: [T("가", "completed"), T("나", "completed"), T("다", "in_progress")] }, undefined, undefined, { hasUI: true, ui });
ok(widgets.at(-1)?.length === 1 && widgets.at(-1)[0].includes("2/3 · 다"), "목록이 바뀌어도 접힌 상태 유지");
await tools.todo_write.execute("2", { todos: [T("가", "completed"), T("나", "completed")] }, undefined, undefined, { hasUI: true, ui });
await handlers.agent_settled({}, { hasUI: true, ui });
ok(widgets.at(-1) === undefined, "모두 끝나고 차례가 끝나면 접음");
await handlers.session_start({}, { hasUI: true, ui, sessionManager: { getBranch: () => [tr([T("가", "completed")])] } });
ok(widgets.at(-1) === undefined, "다시 열어도 이미 다 끝난 목록은 띄우지 않음");
await handlers.session_start({}, { hasUI: true, ui, sessionManager: { getBranch: () => [tr([T("가", "completed"), T("나", "pending")])] } });
ok(widgets.at(-1)?.[0]?.startsWith(" ▸ 할 일 1/2 · 다음: 나"), "남은 일이 있는 목록은 다시 띄움(접힌 채)");
await handlers.session_start({}, { hasUI: true, ui, sessionManager: { getBranch: () => [] } });
ok(widgets.at(-1) === undefined, "목록이 없으면 칸 없음");
await commands.todos.handler("", { hasUI: true, ui, sessionManager: { getBranch: () => [tr([T("가", "completed"), T("나", "completed")])] } });
ok(notes.at(-1)?.startsWith(" 할 일 2/2"), "목록이 없을 때 /todos 는 마지막 목록 보기");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
