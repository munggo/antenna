// 연결부(claude-feed.mjs)가 새 판으로 스스로 바뀌는지 시험: 설치된 파일이 바뀌면 쉬는 틈에 새 연결부에 자리를 넘긴다.
// 진짜 Claude Code 는 띄우지 않는다: 시험 tmux 세션의 칸에 'claude' 라는 이름의 쉬는 프로그램을 두고, 연결부 사본을 가짜 홈으로 돌린다
// (소켓·판 파일이 가짜 홈에 생겨 쓰는 브리지와 섞이지 않음). 쓰는 세션 antenna 는 건드리지 않는다.
// 쓰기: node rev-handover-e2e.mjs [세션=revtest]   (세션은 시험이 만들고 지움)
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION = process.argv[2] ?? "revtest";
if (SESSION === "antenna") { console.error("쓰는 세션(antenna)에서는 돌리지 않아요"); process.exit(2); }
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = `/tmp/rev-e2e-${process.pid}`;
const HOME = `${ROOT}/home`, INSTALL = `${ROOT}/install`, FEED = `${INSTALL}/claude-feed.mjs`;
const FILES = ["claude-feed.mjs", "claude-account.mjs", "bg-launch.mjs"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

mkdirSync(HOME, { recursive: true });
mkdirSync(INSTALL, { recursive: true });
for (const f of FILES) copyFileSync(join(SRC, f), join(INSTALL, f));
// 칸의 프로그램 이름이 claude 여야 연결부가 '끝났다'고 보지 않는다 → 그 이름으로 쉬기만 하는 작은 프로그램을 만든다
// (시스템의 sleep 을 복사한 것은 실행이 막힘)
writeFileSync(`${ROOT}/claude.c`, "#include <unistd.h>\nint main(void) { sleep(900); return 0; }\n");
execFileSync("cc", ["-o", `${ROOT}/claude`, `${ROOT}/claude.c`]);
try { tm("kill-session", "-t", SESSION); } catch { /* 없음 */ }
tm("new-session", "-d", "-s", SESSION, "-x", "80", "-y", "24", `${ROOT}/claude`);
await sleep(500);
const pane = tm("display", "-p", "-t", `${SESSION}:0`, "#{pane_id}");
if (tm("display", "-p", "-t", pane, "#{pane_current_command}") !== "claude") throw new Error("시험 칸의 프로그램 이름이 claude 가 아니에요");
const key = pane.replace(/\W/g, "");
const SOCK = `${HOME}/.cache/pi-remote/feed/${key}.sock`, REV = `${HOME}/.cache/pi-remote/feed/${key}.rev`;
const { codeRev } = await import(join(SRC, "claude-feed.mjs"));
const pids = () => {
  try {
    return execFileSync("pgrep", ["-f", `claude-feed\\.mjs ${pane}$`], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
};
const revFile = () => (existsSync(REV) ? readFileSync(REV, "utf8").trim() : "(없음)");
/** 소켓에 붙어 첫 화면(스냅샷)을 받고, 줄 것이 있으면 보낸 뒤 끊음 */
const talk = (send) => new Promise((res) => {
  const c = createConnection(SOCK);
  let buf = "";
  const done = (v) => { c.destroy(); res(v); };
  c.on("error", () => done(null));
  c.setEncoding("utf8");
  c.on("data", (d) => {
    buf += d;
    const i = buf.indexOf("\n");
    if (i < 0) return;
    let snap = null;
    try { snap = JSON.parse(buf.slice(0, i)); } catch { /* 깨진 줄 */ }
    if (send) c.write(`${JSON.stringify(send)}\n`, () => setTimeout(() => done(snap), 150));
    else done(snap);
  });
  setTimeout(() => done(null), 3000);
});
const hook = (name, extra = {}) => talk({ cmd: "hook", event: { hook_event_name: name, session_id: "rev-test", ...extra } });
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 250) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
const start = () => {
  const env = { ...process.env, HOME, PI_REMOTE_REV_TICK_SEC: "1", PI_REMOTE_REV_IDLE_SEC: "2", PI_REMOTE_ACCOUNT_TICK_SEC: "3600" };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  spawn(process.execPath, [FEED, pane], { detached: true, stdio: "ignore", env }).unref();
};

try {
  if (pids().length) throw new Error(`이 칸(${pane})에 이미 연결부가 돌고 있어요`);
  start();
  ok(await waitFor(() => existsSync(SOCK), 5000), "연결부가 떠서 소켓을 엶");
  const rev1 = codeRev(INSTALL);
  const pid1 = pids()[0];
  let snap = await talk();
  ok(pids().length === 1 && revFile() === rev1 && snap?.rev === rev1 && /^[0-9a-f]{8}$/.test(rev1), `도는 판을 파일과 첫 화면에 적음 → ${revFile()} / ${snap?.rev}`);

  // 1. 파일이 그대로면 바꾸지 않음
  await sleep(5000);
  ok(pids().join() === String(pid1), "파일이 그대로면 그대로 돎");

  // 2. 작업 중에는 파일이 바뀌어도 바꾸지 않음
  await hook("UserPromptSubmit", { prompt: "작업 시작" });
  snap = await talk();
  ok(snap?.working === true, "작업 중 상태로 만듦");
  appendFileSync(FEED, "\n// 판 바꿈 1\n");
  const rev2 = codeRev(INSTALL);
  ok(rev2 !== rev1, `파일을 고치면 판 값이 바뀜(${rev1} → ${rev2})`);
  await sleep(6000);
  ok(pids().join() === String(pid1) && revFile() === rev1, "작업 중에는 옛 판 그대로(끼어들지 않음)");

  // 3. 작업이 끝나고 조용해지면 새 판으로 넘어감
  await hook("Stop");
  const swapped = await waitFor(() => pids().length === 1 && pids()[0] !== pid1 && revFile() === rev2, 15000);
  ok(swapped, `작업이 끝나고 쉬면 새 연결부로 바뀜(프로세스 ${pid1} → ${pids().join()}, 판 ${revFile()})`);
  snap = await waitFor(() => talk(), 5000);
  ok(snap?.rev === rev2 && snap?.working === false, `새 연결부가 소켓을 다시 열고 새 판을 알림 → ${snap?.rev}`);
  ok(pids().length === 1, `연결부는 하나만 돎(${pids().length}개)`);
  const pid2 = pids()[0];

  // 4. 깨진 파일로 바뀌면 새 연결부가 뜨지 못함 → 지금 것이 계속 맡음
  const good = readFileSync(FEED, "utf8");
  writeFileSync(FEED, "이것은 자바스크립트가 아님 (\n");
  await sleep(7000);
  snap = await talk();
  ok(pids().join() === String(pid2) && snap?.rev === rev2, "깨진 파일이면 넘기지 않고 지금 연결부가 계속 맡음");
  writeFileSync(FEED, good);

  // 5. 끄면 판 파일도 치움
  process.kill(pid2, "SIGTERM");
  await sleep(800);
  ok(!existsSync(REV) && !existsSync(SOCK) && pids().length === 0, "끄면 소켓과 판 파일을 치움");
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  for (const p of pids()) { try { process.kill(p, "SIGTERM"); } catch { /* 이미 끝남 */ } }
  try { tm("kill-session", "-t", SESSION); } catch { /* 이미 없음 */ }
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
