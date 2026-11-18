// 도는 브리지에서 모듈 폴더가 지워졌을 때 스스로 고치는지 실제로 본다(사본 브리지·시험 세션 depse2e·포트 8785·가짜 홈. 쓰는 브리지는 건드리지 않음)
//  A. 붙을 때 tmux 실행에 실패하면 → 4002 'repairing' 로 닫고 그 자리에서 다시 설치 → 다음 접속은 됨(브리지는 다시 시작하지 않음)
//  B. 1분마다 하는 점검(시험에서는 2초)이 먼저 알아채 다시 설치
//  C. 모듈이 아예 없을 때 run.sh 가 켜기 전에 다시 설치하고 브리지를 띄움
//  + 붙었다 끊기를 되풀이해도 브리지가 쥔 pty 가 늘지 않는지
// 사본에 모듈을 잠금 파일대로 여러 번 설치하므로 네트워크가 필요하고 1분쯤 걸린다(그래서 sh test.sh 묶음에는 넣지 않음). 시험 폴더는 끝나면 지운다
// 실행: node server/test/deps-e2e.mjs
// 작성: 서문교
import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WebSocket = createRequire(join(REPO, "server/package.json"))("ws");
const ROOT = mkdtempSync(join(tmpdir(), "antenna-deps-e2e-")), SRV = join(ROOT, "server"), HOME = join(ROOT, "home");
const S = "depse2e", PORT = 8785, TOKEN = "d".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// 사본 만들기: 브리지 파일·잠금 파일·실행 스크립트와, 브리지가 읽는 claude-remote
mkdirSync(SRV, { recursive: true });
mkdirSync(HOME, { recursive: true });
cpSync(join(REPO, "server"), SRV, { recursive: true, filter: (p) => !p.includes("/node_modules") && !p.includes("/test/") });
cpSync(join(REPO, "claude-remote"), join(ROOT, "claude-remote"), { recursive: true });
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`, LANG: "ko_KR.UTF-8", HOME,
  npm_config_cache: `${process.env.HOME}/.npm`,   // 받아 둔 묶음을 다시 쓰게(가짜 홈이라도)
  PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
  PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
  PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log`,
  PI_REMOTE_ENV: `${ROOT}/no-env`, PI_REMOTE_NODE: process.execPath, PI_REMOTE_DEPS_RETRY_SEC: "2",
};
execSync("npm ci --no-audit --no-fund", { cwd: SRV, env, stdio: "ignore" });

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "80", "-y", "24");

let bridge = null, log = "";
const start = (extra = {}, viaRunSh = false) => {
  log = "";
  bridge = spawn(viaRunSh ? "/bin/bash" : process.execPath, [viaRunSh ? "run.sh" : "bridge.mjs"], { cwd: SRV, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  bridge.stdout.on("data", (d) => (log += d));
  bridge.stderr.on("data", (d) => (log += d));
};
const stop = async () => { if (!bridge) return; bridge.kill(); await new Promise((r) => bridge.once("exit", r)); bridge = null; };
const waitLog = async (re, ms) => { for (let t = 0; t < ms; t += 200) { if (re.test(log)) return true; await sleep(200); } return false; };
/** 접속해 보고 { attached: 터미널 글을 받았는지, code, reason } */
const connect = () => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=80&rows=24`);
  let attached = false;
  const timer = setTimeout(() => ws.close(), 4000);
  ws.on("message", (_d, isBinary) => { if (isBinary && !attached) { attached = true; clearTimeout(timer); ws.close(); } });
  ws.on("close", (code, reason) => { clearTimeout(timer); resolve({ attached, code, reason: String(reason) }); });
  ws.on("error", () => {});
});
/** 브리지 프로세스(run.sh 로 띄웠으면 그 아래 node)가 쥔 pty 수 */
const ptys = () => {
  const pid = execSync(`pgrep -f "node bridge.mjs" -P ${bridge.pid} || echo ${bridge.pid}`).toString().trim().split("\n")[0];
  return Number(execSync(`lsof -p ${pid} 2>/dev/null | grep -c ptmx || true`).toString().trim());
};

try {
  // ── A. 붙을 때 실패 → 그 자리에서 다시 설치 ──
  start({ PI_REMOTE_DEPS_CHECK_SEC: "3600" });
  ok(await waitLog(/브리지 시작/, 10_000), "사본 브리지가 뜸");
  const pid = bridge.pid;
  ok((await connect()).attached, "처음에는 붙음");
  const p0 = ptys();
  for (let i = 0; i < 5; i++) await connect();
  await sleep(1500);
  ok(ptys() <= p0, `붙었다 끊기를 다섯 번 해도 pty 가 늘지 않음(${p0} → ${ptys()})`);
  rmSync(join(SRV, "node_modules"), { recursive: true });
  const r = await connect();
  ok(!r.attached && r.code === 4002 && r.reason === "repairing", `모듈 폴더가 없으면 4002 'repairing' 으로 닫음(받은 것 ${r.code} '${r.reason}')`);
  ok(/tmux 실행 실패: posix_spawn failed: No such file or directory → 모듈을 다시 설치하는 중/.test(log), "기록에 실패 까닭과 다시 설치 중이 남음");
  ok(await waitLog(/모듈 다시 설치 끝/, 120_000), "다시 설치가 끝남");
  ok((await connect()).attached, "다시 설치한 뒤에는 브리지를 다시 시작하지 않고도 붙음");
  ok(bridge.pid === pid && bridge.exitCode === null, "브리지는 그대로 돌고 있음");
  for (let i = 0; i < 3; i++) await connect();
  await sleep(1500);
  ok(ptys() <= p0, `실패를 겪은 뒤에도 pty 가 늘지 않음(${p0} → ${ptys()})`);
  await stop();

  // ── B. 정기 점검이 먼저 알아챔 ──
  start({ PI_REMOTE_DEPS_CHECK_SEC: "2" });
  ok(await waitLog(/브리지 시작/, 10_000), "다시 뜸(점검 2초마다)");
  rmSync(join(SRV, "node_modules"), { recursive: true });
  ok(await waitLog(/다시 설치합니다\(정기 점검/, 10_000), "폰이 붙기 전에 정기 점검이 알아챔");
  ok(await waitLog(/모듈 다시 설치 끝/, 120_000), "정기 점검이 다시 설치함");
  ok((await connect()).attached, "그 뒤 접속은 붙음");
  await stop();

  // ── C. 모듈이 아예 없을 때 run.sh 가 켜기 전에 설치 ──
  rmSync(join(SRV, "node_modules"), { recursive: true });
  start({ PI_REMOTE_DEPS_CHECK_SEC: "3600" }, true);
  ok(await waitLog(/다시 설치합니다\(켜기 전\)/, 10_000), "run.sh 가 켜기 전에 알아챔");
  ok(await waitLog(/브리지 시작/, 120_000), "설치하고 브리지를 띄움");
  ok(existsSync(join(SRV, "node_modules/node-pty/package.json")) && (await connect()).attached, "모듈이 돌아오고 붙음");
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  await stop().catch(() => {});
  tm("kill-session", "-t", `=${S}`);
  if (fail) console.log(`--- 마지막 기록 ---\n${log.slice(-1500)}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
