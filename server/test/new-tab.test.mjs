// 폰의 '새 탭'에서 고른 도구(Claude Code · pi · Codex · Gemini CLI)가 보던 탭의 폴더에서 켜지는지 시험
// 브리지를 따로 띄운다(시험 세션 newtabtest · 포트 8786 · 가짜 홈). 진짜 도구는 켜지 않는다: PI_NEW_TAB_PREFIX 로 켤 명령 앞에
// 'echo started:' 를 붙여, 새 탭의 셸에 무엇을 켜려 했는지만 찍히게 한다. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/new-tab.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "newtabtest", PORT = 8786, ROOT = `/tmp/antenna-newtab-${process.pid}`, HOME = `${ROOT}/home`, PROJ = `${ROOT}/proj`, TOKEN = "e".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

mkdirSync(HOME, { recursive: true });
mkdirSync(`${PROJ}/sub`, { recursive: true });
const real = (p) => realpathSync(p);   // /tmp 는 /private/tmp 로 풀려 보인다
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", PROJ);
const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: SERVER,
  env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
    PI_TMUX_SESSION: S, PI_NEW_TAB_PREFIX: "echo started:", PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
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
  if (!/브리지 시작/.test(log) || exited !== null) throw new Error(`브리지가 뜨지 않음(끝 코드 ${exited})\n${log.slice(-400)}`);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let windows = null;
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "windows") windows = m;
    } catch { /* 줄 단위가 아닌 글 */ }
  });
  const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { if (fn()) return true; await sleep(200); } return false; };
  const wins = () => (tm("list-windows", "-t", `=${S}`, "-F", "#{window_index}\t#{window_name}\t#{pane_current_path}\t#{pane_id}") ?? "").split("\n").filter(Boolean).map((l) => {
    const [index, name, path, pane] = l.split("\t");
    return { index: Number(index), name, path, pane };
  });
  /** 그 칸의 화면에서 켜려던 명령(셸이 찍은 'started: …' 줄. 친 글 'echo started: …' 줄은 빼고) */
  const started = (pane) => ((tm("capture-pane", "-p", "-t", pane) ?? "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("started:")) ?? "").replace("started:", "").trim();
  /** 창 0 을 보는 채로 새 탭을 열어 달라고 하고, 새로 생긴 창을 돌려준다(없으면 null) */
  const open = async (msg) => {
    tm("select-window", "-t", `=${S}:0`);
    const before = wins().map((w) => w.index);
    ws.send(JSON.stringify({ type: "new-window", ...msg }));
    await waitFor(() => wins().length > before.length, 5000);
    const made = wins().find((w) => !before.includes(w.index)) ?? null;
    if (made) await waitFor(() => started(made.pane), 15000);   // 새 탭의 셸이 뜨고 넣은 글을 실행하기까지
    return made && wins().find((w) => w.index === made.index);
  };

  ok(await waitFor(() => windows, 5000) && JSON.stringify(windows.newTabTools) === JSON.stringify(["claude", "pi", "codex", "gemini"]),
    `탭 목록과 함께 고를 수 있는 도구를 알려 줌 → ${JSON.stringify(windows?.newTabTools)}`);

  // 고른 도구가 보던 탭(창 0)의 폴더에서 켜진다. 채팅 화면이 없는 Codex·Gemini 는 탭 이름을 정해 준다
  for (const [agent, name] of [["claude", null], ["pi", null], ["codex", "Codex"], ["gemini", "Gemini"]]) {
    const w = await open({ agent });
    ok(w && started(w.pane) === agent, `${agent}: 새 탭에서 그 도구를 켬 → '${w ? started(w.pane) : "탭이 생기지 않음"}'`);
    ok(w && real(w.path) === real(PROJ), `${agent}: 보던 탭의 폴더에서 엶 → ${w?.path}`);
    if (name) ok(w?.name === name, `${agent}: 탭 이름을 정해 줌 → ${w?.name}`);
    else ok(w && !["Codex", "Gemini"].includes(w.name), `${agent}: 탭 이름은 정하지 않음(연결 프로그램이 붙임) → ${w?.name}`);
  }

  // 보던 탭에서 폴더를 옮겼으면 옮긴 폴더에서
  tm("send-keys", "-t", `=${S}:0`, "-l", "cd sub");
  tm("send-keys", "-t", `=${S}:0`, "Enter");
  await waitFor(() => real(wins().find((w) => w.index === 0)?.path ?? "/") === real(`${PROJ}/sub`), 8000);
  const moved = await open({ agent: "codex" });
  ok(moved && real(moved.path) === real(`${PROJ}/sub`), `보던 탭에서 옮긴 폴더에서 엶 → ${moved?.path}`);

  // 도구를 보내지 않는 예전 앱: 전처럼 홈에서 pi
  const old = await open({});
  ok(old && started(old.pane) === "pi" && real(old.path) === real(HOME), `예전 앱(도구를 안 보냄): 홈에서 pi → '${old ? started(old.pane) : ""}' ${old?.path}`);

  // 정해 둔 넷이 아니면 아무것도 열지 않는다(셸에 넣는 글이라 임의 입력을 받지 않음)
  const count = wins().length;
  for (const agent of ["zsh -c 'touch /tmp/x'", "constructor", "", 3, null, ["claude"]]) ws.send(JSON.stringify({ type: "new-window", agent }));
  await sleep(1500);
  ok(wins().length === count, `모르는 도구는 무시(탭 ${count}개 그대로 → ${wins().length}개)`);
  ok(exited === null, "브리지가 계속 살아 있음");
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
