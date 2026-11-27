// 쉬는 탭의 Claude Code 연결부가 저절로 꺼지지 않는지 가짜 Claude Code 로 시험(모델을 부르지 않음, 1분쯤).
// 11-27 사용자 보고: 쉬던 탭이 폰에 터미널 화면만 보임(그 탭 연결부가 꺼져 있었고, 쉬는 탭이라 다시 띄워 줄 훅도 오지 않음)
// 1) 그 칸의 Claude Code 가 부른 훅은 연결부에 넘김
// 2) 그 Claude Code 가 낳은 별도 실행(그 탭 대화가 돌린 'claude -p' 등)의 훅은 넘기지 않음: 탭 번호를 물려받아 이 칸으로 오는데,
//    넘기면 연결부가 그 대화로 화면을 바꾸고 그 끝 신호에 꺼졌다(같은 날 다른 탭 기록)
// 3) 연결부가 어떤 까닭으로든 흔적 없이 꺼지면(SIGKILL) 폰이 그 탭을 볼 때 브리지가 다시 띄움(server/feed-revive.mjs).
//    Claude Code 가 아닌 칸·연결부가 도는 칸에는 띄우지 않고, 브리지 설정의 비밀값은 넘기지 않음.
//    실제 브리지(가짜 홈·시험 tmux 서버에 붙여 따로 띄움)에 폰처럼 붙으면 연결부가 없던 탭도 채팅 화면 자료가 옴
// 4) 칸이 정말 사라지면 연결부는 끝나고 까닭을 기록에 남김
// 따로 띄운 tmux 서버(TMUX_TMPDIR)·가짜 홈만 쓴다. 쓰는 tmux 서버와 쓰는 연결부는 건드리지 않는다.
// 연결부는 뜰 때 같은 칸 번호의 다른 연결부를 끄므로, 시험 칸 번호는 쓰는 칸 번호와 겹치지 않게 고른다.
// 실행: node claude-remote/test/feed-alive.test.mjs
// 작성: 서문교
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FEED = join(HERE, "..", "claude-feed.mjs"), HOOK = join(HERE, "..", "pi-remote-hook.mjs");
const ROOT = `/tmp/antenna-alive-${process.pid}`, HOME = `${ROOT}/home`, INBOX = `${ROOT}/inbox`;
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? "tmux";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

// 시험 tmux 서버: TMUX·TMUX_PANE 을 빼고 TMUX_TMPDIR 로 따로 띄움
const env = { ...process.env, HOME, TMUX_TMPDIR: `${ROOT}/tmux` };
delete env.TMUX;
delete env.TMUX_PANE;
mkdirSync(`${ROOT}/tmux`, { recursive: true });
mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
mkdirSync(`${ROOT}/bin`, { recursive: true });
mkdirSync(INBOX, { recursive: true });
const tm = (...a) => { try { return execFileSync(TMUX, a, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };

// 가짜 Claude Code: 프로그램 이름이 버전 번호 꼴(실제 Claude Code 도 '2.1.332' 처럼 보임). inbox 에 일이 들어오면 훅을 부름.
// child 일이면 자기 아래에 가짜 Claude Code 를 하나 더 띄워 그쪽이 훅을 부름(그 탭 대화가 'claude -p' 를 돌린 꼴)
const BIN = `${ROOT}/bin/9.9.9`;
try { linkSync(process.execPath, BIN); } catch { symlinkSync(process.execPath, BIN); }
const CFG = `${ROOT}/cfg.json`;
writeFileSync(CFG, JSON.stringify({ node: process.execPath, hook: HOOK, home: HOME, inbox: INBOX, bin: BIN }));
writeFileSync(`${ROOT}/fake.mjs`, `
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const runHook = (ev) => new Promise((r) => {
  const h = spawn(cfg.node, [cfg.hook], { env: { ...process.env, HOME: cfg.home }, stdio: ["pipe", "ignore", "ignore"] });
  h.on("exit", r);
  h.stdin.end(JSON.stringify(ev));
});
if (process.argv[3] === "child") {
  for (const ev of JSON.parse(process.argv[4])) await runHook(ev);
  process.exit(0);
}
process.stdout.write("\\x1b[2J\\x1b[H⏺ 가짜 Claude Code\\r\\n❯ ");
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  for (const f of readdirSync(cfg.inbox).sort()) {
    const p = cfg.inbox + "/" + f;
    const job = JSON.parse(readFileSync(p, "utf8"));
    rmSync(p);
    if (job.child) await new Promise((r) => spawn(cfg.bin, [process.argv[1], process.argv[2], "child", JSON.stringify(job.events)], { stdio: "ignore" }).on("exit", r));
    else for (const ev of job.events) await runHook(ev);
  }
  busy = false;
}, 300);
`);

// 쓰는 쪽 칸 번호(쓰는 tmux 서버의 칸, 도는 연결부의 칸)와 겹치지 않는 시험 칸 고르기
const used = new Set();
try { for (const p of execFileSync(TMUX, ["list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")) if (p) used.add(p.trim()); } catch { /* 쓰는 tmux 없음 */ }
try { for (const l of execFileSync("pgrep", ["-fl", "claude-feed\\.mjs %[0-9]+$"], { encoding: "utf8" }).split("\n")) { const m = l.match(/(%\d+)$/); if (m) used.add(m[1]); } } catch { /* 도는 연결부 없음 */ }
tm("new-session", "-d", "-s", "alive", "-x", "100", "-y", "30", "sleep 3600");
const filler = tm("display", "-p", "-t", "alive:", "#{pane_id}");   // Claude Code 가 아닌 칸(sleep)
let pane = filler;
while (pane && used.has(pane)) pane = tm("new-window", "-d", "-t", "alive:", "-P", "-F", "#{pane_id}", "sleep 3600");
tm("respawn-pane", "-k", "-t", pane, `${BIN} ${ROOT}/fake.mjs ${CFG}`);
const tag = pane.replace(/\W/g, "");
const SOCK = `${HOME}/.cache/pi-remote/feed/${tag}.sock`, LOG = `${HOME}/.cache/pi-remote/feed/${tag}.hooks.log`, MISS = `${HOME}/.cache/pi-remote/feed/${tag}.hook-miss.log`;
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const pids = () => { try { return execFileSync("pgrep", ["-f", `claude-feed\\.mjs ${pane}$`], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number); } catch { return []; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let feedPid = 0;
const ensureFeed = async () => {
  if (feedPid && alive(feedPid)) return;
  rmSync(SOCK, { force: true });
  feedPid = spawn(process.execPath, [FEED, pane], { env, stdio: "ignore", detached: true }).pid;
  await waitFor(() => existsSync(SOCK), 8000);
};
let jobN = 0;
let bridge = null;
const job = (o) => writeFileSync(`${INBOX}/${String(++jobN).padStart(3, "0")}.json`, JSON.stringify(o));
// 연결부에 붙어 첫 줄(대화 전체) 받기
const snapshot = () => new Promise((res) => {
  const c = createConnection(SOCK);
  let b = "";
  const t = setTimeout(() => { c.destroy(); res(null); }, 4000);
  c.setEncoding("utf8");
  c.on("connect", () => c.write('{"hello":true}\n'));
  c.on("data", (d) => { b += d; const i = b.indexOf("\n"); if (i >= 0) { clearTimeout(t); c.destroy(); try { res(JSON.parse(b.slice(0, i))); } catch { res(null); } } });
  c.on("error", () => { clearTimeout(t); res(null); });
});

try {
  const fake = await waitFor(() => tm("display", "-p", "-t", pane, "#{pane_current_command}") === "9.9.9", 5000);
  ok(!used.has(pane) && fake, `시험 칸 ${pane}(쓰는 칸과 겹치지 않음)에 가짜 Claude Code`);
  await ensureFeed();
  ok(existsSync(SOCK) && alive(feedPid), "시험 연결부가 뜸");

  // 1) 그 칸의 Claude Code 가 부른 훅
  job({ events: [{ hook_event_name: "SessionStart", session_id: "aaaa1111-0000-0000-0000-000000000000", source: "startup" }] });
  ok(await waitFor(() => /SessionStart\s+aaaa1111/.test(read(LOG)), 8000), "1) 그 칸의 Claude Code 가 부른 훅은 연결부에 넘김");

  // 2) 그 Claude Code 가 낳은 별도 실행의 훅(시작·끝)
  job({ child: true, events: [
    { hook_event_name: "SessionStart", session_id: "bbbb2222-0000-0000-0000-000000000000", source: "startup" },
    { hook_event_name: "SessionEnd", session_id: "bbbb2222-0000-0000-0000-000000000000", reason: "other" },
  ] });
  const missed = await waitFor(() => /SessionEnd .*별도 실행/.test(read(MISS)), 10000);
  await sleep(1500);
  ok(Boolean(missed) && !read(LOG).includes("bbbb2222"), "2) 그 Claude Code 가 낳은 별도 실행의 훅은 넘기지 않고 까닭을 남김");
  ok(alive(feedPid) && existsSync(SOCK), "2) 별도 실행이 끝나도 연결부는 그대로");

  // 3) 브리지가 꺼진 연결부를 되살림(브리지 tmux 는 시험 서버를 보는 감싸기 스크립트로)
  const { createFeedReviver } = await import("../../server/feed-revive.mjs");
  const WRAP = `${ROOT}/bin/tmux-iso`;
  writeFileSync(WRAP, `#!/bin/sh\nexec ${TMUX} -S ${tm("display", "-p", "#{socket_path}")} "$@"\n`, { mode: 0o755 });
  const opts = { tmuxBin: WRAP, feedScript: FEED, node: process.execPath, env: { ...env, PI_REMOTE_TOKEN: "secret-for-test" } };
  const revive = createFeedReviver(opts);
  ok(!(await revive(filler)), "3) Claude Code 가 아닌 칸에는 띄우지 않음");
  await ensureFeed();
  ok(!(await revive(pane)) && pids().length === 1, "3) 연결부가 돌고 있으면 띄우지 않음");
  process.kill(feedPid, "SIGKILL");
  await waitFor(() => !alive(feedPid), 3000);
  const logs = [];
  const revive2 = createFeedReviver({ ...opts, log: (m) => logs.push(m) });
  ok(await revive2(pane), `3) 연결부가 흔적 없이 꺼진 Claude Code 칸에는 띄움(${logs[0] ?? ""})`);
  const np = await waitFor(() => pids()[0], 5000);
  const snap = await waitFor(() => np && alive(np), 3000) ? await (async () => { for (let i = 0; i < 20; i++) { const s = await snapshot(); if (s) return s; await sleep(400); } return null; })() : null;
  ok(snap?.t === "snapshot" && snap?.agent === "claude", "3) 다시 뜬 연결부가 대화 화면 자료를 냄");
  const penv = np ? execFileSync("ps", ["eww", "-o", "command=", "-p", String(np)], { encoding: "utf8" }) : "";
  ok(penv.includes(`HOME=${HOME}`) && !penv.includes("secret-for-test"), "3) 브리지 설정의 비밀값은 연결부에 넘기지 않음");
  ok(!(await revive2(pane)), "3) 띄운 뒤 곧바로는 다시 띄우지 않음");
  feedPid = np;

  // 3) 실제 브리지: 연결부를 흔적 없이 끈 뒤 폰처럼 그 탭을 보면 브리지가 띄워 채팅 자료가 옴
  const SERVER = join(HERE, "..", "..", "server"), PORT = 8784, TOKEN = "f".repeat(64);
  mkdirSync(`${HOME}/.claude/pi-remote`, { recursive: true });
  symlinkSync(FEED, `${HOME}/.claude/pi-remote/claude-feed.mjs`);   // 브리지가 띄우는 설치본 자리
  process.kill(feedPid, "SIGKILL");
  await waitFor(() => !alive(feedPid), 3000);
  tm("select-window", "-t", pane);
  bridge = spawn(process.execPath, ["bridge.mjs"], {
    cwd: SERVER,
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, TMUX_TMPDIR: env.TMUX_TMPDIR, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`,
      PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT), PI_TMUX_SESSION: "alive", PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`,
      PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`, PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let blog = "";
  bridge.stdout.on("data", (d) => (blog += d));
  bridge.stderr.on("data", (d) => (blog += d));
  await waitFor(() => /브리지 시작|listening|:8784/.test(blog), 10_000);
  const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
  const chats = [];
  let ws = null;
  for (let i = 0; i < 20 && !ws; i++) {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
    ws = await new Promise((res) => { w.on("open", () => res(w)); w.on("error", () => res(null)); });
    if (!ws) await sleep(500);
  }
  ws?.on("message", (data, bin) => { if (!bin) try { const m = JSON.parse(String(data)); if (m.type === "chat") chats.push(m.d); } catch { /* 다른 글 */ } });
  const got = await waitFor(() => chats.find((d) => d?.t === "snapshot" && d.agent === "claude"), 25_000, 500);
  ok(Boolean(ws) && Boolean(got) && pids().length === 1, `3) 실제 브리지: 연결부가 꺼진 탭을 폰이 보면 브리지가 띄워 채팅 자료가 옴(받은 것: ${chats.map((d) => d?.t).join(",")})`);
  ok(/Claude Code 탭에 연결부가 없어 띄움/.test(blog), "3) 브리지 기록에 띄운 까닭을 남김");
  ws?.close();
  bridge.kill();
  feedPid = pids()[0] ?? 0;

  // 4) 칸이 정말 사라짐
  await ensureFeed();
  const last = feedPid;
  tm("kill-pane", "-t", pane);
  const ended = await waitFor(() => !alive(last), 50_000, 1000);
  ok(ended, "4) 칸이 사라지면 연결부는 끝남");
  ok(/연결부를 끝냄: .*Claude Code 가 없음/.test(read(LOG)), "4) 끝난 까닭을 기록에 남김");
} finally {
  bridge?.kill();
  for (const p of pids()) try { process.kill(p, "SIGTERM"); } catch { /* 이미 끝남 */ }
  tm("kill-server");
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
