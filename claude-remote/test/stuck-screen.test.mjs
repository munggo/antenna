// '작업 중' 바로잡기를 가짜 Claude Code 화면으로 시험(모델을 부르지 않음, 1분쯤):
// 0) 훅: 칸 앞자리가 Claude Code 가 아니면 넘기지 않고 까닭을 적음(hook-miss.log), Claude Code 칸이면 연결부에 넘김
// 1) 진행 줄 모양을 판정이 몰라도, 화면(입력창 위쪽)이 움직이는 동안은 작업 중을 끄지 않음
// 2) 훅이 도는 동안의 진행 줄('(running PostToolUse hooks… 1/2 · 8m 49s …)')은 화면이 멈춰 있어도 일하는 중
// 3) 끝난 화면으로 멈추면(상태 줄 사용량은 바뀌어도) 쉬는 중으로 되돌리고, 그때 화면을 기록에 적음
// 4) 잘못 꺼진 뒤 도구 끝 훅(PostToolUse)이 오면 다시 작업 중  5) 끝 훅(Stop)이면 쉬는 중
// 6~9) 훅이 빠져도 대화 기록이 이어지면(사람 글·작업 끝 알림·도구 호출) 작업 중. 처음 읽기·끝 훅 앞선 늦은 줄·슬래시 명령·끝난 답으로는 켜지 않음
// 10) 질문 훅이 빠져도 기록된 질문 호출로 폰 질문 카드(한 번만), 답이 기록되면 닫음
// 11) 연결부가 새로 뜰 때 맥에 질문 창이 떠 있으면 답 없는 마지막 질문을 카드로(창이 없으면 열지 않음)
// 12) 묻는 알림은 하나만: 질문 호출이 연달아 와도 하나(질문 수를 보임), 카드가 떠 있는 동안의 '입력이 필요함'은 알리지 않음.
//     질문 카드는 맥처럼 하나씩(앞 카드가 닫히면 다음 카드, 알림 없이), 기다리던 질문이 먼저 끝났으면 열지 않음
// 13) 단축어로 시킨 탭(시킨 칸 없음)이 끝나면 백그라운드 끝남 알림과 끝난 때 기록, 그 뒤 차례는 보통 알림
// 14) 맥이 바빠 질문·승인 창이 훅보다 늦게 그려져도 카드를 지우지 않음(창을 한 번 본 뒤에 사라져야 닫음).
//     11-27 사용자 보고: 질문 4개 창이 폰 카드로 뜨지 않음(부하 96 에서 창이 훅 뒤 3초 넘게 늦게 그려져 '창이 닫힘'으로 보고 지웠다)
// 11-14 사용자 보고 '처리 중인데 앱에 처리 중 표시가 안 보임'(맥이 바빠 훅이 빠지고, 훅이 도는 동안의 진행 줄을 놓쳐 끔)
// 시험 세션(stuckscreentest)·가짜 홈을 만들고 끝나면 지운다. 쓰는 tmux 세션과 쓰는 연결부는 건드리지 않는다.
// 실행: node claude-remote/test/stuck-screen.test.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FEED = join(dirname(fileURLToPath(import.meta.url)), "..", "claude-feed.mjs");
const S = "stuckscreentest", ROOT = `/tmp/antenna-stuck-${process.pid}`, HOME = `${ROOT}/home`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

// 가짜 Claude Code: 0.5초마다 화면을 다시 그림. 진행 줄은 mode 파일(moving | hooks | still)을 따름, 상태 줄 사용량은 늘 바뀜
mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
mkdirSync(`${ROOT}/bin`, { recursive: true });
writeFileSync(`${ROOT}/mode`, "still");
writeFileSync(`${ROOT}/fake.mjs`, `
import { readFileSync } from "node:fs";
let n = 0;
setInterval(() => {
  n++;
  const mode = readFileSync(${JSON.stringify(`${ROOT}/mode`)}, "utf8").trim();
  const progress = mode === "moving" ? "✢ Cooking… [" + n + "s]"
    : mode === "hooks" ? "✢ Cooking… (running PostToolUse hooks… 1/2 · 8m 49s · ↓ 43.8k tokens)"
    : mode === "ask" ? "스매시가 약하게 느껴지는 것은?\\n❯ 1. 닿는 거리\\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel"
    : mode === "escnote" ? "  대기 줄의 'Esc to cancel' 에 막히지 않게\\n✻ Cooked for 2s · done 10:00 PM"
    : mode === "waitlimit" ? "⏺ Usage limit reached · set to continue automatically at 4pm"
    : "✻ Cooked for 2s · done 10:00 PM";
  const line = "─".repeat(60);
  // 한도 '저절로 이어 감' 대기 안내는 입력창 아래·모드 줄 위에 뜬다(실제 Claude Code 2.1.330, 11-23)
  const below = mode === "waitlimit" ? ["  ⚠ Usage limit reached · limit resets 4pm", "    Continuing automatically at 4pm · Esc to cancel · /usage-credits to continue now"] : [];
  // 화면을 통째로 지우지 않고 줄마다 덮어씀(지운 직후를 읽으면 빈 화면이 잡혀 시험이 흔들림)
  const rows = ["⏺ 답 줄", ...progress.split("\\n"), line, "❯ ", line, ...below, "  ~/x [main] Opus 5.5 · 개인 " + (n % 100) + "%", "  ⏵⏵ auto mode on (shift+tab to cycle)"];
  process.stdout.write("\\x1b[H" + rows.map((r) => r + "\\x1b[K").join("\\r\\n") + "\\x1b[J");
}, 500);
`);
// 칸에서 도는 프로그램 이름이 버전 번호 꼴이면 연결부가 Claude Code 로 여긴다(실제 Claude Code 도 '2.1.325' 처럼 보임)
const fakeBin = `${ROOT}/bin/9.9.9`;
try { linkSync(process.execPath, fakeBin); } catch { symlinkSync(process.execPath, fakeBin); }

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
// 0) 훅: 칸 앞자리가 Claude Code 가 아니면(지금은 셸) 연결부에 넘기지 않고 까닭을 적음
const HOOK = join(dirname(FEED), "pi-remote-hook.mjs");
const runHook = (event) => spawnSync(process.execPath, [HOOK], { env: { ...process.env, HOME, TMUX_PANE: pane }, input: JSON.stringify(event), timeout: 10_000 });
const MISS = `${HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.hook-miss.log`;
await waitFor(() => /sh$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), 5000);
runHook({ hook_event_name: "Notification", notification_type: "idle_prompt" });
const missTxt = existsSync(MISS) ? readFileSync(MISS, "utf8") : "";
ok(/Notification 앞자리 '(-?\S*sh)' 라 넘기지 않음/.test(missTxt), `0) 훅: 칸 앞자리가 셸이면 넘기지 않고 까닭을 적음('${missTxt.trim().slice(9)}')`);
tm("send-keys", "-t", pane, "-l", `exec ${fakeBin} ${ROOT}/fake.mjs`);
tm("send-keys", "-t", pane, "Enter");
await waitFor(() => /^\d+\.\d+\.\d+$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), 5000);
ok(/^\d+\.\d+\.\d+$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), "가짜 Claude Code 칸 띄움");

const tag = pane.replace(/\W/g, "");
const SOCK = `${HOME}/.cache/pi-remote/feed/${tag}.sock`, LOGF = `${HOME}/.cache/pi-remote/feed/${tag}.hooks.log`;
const feed = spawn(process.execPath, [FEED, pane], { env: { ...process.env, HOME, PI_REMOTE_IDLE_CHECK_MS: "1000" }, stdio: "ignore" });
await waitFor(() => existsSync(SOCK), 5000);

let working = null;
const asked = [], askDone = [];   // 받은 질문 카드·카드 닫힘
const approved = [], approveDone = [];   // 받은 승인 카드·카드 닫힘
const c = createConnection(SOCK);
let buf = "";
c.setEncoding("utf8");
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try {
      const m = JSON.parse(l);
      if (m.t === "working") working = m.value;
      if (m.t === "snapshot") working = m.working;
      if (m.t === "question") asked.push(m.question.id);
      if (m.t === "question-done") askDone.push(m.id);
      if (m.t === "approval") approved.push(m.item.id);
      if (m.t === "approval-done") approveDone.push(m.id);
    } catch { /* 반쪽 줄 */ }
  }
});
c.on("error", () => {});
await new Promise((r) => c.on("connect", r));
await sleep(500);
const hook = (event) => c.write(`${JSON.stringify({ cmd: "hook", event })}\n`);
const mode = (m) => writeFileSync(`${ROOT}/mode`, m);
const log = () => (existsSync(LOGF) ? readFileSync(LOGF, "utf8") : "");

try {
  ok(working === false, "처음은 쉬는 중");
  runHook({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "훅 시험" });
  ok(Boolean(await waitFor(() => /Notification/.test(log()), 3000)), "0) 훅: Claude Code 칸이면 연결부에 넘김");
  // 탭 번호(TMUX_PANE) 없이 불린 훅: 세션 파일(~/.claude/sessions/<pid>.json)에 적힌 칸으로 넘김. 끝난 프로세스의 파일·tmux 밖이면 넘기지 않음
  const sessDir = `${HOME}/.claude/sessions`;
  mkdirSync(sessDir, { recursive: true });
  const livePid = tm("display", "-p", "-t", pane, "#{pane_pid}");
  writeFileSync(`${sessDir}/${livePid}.json`, JSON.stringify({ pid: Number(livePid), sessionId: "sess-live", tmux: `${S}:@1.${pane}` }));
  writeFileSync(`${sessDir}/999999.json`, JSON.stringify({ pid: 999999, sessionId: "sess-dead", tmux: `${S}:@1.${pane}` }));
  const noPane = (event) => { const env = { ...process.env, HOME }; delete env.TMUX_PANE; return spawnSync(process.execPath, [HOOK], { env, input: JSON.stringify(event), timeout: 10_000 }); };
  noPane({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "np-1", session_id: "sess-live" });
  ok(Boolean(await waitFor(() => /PostToolUse Read sess-liv/.test(log()), 3000)), "0) 탭 번호 없이 불린 훅도 세션 파일의 칸으로 넘김");
  ok(/PostToolUse 탭 번호 없이 불림 → 세션 파일로 칸 %\d+ 을 찾아 넘김/.test(existsSync(MISS) ? readFileSync(MISS, "utf8") : ""), "0) 그렇게 넘겼다고 기록함");
  noPane({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "np-2", session_id: "sess-dead" });
  noPane({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "np-3", session_id: "sess-none" });
  await sleep(800);
  ok(!/sess-dea|sess-non/.test(log()), "0) 끝난 프로세스의 세션 파일이나 세션 파일이 없는 훅(tmux 밖)은 넘기지 않음");
  hook({ hook_event_name: "Stop" });
  await waitFor(() => working === false, 3000);
  // 0) 바쁜 연결부: 연결부가 멈춘 사이 보낸 훅도 깨어나면 모두 처리(고치기 전에는 닫힌 연결에 대화를 쓰다 그 줄까지 버림)
  const n0 = (log().match(/Notification /g) ?? []).length;
  process.kill(feed.pid, "SIGSTOP");
  for (let i = 0; i < 3; i++) runHook({ hook_event_name: "Notification", notification_type: "idle_prompt", message: `멈춘 사이 ${i}` });
  process.kill(feed.pid, "SIGCONT");
  ok(Boolean(await waitFor(() => (log().match(/Notification /g) ?? []).length - n0 >= 3, 5000)), `0) 연결부가 멈춘 사이 보낸 훅 3개도 깨어나면 모두 처리(${(log().match(/Notification /g) ?? []).length - n0}개)`);
  // 1) 화면이 움직이는 동안: 마지막 훅 뒤 20초 + 판정 3번(3초)이 지나도 끄지 않음
  mode("moving");
  hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "s-1", tool_input: { command: "sleep 600" } });
  ok(Boolean(await waitFor(() => working === true, 3000)), "1) 도구 시작 훅 → 작업 중");
  let dropped = false;
  for (let t = 0; t < 30_000 && !dropped; t += 500) { await sleep(500); dropped = working === false; }
  ok(!dropped, "1) 진행 줄 모양을 몰라도 화면이 움직이는 30초 동안 작업 중을 끄지 않음");
  // 2) 훅이 도는 동안의 진행 줄: 화면이 멈춰 있어도 일하는 중
  mode("hooks");
  for (let t = 0; t < 8000 && !dropped; t += 500) { await sleep(500); dropped = working === false; }
  ok(!dropped, "2) '(running PostToolUse hooks… 1/2 · 8m 49s …)' 진행 줄은 멈춰 있어도 일하는 중");
  // 3) 끝난 화면으로 멈추면 되돌림(상태 줄 사용량은 계속 바뀌어도)
  const t3 = Date.now();
  mode("still");
  ok(Boolean(await waitFor(() => working === false, 15_000)), `3) 끝난 화면으로 멈추면 쉬는 중으로 되돌림(${Math.round((Date.now() - t3) / 1000)}초, 상태 줄 사용량은 바뀌는 중)`);
  // 연결부는 '쉬는 중'을 먼저 알리고 tmux 를 두세 번 부른 뒤에 기록을 적는다. 알림을 받자마자 읽으면 기록이 아직 없을 때가 있어 기다림
  // (11-16 전체 시험 5번 가운데 2번 여기서만 실패)
  const fixed = () => (log().match(/바로잡음: [^\n]*/g) ?? []).pop() ?? "기록 없음";
  ok(Boolean(await waitFor(() => /바로잡음: .*\| .*Cooked for 2s.* ⏎ ⏵⏵ auto mode on/.test(log()), 3000)),
    `3) 바로잡을 때 화면의 진행 줄 자리와 모드 줄을 기록에 적음(${fixed().slice(0, 160)})`);
  // 4) 잘못 꺼진 뒤 도구 끝 훅 → 다시 작업 중
  hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "s-1", tool_input: { command: "sleep 600" }, tool_response: {} });
  ok(Boolean(await waitFor(() => working === true, 3000)), "4) 꺼진 뒤 도구 끝 훅이 오면 다시 작업 중");
  ok(tm("show-options", "-w", "-v", "-t", pane, "@pi_status") === "working", "4) 탭 점도 작업 중");
  // 5) 끝 훅 → 쉬는 중
  hook({ hook_event_name: "Stop" });
  ok(Boolean(await waitFor(() => working === false, 3000)), "5) 끝 훅 → 쉬는 중");
  // 5-1) 한도 '저절로 이어 감' 대기(입력창 아래 'Esc to cancel'): 끝 훅을 못 받은 채 조용해도 작업 중을 끄지 않음
  mode("waitlimit");
  hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "s-2", tool_input: { command: "sleep 600" } });
  ok(Boolean(await waitFor(() => working === true, 3000)), "5-1) 도구 시작 훅 → 작업 중");
  dropped = false;
  for (let t = 0; t < 30_000 && !dropped; t += 500) { await sleep(500); dropped = working === false; }
  ok(!dropped, "5-1) 입력창 아래에 한도 대기 안내가 있는 30초 동안 작업 중을 끄지 않음");
  // 5-2) 대화 글(입력창 위)에 'Esc to cancel' 글자가 있는 끝난 화면은 바로잡음(11-23: 화면 전체에서 찾아 막혔던 것)
  mode("escnote");
  ok(Boolean(await waitFor(() => working === false, 15_000)), "5-2) 대화 글에 'Esc to cancel' 글자가 보여도 끝난 화면이면 쉬는 중으로 되돌림");
  mode("still");
  hook({ hook_event_name: "Stop" });

  // 6~9) 훅이 빠져도 대화 기록이 이어지면 작업 중(11-14: 한 탭에서 끝 훅이 21번 중 17번, 시작 훅도 여럿 연결부에 닿지 않음)
  const tr = `${HOME}/t.jsonl`;
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  let n = 0;
  const put = (o, ms = 0) => appendFileSync(tr, `${JSON.stringify({ uuid: `x${++n}`, timestamp: at(ms), ...o })}\n`);
  const user = (content, ms) => put({ type: "user", message: { role: "user", content } }, ms);
  const reply = (content, stop, ms) => put({ type: "assistant", message: { id: `m${n}`, model: "claude-opus-5-5", content, stop_reason: stop } }, ms);
  user("앞 질문", -60_000);
  reply([{ type: "text", text: "앞 답" }], "end_turn", -59_000);
  hook({ hook_event_name: "SessionStart", transcript_path: tr, source: "resume" });
  await sleep(1500);
  ok(working === false, "6) 대화 기록을 처음 읽을 때는 켜지 않음");
  hook({ hook_event_name: "Stop" });
  await sleep(300);
  // 같은 차례의 늦게 적힌 줄(끝 훅보다 앞선 때), 슬래시 명령, 끝난 답
  put({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "late", content: "늦은 결과" }] } }, -2000);
  user("<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>");
  reply([{ type: "text", text: "끝난 답" }], "end_turn");
  await sleep(2000);
  ok(working === false, "7) 끝 훅 앞선 늦은 줄·슬래시 명령·끝난 답으로는 켜지 않음");
  // 사람 글(시작 훅 없이)
  user("새 질문");
  ok(Boolean(await waitFor(() => working === true, 3000)), "8) 시작 훅 없이 사람 글이 기록되면 작업 중");
  ok(Boolean(await waitFor(() => /대화 기록이 이어져 작업 중으로/.test(log()), 3000)), "8) 기록에 까닭을 적음");
  hook({ hook_event_name: "Stop" });
  await waitFor(() => working === false, 3000);
  // 뒤에서 돌던 작업이 끝났다는 알림(대화에는 안 보임)으로 새 차례
  put({ type: "user", origin: { kind: "task-notification" }, message: { role: "user", content: "<task-notification>끝</task-notification>" } });
  ok(Boolean(await waitFor(() => working === true, 3000)), "9) 작업 끝 알림으로 새 차례가 시작되면 작업 중");
  hook({ hook_event_name: "Stop" });
  await waitFor(() => working === false, 3000);
  // 도구 호출 조각(훅 없이)
  reply([{ type: "tool_use", id: "t9", name: "Bash", input: { command: "ls" } }], "tool_use");
  ok(Boolean(await waitFor(() => working === true, 3000)), "9) 도구 호출이 기록되면 작업 중");
  hook({ hook_event_name: "Stop" });
  ok(Boolean(await waitFor(() => working === false, 3000)), "9) 끝 훅 → 쉬는 중");

  // 10) 질문 훅 없이 대화 기록에 질문 호출이 적히면 폰 질문 카드(11-14 사용자 보고 '왜 푸시로 물어보지 않나')
  mode("ask");
  const q = { questions: [{ question: "스매시가 약하게 느껴지는 것은?", options: [{ label: "닿는 거리", description: "" }, { label: "한 방의 세기", description: "" }], multiSelect: true }] };
  reply([{ type: "tool_use", id: "q10", name: "AskUserQuestion", input: q }], "tool_use");
  ok(Boolean(await waitFor(() => asked.includes("cc-q-q10"), 3000)), "10) 질문 훅 없이 기록된 질문 호출로 질문 카드를 엶");
  ok(tm("show-options", "-w", "-v", "-t", pane, "@pi_status") === "asking", "10) 탭 점은 답을 기다림(보라)");
  hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q10", tool_input: q });
  await sleep(800);
  ok(asked.filter((x) => x === "cc-q-q10").length === 1, "10) 늦게 온 질문 훅으로 카드를 다시 열지 않음(푸시도 한 번)");
  await sleep(3500);
  ok(!askDone.includes("cc-q-q10"), "10) 맥 화면에 질문 창이 떠 있는 동안 카드 유지");
  put({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "q10", content: "User has answered" }] } });
  ok(Boolean(await waitFor(() => askDone.includes("cc-q-q10"), 3000)), "10) 답이 기록되면 카드를 닫음");
  mode("still");
  hook({ hook_event_name: "Stop" });
  await waitFor(() => working === false, 3000);
  // 끝 훅보다 앞선 질문 호출(같은 차례의 늦은 줄)이나 이미 답한 질문으로는 열지 않음
  reply([{ type: "tool_use", id: "q11", name: "AskUserQuestion", input: q }], "tool_use", -3000);
  // 질문과 그 답을 한 번에 씀(연결부가 같이 읽음)
  appendFileSync(tr, `${[
    { type: "assistant", message: { id: "m12", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "q12", name: "AskUserQuestion", input: q }], stop_reason: "tool_use" } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "q12", content: "답함" }] } },
  ].map((o) => JSON.stringify({ uuid: `x${++n}`, timestamp: at(0), ...o })).join("\n")}\n`);
  await sleep(1500);
  ok(!asked.includes("cc-q-q11") && !asked.includes("cc-q-q12"), "10) 끝 훅 앞선 질문 줄·같이 읽힌 답이 있는 질문으로는 열지 않음");
  hook({ hook_event_name: "Stop" });
  await waitFor(() => working === false, 3000);

  // 12) 묻는 알림은 하나만(11-15 사용자 보고 '질문이 두세 개면 알림도 두세 개'): 시험이 알림 소켓을 열어 받은 알림을 셈
  const pushes = [];
  const notifySrv = createServer((s) => {
    let b = "";
    s.setEncoding("utf8");
    s.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\n")) >= 0) { try { pushes.push(JSON.parse(b.slice(0, i))); } catch { /* 반쪽 */ } b = b.slice(i + 1); } });
  });
  await new Promise((r) => notifySrv.listen(`${HOME}/.cache/pi-remote/notify-${S}.sock`, r));
  mode("ask");
  await sleep(700);
  const q3 = { questions: [0, 1, 2].map((k) => ({ question: `질문 ${k + 1}번?`, options: [{ label: "가", description: "" }, { label: "나", description: "" }], multiSelect: false })) };
  hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q30", tool_input: q3 });
  hook({ hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion", tool_use_id: "q30", tool_input: q3 });
  hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q31", tool_input: q });   // 같은 응답의 둘째 질문
  ok(Boolean(await waitFor(() => asked.includes("cc-q-q30"), 3000)), "12) 첫 질문 카드가 열림");
  await sleep(700);
  ok(!asked.includes("cc-q-q31"), "12) 둘째 질문 카드는 첫 카드가 닫힐 때까지 기다림(맥도 질문 창을 하나씩 띄움)");
  ok(pushes.length === 1 && pushes[0].kind === "choice" && /^질문 3개 · 질문 1번\?/.test(pushes[0].body), `12) 질문 호출이 연달아 와도 알림은 하나, 질문 수를 보임(${JSON.stringify(pushes.map((p) => p.body))})`);
  await sleep(6000);   // Claude Code 는 창이 뜨고 6~7초 뒤 같은 일로 '입력이 필요함'을 또 보냄
  hook({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your input" });
  await sleep(800);
  ok(pushes.length === 1, `12) 카드가 떠 있는 동안 온 '입력이 필요함'은 알리지 않음(알림 ${pushes.length}개)`);
  hook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "q30", tool_input: q3, tool_response: {} });
  ok(Boolean(await waitFor(() => askDone.includes("cc-q-q30") && asked.includes("cc-q-q31"), 3000)), "12) 첫 질문에 답하면 둘째 질문 카드가 열림");
  await sleep(500);
  ok(pushes.length === 1, `12) 이어서 열린 카드는 알림을 다시 보내지 않음(방금 답했으므로, 알림 ${pushes.length}개)`);
  hook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "q31", tool_input: q, tool_response: {} });
  await waitFor(() => askDone.includes("cc-q-q31"), 3000);
  hook({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission" });
  ok(Boolean(await waitFor(() => pushes.length === 2, 3000)) && pushes[1].kind === "approval", `12) 카드가 없을 때(연결부가 모르는 창)의 '입력이 필요함'은 알림(${pushes.length}개)`);
  // 기다리던 질문이 먼저 끝나면(대화 기록·훅으로 결과를 먼저 봄) 앞 카드가 닫혀도 열지 않음
  hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q32", tool_input: q });
  hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q33", tool_input: q });
  await waitFor(() => asked.includes("cc-q-q32"), 3000);
  hook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "q33", tool_input: q, tool_response: {} });
  hook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "q32", tool_input: q, tool_response: {} });
  await waitFor(() => askDone.includes("cc-q-q32"), 3000);
  await sleep(500);
  ok(!asked.includes("cc-q-q33"), "12) 기다리던 질문이 먼저 끝났으면 그 카드는 열지 않음");
  // 14) 창이 늦게 그려짐: 훅 뒤 4.5초 동안 화면에 창이 없어도 카드는 남고, 창이 뜬 뒤 사라지면 그때 닫음
  mode("still");
  await sleep(1000);
  const q40 = { questions: [{ question: "늦게 뜨는 창?", options: [{ label: "가", description: "" }, { label: "나", description: "" }], multiSelect: false }] };
  hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q40", tool_input: q40 });
  ok(Boolean(await waitFor(() => asked.includes("cc-q-q40"), 3000)), "14) 질문 카드가 열림(맥 창은 아직 안 그려짐)");
  await sleep(4500);
  ok(!askDone.includes("cc-q-q40"), "14) 맥 창이 늦게 그려져도(4.5초) 질문 카드를 지우지 않음");
  mode("ask");
  await sleep(2500);
  ok(!askDone.includes("cc-q-q40"), "14) 맥 창이 뜬 동안 질문 카드 유지");
  mode("still");
  ok(Boolean(await waitFor(() => askDone.includes("cc-q-q40"), 6000)), "14) 뜬 창이 사라지면(맥에서 답함) 질문 카드를 닫음");
  const nA = approved.length;
  hook({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_use_id: "a40", tool_input: { command: "rm -rf /tmp/x", description: "지우기" } });
  const a40 = await waitFor(() => approved[nA], 3000);
  ok(Boolean(a40), "14) 승인 카드가 열림(맥 창은 아직 안 그려짐)");
  await sleep(4500);
  ok(Boolean(a40) && !approveDone.includes(a40), "14) 맥 창이 늦게 그려져도 승인 카드를 지우지 않음");
  mode("ask");
  await sleep(2500);
  mode("still");
  ok(Boolean(await waitFor(() => approveDone.includes(a40), 6000)), "14) 뜬 승인 창이 사라지면 승인 카드를 닫음");
  mode("still");
  hook({ hook_event_name: "Stop" });
  await waitFor(() => working === false, 3000);
  // 연결부는 같은 훅이 1.5초 안에 또 오면 중복으로 버린다: 아래에서 끝 훅을 다시 보내기 전에 그보다 길게 쉼(위 끝 훅의 알림도 그사이 다 옴)
  const GAP = 1800;
  await sleep(GAP);

  // 13) 단축어로 시킨 탭(@bg_by shortcut, 시킨 칸 없음. 폰의 단축어 동작이 연 탭): 끝나면 걸린 시간과 상관없이
  //     백그라운드 끝남 알림을 보내고 끝난 때를 적는다(서랍에 '끝남'). 그 뒤 차례의 끝은 보통 탭처럼 알림
  for (const [k, v] of [["@bg_origin", ""], ["@bg_from", ""], ["@bg_by", "shortcut"], ["@bg_name", "bg 단축어 일"]]) tm("set-option", "-w", "-t", pane, k, v);
  const n13 = pushes.length;
  user("빌드가 깨졌는지 확인해 줘");
  reply([{ type: "text", text: "빌드를 고쳤습니다.\n시험도 모두 통과했습니다." }], "end_turn");
  await waitFor(() => working === true, 3000);
  hook({ hook_event_name: "Stop" });
  const p13 = await waitFor(() => pushes.slice(n13).find((p) => /^백그라운드 작업이 끝났어요/.test(p.title ?? "")), 4000);
  ok(p13?.kind === "done" && p13.title === "백그라운드 작업이 끝났어요: bg 단축어 일" && p13.background === true && p13.body === "빌드를 고쳤습니다.",
    `13) 단축어로 시킨 일이 끝나면 걸린 시간과 상관없이 알림(${JSON.stringify(p13 ?? pushes.slice(n13))})`);
  ok(Boolean(await waitFor(() => Number(tm("show-options", "-w", "-v", "-t", pane, "@bg_done")) > 0, 3000)), "13) 끝난 때를 적음");
  await sleep(GAP);
  const n13b = pushes.length;
  hook({ hook_event_name: "Stop" });
  const p13b = await waitFor(() => pushes.slice(n13b).find((p) => p.kind === "done"), 4000);
  ok(/^작업이 끝났어요/.test(p13b?.title ?? "") && !p13b?.background, `13) 그 뒤 차례의 끝은 보통 알림(${p13b?.title})`);
  for (const k of ["@bg_origin", "@bg_from", "@bg_by", "@bg_name", "@bg_done"]) tm("set-option", "-w", "-u", "-t", pane, k);
  notifySrv.close();

  // 11) 연결부가 새로 뜰 때: 맥에 질문 창이 떠 있으면 답이 없는 마지막 질문을 카드로, 창이 없으면 열지 않음
  feed.kill();
  c.destroy();
  await sleep(500);
  reply([{ type: "tool_use", id: "q20", name: "AskUserQuestion", input: q }], "tool_use");
  const fresh = async () => {
    const f = spawn(process.execPath, [FEED, pane], { env: { ...process.env, HOME, PI_REMOTE_IDLE_CHECK_MS: "1000" }, stdio: "ignore" });
    await sleep(1200);
    const got = [];
    const s = createConnection(SOCK);
    let b = "";
    s.setEncoding("utf8");
    s.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\n")) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); try { const m = JSON.parse(l); if (m.t === "question") got.push(m.question.id); if (m.t === "snapshot") got.push(...(m.questions ?? []).map((x) => x.id)); } catch { /* 반쪽 줄 */ } } });
    s.on("error", () => {});
    await new Promise((r) => s.on("connect", r));
    s.write(`${JSON.stringify({ cmd: "hook", event: { hook_event_name: "Notification", notification_type: "idle_prompt", transcript_path: tr } })}\n`);
    await sleep(1500);
    s.destroy();
    f.kill();
    await sleep(500);
    return got;
  };
  mode("still");
  await sleep(700);
  ok((await fresh()).length === 0, "11) 새로 뜰 때 맥에 질문 창이 없으면 답 없는 질문이 있어도 카드를 열지 않음");
  mode("ask");
  await sleep(700);
  const got11 = await fresh();
  ok(got11.includes("cc-q-q20") && !got11.includes("cc-q-q11"), `11) 새로 뜰 때 맥에 질문 창이 떠 있으면 답 없는 마지막 질문만 카드로(${[...new Set(got11)].join(",")})`);
} finally {
  c.destroy();
  feed.kill();
  spawnSync("pkill", ["-f", `claude-feed\\.mjs ${pane}$`]);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
