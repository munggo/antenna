// Claude Code 화면 일하는 중 판단(screenBusy) 시험. 실행: node claude-remote/test/screen-busy-cases.mjs
const { screenBusy, backgroundShown, backgroundJobs, aboveInput, typedOnPrompt, agentPanel, shownMode, mergeJobs, compactingFor } = await import(new URL("../claude-feed.mjs", import.meta.url).pathname);
const box = (above, mode) => `${above}\n──────\n❯ \n──────\n  ~/works/personal/game [main] Fable 5.2 (max) · 개인 주 64%\n  ${mode}`;
// 모드 줄 아래에 붙는 하위 에이전트 목록(2.1.32x, 11-17 실제 화면의 모양. 글은 지어낸 것): 이 대화(main)와 하위 에이전트 줄들, 다섯을 넘으면 '↓ N more'
const agentRow = (kind, what, took, mark = "◯") => `  ${mark} ${kind}  ${what}${" ".repeat(40)}${took} · ↓ 53.1k tokens`;
const FIVE = [1, 2, 3, 4, 5].map((i) => agentRow("general-purpose", `자료 ${i} 찾는 중`, "7m 30s"));
const withPanel = (scr, ...rows) => `${scr}\n\n${rows.join("\n")}\n`;
const EIGHT = ["  ⏺ main", ...FIVE, "  ↓ 3 more"];   // 여덟이 도는 목록
const TWO = ["  ⏺ main", agentRow("general-purpose", "화면 살피는 중", "4s"), agentRow("Explore", "파일 찾는 중", "3s")];
const cases = [
  [box("✶ Whisking… (56m 34s · ↓ 295.3k tokens · thinking more with max effort)\n  ⎿  Tip: Use /clear to start fresh", "⏵⏵ auto mode on (shift+tab to cycle) · ⧉ 14"), true, "자동 모드·백그라운드 표시, 진행 줄"],
  [box("✢ Pondering… (3s)", "⏸ manual mode on · esc to interrupt"), true, "매번 묻기 모드 줄의 esc to interrupt"],
  [box("✻ Thinking… (1h 2m 5s · ↓ 1.2k tokens)", "⏵⏵ auto mode on"), true, "1시간 넘는 진행 줄"],
  [box("* Sautéed for 7m 38s · done 8:36 PM\n● Compacted while idle, before the prompt cache expired", "⏵⏵ auto mode on (shift+tab to cycle) · ⧉ 11"), false, "끝난 줄 + 쉬는 동안 압축(사용자 스크린샷)"],
  [box("✻ Cooked for 2s · done 10:00 PM", "⏸ manual mode on · ? for shortcuts"), false, "끝난 줄"],
  [`✶ Whisking… (3s)\n${"답 줄\n".repeat(20)}❯ \n  ⏸ manual mode on · ? for shortcuts`, false, "진행 줄이 아래 12줄 밖(오래된 글)"],
  ["", false, "빈 화면"],
  // 11-14 이 탭을 0.5초마다 읽어 모은 화면: 훅이 도는 동안에는 괄호가 시간 대신 'running … hooks…' 로 시작
  [box("✢ Cooking… (running PostToolUse hooks… 1/2 · 8m 49s · ↓ 43.8k tokens)", "⏵⏵ auto mode on · 1 shell · 1 feedback draft"), true, "도구 끝 훅이 도는 중의 진행 줄"],
  [box("✽ Cooking… (running UserPromptSubmit hooks… 0/2 · 8m 49s · ↓ 43.8k tokens)", "⏵⏵ auto mode on · 1 shell"), true, "입력 훅이 도는 중의 진행 줄"],
  [box("✢ Cooking… (running PreToolUse hooks… 1/2 · 9m 21s · ↓ 46.8k tokens · thought for 29s)", "⏵⏵ auto mode on"), true, "도구 시작 훅이 도는 중(생각 시간도 붙음)"],
  [box("✻ Thinking… (running Stop hooks… 0/2 · 1h 2m 5s)", "⏵⏵ auto mode on"), true, "1시간 넘게 일하는 중에 훅이 도는 진행 줄"],
  [box("✻ Loading… (1/2)\n* Sautéed for 7m 38s · done 8:36 PM", "⏵⏵ auto mode on"), false, "괄호 안에 시간이 없는 줄과 끝난 줄은 일하는 중이 아님"],
  // 11-17: 모드 줄 아래 하위 에이전트 목록이 길면 진행 줄이 아래 12줄 밖으로 밀림 → 목록을 떼고 봄
  [withPanel(box("· Cascading… (11m 43s · ↓ 65.9k tokens · thinking with max effort)", "⏵⏵ auto mode on · 1 shell · 2 feedback drafts"), ...EIGHT), true,
    "하위 에이전트 목록(일곱 줄)이 붙어도 진행 줄을 봄"],
  [withPanel(box("✻ Waiting for 8 background agents to finish", "⏵⏵ auto mode on (shift+tab to cycle) · ⧉ today"), ...EIGHT), false,
    "쉬면서 하위 에이전트를 기다리는 화면은 일하는 중이 아님"],
];
let bad = 0;
for (const [scr, want, name] of cases) if (screenBusy(scr) !== want) { bad++; console.log(`틀림: ${name}`); }
// 뒤에서 도는 작업 표시(계정 자동 전환이 끄지 않고 기다려야 하는 것): 맨 아래 두 줄의 '· N 낱말'
const status = (mode) => `답\n──────\n❯ \n──────\n  ~/works/company Fable 5.2 (max) · 회사 494K/1000K 49.5% 주 60% ▁▁▁▁▂▂█\n  ${mode}`;
const bg = [
  [status("⏵⏵ auto mode on · 1 shell"), "1 shell", "뒤에서 도는 셸 하나(11-13 회사 탭)"],
  [status("⏵⏵ auto mode on · 2 shells · ⧉ 3"), "2 shells", "셸 둘과 다른 표시"],
  [status("⏸ manual mode on · 1 feedback draft"), "1 feedback draft", "보내지 않은 피드백 초안"],
  [status("⏵⏵ auto mode on (shift+tab to cycle)"), null, "아무것도 없음"],
  [status("⏵⏵ auto mode on (shift+tab to cycle) · ⧉ 14"), null, "숫자만 있는 다른 표시(⧉)는 아님"],
  [status("⏵⏵ auto mode on · ← for agents"), null, "안내 글은 아님"],
  [`· 1 shell 이라는 글이 대화에 있음\n${"답 줄\n".repeat(5)}${status("⏵⏵ auto mode on")}`, null, "대화 속 같은 글은 보지 않음(맨 아래 두 줄만)"],
  // 11-17 실제 화면: 하위 에이전트 목록이 모드 줄 아래에 붙으면 맨 아래 두 줄이 목록 줄이라, 도는 셸도 에이전트도 없는 것으로 봤다
  [withPanel(status("⏵⏵ auto mode on · 1 shell · 2 feedback drafts"), ...TWO), "1 shell", "하위 에이전트 목록이 붙어 있어도 모드 줄의 셸을 찾음"],
  [withPanel(status("⏵⏵ auto mode on (shift+tab to cycle) · ⧉ today"), ...EIGHT), "8 agents", "목록의 하위 에이전트(다섯 줄 + 아래로 접힌 셋)도 끄면 안 되는 것"],
  [withPanel(status("⏵⏵ auto mode on"), "  ⏺ main", agentRow("Explore", "파일 찾는 중", "12s")), "1 agent", "하위 에이전트 하나"],
  [withPanel(status("⏵⏵ auto mode on · /tasks to see subagents"), "  ⏺ main"), null, "마지막 하위 에이전트가 막 끝나 이 대화만 남은 목록"],
  [status("⏵⏵ auto mode on · /tasks to see subagents"), null, "하위 에이전트가 끝난 뒤 남는 안내 글은 아님"],
];
for (const [scr, want, name] of bg) if (backgroundShown(scr) !== want) { bad++; console.log(`틀림: ${name} → ${backgroundShown(scr)}`); }
// 앱 서랍에 보일 '뒤에서 도는 일'(backgroundJobs): 아는 종류만 한국어로, 피드백 초안·다른 안내는 뺌
// TIP: 응답이 끝나면 Claude Code 가 모드 줄 아래에 띄우는 안내 창(11-14 시험 화면 그대로)
const TIP = [
  "  Teach auto mode about your environment?",
  "  Auto mode works better when it knows your environment. Takes about a minute.",
  "  ❯ 1. Yes", "    2. Not now", "    3. Don't show again",
  "  Enter to confirm · Esc to cancel",
].join("\n");
const jobs = [
  [status("⏵⏵ auto mode on · 1 shell"), "셸 1개", "셸 하나"],
  [status("⏵⏵ auto mode on · 2 shells · ⧉ 3"), "셸 2개", "셸 둘(복수형), 숫자만 있는 다른 표시는 뺌"],
  [status("⏵⏵ auto mode on · 1 shell · 2 local agents"), "셸 1개 · 에이전트 2개", "셸과 에이전트(두 낱말)"],
  [status("⏸ manual mode on · 3 background processes"), "프로세스 3개", "es 로 끝나는 복수형"],
  [status("⏸ manual mode on · 1 feedback draft"), "", "보내지 않은 피드백 초안은 도는 일이 아님"],
  [status("⏸ manual mode on · 1 feedback draft · 1 shell"), "셸 1개", "초안과 셸이 같이 있으면 셸만"],
  [status("⏵⏵ auto mode on · 1 MCP server failed"), "", "모르는 종류(MCP 안내)는 뺌"],
  [status("⏵⏵ auto mode on (shift+tab to cycle)"), "", "아무것도 없음"],
  [status("⏵⏵ auto mode on · ← for agents"), "", "안내 글은 아님"],
  [`· 1 shell 이라는 글이 대화에 있음\n${"답 줄\n".repeat(5)}${status("⏵⏵ auto mode on")}`, "", "대화 속 같은 글은 보지 않음(모드 줄만)"],
  [`${status("⏵⏵ auto mode on · 1 shell · ↓ to manage                                tmux focus-events off · add 'set -g f")}\n──────\n${TIP}`, "셸 1개",
    "모드 줄 아래에 안내 창이 떠 있어도 모드 줄을 찾아 읽음(11-14 시험 화면)"],
  [`⏺ Bash(sleep 40)\n  ⎿  Running in the background (↓ to manage)\n${status("⏵⏵ auto mode on · 2 shells · esc to interrupt · ← for agents · ↓ to manage")}`, "셸 2개",
    "일하는 중의 모드 줄(대화 쪽의 '↓ to manage' 줄은 모드 줄이 아님)"],
  [`⏵⏵ auto mode on · 1 shell 이라고 대화에 적힌 줄\n답 줄\n${status("⏵⏵ auto mode on (shift+tab to cycle)")}\n──────\n${TIP}`, "",
    "모드 줄은 맨 아래 쪽의 마지막 것(위쪽 대화에 같은 글이 있어도)"],
  ["", "", "빈 화면"],
  // 11-17 사용자 보고 '에이전트 8개가 도는데 서랍에 백그라운드 작업이 안 보임': 2.1.32x 는 에이전트 수를 모드 줄에 쓰지 않고 그 아래 목록으로만 보인다
  [withPanel(status("⏵⏵ auto mode on (shift+tab to cycle) · ⧉ today"), ...EIGHT), "에이전트 8개", "하위 에이전트 목록: 다섯 줄 + 아래로 접힌 셋"],
  [withPanel(status("⏵⏵ auto mode on · 1 shell · 2 feedback drafts"), ...TWO), "셸 1개 · 에이전트 2개", "모드 줄의 셸과 목록의 하위 에이전트"],
  [withPanel(status("⏵⏵ auto mode on · 1 shell · /tasks to see subagents · 2 feedback drafts"), "  ⏺ main", agentRow("general-purpose", "화면 살피는 중", "9s")), "셸 1개 · 에이전트 1개",
    "하나가 끝난 직후(안내 글 '/tasks to see subagents' 는 세지 않음)"],
  [status("⏵⏵ auto mode on · 1 shell · /tasks to see subagents · 2 feedback drafts"), "셸 1개", "하위 에이전트가 모두 끝나 목록이 사라진 뒤"],
  [withPanel(status("⏵⏵ auto mode on"), "  ◯ main", agentRow("Explore", "파일 찾는 중", "12s", "⏺"), agentRow("general-purpose", "자료 찾는 중", "40s")), "에이전트 2개",
    "목록에서 하위 에이전트를 고른 모양(기호가 바뀜)"],
  [withPanel(status("⏵⏵ auto mode on"), "  ↑ 2 more", agentRow("general-purpose", "자료 찾는 중", "1m 2s"), "  ↓ 1 more"), "에이전트 2개", "위로 접힌 것은 이 대화가 섞였을 수 있어 세지 않음"],
  [withPanel(status("⏵⏵ auto mode on · 1 shell · 3 local agents"), ...TWO), "셸 1개 · 에이전트 3개", "모드 줄에 수가 있으면(예전 판) 목록보다 큰 쪽"],
  [`⏺ 첫째 답\n⏺ 둘째 답\n◯ 대화에 적힌 줄`, "", "모드 줄 없이 '⏺'·'◯' 줄로 끝나는 화면은 목록이 아님"],
];
for (const [scr, want, name] of jobs) if (backgroundJobs(scr) !== want) { bad++; console.log(`틀림: ${name} → '${backgroundJobs(scr)}'`); }
// 하위 에이전트 목록 가려내기(agentPanel): 목록을 뗀 화면과 에이전트 수. 목록이 아니면 화면 그대로
const idle = status("⏵⏵ auto mode on (shift+tab to cycle) · ⧉ today");
const tipScreen = `${status("⏵⏵ auto mode on")}\n──────\n${TIP}`;
const panels = [
  [agentPanel(withPanel(idle, ...EIGHT)).screen, idle, "목록을 떼면 모드 줄로 끝나는 화면(그 사이 빈 줄도 뗌)"],
  [agentPanel(withPanel(idle, ...EIGHT)).agents, 8, "에이전트 수: 다섯 줄 + 아래로 접힌 셋(main 은 뺌)"],
  [agentPanel(idle).screen === idle && agentPanel(idle).agents, 0, "목록이 없으면 화면 그대로"],
  [agentPanel(tipScreen).screen === tipScreen && agentPanel(tipScreen).agents, 0, "모드 줄 아래 안내 창은 목록이 아님"],
  [agentPanel(`${idle}\n  모르는 안내 한 줄\n  ⏺ main\n${agentRow("Explore", "파일 찾는 중", "12s")}`).agents, 0, "'⏺'·'◯' 줄이 이어져도 바로 위가 모드 줄이 아니면 목록이 아님"],
  [agentPanel("").agents, 0, "빈 화면"],
];
for (const [got, want, name] of panels) if (got !== want) { bad++; console.log(`틀림: ${name} → ${JSON.stringify(got)}`); }
// 화면에 보이는 권한 모드(shownMode, 아래 4줄 안의 모드 줄). 고치기 전에는 목록이 네 줄을 넘으면 모드 줄을 못 봤다
const modes = [
  [status("⏸ manual mode on · ? for shortcuts"), "manual", "매번 묻기"],
  [status("⏵⏵ accept edits on (shift+tab to cycle)"), "acceptEdits", "편집 자동"],
  [status("⏸ plan mode on (shift+tab to cycle)"), "plan", "계획"],
  [status("⏵⏵ bypass permissions on"), "bypass", "묻지 않음"],
  [withPanel(idle, ...EIGHT), "auto", "하위 에이전트 목록이 붙어 있어도 모드를 읽음"],
  [withPanel(status("⏸ plan mode on"), ...TWO), "plan", "짧은 목록"],
  [tipScreen, null, "모드 줄 아래 안내 창이 떠 있으면 모름(그 창에 글을 넣지 않게)"],
  ["⏺ 답\n  Do you want to proceed?\n  ❯ 1. Yes\n    2. No\n  Esc to cancel", null, "확인 창(모드 줄이 없음)"],
  ["", null, "빈 화면"],
];
for (const [scr, want, name] of modes) if (shownMode(scr) !== want) { bad++; console.log(`틀림: ${name} → ${shownMode(scr)}`); }
// 서랍의 수: 화면에서 센 것에 대화 기록으로 아는 수를 합침(mergeJobs, 종류마다 큰 쪽)
const merged = [
  [mergeJobs("", { 에이전트: 8, 감시: 0 }), "에이전트 8개", "화면에서 못 센 에이전트를 기록의 수로"],
  [mergeJobs("셸 1개", { 에이전트: 2, 감시: 1 }), "셸 1개 · 에이전트 2개 · 감시 1개", "화면의 셸 + 기록의 에이전트·감시"],
  [mergeJobs("셸 1개 · 에이전트 3개", { 에이전트: 2 }), "셸 1개 · 에이전트 3개", "화면의 수가 더 크면 화면의 수"],
  [mergeJobs("에이전트 2개", { 에이전트: 2 }), "에이전트 2개", "같으면 한 번만"],
  [mergeJobs("셸 2개", {}), "셸 2개", "기록에 아무것도 없으면 화면 그대로"],
  [mergeJobs("셸 2개"), "셸 2개", "기록 값을 주지 않아도"],
  [mergeJobs("", { 에이전트: 0, 감시: 0 }), "", "둘 다 없으면 빈 글"],
];
for (const [got, want, name] of merged) if (got !== want) { bad++; console.log(`틀림: ${name} → '${got}'`); }
// 바로잡기가 '화면이 움직이는지' 볼 입력창 위쪽(aboveInput): 진행 줄이 바뀌면 다르고, 입력창·상태 줄·모드 줄만 바뀌면 같음
const LINE = "─".repeat(60);
const shot = (progress, input, usage, mode) => `⏺ 답\n${progress}\n${LINE}\n${input}\n${LINE}\n  ~/works/x [main] Opus 5.5 · 개인 ${usage}\n  ${mode}\n\n`;
const a1 = shot("✢ Cooking… (2m 16s · ↓ 10.1k tokens)", "❯ ", "15.3%", "⏵⏵ auto mode on");
const above = [
  [aboveInput(a1), "⏺ 답\n✢ Cooking… (2m 16s · ↓ 10.1k tokens)", "입력창 위쪽만 잘라 냄"],
  [aboveInput(a1) === aboveInput(shot("✢ Cooking… (2m 16s · ↓ 10.1k tokens)", "❯ 맥에서 치는 글\n  둘째 줄", "15.9%", "⏵⏵ auto mode on · 1 shell")), true,
    "입력창(여러 줄)·사용량·모드 줄만 바뀌면 같음(쉬는 중)"],
  [aboveInput(a1) === aboveInput(shot("✻ Cooking… (2m 17s · ↓ 10.1k tokens)", "❯ ", "15.3%", "⏵⏵ auto mode on")), false, "진행 줄의 시간·스피너가 바뀌면 다름(일하는 중)"],
  [aboveInput(`⏺ 답\n${LINE}\n❯ \n  ⏵⏵ auto mode on`), null, "입력창 테두리가 하나뿐이면 모름"],
  [aboveInput(""), null, "빈 화면"],
];
for (const [got, want, name] of above) if (got !== want) { bad++; console.log(`틀림: ${name} → ${JSON.stringify(got)}`); }
// 계정 전환 때 셸에 친 명령이 커서 바로 앞에 들어갔는지(typedOnPrompt). 첫 사례는 11-15 사용자 셸(오른쪽 프롬프트)에서 잡은
// 화면 모양 그대로(폴더·번호만 바꿈). 화면은 tmux 가 주는 모양: 한 줄이 창의 한 줄, 줄 끝 공백은 잘림
const CMD = "claude --resume 0b7d2c4e-5a61-4f3e-9c28-7d1e6a9f3b40 --permission-mode auto";
const P = " ~/works/game  feat/new-chapter  ";
const at = (x, y, width = 175) => ({ x, y, width });
const len = (s) => [...s].length;
// zsh 처럼 창 폭으로 접은 화면과 커서(두 칸 글자가 남은 칸에 안 들어가면 다음 줄로, 줄을 꽉 채우면 커서는 다음 줄 첫 칸)
const wide = (ch) => /[ᄀ-ᅟ⺀-꓏가-힣＀-｠]/.test(ch);
const wrap = (text, width) => {
  const rows = [""];
  let w = 0;
  for (const ch of text) {
    const k = wide(ch) ? 2 : 1;
    if (w + k > width) { rows.push(""); w = 0; }
    rows[rows.length - 1] += ch;
    w += k;
  }
  if (w === width) { rows.push(""); w = 0; }
  return [`${rows.map((r) => r.trimEnd()).join("\n")}\n\n\n`, at(w, rows.length - 1, width)];
};
// 50칸 창(11-15 전체 시험: 폰 크기를 따름)에서 네 줄로 접힌 실제 명령. 고치기 전(tmux 의 -J 로 잇기)에는 늘 실패
const LONG = "~/.claude/pi-remote/claude-as.sh work --resume 0b7d2c4e-5a61-4f3e-9c28-7d1e6a9f3b40 --model haiku --setting-sources project,local --settings /tmp/cctest-hooks.json --permission-mode manual";
const T = " /tmp/cctest  ";
// 프롬프트 길이를 n 칸씩 늘려 가며 조건에 맞는 프롬프트 찾기
const promptWhere = (ok) => {
  for (let n = 0; n < 50; n++) {
    const p = ` /tmp/${"x".repeat(n)}  `;
    if (ok(p, [...(p + LONG)])) return p;
  }
  return null;
};
const atEdge = promptWhere((p, chars) => chars.some((ch, i) => ch === " " && i >= len(p) && i % 50 === 49));   // 접히는 자리가 명령의 공백
const filled = promptWhere((p, chars) => chars.length % 50 === 0);   // 명령이 줄을 꽉 채움
// 50칸으로 접힌 사례 [화면, 명령, 커서, 기대, 이름]. 셸에 들어간 글(typedText)이 명령과 다를 수 있음. 프롬프트를 못 만들었으면 틀림으로 셈
const wrapped = (prompt, cmd, want, name, typedText = cmd) => {
  if (prompt === null) return ["", cmd, at(0, 0), true, `${name}(시험 화면을 만들지 못함)`];
  const [scr, cur] = wrap(prompt + typedText, 50);
  return [scr, cmd, cur, want, name];
};
const typed = [
  [`${P}true${" ".repeat(60)}✔  ▼  14:47:11 \n${P}${CMD}${" ".repeat(36)}✔  ▼  14:47:14 \n\n\n`, at(len(P + CMD), 1), true, "오른쪽 프롬프트가 줄 끝에 붙어도 들어간 것으로(줄 끝으로 견줄 때는 매번 실패)"],
  [`${P}${CMD} --model claude-fable-5-2\n`, at(len(P + CMD), 0), true, "커서 뒤에 자동 제안이 붙어도"],
  [`${P}${CMD.slice(1)}\n`, at(len(P + CMD) - 1, 0), false, "첫 글자가 빠지면 아님"],
  [`${P}x${CMD}\n`, at(len(P + CMD) + 1, 0), false, "앞에 다른 글자가 붙으면 아님"],
  [`${P}${CMD}   ✔  ▼  14:40:00 \nResume this session with:\n${P}${" ".repeat(20)}✔  ▼  14:47:14 \n`, at(len(P), 2), false, "위쪽 기록에만 있고 지금 줄은 비었으면 아님"],
  ["", at(0, 0), false, "빈 화면"],
  [`${P}${CMD}\n`, undefined, false, "커서 자리를 모르면 아님"],
].map(([scr, cur, want, name]) => [scr, CMD, cur, want, name]).concat([
  wrapped(T, LONG, true, "50칸 창에서 다섯 줄로 접혀도(tmux 의 줄 잇기로 볼 때는 늘 실패)"),
  wrapped(atEdge, LONG, true, "접히는 자리가 명령의 공백이라 그 줄 끝 공백이 잘려도"),
  wrapped(" ~/작업/게임  main  ", LONG, true, "프롬프트에 두 칸 글자(한글)가 있어도"),
  wrapped(filled, LONG, true, "명령이 줄을 꽉 채워 커서가 다음 줄 첫 칸이어도"),
  wrapped(T, LONG, false, "접혀 있어도 첫 글자가 빠지면 아님", LONG.slice(1)),
]);
for (const [scr, cmd, cur, want, name] of typed) if (typedOnPrompt(scr, cmd, cur) !== want) { bad++; console.log(`틀림: ${name}`); }

// 압축하는 중(compactingFor): 진행 줄이 압축 줄이면 그 줄의 경과 시간(초), 아니면 null. 앱의 '대화를 압축하는 중' 표시가 이것을 따른다
// (11-17 사용자 요청). 줄들은 실제 Claude Code 2.1.326 화면에서 모은 것: /compact 와 자동 압축이 같은 줄을 쓴다
const compacting = [
  [box("· Compacting conversation… (0s)\n  ⎿  Tip: Share Claude Code and earn $10 in usage credits · /passes", "⏸ manual mode on · esc to interrupt"), 0, "/compact 직후"],
  [box("✽ Compacting conversation… (1s · ↓ 55 tokens)", "⏸ manual mode on · esc to interrupt"), 1, "받는 토큰이 붙은 줄"],
  [box("✻ Compacting conversation… (0s · ↑ 275 tokens · thought for 1s)", "⏸ manual mode on · esc to interrupt"), 0, "차례 도중 자동 압축(생각 시간이 붙어도 맨 앞 시간)"],
  [box("✶ Compacting conversation… (12s · ↑ 1.3k tokens)", "⏵⏵ auto mode on (shift+tab to cycle) · ⧉ 14"), 12, "자동 모드·백그라운드 표시(모드 줄에 esc to interrupt 가 없음)"],
  [box("✢ Compacting conversation… (1m 49s · ↓ 4.2k tokens)", "⏵⏵ auto mode on"), 109, "1분 넘음"],
  [box("✳ Compacting conversation… (1h 2m 5s)", "⏵⏵ auto mode on"), 3725, "1시간 넘음"],
  [box("✽ Compacting conversation…", "⏵⏵ auto mode on"), 0, "시간이 아직 안 붙은 줄"],
  [box("✽ Compacting conversation…\n(12s · ↓ 1.0k tokens)", "⏵⏵ auto mode on"), 0, "좁은 창에서 시간이 다음 줄로 접힘(지금부터로 셈)"],
  [box("⏺ 답\n✽ Compacting conversation… (3s)\n  ⎿  Tip: x\n  ☐ 할 일 하나\n  ☐ 할 일 둘\n  ☐ 할 일 셋", "⏵⏵ auto mode on"), 3, "진행 줄 아래에 팁·할 일 목록이 있어도"],
  [withPanel(box("✽ Compacting conversation… (7s)", "⏵⏵ auto mode on · 1 shell"), ...EIGHT), 7, "하위 에이전트 목록이 붙어도"],
  [box("✻ Conversation compacted (ctrl+o for the summary)", "⏸ manual mode on · ? for shortcuts"), null, "끝난 화면"],
  [box("✻ Synthesizing… (5s · ↓ 38 tokens · thinking)", "⏸ manual mode on · esc to interrupt"), null, "다른 일을 하는 진행 줄"],
  [box("✶ Running PreCompact hooks… (running PreCompact hook · 2s · ↓ 269 tokens · thinking)", "⏸ manual mode on · esc to interrupt"), null, "압축 직전 훅이 도는 줄(뒤에서 요약을 미리 쓰기 시작할 때도 뜸)"],
  [box("✻ Running PostCompact hooks… (running PostCompact hook · 12s · ↑ 1.3k tokens)", "⏸ manual mode on · esc to interrupt"), null, "압축 끝 훅이 도는 줄"],
  [box("* Sautéed for 7m 38s · done 8:36 PM\n● Compacted while idle, before the prompt cache expired", "⏵⏵ auto mode on"), null, "쉬는 동안 압축이 끝났다는 안내"],
  [box("⏺ 화면에는 이렇게 보입니다:\n  ✽ Compacting conversation… (3s)\n  그동안 기다리면 됩니다.", "⏵⏵ auto mode on"), null, "답 글 속에 들여 쓴 인용"],
  [box("⏺ Compacting conversation… (3s) 라는 줄이 뜹니다", "⏵⏵ auto mode on"), null, "답이 그 문구로 시작"],
  [`${"답 줄\n".repeat(3)}──────\n❯ Compacting conversation… (3s)\n──────\n  ⏵⏵ auto mode on`, null, "입력창에 그 문구를 침"],
  [box("  ⎿  Compacting conversation… (3s)", "⏵⏵ auto mode on"), null, "도구 결과 줄"],
  [`✽ Compacting conversation… (3s)\n${"답 줄\n".repeat(20)}❯ \n  ⏸ manual mode on · ? for shortcuts`, null, "아래 12줄 밖의 옛 줄"],
  [box("✽ Compacting conversations… (3s)", "⏵⏵ auto mode on"), null, "비슷하지만 다른 문구"],
  [box("✽ Compacting conversation…tail (3s)", "⏵⏵ auto mode on"), null, "문구 뒤에 다른 글이 바로 붙음"],
  ["", null, "빈 화면"],
];
for (const [scr, want, name] of compacting) if (compactingFor(scr) !== want) { bad++; console.log(`틀림: 압축하는 중 — ${name}(${compactingFor(scr)})`); }
const total = cases.length + bg.length + jobs.length + panels.length + modes.length + merged.length + above.length + typed.length + compacting.length;
console.log(`전체 ${total}개 중 틀림 ${bad}개`);
process.exit(bad ? 1 : 0);
