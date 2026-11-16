// ask-user 확장 시험: 가짜 pi 로 '폰 먼저 / 맥 선택 / 기타 입력 / 여러 개 / 중단 / 화면 없음'을 확인한다
import { EventEmitter } from "node:events";

const mod = await import(process.env.ASK_PATH);
let fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "통과" : "실패"}: ${name}`);
  if (!cond) fail++;
};

function setup() {
  const bus = new EventEmitter();
  const sent = [];
  let tool;
  const pi = {
    events: { on: (n, f) => bus.on(n, f), emit: (n, d) => { sent.push([n, d]); bus.emit(n, d); } },
    registerTool: (t) => (tool = t),
    on: () => {},
  };
  mod.default(pi);
  return { pi, tool, sent };
}
const params = { question: "어느 쪽으로 할까요?", options: [{ label: "사과" }, { label: "배", description: "더 달아요" }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. 폰이 먼저 답함 → 맥 창은 닫히고 폰 답을 씀
{
  const { pi, tool, sent } = setup();
  let macClosed = false;
  const ctx = {
    hasUI: true,
    ui: {
      select: (_t, _o, { signal }) => new Promise((r) => signal.addEventListener("abort", () => { macClosed = true; r(undefined); })),
      input: async () => "",
    },
  };
  const p = tool.execute("t1", params, undefined, undefined, ctx);
  await sleep(10);
  const req = sent.find(([n]) => n === "pi-remote:question-request")?.[1];
  ok(req?.options?.length === 2 && req.question === params.question, "질문 요청이 폰 쪽으로 나감");
  pi.events.emit("pi-remote:question-response", { id: req.id, answers: ["배"], other: "" });
  const r = await p;
  ok(r.content[0].text === "사용자가 고른 답: 배" && r.details.by === "phone", "폰 답(배)을 돌려줌");
  ok(macClosed, "폰이 답하면 맥 선택 창을 닫음");
  ok(sent.some(([n, d]) => n === "pi-remote:question-done" && d.id === req.id), "끝나면 질문 카드 내리기 알림");
}

// 2. 맥에서 고름
{
  const { tool } = setup();
  const ctx = { hasUI: true, ui: { select: async (_t, o) => o[0], input: async () => "" } };
  const r = await tool.execute("t2", params, undefined, undefined, ctx);
  ok(r.content[0].text === "사용자가 고른 답: 사과" && r.details.by === "mac", "맥에서 고른 답(사과)");
}

// 3. 맥에서 기타 → 직접 입력
{
  const { tool } = setup();
  let shown = [];
  const ctx = { hasUI: true, ui: { select: async (_t, o) => { shown = o; return o[o.length - 1]; }, input: async () => "둘 다 싫어요" } };
  const r = await tool.execute("t3", params, undefined, undefined, ctx);
  ok(shown.at(-1) === "기타(직접 입력)" && shown[1] === "2. 배 — 더 달아요", "맥 창에 번호·설명·기타가 보임");
  ok(r.content[0].text === "사용자가 직접 쓴 답: 둘 다 싫어요", "기타 입력을 돌려줌");
}

// 4. 여러 개 고르기(맥: 번호 입력, 폰: 여러 답)
{
  const { tool } = setup();
  const ctx = { hasUI: true, ui: { select: async (_t, o) => o.find((x) => x.startsWith("여러 개")), input: async () => "1, 2, 9" } };
  const r = await tool.execute("t4", { ...params, multiSelect: true }, undefined, undefined, ctx);
  ok(r.content[0].text === "사용자가 고른 답: 사과, 배", "맥 여러 개(없는 번호 9는 무시)");

  const s2 = setup();
  const ctx2 = { hasUI: true, ui: { select: (_t, _o, { signal }) => new Promise((r) => signal.addEventListener("abort", () => r(undefined))), input: async () => "" } };
  const p = s2.tool.execute("t4b", { ...params, multiSelect: true }, undefined, undefined, ctx2);
  await sleep(10);
  const req = s2.sent.find(([n]) => n === "pi-remote:question-request")[1];
  ok(req.multiSelect === true, "폰에 여러 개 고르기 표시가 감");
  s2.pi.events.emit("pi-remote:question-response", { id: req.id, answers: ["사과", "배"], other: "참고: 껍질 벗겨서" });
  const r2 = await p;
  ok(r2.content[0].text === "사용자가 고른 답: 사과, 배\n사용자가 직접 쓴 답: 참고: 껍질 벗겨서", "폰 여러 개 + 덧붙인 말");
}

// 5. 맥 창을 Esc 로 닫음 / 작업 중단
{
  const { tool } = setup();
  const r = await tool.execute("t5", params, undefined, undefined, { hasUI: true, ui: { select: async () => undefined, input: async () => "" } });
  ok(r.content[0].text.includes("답하지 않고") && r.content[0].text.includes("기다린다"), "맥에서 닫으면 '답 없이 닫음, 기다려라'");

  const s2 = setup();
  const ac = new AbortController();
  const ctx = { hasUI: true, ui: { select: (_t, _o, { signal }) => new Promise((r) => signal.addEventListener("abort", () => r(undefined))), input: async () => "" } };
  const p = s2.tool.execute("t5b", params, ac.signal, undefined, ctx);
  await sleep(10);
  ac.abort();
  const r2 = await p;
  ok(r2.content[0].text.includes("중단") && s2.sent.some(([n]) => n === "pi-remote:question-done"), "작업을 멈추면 끝내고 카드도 내림");
}

// 6. 화면 없는 실행(하위 에이전트·pi -p)
{
  const { tool, sent } = setup();
  const r = await tool.execute("t6", params, undefined, undefined, { hasUI: false });
  ok(r.content[0].text.startsWith("화면이 없는") && !sent.length, "화면 없으면 묻지 않고 알려 줌");
}

// 7. 다른 질문의 답은 무시
{
  const { pi, tool, sent } = setup();
  const ctx = { hasUI: true, ui: { select: (_t, _o, { signal }) => new Promise((r) => signal.addEventListener("abort", () => r(undefined))), input: async () => "" } };
  const p = tool.execute("t7", params, undefined, undefined, ctx);
  await sleep(10);
  pi.events.emit("pi-remote:question-response", { id: "q-다른것", answers: ["사과"] });
  let settled = false;
  p.then(() => (settled = true));
  await sleep(20);
  ok(!settled, "다른 질문 번호의 답은 받지 않음");
  const req = sent.find(([n]) => n === "pi-remote:question-request")[1];
  pi.events.emit("pi-remote:question-response", { id: req.id, answers: ["사과"] });
  ok((await p).content[0].text === "사용자가 고른 답: 사과", "맞는 번호의 답은 받음");
}


// 여러 질문: 한 번에 묻기
const qs2 = { questions: [
  { question: "색은?", options: [{ label: "빨강" }, { label: "파랑" }] },
  { question: "크기는?\n자세한 설명", options: [{ label: "작게" }, { label: "크게" }], multiSelect: true },
] };
const respond = (setupObj, d) => setupObj.pi.events.emit("pi-remote:question-response", d);
{
  const S = setup();
  let closed = false;
  const ctx = { hasUI: true, ui: { select: (_t, _o, { signal }) => new Promise((r) => signal.addEventListener("abort", () => { closed = true; r(undefined); })), input: async () => "" } };
  const p = S.tool.execute("m1", qs2, undefined, undefined, ctx);
  await sleep(10);
  const reqs = S.sent.filter(([n]) => n === "pi-remote:question-request");
  const req = reqs[0]?.[1];
  ok(reqs.length === 1 && req?.items?.length === 2 && req.question.startsWith("질문 2개\n1. 색은?\n2. 크기는?") && req.items[1].multiSelect === true,
    "여러 질문: 요청(알림)은 한 번, items 2개, 질문 글은 목록");
  respond(S, { id: req.id, answers: [], other: "", items: [{ answers: ["파랑"], other: "" }, { answers: ["작게", "크게"], other: "둘 다 시험" }] });
  const r = await p;
  const t = r.content[0].text;
  ok(closed && t.includes("1. 색은? → 사용자가 고른 답: 파랑") && t.includes("2. 크기는? → 사용자가 고른 답: 작게, 크게 / 사용자가 직접 쓴 답: 둘 다 시험"),
    "여러 질문: 폰이 질문별로 답 → 맥 창 닫고 줄마다 답");
  ok(r.details.items?.length === 2 && r.details.by === "phone", "여러 질문: details.items");
}
{
  const S = setup();
  const titles = [];
  const ctx = { hasUI: true, ui: {
    select: async (t, o) => { titles.push(t); return t.startsWith("(1/2)") ? o[0] : o.find((x) => x.startsWith("여러 개")); },
    input: async () => "1, 2",
  } };
  const r = await S.tool.execute("m2", qs2, undefined, undefined, ctx);
  ok(titles[0] === "(1/2) 색은?" && titles[1].startsWith("(2/2) 크기는?") && r.content[0].text.includes("1. 색은? → 사용자가 고른 답: 빨강")
    && r.content[0].text.includes("2. 크기는? → 사용자가 고른 답: 작게, 크게"), "여러 질문: 맥에서 차례로(번호 붙은 제목)");
}
{
  const S = setup();
  let n = 0;
  const ctx = { hasUI: true, ui: { select: async (_t, o) => (n++ === 0 ? o[1] : undefined), input: async () => "" } };
  const r = await S.tool.execute("m3", qs2, undefined, undefined, ctx);
  ok(r.content[0].text.includes("답하지 않고 질문을 닫았다") && r.details.by === "cancel", "여러 질문: 맥에서 중간에 닫으면 전체를 닫은 것으로");
}
{
  const S = setup();
  const ctx = { hasUI: true, ui: { select: async (_t, o) => o[0], input: async () => "" } };
  const r = await S.tool.execute("m4", { questions: [qs2.questions[0]] }, undefined, undefined, ctx);
  const req = S.sent.find(([n]) => n === "pi-remote:question-request")?.[1];
  ok(!req.items && req.question === "색은?" && req.options.length === 2 && r.content[0].text === "사용자가 고른 답: 빨강", "질문 하나는 배열로 줘도 예전 형식");
}
{
  const S = setup();
  const r = await S.tool.execute("m5", { questions: [] }, undefined, undefined, { hasUI: true, ui: {} });
  ok(r.details.by === "invalid" && !S.sent.length, "질문이 비면 묻지 않음");
}

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
