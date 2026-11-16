/**
 * 계획 모드(Claude Code 처럼): 읽기만 하며 조사하고 계획을 세운 뒤, 승인받으면 실행
 *
 * - 켜기·끄기: /plan [on|off], Ctrl+Alt+P, 폰 입력창 '계획' 칩(피드가 /plan on|off 로 보냄)
 * - 켜져 있으면: edit·write 막음, bash 는 읽기 명령만, 하위 에이전트는 조사·계획·검토 역할만
 * - 계획('계획:' 아래 번호 목록)이 나오면 '계획대로 진행할까요?'(진행 / 계획 고치기 / 그만두기).
 *   이 창은 피드의 확인 창 중계로 폰 카드에도 뜨고, 폰 알림도 보냄. 진행하면 계획 모드를 끄고 할 일 목록으로 실행
 * - 상태는 대화 기록(custom 항목)에 남아 다시 열어도 그대로. 피드에는 plan-mode:changed 로 알림
 * pi 예제(examples/extensions/plan-mode)를 바탕으로 함
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isReadOnlyCommand } from "./lib/readonly.ts";

export { isReadOnlyCommand };

/** 답에서 계획('계획:' 아래 번호 목록) 단계들 */
export function extractPlan(text: string): string[] {
  const t = String(text ?? "");
  const at = t.search(/(^|\n)\s*(#+\s*)?(\*\*)?계획(\*\*)?\s*[:：]?\s*(\*\*)?\s*\n/);
  if (at < 0) return [];
  const steps: string[] = [];
  for (const line of t.slice(at).split("\n").slice(1)) {
    const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (m) steps.push(m[2].replace(/\*\*/g, "").trim());
    else if (steps.length && line.trim() && !/^\s{2,}|^\s*[-*]/.test(line)) break;   // 목록이 끝남
  }
  return steps;
}

const GUIDE =
  "PLAN MODE IS ON. Only investigate: read files and run read-only commands; do not modify, create or delete anything, and do " +
  "not ask for approval to modify. When you are ready, write the plan in Korean as a numbered list under a line '계획:' " +
  "(concise steps, each one line). Do not ask whether to proceed; the system will ask the user.";

export default function (pi: ExtensionAPI) {
  let on = false;
  const announce = (ctx: any) => {
    pi.events.emit("plan-mode:changed", { on });
    try {
      if (ctx?.hasUI) ctx.ui.setWidget("plan-mode", on ? [" 📝 계획 모드 — 읽기만 하며 계획을 세워요(/plan off 로 끄기)"] : undefined);
    } catch {
      /* 화면 없음 */
    }
  };
  const set = (next: boolean, ctx: any) => {
    if (on === next) return announce(ctx);
    on = next;
    pi.appendEntry("plan-mode", { on });
    announce(ctx);
  };

  // 바깥(권한 모드 /mode·폰 모드 칩)에서 켜고 끄기
  let lastCtx: any = null;
  pi.events.on("plan-mode:set", (e: any) => set(!!e?.on, lastCtx));
  pi.on("session_start", async (_e: any, ctx: any) => {
    lastCtx = ctx;
  });
  pi.on("agent_start", async (_e: any, ctx: any) => {
    lastCtx = ctx ?? lastCtx;
  });

  pi.registerCommand("plan", {
    description: "계획 모드 켜기·끄기(읽기만 하며 계획을 세우고, 승인받으면 실행)",
    handler: async (args: string, ctx: any) => {
      const a = String(args ?? "").trim();
      set(a === "on" ? true : a === "off" ? false : !on, ctx);
      ctx.ui.notify(on ? "계획 모드를 켰어요. 읽기만 하며 계획을 세워요" : "계획 모드를 껐어요", "info");
    },
  });
  try {
    pi.registerShortcut("ctrl+alt+p" as any, { description: "계획 모드 켜기·끄기", handler: async (ctx: any) => set(!on, ctx) } as any);
  } catch {
    /* 단축키를 못 쓰면 /plan 으로 */
  }

  // 막기: 수정·작성, 읽기 전용이 아닌 명령, 고칠 수 있는 하위 에이전트
  pi.on("tool_call", async (event: any) => {
    if (!on) return undefined;
    const name = String(event.toolName);
    const why = (what: string) => ({ block: true, reason: `Blocked by plan mode: ${what}. Only investigate now and present the plan under '계획:'.` });
    if (name === "edit" || name === "write") return why("files cannot be changed");
    if (name === "bash" && !isReadOnlyCommand(String(event.input?.command ?? ""))) return why("only read-only commands are allowed");
    if (name === "subagent") {
      const ok = (a: any) => !a || ["scout", "planner", "reviewer"].includes(String(a));
      const inp = event.input ?? {};
      const agents = [inp.agent, ...(inp.tasks ?? []).map((t: any) => t?.agent), ...(inp.chain ?? []).map((t: any) => t?.agent)];
      if (!agents.every(ok)) return why("only scout, planner and reviewer subagents are allowed");
    }
    return undefined;
  });

  pi.on("before_agent_start", async (event: any) => {
    const g = event?.systemPromptOptions?.promptGuidelines;
    if (!Array.isArray(g)) return;
    const i = g.indexOf(GUIDE);
    if (on && i < 0) g.push(GUIDE);
    if (!on && i >= 0) g.splice(i, 1);
  });

  // 계획이 나오면 진행할지 묻기(맥 선택 창 = 폰 카드)
  pi.on("agent_settled", async (_e: any, ctx: any) => {
    if (!on || !ctx?.hasUI) return;
    let text = "";
    try {
      const branch = ctx.sessionManager?.getBranch?.() ?? [];
      for (let i = branch.length - 1; i >= 0; i--) {
        const m = branch[i]?.type === "message" ? branch[i].message : null;
        if (m?.role === "user") break;
        if (m?.role === "assistant") {
          text = (m.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
          if (text.trim()) break;
        }
      }
    } catch {
      return;
    }
    const steps = extractPlan(text);
    if (!steps.length) return;
    pi.events.emit("pi-remote:notify", { kind: "choice", title: "계획을 확인해 주세요", body: `${steps.length}단계 · ${steps[0]}` });
    const GO = "계획대로 진행";
    const EDIT = "계획 고치기";
    const STOP = "그만두기";
    const choice = await ctx.ui.select(`계획대로 진행할까요?\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`, [GO, EDIT, STOP]);
    if (choice === GO) {
      set(false, ctx);
      pi.sendUserMessage(
        `계획대로 진행해 줘. 먼저 todo_write 로 아래 단계를 할 일 목록으로 만들고 차례로 해:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      );
    } else if (choice === EDIT) {
      const note = await ctx.ui.input("어떻게 고칠까요?", "");
      if (note?.trim()) pi.sendUserMessage(`계획을 이렇게 고쳐 줘: ${note.trim()}`);
    } else if (choice === STOP) {
      set(false, ctx);
      ctx.ui.notify("계획 모드를 껐어요", "info");
    }
  });

  // 다시 열면 기록의 마지막 상태로
  pi.on("session_start", async (_e: any, ctx: any) => {
    on = false;
    try {
      const branch = ctx.sessionManager?.getBranch?.() ?? [];
      for (let i = branch.length - 1; i >= 0; i--) {
        const e = branch[i];
        if (e?.type === "custom" && e.customType === "plan-mode") {
          on = !!e.data?.on;
          break;
        }
      }
    } catch {
      /* 기록을 못 읽으면 꺼짐 */
    }
    announce(ctx);
  });
}
