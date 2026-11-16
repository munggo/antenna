// 재부팅 점검 알림의 "밖에서 붙을 수 있는지" 판정 시험: 설정의 맥 주소(PI_REMOTE_HOSTS)가 이 맥에 올라와 있는지
// 뒤쪽은 시험 브리지를 따로 띄워 실제 알림 글까지 본다(세션 reachtest·포트 8794 를 만들고 끝나면 지움. tmux 가 없으면 건너뜀).
// 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다. 실행: node server/test/reach.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, localAddresses, outsideReach, parseHosts, reachText } from "../reach.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 판정 ──
const addrs = ["127.0.0.1", "::1", "192.168.1.7", "10.20.0.2", "fe80::AB:1"];
ok(outsideReach({ hosts: ["10.20.0.2"], addrs }) === true, "적은 주소가 이 맥에 있으면 붙을 수 있음");
ok(outsideReach({ hosts: ["100.64.1.5"], addrs }) === false, "적은 주소가 이 맥에 없으면 붙을 수 없음");
ok(outsideReach({ hosts: ["100.64.1.5", "10.20.0.2"], addrs }) === true, "여러 주소 가운데 하나만 있어도 됨");
ok(outsideReach({ hosts: [], addrs }) === null, "주소를 적지 않았으면 판정하지 않음");
ok(outsideReach({ hosts: ["mac.example.com"], addrs }) === null, "이름만 적었으면 판정하지 않음");
ok(outsideReach({ hosts: ["mac.example.com", "10.20.0.2"], addrs }) === true && outsideReach({ hosts: ["mac.example.com", "10.9.9.9"], addrs }) === false, "이름과 숫자 주소를 함께 적으면 숫자 주소로 판정");
ok(outsideReach({ hosts: ["FE80::ab:1"], addrs }) === true, "IPv6 주소는 대소문자를 가리지 않음");
ok(outsideReach({ hosts: ["10.20.0.20"], addrs }) === false, "앞부분만 같은 다른 주소는 아님");
ok(outsideReach({ hosts: ["100.64.1.5"], addrs, prefix: "10.20.0." }) === true && outsideReach({ hosts: ["10.20.0.2"], addrs, prefix: "10.9." }) === false, "예전 설정(대역 앞부분)이 있으면 그것으로 판정");
ok(JSON.stringify(parseHosts(" 10.20.0.2 , mac.example.com ,, ")) === JSON.stringify(["10.20.0.2", "mac.example.com"]) && parseHosts(undefined).length === 0, "쉼표로 적은 주소 읽기");
ok(isAddress("10.20.0.2") && isAddress("fd00::1") && !isAddress("mac.example.com") && !isAddress("mac-2.local"), "숫자 주소와 이름 구분");
ok(reachText(true) === " · VPN 연결됨" && reachText(false).startsWith(" · VPN 연결 안 됨") && reachText(null) === "", "알림 글: 판정하지 않으면 말하지 않음");
ok(localAddresses().includes("127.0.0.1") && outsideReach({ hosts: ["127.0.0.1"] }) === true, "이 맥의 실제 주소 목록으로도 됨");

// ── 시험 브리지의 실제 알림 글 ──
let tmux = true;
try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); } catch { tmux = false; }
if (!tmux) console.log("건너뜀: tmux 가 없어 브리지 알림 글은 보지 않음");
else {
  const S = "reachtest", PORT = 8794, ROOT = `/tmp/antenna-reach-${process.pid}`;
  const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
  /** 세션이 없는 채로 브리지를 켬 → 브리지가 세션을 만들고 점검 알림을 냄. 그 알림 글을 돌려줌 */
  const bootLine = async (extra) => {
    tm("kill-session", "-t", `=${S}`);
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(`${ROOT}/home`, { recursive: true });
    const bridge = spawn(process.execPath, ["bridge.mjs"], {
      cwd: SERVER,
      env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME: `${ROOT}/home`, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: "e".repeat(64),
        HOST: "127.0.0.1", PORT: String(PORT), PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
        PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log`,
        PI_REMOTE_RESTORE_REPORT_DELAY_MS: "300", PI_REMOTE_REACH_WAIT_SEC: "0", ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    bridge.stdout.on("data", (d) => (log += d));
    bridge.stderr.on("data", (d) => (log += d));
    let line = null;
    for (let i = 0; i < 60 && !line; i++) {
      await sleep(250);
      line = log.match(/재부팅 점검: (.*)/)?.[1] ?? null;
    }
    const sent = /알림\(시험·안 보냄\) boot/.test(log);
    bridge.kill("SIGTERM");
    await sleep(300);
    tm("kill-session", "-t", `=${S}`);
    return { line, sent, log };
  };
  try {
    const none = await bootLine({});
    ok(none.line === "저장된 탭 목록이 없어 빈 세션을 만들었어요 · 브리지 동작 중" && none.sent, `맥 주소를 적지 않음 → VPN 말 없이 알림 → ${none.line ?? none.log.slice(-300)}`);
    const up = await bootLine({ PI_REMOTE_HOSTS: "127.0.0.1" });
    ok(up.line === "저장된 탭 목록이 없어 빈 세션을 만들었어요 · VPN 연결됨 · 브리지 동작 중", `적은 주소가 올라와 있음 → 연결됨 → ${up.line}`);
    const down = await bootLine({ PI_REMOTE_HOSTS: "192.0.2.77" });
    ok(/ · VPN 연결 안 됨\(밖에서는 접속이 안 될 수 있어요\) · 브리지 동작 중$/.test(down.line ?? ""), `적은 주소가 없음 → 연결 안 됨 → ${down.line}`);
    const name = await bootLine({ PI_REMOTE_HOSTS: "mac.example.com" });
    ok(name.line === none.line, `이름만 적음 → VPN 말 없음 → ${name.line}`);
    const old = await bootLine({ PI_REMOTE_HOSTS: "192.0.2.77", PI_REMOTE_VPN_PREFIX: "127.0." });
    ok(/ · VPN 연결됨 · /.test(old.line ?? ""), `예전 설정(대역 앞부분)이 있으면 그것으로 → ${old.line}`);
  } catch (e) {
    ok(false, `시험 중 오류: ${e.message}`);
  } finally {
    tm("kill-session", "-t", `=${S}`);
    rmSync(ROOT, { recursive: true, force: true });
  }
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
