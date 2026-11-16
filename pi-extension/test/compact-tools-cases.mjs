// compact-tools 시험: 한 줄 요약 문구, 접힘(한 줄)·펼침(원래 그림), 너비 자르기, 원래 렌더러가 없을 때
const m = await import(process.env.CT_PATH);
const { visibleWidth } = await import("@earendil-works/pi-tui");
let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };
const theme = { fg: (_c, t) => t, bg: (_c, t) => t, bold: (t) => t };
const plain = (lines) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");

// 1. 한 줄 요약 문구
ok(m.subjectOf("bash", { command: "# 확장 설치본 갱신\ncp a b" }) === "확장 설치본 갱신", "bash: 첫 줄 한국어 주석");
ok(m.subjectOf("bash", { command: "ls -la /tmp" }) === "ls -la /tmp", "bash: 주석 없으면 첫 줄");
ok(m.subjectOf("read", { path: "/Users/x/works/README.md" }) === "README.md", "read: 파일 이름");
ok(m.subjectOf("codemode", { code: "// @options: {}\n// 메일 두 곳 검색\nawait x" }) === "메일 두 곳 검색", "codemode: 설명 주석");
ok(m.subjectOf("mcp__gmail_work__search_emails", {}) === "gmail_work search_emails", "MCP 도구: 서버 도구");
ok(m.subjectOf("ask_user", { question: "어느 쪽?\n자세히" }) === "어느 쪽?", "ask_user: 질문 첫 줄");
ok(m.verbOf("bash", true) === "실행 중" && m.verbOf("bash", false) === "실행됨" && m.verbOf("zzz", false) === "사용함", "동사");
ok(m.duration(500) === "" && m.duration(1234) === "1.2초" && m.duration(14000) === "14초" && m.duration(125000) === "2분 5초", "걸린 시간");
ok(m.errorSummary("bash", { content: [{ type: "text", text: "x\nCommand exited with code 1" }] }) === "종료 코드 1", "bash 오류: 종료 코드");
const st = m.diffStats({ diff: "--- a\n+++ b\n-old\n+new\n+more\n same" });
ok(st?.added === 2 && st?.removed === 1, "수정 줄 수");

// 2. 렌더러: 접힘은 한 줄, 펼침은 원래 그림
const { Text } = await import("@earendil-works/pi-tui");
let seenLast = [];
const base = {
  renderCall: (args, _t, ctx) => { seenLast.push(ctx.lastComponent?.tag ?? null); const t = new Text("BASE CALL", 0, 0); t.tag = "baseCall"; return t; },
  renderResult: (_r, o) => new Text(o.expanded ? "BASE RESULT FULL" : "BASE RESULT PREVIEW", 0, 0),
};
let resolver;
const handlers = {};
m.default({ registerToolRenderer: (r) => (resolver = r), on: (n, f) => (handlers[n] = f) });
const r = resolver("bash", () => base);
ok(r.renderShell === "self", "상자 없이 직접 그림(한 줄)");

const ctx = (over = {}) => ({ state: shared, expanded: false, outputPad: 1, isPartial: true, isError: false, durationMs: undefined, lastComponent: undefined, ...over });
let shared = {};
const args = { command: "# 시험 실행\nnpm test" };
let call = r.renderCall(args, theme, ctx());
ok(plain(call.render(80)) === " ⏳ 시험 실행", "실행 중: ⏳ 한 줄");
const done = { content: [{ type: "text", text: "ok" }], details: {} };
let res = r.renderResult(done, { expanded: false, isPartial: false }, theme, ctx({ isPartial: false, durationMs: 2300 }));
call = r.renderCall(args, theme, ctx({ isPartial: false, durationMs: 2300 }));
ok(res.render(80).length === 0, "접힘: 출력은 숨김");
ok(plain(call.render(80)) === " ✓  시험 실행 · 출력 1줄 · 2.3초", "끝남: ✓ 요약 · 출력 줄 · 시간");
ok(visibleWidth(call.render(12)[0]) <= 12, "좁은 화면에선 잘라서 한 줄 유지(한글 폭 계산)");

// 실패
shared = {};
const bad = { content: [{ type: "text", text: "boom\nCommand exited with code 2" }], details: {} };
r.renderResult(bad, { expanded: false, isPartial: false }, theme, ctx({ isPartial: false, isError: true }));
call = r.renderCall(args, theme, ctx({ isPartial: false, isError: true }));
ok(plain(call.render(80)) === " ✗  시험 실행 · 출력 1줄 · 종료 코드 2", "실패: ✗ · 출력 줄(종료 코드 줄 제외) · 종료 코드");

// 펼침: 원래 머리줄+결과가 상자 하나에
shared = {};
seenLast = [];
call = r.renderCall(args, theme, ctx({ expanded: true, isPartial: false }));
res = r.renderResult(done, { expanded: true, isPartial: false }, theme, ctx({ expanded: true, isPartial: false }));
const out = plain(call.render(80));
ok(out.includes("BASE CALL") && out.includes("BASE RESULT FULL") && res.render(80).length === 0, "펼침: 원래 머리줄·전체 결과");
// 다시 그릴 때 원래 렌더러에는 원래 렌더러가 만든 부품을 넘겨야 함(내 상자를 넘기면 원래 렌더러가 깨짐)
r.renderCall(args, theme, ctx({ expanded: true, isPartial: false, lastComponent: call }));
ok(seenLast[0] === null && seenLast[1] === "baseCall", "펼침 다시 그리기: 원래 부품을 이어 줌");

// 원래 렌더러가 없는 도구(예: 연결 전 MCP)
shared = {};
const r2 = resolver("mcp__x__y", () => undefined);
call = r2.renderCall({ q: 1 }, theme, ctx({ expanded: true, isPartial: false }));
r2.renderResult({ content: [{ type: "text", text: "결과 줄" }] }, { expanded: true, isPartial: false }, theme, ctx({ expanded: true, isPartial: false }));
const out2 = plain(call.render(80));
ok(out2.includes("mcp__x__y") && out2.includes('"q": 1') && out2.includes("결과 줄"), "원래 렌더러 없음: 이름·입력·결과");
shared = {};
call = r2.renderCall({ q: 1 }, theme, ctx());
ok(plain(call.render(80)) === " ⏳ x y", "원래 렌더러 없음: 접힘 한 줄");

// 3. 도구별 이모지와 글자 시작 맞춤(✓ 는 한 칸이라 빈칸 하나 더)
const doneLine = (name, args, details) => {
  shared = {};
  const rr = resolver(name, () => base);
  rr.renderResult({ content: [{ type: "text", text: "ok" }], details }, { expanded: false, isPartial: false }, theme, ctx({ isPartial: false }));
  return plain(rr.renderCall(args, theme, ctx({ isPartial: false })).render(80));
};
ok(doneLine("read", { path: "/a/b/README.md" }) === " 📖 /a/b/README.md · 1줄", "읽기: 📖 파일(열어 볼 수 있는 파일은 전체 경로) · 읽은 줄");
ok(doneLine("edit", { path: "/a/x.swift" }, { diff: "-a\n+b\n+c" }) === " 📝 x.swift · +2 −1", "수정: 📝 파일 · +N −M");
ok(doneLine("write", { path: "/a/n.txt", content: "1\n2" }) === " 📄 /a/n.txt · 2줄", "새 파일: 📄 파일(전체 경로) · N줄");
// 읽은 줄 세기(일부만·잘림·사진·빈 파일)
const R = (text, extra) => ({ content: [{ type: "text", text }], ...extra });
ok(m.readInfo({ offset: 300, limit: 3 }, R("a\nb\nc\n\n[947 more lines in file. Use offset=303 to continue.]")) === "300–302줄(전체 1,249)", "읽기: limit 로 일부만");
ok(m.readInfo({}, R("x\n...\n\n[Showing lines 1-2000 of 15000. Use offset=2001 to continue.]")) === "1–2,000줄(전체 15,000)", "읽기: 길어서 잘림");
ok(m.readInfo({}, { content: [{ type: "image", data: "", mimeType: "image/png" }] }) === "사진", "읽기: 사진");
ok(m.readInfo({}, R("")) === "빈 파일", "읽기: 빈 파일");
ok(m.readInfo({ offset: 10, limit: 5 }, R("a\nb")) === "10–11줄", "읽기: 끝까지 짧게 남은 일부");
ok(m.readInfo({ offset: 300, limit: 3 }, R("a\nb\nc\n\n[947 more lines in file. Use offset=303 to continue.]"), true) === "300–302줄(전체 1,248)", "읽기: 줄바꿈으로 끝나는 파일은 전체에서 1 뺌");
{
  const fs = await import("node:fs");
  const dir = fs.mkdtempSync("/tmp/ct-");
  fs.writeFileSync(dir + "/a.txt", "1\n2\n");
  fs.writeFileSync(dir + "/b.txt", "1\n2");
  ok(m.endsWithNewline(dir, "a.txt") === true && m.endsWithNewline(dir, "@b.txt") === false && m.endsWithNewline(dir, "없음.txt") === false, "파일 끝 줄바꿈 확인(상대 경로·@·없는 파일)");
  fs.rmSync(dir, { recursive: true });
}
// 명령 출력 줄 세기
ok(m.outputLines(R("(no output)")) === 0, "출력 없음은 0");
ok(m.outputLines(R("a\nb\n\nCommand exited with code 1")) === 2, "종료 코드 줄은 빼고 셈");
ok(m.outputLines(R("tail...\n\n[Showing lines 13001-15000 of 15000. Full output: /tmp/x]", { details: { truncation: { truncated: true, totalLines: 15000 } } })) === 15000, "잘렸으면 전체 줄 수");
ok(doneLine("bash", { command: "# 조용한 명령" }) === " ✓  조용한 명령 · 출력 1줄", "명령: 출력 있으면 줄 수");
ok(doneLine("mcp__slack__search_messages", {}) === " 🔧 slack search_messages", "기타 도구: 🔧");
const col = (line) => visibleWidth(line.slice(0, line.search(/[A-Za-z가-힣]/)));
ok(col(doneLine("bash", { command: "# 가나다" })) === col(doneLine("read", { path: "/가나다.ts" })), "✓ 줄과 📖 줄의 글자 시작이 같음");

// 4. 생각 줄 없애기 + 아래 작업 표시 문구
const calls = [];
const ui = { setHiddenThinkingLabel: (l) => calls.push(["label", l]), setWorkingMessage: (w) => calls.push(["working", w]) };
await handlers.session_start({}, { ui });
await handlers.agent_start({}, { ui });
await handlers.message_update({ assistantMessageEvent: { type: "thinking_start" } }, { ui });
await handlers.message_update({ assistantMessageEvent: { type: "thinking_delta" } }, { ui });
await handlers.message_update({ assistantMessageEvent: { type: "text_start" } }, { ui });
await handlers.tool_execution_start({ toolName: "bash", args: { command: "# 시험 실행\nnpm test" } }, { ui });
await handlers.agent_settled({}, { ui });
const seq = calls.map(([k, v]) => `${k}:${v ?? "(기본)"}`).join(" | ");
ok(seq === "label: | working:🤔 생각 중… | working:🤔 생각 중… | working:💬 답을 쓰는 중… | working:⏳ 실행 중 시험 실행 | working:(기본)",
   `생각 줄 끄기·작업 표시 순서(${seq})`);


// 사진을 읽은 줄은 전체 경로(맥 터미널에서 눌러 바로 확인)
{
  const img = { content: [{ type: "image", data: "", mimeType: "image/jpeg" }] };
  const txt = { content: [{ type: "text", text: "a\nb" }] };
  const H = (await import("node:os")).homedir();
  const L = (args, result, cwd) => m.summaryLine("read", { args, result, isPartial: false, cwd }, theme, 0);
  ok(L({ path: "armored.jpg" }, img, "/Users/x/proj").includes("/Users/x/proj/armored.jpg · 사진"), "사진: 작업 폴더 기준 전체 경로");
  ok(L({ path: "~/Pictures/a b.png" }, img, "/tmp").includes(`${H}/Pictures/a b.png · 사진`), "사진: ~ 를 실제 경로로");
  ok(L({ path: "@/abs/c.png" }, img, "/tmp").includes("/abs/c.png · 사진") && !L({ path: "@/abs/c.png" }, img, "/tmp").includes("@"), "사진: @ 붙은 절대 경로");
  ok(L({ path: "src/main.ts" }, txt, "/Users/x/proj").includes("main.ts · 2줄") && !L({ path: "src/main.ts" }, txt, "/Users/x/proj").includes("/Users/x"), "글 파일은 지금처럼 이름만");
  ok(m.summaryLine("read", { args: { path: "armored.jpg" }, cwd: "/p" }, theme, 0).includes("/p/armored.jpg"), "읽는 중(결과 전)에도 사진은 전체 경로");
}


// 아티팩트 줄: 📎 제목 · 전체 경로
{
  const line = m.summaryLine("show_artifact", { args: { path: "r.html", title: "시험 보고서" }, result: { details: { path: "/Users/x/p/r.html" } }, isPartial: false, cwd: "/Users/x/p" }, theme, 0);
  ok(line.includes("📎") && line.includes("시험 보고서 · /Users/x/p/r.html"), "아티팩트: 📎 제목 · 전체 경로");
  ok(m.verbOf("show_artifact", false) === "아티팩트", "아티팩트 이름표");
}


// 열어 볼 수 있는 파일은 전체 경로(읽기·작성·수정, 실행 중도), 코드 파일은 이름만
{
  const L = (name, path, running = false) => m.summaryLine(name, { args: { path, content: "a\n", edits: [] }, result: running ? undefined : { content: [{ type: "text", text: "x" }] }, isPartial: running, cwd: "/w/p" }, theme, 0);
  ok(L("read", "docs/plan.md").includes("/w/p/docs/plan.md") && L("write", "out/report.html").includes("/w/p/out/report.html") && L("edit", "data.csv").includes("/w/p/data.csv"), "md·html·csv: 읽기·작성·수정 모두 전체 경로");
  ok(L("read", "notes.txt", true).includes("⏳") && L("read", "notes.txt", true).includes("/w/p/notes.txt"), "실행 중(⏳) 줄도 전체 경로");
  ok(L("read", "src/main.ts").includes("main.ts") && !L("read", "src/main.ts").includes("/w/p/"), "코드 파일은 이름만");
  ok(L("write", "slides.pptx").includes("/w/p/slides.pptx") && L("read", "a.PDF").includes("/w/p/a.PDF"), "발표 자료·대문자 확장자도");
}


// 할 일 목록 줄
ok(m.subjectOf("todo_write", { todos: [{ content: "가", status: "completed" }, { content: "나\n둘째 줄", status: "in_progress" }, { content: "다", status: "pending" }] }) === "할 일 1/3 · 지금: 나", "할 일: 📋 할 일 N/M · 지금: …");

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
