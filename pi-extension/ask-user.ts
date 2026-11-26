/**
 * 사용자에게 고르게 묻기(ask_user)
 *
 * - pi 가 사용자에게 선택을 물을 때 쓰는 도구. 선택지 버튼(여러 개 고르기 가능)과 '기타(직접 입력)'
 * - 맥에는 선택 창, 폰(pi-remote)에는 질문 카드를 띄우고 먼저 답한 쪽을 따른다
 * - 화면이 없는 실행(하위 에이전트·pi -p)은 물어볼 곳이 없으므로 그렇게 알려 준다
 *
 * 폰과는 pi-remote-feed 확장이 pi.events 로 이어 준다:
 *   pi-remote:question-request  {id, question, options:[{label, description}], multiSelect, since, items?:[{question, options, multiSelect}]}
 *   pi-remote:question-response {id, answers:[label], other, items?:[{answers, other}]}   (여러 질문이면 items)
 *   pi-remote:question-done     {id}
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { askChoice } from "./lib/choice-box.ts";
import { tr } from "./lib/lang.mjs";   // 폰에 보이는 글의 언어(PI_REMOTE_LANG)

const GUIDE =
  "When you need the user to choose between options, confirm yes or no, or decide how to proceed, call ask_user instead of " +
  "ending your reply with a question in plain text. This includes choosing between several plans or approaches you describe: " +
  "put each plan into an option. Options can be short labels or full sentences when the choice needs detail. The user taps an " +
  "option on the phone or Mac, or types another answer. Do not use it for rhetorical questions or simple acknowledgements. " +
  "If you have several things to ask, ask them all at once: put every question into a single ask_user call using `questions` " +
  "(the user gets one notification). Never ask them one by one in separate calls or turns.";

type Answer = { answers: string[]; other: string; by: string; items?: { answers: string[]; other: string }[] };
type Q = { question: string; options: { label: string; description: string }[]; multi: boolean };
const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";

export default function (pi: ExtensionAPI) {
  let seq = 0;
  const waiting = new Map<string, (a: Answer) => void>();
  const strs = (x: any) => (Array.isArray(x) ? x.map(String) : []);

  // 폰의 답(pi-remote-feed 가 전달). 여러 질문이면 items 에 질문별 답
  pi.events.on("pi-remote:question-response", (r: any) => {
    waiting.get(String(r?.id ?? ""))?.({
      answers: strs(r?.answers),
      other: String(r?.other ?? ""),
      by: "phone",
      ...(Array.isArray(r?.items) ? { items: r.items.map((x: any) => ({ answers: strs(x?.answers), other: String(x?.other ?? "") })) } : {}),
    });
  });

  const Option = Type.Object({
    label: Type.String({ description: "Option text in Korean: a short label, or a full sentence when the choice needs detail" }),
    description: Type.Optional(Type.String({ description: "Optional extra explanation shown under the option" })),
  });

  pi.registerTool({
    name: "ask_user",
    label: "사용자에게 묻기",
    description:
      "Ask the user to choose between options (or yes/no) and wait for the answer. The question appears as buttons on the " +
      "user's phone and as a dialog on the Mac. The user can also type another answer. To ask several questions, pass them " +
      "all in `questions` in one call; for a single question you may use `question`/`options` instead.",
    parameters: Type.Object({
      questions: Type.Optional(
        Type.Array(
          Type.Object({
            question: Type.String({ description: "The question in Korean. Add context on following lines when needed" }),
            options: Type.Array(Option, { minItems: 2, maxItems: 6 }),
            multiSelect: Type.Optional(Type.Boolean({ description: "Allow choosing several options" })),
          }),
          { minItems: 1, maxItems: 6, description: "All questions to ask at once (one notification). Use this whenever there is more than one question" },
        ),
      ),
      question: Type.Optional(Type.String({ description: "A single question in Korean (when not using `questions`)" })),
      options: Type.Optional(Type.Array(Option, { minItems: 2, maxItems: 6 })),
      multiSelect: Type.Optional(Type.Boolean({ description: "Allow choosing several options" })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      if (!ctx?.hasUI) {
        return { content: [{ type: "text", text: "화면이 없는 실행이라 사용자에게 물을 수 없다. 이 질문을 결과로 돌려보내 메인 대화에서 묻게 한다." }], details: { by: "no-ui" } };
      }
      const raw = Array.isArray(params.questions) && params.questions.length ? params.questions : [params];
      const qs: Q[] = raw
        .map((q: any) => ({
          question: String(q?.question ?? ""),
          options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({ label: String(o?.label ?? ""), description: String(o?.description ?? "") })),
          multi: !!q?.multiSelect,
        }))
        .filter((q: Q) => q.question.trim() && q.options.length);
      if (!qs.length) return { content: [{ type: "text", text: "질문이나 선택지가 비어 있어 묻지 못했다." }], details: { by: "invalid" } };
      const many = qs.length > 1;
      const id = `q-${Date.now()}-${++seq}`;
      // 하나면 예전 형식 그대로, 여럿이면 items(질문 글은 목록으로: 알림·옛 앱용)
      const request = many
        ? { id, question: [tr(`질문 ${qs.length}개`, `${qs.length} questions`), ...qs.map((q, i) => `${i + 1}. ${firstLine(q.question)}`)].join("\n"), options: [], multiSelect: false,
            items: qs.map((q) => ({ question: q.question, options: q.options, multiSelect: q.multi })), since: Date.now() }
        : { id, question: qs[0].question, options: qs[0].options, multiSelect: qs[0].multi, since: Date.now() };
      pi.events.emit("pi-remote:question-request", request);

      const ac = new AbortController();
      /** 맥 선택 창 하나(첫 항목 아래에 '여러 개 고르기'·'기타'). null 이면 폰이 먼저 답해 닫힘 */
      const askMac = async (q: Q, title: string): Promise<Answer | null> => {
        const OTHER = "기타(직접 입력)";
        const MULTI = "여러 개 고르기(번호 입력)";
        const labels = q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
        const choice = await ctx.ui.select(title, [...labels, ...(q.multi ? [MULTI] : []), OTHER], { signal: ac.signal });
        if (ac.signal.aborted) return null;
        if (choice === undefined) return { answers: [], other: "", by: "cancel" };
        if (choice === OTHER || choice === MULTI) {
          const text = await ctx.ui.input(choice === MULTI ? "고를 번호(쉼표로 구분)" : "직접 입력", "", { signal: ac.signal });
          if (ac.signal.aborted) return null;
          if (choice === MULTI) {
            const picks = String(text ?? "").split(/[,\s]+/).map((x) => Number(x) - 1).filter((i) => i >= 0 && i < q.options.length);
            return { answers: picks.map((i) => q.options[i].label), other: "", by: "mac" };
          }
          return { answers: [], other: String(text ?? ""), by: "mac" };
        }
        const i = labels.indexOf(choice);
        return { answers: i >= 0 ? [q.options[i].label] : [], other: "", by: "mac" };
      };
      /** 맥 번호 상자(Claude Code 처럼 숫자로 바로 고르기). 못 그리면 기본 선택 창. "back" 이면 앞 질문 */
      const askBox = async (q: Q, step?: string): Promise<Answer | null | "back"> => {
        const r = await askChoice(ctx, { question: q.question, options: q.options, multi: q.multi, allowOther: true, step }, ac.signal);
        if (r === "unsupported") return askMac(q, step ? `(${step}) ${q.question}` : q.question);
        if (ac.signal.aborted) return null;
        if (!r) return { answers: [], other: "", by: "cancel" };
        if (r.back) return "back";
        const answers = r.picks.map((i) => q.options[i].label);
        if (!r.other) return { answers, other: "", by: "mac" };
        const text = await ctx.ui.input("직접 입력", "", { signal: ac.signal });
        if (ac.signal.aborted) return null;
        return { answers, other: String(text ?? ""), by: "mac" };
      };
      let result: Answer;
      try {
        const phone = new Promise<Answer>((resolve) => waiting.set(id, resolve));
        // 맥: 질문을 차례로. 하나라도 닫으면 전체를 닫은 것으로. 폰이 먼저 답하면 창을 닫고 폰 답을 기다림
        const mac = (async (): Promise<Answer | null> => {
          if (!many) {
            const a = await askBox(qs[0]);
            return a === "back" ? null : a;
          }
          const items: { answers: string[]; other: string }[] = [];
          for (let i = 0; i < qs.length; ) {
            const a = await askBox(qs[i], `${i + 1}/${qs.length}`);
            if (!a) return null;
            if (a === "back") {
              i = Math.max(0, i - 1);
              continue;
            }
            if (a.by === "cancel") return { answers: [], other: "", by: "cancel" };
            items[i] = { answers: a.answers, other: a.other };
            i++;
          }
          return { answers: [], other: "", by: "mac", items };
        })()
          .catch(() => null)
          .then((r) => r ?? new Promise<Answer>(() => {}));
        const stopped = new Promise<Answer>((resolve) => {
          const s = signal ?? ctx.signal;
          if (s?.aborted) resolve({ answers: [], other: "", by: "aborted" });
          s?.addEventListener("abort", () => resolve({ answers: [], other: "", by: "aborted" }), { once: true });
        });
        result = await Promise.race([phone, mac, stopped]);
      } finally {
        waiting.delete(id);
        ac.abort();   // 폰이 먼저 답했으면 맥 창 닫기
        pi.events.emit("pi-remote:question-done", { id });
      }

      const partsOf = (a: { answers: string[]; other: string }) => {
        const parts: string[] = [];
        if (a.answers.length) parts.push(`사용자가 고른 답: ${a.answers.join(", ")}`);
        if (a.other.trim()) parts.push(`사용자가 직접 쓴 답: ${a.other.trim()}`);
        return parts;
      };
      const closed = "사용자가 답하지 않고 질문을 닫았다. 답을 추측하지 말고 이번 차례를 끝낸 뒤 사용자의 다음 메시지를 기다린다.";
      let text: string;
      let details: any;
      if (result.by === "aborted") {
        text = "답을 기다리는 동안 작업이 중단됐다.";
        details = { answers: [], other: "", by: result.by };
      } else if (many) {
        const items = qs.map((q, i) => ({ question: q.question, answers: result.items?.[i]?.answers ?? [], other: result.items?.[i]?.other ?? "" }));
        const lines = items.map((it, i) => `${i + 1}. ${firstLine(it.question)} → ${partsOf(it).join(" / ") || "답하지 않음"}`);
        text = result.by === "cancel" || !items.some((it) => partsOf(it).length) ? closed : ["사용자가 질문들에 한 번에 답했다.", ...lines].join("\n");
        details = { items, by: result.by };
      } else {
        const parts = partsOf(result);
        text = result.by === "cancel" || !parts.length ? closed : parts.join("\n");
        details = { answers: result.answers, other: result.other, by: result.by };
      }
      return { content: [{ type: "text", text }], details };
    },
  });

  pi.on("before_agent_start", async (event: any) => {
    const g = event?.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(g) && !g.includes(GUIDE)) g.push(GUIDE);
  });
}
