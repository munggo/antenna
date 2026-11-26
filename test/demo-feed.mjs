// README 화면 사진용 예시 대화 피드(모델도 pi·Claude Code 도 띄우지 않음): tmux 칸 하나의 대화 피드 소켓을 열고,
// 붙는 브리지에 정해 둔 예시 대화·카드를 준다. 실제 대화는 쓰지 않는다(test/readme-shots.sh 가 씀).
//   node demo-feed.mjs <칸 id> claude   Claude Code 탭: 도구 단계, 할 일 목록, 컨텍스트 사용량, Slack 보내기 승인 카드
//   node demo-feed.mjs <칸 id> pi       pi 탭: 도구 단계와 고르는 질문 카드
// 소켓 자리는 진짜 피드와 같은 ~/.cache/pi-remote/feed/<칸 번호>.sock (시험 세션의 칸이라 쓰는 탭과 겹치지 않음). 끝날 때 지운다.
// 작성: 서문교
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";

const [pane, scene] = process.argv.slice(2);
if (!pane || !["claude", "pi"].includes(scene)) { console.error("쓰기: node demo-feed.mjs <칸 id> claude|pi"); process.exit(2); }
const dir = `${process.env.HOME}/.cache/pi-remote/feed`;
const sock = `${dir}/${pane.replace(/\W/g, "")}.sock`;
mkdirSync(dir, { recursive: true });
rmSync(sock, { force: true });

const now = Date.now();
const user = (id, text) => ({ id, role: "user", text, images: 0 });
const say = (text) => ({ type: "text", text });
const note = (text) => ({ type: "text", text, update: true });   // 도구 앞의 짧은 진행 설명
const tool = (id, name, desc, summary, stats) => ({ type: "tool", id, name, desc, summary, ...(stats ? { stats } : {}) });
const turn = (id, blocks, stop = "toolUse") => ({ id, role: "assistant", blocks, stop, error: null });
const done = (id, output = "") => ({ id: `r-${id}`, role: "toolResult", toolCallId: id, isError: false, output });

const CLAUDE = {
  agent: "claude",
  messages: [
    user("u1", "로그인 화면에서 키보드가 올라오면 로그인 버튼이 가려져. 고쳐 줘"),
    turn("a1", [
      note("로그인 화면부터 살펴볼게요."),
      tool("t1", "read", "LoginView.swift 읽기", "Weather/Views/LoginView.swift"),
      tool("t2", "grep", "검색: keyboard", "keyboard"),
    ]),
    done("t1"), done("t2"),
    turn("a2", [
      note("버튼이 스크롤 영역 밖에 고정돼 있어서 키보드에 가려져요. 버튼을 스크롤 안으로 옮기고 시험을 돌릴게요."),
      tool("t3", "edit", "LoginView.swift 수정", "Weather/Views/LoginView.swift", { added: 14, removed: 6 }),
      tool("t4", "bash", "시험 돌리기", "xcodebuild test -scheme Weather"),
    ]),
    done("t3"), done("t4", "Executed 42 tests, with 0 failures"),
    turn("a3", [say("고쳤어요.\n\n- 로그인 버튼을 스크롤 영역 안으로 옮겨서, 키보드가 올라오면 함께 밀려 올라가요.\n- 비밀번호 칸에서 **완료**를 누르면 바로 로그인돼요.\n\n시험 42개가 모두 통과했어요. 커밋하고 PR 올릴까요?")], "stop"),
    user("u2", "응, 올리고 팀 채널에도 알려 줘"),
    turn("a4", [
      tool("t5", "bash", "커밋하고 올리기", "git commit -am \"fix: 키보드가 로그인 버튼을 가리던 것\" && git push"),
      tool("t6", "bash", "PR 만들기", "gh pr create --fill"),
    ]),
    done("t5"), done("t6", "https://github.com/example/weather/pull/42"),
    turn("a5", [
      note("PR #42 를 올렸어요. 팀 채널에 보낼 글을 확인해 주세요."),
      tool("t7", "slack · send_message", "slack · send_message", "#ios-dev"),
    ], "pending"),
  ],
  approvals: [{
    id: "ap1", kind: "send", label: "Slack 메시지 보내기", to: "#ios-dev", source: "mcp", since: now - 20_000,
    purpose: "팀 채널에 PR 리뷰 부탁 알리기",
    detail: "로그인 화면에서 키보드가 버튼을 가리던 문제를 고쳤어요. 리뷰 부탁드려요 🙏\nhttps://github.com/example/weather/pull/42",
  }],
  questions: [],
  todos: [
    { content: "원인 찾기", status: "completed" },
    { content: "버튼을 스크롤 안으로 옮기기", status: "completed" },
    { content: "시험 돌리기", status: "completed" },
    { content: "PR 올리기", status: "completed" },
    { content: "팀 채널에 알리기", status: "in_progress", activeForm: "팀 채널에 알리는 중" },
  ],
  context: { tokens: 48_200, window: 200_000, percent: 24.1, auto: true, reserve: 13_000 },
};

const PI = {
  messages: [
    user("u1", "날씨 API 응답이 느려. 캐시 넣어 줘"),
    turn("a1", [
      tool("t1", "grep", "검색: fetchForecast", "fetchForecast"),
      tool("t2", "read", "forecast.ts 읽기", "server/src/forecast.ts"),
    ]),
    done("t1"), done("t2"),
    turn("a2", [say("날씨 API 를 부르는 곳이 세 군데이고, 같은 도시를 1분에 수십 번 묻고 있어요. 캐시를 어디에 둘지 골라 주세요.")], "toolUse"),
  ],
  approvals: [],
  questions: [{
    id: "q1", since: now - 15_000, multiSelect: false,
    question: "캐시를 어디에 둘까요?",
    options: [
      { label: "서버 메모리 (추천)", description: "가장 빠르고 설정이 필요 없어요. 서버를 다시 켜면 비워져요" },
      { label: "Redis", description: "서버 여러 대가 함께 써요. 띄울 것이 하나 늘어요" },
      { label: "캐시 없이 응답만 줄이기", description: "필요한 칸만 받아 크기를 줄여요" },
    ],
  }],
  todos: [],
  context: { tokens: 21_300, window: 200_000, percent: 10.7, auto: true, reserve: 16_384 },
};

const S = scene === "claude" ? CLAUDE : PI;
const snapshot = () => ({
  t: "snapshot", v: 3, messages: S.messages, truncated: 0, working: true, since: now - 95_000, queue: [], canSend: true, notice: null,
  context: S.context, compacting: false, approvals: S.approvals, questions: S.questions, todos: S.todos, planMode: false, permMode: "auto",
  ...(S.agent ? { agent: S.agent } : {}),
});

const server = createServer((c) => {
  c.on("error", () => {});
  c.write(`${JSON.stringify(snapshot())}\n`);
});
server.listen(sock);

const bye = () => { rmSync(sock, { force: true }); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
