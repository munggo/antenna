// 브리지가 죽지 않는지 시험: 자동 발견(Bonjour) 광고의 네트워크 오류, 잡지 못한 오류 기록
// 실행: node server/test/advertise.test.mjs  (광고를 잠깐 실제로 올린다. 이름은 시험용이라 쓰는 브리지와 겹치지 않음)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { advertise } from "../advertise.mjs";
import { recordCrash } from "../crash-log.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "antenna-crash-"));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = (code) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: SERVER, encoding: "utf8", timeout: 20000 });
const sendError = () => Object.assign(new Error("send EADDRNOTAVAIL 224.0.0.251:5353"), { code: "EADDRNOTAVAIL" });

// 0. 대조(예전 브리지): 오류를 받을 곳 없이 쓰면 송신 실패 하나로 프로세스가 죽는다
{
  const r = child(`
    import { Bonjour } from "bonjour-service";
    const b = new Bonjour();
    b.publish({ name: "antenna-test-old-" + process.pid, type: "piremote", port: 8796 });
    setTimeout(() => b.server.errorCallback(Object.assign(new Error("send EADDRNOTAVAIL 224.0.0.251:5353"), { code: "EADDRNOTAVAIL" })), 300);
    setTimeout(() => { console.log("살아 있음"); process.exit(0); }, 1500);
  `);
  ok(r.status !== 0 && /EADDRNOTAVAIL/.test(r.stderr) && !r.stdout.includes("살아 있음"), `대조: 받을 곳이 없으면 송신 실패 하나로 죽음(예전 동작, 끝 코드 ${r.status})`);
}

// 1. 고친 광고: 같은 실패에도 죽지 않고 기록만
{
  const warns = [];
  const logs = [];
  const a = advertise({ port: 8796, session: "test", name: `antenna-test-${process.pid}`, log: { warn: (m) => warns.push(m), log: (m) => logs.push(m) } });
  await sleep(2500);   // 광고가 올라올 때까지
  ok(logs.some((l) => l.includes("Bonjour 광고 시작")), "광고가 올라옴");
  // 실제로 죽던 길 그대로: 질의가 왔는데 답을 보내다 실패
  const mdns = a.bonjour.server.mdns;
  const real = mdns.respond;
  let asked = 0;
  mdns.respond = (_packet, cb) => { asked++; cb?.(sendError()); };
  const query = () => mdns.emit("query", { questions: [{ name: "_piremote._tcp.local", type: "PTR" }] }, { address: "127.0.0.1", port: 5353 });
  let threw = null;
  try { query(); } catch (e) { threw = e; }
  await sleep(200);
  ok(!threw && asked >= 1, `질의에 답을 보내려 함(${asked}번) — 그 송신이 실패해도 던지지 않음`);
  ok(warns.length === 1 && warns[0].includes("EADDRNOTAVAIL") && warns[0].includes("계속 동작"), `실패는 기록만 → ${warns[0] ?? "(기록 없음)"}`);
  for (let i = 0; i < 5; i++) query();
  await sleep(200);
  ok(warns.length === 1, `같은 오류가 이어져도 1분에 한 번만 적음(${warns.length}줄)`);
  mdns.respond = real;
  // 소켓 자체의 오류, 서비스 오류(이름 겹침)도 받을 곳이 있어 던져지지 않음
  threw = null;
  try {
    mdns.emit("error", Object.assign(new Error("bind EADDRINUSE 0.0.0.0:5353"), { code: "EADDRINUSE" }));
    a.service.emit("error", new Error("Service name is already in use on the network"));
  } catch (e) {
    threw = e;
  }
  ok(!threw, `소켓 오류·이름 겹침 오류도 던져지지 않음${threw ? ` → ${threw.message}` : ""}`);
  threw = null;
  try { a.stop(); a.stop(); } catch (e) { threw = e; }
  ok(!threw, "내리기는 두 번 불러도 됨");
}

// 2. 잡지 못한 오류 기록: 던져진 오류는 적고 끝냄, 처리되지 않은 거절은 적고 계속
{
  const file = join(dir, "crash.log");
  const pre = `import { installCrashLog } from "./crash-log.mjs"; installCrashLog("시험", ${JSON.stringify(file)});`;
  let r = child(`${pre} setTimeout(() => { throw new Error("boom-thrown"); }, 50); setTimeout(() => { console.log("살아 있음"); }, 800);`);
  const lines = () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
  ok(r.status === 1 && !r.stdout.includes("살아 있음"), `던져진 오류: 끝냄(끝 코드 ${r.status})`);
  ok(lines().length === 1 && /^\d{4}-\d\d-\d\dT[\d:.]+Z 죽음 Error: boom-thrown \| at /.test(lines()[0]), `던져진 오류: 시각·종류·스택을 한 줄로 적음 → ${(lines()[0] ?? "").slice(0, 70)}`);
  r = child(`${pre} Promise.reject(new Error("nope-rejected")); setTimeout(() => { console.log("살아 있음"); }, 300);`);
  ok(r.status === 0 && r.stdout.includes("살아 있음"), `처리되지 않은 거절: 계속 동작(끝 코드 ${r.status})`);
  ok(lines().length === 2 && lines()[1].includes(" 거절 Error: nope-rejected"), "처리되지 않은 거절: 적음");
  for (let i = 0; i < 205; i++) recordCrash("죽음", new Error(`n${i}`), file);
  ok(lines().length === 200 && lines().at(-1).includes("n204") && !lines().some((l) => l.includes("boom-thrown")), `최근 200건만 둠(${lines().length}줄)`);
  recordCrash("죽음", new Error("x"), "/dev/null/없는폴더/crash.log");
  ok(true, "적을 수 없는 곳이어도 던지지 않음");
}

rmSync(dir, { recursive: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
