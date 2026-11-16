// 앱 서랍의 '백그라운드' 칸이 쓰는 것을 실제 tmux·시험 브리지로 시험:
// - 실행기(bg-launch.mjs)가 연 백그라운드 탭에 시킨 칸(@bg_from)·시작(@bg_started)이 적히는지
// - 브리지가 보내는 탭 목록에 백그라운드 정보(시킨 쪽·시작·끝·시킨 탭)와 뒤에서 도는 일이 실리는지
// - '끝난 것 모두 닫기'(close-finished-bg)가 끝나고 쉬는 백그라운드 탭만 닫는지
// 시험 세션(bgdrawertest)·포트 8797·가짜 홈을 만들고 끝나면 지운다. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/bg-drawer.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "bgdrawertest", PORT = 8797, ROOT = `/tmp/antenna-bgdrawer-${process.pid}`, HOME = `${ROOT}/home`, TOKEN = "e".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const now = Math.floor(Date.now() / 1000);
/** 시험 세션에 셸 탭을 열고 탭 옵션을 적음 → { index, pane } */
const open = (name, opts = {}) => {
  const [index, pane] = tm("new-window", "-d", "-P", "-F", "#{window_index} #{pane_id}", "-t", `${S}:`, "-n", name, "-c", "/tmp").split(" ");
  for (const [k, v] of Object.entries(opts)) tm("set-option", "-w", "-t", pane, k, String(v));
  return { index: Number(index), pane };
};

mkdirSync(HOME, { recursive: true });
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp", "-n", "시킨탭");
const origin = { index: 0, pane: tm("display", "-p", "-t", `${S}:0`, "#{pane_id}") };
let bridge = null;
try {
  // 1) 실행기로 연 백그라운드 탭: 할 일 대신 바로 끝나는 명령(true)을 켬
  process.env.PI_BG_PI_CMD = "true";
  const { launchBackground } = await import(new URL("../../claude-remote/bg-launch.mjs", import.meta.url).pathname);
  const launched = launchBackground({ agent: "pi", cwd: "/tmp", task: "서랍 시험용 할 일", originPane: origin.pane, by: "user" });
  const opt = (k) => tm("show-options", "-w", "-v", "-t", launched.pane, k) ?? "";
  ok(launched.session === S && launched.name === "bg 서랍 시험용 할 일", `실행기가 시킨 탭의 세션에 'bg …' 탭을 엶 → ${launched.session}:${launched.window} ${launched.name}`);
  ok(opt("@bg_from") === origin.pane && opt("@bg_origin") === origin.pane, "시킨 칸이 @bg_from(남는 것)·@bg_origin(보고 뒤 지우는 것) 둘 다에 적힘");
  ok(Math.abs(Number(opt("@bg_started")) - now) < 30 && opt("@bg_by") === "user", "시작 시각·시킨 쪽");

  // 2) 서랍에 보일 여러 경우를 탭 옵션으로 만듦(연결부가 적는 값과 같은 모양)
  const working = open("bg 일하는 중", { "@bg_by": "user", "@bg_from": origin.pane, "@bg_started": now - 720, "@pi_status": "working" });
  const done = open("bg 끝난 것", { "@bg_by": "ai", "@bg_from": origin.pane, "@bg_started": now - 7200, "@bg_done": now - 3600, "@pi_status": "yourturn" });
  const doneJobs = open("bg 끝났지만 셸", { "@bg_by": "phone", "@bg_from": origin.pane, "@bg_started": now - 600, "@bg_done": now - 60, "@ai_jobs": "셸 1개" });
  const asking = open("bg 다시 묻는 중", { "@bg_by": "user", "@bg_from": origin.pane, "@bg_started": now - 600, "@bg_done": now - 100, "@pi_status": "asking" });
  const plain = open("보통탭", { "@ai_jobs": "셸 2개" });

  bridge = spawn(process.execPath, ["bridge.mjs"], {
    cwd: SERVER,
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
      PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
      PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  bridge.stdout.on("data", (d) => (log += d));
  bridge.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 40 && !/브리지 시작/.test(log); i++) await sleep(250);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let wins = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "windows") wins = m.windows;
    } catch { /* 줄 단위가 아닌 글 */ }
  });
  const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { if (fn()) return true; await sleep(200); } return false; };
  const at = (i) => wins.find((w) => w.index === i);

  // 3) 앱이 받는 탭 목록
  ok(await waitFor(() => wins.length >= 7, 8000), `탭 목록이 옴(${wins.length}개)`);
  ok(at(0)?.bg === null && at(0)?.jobs === "", "시킨 탭(보통 탭): 백그라운드 정보 없음");
  const lb = at(launched.window)?.bg;
  ok(lb?.by === "user" && lb?.from === 0 && lb?.fromName === "시킨탭" && lb?.done === 0, `실행기로 연 탭: 시킨 탭 번호·이름 → ${JSON.stringify(lb)}`);
  const wb = at(working.index);
  ok(wb?.status === "working" && wb?.bg?.started === now - 720 && wb?.bg?.fromName === "시킨탭", "일하는 백그라운드 탭: 상태·시작 시각·시킨 탭");
  ok(at(done.index)?.bg?.by === "ai" && at(done.index)?.bg?.done === now - 3600, "끝난 백그라운드 탭: 시킨 쪽(AI)·끝난 때");
  ok(at(doneJobs.index)?.jobs === "셸 1개" && at(plain.index)?.jobs === "셸 2개" && at(plain.index)?.bg === null, "뒤에서 도는 일(백그라운드 탭·보통 탭 모두)");
  ok(wins.every((w) => !("id" in w)), "창 고유 번호는 앱에 보내지 않음");

  // 4) 끝난 것 모두 닫기: 끝나고 쉬는 탭(bg 끝난 것)만 닫힘
  const before = wins.map((w) => w.index);
  ws.send(JSON.stringify({ type: "close-finished-bg" }));
  ok(await waitFor(() => !at(done.index), 5000), "끝나고 쉬는 백그라운드 탭이 닫힘");
  await sleep(600);
  const left = wins.map((w) => w.index);
  const kept = [0, launched.window, working.index, doneJobs.index, asking.index, plain.index];
  ok(kept.every((i) => left.includes(i)) && left.length === before.length - 1,
    `나머지는 그대로: 시킨 탭·아직 안 끝난 탭·일하는 탭·뒤에서 도는 일이 있는 탭·다시 묻는 탭·보통 탭(${left.join(",")})`);
  ok(/끝난 백그라운드 탭 1개 닫음/.test(log), "브리지 기록에 닫은 수");
  // 5) 닫을 것이 없으면 아무것도 닫지 않음
  ws.send(JSON.stringify({ type: "close-finished-bg" }));
  await sleep(1500);
  ok(wins.length === left.length, `한 번 더 눌러도 더 닫히지 않음(${wins.length}개)`);
  ws.close();
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  bridge?.kill("SIGTERM");
  await sleep(500);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
