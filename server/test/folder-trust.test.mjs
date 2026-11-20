// 연결부가 새로 켠 Claude Code 탭의 '이 폴더를 믿나요' 창에서 '예'를 누르는지 시험(사용자 결정 11-20 '새로 띄우는 곳은 자동으로 yes')
// 1) 판정(server/folder-trust.mjs): 가짜 화면으로 여러 경우
// 2) 시험 브리지(세션 trusttest · 포트 8781 · 가짜 홈): 진짜 도구 대신 신뢰 창을 흉내 내는 가짜 프로그램을 켜고,
//    앱의 새 탭·단축어로 시킨 일에서 Claude Code 일 때만 '예'가 눌리는지. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/folder-trust.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptFolderTrust } from "../folder-trust.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// ── 1) 판정 ──
/** 가짜 탭: after 번째 화면부터 신뢰 창. moves=false 면 아래 키가 커서를 못 옮김. layout 'old' 는 번호가 붙고 '예'가 먼저 */
const fakeTab = ({ after = 0, moves = true, layout = "new", closed = false, dialog = true } = {}) => {
  const keys = [];
  let n = 0, sel = 0;
  const capture = () => {
    if (closed) return null;
    if (!dialog || n++ < after) return "❯ \n────\n  ⏵⏵ auto mode on";
    return layout === "old"
      ? `Do you trust the files in this folder?\n${sel === 0 ? "❯" : " "} 1. Yes, I trust this folder\n${sel === 1 ? "❯" : " "} 2. No, exit`
      : ` Accessing workspace:\n /tmp/x\n ${sel === 0 ? "❯" : " "} No, exit\n ${sel === 1 ? "❯" : " "} Yes, I trust this folder\n Enter to confirm · Esc to cancel`;
  };
  const press = (k) => { keys.push(k); if (k === "Down" && moves && layout === "new") sel = 1; };
  return { capture, press, keys };
};
const fast = { step: 10, sleep: (t) => sleep(Math.min(t, 10)) };
let t = fakeTab({ after: 3 });
ok(await acceptFolderTrust({ ...t, ...fast, ms: 2000 }) === "accepted" && t.keys.join(" ") === "Down Enter", `창이 늦게 떠도: 아래로 → 예 확인 → Enter (${t.keys.join(" ")})`);
t = fakeTab({ layout: "old" });
ok(await acceptFolderTrust({ ...t, ...fast, ms: 2000 }) === "accepted" && t.keys.join(" ") === "Enter", `커서가 이미 '예'면 Enter 만 (${t.keys.join(" ")})`);
t = fakeTab({ dialog: false });
ok(await acceptFolderTrust({ ...t, ...fast, ms: 300 }) === "none" && !t.keys.length, "창이 안 뜨면(이미 믿는 폴더) 아무 키도 안 누름");
t = fakeTab({ closed: true });
ok(await acceptFolderTrust({ ...t, ...fast, ms: 2000 }) === "closed" && !t.keys.length, "탭이 닫혔으면 그만");
t = fakeTab({ moves: false });
ok(await acceptFolderTrust({ ...t, ...fast, ms: 2000 }) === "unsure" && !t.keys.includes("Enter"), `커서를 '예'로 못 옮기면 Enter 를 누르지 않음 (${t.keys.join(" ")})`);

// ── 2) 시험 브리지 ──
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
if (!tm("-V")) {
  console.log("건너뜀: tmux 가 없어 브리지 시험은 하지 않음");
  console.log(fail ? `실패 ${fail}개` : "모두 통과");
  process.exit(fail ? 1 : 0);
}
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "trusttest", PORT = 8781, ROOT = `/tmp/antenna-trust-${process.pid}`, HOME = `${ROOT}/home`, PROJ = `${ROOT}/proj`, TOKEN = "f".repeat(64);
mkdirSync(HOME, { recursive: true });
mkdirSync(PROJ, { recursive: true });
const FAKE = `${ROOT}/fake-trust.mjs`;
// 신뢰 창 흉내: '아니요'가 먼저, 아래·위 화살표로 고르고 Enter → 'chose: 이름 yes|no' 를 찍고 끝
writeFileSync(FAKE, `const name = process.argv[2] ?? "";
let sel = 0;
const draw = () => process.stdout.write("\\x1b[2J\\x1b[H Accessing workspace:\\n\\n " + process.cwd() + "\\n\\n" + (sel === 0 ? " ❯ " : "   ") + "No, exit\\n" + (sel === 1 ? " ❯ " : "   ") + "Yes, I trust this folder\\n\\n Enter to confirm · Esc to cancel\\n");
process.stdin.setRawMode(true);
process.stdin.resume();
draw();
process.stdin.on("data", (d) => {
  const s = d.toString();
  if (/\\x1b[[O]B/.test(s)) sel = 1;
  else if (/\\x1b[[O]A/.test(s)) sel = 0;
  else if (s === "\\r") { process.stdout.write("\\x1b[2J\\x1b[Hchose: " + name + " " + (sel ? "yes" : "no") + "\\n"); process.exit(0); }
  draw();
});
`);
const node = process.execPath;
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", PROJ);
const bridge = spawn(node, ["bridge.mjs"], {
  cwd: SERVER,
  env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
    PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
    PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log`,
    // 새 탭: 'node fake-trust.mjs claude' 처럼 켬. 단축어: 진짜 도구 대신 가짜 창(이름 bg-claude·bg-pi)
    PI_NEW_TAB_PREFIX: `${node} ${FAKE}`, PI_BG_CLAUDE_CMD: `${node} ${FAKE} bg-claude`, PI_BG_PI_CMD: `${node} ${FAKE} bg-pi` },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
bridge.stdout.on("data", (d) => (log += d));
bridge.stderr.on("data", (d) => (log += d));
const waitFor = async (fn, ms) => { for (let i = 0; i < ms; i += 200) { const v = fn(); if (v) return v; await sleep(200); } return null; };
const screen = (target) => tm("capture-pane", "-p", "-t", target) ?? "";
const chose = (target) => (screen(target).match(/chose: (\S+) (yes|no)/) ?? [])[2] ?? "";
const wins = () => (tm("list-windows", "-t", `=${S}`, "-F", "#{window_id}") ?? "").split("\n").filter(Boolean);
try {
  ok(await waitFor(() => /브리지 시작/.test(log), 10_000), "시험 브리지가 뜸");
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const openTab = async (agent) => {
    tm("select-window", "-t", `=${S}:0`);
    const before = wins();
    ws.send(JSON.stringify({ type: "new-window", agent }));
    return waitFor(() => wins().find((w) => !before.includes(w)), 5000);
  };

  const c = await openTab("claude");
  ok(c && await waitFor(() => chose(c), 20_000) === "yes", `앱의 새 탭(Claude Code): 신뢰 창에서 '예'를 누름 → ${c ? chose(c) || "안 누름" : "탭 없음"}`);
  ok(/신뢰 창|믿나요/.test(log) && /'예'를 누름/.test(log), "브리지 기록에 남음");
  const p = await openTab("pi");
  await waitFor(() => /Yes, I trust this folder/.test(screen(p ?? "")), 15_000);
  await sleep(3000);
  ok(p && /Yes, I trust this folder/.test(screen(p)) && !chose(p), "pi 새 탭에는 아무 키도 누르지 않음(창 그대로)");

  const ask = (body) => new Promise((res) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/push`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    w.on("open", () => w.send(JSON.stringify(body)));
    w.on("message", (d) => { try { res(JSON.parse(String(d))); w.close(); } catch { /* 다른 글 */ } });
    setTimeout(() => res(null), 6000);
  });
  const tc = await ask({ type: "task-start", id: "req-0000-0201", text: "할 일", agent: "claude", cwd: PROJ });
  const tcPane = tc?.window !== undefined ? `=${S}:${tc.window}` : "";
  ok(tc?.type === "task-started" && await waitFor(() => chose(tcPane), 20_000) === "yes", `단축어로 시킨 Claude Code 일: '예'를 누름 → ${chose(tcPane) || JSON.stringify(tc)}`);
  const tp = await ask({ type: "task-start", id: "req-0000-0202", text: "할 일", agent: "pi", cwd: PROJ });
  const tpPane = tp?.window !== undefined ? `=${S}:${tp.window}` : "";
  await waitFor(() => /Yes, I trust this folder/.test(screen(tpPane)), 15_000);
  await sleep(3000);
  ok(tp?.type === "task-started" && /Yes, I trust this folder/.test(screen(tpPane)) && !chose(tpPane), "단축어로 시킨 pi 일에는 누르지 않음");
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
