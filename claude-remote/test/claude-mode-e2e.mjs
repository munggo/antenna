// Claude Code 권한 모드 실제 시험: 시험 tmux 세션(pitest:1, /tmp/ptest/cc-setup.sh 로 띄운 Haiku, manual 모드)과 시험 브리지(8799, 토큰 pmtest)
// 실행: node claude-remote/test/claude-mode-e2e.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");
const W = "pitest:1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = () => tm("capture-pane", "-p", "-t", W);
const modeLine = () => (scr().match(/(⏸|⏵⏵) [a-z ]+ on/g) ?? []).pop() ?? "";
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };

const ws = new WebSocket("ws://127.0.0.1:8799/?token=pmtest&cols=120&rows=40");
const ev = [];
ws.on("message", (d, bin) => { if (!bin) try { const m = JSON.parse(d.toString()); if (m.type === "chat") ev.push(m.d); } catch {} });
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
const snap = await waitFor(() => ev.find((e) => e.t === "snapshot"), 10000);
ok(snap?.agent === "claude" && snap?.permMode === "manual", `처음 모드는 manual(${snap?.agent}, ${snap?.permMode})`);

const want = { manual: "manual mode", acceptEdits: "accept edits", plan: "plan mode", auto: "auto mode" };
const phoneSet = async (m, what) => {
  const from = ev.length;
  ws.send(JSON.stringify({ type: "pi-command", text: `/mode ${m}` }));
  const okScreen = await waitFor(() => modeLine().includes(want[m]), 8000);
  const okEvent = await waitFor(() => ev.slice(from).some((e) => e.t === "permmode" && e.mode === m), 4000);
  ok(okScreen && okEvent, `${what}: 맥 화면(${modeLine()})·폰 전달`);
};
await phoneSet("plan", "폰에서 계획으로");
ok(ev.some((e) => e.t === "planmode" && e.on === true), "계획이면 planmode 도 켜짐");
await phoneSet("auto", "폰에서 자동으로");
await phoneSet("acceptEdits", "폰에서 수정 허용으로(한 바퀴 돌아서)");
await phoneSet("manual", "폰에서 매번 묻기로");
{
  const from = ev.length;
  ws.send(JSON.stringify({ type: "pi-command", text: "/mode manual" }));
  await sleep(1500);
  ok(modeLine().includes("manual mode"), "이미 그 모드면 키를 누르지 않음");
  ok(!ev.slice(from).some((e) => e.t === "notice"), "이미 그 모드면 안내 없음");
}

// 맥에서 Shift+Tab → 폰이 알아챔
{
  const from = ev.length;
  tm("send-keys", "-t", W, "BTab");
  ok(await waitFor(() => ev.slice(from).some((e) => e.t === "permmode" && e.mode === "acceptEdits"), 5000), "맥에서 Shift+Tab → 폰 모드도 바뀜");
  ws.send(JSON.stringify({ type: "pi-command", text: "/mode manual" }));
  await waitFor(() => modeLine().includes("manual mode"), 8000);
}

// 확인 창이 떠 있으면 키를 누르지 않음
{
  tm("send-keys", "-t", W, "-l", "Use the Write tool to create /tmp/cctest/mode.txt containing hi. Do nothing else.");
  await sleep(300);
  tm("send-keys", "-t", W, "Enter");
  const dlg = await waitFor(() => /Esc to cancel/.test(scr()), 60000);
  ok(dlg, "매번 묻기 → 파일 쓰기 확인 창");
  const from = ev.length;
  ws.send(JSON.stringify({ type: "pi-command", text: "/mode auto" }));
  ok(await waitFor(() => ev.slice(from).some((e) => e.t === "notice" && /확인 창이 떠 있어/.test(e.text)), 4000), "확인 창이 떠 있으면 안내만");
  await sleep(500);
  ok(/Esc to cancel/.test(scr()) && !existsSync("/tmp/cctest/mode.txt"), "확인 창은 그대로(Shift+Tab 을 누르지 않음)");
  tm("send-keys", "-t", W, "Escape");
  await waitFor(() => !/Esc to cancel/.test(scr()) && modeLine(), 10000);
  ok(modeLine().includes("manual mode"), "닫은 뒤에도 매번 묻기 그대로");
}

ws.close();
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
