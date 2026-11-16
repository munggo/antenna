// '작업 중'이 잘못 남았을 때 바로잡기 시험: 시험 Claude Code(pitest:1, /tmp/ptest/cc-setup.sh, manual 모드)
// 1) 쉬는데 가짜 도구 훅 → 작업 중 → 화면에 작업 표시가 없으면 쉬는 중으로 되돌림
// 2) 앞에서 45초 도는 명령 → 그동안 작업 중 유지  3) 확인 창이 떠 있는 동안 작업 중 유지
// 실행: node claude-remote/test/claude-stuck-e2e.mjs
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const W = "pitest:1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const scr = () => tm("capture-pane", "-p", "-t", W);
const pane = tm("display", "-p", "-t", W, "#{pane_id}");
const SOCK = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
const LOGF = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.hooks.log`;
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 500) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };
const status = () => tm("show-options", "-w", "-v", "-t", W, "@pi_status");

// 연결부에 붙어 작업 중 상태를 받음
const ev = [];
let working = null;
const c = createConnection(SOCK);
let buf = "";
c.setEncoding("utf8");
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); ev.push(m); if (m.t === "working") working = m.value; if (m.t === "snapshot") working = m.working; } catch {}
  }
});
await new Promise((r) => c.on("connect", r));
await sleep(800);
const send = (o) => c.write(`${JSON.stringify(o)}\n`);

// ── 1) 가짜 도구 훅 ──
ok(working === false && !/esc to interrupt/i.test(scr()), "처음은 쉬는 중");
const t0 = Date.now();
send({ cmd: "hook", event: { hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "fake-1", tool_input: { file_path: "/tmp/x" } } });
ok(Boolean(await waitFor(() => working === true && status() === "working", 3000)), "1) 가짜 도구 훅 → 작업 중(주황)");
ok(Boolean(await waitFor(() => working === false, 60000)), `1) 화면에 작업 표시가 없어 쉬는 중으로 되돌림(${Math.round((Date.now() - t0) / 1000)}초)`);
ok(status() !== "working", `1) 탭 점도 바뀜('${status()}')`);
ok(existsSync(LOGF) && /PreToolUse Read/.test(readFileSync(LOGF, "utf8")) && /바로잡음/.test(readFileSync(LOGF, "utf8")), "1) 훅 기록에 받은 훅과 바로잡음");

// ── 2) 앞에서 45초 도는 명령: 그동안 작업 중 유지 ──
tm("send-keys", "-t", W, "C-u");
tm("send-keys", "-t", W, "-l", "Use the Bash tool in the foreground (not background) to run exactly: for i in $(seq 45); do echo $i; sleep 1; done");
await sleep(500); tm("send-keys", "-t", W, "Enter");
// manual 모드: 확인 창 → 허용
const dlg = await waitFor(() => /Esc to cancel/.test(scr()), 60000);
if (dlg) { await sleep(500); tm("send-keys", "-t", W, "1"); }
ok(Boolean(dlg), "2) 확인 창 → 허용");
const started = await waitFor(() => /esc to interrupt/i.test(scr()) && /Running|seq 45|\b[0-9]+\b/.test(scr()), 15000);
let dropped = false;
for (let t = 0; t < 38000; t += 1000) {
  await sleep(1000);
  if (!/esc to interrupt/i.test(scr().split("\n").filter((l) => l.trim()).slice(-4).join("\n"))) break;   // 명령이 끝남
  if (working === false) { dropped = true; break; }
}
ok(Boolean(started) && !dropped, "2) 진짜 긴 작업 동안 작업 중을 끄지 않음");
await waitFor(() => !/esc to interrupt/i.test(scr().split("\n").filter((l) => l.trim()).slice(-4).join("\n")) && working === false, 90000);

// ── 3) 확인 창이 떠 있는 동안 작업 중 유지(40초) ──
tm("send-keys", "-t", W, "-l", "Use the Write tool to create /tmp/cctest/stuck.txt containing hi. Do nothing else.");
await sleep(500); tm("send-keys", "-t", W, "Enter");
ok(Boolean(await waitFor(() => /Esc to cancel/.test(scr()), 60000)), "3) 확인 창 뜸");
await sleep(40000);
ok(working === true && /Esc to cancel/.test(scr()), "3) 확인 창이 떠 있는 40초 동안 작업 중 유지");
tm("send-keys", "-t", W, "Escape");

// ── 4) 백그라운드 하위 에이전트가 도구를 쓰는 동안(본 세션은 쉼) 작업 중이 켜지지 않음 ──
await waitFor(() => working === false && !/Esc to cancel/.test(scr()), 30000);
tm("send-keys", "-t", W, "C-u");
tm("send-keys", "-t", W, "-l", "Use the Agent tool with run_in_background set to true to start a general-purpose subagent whose task is: run the bash command 'sleep 8; echo from-subagent' and report the output. After starting it, reply only STARTED and stop.");
await sleep(500); tm("send-keys", "-t", W, "Enter");
// 본 세션 차례가 끝날 때까지(Stop)
await waitFor(() => /Stop .* 작업중=true/.test(existsSync(LOGF) ? readFileSync(LOGF, "utf8").split("\n").slice(-6).join("\n") : ""), 90000);
await waitFor(() => working === false, 10000);
const seen = [];
for (let t = 0; t < 40000; t += 1000) { await sleep(1000); seen.push(`${working ? "W" : "-"}${status() === "working" ? "w" : "-"}`); }
const logTxt = readFileSync(LOGF, "utf8");
const agentTool = /(PreToolUse|PostToolUse) Bash .*에이전트=/.test(logTxt);
if (process.env.DEBUG) console.log(logTxt.split("\n").slice(-12).join("\n"));
ok(agentTool, "4) 하위 에이전트의 도구 훅을 받음(에이전트 표시)");
// 하위 에이전트 훅이 오가는 동안 작업 중이 켜지지 않음(그 뒤 본 세션이 결과를 보고하는 짧은 차례는 진짜 작업이라 제외)
const agentLines = logTxt.split("\n").filter((l) => / 에이전트=/.test(l) && /(PreToolUse|PostToolUse)/.test(l));
ok(agentLines.length >= 2 && agentLines.every((l) => /작업중=false/.test(l)), `4) 하위 에이전트 훅이 오가는 동안 작업 중이 켜지지 않음(${agentLines.length}줄 모두 작업중=false)`);
ok(working === false && status() !== "working", "4) 끝에는 쉬는 중");

c.destroy();
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
