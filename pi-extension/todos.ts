/**
 * 할 일 목록(Claude Code 의 할 일 도구처럼)
 *
 * - todo_write: 목록 전체를 상태(pending 할 일 · in_progress 하는 중 · completed 끝)와 함께 한 번에 바꿈.
 *   상태는 도구 결과에 남아서 되감기·갈래를 나눠도 그 시점의 목록이 맞음
 * - 맥: 입력창 위에 한 줄로 접혀 있음(▸ 할 일 2/5 · 지금 하는 일). 클릭하거나 /todos 로 펼치면 목록
 *   (✅ 끝 · ⏳ 하는 중 · ⬜ 할 일). 모두 끝나고 차례가 끝나면 사라짐. 목록이 없을 때 /todos 는 마지막 목록 보기
 * - 폰(pi-remote): 피드 확장이 같은 기록으로 입력창 위 접히는 칸을 만든다
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const GUIDE =
  "For work with three or more distinct steps, call todo_write first with the steps (short Korean phrases), keep exactly one " +
  "item in_progress, mark each item completed as soon as it is done, and rewrite the list when the plan changes. Do not use it " +
  "for trivial single-step requests.";

export type Todo = { content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string };
const STATUSES = ["pending", "in_progress", "completed"] as const;

/** 대화 갈래에서 마지막 할 일 목록 */
export function latestTodos(branch: any[]): Todo[] {
  for (let i = (branch?.length ?? 0) - 1; i >= 0; i--) {
    const m = branch[i]?.type === "message" ? branch[i].message : null;
    if (m?.role === "toolResult" && m.toolName === "todo_write" && !m.isError && Array.isArray(m.details?.todos)) return m.details.todos;
  }
  return [];
}

export const countDone = (todos: Todo[]) => todos.filter((t) => t.status === "completed").length;
const MARK: Record<string, string> = { completed: "✅", in_progress: "⏳", pending: "⬜" };

/** 입력창 위 목록 줄(길면 하는 중 둘레만 보이고 나머지는 개수) */
export function widgetLines(todos: Todo[], max = 8): string[] {
  if (!todos.length) return [];
  const head = ` 할 일 ${countDone(todos)}/${todos.length}`;
  const row = (t: Todo) => ` ${MARK[t.status] ?? "⬜"} ${t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}`;
  if (todos.length <= max) return [head, ...todos.map(row)];
  const cur = Math.max(0, todos.findIndex((t) => t.status !== "completed"));
  const start = Math.min(Math.max(0, cur - 2), todos.length - (max - 1));
  const shown = todos.slice(start, start + max - 1).map(row);
  const before = start;
  const after = todos.length - start - (max - 1);
  return [head, ...(before ? [`   … 끝난 ${before}개`] : []), ...shown, ...(after > 0 ? [`   … 남은 ${after}개`] : [])];
}

/** 접힌 한 줄: 진행 수와 지금 하는 일(없으면 다음 할 일) */
export function collapsedLine(todos: Todo[]): string {
  const doing = todos.find((t) => t.status === "in_progress");
  const next = todos.find((t) => t.status === "pending");
  const now = doing ? doing.activeForm || doing.content : next ? `다음: ${next.content}` : "모두 끝남";
  return ` ▸ 할 일 ${countDone(todos)}/${todos.length} · ${now}`;
}

/** 입력창 위에 보일 줄: 접혔으면 한 줄, 펼쳤으면 목록. hint 는 안내 글(흐린 글씨로 바꿔 넘김) */
export function todoWidget(todos: Todo[], collapsed: boolean, hint = (s: string) => s): string[] {
  if (!todos.length) return [];
  if (collapsed) return [`${collapsedLine(todos)}  ${hint("클릭해 펼치기")}`];
  const [head, ...rest] = widgetLines(todos);
  return [` ▾${head}  ${hint("클릭해 접기")}`, ...rest];
}

export default function (pi: ExtensionAPI) {
  let current: Todo[] = [];
  let collapsed = true;   // 기본은 접힘(사용자 결정)
  const show = (ctx: any) => {
    try {
      if (!ctx?.hasUI) return;
      if (!current.length) return ctx.ui.setWidget("todos", undefined);
      // 칸을 클릭하면 펼치기·접기(pi 전체 화면 모드가 마우스를 부품에 넘겨 줌)
      ctx.ui.setWidget("todos", (_tui: any, theme: any) => ({
        render: (width: number) =>
          todoWidget(current, collapsed, (t) => theme?.fg?.("dim", t) ?? t).map((l) => truncateToWidth(l, width)),
        handleMouse: (e: any) => {
          if (e?.type !== "click" || e.button !== "left") return undefined;
          collapsed = !collapsed;
          return { handled: true, render: true };
        },
        invalidate: () => {},
      }));
    } catch {
      /* 화면 없음 */
    }
  };
  /** 펼치기·접기(목록이 없으면 false) */
  const toggle = (ctx: any) => {
    if (!current.length) return false;
    collapsed = !collapsed;
    show(ctx);
    return true;
  };
  const reload = (ctx: any) => {
    try {
      current = latestTodos(ctx.sessionManager?.getBranch?.() ?? []);
    } catch {
      current = [];
    }
    // 이미 다 끝난 목록은 다시 띄우지 않음
    if (current.length && countDone(current) === current.length) current = [];
    show(ctx);
  };

  pi.registerTool({
    name: "todo_write",
    label: "할 일 목록",
    description:
      "Create or update the task list for multi-step work. Always send the whole list. Status: pending, in_progress (exactly one), " +
      "completed. The list is shown to the user on the Mac and the phone.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ description: "The step in Korean (short, imperative or noun phrase)" }),
          status: Type.Union(STATUSES.map((s) => Type.Literal(s))),
          activeForm: Type.Optional(Type.String({ description: "Korean progressive form shown while in progress, e.g. '시험 돌리는 중'" })),
        }),
        { maxItems: 30 },
      ),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const todos: Todo[] = (Array.isArray(params.todos) ? params.todos : [])
        .map((t: any) => ({
          content: String(t?.content ?? "").trim(),
          status: STATUSES.includes(t?.status) ? t.status : "pending",
          ...(t?.activeForm ? { activeForm: String(t.activeForm).trim() } : {}),
        }))
        .filter((t: Todo) => t.content);
      current = todos;
      show(ctx);
      const doing = todos.find((t) => t.status === "in_progress");
      const text = todos.length
        ? `할 일 목록을 바꿨다: 끝 ${countDone(todos)} · 하는 중 ${todos.filter((t) => t.status === "in_progress").length} · 남음 ${todos.filter((t) => t.status === "pending").length}` +
          (doing ? ` (지금: ${doing.content})` : "")
        : "할 일 목록을 비웠다.";
      return { content: [{ type: "text", text }], details: { todos } };
    },
  });

  pi.registerCommand("todos", {
    description: "할 일 목록 펼치기·접기(목록이 없으면 마지막 목록 보기)",
    handler: async (_args: string, ctx: any) => {
      if (toggle(ctx)) return;
      const todos = latestTodos(ctx.sessionManager?.getBranch?.() ?? []);
      if (!todos.length) return ctx.ui.notify("할 일 목록이 없어요", "info");
      ctx.ui.notify(widgetLines(todos, 40).join("\n"), "info");
    },
  });

  pi.on("session_start", async (_e: any, ctx: any) => reload(ctx));
  pi.on("session_tree", async (_e: any, ctx: any) => reload(ctx));
  // 다 끝난 목록은 차례가 끝나면 접음
  pi.on("agent_settled", async (_e: any, ctx: any) => {
    if (current.length && countDone(current) === current.length) {
      current = [];
      show(ctx);
    }
  });
  pi.on("before_agent_start", async (event: any) => {
    const g = event?.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(g) && !g.includes(GUIDE)) g.push(GUIDE);
  });
}
