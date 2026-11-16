// 폰 알림 보류(맥이 잠겼거나 10분 넘게 안 만졌을 때만 보냄) — 실제 tmux 와 시험 브리지로 확인
// 실행: node test/notify-hold-e2e.mjs (tmux 세션 holdtest·포트 8798 을 만들고 끝나면 지움)
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const S = "holdtest", PORT = 8798, LOG = "/tmp/holdtest-bridge.log";
const IDLE = "/tmp/holdtest-idle", LOCKED = "/tmp/holdtest-locked";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" });
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const startBridge = async (fake = true) => {
  writeFileSync(LOG, "");
  const b = spawn(process.execPath, ["bridge.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: "holdtest-token", PORT: String(PORT), PI_TMUX_SESSION: S,
      PI_REMOTE_SESSION_DIR: "/tmp/holdtest-sessions", PI_REMOTE_PUSH_FILE: "/tmp/holdtest-push.json", PI_REMOTE_PUSH_DRYRUN: "1",
      PI_REMOTE_FAKE_IDLE_FILE: IDLE, ...(fake ? { PI_REMOTE_FAKE_LOCKED_FILE: LOCKED } : {}), PI_REMOTE_HOLD_CHECK_MS: "800" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  b.stdout.on("data", (d) => writeFileSync(LOG, readFileSync(LOG, "utf8") + d));
  b.stderr.on("data", (d) => writeFileSync(LOG, readFileSync(LOG, "utf8") + d));
  await sleep(2500);
  return b;
};

try { tm("kill-session", "-t", S); } catch {}
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30"); tm("new-window", "-t", S); tm("new-window", "-t", S);
writeFileSync(IDLE, "5"); writeFileSync(LOCKED, "0");
let bridge = await startBridge();

const log = () => readFileSync(LOG, "utf8");
const sent = (kind, w) => log().includes(`알림(시험·안 보냄) ${kind} 탭 ${w}`);
const held = (kind, w) => log().includes(`맥을 쓰는 중이라 알림 보류(${kind}, 탭 ${w})`);
const send = async (kind, window) => {
  await new Promise((r) => {
    const c = createConnection(`${process.env.HOME}/.cache/pi-remote/notify-${S}.sock`, () => {
      c.end(`${JSON.stringify({ kind, title: "t", body: "b", ...(window === undefined ? {} : { window }), durationSec: 99999 })}\n`);
      r();
    });
    c.on("error", r);
  });
  await sleep(700);
};
const reset = () => writeFileSync(LOG, "");

// 맥을 쓰는 중(안 잠김, 5초 전에 만짐)
reset(); await send("question", 1);
ok(held("question", 1) && !sent("question", 1), "1) 안 잠김·방금 만짐 → 질문 보류");
reset(); await send("approval", 2);
ok(held("approval", 2) && !sent("approval", 2), "2) 어느 탭이든(2번 탭 승인) → 보류");
reset(); await send("done", 1); await send("error", 1);
ok(held("done", 1) && held("error", 1) && !sent("done", 1) && !sent("error", 1), "3) 작업 끝·오류 → 보류");
writeFileSync(LOCKED, "1"); await sleep(2000);
ok(!sent("done", 1) && !sent("error", 1), "3) 작업 끝·오류는 나중에 잠가도 안 보냄(버림)");
writeFileSync(LOCKED, "0");

// 시간 기준(10분)
writeFileSync(IDLE, "120"); reset(); await send("question", 1);
ok(held("question", 1) && !sent("question", 1), "4) 2분 가만히 있어도(안 잠김) → 보류(예전 1분 기준이면 보냈음)");
writeFileSync(IDLE, "599"); reset(); await send("prompt", 1);
ok(held("prompt", 1), "5) 9분 59초 → 보류");
writeFileSync(IDLE, "600"); reset(); await send("prompt", 1);
ok(sent("prompt", 1) && !held("prompt", 1), "6) 10분 안 만짐 → 바로 보냄");
writeFileSync(IDLE, "5");

// 잠김
writeFileSync(LOCKED, "1"); reset(); await send("question", 1); await send("done", 2);
ok(sent("question", 1) && sent("done", 2) && !held("question", 1), "7) 잠김 → 질문·작업 끝 모두 바로 보냄(방금 만졌어도)");
writeFileSync(LOCKED, "0");

// 확인 실패 → 보냄
writeFileSync(LOCKED, "?"); reset(); await send("question", 1);
ok(sent("question", 1), "8) 잠금 상태를 모르면 → 보냄(놓치지 않게)");
writeFileSync(LOCKED, "0"); writeFileSync(IDLE, "x"); reset(); await send("question", 1);
ok(sent("question", 1), "9) 입력 시간을 모르면 → 보냄");
writeFileSync(IDLE, "5");

// 탭 번호 없는 알림(앱의 알림 시험 등)은 항상 보냄
reset(); await send("test");
ok(log().includes("알림(시험·안 보냄) test") && !log().includes("보류(test"), "10) 탭 번호 없는 알림 → 항상 보냄");

// 보류한 승인: 답하지 않고 잠그면 그때 보냄
tm("set-option", "-w", "-t", `${S}:1`, "@pi_status", "asking");
reset(); await send("approval", 1);
ok(held("approval", 1), "11) 승인 보류");
await sleep(2000);
ok(!sent("approval", 1), "11) 맥을 쓰는 동안은 계속 보류");
writeFileSync(LOCKED, "1"); await sleep(2000);
ok(sent("approval", 1) && log().includes("맥이 잠겼거나 10분 넘게 안 써서 보류한 알림 보냄(approval, 탭 1)"), "11) 답하지 않고 잠그면 그때 보냄");
writeFileSync(LOCKED, "0");

// 보류한 질문: 10분 지나면 보냄
reset(); await send("question", 1);
ok(held("question", 1), "12) 질문 보류");
writeFileSync(IDLE, "601"); await sleep(2000);
ok(sent("question", 1), "12) 답하지 않고 10분 지나면 그때 보냄");
writeFileSync(IDLE, "5");

// 보류한 고르기 질문: 답하면 취소(그 뒤 잠가도 안 보냄)
reset(); await send("choice", 1);
ok(held("choice", 1), "13) 고르기 질문 보류");
tm("set-option", "-w", "-t", `${S}:1`, "@pi_status", "");
await sleep(1500); writeFileSync(LOCKED, "1"); await sleep(1500);
ok(!sent("choice", 1) && log().includes("답해서 보류한 알림 취소(choice, 탭 1)"), "13) 그사이 답했으면 잠가도 안 보냄");
writeFileSync(LOCKED, "0");

// 폰이 붙어 있어도 판단은 맥 기준
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=holdtest-token&cols=80&rows=24`);
await new Promise((r) => ws.on("open", r)); await sleep(1200);
ws.send(Buffer.from("\x1b[I")); await sleep(500);
reset(); await send("question", 1);
ok(held("question", 1), "14) 폰이 붙어 있어도 맥을 쓰는 중이면 → 보류");
ws.close();

// 실제 잠금 상태 읽기(가짜 값 없이): 지금 이 맥은 안 잠김 → 방금 만졌으면 보류, 10분 지났으면 보냄
bridge.kill(); await sleep(800);
bridge = await startBridge(false);
const reallyLocked = /"CGSSessionScreenIsLocked"=Yes/.test(execFileSync("/usr/sbin/ioreg", ["-n", "Root", "-d1"], { encoding: "utf8" }));
writeFileSync(IDLE, "5"); reset(); await send("question", 1);
ok(reallyLocked ? sent("question", 1) : held("question", 1), `15) 실제 잠금 상태(${reallyLocked ? "잠김 → 보냄" : "안 잠김 + 방금 만짐 → 보류"})`);
writeFileSync(IDLE, "700"); reset(); await send("question", 1);
ok(sent("question", 1), "15) 실제 잠금 상태 + 10분 넘음 → 보냄");

bridge.kill(); await sleep(500);
try { tm("kill-session", "-t", S); } catch {}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
