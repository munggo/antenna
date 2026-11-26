// README 화면 사진용 예시 대화 피드(모델도 pi·Claude Code 도 띄우지 않음): tmux 칸 하나의 대화 피드 소켓을 열고,
// 붙는 브리지에 정해 둔 예시 대화·카드를 준다. 실제 대화는 쓰지 않는다(test/readme-shots.sh 가 씀).
//   node demo-feed.mjs <칸 id> claude   Claude Code 탭: 도구 단계, 할 일 목록, 컨텍스트 사용량, Slack 보내기 승인 카드
//   node demo-feed.mjs <칸 id> pi       pi 탭: 도구 단계와 고르는 질문 카드
//   끝에 en 을 붙이면 영어판(README 영어 사진)
// 소켓 자리는 진짜 피드와 같은 ~/.cache/pi-remote/feed/<칸 번호>.sock (시험 세션의 칸이라 쓰는 탭과 겹치지 않음). 끝날 때 지운다.
// 작성: 서문교
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";

const [pane, scene, lang] = process.argv.slice(2);
if (!pane || !["claude", "pi"].includes(scene)) { console.error("쓰기: node demo-feed.mjs <칸 id> claude|pi [en]"); process.exit(2); }
const t = (ko, en) => (lang === "en" ? en : ko);
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
    user("u1", t("로그인 화면에서 키보드가 올라오면 로그인 버튼이 가려져. 고쳐 줘", "The keyboard covers the login button on the login screen. Fix it")),
    turn("a1", [
      note(t("로그인 화면부터 살펴볼게요.", "Let me look at the login screen first.")),
      tool("t1", "read", t("LoginView.swift 읽기", "Read LoginView.swift"), "Weather/Views/LoginView.swift"),
      tool("t2", "grep", t("검색: keyboard", "Search: keyboard"), "keyboard"),
    ]),
    done("t1"), done("t2"),
    turn("a2", [
      note(t("버튼이 스크롤 영역 밖에 고정돼 있어서 키보드에 가려져요. 버튼을 스크롤 안으로 옮기고 시험을 돌릴게요.", "The button is pinned outside the scroll view, so the keyboard covers it. I'll move it into the scroll view and run the tests.")),
      tool("t3", "edit", t("LoginView.swift 수정", "Edit LoginView.swift"), "Weather/Views/LoginView.swift", { added: 14, removed: 6 }),
      tool("t4", "bash", t("시험 돌리기", "Run tests"), "xcodebuild test -scheme Weather"),
    ]),
    done("t3"), done("t4", "Executed 42 tests, with 0 failures"),
    turn("a3", [say(t("고쳤어요.\n\n- 로그인 버튼을 스크롤 영역 안으로 옮겨서, 키보드가 올라오면 함께 밀려 올라가요.\n- 비밀번호 칸에서 **완료**를 누르면 바로 로그인돼요.\n\n시험 42개가 모두 통과했어요. 커밋하고 PR 올릴까요?", "Fixed.\n\n- Moved the login button into the scroll view, so it moves up with the keyboard.\n- Tapping **Done** in the password field now logs in right away.\n\nAll 42 tests pass. Should I commit and open a PR?"))], "stop"),
    user("u2", t("응, 올리고 팀 채널에도 알려 줘", "Yes, open it and let the team channel know")),
    turn("a4", [
      tool("t5", "bash", t("커밋하고 올리기", "Commit and push"), t("git commit -am \"fix: 키보드가 로그인 버튼을 가리던 것\" && git push", "git commit -am \"fix: keyboard covered login button\" && git push")),
      tool("t6", "bash", t("PR 만들기", "Create PR"), "gh pr create --fill"),
    ]),
    done("t5"), done("t6", "https://github.com/example/weather/pull/42"),
    turn("a5", [
      note(t("PR #42 를 올렸어요. 팀 채널에 보낼 글을 확인해 주세요.", "Opened PR #42. Please check the message for the team channel.")),
      tool("t7", "slack · send_message", "slack · send_message", "#ios-dev"),
    ], "pending"),
  ],
  approvals: [{
    id: "ap1", kind: "send", label: t("Slack 메시지 보내기", "Send a Slack message"), to: "#ios-dev", source: "mcp", since: now - 20_000,
    purpose: t("팀 채널에 PR 리뷰 부탁 알리기", "Ask the team channel to review the PR"),
    detail: t("로그인 화면에서 키보드가 버튼을 가리던 문제를 고쳤어요. 리뷰 부탁드려요 🙏\nhttps://github.com/example/weather/pull/42", "Fixed the keyboard covering the login button. Reviews welcome 🙏\nhttps://github.com/example/weather/pull/42"),
  }],
  questions: [],
  todos: [
    { content: t("원인 찾기", "Find the cause"), status: "completed" },
    { content: t("버튼을 스크롤 안으로 옮기기", "Move the button into the scroll view"), status: "completed" },
    { content: t("시험 돌리기", "Run tests"), status: "completed" },
    { content: t("PR 올리기", "Open a PR"), status: "completed" },
    { content: t("팀 채널에 알리기", "Tell the team channel"), status: "in_progress", activeForm: t("팀 채널에 알리는 중", "Telling the team channel") },
  ],
  context: { tokens: 48_200, window: 200_000, percent: 24.1, auto: true, reserve: 13_000 },
};

const PI = {
  messages: [
    user("u1", t("날씨 API 응답이 느려. 캐시 넣어 줘", "The weather API is slow. Add a cache")),
    turn("a1", [
      tool("t1", "grep", t("검색: fetchForecast", "Search: fetchForecast"), "fetchForecast"),
      tool("t2", "read", t("forecast.ts 읽기", "Read forecast.ts"), "server/src/forecast.ts"),
    ]),
    done("t1"), done("t2"),
    turn("a2", [say(t("날씨 API 를 부르는 곳이 세 군데이고, 같은 도시를 1분에 수십 번 묻고 있어요. 캐시를 어디에 둘지 골라 주세요.", "Three places call the weather API, and they ask for the same city dozens of times a minute. Where should the cache live?"))], "toolUse"),
  ],
  approvals: [],
  questions: [{
    id: "q1", since: now - 15_000, multiSelect: false,
    question: t("캐시를 어디에 둘까요?", "Where should the cache live?"),
    options: [
      { label: t("서버 메모리 (추천)", "In server memory (recommended)"), description: t("가장 빠르고 설정이 필요 없어요. 서버를 다시 켜면 비워져요", "Fastest, no setup. Cleared when the server restarts") },
      { label: "Redis", description: t("서버 여러 대가 함께 써요. 띄울 것이 하나 늘어요", "Shared by several servers. One more thing to run") },
      { label: t("캐시 없이 응답만 줄이기", "No cache, just slimmer responses"), description: t("필요한 칸만 받아 크기를 줄여요", "Request only the needed fields") },
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
