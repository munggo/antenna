// pi 가 깔려 있지 않은 맥에서도 브리지가 뜨고 기본 기능이 되는지 시험(Claude Code 만 쓰는 사람)
// 가짜 홈(pi 로그인·대화 폴더 없음), 없는 pi 경로로 브리지를 따로 띄운다. 시험 세션(nopitest)·포트 8795 를 만들고 끝나면 지움.
// 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다. 실행: node server/test/no-pi.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "nopitest", PORT = 8795, ROOT = `/tmp/antenna-nopi-${process.pid}`, HOME = `${ROOT}/home`, TOKEN = "d".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

mkdirSync(HOME, { recursive: true });
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: SERVER,
  env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
    PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
    PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log` },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
let exited = null;
bridge.stdout.on("data", (d) => (log += d));
bridge.stderr.on("data", (d) => (log += d));
bridge.on("exit", (code) => (exited = code));
try {
  for (let i = 0; i < 40 && !/브리지 시작/.test(log) && exited === null; i++) await sleep(250);
  ok(/브리지 시작/.test(log) && exited === null, `pi 없이도 브리지가 뜸${exited !== null ? ` (끝 코드 ${exited})\n${log.slice(-400)}` : ""}`);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const got = {};
  let screen = "";
  ws.on("message", (data, isBinary) => {
    if (isBinary) { screen += data.toString("utf8"); return; }
    try {
      const m = JSON.parse(data.toString());
      got[m.type] = m;
    } catch { /* 줄 단위가 아닌 글 */ }
  });
  const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { if (fn()) return true; await sleep(200); } return false; };

  ok(await waitFor(() => got.windows?.windows?.length >= 1, 5000), `탭 목록이 옴(${got.windows?.windows?.length ?? 0}개)`);
  // 터미널: 친 글이 맥 셸에 들어가고 그 출력이 돌아옴
  await sleep(1500);
  ws.send(Buffer.from("echo bridge-$((40+2))-ok\r"));
  ok(await waitFor(() => screen.includes("bridge-42-ok"), 6000), "터미널 입출력이 오감");
  ws.send(JSON.stringify({ type: "sessions" }));
  ok(await waitFor(() => got.sessions, 25000) && Array.isArray(got.sessions.items) && got.sessions.items.length === 0 && !got.sessions.error, `지난 대화: 오류 없이 빈 목록 → ${got.sessions?.error ?? "오류 글 없음"}`);
  ws.send(JSON.stringify({ type: "usage", force: true }));
  ok(await waitFor(() => got.usage, 8000) && typeof got.usage.error === "string" && got.usage.error.includes("Claude Code"), `사용량: 값이 없다고 안내(pi 를 쓰라고만 하지 않음) → ${got.usage?.error}`);
  ws.send(JSON.stringify({ type: "new-window" }));
  ok(await waitFor(() => got.windows?.windows?.length >= 2, 5000), `새 탭을 열 수 있음(${got.windows?.windows?.length ?? 0}개)`);
  await sleep(500);
  ok(exited === null && !existsSync(`${ROOT}/crash.log`), "브리지가 계속 살아 있고 죽은 기록이 없음");
  ok(/모델 목록 조회 실패/.test(log) || !/모델 \d+개 로드/.test(log), "pi 모델 목록은 없는 채로 넘어감");
  ws.close();
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  bridge.kill("SIGTERM");
  await sleep(500);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
