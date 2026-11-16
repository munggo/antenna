// 개인·회사 계정이 섞였을 때(한쪽 탭이 다른 계정으로 돎) 브리지가 어느 쪽인지 가려 폰에 알리는지 시험.
// 가짜 홈·시험 세션(accttest)·포트 8789 로 브리지를 따로 띄운다(알림은 보내지 않고 기록만). 쓰는 브리지·세션은 건드리지 않는다.
// 실행: node server/test/accounts-alert.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = "accttest", PORT = 8789, ROOT = `/tmp/antenna-acct-${process.pid}`;
const ALERT = `${ROOT}/home/.cache/pi-remote/account-alert.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

/**
 * 공유 사용량 파일(과 개인 계정 조회 기록)을 주고 브리지를 켜 3초 동안의 기록을 돌려준다.
 * fresh: 홈을 새로 만듦(앞서 알린 기록도 지움). 아니면 앞 실행의 홈을 그대로(브리지를 다시 켠 것과 같음)
 */
const run = async (accounts, { personalResetSec = null, fresh = true } = {}) => {
  if (fresh) rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(`${ROOT}/home`, { recursive: true });
  mkdirSync(`${ROOT}/usage`, { recursive: true });
  writeFileSync(`${ROOT}/accounts.json`, JSON.stringify(accounts));
  // 개인 계정 사용량 조회 기록(pi 로그인으로 조회한 값): 있으면 어느 쪽인지 가릴 수 있다
  writeFileSync(`${ROOT}/usage/usage-history.jsonl`, personalResetSec
    ? `${JSON.stringify({ t: Date.now() - 60_000, s: null, w: 59, sr: null, wr: new Date(personalResetSec * 1000).toISOString(), src: "api" })}\n` : "");
  tm("kill-session", "-t", `=${S}`);
  tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
  const b = spawn(process.execPath, ["bridge.mjs"], {
    cwd: SERVER,
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME: `${ROOT}/home`, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`,
      HOST: "127.0.0.1", PORT: String(PORT), PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`,
      PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`, PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`,
      PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log`, PI_REMOTE_USAGE_FIRST_MS: "300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  b.stdout.on("data", (d) => (log += d));
  b.stderr.on("data", (d) => (log += d));
  await sleep(3000);
  b.kill("SIGTERM");
  await sleep(400);
  tm("kill-session", "-t", `=${S}`);
  return log;
};
const sent = (log, title) => new RegExp(`알림\\(시험·안 보냄\\) account 탭 [^\\n]* · ${title}`).test(log);
const anyAlert = (log) => /알림\(시험·안 보냄\) account/.test(log);

const now = Date.now();
const PR = Math.floor(now / 1000) + 3 * 86400, WR = Math.floor(now / 1000) + 6 * 86400;   // 개인·회사 계정의 서로 다른 초기화 시각
const wk = (util, reset, agoMin = 1) => ({ util, reset, at: now - agoMin * 60_000 });
try {
  // 1) 회사 탭이 개인 계정으로: 두 칸에 개인 계정 값(개인 계정 조회 기록과 같은 초기화 시각)
  let log = await run({ anthropic: { "7d": wk(0.59, PR) }, "anthropic-work": { "7d": wk(0.59, PR, 4) } }, { personalResetSec: PR });
  ok(/브리지 시작/.test(log), "시험 브리지가 뜸");
  ok(sent(log, "회사 탭이 개인 계정으로 돌고 있어요"), "같은 값이 개인 계정 것이면 '회사 탭이 개인 계정으로' 알림");
  ok(existsSync(ALERT) && JSON.parse(readFileSync(ALERT, "utf8")).kind === "work-on-personal", "알린 것을 파일에 남김");
  // 2) 브리지를 다시 켜도(같은 홈) 같은 일로는 다시 알리지 않음
  log = await run({ anthropic: { "7d": wk(0.59, PR) }, "anthropic-work": { "7d": wk(0.59, PR, 4) } }, { personalResetSec: PR, fresh: false });
  ok(/회사 탭이 개인 계정으로 돌고 있어요/.test(log) && !anyAlert(log), "브리지를 다시 켜도 같은 일로는 폰에 다시 보내지 않음(기록만)");
  // 3) 회사 탭이 한동안 쉬어 회사 칸 값이 오래되면(알 수 없음) 알린 기록을 그대로 둠 → 다시 섞여 보여도 또 알리지 않음
  log = await run({ anthropic: { "7d": wk(0.59, PR) }, "anthropic-work": { "7d": wk(0.59, PR, 45) } }, { personalResetSec: PR, fresh: false });
  ok(!anyAlert(log) && JSON.parse(readFileSync(ALERT, "utf8")).kind === "work-on-personal", "한쪽 값이 오래돼 알 수 없을 때는 알린 기록을 지우지 않음");
  log = await run({ anthropic: { "7d": wk(0.59, PR) }, "anthropic-work": { "7d": wk(0.59, PR, 2) } }, { personalResetSec: PR, fresh: false });
  ok(/회사 탭이 개인 계정으로 돌고 있어요/.test(log) && !anyAlert(log), "그 탭이 다시 일해 섞여 보여도 같은 일로는 또 보내지 않음(11-13 저녁 되풀이 알림)");
  // 4) 풀린 것이 확인되면(둘 다 최근 값이고 서로 다름) 알린 기록을 지움
  log = await run({ anthropic: { "7d": wk(0.59, PR) }, "anthropic-work": { "7d": wk(0.31, WR) } }, { personalResetSec: PR, fresh: false });
  ok(!anyAlert(log) && JSON.parse(readFileSync(ALERT, "utf8")).kind === undefined, "따로 돌게 되면 알리지 않고, 알린 기록을 지움");
  // 4) 개인 탭이 회사 계정으로: 두 칸에 회사 계정 값(개인 계정 조회 기록과 다른 초기화 시각)
  log = await run({ anthropic: { "7d": wk(0.31, WR) }, "anthropic-work": { "7d": wk(0.31, WR, 4) } }, { personalResetSec: PR, fresh: false });
  ok(sent(log, "개인 탭이 회사 계정으로 돌고 있어요"), "같은 값이 개인 계정 것이 아니면 '개인 탭이 회사 계정으로' 알림(풀린 뒤 다시 섞이면 바로)");
  // 5) 개인 계정 조회 기록이 없으면(pi 를 안 쓰는 맥) 어느 쪽인지 모른다고
  log = await run({ anthropic: { "7d": wk(0.31, WR) }, "anthropic-work": { "7d": wk(0.31, WR, 4) } });
  ok(sent(log, "개인·회사 계정이 섞였어요"), "개인 계정 조회 기록이 없으면 '섞였어요'로(방향을 지어내지 않음)");
  // 6) 계정을 하나만 쓰면 알리지 않음
  log = await run({ anthropic: { "7d": wk(0.4, PR) } });
  ok(/브리지 시작/.test(log) && !anyAlert(log), "계정을 하나만 쓰면 알리지 않음");
} catch (e) {
  ok(false, `시험 중 오류: ${e.stack ?? e.message}`);
} finally {
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
