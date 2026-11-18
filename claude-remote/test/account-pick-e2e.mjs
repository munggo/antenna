// 앱에서 Claude Code 탭의 계정 고르기 실제 시험(사용자 결정 11-18: 탭마다 고르기 · 일하는 중이면 끝나면 바꾸기 ·
// 직접 고른 계정도 한도 95% 면 자동으로 넘기고 알림). 시험 tmux 세션(pitest)의 셸에서 Claude Code(Haiku)를 켜고,
// 폰처럼 시험 브리지에 붙어 {type:"set-account"} 를 보낸다. 두 계정을 조금씩 쓴다. 토큰은 값을 읽지 않고 '있음/없음'만 봄.
// 실행: node claude-remote/test/account-pick-e2e.mjs (포트 8799, 세션 pitest 를 만들고 끝나면 지움. 앱 화면 시험과 같이 돌리지 말 것)
// 작성: 서문교
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const S = "pitest", PORT = 8799, TOKEN = "cc-pick-token", DIR = "/tmp/ccpick", ACCT = "/tmp/ccpick-acct.json", HOOKS = "/tmp/ccpick-hooks.json";
const BOUT = "/tmp/ccpick-bridge.out";   // 시험 브리지 출력(폰 알림은 보내지 않고 여기에 적힘)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = (w) => tm("capture-pane", "-p", "-t", `${S}:${w}`);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 500) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };
const fut = Math.floor(Date.now() / 1000) + 86400;
const setPersonal = (util) => writeFileSync(ACCT, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));
const opt = (name) => tm("show-options", "-w", "-v", "-t", `${S}:1`, name).trim();

// 이 창의 Claude Code 프로세스: 계정(회사 토큰 환경 변수 있음/없음), 대화 번호
const proc = (w) => {
  const shell = tm("display", "-p", "-t", `${S}:${w}`, "#{pane_pid}").trim();
  let pids = [];
  try { pids = execFileSync("pgrep", ["-P", shell], { encoding: "utf8" }).split("\n").filter(Boolean); } catch {}
  for (const pid of pids) {
    const f = `${process.env.HOME}/.claude/sessions/${pid}.json`;
    if (!existsSync(f)) continue;
    try {
      const sid = JSON.parse(readFileSync(f, "utf8")).sessionId;
      const env = execFileSync("ps", ["eww", "-o", "command=", "-p", pid], { encoding: "utf8" });
      return { pid, work: /(^|\s)CLAUDE_CODE_OAUTH_TOKEN=\S/.test(env), sid };
    } catch {
      continue;
    }
  }
  return null;
};
const dump = (w, n = 14) => console.log(scr(w).split("\n").filter((l) => l.trim() && !/sk-ant/.test(l)).slice(-n).map((l) => "     | " + l.slice(0, 110)).join("\n"));
const paste = (w, t) => { tm("send-keys", "-t", `${S}:${w}`, "-l", t); tm("send-keys", "-t", `${S}:${w}`, "Enter"); };
const ask = async (w, t) => {
  tm("send-keys", "-t", `${S}:${w}`, "-l", t);
  await sleep(600);
  for (let k = 0; k < 4; k++) {
    tm("send-keys", "-t", `${S}:${w}`, "Enter");
    await sleep(1500);
    if (!scr(w).split("\n").filter((l) => l.trim()).slice(-6).join("\n").includes(t.slice(0, 30)) || /esc to interrupt/i.test(scr(w))) return;
  }
};
const rows = (sid) => {
  const dir = `${process.env.HOME}/.claude/projects`;
  for (const d of execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    const f = `${dir}/${d}/${sid}.jsonl`;
    if (existsSync(f)) return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  }
  return [];
};
const text = (r) => { const c = r?.message?.content; return typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text ?? "").join(" ") : ""; };
// 그 글을 사용자 글로 가진 대화 기록(대화 번호로 찾지 않음: 다시 켠 직후 세션 파일의 번호와 실제로 쓰이는 기록 파일이 다를 수 있음,
// 11-19 시험. 인수인계 문서에 그 글이 인용된 다음 세션 기록은 빼야 해서 사용자 글로 봄)
const rowsWith = (needle) => {
  const dir = `${process.env.HOME}/.claude/projects/${DIR.replace(/^\/tmp/, "/private/tmp").replace(/[^A-Za-z0-9]/g, "-")}`;
  if (!existsSync(dir)) return [];
  for (const f of execFileSync("ls", ["-t", dir], { encoding: "utf8" }).split("\n").filter((x) => x.endsWith(".jsonl"))) {
    const rs = readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    if (rs.some((r) => r.type === "user" && text(r).startsWith(needle))) return rs;
  }
  return [];
};
const settle = (w) => waitFor(() => !/esc to interrupt/i.test(scr(w)) && /(⏸|⏵⏵) [a-z ]+ on/.test(scr(w)), 120000, 1000);
const trust = async (w) => {
  for (let i = 0; i < 40; i++) {
    const s = scr(w);
    if (/Yes, I trust this folder/.test(s)) { tm("send-keys", "-t", `${S}:${w}`, "Down"); await sleep(300); tm("send-keys", "-t", `${S}:${w}`, "Enter"); }
    if (/(⏸|⏵⏵) [a-z ]+ on/.test(s)) return true;
    await sleep(500);
  }
  return false;
};
const HANDOFF_DIR = `${DIR}/.work/handoff`;
const handoffs = () => (existsSync(HANDOFF_DIR) ? execFileSync("ls", [HANDOFF_DIR], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".md")) : []);

// ── 준비 ──
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const NODE = process.execPath;
const H = { matcher: "", hooks: [{ type: "command", command: `"${NODE}" "${REPO}/claude-remote/pi-remote-hook.mjs"`, timeout: 5 }] };
writeFileSync(HOOKS, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"].map((k) => [k, [H]])) }));
setPersonal(0.5);
// 맥이 잠긴 것으로(폰 알림 확인용): 사용자가 맥을 쓰고 있으면 브리지가 폰 알림을 보류해 4) 의 알림을 볼 수 없다(11-19 시험)
const LOCKED = "/tmp/ccpick-locked";
writeFileSync(LOCKED, "1");
const bout = openSync(BOUT, "w");
const bridge = spawn(NODE, ["bridge.mjs"], {
  cwd: `${REPO}/server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S,
    PI_REMOTE_SESSION_DIR: "/tmp/pitest-sessions", PI_REMOTE_PUSH_FILE: "/tmp/pitest-push.json", PI_REMOTE_PUSH_DRYRUN: "1",
    PI_REMOTE_FAKE_LOCKED_FILE: LOCKED },
  stdio: ["ignore", bout, bout],
});
/** 정리하고 끝냄(PICK_ONLY_2=1 이면 2단계 뒤에 부름: 원인을 빨리 볼 때) */
function finish() {
  try { ws.close(); } catch {}
  bridge.kill();
  execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
  const pane1 = tm("display", "-p", "-t", `${S}:1`, "#{pane_id}").trim().replace(/\W/g, "");
  tm("kill-session", "-t", S);
  if (pane1) rmSync(`${process.env.HOME}/.cache/pi-remote/feed/${pane1}.switch-pause`, { force: true });
  for (const f of [ACCT, HOOKS, LOCKED]) rmSync(f, { force: true });
  console.log(fail ? `실패 ${fail}개` : "모두 통과");
  process.exit(fail ? 1 : 0);
}
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
const ENVS = ["-e", `PI_ACCOUNTS_CACHE=${ACCT}`, "-e", "PI_REMOTE_ACCOUNT_TICK_SEC=3", "-e", "PI_REMOTE_SWITCH_IDLE_SEC=5"];
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
const FLAGS = `--model haiku --permission-mode manual --setting-sources project,local --settings ${HOOKS}`;
tm("send-keys", "-t", `${S}:1`, "C-u"); await sleep(300);
paste(1, `claude ${FLAGS}`);
ok(await trust(1), "셸에서 claude 켬(개인 50%, 개인 폴더)");
let p = proc(1);
ok(p && !p.work, "1) 개인 계정으로 켜짐");

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
let lastWindows = [];
ws.on("message", (d, bin) => {
  if (bin) return;
  try {
    const m = JSON.parse(d.toString());
    if (m.type === "chat") ev.push(m.d);
    if (m.type === "windows") lastWindows = m.windows;
  } catch {}
});
await new Promise((r) => ws.on("open", r));
const since = () => { const n = ev.length; return () => ev.slice(n); };
// 연결부의 전환이 끝남: 탭 목록에 '바꾸는 중'·'바꿀 계정'이 없음(쉬는 화면이어도 새 세션에 이어 가기 글을 넣는 몇 초는 아직 전환 중, 11-19 시험)
const switchDone = () => waitFor(() => { const a = lastWindows.find((w) => w.index === 1)?.account; return a && !a.phase && !a.next; }, 90000, 500);
const notice = (evs, re) => evs().some((e) => e.t === "notice" && re.test(e.text));
const acc = () => lastWindows.find((w) => w.index === 1)?.account ?? null;
const pick = (account) => ws.send(JSON.stringify({ type: "set-account", account }));

// 0) Claude Code 탭이 아닌 곳(셸 탭 0)에서 고르면 안내만
ws.send(JSON.stringify({ type: "select-window", index: 0 }));
await sleep(1500);
const e0 = since();
pick("work");
ok(await waitFor(() => notice(e0, /Claude Code 탭에서만 계정을 고를 수 있어요/), 5000), "0) 셸 탭에서는 고를 수 없다고 안내");

ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await waitFor(() => ev.find((e) => e.t === "snapshot"), 15000);
ok(await waitFor(() => acc()?.now === "personal" && acc()?.pin === "" && !acc()?.next, 20000), `1) 앱 탭 목록에 지금 계정: ${JSON.stringify(acc())}`);
await ask(1, "Reply with exactly one word: pong");
ok(await settle(1), "1) 대화 한 번(pong)");

// 2) 쉬는 중에 회사를 고름 → 곧 인수인계 문서를 받고 회사로 새로 켬. 고른 값은 탭에 남음
const e2 = since();
const n2 = handoffs().length;
pick("work");
ok(await waitFor(() => notice(e2, /곧 회사 계정으로 바꿔요/), 10000), "2) 폰에 안내(곧 회사 계정으로 바꿔요)");
ok(opt("@ai_account_pin") === "work", "2) 고른 계정이 탭 옵션에 적힘");
ok(await waitFor(() => acc()?.phase === "switch" && acc()?.next === "work", 30000), "2) 앱 탭 목록에 '바꾸는 중'");
const s2 = await waitFor(() => { const q = proc(1); return q && q.work && q.pid !== p.pid ? q : null; }, 180000);
if (!s2) dump(1);
ok(Boolean(s2), "2) 회사 계정으로 다시 켜짐");
ok(handoffs().length > n2, "2) 인수인계 문서를 남김");
const resumed2 = await waitFor(() => rows(s2?.sid).some((r) => r.type === "user" && text(r).includes("[계정 전환]")), 40000);
if (!resumed2) { console.log("     안내:", JSON.stringify(e2().filter((e) => e.t === "notice").map((e) => e.text))); dump(1, 20); }
ok(Boolean(resumed2), "2) 새 대화에 이어 가기 글(인수인계 문서를 읽고 이어 감)");
if (process.env.PICK_ONLY_2) finish();
ok(await waitFor(() => notice(e2, /앱에서 고른 대로 회사 계정으로 다시 켰어요\(인수인계 문서로 이어 감\)/), 30000), "2) 폰에 안내(고른 대로 다시 켬)");
ok(await waitFor(() => acc()?.now === "work" && acc()?.pin === "work" && !acc()?.next && !acc()?.phase, 30000), `2) 앱 탭 목록: ${JSON.stringify(acc())}`);
p = s2 ?? proc(1);
await settle(1);   // 새 세션이 문서를 읽고 이어 가는 일이 끝나기를
await switchDone();
await sleep(8000);
ok(proc(1)?.pid === p?.pid, "2) 고른 계정을 쓰는 동안 자동 판단이 되돌리지 않음(개인 50%, 개인 폴더인데도)");

// 3) 일하는 중에 개인을 고름 → 하던 답을 끝낸 뒤에 바꿈(멈추지 않음)
const e3 = since();
tm("send-keys", "-t", `${S}:1`, "-l", "Write a 400-word story about a lighthouse keeper named Ora. Do not use any tools.");
await sleep(600);
tm("send-keys", "-t", `${S}:1`, "Enter");
ok(await waitFor(() => /esc to interrupt/i.test(scr(1)), 20000), "3) 답을 쓰는 중");
pick("personal");
ok(await waitFor(() => notice(e3, /지금 일이 끝나면 개인 계정으로 바꿔요/), 10000), "3) 폰에 안내(일이 끝나면 바꿔요)");
ok(await waitFor(() => acc()?.phase === "wait" && acc()?.next === "personal", 15000), "3) 앱 탭 목록에 '끝나면 바꿈'");
const s3 = await waitFor(() => { const q = proc(1); return q && !q.work && q.pid !== p.pid ? q : null; }, 240000);
ok(Boolean(s3), "3) 개인 계정으로 다시 켜짐");
const ORA = "Write a 400-word story about a lighthouse keeper named Ora";
const r3 = rowsWith(ORA);
const iOra = r3.findIndex((r) => r.type === "user" && text(r).startsWith(ORA));
// 다시 켠 세션은 맨 앞에 이어 가기 글([계정 전환])이 있으므로, 그 질문 뒤의 첫 [계정 전환] 글이 이번 인수인계 요청
const iAsk3 = r3.findIndex((r, i) => i > iOra && r.type === "user" && text(r).includes("[계정 전환]"));
const answered = iOra >= 0 && iAsk3 > iOra && r3.slice(iOra + 1, iAsk3).some((r) => r.type === "assistant" && /Ora/.test(text(r)));
const interrupted = r3.slice(iOra + 1, iAsk3).some((r) => /^\[Request interrupted/.test(text(r)));
ok(answered && !interrupted, `3) 하던 답을 끝까지 쓴 뒤 인수인계(답 ${answered ? "있음" : "없음"}, 멈춤 ${interrupted ? "있음" : "없음"})`);
p = s3 ?? proc(1);
await settle(1);
await switchDone();

// 4) 고른 개인 계정이 97% → 일이 없어도 회사로 넘기고 폰 알림(고른 것과 달라졌으니)
const e4 = since();
setPersonal(0.97);
const s4 = await waitFor(() => { const q = proc(1); return q && q.work && q.pid !== p.pid ? q : null; }, 180000);
ok(Boolean(s4), "4) 고른 개인 계정 97% → 회사 계정으로 다시 켜짐");
ok(await waitFor(() => notice(e4, /고른 개인 계정 사용량이 95%를 넘어 회사 계정으로 다시 켰어요/), 30000), "4) 폰에 안내(고른 계정이 한도를 넘어)");
ok(await waitFor(() => /알림\(시험·안 보냄\) account/.test(readFileSync(BOUT, "utf8")), 10000), "4) 폰 알림(계정을 바꿨어요)");
ok(acc()?.pin === "personal", "4) 고른 값은 그대로(한도가 풀리면 돌아올 곳)");
p = s4 ?? proc(1);
await settle(1);
await switchDone();

// 5) 한도가 풀리면 고른 개인 계정으로 돌아옴(쉬는 때)
const e5 = since();
setPersonal(0.5);
const s5 = await waitFor(() => { const q = proc(1); return q && !q.work && q.pid !== p.pid ? q : null; }, 180000);
ok(Boolean(s5), "5) 한도가 풀려 고른 개인 계정으로 돌아옴");
ok(await waitFor(() => notice(e5, /한도가 풀려 고른 개인 계정으로 돌아왔어요/), 30000), "5) 폰에 안내(고른 계정으로 돌아옴)");
p = s5 ?? proc(1);
await settle(1);
await switchDone();

// 6) 자동으로 되돌림: 개인 폴더·개인 50% 라 지금 계정 그대로, 고른 값은 지움
const e6 = since();
pick("auto");
ok(await waitFor(() => notice(e6, /다시 자동\(폴더·한도 기준\)으로 계정을 골라요/), 10000), "6) 폰에 안내(자동으로, 계정 그대로)");
ok(opt("@ai_account_pin") === "" && await waitFor(() => acc()?.pin === "" && acc()?.now === "personal", 15000), "6) 고른 값이 지워짐");
await sleep(8000);
ok(proc(1)?.pid === p?.pid, "6) 다시 켜지 않음");

finish();
