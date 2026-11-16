// 권한 모드 실제 시험: 시험 tmux 세션(pitest:1, Haiku, send-guard·plan-mode·피드 확장)과 시험 브리지(8799, 토큰 pmtest)
// 실행: node pi-extension/test/perm-mode-e2e.mjs (준비: /tmp/ptest/setup.sh, 시험 브리지)
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");
const W = "pitest:1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = () => tm("capture-pane", "-p", "-t", W);
// 지금 떠 있는 승인 상자(화면 아래쪽 상자 안내 줄)
const boxOpen = () => /↑↓ 고르기 · Enter 확인/.test(scr().split("\n").filter((l) => l.trim()).slice(-14).join("\n"));
const paste = (t) => { tm("send-keys", "-t", W, "-l", `\x1b[200~${t}\x1b[201~`); tm("send-keys", "-t", W, "Enter"); };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 300) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };
// 쉬는 중: 피드의 마지막 작업 이벤트가 '끝'이고 승인 상자가 없는 상태가 2초 넘게 이어짐
let working = false;
const idle = async () => {
  await sleep(1500);
  let calm = 0;
  for (let t = 0; t < 120000 && calm < 4; t += 500) {
    calm = !working && !boxOpen() ? calm + 1 : 0;
    await sleep(500);
  }
};

const ws = new WebSocket("ws://127.0.0.1:8799/?token=pmtest&cols=120&rows=40");
const ev = [];
ws.on("message", (d, bin) => { if (!bin) try { const m = JSON.parse(d.toString()); if (m.type === "chat") { ev.push(m.d); if (m.d.t === "working") working = !!m.d.value; } } catch {} });
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await waitFor(() => ev.find((e) => e.t === "snapshot"), 10000);
// 새 대화로(앞 시험의 '거부당함' 기록을 보고 모델이 스스로 포기하지 않게)
ev.length = 0;
paste("/new");
const snap = await waitFor(() => ev.find((e) => e.t === "snapshot" && e.messages.length === 0), 15000);
ok(snap?.permMode === "auto", `처음은 자동(${snap?.permMode})`);

// 1) /mode → 매번 묻기
paste("/mode");
ok(await waitFor(() => /⏸ 매번 묻기/.test(scr()), 8000), "맥 /mode → 매번 묻기(하단 표시)");
ok(await waitFor(() => ev.some((e) => e.t === "permmode" && e.mode === "ask"), 5000), "폰에 모드 전달(ask)");

// 2) 파일 쓰기 → 승인 상자 → 허용
paste("Use the write tool to create the file /tmp/ptest/pm-a.txt with the content hi. Do nothing else.");
const bottom = () => scr().split("\n").filter((l) => l.trim()).slice(-30).join("\n");
ok(await waitFor(() => boxOpen() && /파일 쓰기/.test(bottom()), 60000), "파일 쓰기 → 승인 상자(파일 쓰기)");
ok(await waitFor(() => ev.some((e) => e.t === "approval" && /파일 쓰기/.test(e.item?.label ?? "")), 5000), "폰 승인 카드도 뜸");
tm("send-keys", "-t", W, "2");
ok(await waitFor(() => existsSync("/tmp/ptest/pm-a.txt"), 30000), "허용 → 파일 생김");
await idle();

// 3) 읽기 전용 명령은 묻지 않음
const before = ev.filter((e) => e.t === "approval").length;
paste("Run this exact bash command once: ls /tmp/ptest . Then reply with one word: done");
await idle();
ok(ev.filter((e) => e.t === "approval").length === before, "읽기 전용 명령(ls)은 묻지 않음");

// 4) 파일 만드는 명령 → 승인 → 거부
paste("Run this exact bash command once: touch /tmp/ptest/pm-b.txt");
ok(await waitFor(() => boxOpen() && /명령 실행/.test(bottom()), 60000), "touch → 승인 상자(명령 실행)");
tm("send-keys", "-t", W, "1");
// 거부하면 모델이 다른 방법으로 다시 시도할 수 있음 → 그 차례가 끝날 때까지 다시 뜨는 승인도 거부
for (let t = 0; t < 90000; t += 1000) {
  await sleep(1000);
  if (boxOpen()) tm("send-keys", "-t", W, "1");
  else if (!working) break;
}
await idle();
ok(!existsSync("/tmp/ptest/pm-b.txt"), "거부 → 명령 실행 안 됨");

// 5) 폰에서 계획 → 자동
await idle();
ws.send(JSON.stringify({ type: "pi-command", text: "/mode plan" }));
const planOk = await waitFor(() => /계획 모드/.test(scr()) && ev.some((e) => e.t === "permmode" && e.mode === "plan"), 8000);
if (!planOk) {
  console.log("   [안내]", ev.filter((e) => e.t === "notice").map((e) => e.text).slice(-3).join(" / ") || "없음");
  console.log("   [모드 이벤트]", ev.filter((e) => e.t === "permmode").map((e) => e.mode).join(",") || "없음", "| working:", working);
  console.log("   [화면]\n" + scr().split("\n").filter((l) => l.trim()).slice(-8).map((l) => "     " + l.slice(0, 100)).join("\n"));
}
ok(planOk, "폰 /mode plan → 계획 모드(맥 표시·폰 전달)");
ws.send(JSON.stringify({ type: "pi-command", text: "/mode auto" }));
ok(await waitFor(() => !/계획 모드 —/.test(scr()) && !/⏸ 매번 묻기/.test(scr()) && ev.some((e) => e.t === "permmode" && e.mode === "auto"), 8000), "폰 /mode auto → 계획 끄고 묻기도 끔");

// 6) 매번 묻기로 두고 다시 불러와도 그대로
paste("/mode ask");
await waitFor(() => /⏸ 매번 묻기/.test(scr()), 5000);
paste("/reload");
await sleep(9000);
ok(/⏸ 매번 묻기/.test(scr()), "다시 불러와도 매번 묻기 유지");
paste("/mode auto");
await sleep(1500);

// 7) 맥 입력창에 쓰던 글이 있어도 폰에서 모드가 바뀜(입력창 글은 그대로), Claude Code 이름·모르는 모드
tm("send-keys", "-t", W, "-l", "draft words");
await sleep(500);
{
  const from = ev.length;
  ws.send(JSON.stringify({ type: "pi-command", text: "/mode manual" }));
  ok(await waitFor(() => /⏸ 매번 묻기/.test(scr()) && ev.slice(from).some((e) => e.t === "permmode" && e.mode === "ask"), 6000), "입력창에 글이 있어도 폰에서 바뀜(manual → 매번 묻기)");
  ok(/draft words/.test(scr()), "맥 입력창 글은 그대로");
  const from2 = ev.length;
  ws.send(JSON.stringify({ type: "pi-command", text: "/mode acceptEdits" }));
  await sleep(1500);
  ok(/⏸ 매번 묻기/.test(scr()) && ev.slice(from2).filter((e) => e.t === "permmode").pop()?.mode === "ask", "pi 에 없는 모드는 무시하고 지금 모드를 다시 알림");
  ws.send(JSON.stringify({ type: "pi-command", text: "/mode auto" }));
  ok(await waitFor(() => !/⏸ 매번 묻기/.test(scr()), 5000), "폰에서 자동으로 되돌림");
  for (let i = 0; i < 3; i++) tm("send-keys", "-t", W, "C-u");
}

ws.close();
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
