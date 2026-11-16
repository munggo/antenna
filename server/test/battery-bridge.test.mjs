// 맥북 배터리를 실제 tmux·시험 브리지로 시험:
// - 앱이 받는 탭 목록 메시지에 배터리(잔량·충전기·낮음)가 얹혀 오고, 값이 바뀌면 다시 오는지. 배터리가 없는 맥이면 얹지 않는지
// - 충전기 없이 20% 아래로 내려가면 폰 알림 한 번: 맥을 쓰는 중이면 미루고, 쓰지 않게 되면 보냄. 더 내려가도 다시 보내지 않고,
//   충전기를 꽂았다 빼서 다시 낮아지면 또 한 번
// 시험 세션(battest)·포트 8790·가짜 홈을 만들고 끝나면 지운다. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/battery-bridge.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "battest", PORT = 8790, ROOT = `/tmp/antenna-battery-${process.pid}`, HOME = `${ROOT}/home`, TOKEN = "b".repeat(64);
const BAT = `${ROOT}/batt`, IDLE = `${ROOT}/idle`, LOCKED = `${ROOT}/locked`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const power = (source, pct, state) => writeFileSync(BAT, `Now drawing from '${source}'\n -InternalBattery-0 (id=1234567)\t${pct}%; ${state}; 1:00 remaining present: true\n`);

mkdirSync(HOME, { recursive: true });
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
power("Battery Power", 94, "discharging");
writeFileSync(LOCKED, "0");   // 맥을 쓰는 중: 안 잠김, 5초 전에 만짐
writeFileSync(IDLE, "5");
let bridge = null;
try {
  bridge = spawn(process.execPath, ["bridge.mjs"], {
    cwd: SERVER,
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
      PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
      PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log`,
      PI_REMOTE_FAKE_BATTERY_FILE: BAT, PI_REMOTE_BATTERY_SEC: "1", PI_REMOTE_FAKE_IDLE_FILE: IDLE, PI_REMOTE_FAKE_LOCKED_FILE: LOCKED },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  bridge.stdout.on("data", (d) => (log += d));
  bridge.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 40 && !/브리지 시작/.test(log); i++) await sleep(250);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let bat;          // 마지막 탭 목록 메시지의 배터리(칸이 없으면 null, 아직 못 받았으면 undefined)
  let lists = 0;
  let unknown = 0;  // 탭 목록·상태 말고 처음 보는 종류의 메시지(예전 앱은 이런 글을 터미널 화면에 그림)
  const KNOWN = new Set(["windows", "pistatus", "models", "push-status", "usage", "chat", "sessions"]);
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "windows") { bat = m.battery ?? null; lists++; }
      else if (!KNOWN.has(m.type)) unknown++;
    } catch { /* 줄 단위가 아닌 글 */ }
  });
  const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { if (fn()) return true; await sleep(200); } return false; };
  const same = (want) => JSON.stringify(bat) === JSON.stringify(want);
  const alerts = () => (log.match(/알림\(시험·안 보냄\) battery/g) ?? []).length;

  // 1) 탭 목록 메시지에 얹혀 옴
  ok(await waitFor(() => same({ percent: 94, plugged: false, low: false }), 8000), `탭 목록에 배터리가 얹혀 옴 → ${JSON.stringify(bat)}`);
  // 2) 값이 바뀌면(탭은 그대로여도) 다시 옴
  const before = lists;
  power("AC Power", 45, "charging");
  ok(await waitFor(() => same({ percent: 45, plugged: true, low: false }), 6000) && lists > before, `충전기를 꽂으면 다시 옴 → ${JSON.stringify(bat)}`);
  // 3) 낮음: 맥을 쓰는 중이면 화면에는 낮음으로 보이지만 폰 알림은 미룸
  power("Battery Power", 18, "discharging");
  ok(await waitFor(() => same({ percent: 18, plugged: false, low: true }), 6000), `충전기 없이 18% → 낮음 → ${JSON.stringify(bat)}`);
  await sleep(2500);
  ok(alerts() === 0, `맥을 쓰는 중이면 알림을 미룸(${alerts()}번)`);
  // 4) 맥을 쓰지 않게 되면(잠김) 다음 확인 때 한 번
  writeFileSync(LOCKED, "1");
  ok(await waitFor(() => alerts() === 1, 6000) && /battery 탭 \S+ · 맥 배터리 18%/.test(log), `맥이 잠기면 알림 한 번, 제목에 잔량(${alerts()}번)`);
  // 5) 더 내려가도 다시 보내지 않음
  power("Battery Power", 15, "discharging");
  ok(await waitFor(() => same({ percent: 15, plugged: false, low: true }), 6000), "15% 로 내려감");
  await sleep(2500);
  ok(alerts() === 1, `더 내려가도 다시 보내지 않음(${alerts()}번)`);
  // 6) 충전기를 꽂았다 빼서 다시 낮아지면 또 한 번
  power("AC Power", 16, "charging");
  ok(await waitFor(() => same({ percent: 16, plugged: true, low: false }), 6000), "충전기를 꽂으면 낮음이 풀림");
  await sleep(1500);
  power("Battery Power", 14, "discharging");
  ok(await waitFor(() => alerts() === 2, 6000) && /맥 배터리 14%/.test(log), `다시 낮아지면 또 한 번(${alerts()}번)`);
  // 7) 기준 위로 올라갔다가 다시 내려가도 또 한 번(충전기를 꽂지 않고 값만 오르내린 경우)
  power("Battery Power", 30, "discharging");
  ok(await waitFor(() => same({ percent: 30, plugged: false, low: false }), 6000), "30% 는 낮음이 아님");
  await sleep(1500);
  power("Battery Power", 19, "discharging");
  ok(await waitFor(() => alerts() === 3, 6000), `기준 위로 갔다가 다시 내려오면 또 한 번(${alerts()}번)`);
  // 8) 배터리가 없는 맥: 얹지 않음
  writeFileSync(BAT, "Now drawing from 'AC Power'\n");
  ok(await waitFor(() => bat === null, 6000), "배터리가 없으면 탭 목록에 얹지 않음");
  ok(unknown === 0, `새 종류의 메시지를 만들지 않음(예전 앱이 터미널 화면에 글자로 그리지 않게, ${unknown}개)`);
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
