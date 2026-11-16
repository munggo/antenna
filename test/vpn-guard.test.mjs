// VPN 지킴이 시험(선택 기능): 설치 스크립트가 설정에서 값을 읽어 틀을 채우는지, 채워진 지킴이가 터널을 지키는지
// root 권한 없이 본다: 설치는 --print(채운 스크립트만 냄)로, 지킴이는 가짜 openvpn 으로 돌린다.
// 진짜 VPN 과 설치된 지킴이는 건드리지 않는다(이 시험만의 설정 파일 이름을 씀). 실행: node test/vpn-guard.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = join(REPO, "deploy/install-vpn-guard.sh");
const D = `/tmp/antenna-vpnguard-${process.pid}`;
const NAME = `guardcase-${process.pid}-${Date.now().toString(36)}.ovpn`;   // 이 시험만의 이름(진짜 VPN 설정과 겹치지 않게)
const CFG = `${D}/${NAME}`, ENV = `${D}/env`, FAKE = `${D}/fake-openvpn`, CALLS = `${D}/calls.log`, PIDF = `${D}/vpn.pid`;
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pids = (pat = NAME) => { try { return execFileSync("pgrep", ["-f", pat], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; } };
const calls = () => (existsSync(CALLS) ? readFileSync(CALLS, "utf8").split("\n").filter(Boolean) : []);
const killAll = (pat = NAME) => { try { execFileSync("pkill", ["-f", pat]); } catch { /* 없음 */ } };

mkdirSync(D, { recursive: true });
writeFileSync(CFG, "client\n");
// 가짜 openvpn: 진짜처럼 뒤에서 도는 프로세스를 남기고(명령줄에 설정 파일 이름이 보이게) 번호를 적은 뒤 끝난다
writeFileSync(`${D}/vpn-proc.sh`, "#!/bin/sh\nwhile :; do sleep 1; done\n", { mode: 0o755 });
writeFileSync(FAKE, `#!/bin/sh
echo "$*" >> ${CALLS}
[ -f ${D}/fail-next ] && exit 7
nohup /bin/sh ${D}/vpn-proc.sh "$2" > /dev/null 2>&1 &
echo $! > "$5"
`, { mode: 0o755 });

const install = (envText, args = ["--print"], extra = {}) => {
  writeFileSync(ENV, envText);
  return spawnSync("/bin/sh", [INSTALL, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, USER: process.env.USER, HOME: process.env.HOME, PI_REMOTE_ENV: ENV, PI_REMOTE_OPENVPN: FAKE, ...extra } });
};
/** 설정으로 채운 지킴이를 파일로 만들어 돌린다 → 끝 코드 */
const guard = (gateway, tag) => {
  const r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\n${gateway === null ? "" : `PI_REMOTE_VPN_GATEWAY=${gateway}\n`}`);
  const file = `${D}/guard-${tag}.sh`;
  writeFileSync(file, r.stdout, { mode: 0o755 });
  return spawnSync("/bin/sh", [file], { encoding: "utf8", env: { PATH: process.env.PATH, PI_REMOTE_VPN_PIDFILE: PIDF, PI_REMOTE_VPN_LOG: `${D}/vpn.log` } }).status;
};

try {
  // ── 설치 스크립트: 설정 읽기·틀 채우기 ──
  let r = install(`# 주석\nPI_REMOTE_TOKEN=abc\nPI_REMOTE_VPN_CONFIG="${CFG}"   # 따옴표·뒤 주석\nPI_REMOTE_VPN_GATEWAY=10.9.8.1\n`);
  const val = (k) => r.stdout.match(new RegExp(`^${k}="([^"]*)"`, "m"))?.[1];
  ok(r.status === 0 && val("OVPN") === FAKE && val("CFG") === CFG && val("VPN_GW") === "10.9.8.1", `설정의 값으로 틀을 채움(설정 파일 ${val("CFG") === CFG ? "맞음" : val("CFG")}, 게이트웨이 ${val("VPN_GW")})`);
  ok(!/__[A-Z_]+__/.test(r.stdout) && !/abc/.test(r.stdout), "채우지 않은 자리가 남지 않고, 다른 설정 값(토큰)은 들어가지 않음");
  ok(spawnSync("/bin/sh", ["-n"], { input: r.stdout }).status === 0, "채운 스크립트의 문법이 올바름");
  r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\n`);
  ok(r.status === 0 && val("VPN_GW") === "", "게이트웨이를 안 적어도 됨(빈 값)");
  r = install(`PI_REMOTE_VPN_CONFIG=${D}/old.ovpn\nPI_REMOTE_VPN_CONFIG=${CFG}\n`);
  ok(r.status === 0 && val("CFG") === CFG, "같은 이름이 여러 줄이면 마지막 것(브리지가 읽는 것과 같게)");
  r = install("PI_REMOTE_VPN_CONFIG=~/없는-폴더-antenna-test/x.ovpn\n");
  ok(r.status === 1 && r.stderr.includes("영문·숫자"), "경로에 한글 등 다른 글자가 있으면 그만둠");
  r = install("PI_REMOTE_VPN_CONFIG=~/no-such-antenna-test/x.ovpn\n");
  ok(r.status === 1 && r.stderr.includes(`${process.env.HOME}/no-such-antenna-test/x.ovpn`) && r.stderr.includes("없어요"), "~ 는 홈으로 풀고, 그 파일이 없으면 그만둠");
  r = install("PI_REMOTE_TOKEN=abc\n");
  ok(r.status === 1 && r.stderr.includes("PI_REMOTE_VPN_CONFIG=") && r.stdout === "", "설정 파일을 안 적었으면 적는 법을 알려 주고 그만둠");
  for (const bad of [`${D}/a b.ovpn`, `${D}/a;rm.ovpn`, `${D}/$(id).ovpn`, `${D}/a|b.ovpn`, "relative/x.ovpn"]) {
    r = install(`PI_REMOTE_VPN_CONFIG=${bad}\n`);
    ok(r.status === 1 && r.stdout === "", `위험한 경로는 받지 않음: ${bad.replace(D, "…")}`);
  }
  r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\nPI_REMOTE_VPN_GATEWAY=10.20.0.1;id\n`);
  ok(r.status === 1 && r.stderr.includes("게이트웨이"), "게이트웨이에 주소가 아닌 글자가 있으면 그만둠");
  chmodSync(CFG, 0o666);
  r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\n`);
  ok(r.status === 1 && r.stderr.includes("다른 사용자"), "설정 파일을 다른 사용자가 고칠 수 있으면 그만둠");
  chmodSync(CFG, 0o644);
  r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\n`, ["--print"], { PI_REMOTE_OPENVPN: `${D}/no-openvpn` });
  ok(r.status === 1 && r.stderr.includes("openvpn"), "openvpn 실행 파일이 아니면 그만둠");
  r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\n`, []);
  ok(r.status === 1 && r.stderr.includes("sudo") && r.stdout === "", "관리자 권한 없이 설치하려 하면 아무것도 하지 않고 안내");
  r = install(`PI_REMOTE_VPN_CONFIG=${CFG}\n`, ["--oops"]);
  ok(r.status === 1 && r.stderr.includes("모르는 옵션"), "모르는 옵션은 받지 않음");

  // ── 지킴이: 터널 지키기(가짜 openvpn) ──
  ok(pids().length === 0, "준비: 이 시험의 VPN 프로세스가 없음");
  ok(guard("127.0.0.1", "ok") === 0 && calls().length === 1 && pids().length === 1, `안 붙어 있으면 띄움(부른 횟수 ${calls().length}, 프로세스 ${pids().length}개)`);
  ok(calls()[0] === `--config ${CFG} --daemon --writepid ${PIDF} --log ${D}/vpn.log`, `openvpn 을 설정 파일·뒤에서 돌기·번호 파일·기록 파일로 부름`);
  const first = pids()[0];
  ok(guard("127.0.0.1", "ok") === 0 && calls().length === 1 && pids()[0] === first, "붙어 있고 건너편에 핑이 가면 그대로 둠");
  ok(guard(null, "nogw") === 0 && calls().length === 1 && pids()[0] === first, "게이트웨이를 안 적었으면 프로세스가 도는지만 봄(그대로 둠)");
  ok(guard("192.0.2.1", "dead") === 0 && calls().length === 2 && pids().length === 1 && pids()[0] !== first, `프로세스는 있어도 건너편에 핑이 안 가면 정리하고 다시 띄움(프로세스 ${pids().length}개)`);
  // 중복: 같은 설정으로 하나 더 떠 있음
  spawnSync("/bin/sh", ["-c", `nohup /bin/sh ${D}/vpn-proc.sh ${CFG} > /dev/null 2>&1 &`]);
  await sleep(300);
  ok(pids().length === 2, "준비: 같은 설정의 프로세스가 둘");
  ok(guard("192.0.2.1", "dead") === 0 && pids().length === 1, `겹쳐 떠 있던 것까지 정리하고 하나만 남김(프로세스 ${pids().length}개)`);
  // 다른 VPN(다른 설정 파일 이름)은 건드리지 않음
  const OTHER = `other-${NAME}`.replace("guardcase", "elsewhere");
  spawnSync("/bin/sh", ["-c", `nohup /bin/sh ${D}/vpn-proc.sh ${D}/${OTHER} > /dev/null 2>&1 &`]);
  await sleep(300);
  const other = pids(OTHER)[0];
  ok(Boolean(other) && guard("192.0.2.1", "dead") === 0 && pids(OTHER)[0] === other, "다른 설정으로 도는 VPN 은 건드리지 않음");
  killAll(OTHER);
  killAll();
  await sleep(1200);
  const before = calls().length;
  ok(pids().length === 0 && guard("127.0.0.1", "ok") === 0 && calls().length === before + 1 && pids().length === 1, "프로세스가 죽어 있으면 다시 띄움");
  killAll();
  await sleep(1200);
  writeFileSync(`${D}/fail-next`, "");
  ok(guard("127.0.0.1", "ok") === 0 && pids().length === 0, "openvpn 이 실패해도 지킴이는 정상으로 끝남(30초 뒤 다시 해 봄)");
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  killAll();
  killAll(NAME.replace("guardcase", "elsewhere"));
  rmSync(D, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
