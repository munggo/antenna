// Claude Code 대화 기록 → 폰 메시지 변환 판정 시험: node claude-remote/test/convert-cases.mjs
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { answerKeys, cleanUserText, closeMention, CLOUDFLARE_BLOCK, CLOUDFLARE_NOTE, createConverter, describeTool, prettyModel, questionAnswer, readStart } from "../claude-feed.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// 1. 이름·설명
ok(prettyModel("claude-opus-5-5") === "Opus 5.5" && prettyModel("claude-haiku-4-5-20251001") === "Haiku 4.5" && prettyModel("claude-sonnet-5") === "Sonnet 5", "모델 이름: Opus 5.5·Haiku 4.5(날짜 뺌)·Sonnet 5");
ok(describeTool("Bash", { command: "ls -la\npwd", description: "목록 보기" }) === "목록 보기" && describeTool("Bash", { command: "ls -la\npwd" }) === "ls -la", "명령 설명: description 먼저, 없으면 첫 줄");
ok(describeTool("Read", { file_path: "/a/b/c.ts" }) === "c.ts 읽기" && describeTool("Edit", { file_path: "/x/y.md" }) === "y.md 수정", "파일 도구 설명");
ok(describeTool("TodoWrite", { todos: [{ content: "가", status: "completed" }, { content: "나", status: "in_progress", activeForm: "나 하는 중" }] }) === "할 일 1/2 · 지금: 나 하는 중", "할 일 설명");
ok(describeTool("mcp__slack__send_message", {}) === "slack · send_message", "MCP 도구 이름");

// 2. 사용자 글 정리
ok(cleanUserText("<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>") === "/model opus", "슬래시 명령은 '/model opus'로");
ok(cleanUserText("<local-command-stdout>Set model</local-command-stdout>") === "", "명령 출력은 숨김");
ok(cleanUserText("안녕<system-reminder>숨김</system-reminder>") === "안녕", "시스템 알림 꼬리표는 뺌");
ok(cleanUserText('\n\n<pasted_content id="2aba">\n오늘 할 일 정리해 줘.\n\n그리고\nhttps://github.com/x/y/pull/1\n</pasted_content id="2aba">') === "오늘 할 일 정리해 줘.\n\n그리고\nhttps://github.com/x/y/pull/1", "붙여넣기 태그(pasted_content)는 떼고 안의 글만");
ok(cleanUserText('앞 글\n<pasted_content id="a1">\n붙인 글\n</pasted_content id="a1">\n뒤 글') === "앞 글\n\n붙인 글\n\n뒤 글", "직접 친 글과 붙인 글이 섞여도 태그만 뗌");
ok(cleanUserText("<pasted_content>\n그냥 태그\n</pasted_content>") === "그냥 태그", "번호 없는 태그도 뗌");

// 3. 변환: 같은 응답 조각은 하나로, 도구 결과·생각·요약
const c = createConverter();
const L = [
  { type: "user", uuid: "u1", message: { role: "user", content: "hello" } },
  { type: "assistant", uuid: "a1", message: { id: "m1", model: "claude-haiku-4-5-20251001", content: [{ type: "thinking", thinking: "생각 첫 줄\n둘째" }], stop_reason: null } },
  { type: "assistant", uuid: "a2", message: { id: "m1", model: "claude-haiku-4-5-20251001", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo hi", description: "인사" } }], stop_reason: "tool_use" } },
  { type: "user", uuid: "u2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "hi", is_error: false }] } },
  { type: "assistant", uuid: "a3", message: { id: "m2", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: "끝났어요" }], stop_reason: "end_turn" } },
  { type: "user", uuid: "u3", isMeta: true, message: { role: "user", content: "meta" } },
  { type: "assistant", uuid: "s1", isSidechain: true, message: { id: "m9", content: [{ type: "text", text: "하위" }] } },
  { type: "user", uuid: "u4", isCompactSummary: true, message: { role: "user", content: "요약 내용" } },
  { type: "user", uuid: "u5", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "image", source: { type: "base64", data: "AAAA" } }] }] } },
];
L.forEach((l) => c.add(l));
const ms = c.messages();
ok(ms.map((m) => m.role).join(",") === "user,assistant,toolResult,assistant,summary,toolResult", `순서·종류(${ms.map((m) => m.role).join(",")}), 숨김 줄·하위 에이전트 줄은 뺌`);
const a = ms[1];
ok(a.blocks.length === 2 && a.blocks[0].type === "thinking" && a.blocks[0].desc === "생각 첫 줄" && a.blocks[1].type === "tool" && a.blocks[1].name === "bash" && a.blocks[1].desc === "인사" && a.stop === "toolUse", "같은 응답 조각(생각+도구)은 한 메시지, 도구 이름은 bash");
ok(!("_text" in a.blocks[0]), "폰으로는 생각 본문을 보내지 않음");
ok(ms[2].toolCallId === "t1" && ms[2].output === "hi" && ms[3].stop === "stop", "도구 결과·끝 표시");
ok(c.model() === "claude-haiku-4-5-20251001" && c.lastAssistant()?.id === "m2", "마지막 모델, 마지막 답(사용자 메시지 전까지 가장 최근 답)");
const c2 = createConverter();
c2.add({ type: "assistant", uuid: "x", message: { id: "mx", content: [{ type: "text", text: "앞 답" }], stop_reason: "end_turn" } });
c2.add({ type: "user", uuid: "y", message: { role: "user", content: "새 질문" } });
ok(c2.lastAssistant() === null, "사용자가 새로 말한 뒤엔 아직 답 없음");
ok(c.image("t2") === "AAAA", "도구가 읽은 그림 보관(폰 요청 시)");
ok(c.detail({ kind: "thinking", ref: a.blocks[0].ref }).text.startsWith("생각 첫 줄"), "생각 상세는 요청할 때 본문");
const d = c.detail({ id: "t1" });
ok(d.kind === "bash" && d.command === "echo hi" && d.output === "hi" && d.done === true, "명령 상세: 명령·출력·끝남");
ok(c.detail({ id: "없음" }).error, "없는 도구 상세는 안내");

// 3-0. 도구를 부르기 전의 설명 글: 요즘 Claude Code 는 글이 아니라 줄인 '업데이트'를 생각 칸에 담아 남긴다(그 줄의 thinkingDisplay 가 "updates").
//      폰에서 단계 속에 접히지 않게 대화 글로 바꾸고(update 표시), 내용 없는 진짜 생각 칸은 그대로 단계로 둔다(11-17 사용자 보고: 맥 화면에는 보이는데 앱에는 없음)
const cu = createConverter();
[
  { type: "user", uuid: "uu1", message: { role: "user", content: "고쳐 줘" } },
  { type: "assistant", uuid: "ua1", thinkingDisplay: "updates", thinkingDurationMs: 8554, message: { id: "um1", content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: null } },
  { type: "assistant", uuid: "ua2", thinkingDisplay: "updates", thinkingDurationMs: 1, message: { id: "um1", content: [{ type: "thinking", thinking: "원인을 찾았고 이제 고치겠습니다.\n", signature: "s" }], stop_reason: null } },
  { type: "assistant", uuid: "ua3", message: { id: "um1", content: [{ type: "tool_use", id: "ut1", name: "Bash", input: { command: "ls", description: "목록" } }], stop_reason: "tool_use" } },
  { type: "user", uuid: "uu2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ut1", content: "a" }] } },
  // 표시 방식이 다른 줄(생각을 줄여서 주는 방식)의 생각 칸은 진행 설명이 아니다
  { type: "assistant", uuid: "ua4", thinkingDisplay: "summarized", message: { id: "um2", content: [{ type: "thinking", thinking: "줄인 생각", signature: "s" }], stop_reason: null } },
  { type: "assistant", uuid: "ua5", thinkingDisplay: "updates", message: { id: "um2", content: [{ type: "thinking", thinking: "  \n", signature: "s" }], stop_reason: null } },
  { type: "assistant", uuid: "ua6", thinkingDisplay: "updates", message: { id: "um2", content: [{ type: "thinking", thinking: "마무리 확인 중입니다.", signature: "s" }], stop_reason: null } },
  { type: "assistant", uuid: "ua7", message: { id: "um2", content: [{ type: "text", text: "다 고쳤습니다.\n시험도 통과했습니다." }], stop_reason: "end_turn" } },
].forEach((l) => cu.add(l));
const um = cu.messages();
const u1 = um[1].blocks, u2 = um[3].blocks;
ok(u1.length === 3 && u1[0].type === "thinking" && u1[0].desc === "" && u1[1].type === "text" && u1[1].text === "원인을 찾았고 이제 고치겠습니다." && u1[1].update === true && u1[2].type === "tool",
  "도구 앞의 진행 설명(업데이트)은 대화 글로, 내용 없는 생각 칸은 단계 그대로");
ok(u2.length === 4 && u2[0].type === "thinking" && u2[0].desc === "줄인 생각" && u2[1].type === "thinking", "다른 표시 방식의 생각·빈 업데이트는 생각 그대로");
ok(u2[2].type === "text" && u2[2].update === true && u2[3].type === "text" && !("update" in u2[3]), "마지막 답의 글에는 update 표시가 없음");
ok(cu.lastAnswerText() === "다 고쳤습니다.\n시험도 통과했습니다.", "끝남 알림에 쓰는 마지막 답의 글에는 진행 설명을 넣지 않음");
ok(cu.detail({ kind: "thinking", ref: u1[0].ref }).text.includes("남기지 않았어요"), "내용 없는 생각 칸의 상세는 안내 글");
ok(c.lastAnswerText() === "끝났어요", "진행 설명이 없던 대화의 마지막 답 글은 전과 같음");

// 3-0. 사진만 보낼 때('@사진경로' 한 줄): 끝에 빈칸을 붙여 Claude Code 의 파일 고르기 목록을 닫음(11-21 사용자 보고 '이미지만 올리면 응답이 없다')
ok(closeMention("@/x/.cache/pi-remote/img-1.jpg") === "@/x/.cache/pi-remote/img-1.jpg ", "사진 하나만: 빈칸 붙임");
ok(closeMention("@/x/img-1.jpg @/x/img-2.png") === "@/x/img-1.jpg @/x/img-2.png ", "사진 여럿만: 빈칸 붙임");
ok(closeMention("@/x/img-1.jpg 이 화면 봐 줘") === "@/x/img-1.jpg 이 화면 봐 줘", "사진과 글: 그대로");
ok(closeMention("메일은 a@b.com") === "메일은 a@b.com" && closeMention("그냥 글") === "그냥 글" && closeMention("") === "", "글만·메일 주소: 그대로");
ok(closeMention("이 파일 봐 @src/app.ts") === "이 파일 봐 @src/app.ts ", "글 끝이 파일 언급이어도 빈칸(같은 목록이 뜸)");

// 3-1. 질문 창 키 순서·답 요약
const K = (seq) => seq.map((k) => (k.text !== undefined ? `"${k.text}"` : k.key)).join(" ");
const Q = (question, labels, multiSelect = false) => ({ question, options: labels.map((label) => ({ label, description: "" })), multiSelect });
ok(K(answerKeys([Q("Pet?", ["Cat", "Dog"])], [{ answers: ["Dog"] }])) === "2", "질문 하나·하나 고르기: 번호만(바로 제출)");
ok(K(answerKeys([Q("Pet?", ["Cat", "Dog"])], [{ answers: [], other: "Hamster" }])) === '3 "Hamster" Enter', "질문 하나·직접 입력: 그 줄 번호 → 글 → Enter");
ok(K(answerKeys([Q("Color?", ["Red", "Blue"]), Q("Size?", ["Small", "Large"], true)], [{ answers: ["Blue"] }, { answers: ["Small", "Large"] }])) === "2 1 2 Right 1",
  "질문 둘(하나+여러 개): 번호 → 체크들 → 오른쪽 → 검토 화면 1");
ok(K(answerKeys([Q("Drinks?", ["Tea", "Coffee"], true)], [{ answers: ["Tea"], other: "Juice" }])) === '1 Down Down "Juice" Down Enter 1',
  "여러 개 고르기 + 직접 입력: 아래로 직접 입력 줄 → 글 → Submit 줄 → 검토 화면 1");
ok(K(answerKeys([Q("Color?", ["Red", "Blue"]), Q("Pet?", ["Cat", "Dog"])], [{ answers: ["Red"] }, { answers: [], other: "Fox" }])) === '1 3 "Fox" Enter 1',
  "질문 둘(둘째는 직접 입력)");
ok(questionAnswer('Your questions have been answered: "Color?"="Blue", "Size?"="Small, Large". You can now continue') === "Blue / Small, Large", "질문 결과에서 답만");
// 미리보기 그림이 있는 문항: 숫자 키가 먹지 않음(11-20 사용자 보고 '이미 다 선택했는데 다시 뜬다') → 아래로 + Enter, 직접 쓴 글은 메모
const PQ = (question, labels) => ({ ...Q(question, labels), preview: true });
ok(K(answerKeys([PQ("Shape?", ["A", "B", "C"]), Q("Tone?", ["X", "Y"]), Q("Count?", ["1", "2", "3"])], [{ answers: ["A"] }, { answers: ["X"] }, { answers: ["1"] }])) === "Enter 1 1 1",
  "미리보기 문항 첫째 고르기: Enter 만, 나머지는 번호, 검토 화면 1");
ok(K(answerKeys([PQ("Shape?", ["A", "B", "C"]), Q("Tone?", ["X", "Y"])], [{ answers: ["C"] }, { answers: ["Y"] }])) === "Down Down Enter 2 1", "미리보기 문항 셋째: 아래로 두 번 → Enter");
ok(K(answerKeys([PQ("Shape?", ["A", "B"])], [{ answers: ["B"] }])) === "Down Enter", "미리보기 문항 하나뿐: 아래로 → Enter(바로 제출)");
ok(K(answerKeys([PQ("Shape?", ["A", "B"]), Q("Tone?", ["X", "Y"])], [{ answers: [], other: "둥글게" }, { answers: ["X"] }])) === 'n "둥글게" Enter 1 1', "미리보기 문항에 직접 쓴 글: 메모(n) → 글 → Enter");
ok(questionAnswer('The user answered: "Shape?"=(no option selected) notes: 둥글게, 작게, "Tone?"="X". Read the answers carefully') === "메모: 둥글게, 작게 / X", "메모만 적은 답도 요약에");
ok(questionAnswer('The user answered: "Tone?"="X", "Shape?"=(no option selected) notes: 끝 메모. Read the answers carefully') === "X / 메모: 끝 메모", "마지막 문항의 메모");
ok(questionAnswer('The user answered: "Shape?"="약과 (Recommended)" selected preview:\n ┌──┐\n │약과│, "Tone?"="X". Read') === "약과 (Recommended) / X", "미리보기를 고른 답(뒤에 그림이 붙음)");

// 3-2. 할 일: 새 방식(TaskCreate·TaskUpdate), 예전 방식(TodoWrite)
{
  const t = createConverter();
  const call = (id, name, input) => ({ type: "assistant", uuid: `a-${id}`, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" } });
  const res = (id, text) => ({ type: "user", uuid: `u-${id}`, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } });
  [call("c1", "TaskCreate", { subject: "준비", activeForm: "준비하는 중" }), res("c1", "Task #1 created successfully: 준비"),
   call("c2", "TaskCreate", { subject: "시험" }), res("c2", "Task #2 created successfully: 시험"),
   call("c3", "TaskCreate", { subject: "지울 것" }), res("c3", "Task #3 created successfully: 지울 것"),
   call("u1", "TaskUpdate", { taskId: "1", status: "completed" }), call("u2", "TaskUpdate", { taskId: "2", status: "in_progress" }),
   call("u3", "TaskUpdate", { taskId: "3", status: "deleted" })].forEach((l) => t.add(l));
  const td = t.todos();
  ok(td.length === 2 && td[0].content === "준비" && td[0].status === "completed" && td[1].status === "in_progress", `새 방식 할 일: 만들기·상태 바꾸기·지우기(${JSON.stringify(td.map((x) => x.content + ":" + x.status))})`);
  const t2 = createConverter();
  t2.add(call("w1", "TodoWrite", { todos: [{ content: "가", status: "completed" }, { content: "나", status: "in_progress", activeForm: "나 하는 중" }, { content: "다", status: "weird" }] }));
  const td2 = t2.todos();
  ok(td2.length === 3 && td2[1].activeForm === "나 하는 중" && td2[2].status === "pending", "예전 방식 할 일(TodoWrite), 이상한 상태는 할 일로");
  const a = createConverter();
  a.add(call("q1", "AskUserQuestion", { questions: [{ question: "Pet?", options: [{ label: "Cat" }] }] }));
  a.add(res("q1", 'Your questions have been answered: "Pet?"="Cat".'));
  ok(a.messages().find((m) => m.role === "toolResult")?.answer === "Cat", "질문 도구 결과에 답 요약");
}

// 4. 실제 대화 기록 몇 개를 오류 없이 읽기. 연결부처럼 아주 큰 기록(이미지가 쌓인 수백 MB)은 끝부분만 읽고 첫 줄을 버림
//    (11-15: 658MB 기록을 통째로 문자열로 만들다 'Cannot create a string longer than …' 으로 실패)
ok(JSON.stringify(readStart(100, 0, 1000)) === '{"from":0,"skip":false}' && JSON.stringify(readStart(5000, 0, 1000)) === '{"from":4000,"skip":true}', "작은 기록은 처음부터, 큰 기록은 끝에서 한도만큼");
ok(JSON.stringify(readStart(5000, 4500, 1000)) === '{"from":4500,"skip":false}' && readStart(9000, 4500, 1000).from === 8000, "늘어난 만큼만 읽고, 그것도 한도를 넘으면 끝부분만");
const root = `${process.env.HOME}/.claude/projects`;
const files = readdirSync(root).flatMap((d) => { try { return readdirSync(join(root, d)).filter((f) => f.endsWith(".jsonl")).map((f) => join(root, d, f)); } catch { return []; } })
  .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs).slice(0, 5);
let total = 0, bad = 0, cut = 0;
for (const f of files) {
  const size = statSync(f).size;
  const { from, skip } = readStart(size, 0);
  const buf = Buffer.alloc(size - from);
  const fd = openSync(f, "r");
  try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
  const ls = buf.toString("utf8").split("\n");
  if (skip) { ls.shift(); cut++; }
  const cc = createConverter();
  for (const l of ls) {
    if (!l.trim()) continue;
    try { cc.add(JSON.parse(l)); } catch { bad++; }
  }
  total += cc.messages().length;
  JSON.stringify(cc.messages());
}
ok(files.length > 0 && bad === 0 && total > 0, `최근 실제 기록 ${files.length}개(끝부분만 읽은 큰 기록 ${cut}개): 메시지 ${total}개, 읽기 오류 ${bad}개`);

// 작업 중에 보낸 글(대화에 남김)·받아 둔 글(대기 표시)·작업 알림과 /clear(숨김)
{
  const c = createConverter();
  const q = (operation, content, extra = {}) => c.add({ type: "queue-operation", operation, ...(content === undefined ? {} : { content }), ...extra });
  const sent = (uuid, prompt, kind, commandMode = "prompt") => c.add({ type: "attachment", uuid, isSidechain: false, attachment: { type: "queued_command", prompt, commandMode, ...(kind ? { origin: { kind } } : {}) } });
  const NOTE = "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command \"x\" completed</summary>\n</task-notification>";
  ok(cleanUserText("<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>") === "", "/clear 는 말풍선으로 남기지 않음");
  ok(cleanUserText("<command-name>/model</command-name>\n<command-args>opus</command-args>") === "/model opus", "다른 슬래시 명령은 그대로 보임");
  ok(cleanUserText(NOTE) === "", "작업 알림 글은 숨김");
  ok(c.add({ type: "user", uuid: "u0", origin: { kind: "task-notification" }, message: { content: NOTE } }).length === 0, "출처가 작업 알림인 사용자 메시지는 말풍선이 아님");
  ok(c.add({ type: "user", uuid: "u1", origin: { kind: "peer", name: "다른 탭", body: "본문" }, message: { content: "Another Claude session sent a message while you were working:\n<agent-message from=\"x\">\n본문\n</agent-message>" } }).length === 0, "다른 세션·하위 에이전트가 보낸 글은 내 말풍선이 아님");
  ok(c.add({ type: "user", uuid: "u2", origin: { kind: "human" }, message: { content: "사람이 보낸 글" } }).length === 1 && c.add({ type: "user", uuid: "u3", message: { content: "출처 표시 없는 글" } }).length === 1, "사람이 보낸 글과 출처 표시가 없는 글은 그대로 말풍선");
  q("enqueue", '<pasted_content id="a">\n첫 글\n</pasted_content id="a">');
  q("enqueue", NOTE);
  q("enqueue", "둘째 글");
  ok(JSON.stringify(c.queue().map((x) => [x.text, x.kind])) === '[["첫 글","steer"],["둘째 글","steer"]]' && new Set(c.queue().map((x) => x.id)).size === 2, "받아 둔 글: 사람이 보낸 것만, 붙여넣기 태그는 떼고");
  q("remove", "둘째 글", { reason: "absorbed_mid_turn" });
  const m = sent("a1", "둘째 글", "human");
  ok(m.length === 1 && m[0].role === "user" && m[0].text === "둘째 글" && m[0].id === "a1" && c.queue().length === 1, "작업 중에 전달된 글은 대기열에서 빠지고 내 말풍선으로 남음");
  ok(sent("a2", NOTE, "task-notification", "task-notification").length === 0 && sent("a3", "다른 세션 글", "peer").length === 0 && sent("a5", NOTE, null, "task-notification").length === 0, "작업 중에 전달된 작업 알림·다른 세션 글은 말풍선이 아님");
  q("dequeue");
  ok(c.queue().length === 0, "차례가 돼 꺼낸 글은 대기열에서 빠짐(남은 작업 알림은 보이지 않음)");
  q("enqueue", "셋째"); q("enqueue", "넷째"); q("popAll");
  ok(c.queue().length === 0, "모두 꺼내면 빈 대기열");
  q("remove", "없는 글"); q("dequeue");
  ok(c.queue().length === 0, "없는 글을 빼거나 빈 대기열에서 꺼내도 그대로");
  q("enqueue", "남은 글"); c.clearQueue();
  ok(c.queue().length === 0, "작업이 끝나면 남은 것은 버림");
  const im = sent("a4", [{ type: "text", text: "사진과 글" }, { type: "image", source: {} }], "human");
  ok(im.length === 1 && im[0].text === "사진과 글" && im[0].images === 1, "작업 중에 보낸 사진 딸린 글");
  ok(c.add({ type: "attachment", uuid: "a6", attachment: { type: "hook_additional_context", content: "x" } }).length === 0, "다른 첨부는 말풍선이 아님");
  ok(JSON.stringify(c.messages().filter((x) => x.role === "user").map((x) => x.text)) === '["사람이 보낸 글","출처 표시 없는 글","둘째 글","사진과 글"]', "대화에는 사람이 보낸 글만");
}

// 10. API 오류: Cloudflare 가 막은 403 에는 '로그인 문제가 아님' 안내를 붙인다(다른 오류에는 붙이지 않음)
{
  const c = createConverter();
  const apiErr = (uuid, id, text) => ({ type: "assistant", uuid, isApiErrorMessage: true, message: { id, model: "<synthetic>", content: [{ type: "text", text }], stop_reason: "stop_sequence" } });
  const texts = (m) => (m?.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text);
  const [cf] = c.add(apiErr("e1", "m-cf", "Please run /login · API Error: 403 Attention Required! | Cloudflare"));
  ok(texts(cf).length === 2 && texts(cf)[1] === CLOUDFLARE_NOTE && cf.error.includes("Cloudflare"), "Cloudflare 403: 오류 글 뒤에 '로그인 문제가 아님' 안내가 붙음");
  const [again] = c.add(apiErr("e1b", "m-cf", ""));
  ok(texts(again).filter((t) => t === CLOUDFLARE_NOTE).length === 1, "같은 응답이 다시 와도 안내는 한 번만");
  const [auth] = c.add(apiErr("e2", "m-401", "Please run /login · API Error: 401 OAuth token has expired"));
  ok(!texts(auth).includes(CLOUDFLARE_NOTE), "진짜 로그인 오류(401)에는 붙이지 않음");
  const [plain] = c.add({ type: "assistant", uuid: "e3", message: { id: "m-text", model: "claude-opus-5-5", content: [{ type: "text", text: "403 Attention Required! | Cloudflare 라는 글을 설명하면" }], stop_reason: "end_turn" } });
  ok(!texts(plain).includes(CLOUDFLARE_NOTE), "보통 답 속에 같은 글이 있어도 붙이지 않음(API 오류일 때만)");
  ok(CLOUDFLARE_BLOCK.test("API Error: 403 <html>Attention Required! | Cloudflare</html>") && !CLOUDFLARE_BLOCK.test("API Error: 429 rate limited") && !CLOUDFLARE_BLOCK.test("Attention Required! | Cloudflare"), "막힘 판정: 403 과 Cloudflare 확인 페이지 제목이 함께 있을 때만");
}

// 11. 멈춤 표시(Claude Code 가 사람 글처럼 남김, 11-19 실제 기록의 두 모양): 내 말풍선이 아니라 앱의 '중단됨' 줄(끝 표시 aborted 인 빈 답)
{
  const c = createConverter();
  const said = (uuid, text) => ({ type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } });
  c.add(said("p1", "도메인 이름 골라 줘"));
  c.add({ type: "assistant", uuid: "x1", message: { id: "mx", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "tq", name: "AskUserQuestion", input: { questions: [] } }], stop_reason: "tool_use" } });
  c.add({ type: "user", uuid: "x2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tq", is_error: true, content: "The user doesn't want to proceed with this tool use. [Request interrupted by user for tool use]" }] } });
  const [ab] = c.add(said("x3", "[Request interrupted by user for tool use]"));
  ok(ab?.role === "assistant" && ab.stop === "aborted" && ab.blocks.length === 0 && ab.interrupted === true, `도구 중 멈춤 → 중단됨 줄(${JSON.stringify(ab)})`);
  const [ab2] = c.add(said("x4", "[Request interrupted by user]"));
  ok(ab2?.stop === "aborted" && ab2.interrupted === true, "답하는 중 멈춤 → 중단됨 줄");
  ok(!c.messages().some((m) => m.role === "user" && /Request interrupted/.test(m.text ?? "")), "멈춤 글이 내 말풍선으로 남지 않음");
  ok(c.messages().filter((m) => m.role === "toolResult").length === 1, "같은 글이 든 도구 결과는 그대로 도구 결과");
  ok(c.lastPrompt() === "도메인 이름 골라 줘", `마지막 사람 글은 멈춤 표시가 아니라 보낸 글(계정 전환 때 견줌): ${c.lastPrompt()}`);
  ok(c.lastAnswerText() === "", "멈춘 뒤 마지막 답의 글은 비어 있음(전과 같음)");
  const [u] = c.add(said("x5", "왜 [Request interrupted by user] 가 보이지?"));
  ok(u?.role === "user", "멈춤 표시를 말한 사람 글은 그대로 말풍선");
}

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
