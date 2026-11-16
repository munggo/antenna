// 재부팅 흉내: 시험 세션(rstest)에 셸·pi·Claude·다른 프로그램 탭을 만들고, 시험 브리지가 탭 목록을 저장 →
// 브리지와 세션을 끈 뒤 브리지를 다시 켜면 같은 번호·이름·폴더·대화로 되살아나는지, 폰 알림(시험 기록)까지
// 실행: node server/test/restore-e2e.mjs (세션 rstest·포트 8796·/tmp/rs 를 만들고 끝나면 지움). 실제 antenna 세션은 건드리지 않음
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const SERVER = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const REPO = SERVER.replace(/\/server$/, "");
const S = "rstest", PORT = 8796, D = "/tmp/rs", TABS = `${D}/tabs.json`, LOG = `${D}/bridge.log`, HOOKS = `${D}/hooks.json`;
const NODE = process.execPath, PI = process.env.PI_BIN || execFileSync("/bin/zsh", ["-lc", "whence -p pi"], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch { return ""; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 1000) => { for (let t = 0; t < ms; t += step) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
const wins = () => tm("list-windows", "-t", `=${S}`, "-F", "#{window_index}\t#{window_name}\t#{pane_current_path}\t#{pane_id}\t#{pane_pid}\t#{automatic-rename}").split("\n").filter(Boolean)
  .map((l) => { const [i, n, c, p, pid, ar] = l.split("\t"); return { i: Number(i), n, c, p, pid, ar }; });
const stopFeeds = () => execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
const claudeSid = (pane) => {
  const pid = tm("display", "-p", "-t", pane, "#{pane_pid}");
  let kids = [];
  try { kids = execFileSync("pgrep", ["-P", pid], { encoding: "utf8" }).split("\n").filter(Boolean); } catch {}
  for (const p of [pid, ...kids]) { const f = `${process.env.HOME}/.claude/sessions/${p}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).sessionId; }
  return "";
};
const piSession = (pane) => { try { return JSON.parse(readFileSync(`${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.session`, "utf8")).session; } catch { return ""; } };
let bridge = null;
const startBridge = async (extra = {}) => {
  bridge = spawn(NODE, ["bridge.mjs"], {
    cwd: SERVER,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME, SHELL: "/bin/zsh", PI_REMOTE_TOKEN: "rs-token", PORT: String(PORT), PI_TMUX_SESSION: S,   // launchd 처럼 빈약한 환경(LANG 없음)
      PI_REMOTE_SESSION_DIR: `${D}/pi-sessions`, PI_REMOTE_PUSH_FILE: `${D}/push.json`, PI_REMOTE_PUSH_DRYRUN: "1",
      PI_REMOTE_TABS_FILE: TABS, PI_REMOTE_TABS_SAVE_SEC: "3", PI_REMOTE_RESTORE_REPORT_DELAY_MS: "1000",
      PI_REMOTE_HOSTS: "127.0.0.1",   // 밖에서 붙을 주소: 어느 맥에나 있는 주소를 적어 알림이 "VPN 연결됨"이 되게
      PI_RESTORE_PI_CMD: `${D}/bin/pi`, PI_RESTORE_CLAUDE_CMD: `${D}/bin/claude`, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stdout.on("data", (d) => writeFileSync(LOG, readFileSync(LOG, "utf8") + d));
  bridge.stderr.on("data", (d) => writeFileSync(LOG, readFileSync(LOG, "utf8") + d));
  await sleep(2500);
};
const stopBridge = async () => { bridge?.kill(); await sleep(800); };
const log = () => readFileSync(LOG, "utf8");

// ── 준비 ──
stopFeeds(); tm("kill-session", "-t", `=${S}`);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
rmSync(D, { recursive: true, force: true });
for (const d of ["a", "b", "c", "d", "e", "bin", "pi-sessions"]) mkdirSync(`${D}/${d}`, { recursive: true });
writeFileSync(LOG, "");
const H = { matcher: "", hooks: [{ type: "command", command: `"${NODE}" "${REPO}/claude-remote/pi-remote-hook.mjs"`, timeout: 5 }] };
writeFileSync(HOOKS, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"].map((k) => [k, [H]])) }));
const CLAUDE = execFileSync("/bin/zsh", ["-lc", "whence -p claude"], { encoding: "utf8" }).trim();
writeFileSync(`${D}/bin/pi`, `#!/bin/sh\nexec ${PI} --model claude/claude-haiku-4-5 --thinking off -ne -e ${REPO}/pi-extension/claude-accounts.ts -e ${REPO}/pi-extension/pi-remote-feed.ts --session-dir ${D}/pi-sessions "$@"\n`, { mode: 0o755 });
writeFileSync(`${D}/bin/claude`, `#!/bin/sh\nexec "${CLAUDE}" --model haiku --permission-mode auto --setting-sources project,local --settings ${HOOKS} "$@"\n`, { mode: 0o755 });

// 0: 셸 'Alpha'(a) / 1: pi 'Beta'(b) / 2: Claude(c, 자동 이름) / 3: less(d) / 5: 셸 'Gap'(e)
tm("new-session", "-d", "-s", S, "-x", "150", "-y", "40", "-n", "Alpha", "-c", `${D}/a`);
tm("new-window", "-t", `=${S}:1`, "-n", "Beta", "-c", `${D}/b`, `${D}/bin/pi`);
tm("new-window", "-t", `=${S}:2`, "-c", `${D}/c`, `${D}/bin/claude`);
tm("new-window", "-t", `=${S}:3`, "-n", "Pager", "-c", `${D}/d`, "sleep 900");   // 셸이 아닌 다른 프로그램
tm("new-window", "-t", `=${S}:5`, "-n", "Gap", "-c", `${D}/e`);
await sleep(3000);
// pi·Claude 에 한 번씩 말을 걸어 대화 파일을 만듦
for (let i = 0; i < 40; i++) { const s = tm("capture-pane", "-p", "-t", `=${S}:2`); if (/Yes, I trust this folder/.test(s)) { tm("send-keys", "-t", `=${S}:2`, "Down"); await sleep(300); tm("send-keys", "-t", `=${S}:2`, "Enter"); } if (/(⏸|⏵⏵) [a-z ]+ on/.test(s)) break; await sleep(500); }
for (const w of [1, 2]) { tm("send-keys", "-t", `=${S}:${w}`, "-l", "Reply with exactly: 31337"); await sleep(600); tm("send-keys", "-t", `=${S}:${w}`, "Enter"); }
ok(Boolean(await waitFor(() => [1, 2].every((w) => (tm("capture-pane", "-p", "-J", "-S", "-100", "-t", `=${S}:${w}`).match(/31337/g) ?? []).length >= 2), 90000)), "시험 탭 준비(pi·Claude 대화 있음)");
const before = wins();
const piSess0 = piSession(before.find((w) => w.i === 1).p);
const ccSid0 = claudeSid(before.find((w) => w.i === 2).p);
ok(Boolean(piSess0) && existsSync(piSess0) && /^[0-9a-f-]{36}$/.test(ccSid0), `처음 대화: pi ${piSess0.split("/").pop()?.slice(0, 24)}…, Claude ${ccSid0.slice(0, 8)}`);

// ── 1) 브리지가 탭 목록을 저장 ──
await startBridge();
const snap = await waitFor(() => { try { const s = JSON.parse(readFileSync(TABS, "utf8")); return s.tabs?.length === 5 ? s : null; } catch { return null; } }, 20000);
ok(Boolean(snap), "1) 탭 목록 저장(5개)");
const byIdx = Object.fromEntries((snap?.tabs ?? []).map((t) => [t.index, t]));
ok(byIdx[0]?.kind === "shell" && byIdx[0]?.name === "Alpha" && byIdx[1]?.kind === "pi" && byIdx[1]?.resume === piSess0 && byIdx[2]?.kind === "claude" && byIdx[2]?.resume === ccSid0,
  "1) 종류·대화: 셸 Alpha, pi(같은 파일), Claude(같은 번호)");
// Claude 탭은 연결부가 이름을 'Claude' 로 바꿔 자동 이름이 꺼짐 → 그 이름을 저장
ok(["", "Claude"].includes(byIdx[2]?.name) && byIdx[3]?.kind === "shell" && byIdx[3]?.name === "Pager" && byIdx[5]?.name === "Gap", `1) 이름(Claude 탭 '${byIdx[2]?.name}'), 다른 프로그램 탭은 셸, 빈 번호 5`);
ok(!/되살림/.test(log()), "1) 세션이 있으면 되살리지 않음");

// ── 2) 재부팅 흉내: 브리지·세션을 모두 끄고 다시 켬 ──
await stopBridge(); stopFeeds(); tm("kill-session", "-t", `=${S}`); await sleep(1000);
ok(!tm("has-session", "-t", `=${S}`) && tm("list-sessions").indexOf(`${S}:`) < 0, "2) 시험 세션 꺼짐");
writeFileSync(LOG, "");
await startBridge();
ok(/세션 'rstest' 을 되살림: 탭 5개\(pi 1·Claude 1·셸 3\)/.test(log()), `2) 브리지가 되살림(${(log().match(/되살림: [^\n]*/) ?? [""])[0]})`);
const after = wins();
ok(JSON.stringify(after.map((w) => w.i)) === "[0,1,2,3,5]", `2) 같은 번호(${after.map((w) => w.i).join(",")})`);
const aw = Object.fromEntries(after.map((w) => [w.i, w]));
ok(aw[0]?.n === "Alpha" && aw[1]?.n === "Beta" && aw[3]?.n === "Pager" && aw[5]?.n === "Gap" && (byIdx[2]?.name ? aw[2]?.n === byIdx[2].name : aw[2]?.ar === "1"), "2) 같은 이름");
ok(["a", "b", "c", "d", "e"].every((d, k) => (aw[[0, 1, 2, 3, 5][k]]?.c ?? "").endsWith(`/rs/${d}`)), "2) 같은 폴더");
const piBack = await waitFor(() => { const s = piSession(aw[1].p); return s === piSess0 ? s : null; }, 40000);
if (!piBack) {
  console.log(`     기록 '${piSession(aw[1].p)}' / 처음 '${piSess0}' / 프로그램 ${tm("display", "-p", "-t", aw[1].p, "#{pane_current_command}")}`);
  console.log(tm("capture-pane", "-p", "-t", aw[1].p).split("\n").filter((l) => l.trim()).slice(-8).map((l) => "     | " + l.slice(0, 110)).join("\n"));
}
ok(Boolean(piBack), "2) pi 탭: 같은 대화 파일로 다시 켜짐");
for (let i = 0; i < 40; i++) { const s = tm("capture-pane", "-p", "-t", `=${S}:2`); if (/Yes, I trust this folder/.test(s)) { tm("send-keys", "-t", `=${S}:2`, "Down"); await sleep(300); tm("send-keys", "-t", `=${S}:2`, "Enter"); } if (/(⏸|⏵⏵) [a-z ]+ on/.test(s)) break; await sleep(500); }
const ccBack = await waitFor(() => claudeSid(aw[2].p) === ccSid0, 40000);
ok(Boolean(ccBack) && /31337/.test(tm("capture-pane", "-p", "-J", "-S", "-100", "-t", `=${S}:2`)), "2) Claude 탭: 같은 대화 번호로 다시 켜짐(앞 대화가 보임)");
ok(/^-?(\S*\/)?zsh$/.test(tm("display", "-p", "-t", `=${S}:3`, "#{pane_current_command}")), "2) 다른 프로그램이 돌던 탭은 셸로");
ok(/LANG=en_US.UTF-8/.test(tm("show-environment", "-g", "-t", `=${S}`)) && /LC_ALL=/.test(tm("show-environment", "-g", "-t", `=${S}`)), "2) 브리지(빈약한 환경)가 띄운 tmux 에도 언어 설정");
ok(Boolean(await waitFor(() => /알림\(시험·안 보냄\) boot/.test(log()) && /재부팅 점검: 탭 5개 되살림\(pi 1·Claude 1·셸 3\) · VPN 연결됨 · 브리지 동작 중/.test(log()), 20000)), `2) 폰 알림 한 번(${(log().match(/재부팅 점검: [^\n]*/) ?? [""])[0]})`);

// ── 3) 세션이 있는데 브리지만 다시 켜면 되살리지 않음 ──
await stopBridge(); writeFileSync(LOG, ""); await startBridge();
await sleep(3000);
ok(!/되살림|새로 만듦/.test(log()) && !/알림\(시험·안 보냄\) boot/.test(log()), "3) 세션이 있으면 브리지를 다시 켜도 그대로(알림 없음)");

// ── 4) 브리지가 도는 중에 세션이 사라져도 마지막 저장본을 덮지 않음 ──
await sleep(4000);
const saved = readFileSync(TABS, "utf8");
stopFeeds(); tm("kill-session", "-t", `=${S}`);
await sleep(7000);
ok(readFileSync(TABS, "utf8") === saved, "4) 세션이 없을 때는 저장본을 그대로 둠");
await stopBridge();

// ── 5) 저장본이 없으면 빈 세션 + 알림 ──
rmSync(TABS); writeFileSync(LOG, "");
await startBridge();
ok(/새로 만듦\(저장된 탭 목록 없음\)/.test(log()) && wins().length === 1, "5) 저장본이 없으면 빈 셸 하나");
ok(Boolean(await waitFor(() => /저장된 탭 목록이 없어 빈 세션을 만들었어요/.test(log()), 15000)), "5) 그래도 폰 알림");
await stopBridge();

stopFeeds(); tm("kill-session", "-t", `=${S}`);
rmSync(D, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
