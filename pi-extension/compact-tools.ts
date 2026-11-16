/**
 * 도구 실행을 한 줄로 접어 보이기(맥 터미널 화면)
 *
 * 폰(pi-remote) 단계 줄처럼, 명령·읽기·수정 같은 도구 실행을 기본으로 접고 무엇을 했는지 이모지 + 한 줄만 보인다.
 *   ✓  확장 설치본 갱신 · 1.2초        (실행)
 *   📝 InputBar.swift +3 −1            (수정)
 *   ✗  시험 실행 · 종료 코드 1          (실패)
 * Ctrl+O(도구 출력 펼치기)를 누르면 원래 모양(명령 전체·출력·diff)으로 펼친다.
 * 숨긴 생각은 줄을 그리지 않고, 생각하는 동안만 아래 작업 표시를 '🤔 생각 중…'으로 바꾼다.
 * 도구 실행은 그대로 두고 그리는 방식만 바꾼다(registerToolRenderer).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Box, Container, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const KEY = "__compactTools"; // 행 상태에서 다른 렌더러와 겹치지 않는 칸

const cut = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);
const fileName = (p: unknown) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";
const firstLine = (s: unknown) => String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
const textOf = (result: any) =>
  (result?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => String(c.text ?? "")).join("\n");

/** 무엇을 하는지 한 줄(폰 단계 줄과 같은 규칙: bash 는 첫 줄 한국어 주석) */
export function subjectOf(name: string, args: any): string {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "bash": {
      const lines = String(a.command ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const comment = lines.find((l) => l.startsWith("#") && !l.startsWith("#!"));
      return cut(comment ? comment.replace(/^#+\s*/, "") : lines[0] ?? "");
    }
    case "read":
    case "edit":
    case "write":
      return fileName(a.path);
    case "grep":
    case "find":
      return cut(String(a.pattern ?? a.path ?? ""));
    case "ls":
      return fileName(a.path) || ".";
    case "codemode": {
      const c = String(a.code ?? "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("//") && !l.includes("@options"));
      return cut(c ? c.replace(/^\/\/+\s*/, "") : "스크립트");
    }
    case "subagent": {
      const n = Array.isArray(a.tasks) ? a.tasks.length : Array.isArray(a.chain) ? a.chain.length : 1;
      return `하위 에이전트 ${n}개`;
    }
    case "show_artifact":
      return cut(firstLine(a.title ?? a.path));
    case "todo_write": {
      const t = Array.isArray(a.todos) ? a.todos : [];
      const doing = t.find((x: any) => x?.status === "in_progress");
      return cut(`할 일 ${t.filter((x: any) => x?.status === "completed").length}/${t.length}${doing ? ` · 지금: ${firstLine(doing.content)}` : ""}`);
    }
    case "ask_user": {
      const qs = Array.isArray(a.questions) ? a.questions : [];
      const first = firstLine(qs[0]?.question ?? a.question);
      return cut(qs.length > 1 ? `${first} 외 ${qs.length - 1}개` : first);
    }
    case "request_approval":
      return cut(firstLine(a.action));
    case "web_search":
      return cut(firstLine(a.query));
    case "web_fetch": {
      const u = String(a.url ?? "").replace(/^https?:\/\//, "");
      return cut(u.length > 60 ? `${u.slice(0, 60)}…` : u);
    }
    default: {
      // MCP 도구: mcp__<서버>__<도구>
      if (name.startsWith("mcp__")) {
        const rest = name.slice(5);
        const i = rest.indexOf("__");
        return i > 0 ? `${rest.slice(0, i)} ${rest.slice(i + 2)}` : rest;
      }
      return name;
    }
  }
}

const VERBS: Record<string, [string, string]> = {
  // [끝남, 진행 중]
  bash: ["실행됨", "실행 중"],
  read: ["읽음", "읽는 중"],
  edit: ["수정됨", "수정 중"],
  write: ["작성됨", "작성 중"],
  grep: ["검색함", "검색 중"],
  find: ["찾음", "찾는 중"],
  ls: ["확인함", "확인 중"],
  codemode: ["실행됨", "실행 중"],
  subagent: ["맡김", "맡긴 일 진행 중"],
  ask_user: ["물어봄", "답을 기다리는 중"],
  request_approval: ["승인 요청함", "승인을 기다리는 중"],
  show_artifact: ["아티팩트", "아티팩트 준비 중"],
  todo_write: ["할 일 정리", "할 일 정리 중"],
  web_search: ["웹 검색함", "웹 검색 중"],
  web_fetch: ["웹 페이지 읽음", "웹 페이지 읽는 중"],
};
export const verbOf = (name: string, running: boolean) => (VERBS[name] ?? ["사용함", "사용 중"])[running ? 1 : 0];

// 끝난 도구의 이모지(실행 계열은 ✓). tmux 에서 칸이 어긋나지 않게 기본이 이모지인 문자만 쓴다(✏️ 같은 변형 문자 X)
const ICONS: Record<string, string> = {
  bash: "✓",
  codemode: "✓",
  read: "📖",
  edit: "📝",
  write: "📄",
  grep: "🔍",
  find: "🔍",
  ls: "📂",
  subagent: "👥",
  ask_user: "❓",
  request_approval: "🔐",
  show_artifact: "📎",
  todo_write: "📋",
  web_search: "🔎",
  web_fetch: "🌐",
};
export const iconOf = (name: string) => ICONS[name] ?? "🔧";

/** 수정 도구 결과의 diff 에서 늘어난·줄어든 줄 수 */
export function diffStats(details: any): { added: number; removed: number } | null {
  const d = details?.diff;
  if (typeof d !== "string") return null;
  let added = 0;
  let removed = 0;
  for (const l of d.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  return { added, removed };
}

/** 실패한 도구의 한 줄 이유 */
export function errorSummary(name: string, result: any): string {
  const text = textOf(result);
  const code = /exited with code (\d+)/i.exec(text) ?? /exit code:? (\d+)/i.exec(text);
  if (name === "bash" && code) return `종료 코드 ${code[1]}`;
  return cut(firstLine(text), 60) || "오류";
}

/** 고르는 질문(ask_user)의 답 */
function askAnswer(d: any): string {
  if (Array.isArray(d?.items)) return d.items.map((it: any) => askAnswer({ ...it, by: d.by })).join(" / ");   // 여러 질문
  const parts = [...(Array.isArray(d?.answers) ? d.answers : []), d?.other].map((x) => String(x ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : d?.by === "aborted" ? "멈춤" : "답하지 않음";
}

const num = (n: number) => n.toLocaleString("en-US");
const lineCount = (text: string) => (text.trim() ? text.replace(/\n+$/, "").split("\n").length : 0);

/** 파일이 줄바꿈으로 끝나는지(마지막 1바이트만 읽음). pi 는 끝 줄바꿈 뒤의 빈 줄까지 전체 줄 수에 넣는다 */
export function endsWithNewline(cwd: string, p: unknown): boolean {
  try {
    const file = resolve(cwd || process.cwd(), String(p ?? "").replace(/^@/, "").replace(/^~(?=\/|$)/, homedir()));
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (!size) return false;
      const b = Buffer.alloc(1);
      readSync(fd, b, 0, 1, size - 1);
      return b[0] === 0x0a;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** 읽은 줄: '120줄', 일부만이면 '300–420줄(전체 1,250)', 사진이면 '사진'. trailingNL: 파일이 줄바꿈으로 끝나면 전체에서 1 뺌 */
export function readInfo(args: any, result: any, trailingNL = false): string {
  if ((result?.content ?? []).some((c: any) => c?.type === "image")) return "사진";
  let text = textOf(result);
  const shown = /\[Showing lines (\d+)-(\d+) of (\d+)/.exec(text); // pi 가 길어서 잘랐을 때
  if (shown) return `${num(+shown[1])}–${num(+shown[2])}줄(전체 ${num(+shown[3] - (trailingNL ? 1 : 0))})`;
  const more = /\[(\d+) more lines in file/.exec(text); // limit 으로 일부만 읽었을 때
  text = text.replace(/\n*\[\d+ more lines in file[^\]]*\]\s*$/, "");
  const n = lineCount(text);
  if (n === 0) return "빈 파일";
  const start = Number(args?.offset) > 0 ? Number(args.offset) : 1;
  const end = start + n - 1;
  if (more) return `${num(start)}–${num(end)}줄(전체 ${num(end + Number(more[1]) - (trailingNL ? 1 : 0))})`;
  if (start > 1 || args?.limit) return `${num(start)}–${num(end)}줄`;
  return `${num(n)}줄`;
}

/** 명령 출력 줄 수(pi 가 덧붙인 안내·종료 코드 줄 제외, 잘렸으면 전체 줄 수) */
export function outputLines(result: any): number {
  const t = result?.details?.truncation;
  if (t?.truncated && typeof t.totalLines === "number") return t.totalLines;
  const text = textOf(result)
    .replace(/\n*Command exited with code \d+[^\n]*$/, "")
    .replace(/\n*\[Showing [^\]]*\]\s*$/, "");
  return text.trim() === "(no output)" ? 0 : lineCount(text);
}

/** 검색·목록 결과 수(안내 줄 제외) */
const resultCount = (result: any) =>
  textOf(result).split("\n").filter((l: string) => l.trim() && !/^\[|^No (?:matches|files)/.test(l.trim())).length;

export function duration(ms: number | undefined): string {
  if (!ms || ms < 1000) return "";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}초`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  return `${Math.floor(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초`;
}

type RowState = {
  args?: any;
  trailingNL?: boolean; // 일부만 읽은 파일이 줄바꿈으로 끝나는지(전체 줄 수 보정)
  result?: any;
  isPartial?: boolean;
  isError?: boolean;
  durationMs?: number;
  baseCall?: any;
  baseResult?: any;
  holder?: Container;
  cwd?: string;         // 사진 전체 경로를 만들 때 쓰는 작업 폴더
};

/** 읽은 파일의 전체 경로(맥 터미널에서 눌러 바로 열 수 있게) */
export function fullPath(cwd: string | undefined, p: unknown): string {
  const raw = String(p ?? "").replace(/^@/, "").replace(/^~(?=\/|$)/, homedir());
  return raw ? resolve(cwd || process.cwd(), raw) : "";
}
/** 맥에서 바로 열어 볼 수 있는 파일(전체 경로로 보임) */
export const VIEWABLE = /\.(md|markdown|txt|log|html?|svg|pdf|csv|tsv|json|ya?ml|png|jpe?g|gif|webp|heic|bmp|tiff?|docx?|xlsx?|pptx?|key|pages|numbers|rtf)$/i;
const isImageResult = (result: any) => (result?.content ?? []).some((c: any) => c?.type === "image");

/** 접힌 상태의 한 줄(그릴 때 최신 상태로 만든다: 결과 칸이 머리줄보다 나중에 채워지므로) */
export function summaryLine(name: string, st: RowState, theme: any, pad: number): string {
  const running = !st.result || st.isPartial !== false;
  const raw = running ? "⏳" : st.isError ? "✗" : iconOf(name);
  const icon = raw === "✓" ? theme.fg("success", raw) : raw === "✗" ? theme.fg("error", raw) : raw;
  // 한 칸짜리 기호(✓ ✗)는 빈칸을 하나 더 둬서 두 칸짜리 이모지와 글자 시작을 맞춘다
  const gap = visibleWidth(raw) === 1 ? "  " : " ";
  // 바로 열어 볼 수 있는 파일(사진·md·txt·html·pdf·표·문서 등)은 이름 대신 전체 경로(눌러서 바로 확인). 코드 파일은 이름만
  const fileTool = name === "read" || name === "write" || name === "edit";
  const openable = fileTool && (VIEWABLE.test(String(st.args?.path ?? "")) || (name === "read" && !running && isImageResult(st.result)));
  const subject = openable ? fullPath(st.cwd, st.args?.path) || subjectOf(name, st.args) : subjectOf(name, st.args);
  let line = `${" ".repeat(pad)}${icon}${gap}${theme.fg("muted", subject)}`;
  // 아티팩트: 제목 뒤에 전체 경로(눌러서 바로 열기)
  if (name === "show_artifact" && !running && !st.isError) {
    const p = st.result?.details?.path || fullPath(st.cwd, st.args?.path);
    if (p) line += theme.fg("muted", ` · ${p}`);
  }
  if (name === "ask_user" && !running && !st.isError) line += theme.fg("muted", ` → ${cut(askAnswer(st.result?.details), 60)}`);
  // 줄 끝 숫자들(' · '로 이어 붙임): 읽은 줄, 바뀐 줄, 작성한 줄, 출력 줄, 검색 수, 실패 이유, 걸린 시간
  const extras: string[] = [];
  if (name === "write" && typeof st.args?.content === "string") extras.push(theme.fg("dim", `${num(lineCount(st.args.content))}줄`));
  if (!running) {
    if (name === "read" && !st.isError) extras.push(theme.fg("dim", readInfo(st.args, st.result, st.trailingNL)));
    if (name === "edit" && !st.isError) {
      const s = diffStats(st.result?.details);
      if (s) extras.push(`${theme.fg("success", `+${s.added}`)} ${theme.fg("error", `−${s.removed}`)}`);
    }
    if (name === "bash") {
      const n = outputLines(st.result);
      if (n > 0) extras.push(theme.fg("dim", `출력 ${num(n)}줄`));
    }
    if (!st.isError && (name === "grep" || name === "find" || name === "ls")) {
      extras.push(theme.fg("dim", `${num(resultCount(st.result))}${name === "grep" ? "곳" : "개"}`));
    }
    if (st.isError) extras.push(theme.fg("error", errorSummary(name, st.result)));
    const d = duration(st.durationMs);
    if (d) extras.push(theme.fg("dim", d));
  }
  for (const x of extras) line += `${theme.fg("dim", " · ")}${x}`;
  return line;
}

const bgOf = (theme: any, ctx: any) => (text: string) =>
  theme.bg(ctx.isPartial ? "toolPendingBg" : ctx.isError ? "toolErrorBg" : "toolSuccessBg", text);

export default function (pi: ExtensionAPI) {
  // 숨긴 생각은 줄을 그리지 않는다(빈 문구면 pi 가 그 자리를 비움). 생각 중인지는 아래 작업 표시로 본다
  pi.on("session_start", async (_e: any, ctx: any) => {
    ctx.ui?.setHiddenThinkingLabel?.("");
  });
  const working = (ctx: any, message?: string) => ctx.ui?.setWorkingMessage?.(message);
  pi.on("agent_start", async (_e: any, ctx: any) => working(ctx, "🤔 생각 중…"));
  pi.on("message_update", async (e: any, ctx: any) => {
    const t = e?.assistantMessageEvent?.type;
    if (t === "thinking_start") working(ctx, "🤔 생각 중…");
    else if (t === "text_start") working(ctx, "💬 답을 쓰는 중…");
  });
  pi.on("tool_execution_start", async (e: any, ctx: any) => {
    working(ctx, `⏳ ${verbOf(e.toolName, true)} ${subjectOf(e.toolName, e.args)}`);
  });
  pi.on("agent_settled", async (_e: any, ctx: any) => working(ctx)); // 원래 문구로

  pi.registerToolRenderer((toolName, next) => {
    const orig = next(); // 원래 그림(기본 도구·도구 자체의 렌더러). 없으면 pi 기본 방식처럼 그림
    const rowState = (ctx: any): RowState => (ctx.state[KEY] ??= {});

    return {
      renderShell: "self",

      renderCall(args: any, theme: any, ctx: any) {
        const st = rowState(ctx);
        st.args = args;
        st.cwd = ctx.cwd ?? st.cwd;
        st.isError = ctx.isError;
        st.durationMs = ctx.durationMs;
        if (!ctx.expanded) {
          return { render: (w: number) => [truncateToWidth(summaryLine(toolName, st, theme, ctx.outputPad ?? 1), w)], invalidate() {} };
        }
        // 펼침: 원래 머리줄 + 결과를 원래처럼 배경 상자 하나에
        let call: any;
        try {
          call = orig?.renderCall?.(args, theme, { ...ctx, lastComponent: st.baseCall });
        } catch {
          call = undefined;
        }
        call ??= new Text(`${theme.fg("toolTitle", theme.bold(toolName))}\n\n${JSON.stringify(args ?? {}, null, 2)}`, 0, 0);
        st.baseCall = call;
        st.holder = new Container();
        const box = new Box(ctx.outputPad ?? 1, 1, bgOf(theme, ctx));
        box.addChild(call);
        box.addChild(st.holder);
        return box;
      },

      renderResult(result: any, opts: any, theme: any, ctx: any) {
        const st = rowState(ctx);
        st.result = result;
        st.isPartial = opts.isPartial;
        st.cwd = ctx.cwd;
        // 일부만 읽었으면 전체 줄 수 보정을 위해 파일 끝을 한 번만 확인
        if (toolName === "read" && !opts.isPartial && st.trailingNL === undefined && /more lines in file|\[Showing lines/.test(textOf(result))) {
          st.trailingNL = endsWithNewline(ctx.cwd, ctx.args?.path ?? st.args?.path);
        }
        st.isError = ctx.isError;
        st.durationMs = ctx.durationMs;
        if (!opts.expanded) return new Container();
        let res: any;
        try {
          res = orig?.renderResult?.(result, opts, theme, { ...ctx, lastComponent: st.baseResult });
        } catch {
          res = undefined;
        }
        if (!res) {
          const out = textOf(result).trim();
          res = out ? new Text(out.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n"), 0, 0) : undefined;
        }
        st.baseResult = res;
        st.holder?.clear();
        if (res) st.holder?.addChild(res);
        return new Container(); // 결과는 머리줄 상자 안에 들어감
      },
    };
  });
}
