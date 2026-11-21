// Claude Code 승인·질문 카드 실제 시험: 시험 tmux 세션(pitest)의 Claude Code(Haiku, 매번 묻기)에 폰처럼 붙어
// 폰 카드로 답하기·맥에서 먼저 답하기를 확인. 실행: node claude-remote/test/claude-cards-e2e.mjs
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname;
const S = "pitest", PORT = 8799, TOKEN = "cc-cards-token", LOG = "/tmp/cc-cards-bridge.log", DIR = "/tmp/cctest";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch { return ""; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };

rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const node = process.execPath, hook = `${REPO}claude-remote/pi-remote-hook.mjs`;
const H = { matcher: "", hooks: [{ type: "command", command: `"${node}" "${hook}"`, timeout: 5 }] };
const events = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"];
writeFileSync("/tmp/cctest-hooks.json", JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [H]])) }));
const claude = execFileSync("/bin/zsh", ["-lc", "whence -p claude"], { encoding: "utf8" }).trim();
execFileSync("sh", [`${REPO}claude-remote/test/stop-test-feeds.sh`, S]);   // 시험 세션 피드만(쓰는 창 피드는 그대로)
tm("kill-session", "-t", S);
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
tm("new-window", "-t", S, "-c", DIR, `${claude} --model haiku --permission-mode manual --setting-sources project,local --settings /tmp/cctest-hooks.json`);
const pane = tm("display", "-p", "-t", `${S}:1`, "#{pane_id}");
const sock = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  if (/Yes, I trust this folder/.test(tm("capture-pane", "-p", "-t", `${S}:1`))) { tm("send-keys", "-t", `${S}:1`, "Down"); await sleep(300); tm("send-keys", "-t", `${S}:1`, "Enter"); }
  if (existsSync(sock)) break;
}
writeFileSync(LOG, "");
// 맥이 잠긴 것으로(시험을 돌리는 동안 맥을 쓰고 있어 알림이 보류되지 않게)
writeFileSync("/tmp/cc-test-locked", "1");
const bridge = spawn(node, ["bridge.mjs"], {
  cwd: `${REPO}server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S,
    PI_REMOTE_SESSION_DIR: "/tmp/cc-cards-sessions", PI_REMOTE_PUSH_FILE: "/tmp/cc-cards-push.json", PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_FAKE_LOCKED_FILE: "/tmp/cc-test-locked" },
  stdio: ["ignore", "pipe", "pipe"],
});
const append = (d) => writeFileSync(LOG, readFileSync(LOG, "utf8") + d);
bridge.stdout.on("data", append); bridge.stderr.on("data", append);
await sleep(2500);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
const screenCards = [];   // 화면 창 카드(훅 없이 묻는 창용). 승인·질문 창에 함께 뜨면 안 됨
ws.on("message", (d, bin) => {
  if (bin) return;
  try {
    const m = JSON.parse(d.toString());
    if (m.type !== "chat") return;
    ev.push(m.d);
    if (m.d.t === "question" && /^cc-s-/.test(m.d.question?.id ?? "")) screenCards.push(m.d.question.question.split("\n")[0]);
  } catch {}
});
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
ok(await waitFor(() => ev.find((e) => e.t === "snapshot" && e.agent === "claude"), 10000), "Claude Code 탭 피드에 붙음");

const say = (text) => { ev.length = 0; ws.send(JSON.stringify({ type: "pi-send", text, mode: "auto" })); };
const idle = () => waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 60000);
const answerOf = () => ev.filter((e) => e.t === "upsert" && e.message?.role === "toolResult" && e.message.answer !== undefined).map((e) => e.message.answer).pop();

// 1) 승인 카드: 폰에서 허용
say(`Use the Write tool to create the file ${DIR}/ok.txt containing yes. Do nothing else.`);
let ap = await waitFor(() => ev.find((e) => e.t === "approval"), 60000);
ok(ap && /ok\.txt/.test(ap.item.label) && /ok\.txt/.test(ap.item.detail), `승인 카드(${ap?.item.label})`);
ws.send(JSON.stringify({ type: "approval", id: ap?.item.id, approved: true }));
ok(await waitFor(() => ev.some((e) => e.t === "approval-done" && e.id === ap?.item.id), 5000), "폰에서 허용 → 카드 닫힘");
ok(await waitFor(() => existsSync(`${DIR}/ok.txt`), 20000), "허용했으니 파일이 생김");
await idle();

// 2) 승인 카드: 폰에서 거부 → 작업 멈춤·끝 표시
say(`Run this bash command: touch ${DIR}/no.txt`);
ap = await waitFor(() => ev.find((e) => e.t === "approval"), 60000);
ok(ap && ap.item.detail.includes("touch"), "명령 승인 카드(명령 전체)");
ws.send(JSON.stringify({ type: "approval", id: ap?.item.id, approved: false }));
ok(await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 15000), "폰에서 거부 → 작업이 멈추고 '작업 끝'");
ok(!existsSync(`${DIR}/no.txt`), "거부했으니 파일 없음");
ok(tm("show-options", "-w", "-v", "-t", `${S}:1`, "@pi_status") !== "working", "탭 점이 '작업 중'으로 남지 않음");

// 3) 승인 카드: 맥에서 먼저 허용 → 폰 카드 사라짐
say(`Use the Write tool to create the file ${DIR}/mac.txt containing mac. Do nothing else.`);
ap = await waitFor(() => ev.find((e) => e.t === "approval"), 60000);
tm("send-keys", "-t", `${S}:1`, "1");
ok(await waitFor(() => ev.some((e) => e.t === "approval-done" && e.id === ap?.item.id), 8000), "맥에서 먼저 허용 → 폰 카드 사라짐");
ok(await waitFor(() => existsSync(`${DIR}/mac.txt`), 20000), "맥에서 허용한 파일 생김");
await idle();

// 4) 질문 둘(하나 고르기 + 여러 개 고르기)
say("Use the AskUserQuestion tool once with two questions: first 'Color?' (header Color) with options Red and Blue; second 'Size?' (header Size) with options Small and Large and multiSelect true. Then reply with the answers only.");
let q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
ok(q && q.question.items?.length === 2 && q.question.items[1].multiSelect === true, "질문 카드(질문 둘, 둘째는 여러 개)");
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, items: [{ answers: ["Blue"], other: "" }, { answers: ["Small", "Large"], other: "" }] }));
ok(await waitFor(() => ev.some((e) => e.t === "question-done"), 5000), "폰에서 답 → 카드 닫힘");
ok(await waitFor(() => answerOf() === "Blue / Small, Large", 30000), `맥 질문 창에 답이 들어감(${answerOf()})`);
await idle();

// 4-1) 폰에서 터미널을 보느라 맥 탭이 폰 폭으로 좁아져도: 질문 창 안내('Esc to cancel')가 두 줄로 접혀
//      '맥 창이 닫혔다'고 보고 3초 만에 폰 카드를 닫던 것(11-21 사용자 보고 '응답을 기다린다는데 카드가 안 온다')
tm("resize-window", "-t", `${S}:1`, "-x", "48", "-y", "40");   // 48칸이면 안내가 'Esc to' / 'cancel' 로 접힘(11-21 확인)
await sleep(1500);
say("Use the AskUserQuestion tool once with one question 'Fruit?' (header Fruit) with options Apple and Pear. Then reply with the answer only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
const narrow = await waitFor(() => { const s = tm("capture-pane", "-p", "-t", `${S}:1`); return /Esc\s+to\s+cancel/.test(s) && !/Esc to cancel/.test(s); }, 10000);
ok(narrow, "좁은 화면: 맥 질문 창 안내가 두 줄로 접힘(재현 조건)");
await sleep(6000);
ok(q && !ev.some((e) => e.t === "question-done" && e.id === q.question.id), "좁은 화면: 6초가 지나도 폰 질문 카드가 그대로");
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, answers: ["Pear"], other: "" }));
ok(await waitFor(() => answerOf() === "Pear", 30000), `좁은 화면: 폰 답이 맥에 들어감(${answerOf()})`);
await idle();
tm("resize-window", "-t", `${S}:1`, "-x", "160", "-y", "45");
await sleep(1500);

// 5) 질문 하나 + 직접 입력
say("Use the AskUserQuestion tool once with one question 'Pet?' (header Pet) with options Cat and Dog. Then reply with the answer only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, answers: [], other: "Hamster" }));
ok(await waitFor(() => answerOf() === "Hamster", 30000), `직접 입력 답(${answerOf()})`);
await idle();

// 6) 여러 개 고르기 + 직접 입력
say("Use the AskUserQuestion tool once with one question 'Drinks?' (header Drinks) with options Tea and Coffee and multiSelect true. Then reply with the answers only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, answers: ["Tea"], other: "Juice" }));
ok(await waitFor(() => answerOf() === "Tea, Juice", 30000), `여러 개 + 직접 입력 답(${answerOf()})`);
await idle();

// 6-1) 미리보기 그림이 있는 문항: 숫자 키가 먹지 않아 폰 답이 들어가지 않았다(11-20 사용자 보고 '이미 다 선택했는데 다시 뜬다')
say("Use the AskUserQuestion tool once with two questions: first 'Shape?' (header Shape) with options Round, Square and Star, and give every option a short 'preview' field containing a tiny ASCII drawing; second 'Tone?' (header Tone) with options Warm and Cool (no previews). Then reply with the answers only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
ok(q && q.question.items?.[0]?.preview === true && !q.question.items?.[1]?.preview, "미리보기 문항 표시(첫째만)");
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, items: [{ answers: ["Star"], other: "" }, { answers: ["Cool"], other: "" }] }));
ok(await waitFor(() => answerOf() === "Star / Cool", 30000), `미리보기 문항 셋째 고르기 + 다음 문항(${answerOf()})`);
await idle();

// 6-2) 미리보기 문항에 직접 쓴 글 → 메모
say("Use the AskUserQuestion tool once with one question 'Logo?' (header Logo) with options Owl and Cat, and give every option a short 'preview' field containing a tiny ASCII drawing. Then reply with the answer only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, answers: [], other: "더 둥글게" }));
ok(await waitFor(() => answerOf() === "메모: 더 둥글게", 30000), `미리보기 문항에 쓴 글은 메모로(${answerOf()})`);
await idle();

// 6-3) 글 없이 사진만 보내기('@사진경로' 한 줄): 입력창의 파일 고르기 목록이 Enter 를 먹어 보내지지 않았다(11-21 사용자 보고)
const IMG = `${process.env.HOME}/.cache/pi-remote/img-${Date.now()}000.png`;
writeFileSync(IMG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));   // 1×1 그림
ev.length = 0;
ws.send(JSON.stringify({ type: "pi-send", text: `@${IMG}`, mode: "auto", images: [IMG] }));
ok(await waitFor(() => ev.some((e) => e.t === "working" && e.value === true), 20000), "사진만 보내도 Claude Code 가 받아 일을 시작");
const imgAnswered = await waitFor(() => ev.some((e) => e.t === "upsert" && e.message?.role === "assistant" && e.message.stop === "stop"), 60000);
ok(imgAnswered, "사진만 보낸 것에 답이 옴");
if (!imgAnswered) console.log(tm("capture-pane", "-p", "-t", `${S}:1`).split("\n").filter((l) => l.trim()).slice(-12).map((l) => `     | ${l}`).join("\n"));
await idle();
await sleep(2000);   // 답 뒤의 늦은 이벤트가 다음 단계로 넘어가지 않게
rmSync(IMG, { force: true });

// 7) 폰에서 취소 → Esc
say("Use the AskUserQuestion tool once with one question 'Day?' (header Day) with options Mon and Tue. Then reply with the answer only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
ws.send(JSON.stringify({ type: "question-answer", id: q?.question.id, answers: [], other: "", cancel: true }));
ok(await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 15000), "폰에서 취소 → 질문 창 닫히고 작업 끝");
ok(!/Esc to cancel/.test(tm("capture-pane", "-p", "-t", `${S}:1`)), "맥 질문 창도 닫힘");
const ups = () => ev.filter((e) => e.t === "upsert").map((e) => e.message);
ok(await waitFor(() => ups().some((m) => m.role === "assistant" && m.stop === "aborted"), 10000) && !ups().some((m) => m.role === "user" && /Request interrupted/.test(m.text ?? "")),
  `Claude Code 의 멈춤 표시는 내 말풍선이 아니라 앱의 '중단됨' 줄로(사용자 보고 11-19): ${ups().map((m) => m.role === "user" ? `user:${m.text}` : `${m.role}:${m.stop ?? ""}`).join(" ")}`);

// 8) 맥에서 먼저 답 → 폰 카드 사라짐
say("Use the AskUserQuestion tool once with one question 'Season?' (header Season) with options Spring and Fall. Then reply with the answer only.");
q = await waitFor(() => ev.find((e) => e.t === "question"), 60000);
await sleep(1000);
tm("send-keys", "-t", `${S}:1`, "2");
ok(await waitFor(() => ev.some((e) => e.t === "question-done" && e.id === q?.question.id), 8000), "맥에서 먼저 답 → 폰 카드 사라짐");
ok(await waitFor(() => answerOf() === "Fall", 30000), `맥에서 고른 답(${answerOf()})`);
await idle();

// 9) 알림(시험 모드 기록): 승인·고르기
const log = readFileSync(LOG, "utf8");
ok(/알림\(시험·안 보냄\) approval 탭 1/.test(log) && /알림\(시험·안 보냄\) choice 탭 1/.test(log), "승인·고르기 폰 알림");
ok(!screenCards.length, `승인·질문 창을 화면 창 카드로 겹쳐 띄우지 않음${screenCards.length ? `(${screenCards.join(" / ")})` : ""}`);

ws.close(); bridge.kill(); await sleep(500);
execFileSync("sh", [`${REPO}claude-remote/test/stop-test-feeds.sh`, S]);   // 시험 세션 피드만(쓰는 창 피드는 그대로)
tm("kill-session", "-t", S);
rmSync("/tmp/cc-cards-sessions", { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
