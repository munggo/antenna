// 실행: /tmp/ptest/ 에 prompt-test-ext.ts(→ ptest-ext.ts)를 두고, pitest 준비 스크립트 EXT 에 -e /tmp/ptest/ptest-ext.ts 를 더해 띄운 뒤
//       시험 브리지(8799)를 켜고 PI_REMOTE_TOKEN=… node prompt-relay-e2e.mjs [fast|model]
// 확인 창 중계 실제 시험: 시험 브리지(8799)에 폰처럼 붙어 pitest:1 의 확인 창에 답한다
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");
const TOKEN = process.env.PI_REMOTE_TOKEN;
const RESULT = "/tmp/ptest-result.txt";
const P = "pitest:1";
const only = process.argv[2] ?? "";   // "fast" 면 모델 안 쓰는 것만, "model" 이면 모델 쓰는 것만

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmux = (...a) => execFileSync("tmux", a, { encoding: "utf8" });
const paste = (t) => { tmux("send-keys", "-t", P, "-l", `\x1b[200~${t}\x1b[201~`); tmux("send-keys", "-t", P, "Enter"); };
const keys = (...k) => tmux("send-keys", "-t", P, ...k);
const screen = () => tmux("capture-pane", "-p", "-t", P);
const status = () => tmux("show-options", "-w", "-v", "-t", P, "@pi_status").trim();
const result = () => { try { return readFileSync(RESULT, "utf8").trim().split("\n").pop() ?? ""; } catch { return ""; } };

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:8799/?token=${TOKEN}&cols=120&rows=40`);
  const events = [];
  ws.on("message", (d, bin) => {
    if (bin) return;
    const s = d.toString();
    if (!s.startsWith('{"type":"chat"')) return;
    try { events.push(JSON.parse(s).d); } catch { /* 무시 */ }
  });
  const open = new Promise((r) => ws.on("open", r));
  return { ws, events, open, send: (o) => ws.send(JSON.stringify(o)) };
}
async function waitFor(fn, ms = 8000, step = 100) {
  for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}

let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };

const c = connect();
await c.open;
c.send({ type: "select-window", index: 1 });
ok(await waitFor(() => c.events.find((e) => e.t === "snapshot")), "창1 피드 연결");

const qOf = (kind) => c.events.find((e) => e.t === "question" && e.question?.kind === kind)?.question;
const doneOf = (id) => c.events.some((e) => e.t === "question-done" && e.id === id);
const reset = () => { c.events.length = 0; writeFileSync(RESULT, ""); };
const answer = (id, answers, other = "", cancel = false) => c.send({ type: "question-answer", id, answers, other, cancel });

if (only !== "model") {
  // 1. 선택 창: 폰이 먼저 답 → 맥 창이 닫히고 그 답
  reset(); paste("/ptest select");
  let q = await waitFor(() => qOf("select"));
  ok(q && q.question === "Pick a color" && q.options.map((o) => o.label).join() === "Red,Green,Blue", "선택 창이 폰 카드로(제목·선택지)");
  await sleep(500);
  ok(screen().includes("Pick a color"), "맥 화면에도 같은 창");
  answer(q.id, ["Green"]);
  ok(await waitFor(() => result() === 'select="Green"'), "폰 답 → 결과 Green");
  ok(await waitFor(() => doneOf(q.id)), "폰 카드 닫힘(question-done)");
  await sleep(600);
  ok(!screen().includes("Pick a color"), "맥 창 닫힘");

  // 2. 맥이 먼저 답
  reset(); paste("/ptest select");
  q = await waitFor(() => qOf("select"));
  await sleep(500); keys("Down"); await sleep(200); keys("Enter");
  ok(await waitFor(() => result() === 'select="Green"'), "맥 답(↓ Enter) → Green");
  ok(await waitFor(() => doneOf(q.id)), "맥이 답하면 폰 카드 닫힘");

  // 3. 폰 취소
  reset(); paste("/ptest select");
  q = await waitFor(() => qOf("select"));
  answer(q.id, [], "", true);
  ok(await waitFor(() => result() === "select=undefined"), "폰 취소 → 고르지 않음(undefined)");
  await sleep(600);
  ok(!screen().includes("Pick a color"), "취소하면 맥 창도 닫힘");

  // 4. 없는 선택지는 무시 → 맥 Esc 로 끝
  reset(); paste("/ptest select");
  q = await waitFor(() => qOf("select"));
  answer(q.id, ["Purple"]);
  answer(q.id, [], "Purple");
  await sleep(1500);
  ok(result() === "" && !doneOf(q.id), "없는 선택지·기타 글은 무시하고 계속 기다림");
  keys("Escape");
  ok(await waitFor(() => result() === "select=undefined") && await waitFor(() => doneOf(q.id)), "맥 Esc → 취소, 폰 카드 닫힘");

  // 5. 예/아니오
  reset(); paste("/ptest confirm");
  q = await waitFor(() => qOf("confirm"));
  ok(q && q.question === "Delete cache?\nThis removes /tmp/x" && q.options.map((o) => o.label).join() === "예,아니오", "예/아니오 창: 제목+본문, 예·아니오");
  answer(q.id, ["아니오"]);
  ok(await waitFor(() => result() === "confirm=false"), "아니오 → false");
  reset(); paste("/ptest confirm");
  q = await waitFor(() => qOf("confirm"));
  answer(q.id, ["예"]);
  ok(await waitFor(() => result() === "confirm=true"), "예 → true");
  reset(); paste("/ptest confirm");
  q = await waitFor(() => qOf("confirm"));
  answer(q.id, [], "", true);
  ok(await waitFor(() => result() === "confirm=false"), "예/아니오 취소 → false");

  // 6. 글 입력
  reset(); paste("/ptest input");
  q = await waitFor(() => qOf("input"));
  ok(q && q.question === "Your name" && q.options.length === 0 && q.placeholder === "type a name", "입력 창: 제목·안내 문구, 선택지 없음");
  answer(q.id, [], "Alice");
  ok(await waitFor(() => result() === 'input="Alice"'), "폰 입력 → Alice");
  reset(); paste("/ptest input");
  q = await waitFor(() => qOf("input"));
  answer(q.id, [], "");
  await sleep(1000);
  ok(result() === "", "빈 글은 무시");
  await sleep(300); tmux("send-keys", "-t", P, "-l", "Bob"); await sleep(300); keys("Enter");
  ok(await waitFor(() => result() === 'input="Bob"') && await waitFor(() => doneOf(q.id)), "맥 입력 → Bob, 폰 카드 닫힘");

  // 7. 시간 초과·호출한 쪽 취소
  reset(); paste("/ptest timeout");
  q = await waitFor(() => qOf("select"));
  ok(await waitFor(() => result() === "timeout=undefined", 6000) && doneOf(q.id), "시간 초과(3초) → 폰 카드 닫힘");
  reset(); paste("/ptest abort");
  q = await waitFor(() => qOf("select"));
  ok(await waitFor(() => result() === "abort=undefined", 6000) && doneOf(q.id), "부른 쪽이 취소(2.5초) → 폰 카드 닫힘");

  // 8. 나중에 붙은 폰도 스냅숏으로 받음
  reset(); paste("/ptest select");
  q = await waitFor(() => qOf("select"));
  const c2 = connect(); await c2.open; c2.send({ type: "select-window", index: 1 });
  const snap = await waitFor(() => c2.events.find((e) => e.t === "snapshot"));
  ok(snap?.questions?.some((x) => x.id === q.id && x.kind === "select"), "새로 붙은 폰의 스냅숏에 떠 있는 확인 창");
  c2.ws.close();
  answer(q.id, ["Red"]);
  ok(await waitFor(() => result() === 'select="Red"'), "스냅숏 뒤 답 → Red");
}

if (only !== "fast") {
  // 9. 작업 중 도구가 띄운 확인 창: 탭 색 '답을 기다림', 폰 답, 다시 작업 중
  reset(); paste("Call the confirm_test tool exactly once, then reply with the tool result text only.");
  const q = await waitFor(() => qOf("confirm"), 60000);
  ok(!!q, "작업 중 도구의 확인 창이 폰 카드로");
  ok(await waitFor(() => status() === "asking", 3000), "tmux 탭 상태: 답을 기다림(asking)");
  answer(q?.id, ["예"]);
  ok(await waitFor(() => result() === "tool=true"), "폰 '예' → 도구가 true 받음");
  ok(await waitFor(() => ["working", "yourturn"].includes(status()), 5000), `창이 닫힌 뒤 탭 상태: ${status()}`);
  await waitFor(() => c.events.some((e) => e.t === "working" && e.value === false), 60000);

  // 10. ask_user(고르기 질문)는 중계하지 않음(카드 하나, kind 없음)
  reset(); paste("Use the ask_user tool to ask 'Pick one' with options Apple and Banana. Then reply with the chosen answer only.");
  const aq = await waitFor(() => c.events.find((e) => e.t === "question")?.question, 60000);
  await sleep(1500);
  const qs = c.events.filter((e) => e.t === "question");
  ok(aq && qs.length === 1 && !aq.kind, `고르기 질문은 카드 하나, 확인 창 중계 없음(${qs.length}개)`);
  answer(aq?.id, ["Banana"]);
  ok(await waitFor(() => doneOf(aq?.id), 8000), "고르기 질문 답 → 카드 닫힘");
  await waitFor(() => c.events.some((e) => e.t === "working" && e.value === false), 60000);

  // 11. 승인 요청(send-guard)도 중계하지 않음
  reset(); paste("Run exactly this bash command and nothing else: sudo -n true");
  const ap = await waitFor(() => c.events.find((e) => e.t === "approval")?.item, 60000);
  await sleep(1500);
  ok(ap && !c.events.some((e) => e.t === "question"), "승인 요청은 승인 카드만(확인 창 중계 없음)");
  c.send({ type: "approval", id: ap?.id, approved: false });
  ok(await waitFor(() => c.events.some((e) => e.t === "approval-done" && e.id === ap?.id), 8000), "거부 → 승인 카드 닫힘");
  await waitFor(() => c.events.some((e) => e.t === "working" && e.value === false), 60000);
}

c.ws.close();
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
