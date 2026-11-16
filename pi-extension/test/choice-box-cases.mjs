// 번호 상자 시험: sh test/run.sh (CHOICE_PATH·ASK_PATH 에 사본)
const m = await import(process.env.CHOICE_PATH);
const ask = await import(process.env.ASK_PATH);
const { visibleWidth } = await import(new URL("node_modules/@earendil-works/pi-tui/dist/index.js", `file://${process.env.CHOICE_PATH.replace(/lib\/[^/]+$/, "")}`).href);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
// 가짜 화면: 상자를 띄우고 키를 차례로 넣음
const fakeCtx = (keysPerBox, inputText = "") => {
  const shown = [];
  return { shown, ui: {
    custom: (factory) => new Promise((resolve) => {
      const comp = factory({ requestRender() {} }, null, null, resolve);
      shown.push(comp.render(70).join("\n"));
      for (const k of keysPerBox.shift() ?? []) comp.handleInput(k);
    }),
    input: async () => inputText, select: async () => undefined,
  } };
};
const UP = "\x1b[A", DOWN = "\x1b[B", ENTER = "\r", ESC = "\x1b", LEFT = "\x1b[D";
const spec = { question: "색은?\n설명 줄", options: [{ label: "빨강" }, { label: "파랑", description: "차가운 색" }], allowOther: true };

// 1. 그리기
const lines = m.choiceLines({ ...spec, step: "2/3" }, 1, new Set(), 60);
ok(lines.every((l) => visibleWidth(l) <= 60) && lines[0].includes("● pi가 물어봐요 (2/3)") && lines.some((l) => l.includes("❯ 2. 파랑")) && lines.some((l) => l.includes("3. 직접 입력")) && lines.some((l) => l.includes("← 앞 질문")), "그리기: 폭 안·제목·번호·직접 입력·← 안내");

// 2. 하나 고르기
let c = fakeCtx([["2"]]); ok((await m.askChoice(c, spec)).picks[0] === 1, "숫자 2 → 바로 파랑");
c = fakeCtx([[DOWN, ENTER]]); ok((await m.askChoice(c, spec)).picks[0] === 1, "↓ Enter → 파랑");
c = fakeCtx([[UP, ENTER]]); ok((await m.askChoice(c, spec)).other === true, "↑ 로 맨 아래(직접 입력) 돌아 Enter");
c = fakeCtx([["3"]]); ok((await m.askChoice(c, spec)).other === true, "숫자 3 → 직접 입력");
c = fakeCtx([[ESC]]); ok((await m.askChoice(c, spec)) === undefined, "Esc → 닫기");
c = fakeCtx([["9"]]); const pend = m.askChoice(c, spec); let settled = false; pend.then(() => (settled = true)); await new Promise((r) => setTimeout(r, 20));
ok(!settled, "없는 번호(9)는 무시");

// 3. 여러 개
c = fakeCtx([["1", "2", ENTER]]); ok(JSON.stringify((await m.askChoice(c, { ...spec, multi: true })).picks) === "[0,1]", "여러 개: 1·2 체크 → Enter");
c = fakeCtx([[" ", DOWN, " ", " ", ENTER]]); ok(JSON.stringify((await m.askChoice(c, { ...spec, multi: true })).picks) === "[0]", "여러 개: Space 로 체크·해제");
c = fakeCtx([[ENTER]]); ok(JSON.stringify((await m.askChoice(c, { ...spec, multi: true })).picks) === "[0]", "여러 개: 아무것도 안 고르고 Enter → 지금 줄");

// 4. 앞 질문·중단·못 그리는 환경
c = fakeCtx([[LEFT]]); ok((await m.askChoice(c, { ...spec, step: "2/2" })).back === true, "← (두 번째 질문) → 앞 질문");
const ac = new AbortController(); c = { ui: { custom: (f) => new Promise((res) => { f({ requestRender() {} }, null, null, res); }) } };
const p = m.askChoice(c, spec, ac.signal); ac.abort(); ok((await p) === undefined, "작업 중단(signal) → 닫힘");
ok((await m.askChoice({ ui: {} }, spec)) === "unsupported", "상자를 못 그리면 unsupported");

// 5. ask_user 와 연결
const setup = () => { const sent = []; let tool; ask.default({ events: { on() {}, emit: (n, d) => sent.push([n, d]) }, registerTool: (t) => (tool = t), on() {} }); return { tool, sent }; };
let S = setup(); c = fakeCtx([["2"]]);
let r = await S.tool.execute("1", { question: "색은?", options: [{ label: "빨강" }, { label: "파랑" }] }, undefined, undefined, { hasUI: true, ...c });
ok(r.content[0].text === "사용자가 고른 답: 파랑" && c.shown[0].includes("● pi가 물어봐요"), "ask_user: 맥 번호 상자로 '2' → 파랑");
S = setup(); c = fakeCtx([["1"], [LEFT], ["2"], ["3"]], "직접 쓴 크기");
r = await S.tool.execute("2", { questions: [{ question: "색은?", options: [{ label: "빨강" }, { label: "파랑" }] }, { question: "크기는?", options: [{ label: "작게" }, { label: "크게" }] }] }, undefined, undefined, { hasUI: true, ...c });
ok(c.shown.length === 4 && c.shown[0].includes("(1/2)") && c.shown[1].includes("(2/2)") && c.shown[2].includes("(1/2)"), "여러 질문: (1/2)→(2/2)→← 로 (1/2)→(2/2)");
ok(r.content[0].text.includes("1. 색은? → 사용자가 고른 답: 파랑") && r.content[0].text.includes("2. 크기는? → 사용자가 직접 쓴 답: 직접 쓴 크기"), "여러 질문: 고쳐 고른 답·직접 입력이 결과에");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
