// 시험용 가짜 Claude Code(모델을 부르지 않음). tmux 칸에서 이름이 버전 번호 꼴인 node(예: 9.9.9)로 띄운다(연결부가 Claude Code 로 여김).
//   node fake-claude.mjs <폴더>              가짜 Claude Code: <폴더>/cmd 가 생기면 진짜처럼 명령 셸(shell-snapshots 를 읽는 zsh)을
//                                           자기 프로세스 묶음으로 띄워 출력을 <폴더>/job.output 에 쓰고 셸 번호를 <폴더>/shell.pid 에 적음.
//                                           칸에 붙여 넣은 글은 <폴더>/typed.txt 에 적음
//   node fake-claude.mjs --feed <폴더> <칸>  그 칸의 연결부에 대화 기록(뒤에서 도는 셸 'bshapp'·에이전트 'aagapp')을 알려 줌
// 앱 화면 시험(test/app.sh)과 연결부 시험(claude-remote/test/bg-jobs.test.mjs)이 쓴다
// 작성: 서문교
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";

const [a1, a2, a3] = process.argv.slice(2);
if (a1 === "--feed") {
  const dir = a2, pane = a3;
  const sock = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
  const at = (s) => new Date(Date.now() - s * 1000).toISOString();
  const L = [
    { type: "assistant", uuid: "a1", timestamp: at(600), message: { id: "m1", content: [{ type: "tool_use", id: "tb", name: "Bash", input: { command: "sleep 600", description: "긴 시험 돌리기", run_in_background: true } }], stop_reason: "tool_use" } },
    { type: "user", uuid: "u1", timestamp: at(600), toolUseResult: { backgroundTaskId: "bshapp" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tb", content: `Command running in background with ID: bshapp. Output is being written to: ${dir}/job.output. You will be notified when it completes.` }] } },
    // 하위 에이전트는 요즘 판 모양(부를 때 run_in_background 없음, 결과에 isAsync·resolvedModel). 시킨 쪽과 같은 모델이라 깊이는 그 탭의 세션 깊이
    { type: "assistant", uuid: "a2", timestamp: at(300), message: { id: "m2", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "ta", name: "Agent", input: { description: "엔진 조사", prompt: "조사", subagent_type: "general-purpose" } }], stop_reason: "tool_use" } },
    { type: "user", uuid: "u2", timestamp: at(300), toolUseResult: { isAsync: true, status: "async_launched", agentId: "aagapp", resolvedModel: "claude-opus-5-5", outputFile: `${dir}/aagapp.output` }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ta", content: "Async agent launched successfully.\nagentId: aagapp" }] } },
    // 도구를 부르기 전의 설명 글은 요즘 판 모양(내용 없는 생각 칸 + 줄인 '업데이트'가 든 생각 칸, 줄의 thinkingDisplay 가 updates).
    // 앱 대화에 글로 보여야 한다. 글마다 물결표 범위가 두 번: 그 사이가 취소선이 되면 물결표가 사라진다(앱 화면 시험 VV)
    { type: "assistant", uuid: "a3", timestamp: at(200), thinkingDisplay: "updates", message: { id: "m3", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: null } },
    { type: "assistant", uuid: "a4", timestamp: at(200), thinkingDisplay: "updates", message: { id: "m3", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "기준표(7~12개월)를 보고 주 80~120g 기록과 견줘 보겠습니다.", signature: "s" }], stop_reason: null } },
    { type: "assistant", uuid: "a5", timestamp: at(200), message: { id: "m3", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "tr", name: "Read", input: { file_path: `${dir}/table.md` } }], stop_reason: "tool_use" } },
    { type: "user", uuid: "u3", timestamp: at(199), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tr", content: "표" }] } },
    // 마지막 응답의 사용량(입력 토큰 152,000, Opus 5.5 의 기억 용량 1M): 앱 위쪽의 컨텍스트 고리가 15%로 보인다(앱 화면 시험 XX)
    { type: "assistant", uuid: "a6", timestamp: at(198), message: { id: "m4", model: "claude-opus-5-5", content: [{ type: "text", text: "권장량은 하루 5~15분씩, 2~3회입니다." }], stop_reason: "end_turn", usage: { input_tokens: 4, cache_creation_input_tokens: 1_996, cache_read_input_tokens: 150_000, output_tokens: 20 } } },
  ];
  writeFileSync(`${dir}/t.jsonl`, `${L.map((o) => JSON.stringify(o)).join("\n")}\n`);
  const until = Date.now() + 15_000;
  const go = () => {
    if (!existsSync(sock)) return Date.now() < until ? setTimeout(go, 200) : process.exit(1);
    const c = createConnection(sock);
    c.on("error", () => process.exit(1));
    c.on("connect", () => c.end(`${JSON.stringify({ cmd: "hook", event: { hook_event_name: "SessionStart", transcript_path: `${dir}/t.jsonl`, source: "resume" } })}\n`, () => process.exit(0)));
  };
  go();
} else {
  const dir = a1;
  // 모드 줄의 '· 1 shell · 2 local agents' 는 연결부가 읽어 탭에 '셸 1개 · 에이전트 2개'로 적는다(앱 서랍의 '백그라운드 작업 3')
  process.stdout.write(`⏺ 답\n${"─".repeat(60)}\n❯ \n${"─".repeat(60)}\n  ⏵⏵ auto mode on · 1 shell · 2 local agents`);
  process.stdin.on("data", (d) => appendFileSync(`${dir}/typed.txt`, d));
  setInterval(() => {
    const f = `${dir}/cmd`;
    if (!existsSync(f)) return;
    const cmd = readFileSync(f, "utf8").trim();
    unlinkSync(f);
    const fd = openSync(`${dir}/job.output`, "a");
    // 진짜 Claude Code 의 명령 셸처럼 명령 줄에 shell-snapshots 가 있고, 자기 프로세스 묶음의 우두머리
    const p = spawn("/bin/zsh", ["-c", `: ~/.claude/shell-snapshots/snapshot-zsh-x.sh; ${cmd}`], { detached: true, stdio: ["ignore", fd, fd] });
    writeFileSync(`${dir}/shell.pid`, String(p.pid));
  }, 100);
}
