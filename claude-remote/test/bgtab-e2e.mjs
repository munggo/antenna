// 백그라운드 탭(/bgtab) 실제 시험: 시험 tmux 세션 pitest 에 pi(Haiku)·Claude Code(Haiku) 를 띄우고 시험 브리지(8799)로 확인
// - 맥 /bgtab(pi·Claude Code), pi AI 도구, 폰 '백그라운드로 보내기', 끝나면 폰 알림(시험 모드 기록)과 시킨 탭에 결과
// - 앱 서랍용: 보고 뒤 끝난 때(@bg_done)·시킨 칸(@bg_from), 앱이 받는 탭 목록의 백그라운드 정보, Claude Code 가 뒤에서 돌리는 셸(@ai_jobs)
// - 새 탭은 저장소의 확장·훅을 쓰는 감싼 실행 파일로 켬(PI_BG_PI_CMD·PI_BG_CLAUDE_CMD)
// 실행: node claude-remote/test/bgtab-e2e.mjs (세션 pitest·포트 8799 를 만들고 끝나면 지움)
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const S = "pitest", PORT = 8799, TOKEN = "bgtab-token", DIR = "/tmp/bgtest", LOG = "/tmp/bgtab-bridge.log", HOOKS = "/tmp/bgtest-hooks.json", BIN = "/tmp/bgtest-bin";
const NODE = process.execPath, PI = process.env.PI_BIN || execFileSync("/bin/zsh", ["-lc", "whence -p pi"], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = (t) => tm("capture-pane", "-p", "-J", "-S", "-200", "-t", t);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 500) => { for (let t = 0; t < ms; t += step) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
const windows = () => tm("list-windows", "-t", S, "-F", "#{window_index}\t#{window_name}\t#{pane_id}").trim().split("\n").filter(Boolean).map((l) => { const [i, n, p] = l.split("\t"); return { i: Number(i), n, p }; });
const opt = (p, k) => tm("show-options", "-w", "-v", "-t", p, k).trim();
const log = () => (existsSync(LOG) ? readFileSync(LOG, "utf8") : "");
const pushedDone = (w) => log().includes(`알림(시험·안 보냄) done 탭 ${w}`);
const dump = (t, n = 14) => console.log(scr(t).split("\n").filter((l) => l.trim() && !/sk-ant/.test(l)).slice(-n).map((l) => "     | " + l.slice(0, 110)).join("\n"));
const typeEnter = async (t, text) => {
  tm("send-keys", "-t", t, "-l", text); await sleep(700);
  for (let k = 0; k < 4; k++) {
    tm("send-keys", "-t", t, "Enter"); await sleep(1500);
    if (!scr(t).split("\n").filter((l) => l.trim()).slice(-8).join("\n").includes(text.slice(0, 25))) return;
  }
};
// 새 백그라운드 탭(이름 'bg …', 탭 표시 @bg_by 가 적힌 뒤)
const newBg = async (known, ms = 15000) => waitFor(() => windows().find((w) => !known.includes(w.i) && /^bg /.test(w.n) && opt(w.p, "@bg_by")), ms);
const trust = async (t) => {
  for (let i = 0; i < 60; i++) {
    const s = scr(t);
    if (/Yes, I trust this folder/.test(s)) { tm("send-keys", "-t", t, "Down"); await sleep(300); tm("send-keys", "-t", t, "Enter"); }
    if (/(⏸|⏵⏵) [a-z ]+ on/.test(s)) return true;
    await sleep(500);
  }
  return false;
};

// ── 준비 ──
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
for (const d of [DIR, BIN]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
const H = { matcher: "", hooks: [{ type: "command", command: `"${NODE}" "${REPO}/claude-remote/pi-remote-hook.mjs"`, timeout: 5 }] };
writeFileSync(HOOKS, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"].map((k) => [k, [H]])) }));
mkdirSync(`${DIR}/.claude/commands`, { recursive: true });
writeFileSync(`${DIR}/.claude/commands/bgtab.md`, "---\ndescription: test\n---\nThe /bgtab hook did not run. Say exactly: HOOK-MISSING\n");
const PI_EXT = ["claude-accounts", "send-guard", "pi-remote-feed", "bgtab", "compact-tools"].map((n) => `-e ${REPO}/pi-extension/${n}.ts`).join(" ");
const CLAUDE = execFileSync("/bin/zsh", ["-lc", "whence -p claude"], { encoding: "utf8" }).trim();
writeFileSync(`${BIN}/pi`, `#!/bin/sh\nexec ${PI} --model claude/claude-haiku-4-5 --thinking off -ne ${PI_EXT} "$@"\n`, { mode: 0o755 });
writeFileSync(`${BIN}/claude`, `#!/bin/sh\nexec "${CLAUDE}" --model haiku --permission-mode auto --setting-sources project,local --settings ${HOOKS} "$@"\n`, { mode: 0o755 });
writeFileSync("/tmp/bgtest-locked", "1");   // 맥이 잠긴 것으로(시험 중 맥을 쓰고 있어 알림이 보류되지 않게)
writeFileSync(LOG, "");
const TEST_ENV = { PI_BG_LAUNCH: `${REPO}/claude-remote/bg-launch.mjs`, PI_BG_PI_CMD: `${BIN}/pi`, PI_BG_CLAUDE_CMD: `${BIN}/claude` };
const bridge = spawn(NODE, ["bridge.mjs"], {
  cwd: `${REPO}/server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S, ...TEST_ENV,
    PI_REMOTE_SESSION_DIR: "/tmp/pitest-sessions", PI_REMOTE_PUSH_FILE: "/tmp/pitest-push.json", PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_FAKE_LOCKED_FILE: "/tmp/bgtest-locked" },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => writeFileSync(LOG, log() + d));
bridge.stderr.on("data", (d) => writeFileSync(LOG, log() + d));
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);   // 0번: 셸
for (const [k, v] of Object.entries(TEST_ENV)) tm("set-environment", "-t", S, k, v);
await sleep(2500);

// ── 1) pi 탭에서 /bgtab(사람이 시킴: 결과는 대화에 남기만) ──
tm("new-window", "-t", S, "-c", DIR, `${BIN}/pi`);
const piWin = windows().find((w) => w.i === 1);
ok(Boolean(await waitFor(() => /haiku/i.test(scr(`${S}:1`)), 30000)), "pi 탭(1번) 켬");
await sleep(2500);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
let wins = [];   // 앱이 받는 탭 목록(서랍의 백그라운드 칸·뒤에서 도는 일)
ws.on("message", (d, bin) => { if (!bin) try { const m = JSON.parse(d.toString()); if (m.type === "chat") ev.push(m.d); if (m.type === "windows") wins = m.windows; } catch {} });
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await waitFor(() => ev.find((e) => e.t === "snapshot"), 10000);
const assistantCount = () => { const s = [...ev].reverse().find((e) => e.t === "snapshot"); return s ? s.messages.filter((m) => m.role === "assistant").length : -1; };

let known = windows().map((w) => w.i);
await typeEnter(`${S}:1`, "/bgtab Reply with exactly one word: 4242");
const b1 = await newBg(known);
ok(Boolean(b1), `1) /bgtab → 새 탭 ${b1?.i}('${b1?.n}')`);
ok(b1 && opt(b1.p, "@bg_origin") === piWin.p && opt(b1.p, "@bg_by") === "user", "1) 새 탭에 시킨 칸·시킨 쪽(user) 기록");
ok(/백그라운드 탭 \d+\(bg .*\)에서 시작했어요/.test(scr(`${S}:1`)), "1) 시킨 탭에 시작 안내");
const r1 = await waitFor(() => /백그라운드 작업 'bg [^']*'\(탭 \d+\)이 끝났어요/.test(scr(`${S}:1`)) && /4242/.test(scr(`${S}:1`)), 90000);
if (!r1) { dump(`${S}:1`); if (b1) dump(b1.p); }
ok(Boolean(r1), "1) 끝나면 시킨 pi 탭 대화에 결과(4242)");
ok(b1 && pushedDone(b1.i), "1) 폰 알림(작업 끝, 1시간 안 됐어도)");
ok(b1 && opt(b1.p, "@bg_origin") === "", "1) 보고한 뒤 새 탭의 보고 표시를 지움");
ok(/^bg /.test(b1 ? windows().find((w) => w.i === b1.i)?.n ?? "" : ""), "1) 새 탭은 남아 있음");
ok(b1 && Number(opt(b1.p, "@bg_done")) > 0 && opt(b1.p, "@bg_from") === piWin.p, "1) 보고한 뒤 끝난 때(@bg_done)를 적고 시킨 칸(@bg_from)은 남김(앱 서랍용)");
const w1 = await waitFor(() => wins.find((w) => w.index === b1?.i && w.bg?.done > 0), 6000);
ok(Boolean(w1) && w1.bg.from === 1 && w1.bg.by === "user", `1) 앱이 받는 탭 목록에 백그라운드 정보(시킨 탭 1번·끝남) → ${JSON.stringify(w1?.bg)}`);
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await sleep(4000);
const before1 = assistantCount();
await sleep(6000);
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await sleep(2000);
ok(assistantCount() === before1 && !/Working/.test(scr(`${S}:1`).split("\n").slice(-6).join("\n")), "1) 사람이 시킨 것이면 시킨 pi 가 이어서 답하지 않음");

// ── 2) pi AI 가 background_task 도구로 시킴 → 결과가 오면 이어서 처리 ──
known = windows().map((w) => w.i);
await typeEnter(`${S}:1`, "Call the background_task tool exactly once with task 'Reply with exactly one word: 7373'. Then reply with only the word STARTED.");
const b2 = await newBg(known, 60000);
ok(Boolean(b2) && opt(b2.p, "@bg_by") === "ai", `2) AI 도구 → 새 탭 ${b2?.i}(시킨 쪽 ai)`);
const r2 = await waitFor(() => {
  const s = scr(`${S}:1`);
  const at = b2 ? s.indexOf(`(탭 ${b2.i})이 끝났어요`) : -1;
  return at > 0 && s.slice(at).includes("7373");
}, 120000);
ok(Boolean(r2), "2) 결과(7373)가 시킨 pi 탭에 옴");
const cont = await waitFor(() => { ws.send(JSON.stringify({ type: "select-window", index: 1 })); return null; }, 1) ?? true;
await sleep(20000);
const tail2 = scr(`${S}:1`).split("\n").filter((l) => l.trim());
const idxRes = tail2.findLastIndex((l) => /백그라운드 작업 'bg .*이 끝났어요/.test(l));
ok(idxRes >= 0 && tail2.slice(idxRes + 1).some((l) => /7373|백그라운드|결과|STARTED|완료|done/i.test(l)), "2) AI 가 시킨 것이면 시킨 pi 가 결과를 받아 이어서 답함");
if (!(idxRes >= 0)) dump(`${S}:1`, 20);

// ── 3) 폰 '백그라운드로 보내기'(pi 탭) ──
known = windows().map((w) => w.i);
let from = ev.length;
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await sleep(1500);
ws.send(JSON.stringify({ type: "bg-start", text: "Reply with exactly one word: 5151" }));
const b3 = await newBg(known);
ok(Boolean(b3) && opt(b3.p, "@bg_by") === "phone" && opt(b3.p, "@bg_origin") === piWin.p, `3) 폰 → 새 탭 ${b3?.i}(시킨 쪽 phone, 시킨 칸 = 보던 탭)`);
ok(Boolean(await waitFor(() => ev.slice(from).some((e) => e.t === "notice" && /백그라운드 탭 \d+.*시작했어요/.test(e.text)), 5000)), "3) 폰에 시작 안내");
ok(Boolean(await waitFor(() => /5151/i.test(scr(`${S}:1`)) && b3 && pushedDone(b3.i), 90000)), "3) 끝나면 시킨 탭에 결과(5151) + 폰 알림");

// ── 4) 폰: pi·Claude 가 없는 탭(0번 셸)이면 안내만 ──
known = windows().map((w) => w.i);
from = ev.length;
ws.send(JSON.stringify({ type: "select-window", index: 0 }));
await sleep(2500);
ws.send(JSON.stringify({ type: "bg-start", text: "Reply with exactly one word: nope" }));
ok(Boolean(await waitFor(() => ev.slice(from).some((e) => e.t === "notice" && /pi·Claude Code 가 없어/.test(e.text)), 5000)) && !(await newBg(known, 3000)), "4) 셸 탭에서는 열지 않고 안내");

// ── 5) 빈 /bgtab → 안내 ──
known = windows().map((w) => w.i);
await typeEnter(`${S}:1`, "/bgtab");
ok(/할 일을 적어 주세요/.test(scr(`${S}:1`)) && !(await newBg(known, 3000)), "5) 할 일이 없으면 열지 않고 안내");

// ── 6) Claude Code 탭에서 /bgtab(훅이 가로채 AI 에 보내지 않음) ──
tm("new-window", "-t", S, "-c", DIR, `${BIN}/claude`);
const ccWin = windows().at(-1);
ok(await trust(ccWin.p), `Claude Code 탭(${ccWin.i}번) 켬`);
await sleep(2000);
known = windows().map((w) => w.i);
await typeEnter(ccWin.p, "/bgtab Reply with exactly one word: 9090");
const b6 = await newBg(known);
const o6 = b6 ? opt(b6.p, "@bg_origin") : "";
// (Claude 는 금방 끝나 보고하면서 시킨 칸 표시를 지울 수 있음 → 시킨 칸은 아래 '결과가 그 탭에 옴'으로 확인)
ok(Boolean(b6) && opt(b6.p, "@bg_by") === "user" && (o6 === "" || o6 === ccWin.p), `6) Claude /bgtab → 새 탭 ${b6?.i}(시킨 쪽 user)`);
ok(/백그라운드 탭 \d+\(bg .*\)에서 시작했어요/.test(scr(ccWin.p)) && !/HOOK-MISSING/.test(scr(ccWin.p)), "6) 훅이 막고 안내(AI 에 안 감)");
const r6 = await waitFor(() => /\[백그라운드 작업 끝\] 'bg [^']*'\(탭 \d+\)/.test(scr(ccWin.p)), 120000);
if (!r6) { dump(ccWin.p); if (b6) dump(b6.p); }
ok(Boolean(r6) && /9090/i.test(scr(ccWin.p)), "6) 끝나면 시킨 Claude 탭에 결과(9090)를 넣음");
ok(b6 && pushedDone(b6.i), "6) 폰 알림(작업 끝)");
ok(b6 && Number(opt(b6.p, "@bg_done")) > 0 && opt(b6.p, "@bg_from") === ccWin.p, "6) Claude 백그라운드 탭도 보고한 뒤 끝난 때를 적고 시킨 칸은 남김");

// ── 7) 뒤에서 도는 일: Claude Code 가 뒤에서 셸을 돌리면 연결부가 '셸 1개'를 탭에 적고, 끝나면 지움(앱 서랍용) ──
// Claude Code 가 가끔 입력을 막는 안내 창('Teach auto mode about your environment?')을 띄움 → '지금은 안 함'(Esc)으로 닫음.
// Esc 는 일하는 중이면 작업을 멈추므로, 지금 화면(스크롤 기록 말고) 아래쪽에 그 창이 보일 때만 누른다
const TIP = /Teach auto mode about your environment\?/;
const tipShown = (t) => TIP.test((tm("capture-pane", "-p", "-t", t) || "").split("\n").filter((l) => l.trim()).slice(-12).join("\n"));
const dismissTip = async (t) => {
  for (let i = 0; i < 3 && tipShown(t); i++) { tm("send-keys", "-t", t, "Escape"); await sleep(1000); }
  return !tipShown(t);
};
const J7 = "Use the Bash tool with run_in_background set to true to run exactly: sleep 25. Do not wait for it. Then reply with only the word STARTED.";
ok(opt(ccWin.p, "@ai_jobs") === "", "7) 처음엔 뒤에서 도는 일 없음");
await dismissTip(ccWin.p);
await typeEnter(ccWin.p, J7);
if (tipShown(ccWin.p)) {
  // 보내려는 사이 안내 창이 떠서 글이 입력창에 남음: 창을 닫고 다시 보냄
  ok(await dismissTip(ccWin.p), "7) 입력을 막은 Claude Code 안내 창을 '지금은 안 함'으로 닫음");
  tm("send-keys", "-t", ccWin.p, "Enter");
  await sleep(1500);
}
const j7 = await waitFor(() => opt(ccWin.p, "@ai_jobs") === "셸 1개", 60000);
if (!j7) dump(ccWin.p);
ok(Boolean(j7), `7) 뒤에서 셸이 돌면 탭에 '셸 1개'(지금: '${opt(ccWin.p, "@ai_jobs")}')`);
ok(Boolean(await waitFor(() => wins.find((w) => w.index === ccWin.i)?.jobs === "셸 1개", 8000)), "7) 앱이 받는 탭 목록에도 실림");
const g7 = await waitFor(() => opt(ccWin.p, "@ai_jobs") === "", 90000);
if (!g7) dump(ccWin.p);
ok(Boolean(g7), "7) 셸이 끝나면 지움");

ws.close();
bridge.kill();
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
for (const f of [DIR, BIN, HOOKS, "/tmp/bgtest-locked"]) rmSync(f, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
