// 훅 없이 묻는 Claude Code 창 → 폰 질문 카드 실제 시험(11-15 사용자 보고 '/exit 뒤 피드백 초안 창을 폰에서 묻지 않음').
// 시험 tmux 세션(pitest)의 셸에서 Claude Code(Haiku)를 켜고 폰처럼 붙어, /export 창과 피드백 초안 종료 안내·목록·검토 창을
// 카드로 받고 답하는지 본다. 모델은 마지막 단계(훅이 빠진 승인 창)에서만 한 번 부른다.
// 대화 번호를 미리 정해(--session-id) 그 대화의 시험 피드백 초안을 넣어 두고 켠다. 시험 초안은 끝나면 지우고 다른 초안은 건드리지 않는다
// (목록·검토 창에서 '버리기(d)'와 '보내기(Enter)'는 누르지 않는다). 창 폭은 폰으로 볼 때와 같은 50칸(키 안내가 접힘)이 기본이고
// CC_COLS=160 처럼 바꿀 수 있다. 실행: node claude-remote/test/claude-dialog-e2e.mjs
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const S = "pitest", PORT = 8799, TOKEN = "cc-dialog-token", DIR = "/tmp/ccdialog", HOOKS = "/tmp/ccdialog-hooks.json", BOUT = "/tmp/ccdialog-bridge.out";
const HOME = process.env.HOME, DRAFTS = `${HOME}/.claude/feedback/drafts`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = () => tm("capture-pane", "-p", "-t", `${S}:1`);
const cmdNow = () => tm("display", "-p", "-t", `${S}:1`, "#{pane_current_command}").trim();
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };
const dump = () => console.log(scr().split("\n").filter((l) => l.trim()).slice(-12).map((l) => `     | ${l.slice(0, 110)}`).join("\n"));

// ── 준비: 시험 초안(이 시험 대화 번호), 이 실행에만 쓰는 훅, 시험 브리지(알림은 보내지 않고 출력에 적음), 셸 탭 ──
const SID = randomUUID(), DRAFT = randomUUID(), draftPath = `${DRAFTS}/${DRAFT}.json`;
mkdirSync(DRAFTS, { recursive: true });
const draftsBefore = readdirSync(DRAFTS).sort().join(",");
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const key = DIR.replace(/[^A-Za-z0-9]/g, "-");
writeFileSync(draftPath, JSON.stringify({
  draft_id: DRAFT, created_at: new Date().toISOString(), source_session_id: SID, cwd: DIR, model: "claude-haiku-5-5", cli_version: "2.1.325",
  os: "darwin arm64", request_ids: [], type: "bug", title: "시험 초안(안테나 화면 창 시험)", details: "- 시험", area: "", failure_mode: "other",
  task_category: "other", trigger: "model_judgment", effort: "low", thinking_type: "adaptive", message_count: 1, assistant_turn_count: 0,
  subagent_count: 0, transcript_ref: { session_file: `${HOME}/.claude/projects/${key}/${SID}.jsonl`, message_range: null, project_dir_key: key }, status: "queued",
}), { mode: 0o600 });
const NODE = process.execPath;
const H = { matcher: "", hooks: [{ type: "command", command: `"${NODE}" "${REPO}/claude-remote/pi-remote-hook.mjs"`, timeout: 5 }] };
writeFileSync(HOOKS, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"].map((k) => [k, [H]])) }));
writeFileSync("/tmp/cc-test-locked", "1");   // 맥이 잠긴 것으로(시험 중 맥을 쓰고 있어도 알림이 보류되지 않게)
const bout = openSync(BOUT, "w");
const bridge = spawn(NODE, ["bridge.mjs"], {
  cwd: `${REPO}/server`,
  env: { PATH: process.env.PATH, HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S, PI_REMOTE_SESSION_DIR: "/tmp/ccdialog-sessions",
    PI_REMOTE_PUSH_FILE: "/tmp/ccdialog-push.json", PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_FAKE_LOCKED_FILE: "/tmp/cc-test-locked" },
  stdio: ["ignore", bout, bout],
});
let ws = null, cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try { ws?.close(); } catch {}
  try { execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" }); } catch {}
  tm("kill-session", "-t", S);
  bridge.kill();
  if (existsSync(draftPath)) rmSync(draftPath);
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
tm("new-window", "-t", S, "-c", DIR);   // 1번: 셸(실제 탭처럼. Claude Code 가 꺼져도 남음)
// 창 폭 고정(이 창만): 그대로 두면 가장 최근에 쓴 클라이언트(폰 50칸·맥 터미널) 폭을 따라 그때그때 달라짐
const COLS = String(Number(process.env.CC_COLS) || 50);
tm("set-option", "-w", "-t", `${S}:1`, "window-size", "manual");
tm("resize-window", "-t", `${S}:1`, "-x", COLS, "-y", "40");
console.log(`창 폭 ${tm("display", "-p", "-t", `${S}:1`, "#{pane_width}").trim()}칸`);
await sleep(1500);
const claude = execFileSync("/bin/zsh", ["-lc", "whence -p claude"], { encoding: "utf8" }).trim();
tm("send-keys", "-t", `${S}:1`, "-l", `${claude} --model haiku --permission-mode manual --setting-sources project,local --settings ${HOOKS} --session-id ${SID}`);
tm("send-keys", "-t", `${S}:1`, "Enter");
const pane = tm("display", "-p", "-t", `${S}:1`, "#{pane_id}").trim();
const sock = `${HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
for (let i = 0; i < 80; i++) {
  await sleep(500);
  if (/Yes, I trust this folder/.test(scr())) { tm("send-keys", "-t", `${S}:1`, "Down"); await sleep(300); tm("send-keys", "-t", `${S}:1`, "Enter"); }
  if (existsSync(sock) && /(⏸|⏵⏵) [a-z ]+ on/.test(scr())) break;
}
ok(await waitFor(() => /1 feedba/.test(scr()), 10000), "시험 대화에 보내지 않은 피드백 초안 1개(상태 줄, 좁으면 '1 feedba…'로 잘림)");
await sleep(1500);
ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
ws.on("message", (d, bin) => {
  if (bin) return;
  try {
    const m = JSON.parse(d.toString());
    if (m.type !== "chat") return;
    ev.push(m.d);
    if (m.d.t === "notice") console.log(`     (앱에 보인 안내: ${m.d.text})`);
  } catch {}
});
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
ok(await waitFor(() => ev.find((e) => e.t === "snapshot" && e.agent === "claude"), 10000), "Claude Code 탭 피드에 붙음");

// 명령은 폰 입력창처럼 보낸다(브리지가 맥 입력창이 비었는지 보고 붙여 넣음. 11-15 전에는 Claude Code 입력창의 '❯'를
// 쓰던 글로 봐서 '맥 입력창에 쓰던 글이 있어 명령을 보내지 않았어요'로 늘 막혔다)
const say = async (text) => {
  ws.send(JSON.stringify({ type: "pi-send", text, mode: "auto" }));
  await sleep(600);
};
const card = (since, ms = 8000) => waitFor(() => ev.slice(since).find((e) => e.t === "question" && /^cc-s-/.test(e.question.id))?.question, ms);
const done = (id, ms = 6000) => waitFor(() => ev.some((e) => e.t === "question-done" && e.id === id), ms);
const answer = (q, label) => ws.send(JSON.stringify({ type: "question-answer", id: q?.id, answers: [label], other: "" }));
const cancel = (q) => ws.send(JSON.stringify({ type: "question-answer", id: q?.id, answers: [], other: "", cancel: true }));
const alerts = () => readFileSync(BOUT, "utf8").split("\n").filter((l) => l.includes("알림(시험·안 보냄)") && l.includes("Claude Code 가 물어봐요")).length;
const labels = (q) => (q?.options ?? []).map((o) => o.label).join(", ");

// 1) /export 창: 카드·알림 → 폰 '취소'는 카드만 닫고 맥 창은 그대로, 다시 띄우지 않음
let n = ev.length;
await say("/export");
let q = await card(n);
ok(q?.kind === "select" && labels(q) === "1. Copy to clipboard, 2. Save to file, 취소 (Esc)" && q.question.startsWith("맥 화면: 대화 내보내기"), `/export 창 → 폰 카드(${labels(q)})`);
ok(await waitFor(() => alerts() === 1, 5000), `카드와 함께 알림 하나(${alerts()}개)`);
cancel(q);
ok(await done(q?.id, 3000), "폰 '취소' → 카드 닫힘");
await sleep(4500);
ok(/Export conversation/.test(scr()) && /Esc to cancel/.test(scr()), "맥 창은 그대로");
ok(!ev.slice(n).some((e) => e.t === "question" && e.question.id !== q?.id), "취소한 창은 다시 띄우지 않음");

// 2) 맥에서 먼저 닫음 → 폰 카드 사라짐
tm("send-keys", "-t", `${S}:1`, "Escape");
await waitFor(() => !/Esc to cancel/.test(scr()), 5000);
await sleep(2000);
n = ev.length;
await say("/export");
q = await card(n);
ok(!!q, "창이 사라졌다 다시 뜨면 새 카드");
tm("send-keys", "-t", `${S}:1`, "Escape");
ok(await done(q?.id), "맥에서 먼저 닫음 → 폰 카드 사라짐");

// 3) 폰에서 '취소 (Esc)' 고르기 → 그 키가 맥 창에 들어감
await sleep(2000);
n = ev.length;
await say("/export");
q = await card(n);
answer(q, "취소 (Esc)");
ok(await done(q?.id, 3000), "폰에서 고름 → 카드 닫힘");
ok(await waitFor(() => !/Esc to cancel/.test(scr()), 5000), "고른 키(Esc)로 맥 창이 닫힘");

// 4) 피드백 초안 종료 안내(사용자 보고 화면): /exit → 카드·알림(앞 창이 사라진 뒤라 새 흐름), '취소'는 끄지 않음
await sleep(4500);
const before = alerts();
n = ev.length;
await say("/exit");
q = await card(n);
const nudgeOk = labels(q) === "검토하고 보내기 (Enter), 초안 버리고 종료 (Esc)" && q?.question.startsWith("맥 화면: 보내지 않은 피드백 초안이 1개 있어요");
ok(nudgeOk, `종료 안내 → 폰 카드(${labels(q)})`);
if (!nudgeOk) console.log(`     카드 글: ${JSON.stringify(q?.question)}`);
ok(await waitFor(() => alerts() === before + 1, 5000), `알림 하나(${alerts() - before}개)`);
cancel(q);
await done(q?.id, 3000);
await sleep(3500);
ok(/You have 1 unsent feedback draft/.test(scr()) && !/^-?zsh$/.test(cmdNow()), "폰 '취소' → 카드만 닫히고 Claude Code 는 켜진 채");

// 5) 맥에서 Enter → 목록 카드(알림 없이) → 폰 '검토 (Enter)' → 검토 카드 → '나중에 (Esc)' → 목록 카드 → '닫기 (Esc)' → 꺼짐
n = ev.length;
tm("send-keys", "-t", `${S}:1`, "Enter");
q = await card(n);
ok(labels(q) === "검토 (Enter), 버리기 (d), 닫기 (Esc)" && q?.question.includes("❯ 시험 초안"), `초안 목록 → 카드(${labels(q)})`);
n = ev.length;
answer(q, "검토 (Enter)");
q = await card(n);
ok(labels(q) === "위로 (↑), 아래로 (↓), 보내기 (Enter), 버리기 (d), 나중에 (Esc)", `검토 창 → 카드(${labels(q)})`);
n = ev.length;
answer(q, "나중에 (Esc)");
q = await card(n);
ok(/^검토 \(Enter\)/.test(labels(q)), "검토 창에서 '나중에' → 목록 카드");
answer(q, "닫기 (Esc)");
ok(await waitFor(() => /^-?zsh$/.test(cmdNow()), 10000), "목록에서 '닫기' → Claude Code 꺼짐(셸)");
ok(await done(q?.id, 5000), "꺼지면 폰 카드도 닫힘");
ok(alerts() === before + 1, `이어 뜬 창(목록·검토)은 알림 없이(종료 흐름의 알림 ${alerts() - before}개)`);
ok(existsSync(draftPath), "'닫기'는 초안을 버리지 않음(시험 초안 그대로)");

// 6) 훅이 빠진 승인 창(일하는 중의 cancel 창): 승인 훅 없이 켠 Claude Code 에 파일 쓰기를 시키면 승인 창이 훅 없이 뜬다.
//    승인 카드를 기다리느라 바로 띄우지 않고(약 6초), 그래도 카드가 없으니 화면 카드로 → 폰에서 '1. Yes' → 파일이 생김
const HOOKS2 = "/tmp/ccdialog-hooks2.json", SID2 = randomUUID();
writeFileSync(HOOKS2, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop"].map((k) => [k, [H]])) }));
n = ev.length;
tm("send-keys", "-t", `${S}:1`, "-l", `${claude} --model haiku --permission-mode manual --setting-sources project,local --settings ${HOOKS2} --session-id ${SID2}`);
tm("send-keys", "-t", `${S}:1`, "Enter");
await waitFor(() => existsSync(sock) && /(⏸|⏵⏵) [a-z ]+ on/.test(scr()), 40000);
ok(await waitFor(() => ev.slice(n).some((e) => e.t === "snapshot"), 15000), "다시 켠 Claude Code 의 연결부에 다시 붙음");
await sleep(1500);
const before6 = alerts();
n = ev.length;
ws.send(JSON.stringify({ type: "pi-send", text: `Use the Write tool to create the file ${DIR}/hookless.txt containing yes. Do nothing else.`, mode: "auto" }));
const seen = await waitFor(() => /Esc to cancel/.test(scr()) && Date.now(), 90000);
q = await card(n, 20000);
const after = q && seen ? (Date.now() - seen) / 1000 : -1;
ok(/^1\. Yes/.test(labels(q)) && !ev.slice(n).some((e) => e.t === "approval"), `훅 없는 승인 창 → 화면 카드(${labels(q)})`);
ok(after >= 3.5, `승인 카드를 기다렸다가 열림(창이 보이고 ${after.toFixed(1)}초 뒤)`);
answer(q, "1. Yes");
ok(await waitFor(() => existsSync(`${DIR}/hookless.txt`), 30000), "폰에서 '1. Yes' → 파일이 생김");
ok(alerts() === before6 + 1, `알림은 하나(Claude Code 의 '입력이 필요함'과 겹치지 않음, ${alerts() - before6}개)`);
ok(!ev.some((e) => e.t === "notice" && /쓰던 글이 있어/.test(e.text)), "폰 입력창에서 보낸 /export·/exit 가 막히지 않음");
if (fail) dump();

cleanup();
ok(readdirSync(DRAFTS).sort().join(",") === draftsBefore, "피드백 초안 폴더가 시험 전과 같음(시험 초안 지움, 다른 초안 그대로)");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
