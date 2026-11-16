// pi-remote 대화 피드.
// 폰 앱이 대화를 채팅 화면으로 그릴 수 있게, 이 pi 의 대화 기록과 실시간 이벤트를
// 유닉스 소켓(~/.cache/pi-remote/feed/<tmux pane 번호>.sock)으로 제공한다.
// 맥 브리지가 이 소켓에 붙어 폰으로 그대로 전달한다. 맥 pi 화면·동작은 바꾸지 않는다.
//
// 소켓 프로토콜(줄 단위 JSON):
//   {t:"snapshot", messages, truncated, working}  접속 직후·압축/트리 이동 후 전체 대화
//   {t:"upsert", message}                          메시지 추가/갱신(어시스턴트는 스트리밍 중 반복)
//   {t:"tool", id, state}                          도구 실행 상태(running|done|error)
//   {t:"working", value}                           작업 중 여부
//   {t:"queue", items}                             작업 중에 받아 둔(끼워넣기 대기) 메시지 목록
//   {t:"commands", commands}                       확장·스킬·프롬프트 명령 목록(폰 명령 제안용)
//
// 메시지는 폰이 그리기 쉬운 모양으로 줄여서 보낸다(이미지 데이터·서명 등 제외, 긴 출력은 자름).
//
// 반대 방향(브리지 → 확장) 명령:
//   {cmd:"send", text, mode, images}  폰에서 보낸 메시지를 pi 에 넣는다.
//     mode: auto(자동, 기본) | steer(바로 반영) | followUp(끝나고 실행) | interrupt(멈추고 실행). 쉬는 중이면 모두 바로 실행.
//       auto: 모델이 생각·답을 쓰는 중이면 멈추고 바로 넣고, 명령 실행 중이면 그 명령이 끝나는 즉시 넣는다.
//     images: 폰이 미리 올려 둔 사진 경로(~/.cache/pi-remote/img-*) → 그림으로 함께 넣는다.

import { createConnection, createServer, type Server, type Socket } from "node:net";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { askChoice } from "./lib/choice-box.ts";

const MAX_MESSAGES = 400; // 처음 보낼 최대 메시지 수(가장 최근 것부터)
const MAX_TOOL_OUTPUT = 4000; // 도구 출력 최대 글자 수
const STREAM_INTERVAL_MS = 100; // 스트리밍 갱신 최소 간격

type Json = Record<string, unknown>;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n}자 생략)` : s;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text ?? "")
    .join("\n");
}

/** 도구 호출을 한 줄로 요약(폰 목록 표시용) */
function summarize(name: string, args: any): string {
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.pattern === "string") return args.pattern;
  try {
    return JSON.stringify(args).slice(0, 300);
  } catch {
    return name;
  }
}

/** 줄 단위로 비교해 늘어난·줄어든 줄 수(공통 줄 제외). 너무 크면 대략 */
function lineDiff(a: string, b: string): { added: number; removed: number } {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > 400_000) return { added: y.length, removed: x.length };
  const dp = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j];
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  const l = dp[y.length];
  return { added: y.length - l, removed: x.length - l };
}

/** 파일 도구의 변경 줄 수(수정: 바뀐 부분 비교, 작성: 내용 줄 수) */
function changeStats(name: string, args: any): { added: number; removed: number } | null {
  if (name === "edit" && Array.isArray(args?.edits)) {
    let added = 0, removed = 0;
    for (const e of args.edits) {
      const d = lineDiff(String(e?.oldText ?? ""), String(e?.newText ?? ""));
      added += d.added;
      removed += d.removed;
    }
    return { added, removed };
  }
  if (name === "write" && typeof args?.content === "string") {
    return { added: args.content.split("\n").length, removed: 0 };
  }
  return null;
}

/** 폰에 보여줄 한 줄 설명: 명령은 첫 줄 '# 설명' 주석(없으면 첫 줄), 파일 도구는 '파일명 수정' 같은 문구 */
function describe(name: string, args: any): string {
  const base = (p: unknown) => String(p ?? "").split("/").pop() || String(p ?? "");
  const cut = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n)}…` : t);
  if (!args || typeof args !== "object") return name;
  switch (name) {
    case "bash": {
      const lines = String(args.command ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const comment = lines.find((l) => l.startsWith("#") && !l.startsWith("#!"));
      return cut(comment ? comment.replace(/^#+\s*/, "") : lines[0] ?? "");
    }
    case "read": return `${base(args.path)} 읽기`;
    case "edit": return `${base(args.path)} 수정`;
    case "write": return `${base(args.path)} 작성`;
    case "grep": case "find": case "ls": return cut(`검색: ${args.pattern ?? args.path ?? ""}`);
    case "subagent": {
      const n = Array.isArray(args.tasks) ? args.tasks.length : Array.isArray(args.chain) ? args.chain.length : 1;
      return `하위 에이전트 ${n}개 실행`;
    }
    case "ask_user": return cut(askTitle(args));
    case "show_artifact": return cut(String(args.title ?? args.path ?? "아티팩트"));
    case "web_search": return cut(`웹 검색: ${args.query ?? ""}`);
    case "web_fetch": return cut(`웹: ${String(args.url ?? "").replace(/^https?:\/\//, "")}`);
    case "todo_write": {
      const t = Array.isArray(args.todos) ? args.todos : [];
      const doing = t.find((x: any) => x?.status === "in_progress");
      return cut(`할 일 ${t.filter((x: any) => x?.status === "completed").length}/${t.length}${doing ? ` · 지금: ${doing.content}` : ""}`);
    }
    default: return name;
  }
}

/** 맥 pi 가 '@' 파일 찾기에 쓰는 fd 위치(PATH → 홈브루 → pi 도구 폴더). 없으면 null(찾기 결과 없음) */
let fdPathCache: string | null | undefined;
function findFd(): string | null {
  if (fdPathCache !== undefined) return fdPathCache;
  const dirs = [...String(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME}/.pi/agent/bin`];
  fdPathCache = dirs.filter(Boolean).map((d) => join(d, "fd")).find((p) => existsSync(p)) ?? null;
  return fdPathCache;
}

/** 고르는 질문(ask_user)의 답 한 줄 */
function askAnswer(d: any): string {
  if (Array.isArray(d?.items)) return d.items.map((it: any) => askAnswer({ ...it, by: d.by })).join(" / ");   // 여러 질문
  const parts = [...(Array.isArray(d?.answers) ? d.answers : []), d?.other].map((x) => String(x ?? "").trim()).filter(Boolean);
  if (parts.length) return parts.join(", ");
  return d?.by === "aborted" ? "멈춤" : "답하지 않음";
}
/** 고르는 질문(ask_user)의 이름: 여러 질문이면 '첫 질문 외 N개' */
function askTitle(a: any): string {
  const qs = Array.isArray(a?.questions) ? a.questions : [];
  const first = String(qs[0]?.question ?? a?.question ?? "질문").trim().split("\n")[0];
  return qs.length > 1 ? `${first} 외 ${qs.length - 1}개` : first;
}

/** pi 메시지 → 폰용 메시지. 그리지 않을 종류는 null */
function normalize(m: any, id: string): Json | null {
  switch (m?.role) {
    case "user":
      return {
        id,
        role: "user",
        text: textOf(m.content),
        images: Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "image").length : 0,
      };
    case "assistant":
      return {
        id,
        role: "assistant",
        stop: m.stopReason ?? null,
        error: m.errorMessage ?? null,
        blocks: (m.content ?? [])
          .map((b: any, i: number) => {
            if (b?.type === "text") return { type: "text", text: b.text ?? "" };
            // 생각 본문은 무거우므로 보내지 않고 위치(ref)만. 폰에서 탭하면 상세 요청으로 받아 간다
            if (b?.type === "thinking") {
              // 본문 대신 위치(ref)와 첫 줄 미리보기만. 폰에서 탭하면 상세 요청으로 전체를 받아 간다
              const first = b.redacted
                ? ""
                : (String(b.thinking ?? "").split("\n").map((l) => l.replace(/[*#`>_]/g, "").trim()).find(Boolean) ?? "");
              return { type: "thinking", ref: `${m.timestamp ?? ""}:${i}`, desc: first.slice(0, 80) };
            }
            if (b?.type === "toolCall")
              return {
                type: "tool", id: b.id, name: b.name,
                summary: summarize(b.name, b.arguments),
                desc: describe(b.name, b.arguments),
                stats: changeStats(b.name, b.arguments),
                // 사진 파일을 읽은 단계 → 폰이 대화에 그 사진을 보여줌(요청 시 도구 결과의 그림을 받아 감)
                image: b.name === "read" && /\.(png|jpe?g|gif|webp|heic)$/i.test(String(b.arguments?.path ?? "")),
              };
            return null;
          })
          .filter(Boolean),
      };
    case "toolResult":
      return {
        id,
        role: "toolResult",
        toolCallId: m.toolCallId,
        isError: !!m.isError,
        output: clip(textOf(m.content), MAX_TOOL_OUTPUT),
        // 고르는 질문의 답(폰 단계 줄 '물어봄 질문 → 답')
        ...(m.toolName === "ask_user" ? { answer: askAnswer(m.details) } : {}),
        // 아티팩트: 폰이 단계 줄 아래 카드·목록을 만듦(내용은 요청할 때)
        ...(m.toolName === "show_artifact" && !m.isError && m.details?.path
          ? { artifact: { path: String(m.details.path), title: String(m.details.title ?? ""), kind: String(m.details.kind ?? "file"),
              size: Number(m.details.size ?? 0), ...(m.details.description ? { description: String(m.details.description) } : {}) } }
          : {}),
      };
    case "bashExecution":
      return {
        id,
        role: "bash",
        command: m.command ?? "",
        output: clip(m.output ?? "", MAX_TOOL_OUTPUT),
        exitCode: m.exitCode ?? null,
      };
    case "compactionSummary":
    case "branchSummary":
      return { id, role: "summary", text: clip(m.summary ?? "", 3000) };
    default:
      return null;
  }
}

const IMG_DIR = `${process.env.HOME}/.cache/pi-remote`;

/** 폰이 올려 둔 사진을 pi 에 넣을 그림으로. 사진 폴더의 img-숫자 파일만 허용 */
function imageBlock(p: unknown): Json | null {
  const base = String(p ?? "").split("/").pop() ?? "";
  if (!/^img-\d+\.(jpe?g|png)$/i.test(base)) return null;
  try {
    const data = readFileSync(`${IMG_DIR}/${base}`).toString("base64");
    return { type: "image", data, mimeType: /\.png$/i.test(base) ? "image/png" : "image/jpeg" };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- 자동 다시 불러오기·재시작 ---
// 확장 파일이 바뀌면: 1분 이상 쉬고 있을 때 다시 불러오기(/reload 와 같음)
// pi 본체가 업데이트되면: 10분 이상 쉬고 있고 맥 입력창이 비어 있을 때 `pi -c` 로 재시작(대화 이어짐)
const RELOAD_IDLE_MS = Number(process.env.PI_REMOTE_RELOAD_IDLE_SEC ?? 60) * 1000;
// 폰과 주고받는 형식의 판. 폰은 이보다 낮으면 '맥에서 다시 불러오기가 필요해요'를 띄운다.
// 2: 사용량 게이지·단계 상세·지난 대화 기록 등
// 3: 고르는 질문 카드(ask-user 중계)·폰 알림
const FEED_VERSION = 3;
const RESTART_IDLE_MS = Number(process.env.PI_REMOTE_RESTART_IDLE_SEC ?? 600) * 1000;
const WATCH_DIRS = [`${process.env.HOME}/.pi/agent/extensions`, `${process.env.HOME}/.pi/agent/agents`];
// MCP 서버 설정·공통 지침도 바뀌면 다시 불러와야 적용됨(/reload 가 둘 다 다시 읽음)
const WATCH_FILES = [`${process.env.HOME}/.pi/agent/mcp.json`, `${process.env.HOME}/.pi/agent/CLAUDE.md`];
const PROCESS_STARTED = Date.now() - process.uptime() * 1000;

/** 감시하는 확장·에이전트 파일 중 가장 최근 수정 시각 */
function extStamp(): number {
  let max = 0;
  const walk = (d: string, depth: number) => {
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      try {
        const st = statSync(p);
        if (st.isDirectory()) {
          if (depth < 2 && n !== "node_modules") walk(p, depth + 1);
        } else if (/\.(ts|js|md|json)$/.test(n)) {
          max = Math.max(max, st.mtimeMs);
        }
      } catch {
        /* 사라진 파일은 무시 */
      }
    }
  };
  for (const d of WATCH_DIRS) walk(d, 0);
  for (const f of WATCH_FILES) {
    try {
      max = Math.max(max, statSync(f).mtimeMs);
    } catch {
      /* 없는 파일은 무시 */
    }
  }
  return max;
}

/** 실행 중인 pi 본체 파일(이 pi 가 켜진 뒤 바뀌었으면 업데이트된 것) */
function coreFile(): string | null {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return null;
  }
}

/** 디스크에 설치된 pi 버전(업데이트 알림 문구용) */
function diskVersion(): string {
  try {
    let d = dirname(coreFile() ?? "");
    for (let i = 0; i < 6; i++) {
      const pj = join(d, "package.json");
      if (existsSync(pj)) {
        const j = JSON.parse(readFileSync(pj, "utf8"));
        if (j.name === "@earendil-works/pi-coding-agent") return String(j.version);
      }
      d = dirname(d);
    }
  } catch {
    /* 모르면 빈 값 */
  }
  return "";
}

function coreUpdatedSinceStart(): boolean {
  if (process.env.PI_REMOTE_FAKE_CORE_UPDATED === "1") return true;   // 시험용
  const f = coreFile();
  try {
    return !!f && statSync(f).mtimeMs > PROCESS_STARTED + 5000;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  const pane = process.env.TMUX_PANE;
  if (!pane) return; // tmux 밖이면 폰에서 볼 일이 없으므로 아무것도 안 함

  const dir = `${process.env.HOME}/.cache/pi-remote/feed`;
  const sockPath = `${dir}/${pane.replace(/\W/g, "")}.sock`;
  // 이 탭이 지금 연 대화 파일(브리지가 '지난 대화' 목록에서 이미 열린 대화를 알아보고 두 번 열지 않게)
  const openPath = `${dir}/${pane.replace(/\W/g, "")}.session`;
  const writeOpen = (ctx: any) => {
    try {
      const file = ctx?.sessionManager?.getSessionFile?.();
      mkdirSync(dir, { recursive: true });
      // 새 대화는 첫 메시지 전까지 파일이 없을 수 있어 폴더 실제 경로 + 파일 이름으로 기록
      const real = file ? (existsSync(file) ? realpathSync(file) : join(realpathSync(dirname(file)), basename(file))) : "";
      if (real) writeFileSync(openPath, JSON.stringify({ session: real, pid: process.pid }));
      else if (existsSync(openPath)) unlinkSync(openPath);
    } catch {
      /* 기록 실패는 무시(목록에 '열림' 표시만 빠짐) */
    }
  };
  const clearOpen = () => {
    try {
      // 같은 탭에서 새 pi 가 이미 기록을 바꿨으면 건드리지 않음
      if (JSON.parse(readFileSync(openPath, "utf8"))?.pid === process.pid) unlinkSync(openPath);
    } catch {
      /* 없으면 그만 */
    }
  };
  const clients = new Set<Socket>();
  let server: Server | null = null;
  let ctxRef: any = null;
  let working = false;
  // 이번 작업을 시작한 시각(ms). 폰이 늦게 붙거나 다시 연결돼도 '7초 · 생각 중'을 실제 시작부터 세게 함
  let workSince = 0;
  let seq = 0;
  let runningTools = 0;   // 지금 실행 중인 도구(명령) 수. 자동 모드 판단에 쓴다
  // 작업 중에 받은 메시지(끼워넣기 대기열). pi 가 대화에 넣으면 빠진다.
  //   steer   : 지금 실행 중인 도구가 끝나면 다음 모델 호출 전에 바로 들어감(기본)
  //   followUp: 작업이 모두 끝난 뒤 들어감
  let queue: { id: string; text: string; kind: string }[] = [];
  const sendQueue = () => broadcast({ t: "queue", items: queue });

  const broadcast = (obj: Json) => {
    if (!clients.size) return;
    const line = `${JSON.stringify(obj)}\n`;
    for (const c of clients) c.write(line);
  };

  /** 확장·스킬·프롬프트 명령(내부용 pi-remote-reload, 터미널 전용 usage 는 숨김 — 폰은 사용량 화면이 따로 있음) */
  const commandList = (): Json => {
    let items: Json[] = [];
    try {
      items = (pi.getCommands?.() ?? [])
        .filter((c: any) => c?.name && !["pi-remote-reload", "pi-remote-rewind", "usage", "artifacts", "memory"].includes(c.name))
        .map((c: any) => ({ name: c.name, description: c.description ?? "", source: c.source ?? "extension" }));
    } catch {
      /* 목록을 못 얻으면 빈 목록 */
    }
    return { t: "commands", commands: items };
  };

  // --- 폰 알림(브리지가 Apple 푸시로 보냄) ---
  // 승인 요청·확인 창·작업 끝(질문/완료/멈춤)에 알림. 앱을 보고 있을 때는 앱이 알림을 숨긴다.
  // 브리지는 tmux 세션마다 notify-<세션>.sock 을 열어 둔다(시험용 세션의 알림이 실제 폰으로 가지 않게).
  let lastApprovalAt = 0;
  const notifyPhone = (kind: string, title: string, body: string, extra: Json = {}) => {
    try {
      const out = execFileSync("tmux", ["display", "-p", "-t", pane, "#{session_name}:::#{window_index}"], {
        encoding: "utf8",
        timeout: 3000,
      }).trim();
      const [session, idx] = out.split(":::");
      const sock = `${process.env.HOME}/.cache/pi-remote/notify-${session}.sock`;
      if (!existsSync(sock)) return;
      const c = createConnection(sock);
      c.on("error", () => {});
      c.end(`${JSON.stringify({ kind, title, body: clip(body, 200), window: Number(idx), ...extra })}\n`);
    } catch {
      /* 알림 실패는 작업에 영향 없음 */
    }
  };
  // --- 작업 표시(Live Activity: 폰 잠금 화면·다이내믹 아일랜드, macOS 26 메뉴 막대) ---
  // 30초 넘게 일하면 띄우고(사용자가 고른 값), 하는 일이 바뀌면 20초 간격으로 갱신, 끝나면 끝 상태(브리지가 5분 뒤 없앰)
  const LIVE_START_MS = 30_000;
  const LIVE_UPDATE_MS = 20_000;
  const fresh = () => ({ started: false, status: "working", detail: "🤔 생각 중…", sent: 0, sentDetail: "", startedAt: 0 });
  let live = fresh();
  let liveTimer: any = null;
  let livePending: any = null;
  const sendActivity = (event: string) => {
    try {
      const out = execFileSync("tmux", ["display", "-p", "-t", pane, "#{session_name}:::#{window_index}:::#{window_name}"], {
        encoding: "utf8",
        timeout: 3000,
      }).trim();
      const [session, idx, name] = out.split(":::");
      const sock = `${process.env.HOME}/.cache/pi-remote/notify-${session}.sock`;
      live.sent = Date.now();
      live.sentDetail = `${live.status}|${live.detail}`;
      if (!existsSync(sock)) return;
      const c = createConnection(sock);
      c.on("error", () => {});
      c.end(`${JSON.stringify({ kind: "activity", event, window: Number(idx), tabName: name || "pi", status: live.status, detail: live.detail, startedAt: Math.floor(live.startedAt / 1000) })}\n`);
    } catch {
      /* 표시 실패는 작업에 영향 없음 */
    }
  };
  /** 일 시작: 30초 뒤에도 일하고 있으면 띄움 */
  // 사용자 결정: 잠금 화면에 작업 시작·작업 중·완료는 띄우지 않음(물어보는 것은 알림으로). 다시 켜려면 true
  const LIVE_WORK = false;
  const liveBegin = (startedAt: number) => {
    clearTimeout(liveTimer);
    clearTimeout(livePending);
    live = { ...fresh(), startedAt };
    if (!LIVE_WORK) return;
    liveTimer = setTimeout(() => {
      if (!working) return;
      live.started = true;
      sendActivity("start");
    }, LIVE_START_MS);
  };
  /** 상태·하는 일 바꾸기(띄운 뒤에만 보냄, 20초 간격, 사이에 바뀐 마지막 내용은 간격이 지나면 보냄) */
  const liveSet = (status: string, detail: string, now = false) => {
    live.status = status;
    live.detail = clip(detail, 120);
    if (!live.started || `${live.status}|${live.detail}` === live.sentDetail) return;
    clearTimeout(livePending);
    const wait = now ? 0 : Math.max(0, live.sent + LIVE_UPDATE_MS - Date.now());
    livePending = setTimeout(() => {
      if (live.started && `${live.status}|${live.detail}` !== live.sentDetail) sendActivity("update");
    }, wait);
  };
  /** 끝: 띄운 표시만 끝 상태로 */
  const liveEnd = (status: string, detail: string) => {
    clearTimeout(liveTimer);
    clearTimeout(livePending);
    if (!live.started) return;
    live.status = status;
    live.detail = clip(detail, 120);
    sendActivity("end");
    live.started = false;
  };

  // --- 백그라운드 탭(/bgtab): 다른 탭이 시킨 일이면 끝났을 때 폰 알림(시간과 상관없이) + 시킨 탭에 결과 요약 ---
  const bgInfo = (): { origin: string; by: string; name: string } | null => {
    try {
      const out = execFileSync("tmux", ["show-options", "-w", "-t", pane], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
      const get = (k: string) => (out.match(new RegExp(`^${k} (.*)$`, "m")) ?? [])[1]?.replace(/^"(.*)"$/, "$1") ?? "";
      const origin = get("@bg_origin");
      return origin ? { origin, by: get("@bg_by") || "user", name: get("@bg_name") || "bg" } : null;
    } catch {
      return null;
    }
  };
  /** 끝난 백그라운드 일 보고: 시킨 탭 연결부에 결과, 이 탭은 다시 보고하지 않게 표시를 지우고 끝난 때를 적음(앱 서랍이 보임) */
  const bgReport = (bg: { origin: string; by: string; name: string }, ok: boolean, text: string) => {
    let win = "";
    try {
      win = execFileSync("tmux", ["display", "-p", "-t", pane, "#{window_index}"], { encoding: "utf8", timeout: 3000 }).trim();
      execFileSync("tmux", ["set-option", "-w", "-u", "-t", pane, "@bg_origin"], { timeout: 3000 });
      execFileSync("tmux", ["set-option", "-w", "-t", pane, "@bg_done", String(Math.floor(Date.now() / 1000))], { timeout: 3000 });
    } catch {
      /* 표시를 못 지우면 다음에 또 보고될 수 있음 */
    }
    const sock = `${process.env.HOME}/.cache/pi-remote/feed/${bg.origin.replace(/\W/g, "")}.sock`;
    if (!existsSync(sock)) return;   // 시킨 탭이 닫혔음(폰 알림은 감)
    const c = createConnection(sock);
    c.on("error", () => {});
    c.end(`${JSON.stringify({ cmd: "bg-result", name: bg.name, window: Number(win), by: bg.by, ok, text: clip(text, 3000) })}\n`);
  };

  const plainLine = (s: string) => s.replace(/[`*_#>|]/g, "").replace(/\s+/g, " ").trim();
  const lines = (s: string) => String(s ?? "").split("\n").map(plainLine).filter(Boolean);
  // 마지막 줄이 질문이면 '질문이 있어요'
  const QUESTION_END = /([?？]|까요|나요|습니까)[.!)\s"'」』]*$/; // '~주세요'·'~할래요'는 부탁·다짐에도 쓰여 제외
  /** 작업이 끝나 사용자를 기다릴 때: 질문 / 완료 / 멈춤. 완료 알림은 브리지가 걸린 시간으로 거른다(기본 10분 넘게) */
  const notifySettled = (startedAt: number) => {
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    let last: any = null;
    try {
      const branch = ctxRef?.sessionManager?.getBranch?.() ?? [];
      for (let i = branch.length - 1; i >= 0 && !last; i--) {
        const e = branch[i];
        if (e?.type === "message" && e.message?.role === "assistant") last = e.message;
        if (e?.type === "message" && e.message?.role === "user") break;   // 이번 차례의 답만
      }
    } catch {
      /* 못 읽으면 알림 생략 */
    }
    if (!last || last.stopReason === "aborted") {
      liveEnd("stopped", "멈췄어요");
      return;   // 직접 멈춘 것은 알리지 않음
    }
    const bg = bgInfo();
    if (last.stopReason === "error") {
      const why = lines(last.errorMessage ?? "")[0] ?? "오류로 멈췄어요";
      liveEnd("error", why);
      notifyPhone("error", bg ? `백그라운드 작업이 멈췄어요: ${bg.name}` : "작업이 멈췄어요", why);
      if (bg) bgReport(bg, false, why);
      return;
    }
    const text = (last.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
    const ls = lines(text);
    const tail = ls[ls.length - 1] ?? "";
    if (bg && !QUESTION_END.test(tail)) {
      liveEnd("done", ls[0] ?? "끝났어요");
      notifyPhone("done", `백그라운드 작업이 끝났어요: ${bg.name}`, ls[0] ?? "결과를 확인해 주세요", { durationSec, background: true });
      bgReport(bg, true, text);
      return;
    }
    if (QUESTION_END.test(tail)) {
      liveEnd("asking", tail);
      notifyPhone("question", "질문이 있어요", tail);
    } else {
      liveEnd("done", ls[0] ?? "끝났어요");
      const min = Math.round(durationSec / 60);
      notifyPhone("done", min >= 1 ? `작업이 끝났어요(${min}분)` : "작업이 끝났어요", ls[0] ?? "답을 확인해 주세요", { durationSec });
    }
  };

  // --- 승인 요청 중계(send-guard 확장 ↔ 폰) ---
  // 보내기·위험 동작이 승인을 기다리면 폰에 카드로 띄우고, 폰의 답을 send-guard 에 돌려준다
  const approvals = new Map<string, Json>();
  const approvalPush = new Map<string, any>();   // 승인 id → 알림 대기 타이머
  const approvalSend: Record<string, (sentence?: string) => void> = {};
  pi.events.on("pi-remote:approval-request", (r: any) => {
    if (!r?.id) return;
    approvals.set(String(r.id), r);
    broadcast({ t: "approval", item: r });
    lastApprovalAt = Date.now();
    liveSet("asking", `🔐 ${r.label ?? "승인이 필요해요"}`, true);
    // 폰 알림: 설명 문장(Opus)이 나오면 그 문장으로, 8초 안에 안 나오면 기본 문구로. 그 전에 답하면 보내지 않음
    const send = (sentence?: string) => {
      if (approvalPush.get(String(r.id)) === undefined) return;
      clearTimeout(approvalPush.get(String(r.id)));
      approvalPush.delete(String(r.id));
      notifyPhone(
        "approval",
        `승인이 필요합니다${r.risk ? ` (${r.risk})` : ""}`,
        sentence || `${r.purpose || r.note || lines(String(r.intent ?? ""))[0] || r.label || ""}\n${r.label ?? ""}${r.to ? ` · ${r.to}` : ""}`,
      );
    };
    approvalPush.set(String(r.id), setTimeout(() => send(), r.summarizing ? 8000 : 0));
    (approvalSend as any)[String(r.id)] = send;
  });
  // 비밀번호가 필요한 sudo: send-guard 가 새 탭을 열면 폰에 알림(폰은 tmux 현재 창을 따라 그 탭 터미널로 감)
  pi.events.on("pi-remote:sudo-tab", (t: any) => {
    lastApprovalAt = Date.now();
    liveSet("asking", "🔐 관리자 비밀번호가 필요해요", true);
    notifyPhone("prompt", "관리자 비밀번호가 필요해요", `${t?.window ?? ""}번 탭(🔐sudo)에서 Enter를 누르고 비밀번호를 입력해 주세요`, { window: Number(t?.window) });
  });
  pi.events.on("pi-remote:sudo-tab-done", () => liveSet("working", "🤔 생각 중…", true));
  // Haiku 요약이 나중에 오면 카드에 채움
  pi.events.on("pi-remote:approval-update", (u: any) => {
    const r = approvals.get(String(u?.id ?? ""));
    if (!r) return;
    Object.assign(r, { headline: String(u.headline ?? ""), summary: String(u.summary ?? ""), summarizing: !!u.summarizing, ...(u.risk ? { risk: String(u.risk) } : {}) });
    approvalSend[String(u.id)]?.(r.headline ? String(r.headline) : undefined);   // 기다리던 알림을 설명 문장으로
    broadcast({ t: "approval-update", id: String(u.id), headline: r.headline, summary: r.summary, summarizing: r.summarizing, risk: r.risk });
  });
  // --- 계획 모드(plan-mode 확장): 폰 입력창 '계획' 칩 ---
  let planMode = false;
  // 권한 모드(send-guard): auto | ask | plan
  let permMode = "auto";
  pi.events.on("perm-mode:changed", (d: any) => {
    permMode = String(d?.mode ?? "auto");
    broadcast({ t: "permmode", mode: permMode });
  });
  pi.events.on("plan-mode:changed", (d: any) => {
    planMode = !!d?.on;
    broadcast({ t: "planmode", on: planMode });
  });
  // 다른 확장이 보내는 폰 알림(계획 확인 등 물어보는 것)
  pi.events.on("pi-remote:notify", (d: any) => {
    if (d?.title) notifyPhone(String(d.kind ?? "choice"), String(d.title), String(d.body ?? ""));
  });
  // --- 계정 전환(claude-accounts 확장): 폰 대화에도 알림 문구 ---
  pi.events.on("claude-accounts:switch", (d: any) => {
    if (d?.text) broadcast({ t: "notice", text: String(d.text) });
  });
  // --- 고르는 질문 중계(ask-user 확장 ↔ 폰) ---
  const questions = new Map<string, Json>();
  pi.events.on("pi-remote:question-request", (q: any) => {
    if (!q?.id) return;
    questions.set(String(q.id), q);
    broadcast({ t: "question", question: q });
    lastApprovalAt = Date.now();   // 질문이 띄우는 맥 선택 창 알림과 겹치지 않게
    liveSet("asking", `❓ ${String(q.question ?? "")}`, true);
    notifyPhone("choice", "선택이 필요해요", String(q.question ?? ""));
  });
  pi.events.on("pi-remote:question-done", (q: any) => {
    if (!q?.id || !questions.delete(String(q.id))) return;
    broadcast({ t: "question-done", id: String(q.id) });
    liveSet("working", "🤔 생각 중…", true);
  });

  // --- pi 확인 창 중계(다른 확장·pi 가 띄운 select·confirm·input ↔ 폰) ---
  // pi 는 확인 창 내용을 이벤트로 주지 않아서, 모든 확장이 함께 쓰는 ctx.ui 의 세 함수를 감싼다.
  // 폰에는 질문 카드 형식(kind 를 덧붙임)으로 보내고, 맥과 폰 중 먼저 답한 쪽을 따른다(폰이 먼저면 맥 창을 닫음).
  // 감쌀 수 없으면(pi 구조가 바뀌면) 예전처럼 알림만 간다. 승인·고르기 질문은 스스로 폰과 주고받으므로 그대로 둔다.
  type Prompt = { item: Json; kind: string; options: string[]; cancelValue: any; settle: (v: any) => void };
  const prompts = new Map<string, Prompt>();
  const UI_MARK = Symbol.for("pi-remote.ui-relay");
  const UI_ORIG = Symbol.for("pi-remote.ui-orig");
  const me = {};   // 이 확장 인스턴스 표식(/reload 뒤 옛 감싸기가 남지 않게)
  let wrappedUI: any = null;
  const YES = "예";
  const NO = "아니오";
  const relayPrompt = (kind: string, question: string, options: string[], extra: Json, opts: any,
                       run: (o: any) => Promise<any>, cancelValue: any): Promise<any> => {
    const outer: AbortSignal | undefined = opts?.signal;
    if (approvals.size || questions.size || outer?.aborted) return run(opts);   // send-guard·ask-user 가 띄운 창
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ac = new AbortController();
    const onOuter = () => ac.abort();
    outer?.addEventListener?.("abort", onOuter, { once: true });
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        done = true;
        outer?.removeEventListener?.("abort", onOuter);
        prompts.delete(id);
        broadcast({ t: "question-done", id });
        liveSet("working", "🤔 생각 중…", true);
      };
      const item = { id, kind, question: clip(question, 4000), options: options.map((label) => ({ label })), multiSelect: false, since: Date.now(), ...extra };
      prompts.set(id, {
        item, kind, options, cancelValue,
        settle: (v) => {   // 폰의 답: 맥 창을 닫고 그 답을 돌려줌
          if (done) return;
          finish();
          ac.abort();
          resolve(v);
        },
      });
      broadcast({ t: "question", question: item });
      liveSet("asking", `❓ ${lines(question)[0] ?? "확인을 기다려요"}`, true);
      if (working) notifyPhone("prompt", "pi가 확인을 기다려요", question);
      Promise.resolve()
        .then(() => run({ ...(opts ?? {}), signal: ac.signal }))
        .then(
          (v) => { if (!done) { finish(); resolve(v); } },   // 맥에서 답함(또는 시간 초과·취소)
          (err) => { if (!done) { finish(); reject(err); } },
        );
    });
  };
  /** 폰 카드의 답을 확인 창 값으로 */
  const answerPrompt = (p: Prompt, answers: string[], other: string, cancel: boolean) => {
    if (cancel) return p.settle(p.cancelValue);
    const a = answers[0] ?? "";
    if (p.kind === "select" && p.options.includes(a)) p.settle(a);
    else if (p.kind === "confirm" && (a === YES || a === NO)) p.settle(a === YES);
    else if (p.kind === "input" && (other || a)) p.settle(other || a);
  };
  const wrapUI = (ctx: any) => {
    try {
      if (!ctx?.hasUI) return;
      const ui = ctx.ui;
      if (!ui || ui[UI_MARK] === me) return;
      const orig = ui[UI_ORIG] ?? { select: ui.select, confirm: ui.confirm, input: ui.input };
      if (![orig.select, orig.confirm, orig.input].every((f) => typeof f === "function")) return;
      ui[UI_ORIG] = orig;
      // 맥 쪽은 번호 상자(Claude Code 처럼 숫자로 바로 고르기). 못 그리면 pi 기본 창. 시간 제한이 있으면 기본 창(남은 시간 표시)
      const boxSelect = async (title: string, options: string[], o: any): Promise<string | undefined> => {
        if (o?.timeout) return orig.select.call(ui, title, options, o);
        const r = await askChoice({ ui }, { question: title, options: options.map((label) => ({ label })) }, o?.signal);
        if (r === "unsupported") return orig.select.call(ui, title, options, o);
        return r && !r.back ? options[r.picks[0]] : undefined;
      };
      ui.select = (title: string, options: string[], opts?: any) =>
        relayPrompt("select", String(title ?? ""), (options ?? []).map(String), {}, opts,
          (o) => boxSelect(String(title ?? ""), (options ?? []).map(String), o), undefined);
      ui.confirm = (title: string, message: string, opts?: any) =>
        relayPrompt("confirm", [title, message].filter(Boolean).join("\n"), [YES, NO], {}, opts,
          async (o) => {
            if (o?.timeout) return orig.confirm.call(ui, title, message, o);
            const a = await boxSelect([title, message].filter(Boolean).join("\n"), [YES, NO], o);
            return a === YES;
          }, false);
      ui.input = (title: string, placeholder?: string, opts?: any) =>
        relayPrompt("input", String(title ?? ""), [], placeholder ? { placeholder: String(placeholder) } : {}, opts,
          (o) => orig.input.call(ui, title, placeholder, o), undefined);
      ui[UI_MARK] = me;
      wrappedUI = ui;
    } catch {
      /* 감쌀 수 없으면 알림만 */
    }
  };
  const unwrapUI = () => {
    try {
      if (wrappedUI?.[UI_MARK] !== me) return;
      Object.assign(wrappedUI, wrappedUI[UI_ORIG]);
      delete wrappedUI[UI_MARK];
    } catch {
      /* 무시 */
    }
  };

  // 작업 중에 뜬 확인 창(다른 확장·pi). 승인 요청의 창은 위에서 이미 알렸고, 맥에서 직접 연 창은 알리지 않음
  pi.on("ui_prompt_start", async (e: any) => {
    // 승인·질문이 떠 있으면 이미 알렸음(맥에서 '기타'를 골라 뜬 입력 창 등)
    if (!working || approvals.size || questions.size || prompts.size || Date.now() - lastApprovalAt < 3000) return;
    notifyPhone("prompt", "pi가 확인을 기다려요", e?.title || "맥 화면의 확인 창에 답해 주세요");
  });
  pi.events.on("pi-remote:approval-done", (r: any) => {
    if (!r?.id || !approvals.delete(String(r.id))) return;
    clearTimeout(approvalPush.get(String(r.id)));   // 알림을 보내기 전에 답했으면 보내지 않음
    approvalPush.delete(String(r.id));
    delete approvalSend[String(r.id)];
    broadcast({ t: "approval-done", id: String(r.id) });
    liveSet("working", "🤔 생각 중…", true);
  });

  // --- 컨텍스트 사용량(폰 게이지) ---
  // 자동 압축은 "사용량 > 기억 용량 - reserveTokens"(기본 16384)일 때 시작. 설정은 전역 → 프로젝트 순으로 덮어씀
  let lastContext = "";
  let compacting = false;
  let compactSince = 0;
  const setCompacting = (v: boolean) => {
    if (compacting === v) return;
    compacting = v;
    compactSince = v ? Date.now() : 0;
    broadcast({ t: "compacting", value: v, since: compactSince || null });
  };
  // 실패는 요청 쪽(onError)과 pi 이벤트 양쪽에서 알려 와서 3초 안의 두 번째는 건너뜀
  let lastFailNotice = 0;
  const failNotice = (msg?: string, aborted?: boolean) => {
    if (Date.now() - lastFailNotice < 3000) return;
    lastFailNotice = Date.now();
    const text = aborted
      ? "대화 압축을 취소했어요"
      : /nothing to compact|too small/i.test(msg ?? "")
        ? "아직 압축할 만큼 대화가 길지 않아요"
        : "대화를 압축하지 못했어요";
    broadcast({ t: "notice", text });
  };
  const compactionSettings = (): { auto: boolean; reserve: number } => {
    let auto = true;
    let reserve = 16384;
    const files = [`${process.env.HOME}/.pi/agent/settings.json`];
    if (ctxRef?.cwd) files.push(join(ctxRef.cwd, ".pi", "settings.json"));
    for (const f of files) {
      try {
        const c = JSON.parse(readFileSync(f, "utf8"))?.compaction;
        if (typeof c?.enabled === "boolean") auto = c.enabled;
        if (typeof c?.reserveTokens === "number") reserve = c.reserveTokens;
      } catch {
        /* 파일이 없으면 기본값 */
      }
    }
    return { auto, reserve };
  };
  const contextInfo = (): Json | null => {
    try {
      const u = ctxRef?.getContextUsage?.();
      if (!u?.contextWindow) return null;
      return { tokens: u.tokens ?? null, window: u.contextWindow, percent: u.percent ?? null, ...compactionSettings() };
    } catch {
      return null;
    }
  };
  /** 바뀌었을 때만 폰에 알림(답변이 끝날 때·모델이 바뀔 때·압축 뒤) */
  const sendContext = () => {
    const c = contextInfo();
    const key = JSON.stringify(c);
    if (key === lastContext) return;
    lastContext = key;
    broadcast({ t: "context", context: c });
  };

  /** 지금 할 일 목록(대화 갈래의 마지막 todo_write) */
  const todosNow = (): Json[] => {
    try {
      const branch = ctxRef?.sessionManager?.getBranch?.() ?? [];
      for (let i = branch.length - 1; i >= 0; i--) {
        const m = branch[i]?.type === "message" ? branch[i].message : null;
        if (m?.role === "toolResult" && m.toolName === "todo_write" && !m.isError && Array.isArray(m.details?.todos)) return m.details.todos;
      }
    } catch {
      /* 못 읽으면 없음 */
    }
    return [];
  };

  const snapshot = (withNotice = false): Json => {
    const msgs: Json[] = [];
    try {
      for (const e of ctxRef?.sessionManager?.getBranch() ?? []) {
        if (e.type === "message") {
          const n = normalize(e.message, e.id);
          if (n) msgs.push(n);
        } else if (e.type === "compaction") {
          msgs.push({ id: e.id, role: "summary", text: clip(e.summary ?? "", 3000) });
        }
      }
    } catch {
      /* 읽기 실패 시 빈 대화 */
    }
    const truncated = Math.max(0, msgs.length - MAX_MESSAGES);
    // canSend: 브리지가 보내는 send 명령을 처리할 수 있음(예전 확장엔 없어서 브리지가 입력창 방식으로 대신 보냄)
    // notice: 재시작 직후 폰에 한 번 보여줄 안내(업데이트 완료 등)
    // 안내는 실제로 연결된 쪽(폰)에 보낼 때만 한 번 꺼내 쓴다
    const notice = withNotice ? pendingNotice : "";
    if (withNotice) pendingNotice = "";
    const context = contextInfo();
    lastContext = JSON.stringify(context);
    // 시험용: 이 파일이 있으면 예전 판인 척(폰의 '다시 불러오기' 띠 확인)
    const v = existsSync(process.env.PI_REMOTE_FAKE_OLD_FILE ?? "") ? 1 : FEED_VERSION;
    return {
      t: "snapshot", v, messages: msgs.slice(-MAX_MESSAGES), truncated, working, queue, canSend: true, notice, context, compacting,
      since: working && workSince ? workSince : null,
      approvals: [...approvals.values()],
      questions: [...questions.values(), ...[...prompts.values()].map((p) => p.item)],
      todos: todosNow(),
      planMode,
      permMode,
      compactSince: compacting && compactSince ? compactSince : null,
    };
  };

  const start = () => {
    if (server) return;
    try {
      mkdirSync(dir, { recursive: true });
      try {
        unlinkSync(sockPath);
      } catch {
        /* 없으면 무시 */
      }
      server = createServer((sock) => {
        clients.add(sock);
        const drop = () => clients.delete(sock);
        sock.on("close", drop);
        sock.on("error", drop);
        sock.write(`${JSON.stringify(snapshot(true))}\n`);
        sock.write(`${JSON.stringify(commandList())}\n`);
        // 브리지가 보내는 명령(줄 단위 JSON)
        let buf = "";
        sock.setEncoding("utf8");
        sock.on("data", (chunk: string) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            try {
              void handleCommand(JSON.parse(line), sock);
            } catch {
              /* 잘못된 줄은 무시 */
            }
          }
        });
      });
      server.on("error", () => {
        /* 소켓 오류가 pi 를 멈추지 않게 */
      });
      server.listen(sockPath);
    } catch {
      server = null;
    }
  };

  const stop = () => {
    for (const c of clients) c.destroy();
    clients.clear();
    server?.close();
    server = null;
    try {
      unlinkSync(sockPath);
    } catch {
      /* 없으면 무시 */
    }
  };

  // --- 폰에서 보낸 메시지를 pi 에 넣기 ---
  // --- 폰이 단계 하나를 탭했을 때: 그 도구의 전체 명령·출력 / 생각 내용 ---
  const liveMsgs = new Map<string, any>();   // 아직 저장 전일 수 있는 최근 답(timestamp → 메시지)
  const rememberLive = (m: any) => {
    if (m?.role !== "assistant" || m.timestamp == null) return;
    liveMsgs.set(String(m.timestamp), m);
    if (liveMsgs.size > 30) liveMsgs.delete(liveMsgs.keys().next().value as string);
  };
  const BIG = 20_000;

  const findDetail = (o: any): Json => {
    const msgs: any[] = [];
    try {
      for (const e of ctxRef?.sessionManager?.getBranch?.() ?? []) if (e.type === "message") msgs.push(e.message);
    } catch {
      /* 못 읽으면 기억해 둔 것만 */
    }
    for (const m of liveMsgs.values()) msgs.push(m);
    if (o.kind === "thinking") {
      const [ts, idx] = String(o.ref ?? "").split(":");
      const m = msgs.find((x) => x?.role === "assistant" && String(x.timestamp) === ts);
      const b = m?.content?.[Number(idx)];
      if (!b) return { kind: "thinking", error: "생각 내용을 찾지 못했어요" };
      return { kind: "thinking", text: b.redacted ? "(가려진 생각)" : clip(String(b.thinking ?? ""), BIG) };
    }
    let call: any = null;
    for (const m of msgs) {
      if (m?.role !== "assistant") continue;
      const b = (m.content ?? []).find((x: any) => x?.type === "toolCall" && x.id === o.id);
      if (b) call = b;
    }
    if (!call) return { kind: "other", error: "도구 기록을 찾지 못했어요" };
    const res = msgs.find((x) => x?.role === "toolResult" && x.toolCallId === o.id);
    const output = res ? clip(textOf(res.content), BIG) : "";
    const isError = !!res?.isError;
    const a = call.arguments ?? {};
    switch (call.name) {
      case "bash":
        return { kind: "bash", command: clip(String(a.command ?? ""), BIG), output, isError, done: !!res };
      case "edit":
        return {
          kind: "edit", path: String(a.path ?? ""), isError, output, done: !!res,
          edits: (Array.isArray(a.edits) ? a.edits : []).slice(0, 30).map((e: any) => ({
            old: clip(String(e?.oldText ?? ""), 10_000),
            new: clip(String(e?.newText ?? ""), 10_000),
          })),
        };
      case "write":
        return { kind: "write", path: String(a.path ?? ""), content: clip(String(a.content ?? ""), BIG), isError, output, done: !!res };
      case "read":
        return { kind: "read", path: String(a.path ?? ""), output, isError, done: !!res };
      case "ask_user": {
        // 질문과 번호 붙은 선택지 전체(폰 상세의 '질문' 칸). 여러 질문이면 차례로
        const one = (q: any) => [String(q?.question ?? ""), "", ...(Array.isArray(q?.options) ? q.options : []).map(
          (x: any, i: number) => `${i + 1}. ${String(x?.label ?? "")}${x?.description ? `\n   ${String(x.description)}` : ""}`,
        )].join("\n");
        const qs = Array.isArray(a.questions) && a.questions.length ? a.questions : [a];
        const body = qs.length > 1 ? qs.map((q: any, i: number) => `[질문 ${i + 1}] ${one(q)}`).join("\n\n") : one(qs[0]);
        return { kind: "other", title: qs.length > 1 ? `질문 ${qs.length}개` : "질문", args: clip(body, BIG), output, isError, done: !!res };
      }
      default: {
        let args = "";
        try {
          args = clip(JSON.stringify(a, null, 2), BIG);
        } catch {
          /* 표시 못 하면 빈 값 */
        }
        return { kind: "other", title: call.name, args, output, isError, done: !!res };
      }
    }
  };

  /** 도구 결과에 든 그림(읽은 사진)을 폰용으로 줄여서(긴 변 1280px JPEG) */
  const toolImage = (id: string): Json => {
    const msgs: any[] = [];
    try {
      for (const e of ctxRef?.sessionManager?.getBranch?.() ?? []) if (e.type === "message") msgs.push(e.message);
    } catch {
      /* 못 읽으면 없음 */
    }
    const res = msgs.find((x) => x?.role === "toolResult" && x.toolCallId === id);
    const img = (res?.content ?? []).find((b: any) => b?.type === "image" && b.data);
    if (!img) return { error: "사진을 찾지 못했어요" };
    try {
      const dir = join(tmpdir(), "pi-remote-toolimg");
      mkdirSync(dir, { recursive: true });
      const src = join(dir, `${id.replace(/\W/g, "")}.src`);
      const out = join(dir, `${id.replace(/\W/g, "")}.jpg`);
      writeFileSync(src, Buffer.from(img.data, "base64"));
      execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", "1280", src, "--out", out], { stdio: "ignore" });
      const data = readFileSync(out).toString("base64");
      unlinkSync(src);
      unlinkSync(out);
      return { data };
    } catch (e: any) {
      return { error: `사진 변환 실패: ${e?.message ?? e}` };
    }
  };

  /** 아티팩트 내용(이 대화에 등록된 파일만, 25MB까지) */
  const ARTIFACT_MAX = 25 * 1024 * 1024;   // 시작 위치 없이 통째로 달라는 예전 앱 요청만
  const ARTIFACT_CHUNK = 2 * 1024 * 1024;  // 나눠 받기 한 조각(크기 제한 없음)
  /** offset 이 있으면 그 위치부터 한 조각(size·offset·done·mtime 함께), 없으면 예전처럼 통째로 */
  const artifactData = (path: string, offset?: unknown): Json => {
    let registered = false;
    try {
      for (const e of ctxRef?.sessionManager?.getBranch?.() ?? []) {
        const m = e?.type === "message" ? e.message : null;
        if (m?.role === "toolResult" && m.toolName === "show_artifact" && !m.isError && m.details?.path === path) registered = true;
      }
    } catch {
      /* 못 읽으면 등록 안 된 것으로 */
    }
    if (!registered) return { error: "이 대화에 등록된 아티팩트가 아니에요" };
    try {
      const st = statSync(path);
      if (!st.isFile()) return { error: "파일이 아니에요" };
      if (offset !== undefined && offset !== null) {
        const off = Number(offset);
        if (!Number.isInteger(off) || off < 0 || off > st.size) return { error: "잘못된 위치에서 받으려 했어요. 다시 열어 주세요" };
        const len = Math.min(ARTIFACT_CHUNK, st.size - off);
        const buf = Buffer.alloc(len);
        if (len > 0) {
          const fd = openSync(path, "r");
          try {
            readSync(fd, buf, 0, len, off);
          } finally {
            closeSync(fd);
          }
        }
        return { name: basename(path), size: st.size, offset: off, done: off + len >= st.size, mtime: st.mtimeMs, data: buf.toString("base64") };
      }
      if (st.size > ARTIFACT_MAX) return { error: `파일이 너무 커요(${Math.round(st.size / 1048576)}MB). 앱을 업데이트하거나 맥에서 /artifacts 로 열어 주세요` };
      return { name: basename(path), size: st.size, data: readFileSync(path).toString("base64") };
    } catch {
      return { error: "파일을 읽지 못했어요(지워졌거나 옮겨졌을 수 있어요)" };
    }
  };

  // --- 메모리(지침 파일): 공통 ~/.pi/agent/CLAUDE.md, 작업 폴더부터 위로 AGENTS.md·CLAUDE.md ---
  const AGENT_DIR = join(process.env.HOME ?? "", ".pi", "agent");
  const memoryFiles = (): Json[] => {
    const out: Json[] = [];
    const add = (path: string, label: string, create = false) => {
      if (out.some((f) => f.path === path)) return;
      let content = "";
      let exists = false;
      try {
        const st = statSync(path);
        if (st.isFile() && st.size <= 400_000) {
          content = readFileSync(path, "utf8");
          exists = true;
        }
      } catch {
        /* 없는 파일 */
      }
      if (exists || create) out.push({ path, label: exists ? label : `${label}(새로 만들기)`, exists, content });
    };
    for (const n of ["AGENTS.md", "CLAUDE.md"]) add(join(AGENT_DIR, n), "공통 지침");
    if (!out.length) add(join(AGENT_DIR, "CLAUDE.md"), "공통 지침", true);
    const home = process.env.HOME ?? "/";
    let dir = ctxRef?.cwd ?? process.cwd();
    const seen: string[] = [];
    while (dir && dir !== dirname(dir) && dir.startsWith(home) && dir !== home) {
      for (const n of ["AGENTS.md", "CLAUDE.md"]) add(join(dir, n), `프로젝트 · ${basename(dir)}`);
      seen.push(dir);
      dir = dirname(dir);
    }
    const cwd = ctxRef?.cwd ?? process.cwd();
    if (cwd !== home && !out.some((f) => dirname(String(f.path)) === cwd)) add(join(cwd, "AGENTS.md"), `프로젝트 · ${basename(cwd)}`, true);
    return out;
  };
  let reloadAfterWork = false;

  const handleCommand = async (o: any, sock?: Socket) => {
    if (o?.cmd === "set-model") {
      // 폰 모델 메뉴: 맥 입력창에 /model 을 치지 않고 pi 에 바로 설정(범위 밖 모델도, 맥 입력창에 글이 있어도)
      const m = ctxRef?.modelRegistry?.find?.(String(o.provider ?? ""), String(o.id ?? ""));
      const ok = m ? await pi.setModel(m) : false;
      if (!ok) sock?.write(`${JSON.stringify({ t: "notice", text: `모델을 바꾸지 못했어요(${o.provider}/${o.id})` })}\n`);
      return;
    }
    if (o?.cmd === "set-thinking") {
      pi.setThinkingLevel(String(o.level ?? "") as any);
      return;
    }
    if (o?.cmd === "bg-result") {
      // 이 탭이 시킨 백그라운드 일이 끝남: 대화에 결과 요약(AI 가 시킨 것이면 AI 가 이어서 처리)
      const head = `백그라운드 작업 '${String(o.name ?? "")}'(탭 ${o.window})이 ${o.ok === false ? "멈췄어요" : "끝났어요"}.`;
      const body = String(o.text ?? "").trim();
      try {
        pi.sendMessage(
          { customType: "bgtab-result", content: body ? `${head}\n\n결과 요약:\n${body}` : head, display: true, details: { name: o.name, window: o.window, by: o.by, ok: o.ok !== false } } as any,
          { triggerTurn: o.by === "ai", deliverAs: "followUp" } as any,
        );
      } catch {
        /* 넣지 못하면 알림만 */
      }
      broadcast({ t: "notice", text: head });
      return;
    }
    if (o?.cmd === "set-perm-mode") {
      // 권한 모드(send-guard 가 받아 바꿈. 맥 입력창을 거치지 않아 쓰던 글이 있거나 작업 중이어도 됨)
      pi.events.emit("perm-mode:set", { mode: String(o.mode ?? "") });
      return;
    }
    if (o?.cmd === "memory-list") {
      sock?.write(`${JSON.stringify({ t: "memory", memory: memoryFiles() })}\n`);
      return;
    }
    if (o?.cmd === "memory-save") {
      // 목록에 있는 파일만 저장(공통 지침·작업 폴더 위쪽의 AGENTS.md·CLAUDE.md)
      const path = String(o.path ?? "");
      const f = memoryFiles().find((x) => x.path === path);
      if (!f) {
        sock?.write(`${JSON.stringify({ t: "memory-saved", path, error: "저장할 수 있는 지침 파일이 아니에요" })}\n`);
        return;
      }
      try {
        writeFileSync(path, String(o.content ?? ""));
      } catch (e: any) {
        sock?.write(`${JSON.stringify({ t: "memory-saved", path, error: `저장하지 못했어요(${e?.message ?? e})` })}\n`);
        return;
      }
      sock?.write(`${JSON.stringify({ t: "memory-saved", path })}\n`);
      // 지침은 다시 불러와야 적용: 쉬는 중이면 바로, 작업 중이면 끝난 뒤
      if (working) {
        reloadAfterWork = true;
        broadcast({ t: "notice", text: "저장했어요. 지금 작업이 끝나면 다시 불러와 적용해요" });
      } else {
        broadcast({ t: "notice", text: "저장했어요. 다시 불러와 적용해요" });
        pi.sendUserMessage("/pi-remote-reload", { expandPromptTemplates: true });
      }
      return;
    }
    if (o?.cmd === "rewind") {
      // 폰에서 고른 내 메시지 직전으로 되감기(글은 폰 입력창으로)
      if (working) {
        sock?.write(`${JSON.stringify({ t: "notice", text: "작업이 끝난 뒤에 되감을 수 있어요" })}\n`);
        return;
      }
      const want = String(o.id ?? "");
      const text = String(o.text ?? "").trim();
      let target: any = null;
      try {
        const branch = ctxRef?.sessionManager?.getBranch?.() ?? [];
        target = branch.find((e: any) => e?.id === want && e.message?.role === "user");
        if (!target && text) {
          for (let i = branch.length - 1; i >= 0 && !target; i--) {
            const e = branch[i];
            if (e?.type === "message" && e.message?.role === "user" && textOf(e.message.content).trim() === text) target = e;
          }
        }
      } catch {
        /* 못 찾음 */
      }
      if (!target) {
        sock?.write(`${JSON.stringify({ t: "notice", text: "되감을 메시지를 찾지 못했어요" })}\n`);
        return;
      }
      sock?.write(`${JSON.stringify({ t: "rewound", text: textOf(target.message.content) })}\n`);
      pi.sendUserMessage(`/pi-remote-rewind ${target.id}`, { expandPromptTemplates: true });
      return;
    }
    if (o?.cmd === "artifact") {
      // 아티팩트 내용은 요청한 폰에만
      const path = String(o.path ?? "");
      sock?.write(`${JSON.stringify({ t: "artifact", path, ...artifactData(path, o.offset) })}\n`);
      return;
    }
    if (o?.cmd === "question-answer") {
      const answers = Array.isArray(o.answers) ? o.answers.map(String) : [];
      const p = prompts.get(String(o.id ?? ""));
      if (p) return answerPrompt(p, answers, String(o.other ?? ""), o.cancel === true);   // pi 확인 창
      // 폰 질문 카드에서 고른 답
      pi.events.emit("pi-remote:question-response", {
        id: String(o.id ?? ""),
        answers: Array.isArray(o.answers) ? o.answers.map(String) : [],
        other: String(o.other ?? ""),
        ...(Array.isArray(o.items) ? { items: o.items } : {}),
      });
      return;
    }
    if (o?.cmd === "approval") {
      // 폰에서 누른 허용·거부
      pi.events.emit("pi-remote:approval-response", { id: String(o.id ?? ""), approved: o.approved === true });
      return;
    }
    if (o?.cmd === "compact") {
      // 폰의 '지금 압축하기'. 맥 입력창을 거치지 않고 pi 에 직접 요청(쓰다 만 글과 섞이지 않게)
      const idle = ctxRef?.isIdle?.() ?? !working;
      if (!ctxRef || !idle || compacting) {
        sock?.write(`${JSON.stringify({ t: "notice", text: "작업 중에는 압축할 수 없어요" })}\n`);
        return;
      }
      try {
        ctxRef.compact({
          onError: (err: any) => {
            setCompacting(false);
            failNotice(String(err?.message ?? err ?? ""));
          },
        });
      } catch (err: any) {
        failNotice(String(err?.message ?? err ?? ""));
      }
      return;
    }
    if (o?.cmd === "toolimage") {
      // 읽은 사진은 요청한 폰에만
      sock?.write(`${JSON.stringify({ t: "toolimage", id: String(o.id ?? ""), ...toolImage(String(o.id ?? "")) })}\n`);
      return;
    }
    if (o?.cmd === "files") {
      // 폰 입력창의 '@' 파일 찾기: 맥 pi 입력창의 '@'와 같은 부품·같은 fd 로(결과가 맥과 같게), 요청한 폰에만
      const query = String(o.query ?? "").slice(0, 200);
      const text = `@${query}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const reply = (files: Json[], error?: string) =>
        sock?.write(`${JSON.stringify({ t: "files", query, files, ...(error ? { error } : {}) })}\n`);
      new CombinedAutocompleteProvider([], ctxRef?.cwd ?? process.cwd(), findFd())
        .getSuggestions([text], 0, text.length, { signal: ac.signal })
        .then((r: any) =>
          reply((r?.items ?? []).slice(0, 30).map((i: any) => ({ value: i.value, label: i.label, path: i.description ?? i.label }))),
        )
        .catch(() => reply([], "파일을 찾지 못했어요"))
        .finally(() => clearTimeout(timer));
      return;
    }
    if (o?.cmd === "detail") {
      // 상세는 요청한 폰에만
      const d = findDetail(o);
      sock?.write(`${JSON.stringify({ t: "detail", detail: { key: String(o.key ?? ""), ...d } })}\n`);
      return;
    }
    if (o?.cmd !== "send" || typeof o.text !== "string") return;
    touch();
    const images = (Array.isArray(o.images) ? o.images : []).map(imageBlock).filter(Boolean) as Json[];
    const content: any = images.length ? [{ type: "text", text: o.text }, ...images] : o.text;
    const idle = () => ctxRef?.isIdle?.() ?? !working;
    try {
      if (idle()) {
        pi.sendUserMessage(content);
      } else if (o.mode === "interrupt" || (o.mode === "auto" && runningTools === 0)) {
        // 지금 작업을 멈추고, 멈추면 바로 보낸다(15초 안에 안 멈추면 바로 반영으로)
        ctxRef?.abort?.();
        for (let n = 0; n < 150 && !idle(); n++) await sleep(100);
        if (idle()) pi.sendUserMessage(content);
        else pi.sendUserMessage(content, { deliverAs: "steer" });
      } else {
        pi.sendUserMessage(content, { deliverAs: o.mode === "followUp" ? "followUp" : "steer" });
      }
    } catch (e: any) {
      broadcast({ t: "error", message: `보내기 실패: ${e?.message ?? e}` });
    }
  };

  // --- 어시스턴트 스트리밍: 너무 잦은 전송을 막으려고 최소 간격마다 최신 상태만 보낸다 ---
  let streamId = "";
  let pending: Json | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending) broadcast({ t: "upsert", message: pending });
    pending = null;
  };

  // --- 자동 다시 불러오기·재시작 ---
  const loadedStamp = extStamp();            // 이 확장이 불러와질 때의 파일 상태
  let lastActivity = Date.now();
  let restarting = false;
  const noticeFile = `${IMG_DIR}/notice-${pane.replace(/\W/g, "")}.txt`;
  let pendingNotice = "";                    // 재시작 뒤 폰에 보여줄 안내
  try {
    if (existsSync(noticeFile) && Date.now() - statSync(noticeFile).mtimeMs < 5 * 60_000) {
      pendingNotice = readFileSync(noticeFile, "utf8");
    }
    unlinkSync(noticeFile);
  } catch {
    /* 없으면 무시 */
  }
  const touch = () => {
    lastActivity = Date.now();
  };
  const editorText = (): string => {
    try {
      return String(ctxRef?.ui?.getEditorText?.() ?? "");
    } catch {
      return "";
    }
  };

  // 다시 불러오기는 명령 처리 중에만 가능 → 명령을 등록해 두고, 쉬고 있을 때 그 명령을 실행
  pi.registerCommand("pi-remote-rewind", {
    description: "pi-remote: 폰에서 고른 내 메시지 직전으로 되감기(내부용)",
    handler: async (args: string, ctx: any) => {
      try {
        const r = await ctx.navigateTree(String(args ?? "").trim(), { summarize: false });
        if (!r?.cancelled) ctx.ui?.setEditorText?.("");   // 글은 폰 입력창으로 보냈음
      } catch (e: any) {
        broadcast({ t: "notice", text: `되감지 못했어요: ${e?.message ?? e}` });
      }
    },
  });

  // 맥: 지침 파일 보기·고치기(고르면 편집기, 저장하면 다시 불러와 적용)
  pi.registerCommand("memory", {
    description: "메모리(지침 파일) 보기·고치기",
    handler: async (_args: string, ctx: any) => {
      ctxRef = ctx;
      const files = memoryFiles();
      const labels = files.map((f) => `${f.label} — ${f.path}`);
      const choice = await ctx.ui.select("어느 지침 파일을 고칠까요?", labels);
      const f = files[labels.indexOf(choice)];
      if (!f) return;
      const edited = await ctx.ui.editor(`${f.label} (${f.path})`, String(f.content ?? ""));
      if (edited === undefined || edited === f.content) return;
      writeFileSync(String(f.path), edited);
      ctx.ui.notify("저장했어요. 다시 불러와 적용해요", "info");
      await ctx.reload();
    },
  });

  pi.registerCommand("pi-remote-reload", {
    description: "pi-remote: 바뀐 확장 다시 불러오기(자동)",
    handler: async (_args: string, ctx: any) => {
      await ctx.reload();
    },
  });

  /** 같은 대화로 pi 다시 켜기. update: 새 버전 적용 / manual: 사용자가 /pi-remote-restart 로 요청 */
  const restartPi = (reason: "update" | "manual" = "update") => {
    restarting = true;
    const v = diskVersion();
    const msg = reason === "manual"
      ? "pi를 다시 켰어요"
      : v ? `pi를 새 버전(${v})으로 업데이트했어요` : "pi를 새 버전으로 업데이트했어요";
    try {
      mkdirSync(IMG_DIR, { recursive: true });
      writeFileSync(noticeFile, msg);
    } catch {
      /* 안내 실패는 무시 */
    }
    broadcast({ t: "notice", text: reason === "manual" ? "pi를 다시 켜요" : "pi 업데이트를 적용하려고 다시 시작해요" });
    // 지금 대화 파일을 정확히 지정해 다시 켠다(-c 는 '이 폴더의 마지막 대화'라 다른 대화를 이을 수 있음).
    // 대화 파일이 아직 없으면(메시지 없음) 새로 시작. 그 밖의 원래 실행 인자는 유지.
    const raw = process.argv.slice(2);
    const args: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i];
      if (a === "--session" || a === "-r" || a === "--resume") { i++; continue; }
      if (a === "-c" || a === "--continue") continue;
      args.push(a);
    }
    let file = "";
    try {
      file = String(ctxRef?.sessionManager?.getSessionFile?.() ?? "");
    } catch {
      /* 모르면 새로 시작 */
    }
    if (file && existsSync(file)) args.push("--session", file);
    const q = (x: string) => `'${x.replace(/'/g, "'\\''")}'`;
    const cmd = [process.execPath, process.argv[1], ...args].map(q).join(" ");
    const shell = process.env.SHELL || "/bin/zsh";
    // 새 pi 의 PATH 는 평소 터미널과 같게: tmux 기본 환경으로 켜면 python3·node 가 다른 것으로 잡힘.
    // 화면 없이 로그인·대화형 셸을 잠깐 돌려 PATH 를 얻는다(화면이 없으면 oh-my-zsh 업데이트 질문도 안 뜸).
    // ~/.local/bin/pi 실행 스크립트처럼 지금 pi 를 돌리는 Node 폴더를 맨 앞에 둔다. 실패하면 지금 PATH 그대로.
    let userPath = "";
    try {
      userPath = execFileSync(shell, ["-lic", "print -r -- $PATH"], {
        encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"],
      }).trim().split("\n").pop() ?? "";
    } catch {
      /* 못 얻으면 아래에서 지금 PATH */
    }
    const basePath = userPath.includes("/") ? userPath : (process.env.PATH ?? "");
    const newPath = `${dirname(process.execPath)}:${basePath}`;
    setTimeout(() => {
      // 이 pi 를 끝내고 같은 창에서 새 pi 를 켠다(분리된 프로세스라 pi 가 꺼져도 계속 진행)
      // tmux 는 이 명령을 `zsh -c` 로 돌리고 zsh 는 먼저 ~/.zshenv 를 읽어 PATH 를 바꾼다 → 그 뒤에 PATH 를 지정
      const child = spawn("tmux", ["respawn-pane", "-k", "-t", pane, "-c", process.cwd(), `export PATH=${q(newPath)}; ${cmd}; exec ${shell} -l`], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }, 1500);
  };

  // 같은 대화로 pi 다시 켜기(환경을 평소 터미널과 같게 바로잡거나 업데이트를 바로 적용할 때)
  pi.registerCommand("pi-remote-restart", {
    description: "pi 다시 켜기(같은 대화로 이어짐)",
    handler: async (_args: string, ctx: any) => {
      ctxRef = ctx;
      if (!(ctx?.isIdle?.() ?? !working)) {
        ctx?.ui?.notify?.("작업이 끝난 뒤에 다시 켤 수 있어요", "warning");
        broadcast({ t: "notice", text: "작업이 끝난 뒤에 다시 켤 수 있어요" });
        return;
      }
      restartPi("manual");
    },
  });

  const autoTimer = setInterval(() => {
    if (restarting || working || !ctxRef) return;
    if (editorText().trim()) return;          // 맥 입력창에 쓰던 글이 있으면 건드리지 않음
    const idle = Date.now() - lastActivity;
    if (idle >= RESTART_IDLE_MS && coreUpdatedSinceStart()) {
      restartPi();
    } else if (idle >= RELOAD_IDLE_MS && extStamp() > loadedStamp + 1) {
      touch();                                // 한 번만 시도(다시 불러오면 새 타이머로 바뀜)
      broadcast({ t: "notice", text: "확장이 바뀌어 다시 불러와요" });
      pi.sendUserMessage("/pi-remote-reload", { expandPromptTemplates: true });
    }
  }, Number(process.env.PI_REMOTE_AUTO_TICK_SEC ?? 20) * 1000);
  (autoTimer as any).unref?.();

  // 백그라운드 탭의 모델·생각 깊이(사용자 결정 11-16): 이 탭의 모델·생각 깊이를 탭 옵션에 적어 시킨 탭과 앱 서랍이 읽게 하고,
  // 이 탭이 맡긴 백그라운드 탭은 다른 위젯과 같은 자리에 한 줄로 보인다. 함수는 Claude Code 연결부와 같이 쓰는 bg-launch.mjs(bgtab.ts 와 같은 자리)
  const BG_LIB = [process.env.PI_BG_LAUNCH, `${process.env.HOME}/.claude/pi-remote/bg-launch.mjs`, fileURLToPath(new URL("./lib/bg-launch.mjs", import.meta.url))]
    .find((p) => p && existsSync(p));
  let bgLib: any = null;
  const loadBgLib = async () => (bgLib ??= BG_LIB ? await import(BG_LIB).catch(() => ({})) : {});
  const writeAiOpts = async (modelId: unknown, level: unknown) => {
    const lib = await loadBgLib();
    const id = String(modelId ?? "");
    const model = id && typeof lib.prettyModel === "function" ? lib.prettyModel(id) : id;
    for (const [k, v] of [["@ai_model", model], ["@ai_thinking", String(level ?? "")]]) {
      try {
        execFileSync("tmux", v ? ["set-option", "-w", "-t", pane, k, v] : ["set-option", "-w", "-u", "-t", pane, k], { timeout: 3000 });
      } catch {
        /* 적지 못해도 동작은 그대로 */
      }
    }
  };
  let bgWidget = "";
  const bgWidgetTimer = setInterval(async () => {
    const lib = await loadBgLib();
    if (!ctxRef?.hasUI || typeof lib.bgLine !== "function") return;
    const line = lib.bgLine({ tabs: lib.bgTabsFrom(pane) });
    if (line === bgWidget) return;
    bgWidget = line;
    ctxRef.ui.setWidget("bg-tabs", line ? [` ${line}`] : undefined);
  }, Number(process.env.PI_REMOTE_JOBS_TICK_MS ?? 5000));
  (bgWidgetTimer as any).unref?.();

  pi.on("session_start", async (_e, ctx: any) => {
    ctxRef = ctx;
    wrapUI(ctx);
    touch();
    writeOpen(ctx);
    start();
    broadcast(snapshot());
    broadcast(commandList());
    await writeAiOpts(ctx?.model?.id, pi.getThinkingLevel());
  });
  pi.on("session_shutdown", async () => {
    unwrapUI();
    clearOpen();
    clearInterval(autoTimer);
    clearInterval(bgWidgetTimer);
    await writeAiOpts("", "");   // 끝나면 이 탭에 셸만 남으므로 지움
    flush();
    stop();
  });
  // 압축(자동·수동 모두): 시작하면 폰에 '압축하는 중', 끝나면 요약이 들어간 대화와 줄어든 사용량
  pi.on("session_before_compact", async () => {
    setCompacting(true);
    return undefined;   // 압축 내용은 pi 에 맡김
  });
  pi.on("session_compact", async (_e, ctx) => {
    ctxRef = ctx;
    setCompacting(false);
    broadcast(snapshot());
    broadcast({ t: "notice", text: "대화를 압축했어요" });
  });
  pi.on("session_compact_failed", async (e: any) => {
    setCompacting(false);
    failNotice(e?.errorMessage, e?.aborted);
  });
  pi.on("model_select", async (e: any, ctx) => {
    ctxRef = ctx;
    sendContext();   // 모델이 바뀌면 기억 용량도 바뀜
    await writeAiOpts(e?.model?.id, pi.getThinkingLevel());
  });
  pi.on("thinking_level_select", async (e: any, ctx) => {
    ctxRef = ctx;
    await writeAiOpts((ctx as any)?.model?.id, e?.level);
  });
  pi.on("session_tree", async (_e, ctx) => {
    ctxRef = ctx;
    broadcast(snapshot());
  });

  // 명령 첫 줄에 한국어 한 줄 설명 주석을 달게 한다(폰에서 진행 설명으로 보임). Claude Code 의 명령 설명 칸과 같은 역할.
  const DESC_RULE =
    "When using the bash tool, make the first line of the command a short Korean comment that says what it does, " +
    "for example `# 확장 설치본 갱신`. The pi-remote phone app shows this line as the progress description.";
  pi.on("before_agent_start", async (event: any) => {
    const g = event?.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(g) && !g.includes(DESC_RULE)) g.push(DESC_RULE);
  });

  pi.on("agent_start", async (_e, ctx) => {
    ctxRef = ctx;
    wrapUI(ctx);
    touch();
    working = true;
    workSince = Date.now();
    liveBegin(workSince);
    broadcast({ t: "working", value: true, since: workSince });
  });
  pi.on("agent_settled", async (_e, ctx) => {
    if (reloadAfterWork) {
      // 작업 중에 고친 지침(메모리)을 이제 적용
      reloadAfterWork = false;
      setTimeout(() => pi.sendUserMessage("/pi-remote-reload", { expandPromptTemplates: true }), 500);
    }
    ctxRef = ctx;
    touch();
    const startedAt = workSince; // 끝 알림에 걸린 시간을 실으려고 지우기 전에 잡아 둠
    working = false;
    workSince = 0;
    runningTools = 0;
    flush();
    // 작업이 끝났는데 남은 대기 메시지는 중지 등으로 pi 입력창에 되돌아간 것 → 비움
    if (queue.length) {
      queue = [];
      sendQueue();
    }
    broadcast({ t: "working", value: false });
    sendContext();
    notifySettled(startedAt);
  });

  // 작업 중에 들어온 입력(맥에서 친 것·폰에서 보낸 것 모두) → 대기열에 올려 폰에 바로 보여준다
  pi.on("input", async (e: any) => {
    touch();   // 입력이 들어온 순간도 활동(작업 시작 직전에 재시작하지 않게)
    if (e.streamingBehavior === "steer" || e.streamingBehavior === "followUp") {
      queue.push({ id: `q-${++seq}`, text: String(e.text ?? ""), kind: e.streamingBehavior });
      sendQueue();
    }
    return { action: "continue" };
  });

  pi.on("message_start", async (e: any) => {
    touch();
    if (e.message?.role === "assistant") {
      flush();
      streamId = `live-${++seq}`;
    }
  });
  pi.on("message_update", async (e: any) => {
    rememberLive(e.message);
    if (!streamId) streamId = `live-${++seq}`;
    pending = normalize(e.message, streamId);
    if (!timer) timer = setTimeout(flush, STREAM_INTERVAL_MS);
  });
  pi.on("message_end", async (e: any) => {
    const m = e.message;
    rememberLive(m);
    if (m?.role === "assistant") {
      pending = normalize(m, streamId || `live-${++seq}`);
      flush();
      streamId = "";
      sendContext();   // 답이 끝날 때마다 사용량이 새로 계산됨
      return;
    }
    const n = normalize(m, `live-${++seq}`);
    if (n) broadcast({ t: "upsert", message: n });
    // 대기 중이던 메시지가 실제로 대화에 들어갔으면 대기열에서 뺀다
    if (m?.role === "user" && queue.length) {
      const text = String(n?.text ?? "").trim();
      const i = queue.findIndex((q) => text.includes(q.text.trim()));
      if (i >= 0) {
        queue.splice(i, 1);
        sendQueue();
      }
    }
  });

  // `!` 명령은 메시지 이벤트 없이 기록에만 붙는다 → 실행이 끝나 기록에 붙는 순간을 잡아 보낸다.
  // (값을 반환하지 않으므로 실행을 가로채지 않음)
  pi.on("user_bash", async (_e, ctx: any) => {
    ctxRef = ctx;
    const before = ctx.sessionManager.getLeafId();
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      const leaf = ctxRef?.sessionManager?.getLeafEntry?.();
      if (leaf && leaf.id !== before && leaf.type === "message" && leaf.message?.role === "bashExecution") {
        clearInterval(poll);
        const n = normalize(leaf.message, leaf.id);
        if (n) broadcast({ t: "upsert", message: n });
      } else if (tries > 600) {
        clearInterval(poll); // 5분 넘게 안 끝나면 포기(다음 접속 때 기록으로 보임)
      }
    }, 500);
  });

  pi.on("message_update", async (e: any) => {
    const t = e?.assistantMessageEvent?.type;
    if (t === "thinking_start") liveSet("working", "🤔 생각 중…");
    else if (t === "text_start") liveSet("working", "💬 답을 쓰는 중…");
  });
  pi.on("tool_execution_start", async (e: any) => {
    liveSet("working", `⏳ ${describe(e.toolName, e.args)}`);
    runningTools++;
    broadcast({ t: "tool", id: e.toolCallId, state: "running" });
  });
  // 할 일 목록(todos 확장의 todo_write): 바뀔 때마다 폰 입력창 위 칸으로
  pi.on("tool_execution_end", async (e: any) => {
    if (e?.toolName === "todo_write" && !e.isError && Array.isArray(e.result?.details?.todos)) broadcast({ t: "todos", todos: e.result.details.todos });
  });
  pi.on("tool_execution_end", async (e: any) => {
    runningTools = Math.max(0, runningTools - 1);
    broadcast({ t: "tool", id: e.toolCallId, state: e.isError ? "error" : "done" });
  });
}
