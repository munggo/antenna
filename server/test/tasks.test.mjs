// 단축어로 시킨 일(앱의 단축어 동작 '맥의 AI 에게 일 시키기') 시험:
// 1) 요청 판정(server/tasks.mjs): 폴더 풀기, 도구·폴더·빈 글 거절, 같은 요청 번호는 한 번만 실행
// 2) 실제 tmux·시험 브리지: 폰처럼 짧은 접속('/push')으로 보내면 새 백그라운드 탭이 그 폴더에서 열리고(시킨 쪽 shortcut) 답이 옴,
//    같은 요청을 다시 보내도 탭은 하나, 없는 폴더·토큰 없는 접속은 탭을 열지 않음, 앱이 받는 탭 목록에 시킨 쪽이 실림,
//    시킨 칸이 없어도 끝나기 전까지는 백그라운드 일로 봄(끝나면 폰 알림을 보내려고. bg-launch.mjs 의 bgInfo)
// 시험 세션(shortcuttest)·포트 8788·가짜 홈을 만들고 끝나면 지운다. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/tasks.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const { createTaskStarter, resolveFolder } = await import(join(SERVER, "tasks.mjs"));
const S = "shortcuttest", PORT = 8788, ROOT = `/tmp/antenna-shortcut-${process.pid}`, HOME = `${ROOT}/home`, TOKEN = "d".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 200) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

mkdirSync(`${HOME}/works/game`, { recursive: true });
writeFileSync(`${HOME}/notes.txt`, "폴더가 아닌 것");

// ── 1) 요청 판정 ──
ok(resolveFolder("", HOME) === HOME && resolveFolder(undefined, HOME) === HOME && resolveFolder(" ~ ", HOME) === HOME, "폴더: 비우거나 '~' 면 홈 폴더");
ok(resolveFolder("~/works/game", HOME) === `${HOME}/works/game` && resolveFolder("works/game", HOME) === `${HOME}/works/game`, "폴더: '~/…'와 상대 경로는 홈 폴더 아래");
ok(resolveFolder("/tmp/x/../y", HOME) === "/tmp/y" && resolveFolder("  /tmp  ", HOME) === "/tmp", "폴더: 절대 경로는 그대로(앞뒤 공백·'..' 정리)");

const calls = [];
let clock = 1_000_000;
let boom = false;
const start = createTaskStarter({
  launch: (o) => { if (boom) throw new Error("tmux 가 없어요"); calls.push(o); return { window: 7 + calls.length, pane: "%9", name: "bg 시험", session: o.session }; },
  home: HOME, session: "세션", now: () => clock,
});
const id = (n) => `req-0000-${String(n).padStart(4, "0")}`;
const r1 = start({ type: "task-start", id: id(1), text: "  빌드 고치기  ", agent: "claude", cwd: "~/works/game" });
ok(r1.type === "task-started" && r1.id === id(1) && r1.window === 8 && r1.name === "bg 시험", `시작: 탭 번호·이름을 답함(${JSON.stringify(r1)})`);
ok(calls.length === 1 && calls[0].agent === "claude" && calls[0].cwd === `${HOME}/works/game` && calls[0].task === "빌드 고치기"
  && calls[0].by === "shortcut" && calls[0].originPane === "" && calls[0].session === "세션", "시작: 도구·폴더·할 일(앞뒤 공백 뺌)·시킨 쪽 shortcut·시킨 칸 없음");
const r1b = start({ type: "task-start", id: id(1), text: "빌드 고치기", agent: "claude", cwd: "~/works/game" });
ok(calls.length === 1 && JSON.stringify(r1b) === JSON.stringify(r1), "같은 요청 번호는 한 번만 실행하고 같은 답(주소 후보마다 보내도 탭은 하나)");
start({ id: id(2), text: "기본값" });
ok(calls.length === 2 && calls[1].agent === "claude" && calls[1].cwd === HOME, "도구를 적지 않으면 Claude Code, 폴더를 적지 않으면 홈 폴더");
start({ id: id(6), text: "pi 에게", agent: "pi", cwd: "works/game" });
ok(calls.length === 3 && calls[2].agent === "pi" && calls[2].cwd === `${HOME}/works/game`, "pi 에게도 시킬 수 있음");
const fails = [
  [{ id: id(3), text: "   " }, "empty", "빈 글"],
  [{ id: id(4), text: 123 }, "empty", "글이 아닌 값"],
  [{ id: id(5), text: "일", agent: "gpt" }, "agent", "모르는 도구"],
  [{ id: id(7), text: "일", cwd: "~/없는폴더" }, "folder", "없는 폴더"],
  [{ id: id(8), text: "일", cwd: "~/notes.txt" }, "folder", "폴더가 아닌 파일"],
  [{ text: "일" }, "bad-request", "요청 번호 없음"],
  [{ id: "짧음", text: "일" }, "bad-request", "요청 번호가 잘못됨"],
];
for (const [m, reason, name] of fails) {
  const r = start(m);
  ok(r.type === "task-failed" && r.reason === reason && typeof r.message === "string" && r.message.length > 0, `거절: ${name} → ${r.message}`);
}
ok(calls.length === 3, "거절한 요청은 탭을 열지 않음");
ok(start({ id: id(7), text: "일", cwd: "~/works/game" }).reason === "folder" && calls.length === 3, "거절한 요청 번호도 기억(같은 번호를 다시 보내면 같은 답)");
boom = true;
const rb = start({ id: id(9), text: "일" });
ok(rb.type === "task-failed" && rb.reason === "launch" && /tmux 가 없어요/.test(rb.message), `탭을 못 열면 그 까닭을 답함(${rb.message})`);
boom = false;
clock += 5 * 60_000 + 1;
start({ id: id(1), text: "빌드 고치기" });
ok(calls.length === 4, "5분이 지난 요청 번호는 잊음(다시 보내면 새로 실행)");
const long = start({ id: id(10), text: "가".repeat(120_000) });
ok(long.type === "task-started" && calls[4].task.length === 100_000, "아주 긴 글은 10만 자까지만");

// ── 2) 실제 tmux·시험 브리지 ──
if (!tm("-V")) {
  console.log("건너뜀: tmux 가 없어 브리지 시험은 하지 않음");
  rmSync(ROOT, { recursive: true, force: true });
  console.log(fail ? `실패 ${fail}개` : "모두 통과");
  process.exit(fail ? 1 : 0);
}
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp", "-n", "보통탭");
let bridge = null;
/** 폰처럼 짧은 접속으로 요청 하나를 보내고 답(또는 닫힌 번호)을 받음 */
const ask = (body, token = TOKEN) => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/push`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const done = (v) => { res(v); try { ws.close(); } catch { /* 이미 닫힘 */ } };
  ws.on("open", () => ws.send(JSON.stringify(body)));
  ws.on("message", (d) => { try { done(JSON.parse(String(d))); } catch { /* 다른 글 */ } });
  ws.on("close", (code) => done({ closed: code }));
  ws.on("error", () => done({ closed: -1 }));
  setTimeout(() => done({ closed: "timeout" }), 6000);
});
const winCount = () => (tm("list-windows", "-t", `=${S}`, "-F", "#{window_index}") ?? "").split("\n").filter(Boolean).length;
try {
  bridge = spawn(process.execPath, ["bridge.mjs"], {
    cwd: SERVER,
    // PI_BG_*_CMD: 새 탭에서 진짜 도구 대신 바로 끝나는 명령을 켬(모델을 부르지 않음)
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
      PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
      PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log`,
      PI_BG_CLAUDE_CMD: "true", PI_BG_PI_CMD: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  bridge.stdout.on("data", (d) => (log += d));
  bridge.stderr.on("data", (d) => (log += d));
  ok(Boolean(await waitFor(() => /브리지 시작/.test(log), 10_000, 250)), "시험 브리지가 뜸");

  const before = winCount();
  const a = await ask({ type: "task-start", id: id(101), text: "게임 빌드가 깨졌는지 확인하고 고쳐 줘", agent: "claude", cwd: "~/works/game" });
  ok(a.type === "task-started" && a.id === id(101) && Number.isInteger(a.window) && /^bg 게임 빌드가/.test(a.name ?? ""), `시작했다는 답(${JSON.stringify(a)})`);
  ok(winCount() === before + 1, `새 탭이 하나 열림(${before} → ${winCount()})`);
  const pane = tm("display", "-p", "-t", `${S}:${a.window}`, "#{pane_id}");
  const opt = (k) => tm("show-options", "-w", "-v", "-t", pane, k) ?? "";
  ok(opt("@bg_by") === "shortcut" && opt("@bg_origin") === "" && Number(opt("@bg_started")) > 0, `시킨 쪽 shortcut, 시킨 칸 없음, 시작 시각(${opt("@bg_by")})`);
  const folder = await waitFor(() => { const p = tm("display", "-p", "-t", pane, "#{pane_current_path}"); return p && existsSync(p) ? realpathSync(p) : ""; }, 4000);
  ok(folder === realpathSync(`${HOME}/works/game`), `그 폴더에서 시작(${folder})`);
  ok(/단축어로 시킨 일: 탭 \d+/.test(log), "브리지 기록에 남음");

  const again = await ask({ type: "task-start", id: id(101), text: "게임 빌드가 깨졌는지 확인하고 고쳐 줘", agent: "claude", cwd: "~/works/game" });
  ok(JSON.stringify(again) === JSON.stringify(a) && winCount() === before + 1, "같은 요청을 다른 접속으로 다시 보내도 탭은 하나, 같은 답");

  const bad = await ask({ type: "task-start", id: id(102), text: "일", cwd: "~/없는폴더" });
  ok(bad.type === "task-failed" && bad.reason === "folder" && winCount() === before + 1, `없는 폴더는 거절하고 탭을 열지 않음(${bad.message})`);
  const anon = await ask({ type: "task-start", id: id(104), text: "일" }, "");
  ok(anon.closed === 4001 && winCount() === before + 1, `토큰 없는 접속은 닫고 탭을 열지 않음(${JSON.stringify(anon)})`);
  const wrong = await ask({ type: "task-start", id: id(105), text: "일" }, "0".repeat(64));
  ok(wrong.closed === 4001 && winCount() === before + 1, "틀린 토큰도 닫음");

  // 앱이 받는 탭 목록: 서랍의 '백그라운드' 칸에 '단축어로 시킴'으로 보이게 시킨 쪽이 실림(시킨 탭은 없음)
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?cols=100&rows=30`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  let wins = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try { const m = JSON.parse(data.toString()); if (m.type === "windows") wins = m.windows; } catch { /* 줄 단위가 아닌 글 */ }
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const row = await waitFor(() => wins.find((w) => w.index === a.window), 8000);
  ok(row?.bg?.by === "shortcut" && row.bg.from === null && row.bg.fromName === "" && row.bg.done === 0 && row.bg.started > 0, `탭 목록에 시킨 쪽(${JSON.stringify(row?.bg)})`);
  ws.close();

  // 끝남 알림을 위한 판정: 시킨 칸이 없어도 끝난 때를 적기 전까지는 백그라운드 일
  const { bgInfo } = await import(join(SERVER, "..", "claude-remote", "bg-launch.mjs"));
  const info = bgInfo(pane);
  ok(info?.by === "shortcut" && info.origin === "" && /^bg 게임 빌드가/.test(info.name), `시킨 칸이 없어도 백그라운드 일로 봄(${JSON.stringify(info)})`);
  tm("set-option", "-w", "-t", pane, "@bg_done", String(Math.floor(Date.now() / 1000)));
  ok(bgInfo(pane) === null, "끝난 때를 적은 뒤에는 다시 알리지 않음");
  const plain = tm("display", "-p", "-t", `${S}:0`, "#{pane_id}");
  tm("set-option", "-w", "-t", plain, "@bg_by", "user");
  ok(bgInfo(plain) === null, "시킨 칸이 없는 다른 탭(맥·AI·폰이 시킨 것)은 예전처럼 백그라운드 일로 보지 않음");
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
