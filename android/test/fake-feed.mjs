// 안드로이드 앱 시험용 가짜 대화 피드(모델도 pi·Claude Code 도 띄우지 않음). tmux 칸 하나의 피드 소켓을 열고 정해 둔 대화를 준다.
//   node android/test/fake-feed.mjs <칸 id> <신호 폴더>
// 주는 것: Claude Code 탭 대화(생각·명령·읽기·수정 단계, 마크다운 답, 진행 설명), 할 일, 컨텍스트 사용량, 확장 명령 하나, 뒤에서 도는 작업 목록,
//   처음엔 승인 카드. 승인에 답하면 고르는 질문 카드, 질문에 답하면 여러 질문 카드.
// 앱이 브리지를 거쳐 보낸 요청은 <신호 폴더>/cmds 에 한 줄씩(JSON) 적고, 맥 연결부처럼 답한다
//   send → 내 메시지와 답(작업 중 → 끝) · approval/question-answer → 카드 닫기 · detail → 단계 상세 · files → 파일 목록 · compact → 압축
// 소켓 자리는 진짜 피드와 같은 ~/.cache/pi-remote/feed/<칸 번호>.sock (시험 세션의 칸이라 쓰는 탭과 겹치지 않음). 끝날 때 지운다.
// 작성: 서문교
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";

const [pane, signals] = process.argv.slice(2);
if (!pane || !signals) { console.error("쓰기: node fake-feed.mjs <칸 id> <신호 폴더>"); process.exit(2); }
const now = Date.now();
const md = [
  "## 정리한 것",
  "",
  "- **제목**을 고쳤어요",
  "- `install.sh` 설명을 더했어요",
  "",
  "기준표(7~12개월)와 80~120g 범위는 그대로예요.",
  "",
  "```sh",
  "sh install.sh",
  "```",
  "",
  "| 항목 | 결과 |",
  "|---|---|",
  "| 빌드 | 통과 |",
  "",
  "자세한 건 https://example.com/docs 를 보세요.",
].join("\n");

const messages = [
  { id: "u1", role: "user", text: "README 를 정리해 줘" },
  { id: "a1", role: "assistant", stop: "toolUse", blocks: [
    { type: "thinking", desc: "고칠 곳을 찾는 중", ref: "a1:0" },
    { type: "tool", id: "t1", name: "bash", summary: "ls -la", desc: "파일 목록 보기" },
    { type: "tool", id: "t2", name: "read", summary: "/repo/README.md" },
    { type: "tool", id: "t3", name: "edit", summary: "/repo/README.md", stats: { added: 3, removed: 1 } },
  ] },
  { id: "r1", role: "toolResult", toolCallId: "t1", output: "README.md\nsrc\ninstall.sh" },
  { id: "r2", role: "toolResult", toolCallId: "t2", output: "# 옛 제목" },
  { id: "r3", role: "toolResult", toolCallId: "t3", output: "ok" },
  // 같은 id 가 겹친 메시지: 앱이 죽지 않고 둘 다 보여야 한다(안드로이드 목록은 이름표가 겹치면 죽음)
  { id: "u1", role: "user", text: "(같은 id 로 한 번 더 온 메시지)" },
  { id: "a2", role: "assistant", stop: "stop", blocks: [
    { type: "text", text: "README 를 고쳤어요. 이제 정리해 볼게요.", update: true },
    { type: "text", text: md },
  ] },
];
const approval = { id: "ap1", kind: "send", label: "Slack 메시지 보내기", to: "#general", detail: "배포 끝났어요", since: now, source: "mcp", risk: "중" };
const question = { id: "q1", question: "어느 쪽으로 할까요?", options: [{ label: "A안", description: "빠름" }, { label: "B안", description: "안전함" }], multiSelect: false, since: now };
const multi = { id: "q2", question: "", options: [], since: now, items: [
  { question: "언어는?", options: [{ label: "한국어" }, { label: "영어" }], multiSelect: false },
  { question: "무엇을 넣을까요?", options: [{ label: "그림" }, { label: "표" }], multiSelect: true },
] };
let approvals = [approval];
let questions = [];
let working = 0;
const todos = [
  { content: "README 고치기", status: "completed" },
  { content: "시험 돌리기", status: "in_progress", activeForm: "시험 돌리는 중" },
  { content: "올리기", status: "pending" },
];
const snapshot = () => ({
  t: "snapshot", v: 3, agent: "claude", messages, truncated: 0, working: working > 0, since: working || null, queue: [], canSend: true,
  context: { tokens: 84000, window: 200000, percent: 42, auto: true, reserve: 13000 }, compacting: false,
  approvals, questions, todos, permMode: "auto", modelChoices: [{ id: "opus", name: "Opus" }, { id: "sonnet", name: "Sonnet" }],
});

const clients = new Set();
const send = (o) => { for (const c of clients) c.write(`${JSON.stringify(o)}\n`); };
const record = (o) => appendFileSync(`${signals}/cmds`, `${JSON.stringify(o)}\n`);
let seq = 0;

function onCommand(o) {
  record(o);
  if (o.cmd === "send") {
    const id = `u-${++seq}`;
    const m = { id, role: "user", text: String(o.text ?? "") };
    messages.push(m);
    send({ t: "upsert", message: m });
    working = Date.now();
    send({ t: "working", value: true, since: working });
    setTimeout(() => {
      const a = { id: `a-${seq}`, role: "assistant", stop: "pending", blocks: [{ type: "text", text: "받았어요" }] };
      send({ t: "upsert", message: a });
      setTimeout(() => {
        const done = { ...a, stop: "stop", blocks: [{ type: "text", text: `받았어요: ${m.text}` }] };
        messages.push(done);
        send({ t: "upsert", message: done });
        working = 0;
        send({ t: "working", value: false });
      }, 1500);
    }, 800);
  } else if (o.cmd === "approval") {
    approvals = approvals.filter((a) => a.id !== o.id);
    send({ t: "approval-done", id: o.id });
    // 승인에 답하면 고르는 질문
    questions = [question];
    setTimeout(() => send({ t: "question", question }), 300);
  } else if (o.cmd === "question-answer") {
    questions = questions.filter((q) => q.id !== o.id);
    send({ t: "question-done", id: o.id });
    if (o.id === "q1") { questions = [multi]; setTimeout(() => send({ t: "question", question: multi }), 300); }
    else send({ t: "notice", text: "답을 받았어요" });
  } else if (o.cmd === "detail") {
    const d = o.kind === "thinking" ? { key: o.key, kind: "thinking", text: "README 의 제목과 설치 설명을 먼저 본다." }
      : o.id === "t1" ? { key: o.key, kind: "bash", command: "ls -la", output: "README.md\nsrc\ninstall.sh", done: true }
      : o.id === "t3" ? { key: o.key, kind: "edit", path: "/repo/README.md", edits: [{ old: "# 옛 제목\n설명", new: "# 새 제목\n설명\n설치: sh install.sh" }], done: true }
      : { key: o.key, kind: "read", path: "/repo/README.md", output: "# 옛 제목", done: true };
    send({ t: "detail", detail: d });
  } else if (o.cmd === "files") {
    send({ t: "files", query: o.query, files: [{ value: "@src/", label: "src/", path: "src" }, { value: "@README.md", label: "README.md", path: "README.md" }] });
  } else if (o.cmd === "bg-jobs") {
    // 뒤에서 도는 작업 목록(서랍의 '백그라운드 작업 N'): 셸 하나와 에이전트 하나
    send({ t: "bg-jobs", window: 0, jobs: [
      { id: "sh1", kind: "shell", title: "npm test --watch", startedAt: now - 12 * 60e3, tail: "PASS src/a.test.ts\nPASS src/b.test.ts" },
      { id: "ag1", kind: "agent", title: "README 검토", startedAt: now - 3 * 60e3, agentType: "Explore", model: "Haiku 5.5", thinking: "high" },
    ] });
  } else if (o.cmd === "bg-job-kill") {
    send({ t: "notice", text: `종료했어요: ${o.id}` });
  } else if (o.cmd === "compact") {
    send({ t: "compacting", value: true, since: Date.now() });
    setTimeout(() => send({ t: "compacting", value: false }), 2000);
  }
}

const dir = `${process.env.HOME}/.cache/pi-remote/feed`;
mkdirSync(dir, { recursive: true });
const sock = `${dir}/${pane.replace(/\W/g, "")}.sock`;
rmSync(sock, { force: true });
const server = createServer((c) => {
  clients.add(c);
  c.on("close", () => clients.delete(c));
  c.on("error", () => clients.delete(c));
  let buf = "";
  c.setEncoding("utf8");
  c.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const o = JSON.parse(line);
        if (o.cmd) onCommand(o);
      } catch { /* 잘못된 줄은 무시 */ }
    }
  });
  c.write(`${JSON.stringify(snapshot())}\n`);
  c.write(`${JSON.stringify({ t: "commands", commands: [{ name: "review", description: "코드 검토", source: "skill" }] })}\n`);
});
server.listen(sock);
const bye = () => { rmSync(sock, { force: true }); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
