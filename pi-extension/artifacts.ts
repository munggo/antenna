/**
 * 아티팩트(Claude 앱 방식): 모델이 사용자에게 보여 줄 결과물 파일을 직접 등록한다.
 *
 * - show_artifact 도구: 파일 경로·한국어 제목을 등록(등록 기록은 대화 기록의 도구 결과에 남음)
 * - 맥: /artifacts 로 이 대화의 아티팩트 목록 → 고르면 맥 기본 앱으로 열기, 하단 줄 📎 N(claude-statusline 이 표시)
 * - 폰(pi-remote): 피드 확장이 같은 기록으로 카드·목록을 만들고, 등록된 파일만 내용을 보낸다
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { tr } from "./lib/lang.mjs";   // 폰에 보이는 글의 언어(PI_REMOTE_LANG)

const GUIDE =
  "When you create a deliverable the user will want to look at (an HTML page, report or document, slide deck, spreadsheet, PDF, " +
  "image, diagram or similar), call show_artifact with its file path and a short Korean title so it appears as an artifact card " +
  "on the user's phone and in /artifacts on the Mac. Call it again after you change the file. Do not call it for ordinary source " +
  "code edits or temporary files. Mention the file path in your reply.";

/** 확장자 → 종류(폰 카드 이름표·보기 방식) */
export function kindOf(path: string): string {
  const e = extname(path).toLowerCase().slice(1);
  if (["html", "htm", "svg"].includes(e)) return "web";
  if (["md", "markdown"].includes(e)) return "markdown";
  if (e === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tiff"].includes(e)) return "image";
  if (["docx", "doc", "pages", "rtf"].includes(e)) return "document";
  if (["xlsx", "xls", "csv", "numbers", "tsv"].includes(e)) return "spreadsheet";
  if (["pptx", "ppt", "key"].includes(e)) return "slides";
  if (["txt", "log", "json", "yaml", "yml"].includes(e)) return "text";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(e)) return "video";
  if (["mp3", "m4a", "wav", "aac", "aiff", "flac", "ogg"].includes(e)) return "audio";
  return "file";
}

export const absPath = (cwd: string, p: string) => resolve(cwd || process.cwd(), String(p ?? "").replace(/^@/, "").replace(/^~(?=\/|$)/, homedir()));

export type Artifact = { path: string; title: string; kind: string; size: number; description?: string; at?: number; toolCallId?: string };

/** 대화 갈래에서 등록된 아티팩트(같은 파일은 마지막 등록만, 등록 순서) */
export function artifactsIn(branch: any[]): Artifact[] {
  const byPath = new Map<string, Artifact>();
  for (const e of branch ?? []) {
    const m = e?.type === "message" ? e.message : null;
    if (m?.role !== "toolResult" || m.toolName !== "show_artifact" || m.isError) continue;
    const d = m.details;
    if (!d?.path) continue;
    byPath.delete(d.path);
    byPath.set(d.path, { path: d.path, title: d.title, kind: d.kind, size: d.size, description: d.description, at: m.timestamp, toolCallId: m.toolCallId });
  }
  return [...byPath.values()];
}

export default function (pi: ExtensionAPI) {
  let lastCount = -1;
  const announce = (ctx: any) => {
    try {
      const n = artifactsIn(ctx.sessionManager?.getBranch?.() ?? []).length;
      if (n !== lastCount) {
        lastCount = n;
        pi.events.emit("artifacts:count", { count: n });
      }
    } catch {
      /* 기록을 못 읽으면 표시만 생략 */
    }
  };

  pi.registerTool({
    name: "show_artifact",
    label: "아티팩트 보여 주기",
    description:
      "Register a finished file (HTML page, document, report, slides, spreadsheet, PDF, image, diagram) as an artifact the user " +
      "can open from an artifact card on the phone or with /artifacts on the Mac.",
    parameters: Type.Object({
      path: Type.String({ description: "Path of the file to show (absolute or relative to the working directory)" }),
      title: Type.String({ description: "Short Korean title shown on the artifact card" }),
      description: Type.Optional(Type.String({ description: "Optional one-line Korean description" })),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const path = absPath(ctx?.cwd, params.path);
      let size = 0;
      try {
        const st = statSync(path);
        if (!st.isFile()) throw new Error("파일이 아님");
        size = st.size;
      } catch {
        throw new Error(`아티팩트로 등록할 파일이 없다: ${path}`);
      }
      const title = String(params.title ?? "").trim() || basename(path);
      const kind = kindOf(path);
      const description = String(params.description ?? "").trim() || undefined;
      return {
        content: [{ type: "text", text: `아티팩트로 등록했다: ${title} (${path})` }],
        details: { path, title, kind, size, description },
      };
    },
  });

  // 맥: 이 대화의 아티팩트 목록 → 고르면 기본 앱으로 열기
  pi.registerCommand("artifacts", {
    description: tr("이 대화의 아티팩트 목록(고르면 맥에서 열기)", "Artifacts in this conversation (pick one to open it on the Mac)"),
    handler: async (_args: string, ctx: any) => {
      const list = artifactsIn(ctx.sessionManager?.getBranch?.() ?? []).reverse();   // 최근 것 먼저
      if (!list.length) {
        ctx.ui.notify("이 대화에는 아티팩트가 없어요", "info");
        return;
      }
      const labels = list.map((a, i) => `${i + 1}. ${a.title} — ${a.path}`);
      const choice = await ctx.ui.select(`아티팩트 ${list.length}개 (고르면 맥에서 열어요)`, labels);
      const i = labels.indexOf(choice);
      if (i < 0) return;
      execFile("open", [list[i].path], (err) => {
        if (err) ctx.ui.notify(`열지 못했어요: ${list[i].path}`, "error");
      });
    },
  });

  pi.on("session_start", async (_e: any, ctx: any) => {
    lastCount = -1;
    announce(ctx);
  });
  pi.on("session_tree", async (_e: any, ctx: any) => announce(ctx));
  pi.on("tool_execution_end", async (e: any, ctx: any) => {
    if (e?.toolName === "show_artifact") announce(ctx);
  });
  pi.on("turn_end", async (_e: any, ctx: any) => announce(ctx));   // 도구 결과가 기록에 들어간 뒤 한 번 더
  pi.on("before_agent_start", async (event: any) => {
    const g = event?.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(g) && !g.includes(GUIDE)) g.push(GUIDE);
  });
}
