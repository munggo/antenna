/**
 * 백그라운드 탭(사용자 결정 11-12): 오래 걸리는 일을 새 tmux 탭의 pi 에 맡기고, 끝나면 폰 알림 + 이 탭에 결과 요약
 * - /bgtab <할 일>: 사람이 시킴 → 결과는 이 대화에 남기만 함(AI 가 이어서 답하지 않음)
 * - background_task 도구: AI 가 시킴 → 결과가 오면 AI 가 이어서 처리
 * - 탭 열기는 Claude Code 연결부와 같이 쓰는 ~/.claude/pi-remote/bg-launch.mjs(claude-remote/install.sh 가 설치)
 * - 결과 받기는 pi-remote-feed 의 bg-result 명령(새 탭의 연결부가 끝났을 때 보냄)
 * 작성: 서문교
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { tr } from "./lib/lang.mjs";   // 폰에 보이는 글의 언어(PI_REMOTE_LANG)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// 탭을 여는 실행기: Claude Code 쪽 설치본이 있으면 그것(같은 파일), 없으면(pi 만 쓰는 맥) 이 확장과 함께 깔린 것(lib/)
const CC_LAUNCHER = `${homedir()}/.claude/pi-remote/bg-launch.mjs`;
const LAUNCHER = process.env.PI_BG_LAUNCH || (existsSync(CC_LAUNCHER) ? CC_LAUNCHER : fileURLToPath(new URL("./lib/bg-launch.mjs", import.meta.url)));

async function launch(task: string, cwd: string, by: "user" | "ai"): Promise<{ window: number; name: string }> {
  const pane = process.env.TMUX_PANE;
  if (!pane) throw new Error("tmux 안에서 켠 pi 에서만 쓸 수 있어요");
  let mod: any;
  try {
    mod = await import(LAUNCHER);
  } catch {
    throw new Error("백그라운드 탭 도구가 설치되지 않았어요(antenna 의 pi-extension/install.sh)");
  }
  return mod.launchBackground({ agent: "pi", cwd, task, originPane: pane, by });
}

/** 이 탭이 AI 가 시킨 백그라운드 탭인지(거기서 또 AI 가 백그라운드를 만들지 않게) */
function startedByAi(): boolean {
  try {
    const v = execFileSync("tmux", ["show-options", "-w", "-v", "-t", process.env.TMUX_PANE ?? "", "@bg_by"], {
      encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return v === "ai";
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("bgtab", {
    description: tr("새 탭에서 백그라운드로 실행(끝나면 폰 알림, 이 탭에 결과 요약): /bgtab <할 일>", "Run in the background in a new tab (phone notification when done, summary in this tab): /bgtab <task>"),
    handler: async (args: string, ctx: any) => {
      try {
        const r = await launch(String(args ?? ""), ctx.cwd ?? process.cwd(), "user");
        ctx.ui.notify(tr(`백그라운드 탭 ${r.window}(${r.name})에서 시작했어요. 끝나면 결과를 여기로 알려 드려요`, `Started in background tab ${r.window} (${r.name}). The result comes back here when it's done`), "info");
      } catch (e: any) {
        ctx.ui.notify(String(e?.message ?? e), "error");
      }
    },
  });

  pi.registerTool({
    name: "background_task",
    label: "백그라운드 탭",
    description:
      "Run a long, independent task in a new tmux tab with its own pi session (same folder), without blocking this session. " +
      "Use it only for work that takes many minutes and does not need this conversation's context beyond what you write in `task`. " +
      "The result summary arrives later as a message and you will continue then. Write `task` as a complete, self-contained instruction.",
    parameters: Type.Object({
      task: Type.String({ description: "Complete, self-contained instruction for the background pi (it cannot see this conversation)" }),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      if (startedByAi()) {
        return { content: [{ type: "text", text: "refused: this tab is already a background task started by AI. Do the work here instead." }], details: {} };
      }
      try {
        const r = await launch(String(params?.task ?? ""), ctx?.cwd ?? process.cwd(), "ai");
        return {
          content: [{ type: "text", text: `started in tmux tab ${r.window} (${r.name}). The result summary will arrive later as a message; do not wait or poll for it.` }],
          details: { window: r.window, name: r.name },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `failed: ${String(e?.message ?? e)}` }], details: {} };
      }
    },
  });
}
