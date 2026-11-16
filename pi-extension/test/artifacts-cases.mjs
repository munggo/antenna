// 아티팩트 확장 시험: sh test/run.sh (ART_PATH 에 확장 사본)
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const m = await import(process.env.ART_PATH);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// 1. 종류
ok(m.kindOf("a/index.HTML") === "web" && m.kindOf("d.svg") === "web" && m.kindOf("r.md") === "markdown" && m.kindOf("x.pdf") === "pdf", "종류: 웹·마크다운·PDF");
ok(m.kindOf("s.pptx") === "slides" && m.kindOf("t.csv") === "spreadsheet" && m.kindOf("w.docx") === "document" && m.kindOf("p.jpeg") === "image" && m.kindOf("z.bin") === "file", "종류: 발표·표·문서·이미지·기타");
ok(m.kindOf("v.MP4") === "video" && m.kindOf("c.mov") === "video" && m.kindOf("s.m4a") === "audio" && m.kindOf("s.mp3") === "audio", "종류: 동영상·소리");

// 2. 기록에서 목록
const tr = (path, title, extra = {}) => ({ type: "message", message: { role: "toolResult", toolName: "show_artifact", toolCallId: `c-${title}`, details: path ? { path, title, kind: m.kindOf(path), size: 1 } : undefined, ...extra } });
const list = m.artifactsIn([tr("/a/r.html", "첫판"), tr("/a/b.md", "문서"), tr("/a/r.html", "고친판"), tr("/a/x.pdf", "실패", { isError: true }), tr(null, "빈것"),
  { type: "message", message: { role: "toolResult", toolName: "read", details: { path: "/a/q.png" } } }]);
ok(list.length === 2 && list[0].path === "/a/b.md" && list[1].title === "고친판", "같은 파일은 마지막 등록만(순서는 마지막 등록 기준), 실패·빈 것·다른 도구는 뺌");

// 3. 도구 실행
const d = mkdtempSync(`${tmpdir()}/art-`);
writeFileSync(`${d}/report.html`, "<h1>hi</h1>");
const tools = {}, cmds = {}, handlers = {}, events = [];
m.default({ registerTool: (t) => (tools[t.name] = t), registerCommand: (n, c) => (cmds[n] = c), on: (e, f) => (handlers[e] = f), events: { emit: (c, x) => events.push([c, x]) } });
const t = tools.show_artifact;
const r = await t.execute("1", { path: "report.html", title: " 시험 보고서 " }, undefined, undefined, { cwd: d });
ok(r.details.path === `${d}/report.html` && r.details.title === "시험 보고서" && r.details.kind === "web" && r.details.size === 11, "상대 경로를 작업 폴더 기준 절대 경로로, 제목·종류·크기");
let threw = "";
try { await t.execute("2", { path: "none.pdf", title: "x" }, undefined, undefined, { cwd: d }); } catch (e) { threw = e.message; }
ok(threw.includes("파일이 없다"), "없는 파일은 오류(도구 실패로 기록)");
const r2 = await t.execute("3", { path: `${d}/report.html`, title: "" }, undefined, undefined, { cwd: "/" });
ok(r2.details.title === "report.html", "제목이 비면 파일 이름");

// 4. /artifacts
const notes = [];
await cmds.artifacts.handler("", { sessionManager: { getBranch: () => [] }, ui: { notify: (x) => notes.push(x) } });
ok(notes[0] === "이 대화에는 아티팩트가 없어요", "/artifacts: 없으면 안내");
let shown = null;
await cmds.artifacts.handler("", { sessionManager: { getBranch: () => [tr("/a/r.html", "첫판"), tr("/a/b.md", "문서")] }, ui: { select: async (title, opts) => { shown = { title, opts }; return undefined; }, notify: () => {} } });
ok(shown.title.startsWith("아티팩트 2개") && shown.opts[0] === "1. 문서 — /a/b.md", "/artifacts: 최근 것 먼저, 취소하면 아무것도 안 함");

// 5. 하단 줄 개수 알림
await handlers.session_start({}, { sessionManager: { getBranch: () => [tr("/a/r.html", "첫판")] } });
ok(events.at(-1)?.[0] === "artifacts:count" && events.at(-1)[1].count === 1, "개수 알림(하단 줄 📎 N)");
rmSync(d, { recursive: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
