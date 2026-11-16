// Claude Code 계정 자동 전환 실제 시험: 시험 tmux 세션(pitest)의 셸에서 Claude Code(Haiku)를 켜고, 시험용 사용량 파일을 바꿔 가며 확인.
// 토큰은 값을 읽지 않고 '있음/없음'만 봄. 실행: node claude-remote/test/claude-switch-e2e.mjs (포트 8799, 세션 pitest 를 만들고 끝나면 지움)
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const S = "pitest", PORT = 8799, TOKEN = "cc-switch-token", DIR = "/tmp/cctest", ACCT = "/tmp/cctest-acct.json", HOOKS = "/tmp/cctest-hooks.json";
const BOUT = "/tmp/cctest-bridge.out";   // 시험 브리지 출력(폰 알림은 보내지 않고 여기에 적힘)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = (w) => tm("capture-pane", "-p", "-t", `${S}:${w}`);
const tail = (w, n) => scr(w).split("\n").filter((l) => l.trim()).slice(-n).join("\n");   // 빈 줄 빼고 아래쪽 n 줄
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 500) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };
const fut = Math.floor(Date.now() / 1000) + 86400;
const setPersonal = (util) => writeFileSync(ACCT, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));

// 이 창의 Claude Code 프로세스: 계정(회사 토큰 환경 변수 있음/없음), 켤 때 명령, 대화 번호
const proc = (w) => {
  const shell = tm("display", "-p", "-t", `${S}:${w}`, "#{pane_pid}").trim();
  let pids = [];
  try { pids = execFileSync("pgrep", ["-P", shell], { encoding: "utf8" }).split("\n").filter(Boolean); } catch {}
  for (const pid of [shell, ...pids]) {
    const f = `${process.env.HOME}/.claude/sessions/${pid}.json`;
    if (!existsSync(f)) continue;
    const env = execFileSync("ps", ["eww", "-o", "command=", "-p", pid], { encoding: "utf8" });
    return { pid, work: /(^|\s)CLAUDE_CODE_OAUTH_TOKEN=\S/.test(env), args: execFileSync("ps", ["-ww", "-o", "args=", "-p", pid], { encoding: "utf8" }).trim(),
      sid: JSON.parse(readFileSync(f, "utf8")).sessionId };
  }
  return null;
};
const dump = (w, n = 14) => console.log(scr(w).split("\n").filter((l) => l.trim() && !/sk-ant/.test(l)).slice(-n).map((l) => "     | " + l.slice(0, 110)).join("\n"));
const modeLine = (w) => (scr(w).match(/(⏸|⏵⏵) [a-z ]+ on/g) ?? []).pop() ?? "";
const paste = (w, t) => { tm("send-keys", "-t", `${S}:${w}`, "-l", t); tm("send-keys", "-t", `${S}:${w}`, "Enter"); };
// Claude Code 입력창에 보내기: 글 → 잠깐 → Enter, 입력창에 글이 남아 있으면 Enter 다시(막 켜졌을 때 Enter 가 먹지 않는 경우)
const ask = async (w, t) => {
  tm("send-keys", "-t", `${S}:${w}`, "-l", t);
  await sleep(600);
  const head = t.slice(0, 30);
  for (let k = 0; k < 4; k++) {
    tm("send-keys", "-t", `${S}:${w}`, "Enter");
    await sleep(1500);
    const input = scr(w).split("\n").filter((l) => l.trim()).slice(-6).join("\n");
    if (!input.includes(head) || /esc to interrupt/i.test(scr(w))) return;
  }
};
const trust = async (w) => {
  for (let i = 0; i < 40; i++) {
    const s = scr(w);
    if (/Yes, I trust this folder/.test(s)) { tm("send-keys", "-t", `${S}:${w}`, "Down"); await sleep(300); tm("send-keys", "-t", `${S}:${w}`, "Enter"); }
    if (/(⏸|⏵⏵) [a-z ]+ on/.test(s)) return true;
    await sleep(500);
  }
  return false;
};

// ── 준비: 시험 폴더, 이 실행에만 쓰는 훅, 시험 브리지, 셸 탭 ──
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const NODE = process.execPath;
const H = { matcher: "", hooks: [{ type: "command", command: `"${NODE}" "${REPO}/claude-remote/pi-remote-hook.mjs"`, timeout: 5 }] };
writeFileSync(HOOKS, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"].map((k) => [k, [H]])) }));
setPersonal(0.5);
const bout = openSync(BOUT, "w");
const bridge = spawn(NODE, ["bridge.mjs"], {
  cwd: `${REPO}/server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S,
    PI_REMOTE_SESSION_DIR: "/tmp/pitest-sessions", PI_REMOTE_PUSH_FILE: "/tmp/pitest-push.json", PI_REMOTE_PUSH_DRYRUN: "1" },
  stdio: ["ignore", bout, bout],
});
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
// 1번: 셸(실제 탭처럼). 시험 값은 창을 만들 때 환경 변수로(셸이 막 켜졌을 때 친 첫 글자는 사라질 수 있음)
const ENVS = ["-e", `PI_ACCOUNTS_CACHE=${ACCT}`, "-e", "PI_REMOTE_ACCOUNT_TICK_SEC=3", "-e", "PI_REMOTE_SWITCH_IDLE_SEC=5"];
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
const FLAGS = `--model haiku --permission-mode manual --setting-sources project,local --settings ${HOOKS}`;
tm("send-keys", "-t", `${S}:1`, "C-u"); await sleep(300);
paste(1, `claude ${FLAGS}`);
ok(await trust(1), "셸에서 claude 켬");
let p = proc(1);
ok(p && !p.work, `1) 개인 50% → 개인 계정으로 켜짐(회사 토큰 ${p?.work ? "있음" : "없음"})`);
const sid0 = p?.sid;

// 폰처럼 시험 브리지에 붙어 안내 문구를 받음
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
ws.on("message", (d, bin) => { if (!bin) try { const m = JSON.parse(d.toString()); if (m.type === "chat") ev.push(m.d); } catch {} });
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await waitFor(() => ev.find((e) => e.t === "snapshot"), 15000);

await ask(1, "Reply with exactly one word: pong");
const pong = await waitFor(() => /⏺ pong/i.test(tail(1, 8)) && !/esc to interrupt/i.test(scr(1)), 60000);
if (!pong) dump(1);
ok(pong, "대화 한 번(pong)");

// 2) 개인 97% → 쉬는 동안 회사로 다시 켬
setPersonal(0.97);
const t0 = Date.now();
const switched = await waitFor(() => { const q = proc(1); return q && q.work && q.pid !== p.pid ? q : null; }, 60000);
ok(Boolean(switched), `2) 개인 97% → 회사 계정으로 다시 켜짐(${Math.round((Date.now() - t0) / 1000)}초)`);
p = switched ?? proc(1);
ok(p && p.args.includes(`--resume ${sid0}`), "2) 같은 대화로(--resume 같은 번호)");
ok(p && p.args.includes("--model haiku") && p.args.includes(`--settings ${HOOKS}`) && p.args.includes("--permission-mode manual"), `2) 켤 때 옵션·권한 모드 유지(${p?.args.replace(/^\S+\s/, "").replace(/--resume \S+/, "--resume …")})`);
ok(await waitFor(() => modeLine(1).includes("manual mode"), 20000), "2) 맥 화면 권한 모드 = 매번 묻기");
ok(await waitFor(() => ev.some((e) => e.t === "notice" && /회사 계정으로 다시 켰어요/.test(e.text)), 10000), "2) 폰에 안내(회사 계정으로 다시 켰어요)");
await ask(1, "What single word did you reply with just before? Answer with that word only.");
// 대화 기록 파일에서: 그 질문 뒤에 온 답에 pong 이 있는지(화면 글보다 정확)
const answeredAfter = (sid, question, word) => {
  const dir = `${process.env.HOME}/.claude/projects`;
  for (const d of execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    const f = `${dir}/${d}/${sid}.jsonl`;
    if (!existsSync(f)) continue;
    const rows = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const text = (r) => { const c = r?.message?.content; return typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text ?? "").join(" ") : ""; };
    const qi = rows.findIndex((r) => r.type === "user" && text(r).includes(question));
    return qi >= 0 && rows.slice(qi + 1).some((r) => r.type === "assistant" && new RegExp(word, "i").test(text(r)));
  }
  return false;
};
const remembered = await waitFor(() => answeredAfter(sid0, "What single word did you reply with just before", "pong"), 60000);
if (!remembered) dump(1, 18);
ok(remembered, "2) 다시 켠 뒤에도 앞 대화를 기억(pong)");

// 3) 다시 50% → 입력창에 글이 있으면 그대로, 지우면 개인으로 돌아옴
setPersonal(0.5);
const pidBefore = proc(1)?.pid;
tm("send-keys", "-t", `${S}:1`, "-l", "draft words");
await sleep(15000);
const kept = proc(1)?.work === true && proc(1)?.pid === pidBefore && /❯\s+draft words/.test(scr(1));
if (!kept) { console.log(`     프로세스 같음: ${proc(1)?.pid === pidBefore}, 회사: ${proc(1)?.work}`); dump(1); }
ok(kept, "3) 입력창에 쓰던 글이 있으면 다시 켜지 않음(글도 그대로)");
for (let i = 0; i < 11; i++) tm("send-keys", "-t", `${S}:1`, "BSpace");
const back = await waitFor(() => { const q = proc(1); return q && !q.work ? q : null; }, 40000);
ok(Boolean(back), "3) 글을 지우면 개인 계정으로 돌아옴");
ok(await waitFor(() => ev.some((e) => e.t === "notice" && /개인 계정으로 돌아왔어요/.test(e.text)), 10000), "3) 폰에 안내(개인 계정으로 돌아왔어요)");
await waitFor(() => modeLine(1).includes("manual mode"), 20000);

// 4) 확인 창이 떠 있으면 그대로, 거부한 뒤 쉬면 바꿈
await ask(1, "Use the Bash tool to run exactly: touch /tmp/cctest/switch.txt");
ok(await waitFor(() => /Esc to cancel/.test(scr(1)), 60000), "4) 확인 창 뜸");
setPersonal(0.97);
await sleep(15000);
ok(proc(1)?.work === false && /Esc to cancel/.test(scr(1)), "4) 확인 창이 떠 있는 동안은 다시 켜지 않음");
tm("send-keys", "-t", `${S}:1`, "Escape");
ok(Boolean(await waitFor(() => { const q = proc(1); return q && q.work ? q : null; }, 60000)), "4) 거부한 뒤 쉬면 회사 계정으로 다시 켬");
ok(!existsSync("/tmp/cctest/switch.txt"), "4) 거부한 명령은 실행되지 않음");

// 5) 셸 없이 바로 켠 Claude Code 는 건드리지 않음(끄면 탭이 닫히므로)
tm("new-window", "-t", S, "-c", DIR, `env PI_ACCOUNTS_CACHE=${ACCT} PI_REMOTE_ACCOUNT_TICK_SEC=3 PI_REMOTE_SWITCH_IDLE_SEC=5 claude ${FLAGS}`);
ok(await trust(2), "5) 셸 없이 켬(개인 97% 이지만 개인 로그인으로)");
const d0 = proc(2);
await sleep(15000);
const d1 = proc(2);
ok(d0 && d1 && d0.pid === d1.pid && !d1.work, "5) 셸 없이 켠 탭은 그대로(같은 프로세스·개인)");

// 6) 셸 함수 claude() 를 고치기 전에 켠 셸(11-15 실제 탭: 11-11 에 켠 셸은 11-12 에 바뀐 함수를 몰라 늘 개인으로 켬).
//    다시 켤 때 그 셸 함수를 쓰면 또 개인으로 켜져 1분마다 끄고 켜기를 되풀이했다
const since = () => { const n = ev.length; return () => ev.slice(n); };
setPersonal(0.5);
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:3`, "C-u"); await sleep(300);
paste(3, `claude() { env -u CLAUDE_CODE_OAUTH_TOKEN claude "$@"; }`);   // 예전 정의 흉내: 늘 개인
await sleep(500);
paste(3, `claude ${FLAGS}`);
ok(await trust(3), "6) 예전 셸 함수가 남은 셸에서 켬");
const o0 = proc(3);
await ask(3, "Reply with exactly one word: pong");
ok(await waitFor(() => /⏺ pong/i.test(tail(3, 8)) && !/esc to interrupt/i.test(scr(3)), 60000), "6) 대화 한 번(pong)");
const ev6 = since();
ws.send(JSON.stringify({ type: "select-window", index: 3 }));
setPersonal(0.97);
const o1 = await waitFor(() => { const q = proc(3); return q && q.pid !== o0?.pid ? q : null; }, 60000);
if (!o1) { console.log("     안내:", JSON.stringify(ev6().filter((e) => e.t === "notice").map((e) => e.text))); dump(3, 16); }
ok(o1?.work === true, `6) 셸 함수가 예전 것이어도 회사 계정으로 다시 켬(${o1 ? (o1.work ? "회사" : "개인") : "다시 켜지 않음"})`);
ok(o1 && o0 && o1.args.includes(`--resume ${o0.sid}`), "6) 같은 대화로(--resume 같은 번호)");
ok(await waitFor(() => ev6().some((e) => e.t === "notice" && /회사 계정으로 다시 켰어요\(같은 대화\)/.test(e.text)), 10000), "6) 폰에 안내(회사 계정으로 다시 켰어요)");
await sleep(15000);
ok(o1 && proc(3)?.pid === o1.pid, "6) 다시 켠 뒤 그대로(끄고 켜기를 되풀이하지 않음)");

// 7) 다시 켜도 계정이 바뀌지 않으면(여기서는 PATH 앞의 claude 가 회사 토큰을 지움) 한 번만 해 보고 6시간 쉬며 폰에 알림.
//    이 탭은 아무것도 묻지 않아 대화 기록이 없음: --resume 없이 새로 켜야 함(있으면 'No conversation found' 로 바로 꺼짐)
setPersonal(0.5);
const realClaude = execFileSync("sh", ["-c", "command -v claude"], { encoding: "utf8" }).trim();
mkdirSync(`${DIR}/bin`, { recursive: true });
writeFileSync(`${DIR}/bin/claude`, `#!/bin/sh\nunset CLAUDE_CODE_OAUTH_TOKEN\nexec "${realClaude}" "$@"\n`, { mode: 0o755 });
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:4`, "C-u"); await sleep(300);
paste(4, `export PATH="${DIR}/bin:$PATH"; hash -r`);
await sleep(500);
paste(4, `claude ${FLAGS}`);
ok(await trust(4), "7) 회사 토큰을 지우는 claude 가 PATH 앞에 있는 셸에서 켬");
const r0 = proc(4);
ok(r0 && !r0.work, "7) 개인 계정으로 켜짐");
const ev7 = since();
ws.send(JSON.stringify({ type: "select-window", index: 4 }));
setPersonal(0.97);
const r1 = await waitFor(() => { const q = proc(4); return q && q.pid !== r0?.pid ? q : null; }, 60000);
if (!r1) { console.log("     안내:", JSON.stringify(ev7().filter((e) => e.t === "notice").map((e) => e.text))); dump(4, 16); }
ok(r1 && !r1.work, `7) 한 번 다시 켬(이번에도 ${r1 ? (r1.work ? "회사" : "개인") : "다시 켜지 않음"})`);
ok(r1 && !r1.args.includes("--resume"), "7) 이어 갈 대화가 없어 --resume 없이 새로 켬");
ok(await waitFor(() => ev7().some((e) => e.t === "notice" && /회사 계정으로 다시 켰는데 개인 계정으로 켜졌어요/.test(e.text)), 15000),
  "7) 폰에 안내(회사 계정으로 다시 켰는데 개인 계정으로 켜졌어요)");
ok(await waitFor(() => /알림\(시험·안 보냄\) error 탭 4 · Claude Code 계정 전환 실패/.test(readFileSync(BOUT, "utf8")), 10000), "7) 폰 알림(계정 전환 실패)");
await sleep(15000);
ok(r1 && proc(4)?.pid === r1.pid, "7) 다시 시도하지 않음(15초 동안 같은 프로세스)");
const [pane3, pane4] = [3, 4].map((w) => tm("display", "-p", "-t", `${S}:${w}`, "#{pane_id}").trim().replace(/\W/g, ""));

ws.close();
bridge.kill();
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
rmSync(ACCT, { force: true });
for (const p of [pane3, pane4]) if (p) rmSync(`${process.env.HOME}/.cache/pi-remote/feed/${p}.switch-pause`, { force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
