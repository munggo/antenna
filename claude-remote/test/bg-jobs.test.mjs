// 뒤에서 도는 작업 목록·종료(앱 서랍의 '백그라운드 작업 N'을 누르면 보이는 것) 시험(모델을 부르지 않음, 20초쯤):
// 1) 대화 기록으로 목록: 셸(최근 출력 포함)·에이전트·감시. 끝 알림·멈춤 도구로 끝난 것, 출력 파일을 연 프로세스가 없는 셸은 뺌.
//    감시의 이벤트 알림(끝 아님)으로는 빼지 않음
// 2) 셸 종료: 이 칸 Claude Code 가 띄운 셸의 프로세스 묶음만 종료(칸 밖에서 같은 파일을 연 프로세스는 그대로)
// 3) 에이전트 종료: Claude 에게 TaskStop 으로 종료해 달라는 글을 보냄  4) 없는 작업은 '이미 끝났어요'
// 5) Claude Code 를 켜기 전에 시작한 에이전트·감시는 뺌(세션 파일의 켠 때)
// 6) 하위 에이전트의 종류·모델·생각 깊이(요즘 판은 run_in_background 없이 결과의 isAsync·resolvedModel, 깊이는 문서 순서),
//    끝까지 기다린 하위 에이전트는 넣지 않음, 맥 화면 한 줄(@ai_bg_line): 이 칸이 맡긴 아직 일하는 백그라운드 탭과 에이전트
// 시험 세션(bgjobstest)·가짜 홈을 만들고 끝나면 지운다. 쓰는 tmux 세션과 쓰는 연결부는 건드리지 않는다.
// 실행: node claude-remote/test/bg-jobs.test.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FEED = join(dirname(fileURLToPath(import.meta.url)), "..", "claude-feed.mjs");
const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");   // 가짜 Claude Code(셸을 진짜처럼 띄움)
const S = "bgjobstest", ROOT = `/tmp/antenna-bgjobs-${process.pid}`, HOME = `${ROOT}/home`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 200) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
mkdirSync(`${ROOT}/bin`, { recursive: true });
const OUT = `${ROOT}/job.output`, TYPED = `${ROOT}/typed.txt`;   // 가짜 Claude Code 가 띄운 셸의 출력, 칸에 붙여 넣은 글
writeFileSync(`${ROOT}/bsh3.output`, "끝난 뒤 남은 출력\n");   // 여는 프로세스가 없는 셸 출력(끝 알림을 못 받은 경우)
const fakeBin = `${ROOT}/bin/9.9.9`;
try { linkSync(process.execPath, fakeBin); } catch { symlinkSync(process.execPath, fakeBin); }

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
tm("send-keys", "-t", pane, "-l", `exec ${fakeBin} ${FAKE} ${ROOT}`);
tm("send-keys", "-t", pane, "Enter");
await waitFor(() => /^\d+\.\d+\.\d+$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), 5000);
// 셸 하나를 띄움(출력 두 줄 뒤 오래 잠듦)
// 끝의 ':' 는 zsh 가 마지막 명령을 자기 자리에서 실행하지 않게(진짜 Claude Code 셸도 명령 뒤에 할 일이 있어 셸이 남는다)
writeFileSync(`${ROOT}/cmd`, "echo 진행 1; echo 진행 2; sleep 300; :");
await waitFor(() => existsSync(`${ROOT}/shell.pid`), 3000);
const shellPid = Number(readFileSync(`${ROOT}/shell.pid`, "utf8"));
await sleep(300);
const sleeper = Number(execFileSync("pgrep", ["-P", String(shellPid)], { encoding: "utf8" }).trim().split("\n")[0] || 0);
// 칸 밖에서 같은 출력 파일을 연 프로세스(끄면 안 됨)
const outsider = spawn("tail", ["-f", OUT], { stdio: "ignore" });

const tag = pane.replace(/\W/g, "");
const SOCK = `${HOME}/.cache/pi-remote/feed/${tag}.sock`;
// 6) 시킨 쪽 세션 깊이(브리지가 상태 줄에서 읽어 적는 값)와 깊이가 적힌 사용자 정의 에이전트
tm("set-option", "-w", "-t", pane, "@ai_thinking", "xhigh");
mkdirSync(`${HOME}/.claude/agents`, { recursive: true });
writeFileSync(`${HOME}/.claude/agents/reviewer.md`, "---\nname: reviewer\ndescription: 검토\neffort: max\n---\n검토해 주세요\n");
const env = { ...process.env, HOME, PI_REMOTE_JOBS_TICK_MS: "400" };
delete env.CLAUDE_CODE_EFFORT_LEVEL;
const feed = spawn(process.execPath, [FEED, pane], { env, stdio: "ignore" });
await waitFor(() => existsSync(SOCK), 5000);

// 대화 기록
const tr = `${HOME}/t.jsonl`;
let n = 0;
const T0 = Date.now();   // 대화 기록 시각의 기준
const at = (ms) => new Date(T0 + ms).toISOString();
const put = (o, ms = -60_000) => appendFileSync(tr, `${JSON.stringify({ uuid: `x${++n}`, timestamp: at(ms), ...o })}\n`);
const call = (id, name, input, ms) => put({ type: "assistant", message: { id: `m${id}`, model: "claude-opus-5-5", content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" } }, ms);
const result = (id, text, r, ms) => put({ type: "user", toolUseResult: r, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } }, ms);
const note = (id, status) => put({ type: "queue-operation", operation: "enqueue", content: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>끝</summary>\n</task-notification>` });
const bgText = (id, out) => `Command running in background with ID: ${id}. Output is being written to: ${out}. You will be notified when it completes.`;
call("tb1", "Bash", { command: "echo 진행; sleep 300", description: "긴 시험 돌리기", run_in_background: true }, -50_000);
result("tb1", bgText("bsh1", OUT), { backgroundTaskId: "bsh1" }, -50_000);
call("ta1", "Agent", { description: "엔진 조사", prompt: "조사", subagent_type: "general-purpose", run_in_background: true }, -40_000);
result("ta1", "Async agent launched successfully.\nagentId: aag1", { isAsync: true, status: "async_launched", agentId: "aag1", outputFile: `${ROOT}/aag1.output` }, -40_000);
// 6) 요즘 판: 부를 때 run_in_background 가 없고, 결과에 isAsync·resolvedModel 이 옴
const launched = (agentId, resolvedModel) => ({ isAsync: true, status: "async_launched", agentId, resolvedModel, outputFile: `${ROOT}/${agentId}.output` });
const agentCall = (id, agentId, input, model, ms) => {
  call(id, "Agent", { description: input.description, prompt: "x", ...input }, ms);
  result(id, `Async agent launched successfully.\nagentId: ${agentId}`, launched(agentId, model), ms);
};
agentCall("ta3", "aag3", { description: "같은 모델", subagent_type: "general-purpose" }, "claude-opus-5-5", -39_500);
agentCall("ta4", "aag4", { description: "다른 모델", subagent_type: "Explore" }, "claude-haiku-5-5", -39_000);
agentCall("ta5", "aag5", { description: "깊이 지정", subagent_type: "Explore", effort: "low" }, "claude-haiku-5-5", -38_500);
agentCall("ta6", "aag6", { description: "갈래", subagent_type: "fork" }, "claude-opus-5-5", -38_000);
call("ta7", "Agent", { description: "끝까지 기다림", prompt: "x", subagent_type: "general-purpose" }, -37_500);
result("ta7", "다 했어요", { status: "completed", agentId: "aag7", resolvedModel: "claude-opus-5-5" }, -37_500);
agentCall("ta8", "aag8", { description: "정의에 깊이", subagent_type: "reviewer" }, "claude-haiku-5-5", -37_000);
call("tm1", "Monitor", { command: "tail -f x", description: "빌드 지켜보기" }, -30_000);
result("tm1", "Monitor started (task bmo1)", { taskId: "bmo1" }, -30_000);
call("tb2", "Bash", { command: "ls", description: "끝난 셸", run_in_background: true });
result("tb2", bgText("bsh2", `${ROOT}/bsh2.output`), { backgroundTaskId: "bsh2" });
note("bsh2", "completed");
call("ta2", "Agent", { description: "멈춘 에이전트", prompt: "x", run_in_background: true });
result("ta2", "Async agent launched successfully.\nagentId: aag2", { isAsync: true, agentId: "aag2" });
call("ts2", "TaskStop", { task_id: "aag2" });
result("ts2", "{\"message\":\"Successfully stopped task: aag2\"}", { message: "Successfully stopped task: aag2", task_id: "aag2", task_type: "local_agent" });
note("bmo1", "event");   // 감시의 이벤트 알림: 끝이 아님
call("tb3", "Bash", { command: "ls", description: "알림 없이 끝난 셸", run_in_background: true });
result("tb3", bgText("bsh3", `${ROOT}/bsh3.output`), { backgroundTaskId: "bsh3" });

let jobs = null;
const notices = [];
const c = createConnection(SOCK);
let buf = "";
c.setEncoding("utf8");
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(l); if (m.t === "bg-jobs") jobs = m.jobs; if (m.t === "notice") notices.push(m.text); } catch { /* 반쪽 줄 */ }
  }
});
c.on("error", () => {});
await new Promise((r) => c.on("connect", r));
const cmd = (o) => c.write(`${JSON.stringify(o)}\n`);
const ask = async () => { jobs = null; cmd({ cmd: "bg-jobs" }); return waitFor(() => jobs, 4000); };

try {
  cmd({ cmd: "hook", event: { hook_event_name: "SessionStart", transcript_path: tr, source: "resume" } });
  await sleep(1200);
  const list = (await ask()) ?? [];
  const ids = list.map((j) => j.id).join(",");
  ok(ids === "bsh1,aag1,aag3,aag4,aag5,aag6,aag8,bmo1", `1) 목록은 도는 셸·에이전트·감시만, 시작 순(${ids})`);
  const s1 = list.find((j) => j.id === "bsh1");
  ok(s1?.kind === "shell" && s1.title === "긴 시험 돌리기" && /진행 2/.test(s1.tail ?? ""), `1) 셸: 이름은 설명, 최근 출력(${JSON.stringify(s1?.tail)})`);
  const a1 = list.find((j) => j.id === "aag1");
  ok(a1?.kind === "agent" && a1.title === "엔진 조사" && !("tail" in a1) && a1.startedAt < Date.now() - 30_000, "1) 에이전트: 이름·시작한 때(출력은 없음)");
  ok(list.find((j) => j.id === "bmo1")?.kind === "monitor", "1) 감시: 이벤트 알림으로는 빼지 않음");
  ok(!/bsh2|aag2|bsh3/.test(ids), "1) 끝 알림·멈춤 도구로 끝난 것, 출력 파일을 연 프로세스가 없는 셸은 뺌");

  // 6) 하위 에이전트의 종류·모델·생각 깊이
  const info = (id) => { const j = list.find((x) => x.id === id) ?? {}; return `${j.agentType}|${j.model}|${j.thinking}`; };
  ok(info("aag3") === "general-purpose|Opus 5.5|xhigh", `6) 같은 모델이면 시킨 쪽 세션 깊이(${info("aag3")})`);
  ok(info("aag4") === "Explore|Haiku 5.5|", `6) 다른 모델에 지정이 없으면 깊이는 모름(${info("aag4")})`);
  ok(info("aag5") === "Explore|Haiku 5.5|low", `6) 부를 때 적은 깊이(${info("aag5")})`);
  ok(info("aag6") === "fork|Opus 5.5|xhigh", `6) 갈래는 시킨 쪽 깊이(${info("aag6")})`);
  ok(info("aag8") === "reviewer|Haiku 5.5|max", `6) 사용자 정의 에이전트의 깊이(${info("aag8")})`);
  ok(info("aag1") === "general-purpose||", `6) 예전 판 기록(결과에 모델 없음)은 모델·깊이를 비움(${info("aag1")})`);
  ok(!/aag7/.test(ids), "6) 끝까지 기다린 하위 에이전트는 뒤에서 도는 일이 아님");
  ok(!("model" in (list.find((j) => j.id === "bsh1") ?? {})), "6) 셸에는 모델이 없음");

  // 6) 맥 화면 한 줄: 이 칸이 맡긴 백그라운드 탭(아직 일하거나 다시 일하는 것만)과 에이전트
  const bgWin = (name, opts) => {
    const p = tm("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", `${S}:`, "-n", name);
    for (const [k, v] of Object.entries(opts)) tm("set-option", "-w", "-t", p, k, String(v));
  };
  const now = Math.floor(Date.now() / 1000);
  bgWin("bg 하네스 조사", { "@bg_from": pane, "@bg_by": "ai", "@bg_started": now, "@ai_model": "Opus 5.5", "@ai_thinking": "high" });
  bgWin("bg 끝난 일", { "@bg_from": pane, "@bg_by": "ai", "@bg_started": now, "@bg_done": now, "@ai_model": "Opus 5.5" });
  bgWin("bg 다시 일함", { "@bg_from": pane, "@bg_by": "user", "@bg_done": now, "@pi_status": "working" });
  bgWin("bg 남의 일", { "@bg_from": "%999999", "@bg_by": "user", "@ai_model": "Opus 5.5" });
  const lineNow = () => tm("show-options", "-w", "-v", "-t", pane, "@ai_bg_line") ?? "";
  const bgl = await waitFor(() => (/하네스 조사/.test(lineNow()) ? lineNow() : ""), 5000);
  ok(bgl.startsWith("백그라운드: 하네스 조사 Opus 5.5 높음 · 다시 일함 · "), `6) 줄 앞: 맡긴 탭의 모델·깊이, 다시 일하는 탭(${bgl.slice(0, 60)}…)`);
  ok(!/끝난 일|남의 일/.test(bgl), "6) 결과를 보내고 쉬는 탭, 다른 탭이 맡긴 탭은 뺌");
  ok(["에이전트 general-purpose Opus 5.5 매우 높음", "에이전트 Explore Haiku 5.5 · ", "에이전트 Explore Haiku 5.5 낮음", "에이전트 fork Opus 5.5 매우 높음", "에이전트 reviewer Haiku 5.5 최대"].every((s) => bgl.includes(s)),
    `6) 에이전트마다 종류·모델·깊이(${bgl})`);

  // 2) 셸 종료
  ok(alive(shellPid) && alive(sleeper) && alive(outsider.pid), "2) 종료 전: 셸·그 안 명령·칸 밖 프로세스가 돎");
  notices.length = 0;
  jobs = null;
  cmd({ cmd: "bg-job-kill", id: "bsh1" });
  await waitFor(() => jobs, 6000);
  ok(!alive(shellPid) && !alive(sleeper), "2) 셸과 그 안에서 돌던 명령이 종료됨");
  ok(alive(outsider.pid), "2) 칸 밖에서 같은 출력 파일을 연 프로세스는 그대로");
  ok(notices.some((t) => /'긴 시험 돌리기' 작업을 종료했어요/.test(t)), `2) 종료했다는 안내(${notices.join(" / ")})`);
  // 종료 답에 실린 목록은 강제로 끈 직후에 만든 것이라 그 셸이 아직 남아 보일 때가 있다(11-16 전체 시험에서 한 번). 남았으면 다시 물어 봄
  for (let i = 0; i < 3 && Array.isArray(jobs) && jobs.some((j) => j.id === "bsh1"); i++) {
    await sleep(700);
    await ask();
  }
  ok(Array.isArray(jobs) && !jobs.some((j) => j.id === "bsh1"), "2) 새 목록에서 빠짐");

  // 3) 에이전트 종료: Claude 에게 종료해 달라고 보냄
  notices.length = 0;
  jobs = null;
  cmd({ cmd: "bg-job-kill", id: "aag1" });
  await waitFor(() => jobs, 4000);
  const typed = await waitFor(() => (existsSync(TYPED) ? readFileSync(TYPED, "utf8") : ""), 3000);
  ok(/TaskStop/.test(typed) && /aag1/.test(typed) && /엔진 조사/.test(typed) && /종료해 주세요/.test(typed), "3) 에이전트는 Claude 에게 TaskStop 으로 종료해 달라는 글을 보냄");
  ok(notices.some((t) => /종료해 달라고 보냈어요/.test(t)), `3) 보냈다는 안내(${notices.join(" / ")})`);

  // 4) 없는 작업
  notices.length = 0;
  jobs = null;
  cmd({ cmd: "bg-job-kill", id: "없는작업" });
  // 안내 뒤에 새 목록도 옴(다음 단계가 이 목록을 제 답으로 받지 않게 끝까지 기다림)
  ok(Boolean(await waitFor(() => notices.some((t) => /이미 끝났어요/.test(t)) && jobs, 4000)), "4) 없는 작업은 '이미 끝났어요'");

  // 5) Claude Code 를 켜기 전에 시작한 에이전트·감시는 뺌(세션 파일의 켠 때)
  mkdirSync(`${HOME}/.claude/sessions`, { recursive: true });
  const sess = `${HOME}/.claude/sessions/${tm("display", "-p", "-t", pane, "#{pane_pid}")}.json`;
  writeFileSync(sess, JSON.stringify({ sessionId: "s", startedAt: T0 - 35_000 }));   // 에이전트(T0-40초) 뒤, 감시(T0-30초) 앞
  const ids5 = ((await ask()) ?? []).map((j) => j.id).join(",");
  ok(ids5 === "bmo1", `5) 켜기 전에 시작한 에이전트는 빼고 그 뒤 감시만(${ids5})`);
} finally {
  c.destroy();
  feed.kill();
  outsider.kill();
  try { process.kill(-shellPid, "SIGKILL"); } catch { /* 이미 끝남 */ }
  spawnSync("pkill", ["-f", `claude-feed\\.mjs ${pane}$`]);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
