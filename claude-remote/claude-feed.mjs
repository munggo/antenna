#!/usr/bin/env node
/**
 * pi-remote: Claude Code 용 피드(탭마다 하나)
 *
 * pi 의 pi-remote-feed 확장과 같은 말(줄 단위 JSON)을 같은 소켓(~/.cache/pi-remote/feed/<칸>.sock)으로 해서
 * 브리지·폰 앱이 pi 탭과 똑같이 채팅 화면을 그린다.
 * - 채팅: Claude Code 대화 기록 파일(~/.claude/projects/…jsonl)을 따라 읽어 폰 메시지로 바꿈
 * - 상태·알림: Claude Code 훅(pi-remote-hook.mjs)이 보내는 이벤트로 작업 중·답을 기다림·끝남, tmux 탭 점, 폰 알림
 * - 폰 명령: 보내기·모델·생각 깊이·압축·새 대화는 맥 Claude Code 입력창에 붙여 넣음
 * 실행: node claude-feed.mjs <tmux 칸, 예: %12>  (훅이 처음 이벤트 때 띄움, Claude Code 가 끝나면 스스로 끝남)
 * 작성: 서문교
 */
import { createConnection, createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseAccount, desiredAccount, hasWorkToken } from "./claude-account.mjs";
import { bgInfo, bgLine, bgTabsFrom, prettyModel } from "./bg-launch.mjs";

// ── 코드의 판: 연결부를 고쳐 설치해도 돌던 것은 옛 코드로 남아, 탭마다 다른 판이 돌았다(2026-11) ──
// 설치된 파일들의 내용으로 만든 짧은 값. 연결부가 스스로 이 값을 다시 계산해, 바뀌었으면 쉬는 틈에 새 연결부에 자리를 넘긴다(runFeed 끝)
const SELF_PATH = fileURLToPath(import.meta.url);
const REV_FILES = ["claude-feed.mjs", "claude-account.mjs", "bg-launch.mjs"];   // 이 연결부가 읽어 들이는 파일
export function codeRev(dir = dirname(SELF_PATH)) {
  try {
    const h = createHash("sha1");
    for (const f of REV_FILES) {
      const p = join(dir, f);
      if (existsSync(p)) h.update(`${f}\n`).update(readFileSync(p));
    }
    return h.digest("hex").slice(0, 8);
  } catch {
    return "";
  }
}
/** 이 프로세스가 읽어 들인 판(시작할 때의 파일 내용) */
export const CODE_REV = codeRev();

export const FEED_VERSION = 3;
const MAX_MESSAGES = 300;
const MAX_TOOL_OUTPUT = 4000;
const BIG = 200_000;
/** Anthropic 앞단(Cloudflare)이 요청을 막았을 때의 API 오류 글 */
export const CLOUDFLARE_BLOCK = /\b403\b[\s\S]*Attention Required!?\s*\|\s*Cloudflare/i;
/** Claude Code 가 멈춤(Esc·승인 거부·질문 취소)을 사람 글처럼 남기는 줄: '[Request interrupted by user]', 도구 중이면 '… for tool use]' */
export const INTERRUPT_TEXT = /^\[Request interrupted by user[^\]]*\]$/;
export const CLOUDFLARE_NOTE = "⚠️ 로그인 문제가 아니에요. Anthropic 앞단(Cloudflare)이 이 맥에서 보낸 요청을 잠깐 막은 거예요. /login 하지 말고 몇 분 뒤 다시 보내 주세요. (로그인은 이 맥의 탭들이 같이 써서, 다른 계정으로 로그인하면 다른 탭까지 그 계정으로 바뀌어요)";
const HOME = process.env.HOME ?? "";
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? "tmux";
const QUESTION_END = /([?？]|까요|나요|습니까)[.!)\s"'」』]*$/;

const clip = (t, n) => (t.length > n ? `${t.slice(0, n)}\n…(${t.length - n}자 더)` : t);
const cut = (t, n = 70) => (t.length > n ? `${t.slice(0, n)}…` : t);
const base = (p) => String(p ?? "").split("/").pop() || String(p ?? "");
const lines = (t) => String(t ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

/** Claude Code 도구 이름 → 폰이 아는 이름(pi 와 같게: 단계 묶음 글·아이콘이 맞게) */
export const TOOL_NAMES = {
  Bash: "bash", Read: "read", Edit: "edit", MultiEdit: "edit", NotebookEdit: "edit", Write: "write",
  Grep: "grep", Glob: "find", LS: "ls", Task: "subagent", Agent: "subagent", TodoWrite: "todo_write",
  AskUserQuestion: "ask_user", WebFetch: "web", WebSearch: "web",
};

/** 폰에 보일 한 줄 설명 */
export function describeTool(name, input) {
  const i = input ?? {};
  switch (name) {
    case "Bash": return cut(String(i.description || lines(i.command)[0] || ""));
    case "Read": return `${base(i.file_path)} 읽기`;
    case "Edit": case "MultiEdit": return `${base(i.file_path)} 수정`;
    case "NotebookEdit": return `${base(i.notebook_path)} 수정`;
    case "Write": return `${base(i.file_path)} 작성`;
    case "Grep": return cut(`검색: ${i.pattern ?? ""}`);
    case "Glob": return cut(`찾기: ${i.pattern ?? ""}`);
    case "Task": case "Agent": return cut(String(i.description || "하위 에이전트"));
    case "TodoWrite": {
      const t = Array.isArray(i.todos) ? i.todos : [];
      const doing = t.find((x) => x?.status === "in_progress");
      return cut(`할 일 ${t.filter((x) => x?.status === "completed").length}/${t.length}${doing ? ` · 지금: ${doing.activeForm || doing.content}` : ""}`);
    }
    case "AskUserQuestion": {
      const q = Array.isArray(i.questions) ? i.questions : [];
      const f = lines(q[0]?.question ?? "질문")[0] ?? "질문";
      return cut(q.length > 1 ? `${f} 외 ${q.length - 1}개` : f);
    }
    case "WebFetch": return cut(`웹: ${i.url ?? ""}`);
    case "WebSearch": return cut(`웹 검색: ${i.query ?? ""}`);
    default: return String(name ?? "").startsWith("mcp__") ? String(name).split("__").slice(1).join(" · ") : String(name ?? "");
  }
}

/** 단계 줄의 짧은 인자 요약 */
export function summarizeTool(name, input) {
  const i = input ?? {};
  const v = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.url ?? i.query ?? i.description;
  if (v !== undefined) return cut(lines(v)[0] ?? "", 120);
  try {
    return cut(JSON.stringify(i), 120);
  } catch {
    return "";
  }
}

/** 메시지 내용(글자 또는 조각 목록)의 글 */
export function textOf(c) {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
}

/** Claude Code 가 사용자 칸에 남기는 꼬리표 정리: 슬래시 명령은 '/model opus' 로, 명령 출력·시스템 알림·작업 알림은 숨김 */
export function cleanUserText(t) {
  const s = String(t ?? "");
  const name = s.match(/<command-name>([^<]*)<\/command-name>/);
  if (name) {
    if (name[1].trim() === "/clear") return "";   // 대화를 비우는 명령은 새 대화의 첫 말풍선으로 남기지 않음
    const args = (s.match(/<command-args>([^<]*)<\/command-args>/) ?? [])[1] ?? "";
    return `${name[1].trim()}${args.trim() ? ` ${args.trim()}` : ""}`;
  }
  // task-notification: 뒤에서 돌린 명령·하위 에이전트가 끝났다는 알림(내가 보낸 글이 아님)
  if (/^\s*<(local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification)>/.test(s)) return "";
  // 붙여넣은 글은 Claude Code 가 '<pasted_content id="…"> … </pasted_content id="…">' 로 감싸 기록함(폰 메시지는 붙여넣기로 넣음) → 태그만 뗌
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/<\/?pasted_content(?:\s+id="[^"]*")?>/g, "").trim();
}

/** 'claude-opus-5-5' → 'Opus 5.5' (폰 칩·맥 하단 줄과 같은 이름) */
// ── 계정 전환 때 다시 켜는 명령의 옵션 ──
// Claude Code 2.1 옵션: 값이 꼭 있음(1개·여러 개), 값이 있어도 됨, 값 없음. 모르는 옵션이 있으면 다시 켜지 않음(원래 모양을 모름)
const OPT_ONE = new Set(["--agent", "--agents", "--append-system-prompt", "--autocompact", "--debug-file", "--effort", "--environment",
  "--fallback-model", "--input-format", "--json-schema", "--max-budget-usd", "--model", "-n", "--name", "--output-format", "--permission-mode",
  "--permission-prompts", "--plugin-dir", "--plugin-url", "--remote-control-session-name-prefix", "--session-id", "--setting-sources",
  "--settings", "--system-prompt", "--system-prompt-snapshot"]);
const OPT_MANY = new Set(["--add-dir", "--allowedTools", "--allowed-tools", "--betas", "--disallowedTools", "--disallowed-tools", "--file", "--mcp-config", "--tools"]);
const OPT_MAYBE = new Set(["--cloud", "-d", "--debug", "--from-pr", "--prompt-suggestions", "--remote-control", "-r", "--resume", "--teleport", "-w", "--worktree"]);
const OPT_FLAG = new Set(["--allow-dangerously-skip-permissions", "--ax-screen-reader", "--bg", "--background", "--bare", "--brief", "--chrome",
  "-c", "--continue", "--dangerously-skip-permissions", "--desktop", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections",
  "--fork-session", "--forward-subagent-text", "--ide", "--include-hook-events", "--include-partial-messages", "--no-chrome",
  "--no-session-persistence", "-p", "--print", "--replay-user-messages", "--restricted", "--safe-mode", "--strict-mcp-config", "--tmux", "--verbose"]);
// 다시 켤 때 빼는 것: 대화 고르기·한 번 실행·새 작업 폴더·백그라운드 등(권한 모드는 지금 모드로 다시 넣음)
const OPT_DROP = new Set(["-c", "--continue", "-r", "--resume", "--session-id", "--fork-session", "-p", "--print", "--from-pr", "--teleport",
  "--cloud", "--desktop", "--bg", "--background", "-w", "--worktree", "--permission-mode"]);
const CLI_MODE = { manual: "manual", acceptEdits: "acceptEdits", plan: "plan", auto: "auto", bypass: "bypassPermissions" };

/** 켤 때 쓴 명령(ps 의 args, 공백으로 나뉨) → 다시 켤 때 붙일 옵션 목록. 프롬프트 글·대화 고르기 옵션은 빼고 권한 모드는 mode 로.
 *  따옴표·중괄호·역슬래시가 있거나(원래 나눔을 모름) 모르는 옵션·하위 명령이 있으면 null */
export function relaunchArgs(argsStr, mode) {
  const tok = String(argsStr ?? "").trim().split(/\s+/).slice(1);
  if (tok.some((t) => /["'{}\\`$]/.test(t))) return null;
  const out = [];
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i];
    if (!t.startsWith("-")) {
      if (i === 0 && /^[a-z][a-z-]*$/.test(t) && !/\s/.test(t) && SUBCOMMANDS.has(t)) return null;   // claude mcp … 같은 하위 명령
      continue;   // 처음에 넘긴 프롬프트 글
    }
    const eq = t.indexOf("=");
    const name = eq > 0 ? t.slice(0, eq) : t;
    const keep = !OPT_DROP.has(name);
    const take = [t];
    if (eq < 0) {
      if (OPT_ONE.has(name)) {
        if (i + 1 >= tok.length) return null;
        take.push(tok[++i]);
      } else if (OPT_MANY.has(name)) {
        while (i + 1 < tok.length && !tok[i + 1].startsWith("-")) take.push(tok[++i]);
      } else if (OPT_MAYBE.has(name)) {
        if (i + 1 < tok.length && !tok[i + 1].startsWith("-")) take.push(tok[++i]);
      } else if (!OPT_FLAG.has(name)) {
        return null;   // 모르는 옵션
      }
    } else if (!OPT_ONE.has(name) && !OPT_MANY.has(name) && !OPT_MAYBE.has(name) && !OPT_FLAG.has(name)) {
      return null;
    }
    if (keep) out.push(...take);
  }
  if (CLI_MODE[mode]) out.push("--permission-mode", CLI_MODE[mode]);
  return out;
}
const SUBCOMMANDS = new Set(["mcp", "config", "doctor", "update", "install", "migrate-installer", "setup-token", "plugin", "agents", "auth", "remote-control", "ultrareview"]);

// ── 계정 전환 때 인수인계(사용자 결정 11-18) ──
// 같은 대화를 다른 계정으로 이어 켜면(--resume) 문제가 생겨, 대화를 비우고 새로 켠다. 그 전에 지금 세션이 인수인계 문서를 쓰고,
// 새 세션이 그 문서를 읽고 이어 간다
/** 지금 세션에 보낼 인수인계 요청(한 번에 붙여 넣음). pending: 멈추느라 답하지 못한 사용자 글(입력창에 되돌아온 것) */
export function handoffAsk(reason, pending = "") {
  const tail = pending
    ? ["", "사용자가 방금 보낸 요청이 있었는데, 답하기 전에 멈춰서 이 대화에 들어가지 않았을 수 있습니다. 문서의 '다음에 할 일' 맨 앞에 이 요청을 넣으세요:", pending]
    : [];
  return [
    `[계정 전환] ${reason} 곧 이 대화를 비우고 다른 계정으로 Claude Code 를 새로 켭니다. 새 세션은 이 대화를 모르고, 지금 쓰는 인수인계 문서만 보고 일을 이어받습니다.`,
    "하던 일은 여기서 멈추세요. 도구는 쓰지 말고 인수인계 문서 전문만 답으로 쓰세요(답이 그대로 파일로 저장됩니다). 첫 줄은 '# 인수인계' 로 시작하세요.",
    "넣을 것:",
    "- 사용자의 원래 요청과 목표, 사용자가 정한 결정·지시(되도록 사용자 말 그대로)",
    "- 지금까지 한 일: 바꾼 파일 경로, 실행한 명령과 결과, 커밋·푸시·보낸 메시지처럼 바깥에 남긴 일",
    "- 멈춘 지점: 하던 단계, 끝나지 않은 일, 아직 확인하지 않은 것",
    "- 다음에 할 일(순서대로)과 주의할 점",
    "- 사용자 답을 기다리던 중이었다면 그 질문과 선택지",
    ...tail,
  ].join("\n");
}
/** 저장할 문서: 받은 문서 끝에 답하지 못한 사용자 글을 그대로 덧붙임(모델이 빠뜨려도 새 세션이 보게) */
export function handoffWithPending(doc, pending = "") {
  if (!pending) return doc;
  return `${doc.trimEnd()}\n\n## 멈추느라 답하지 못한 사용자 요청(연결부가 덧붙임)\n\n${pending.trim()}\n`;
}
/** 답에서 인수인계 문서 꺼내기: 줄 맨 앞의 '# 인수인계' 부터 끝까지. 없으면(한도 오류 글 등) null */
export function handoffDoc(answer) {
  const s = String(answer ?? "");
  const i = s.search(/^# 인수인계/m);
  return i < 0 ? null : `${s.slice(i).trim()}\n`;
}
/** 새로 켠 세션에 넣을 글(한 줄). 문서를 못 받았으면 앞 대화 기록 파일을 읽게 함(사용자 결정 11-18) */
export function handoffResume({ reason, docPath, transcript }) {
  const head = `[계정 전환] ${reason} 앞 세션을 끝내고 이 계정으로 새로 켰습니다.`;
  const tail = "하던 일이 남았으면 이어서 하고, 사용자 답을 기다리던 중이었으면 무엇을 기다리는지 짧게 알리고 기다리세요.";
  if (docPath) return `${head} 앞 세션이 남긴 인수인계 문서 ${docPath} 를 먼저 읽으세요. ${tail}`;
  return `${head} 앞 세션이 인수인계 문서를 남기지 못했습니다. 앞 대화 기록 파일 ${transcript} (한 줄에 JSON 하나)을 끝에서부터 읽어 사용자의 요청과 하던 일을 파악하세요. ${tail}`;
}

/** 입력창 아래의 모드 줄('⏵⏵ auto mode on · 1 shell · ↓ to manage' 등) */
const MODE_LINE = /⏸ manual mode on|⏵⏵ accept edits on|⏸ plan mode on|⏵⏵ auto mode on|bypass permissions on|\? for shortcuts/;
const PANEL_ITEM = /^\s*[⏺◯○●◉]\s+(\S+)/;
const PANEL_MORE = /^\s*([↓↑])\s*(\d+)\s+more\b/;
/**
 * 모드 줄 아래에 붙는 하위 에이전트 목록(2.1.32x. 그 전 판은 모드 줄에 '· 2 local agents' 로 적었다):
 *     ⏵⏵ auto mode on · 1 shell · 2 feedback drafts
 *
 *     ⏺ main
 *     ◯ general-purpose  자료 찾는 중                    4s · ↓ 53.1k tokens
 *     ↓ 3 more
 * 뒤에서 도는 하위 에이전트가 있는 동안만 보이고(끝난 것은 빠짐) 다섯을 넘으면 '↓ N more' 로 접힌다. 입력창은 그대로 쓸 수 있다.
 * 화면 맨 아래에서부터 이런 줄이 이어지고 그 바로 위가 모드 줄일 때만 목록으로 본다(대화의 '⏺ 답' 줄과 헷갈리지 않게).
 * → { screen: 목록을 뗀 화면, agents: 목록의 에이전트 수 }. 수는 'main'(이 대화)을 빼고 아래로 접힌 'N more' 를 더한다.
 *   위로 접힌 것('↑ N more')은 이 대화가 섞였을 수 있어 세지 않는다. 목록이 없으면 화면 그대로·0
 * (11-17 사용자 보고 '에이전트 8개가 도는데 서랍에 백그라운드 작업이 안 보임': 모드 줄이 화면 맨 아래라고 보던 판정들이
 *  이 목록에 밀려 어긋났다. 서랍의 수·일하는 중·권한 모드·끄면 안 되는 것 판정이 모두 이 함수로 목록을 떼고 본다)
 */
export function agentPanel(screen) {
  const text = String(screen ?? "");
  const ls = text.split("\n");
  let i = ls.length - 1;
  let rows = 0;
  let agents = 0;
  for (; i >= 0; i--) {
    if (!ls[i].trim()) continue;
    const more = ls[i].match(PANEL_MORE);
    const item = more ? null : ls[i].match(PANEL_ITEM);
    if (!more && !item) break;
    rows++;
    if (more) agents += more[1] === "↓" ? Number(more[2]) : 0;
    else if (item[1] !== "main") agents++;
  }
  if (!rows || i < 0 || !MODE_LINE.test(ls[i])) return { screen: text, agents: 0 };
  return { screen: ls.slice(0, i + 1).join("\n"), agents };
}

/** Claude Code 가 일하는 중인지(화면 아래 12줄): 'esc to interrupt'(일부 모드의 모드 줄) 또는 진행 줄
 *  '✶ Whisking… (56m 34s · …)'. 끝나면 '✻ Sautéed for 7m 38s · done 8:36 PM' 처럼 바뀜. 자동 모드에 백그라운드 표시(⧉)가 있으면
 *  모드 줄에 'esc to interrupt' 가 없어서 진행 줄도 봄(사용자 보고 11-12).
 *  훅이 도는 동안에는 괄호가 시간 대신 '(running PostToolUse hooks… 1/2 · 8m 49s · …)' 로 시작하므로 괄호 안 어디든 시간이 있으면 진행 줄
 *  (11-14 사용자 보고 '처리 중인데 표시가 안 보임': 맥이 바빠 훅이 몇 초씩 걸리면 이 모양이 오래 남아 쉬는 중으로 잘못 봤다).
 *  모드 줄 아래 에이전트 목록은 떼고 본다(목록이 길면 진행 줄이 12줄 밖으로 밀림) */
export function screenBusy(screen) {
  const tail = agentPanel(screen).screen.split("\n").filter((l) => l.trim()).slice(-12).join("\n");
  return /esc to interrupt|[A-Za-z]+…\s*\([^)\n]*?\b(\d+h\s*)?(\d+m\s*)?\d+s\b/i.test(tail);
}

/** 대화를 압축하는 중인지(화면 아래 12줄, 에이전트 목록은 떼고): 진행 줄이 '✽ Compacting conversation… (12s · ↓ 1.0k tokens)' 꼴일 때.
 *  /compact·자동 압축 모두 이 줄이다(11-17 실제 Claude Code 2.1.326 으로 확인). 압축 중이면 그 줄에 적힌 경과 시간(초), 아니면 null.
 *  줄 맨 앞의 진행 표시 글자부터 봐서, 답이나 입력창에 그 문구가 적혀 있는 것(들여 쓰였거나 ⏺·❯·⎿ 로 시작)과 가린다.
 *  압축 직전 훅(PreCompact)으로 알지 않는 까닭: 그 훅은 뒤에서 요약을 미리 써 두기 시작할 때도 와서, 그때 화면은 평소처럼 일하는 중이다 */
export function compactingFor(screen) {
  for (const l of agentPanel(screen).screen.split("\n").filter((x) => x.trim()).slice(-12)) {
    const m = l.match(/^[^\s⏺❯⎿]\s+Compacting conversation…(?:\s*\((.*)|\s*$)/);
    if (!m) continue;
    const t = (m[1] ?? "").match(/(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s\b/);
    return t ? Number(t[1] ?? 0) * 3600 + Number(t[2] ?? 0) * 60 + Number(t[3]) : 0;
  }
  return null;
}

const MODES = [["manual", /⏸ manual mode on/], ["acceptEdits", /⏵⏵ accept edits on/], ["plan", /⏸ plan mode on/], ["auto", /⏵⏵ auto mode on/], ["bypass", /bypass permissions on/]];
/** 화면에 보이는 권한 모드(입력창 아래 모드 줄, 아래 4줄 안). 확인 창·안내 창에 가려 모드 줄이 안 보이면 null
 *  (그런 창이 떠 있으면 글을 넣거나 끄면 안 되므로, 쉬는 입력 상태인지 가릴 때도 쓴다). 에이전트 목록은 입력을 막지 않으니 떼고 본다 */
export function shownMode(screen) {
  const tail = agentPanel(screen).screen.split("\n").filter((l) => l.trim()).slice(-4).join("\n");
  for (const [k, re] of MODES) if (re.test(tail)) return k;
  return null;
}

/** 글자 하나가 터미널에서 차지하는 칸(대략): 한글·한자·가나·전각 글자와 그림 문자는 두 칸, 결합용 글자는 0 칸 */
function cellsOf(ch) {
  const c = ch.codePointAt(0);
  if (c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd) ? 2 : 1;
}
/** 화면 한 줄의 앞 n 칸. 모자라면 공백으로 채움(접힌 줄은 끝까지 차 있으므로, 화면을 읽을 때 잘린 끝 공백은 원래 글의 공백) */
function firstCells(line, n) {
  let out = "";
  let w = 0;
  for (const ch of line) {
    const k = cellsOf(ch);
    if (w + k > n) break;
    out += ch;
    w += k;
  }
  return out + " ".repeat(Math.max(0, n - w));
}

/** 셸에 친 명령이 커서 바로 앞에 그대로 들어갔는지. screen 은 다듬지 않은 화면(한 줄이 창의 한 줄), cursor 는 {x, y, width}.
 *  오른쪽 프롬프트('✔ 1m 33s ▼ 14:42:17' 같은 것)나 자동 제안은 커서 뒤라 상관없고, 창보다 길어 여러 줄로 접혀도
 *  커서에서 거꾸로 이어 붙여 본다. 첫 글자가 빠졌거나 앞에 다른 글자가 붙었으면 아님.
 *  (11-15 사용자 보고 '계정 전환 실패가 자꾸 옴': 줄 끝으로 견줘 오른쪽 프롬프트가 있는 셸에서 매번 실패하고 Claude Code 만
 *   꺼진 채 남았다. 또 tmux 의 줄 잇기(-J)는 zsh 가 접은 줄의 첫 이음새만 이어, 좁은 창에서 세 줄 넘게 접히면 늘 실패했다) */
export function typedOnPrompt(screen, cmd, cursor) {
  const rows = String(screen ?? "").split("\n");
  const { x, y, width } = cursor ?? {};
  if (!cmd || !(width > 0) || !(y >= 0 && y < rows.length) || !(x >= 0 && x <= width)) return false;
  let s = firstCells(rows[y], x);
  for (let r = y - 1; r >= 0 && s.length <= cmd.length; r--) s = firstCells(rows[r], width) + s;
  if (!s.endsWith(cmd)) return false;
  const before = s[s.length - cmd.length - 1];
  return before === undefined || /\s/.test(before);
}

/** 입력창 위쪽 화면(대화·진행 줄). 바로잡기가 '화면이 움직이는지' 볼 때 쓴다: 일하는 동안에는 진행 줄의 시간·스피너가 바뀌고,
 *  쉬는 동안에는 그대로다. 입력창·상태 줄·모드 줄은 쉬는 동안에도 바뀔 수 있어(맥에서 글을 침, 다른 탭의 사용량) 뺀다.
 *  입력창 테두리(─ 줄 둘)를 못 찾으면 null */
export function aboveInput(screen) {
  const ls = String(screen ?? "").split("\n");
  let seen = 0;
  for (let i = ls.length - 1; i >= 0; i--) {
    if (/^─{20,}/.test(ls[i].trim()) && ++seen === 2) return ls.slice(0, i).join("\n");
  }
  return null;
}

/**
 * 그냥 끄면 안 되는 것의 화면 표시: 맨 아래 두 줄(상태 줄·모드 줄)의 '· 1 shell', '· 1 feedback draft' 같은 것.
 * 뒤에서 도는 셸은 Claude Code 를 끄면 같이 죽고, 보내지 않은 피드백 초안은 /exit 가 묻는 화면에서 멈춘다.
 * 모드 줄 아래에 에이전트 목록이 붙어 있으면 떼고 그 위 두 줄을 보며, 목록의 하위 에이전트도 끄면 같이 죽으므로 '2 agents' 로 알린다.
 * 자동 다시 켜기(deploy/claude-reload.py 의 screen_background)와 같은 규칙. 있으면 그 글, 없으면 null
 */
export function backgroundShown(screen) {
  const panel = agentPanel(screen);
  for (const l of panel.screen.split("\n").filter((x) => x.trim()).slice(-2)) {
    const m = l.match(/·\s*(\d+\s+[A-Za-z]+(?:\s+drafts?)?)/);
    if (m) return m[1];
  }
  return panel.agents ? `${panel.agents} agent${panel.agents > 1 ? "s" : ""}` : null;
}

/**
 * 뒤에서 도는 일(앱 서랍 표시용): 모드 줄의 '· 1 shell', '· 2 agents' 같은 것을 '셸 1개', '에이전트 2개'로.
 * 모드 줄('⏵⏵ auto mode on · 1 shell · ↓ to manage')은 아래 15줄 안의 마지막 것을 찾는다. 응답이 끝나면 Claude Code 가
 * 그 아래에 안내 창('Teach auto mode about your environment?')을 띄우기도 해서 맨 아래 두 줄만 보면 놓친다(11-14 시험에서 확인).
 * 모드 줄을 못 찾으면 맨 아래 두 줄을 본다.
 * 아는 종류만 센다: 보내지 않은 피드백 초안('· 1 feedback draft')이나 '· 1 MCP server failed' 같은 안내는 도는 일이 아니다.
 * 하위 에이전트는 2.1.32x 부터 모드 줄에 수를 적지 않고 그 아래 목록으로만 보이므로(agentPanel) 목록에서 센 수를 쓴다.
 * 여럿이면 ' · '로 잇고, 없으면 빈 글
 */
const JOB_KINDS = { shell: "셸", bash: "셸", agent: "에이전트", task: "작업", job: "작업", monitor: "감시", process: "프로세스" };
const jobsText = (counts) => [...counts].filter(([, n]) => n > 0).map(([kind, n]) => `${kind} ${n}개`).join(" · ");
export function backgroundJobs(screen) {
  const panel = agentPanel(screen);
  const ls = panel.screen.split("\n").filter((x) => x.trim());
  const mode = ls.slice(-15).findLast((l) => MODE_LINE.test(l));
  const counts = new Map();
  for (const l of mode ? [mode] : ls.slice(-2)) {
    for (const m of l.matchAll(/·\s*(\d+)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/g)) {
      const word = m[2].trim().split(/\s+/).pop().toLowerCase();   // 'local agents' 처럼 두 낱말이면 뒤 낱말
      const kind = JOB_KINDS[word] ?? JOB_KINDS[word.replace(/s$/, "")] ?? JOB_KINDS[word.replace(/es$/, "")];
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + Number(m[1]));
    }
  }
  if (panel.agents > (counts.get("에이전트") ?? 0)) counts.set("에이전트", panel.agents);
  return jobsText(counts);
}

/**
 * 화면에서 센 것(backgroundJobs)에 대화 기록으로 아는 수({ 에이전트: 8, 감시: 1 })를 합친다: 종류마다 큰 쪽.
 * 화면 표시는 Claude Code 판마다 바뀌어 놓칠 수 있고(11-17: 에이전트 수가 모드 줄에서 사라져 서랍에 안 보임),
 * 대화 기록은 맥 화면의 '백그라운드:' 줄과 앱의 작업 목록이 이미 쓰는 값이라 서랍의 수도 그 둘과 어긋나지 않게 한다
 */
export function mergeJobs(shown, known = {}) {
  const counts = new Map();
  for (const m of String(shown ?? "").matchAll(/(\S+) (\d+)개/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + Number(m[2]));
  for (const [kind, n] of Object.entries(known ?? {})) if (Number(n) > (counts.get(kind) ?? 0)) counts.set(kind, Number(n));
  return jobsText(counts);
}

/**
 * 훅 없이 묻는 Claude Code 창(11-15 사용자 보고: /exit 했더니 '보내지 않은 피드백 초안' 창이 맥에서 기다렸는데 폰은 몰랐다).
 * 피드백 초안 종료 안내·초안 목록, /export 같은 명령 창은 훅도 대화 기록도 남기지 않아 화면으로만 알 수 있다.
 * 이런 창은 맨 아래가 키 안내('Enter to review · d to discard · Esc to close')이고, 그 위 테두리(▔ 또는 ─ 줄)까지가 창이다.
 * 폰으로 볼 때(창 폭 50칸)는 키 안내가 두 줄로 접히고('… Esc to' / 'close'), ▔ 테두리는 다른 알림 글에 덮여 ▔ 하나만 남기도 한다.
 * 테두리가 화면 밖으로 밀린 긴 창은 화면 맨 위까지를 창으로 본다.
 * 입력창 밑에 뜬 안내(테두리 바로 위가 입력 줄이거나 모드 줄이 끼어 있음)는 쓰던 글을 막지 않으므로 창으로 보지 않는다.
 * 창이면 {title, lines, guide, guideLine, items, focus, sig}, 아니면 null
 */
const GUIDE_KEY = /^(?:(?:ctrl|shift|alt|opt|option|cmd|meta)\+\S+|enter|return|esc|escape|tab|space|backspace|↑\/↓|←\/→|[↑↓←→]|[a-z0-9?])$/i;
/** 키 안내 줄 'Enter to review · d to discard' → [{key, action}]. 한 조각이라도 '키 to 동작'이 아니면 null */
export function parseGuide(line) {
  const out = [];
  for (const p of String(line ?? "").trim().split(/\s+·\s+/)) {
    const m = p.match(/^(\S+) to (\S.*)$/);
    if (!m || !GUIDE_KEY.test(m[1])) return null;
    out.push({ key: m[1], action: m[2].trim() });
  }
  return out.length ? out : null;
}
const NUM_ITEM = /^(\s*(?:❯\s*)?)(\d+)\.\s+(.+)$/;
export function screenDialog(screen) {
  const ls = String(screen ?? "").split("\n").map((l) => l.replace(/\s+$/, ""));
  let end = ls.length - 1;
  while (end >= 0 && !ls[end].trim()) end--;
  // 키 안내: 맨 아래부터 빈 줄 전까지 최대 4줄을 이어 붙여 키 안내로 읽히는 가장 긴 것
  // (접힌 뒷줄 'Esc to later' 만 읽고 앞줄의 키를 놓치지 않게)
  let guide = null;
  let gStart = -1;
  for (let k = end; k >= 0 && k > end - 4 && ls[k].trim(); k--) {
    const g = parseGuide(ls.slice(k, end + 1).map((l) => l.trim()).join(" "));
    if (g) [guide, gStart] = [g, k];
  }
  if (!guide) return null;
  // 창의 위 끝: 테두리(▔ 가 든 줄·─ 줄)를 먼저 찾고, 테두리 없이 그려진 창(종료 안내는 그때그때 테두리가 없기도 함)은
  // 지난 대화 줄(맨 앞 칸의 '❯ /exit'·'● 답'. 창 안 번호 고르기 '❯ 1.'은 아님)이나 빈 줄 둘에서 끊는다
  let top = -1;
  for (let i = gStart - 1; i >= 0 && top < 0; i--) {
    if (/▔/.test(ls[i]) || /^\s*─{10,}/.test(ls[i]) || /^[❯●](?!\s*\d+\.\s)/.test(ls[i]) || (!ls[i].trim() && !(ls[i - 1] ?? "x").trim())) top = i;
  }
  if (top >= 0 && /^\s*─/.test(ls[top]) && /^❯/.test(ls[top - 1] ?? "")) return null;   // 입력창 아래 테두리
  const block = ls.slice(top + 1, gStart);   // 빈 줄 포함(접힌 줄 이어 붙이기는 빈 줄에서 멈춤)
  const lines = block.filter((l) => l.trim()).map((l) => l.trim());
  if (!lines.length || lines.some((l) => MODE_LINE.test(l))) return null;
  // 번호 고르기 창('❯ 1. Copy to clipboard  설명'): 1부터 차례인 번호만 선택지로(창 글 속 번호 목록과 헷갈리지 않게).
  // 접힌 뒷줄(번호 없이 더 깊게 들여 쓴 줄)은 설명 칸이 있으면 설명에, 없으면 이름에 이어 붙임
  let items = [];
  for (let i = 0; i < block.length; i++) {
    const m = block[i].match(NUM_ITEM);
    if (!m) continue;
    const [first, ...rest] = m[3].split(/\s{2,}/);
    let label = first.trim();
    let desc = rest.join(" ").trim();
    const indent = block[i].search(/\S/);
    while (i + 1 < block.length && block[i + 1].trim() && !NUM_ITEM.test(block[i + 1]) && block[i + 1].search(/\S/) > indent + 2) {
      const more = block[++i].trim();
      if (desc) desc += ` ${more}`;
      else label += ` ${more}`;
    }
    items.push({ n: Number(m[2]), label, desc });
  }
  if (items.some((it, i) => it.n !== i + 1)) items = [];
  // 고른 줄(❯): 서명에는 이름 부분만(목록 줄 끝의 '1m' 같은 시간이 바뀌어도 같은 창)
  const focusLine = lines.find((l) => /^❯/.test(l));
  const focus = focusLine ? focusLine.replace(/^❯\s*/, "").split(/\s{2,}/)[0].trim() : "";
  const guideLine = ls.slice(gStart, end + 1).map((l) => l.trim()).join(" ");
  return { title: lines[0], lines, guide, guideLine, items, focus, sig: `${lines[0]}|${guideLine}|${focus}` };
}

/** 창 키 안내의 동작 → 한글(사전에 없으면 원문) */
const ACTION_KO = {
  "review & send": "검토하고 보내기", "discard and exit": "초안 버리고 종료", review: "검토", discard: "버리기", close: "닫기",
  send: "보내기", later: "나중에", cancel: "취소", select: "고르기", confirm: "확인", exit: "나가기", next: "다음", back: "뒤로",
  submit: "제출", continue: "계속", skip: "건너뛰기", retry: "다시 해 보기", toggle: "켜고 끄기", dismiss: "닫기",
  save: "저장", edit: "고치기", delete: "지우기", copy: "복사", open: "열기",
};
const DIALOG_TITLE_KO = [
  [/^You have (\d+) unsent feedback drafts?$/, (m) => `보내지 않은 피드백 초안이 ${m[1]}개 있어요`],
  [/^Feedback drafts$/, () => "피드백 초안"],
  [/^Export conversation$/, () => "대화 내보내기"],
];
/** 키 안내의 키 → tmux 로 누를 키({key} 는 키 이름, {text} 는 글자 그대로). 모르는 키(shift+enter 등)는 null */
function guideKey(k) {
  const named = { enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", "shift+tab": "BTab", space: "Space", backspace: "BSpace", "↑": "Up", "↓": "Down", "←": "Left", "→": "Right" };
  const l = k.toLowerCase();
  if (named[l]) return { key: named[l] };
  const mod = l.match(/^(ctrl|alt|opt|option|meta)\+([a-z])$/);
  if (mod) return { key: `${mod[1] === "ctrl" ? "C" : "M"}-${mod[2]}` };
  return k.length === 1 ? { text: k } : null;
}
/** 화면 창 → 폰 질문 카드: 제목·창 글과 선택지(번호 항목, 키 안내 하나하나), 선택지별로 누를 키(press: 라벨 → 키) */
export function dialogCard(d) {
  const tk = DIALOG_TITLE_KO.find(([re]) => re.test(d.title));
  const title = tk ? tk[1](d.title.match(tk[0])) : d.title;
  const options = [];
  const press = new Map();
  const add = (label, description, key) => {
    if (!key || press.has(label)) return;
    options.push({ label, description });
    press.set(label, key);
  };
  for (const it of d.items) add(`${it.n}. ${it.label}`, it.desc, { text: String(it.n) });
  for (const g of d.guide) {
    const ko = ACTION_KO[g.action.toLowerCase()];
    if (g.key === "↑/↓") {
      add("위로 (↑)", `${g.key} to ${g.action}`, guideKey("↑"));
      add("아래로 (↓)", `${g.key} to ${g.action}`, guideKey("↓"));
    } else if (g.key === "←/→") {
      add("왼쪽 (←)", `${g.key} to ${g.action}`, guideKey("←"));
      add("오른쪽 (→)", `${g.key} to ${g.action}`, guideKey("→"));
    } else add(`${ko ?? g.action} (${g.key})`, ko ? `${g.key} to ${g.action}` : "", guideKey(g.key));
  }
  const body = [...(tk ? [d.title] : []), ...d.lines.slice(1)].slice(0, 16).map((l) => (l.length > 120 ? `${l.slice(0, 119)}…` : l));
  return { title, question: [`맥 화면: ${title}`, ...body, "('취소'는 카드만 닫아요. 맥 화면은 그대로예요)"].join("\n"), options, press };
}

/**
 * 대화 기록을 읽기 시작할 자리. 이미지·긴 출력이 쌓인 대화는 수백 MB 가 되는데, 한 번에 문자열로 만들 수 있는 크기(약 512MB)를
 * 넘으면 읽기가 실패해 폰 채팅이 비고 훅마다 같은 읽기를 되풀이했다(11-15: 658MB 대화 탭에 새 연결부가 뜨면 메시지 0개).
 * 쌓인 만큼(size - offset)이 max 를 넘으면 끝에서 max 앞부터 읽고 앞은 건너뛴다(skip: 첫 줄은 중간부터라 버림).
 * 폰에는 마지막 메시지 몇백 개만 보내므로 앞부분은 없어도 된다
 */
export const MAX_READ_BYTES = 128 << 20;
export function readStart(size, offset, max = MAX_READ_BYTES) {
  return size - offset > max ? { from: size - max, skip: true } : { from: offset, skip: false };
}

/** 맥 Claude Code 입력창이 비었는지(화면 글). 안내 문구 'Try "…"' 만 있으면 빈 것, 여러 줄로 쓰는 중이면 안 빈 것 */
export function inputEmpty(screen) {
  const t = inputLine(screen);
  return t !== null && (t === "" || /^Try ".*"$/.test(t));
}
/** 입력창의 마지막 줄 글(❯ 뒤, 앞뒤 빈칸 뺌). 입력창이 안 보이면 null */
export function inputLine(screen) {
  const ls = String(screen ?? "").split("\n");
  let i = ls.length - 1;
  while (i >= 0 && !/^❯/.test(ls[i])) i--;
  if (i < 0 || !/^─/.test(ls[i + 1] ?? "")) return null;
  return ls[i].replace(/^❯\s?/, "").trim();
}
/** 지금 계정이 사용 한도에 걸려 답을 못 하는지: 한도 오류 답(대화 기록의 오류 글)이나, Claude Code 가 띄운 '어떻게 할까요'
 *  창(1. 한도가 풀릴 때까지 멈춤 · 2. 여기서 기다렸다 이어 감 · 3. 사용 크레딧으로). 11-21: 계정을 바꾸려고 인수인계를 묻자마자
 *  개인 계정이 Fable 한도에 걸렸는데, 그 창을 몰라 인수인계를 10분 기다렸고 그동안 폰에는 그 창이 카드로 뜨지 않았다 */
export function limitStopped(screen, error) {
  return /Stop and wait for limit to reset|Wait here, then continue automatically/.test(String(screen ?? ""))
    || /hit your [^\n]*limit|usage limit/i.test(String(error ?? ""));
}

/** 답이 나오기 전에 Esc 로 멈추면 Claude Code 가 방금 보낸 글을 입력창에 되돌려 놓는다(11-18 확인).
 *  입력창 글(shown)이 그 마지막 사람 글(last)인지: 붙여 넣은 글 자리표시이거나, 빈칸을 고른 뒤 앞부분이 같음 */
export function restoredPrompt(shown, last) {
  const s = String(shown ?? "").trim();
  const l = String(last ?? "").replace(/\s+/g, " ").trim();
  if (!s || !l) return false;
  return /^\[Pasted text #\d+/.test(s) || l.startsWith(s.replace(/\s+/g, " ").slice(0, 40));
}

export { prettyModel };   // 모델 이름 줄이기는 pi 확장도 쓰도록 bg-launch.mjs 로 옮김(시험이 여기서 불러 씀)

const EFFORTS = /^(low|medium|high|xhigh|max)$/;
/**
 * 뒤에서 도는 하위 에이전트의 생각 깊이. 확실할 때만 적고 모르면 "". Claude Code 문서(sub-agents·model-config, 11-16 확인)의 순서:
 * 환경 변수 CLAUDE_CODE_EFFORT_LEVEL > 갈래(fork)는 시킨 쪽 그대로 > 부를 때 적은 effort > 정의의 effort >
 * 시킨 쪽과 같은 모델이면 세션의 깊이. 다른 모델인데 아무것도 없으면 그 모델의 기본값이라 알 수 없다
 */
export function subagentThinking({ type, effort, defEffort, model, parentModel, parentThinking, envEffort }) {
  const ok = (v) => (EFFORTS.test(String(v ?? "")) ? String(v) : "");
  const base = (m) => String(m ?? "").replace(/\[[^\]]*\]$/, "").trim();
  if (ok(envEffort)) return ok(envEffort);
  if (type === "fork") return ok(parentThinking);
  return ok(effort) || ok(defEffort) || (model && base(model) === base(parentModel) ? ok(parentThinking) : "");
}

/** 하위 에이전트 정의(프로젝트 .claude/agents 가 먼저, 그다음 ~/.claude/agents)의 frontmatter effort. 정의가 없거나 적히지 않았으면 "" */
export function agentDefEffort(type, cwd, home = HOME) {
  for (const d of [cwd ? join(cwd, ".claude", "agents") : "", join(home, ".claude", "agents")]) {
    let files = [];
    try {
      files = d ? readdirSync(d).filter((f) => f.endsWith(".md")) : [];
    } catch {
      continue;   // 폴더 없음
    }
    for (const f of files) {
      let fm = "";
      try {
        fm = (readFileSync(join(d, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/) ?? [])[1] ?? "";
      } catch {
        continue;
      }
      const name = (fm.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m) ?? [])[1] ?? f.replace(/\.md$/, "");
      if (name === type) return (fm.match(/^effort:\s*["']?(\w+)["']?\s*$/m) ?? [])[1] ?? "";
    }
  }
  return "";
}

/** 폰 답 → 맥 질문 창 키. 질문이 여럿이거나 여러 개 고르기가 있으면 끝에 검토 화면이 나옴 */
export function answerKeys(qs, answers) {
  const tabs = qs.length > 1 || qs.some((q) => q.multiSelect);
  const seq = [];
  qs.forEach((q, i) => {
    const a = answers[i] ?? { answers: [], other: "" };
    const picks = (Array.isArray(a.answers) ? a.answers : []).map((l) => q.options.findIndex((o) => o.label === String(l))).filter((j) => j >= 0);
    const other = String(a.other ?? "").trim();
    const n = q.options.length;
    if (q.preview) {
      // 미리보기 그림이 있는 문항(하나만 고르기)은 숫자 키가 먹지 않고 직접 입력 줄도 없다(11-20 실제 Claude Code 로 확인).
      // 커서는 첫 줄에서 시작: 아래로 내려가 Enter. 직접 쓴 글은 메모(n)로 넣고 Enter → Claude 에는 '고른 것 없음, 메모: 글'로 감
      if (picks.length) seq.push(...Array.from({ length: picks[0] }, () => ({ key: "Down" })), { key: "Enter" });
      else seq.push({ key: "n" }, { text: other || "-" }, { key: "Enter" });
    } else if (!q.multiSelect) {
      if (picks.length) seq.push({ key: String(picks[0] + 1) });
      else seq.push({ key: String(n + 1) }, { text: other || "-" }, { key: "Enter" });
    } else {
      for (const j of picks) seq.push({ key: String(j + 1) });
      if (other) {
        // 커서는 첫 줄 → 직접 입력 줄까지 내려가 쓰고, 'Submit' 줄로 내려가 Enter
        for (let k = 0; k < n; k++) seq.push({ key: "Down", wait: 150 });
        seq.push({ text: other }, { key: "Down" }, { key: "Enter" });
      } else seq.push({ key: "Right" });
    }
  });
  if (tabs) seq.push({ key: "1", wait: 600 });   // 검토 화면: 1. Submit answers
  return seq;
}

/** 질문 도구 결과 '"Color?"="Blue", "Size?"="Small, Large"' → 'Blue / Small, Large' */
export function questionAnswer(t) {
  // 미리보기 문항에 메모만 적으면 '"질문"=(no option selected) notes: 글' 로 온다
  const re = /"([^"]*)"=(?:"([^"]*)"|\(no option selected\) notes: ([\s\S]*?)(?=, "[^"]*"=|\. (?:Read the answers|You can now)|$))/g;
  const pairs = [...String(t ?? "").matchAll(re)].map((m) => (m[2] !== undefined ? m[2] : `메모: ${m[3].trim()}`));
  return pairs.length ? pairs.join(" / ") : (lines(t).slice(-1)[0] ?? "");
}

// ── 컨텍스트 사용량(앱 위쪽의 고리) ──
// pi 는 확장이 사용량을 직접 받지만, Claude Code 는 그 값을 상태 줄 스크립트에만 넘긴다. 그래서 여기서 정한다:
// 사용 중 토큰은 대화 기록의 마지막 응답이 쓴 입력 토큰(Claude Code 가 상태 줄에 주는 사용률과 같은 식),
// 기억 용량과 자동 압축 지점은 Claude Code 문서(model-config 의 extended context·auto-compact window)의 규칙.
// 실제로 압축된 지점과도 맞춰 봄(11-17, 이 맥의 기록 263번): 1M 모델은 96만 7천 언저리, 자동 압축 창이 200K 일 때는 20만 언저리
const WINDOW_1M = 1_000_000, WINDOW_200K = 200_000, AUTO_COMPACT_1M = 967_000;

/** 모델의 기억 용량(토큰). Fable·Sonnet 5 이상·Haiku 5.5·Opus 4.7 이상은 1M, 그 앞 모델은 200K, 1M 을 끈 환경이면 모두 200K.
 *  모르는 이름이면 null(틀린 숫자를 보이느니 고리를 숨김). 4.6 계열을 [1m] 으로 쓰는 것은 기록의 모델 이름에 표시가 없어 200K 로 본다 */
export function contextWindowOf(model, env = {}) {
  const m = String(model ?? "").toLowerCase().match(/(fable|opus|sonnet|haiku)-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?/);
  if (!m) return null;
  if (env.CLAUDE_CODE_DISABLE_1M_CONTEXT === "1") return WINDOW_200K;
  const [family, major, minor] = [m[1], Number(m[2]), Number(m[3] ?? 0)];
  const from = (a, b) => major > a || (major === a && minor >= b);
  return family === "fable" || (family === "opus" && from(4, 7)) || (family === "sonnet" && from(5, 0)) || (family === "haiku" && from(5, 5)) ? WINDOW_1M : WINDOW_200K;
}

/** 앱 고리에 보낼 값(pi 확장이 보내는 것과 같은 모양). tokens 가 null 이면 아직 모름(압축 직후: 다음 응답 뒤에 다시 앎).
 *  자동 압축은 사용량이 '자동 압축 창'에 닿으면 시작한다: 설정(/autocompact 가 모델마다 저장한 값, 없으면 모든 모델용 autoCompactWindow)이 없으면
 *  1M 모델은 약 967K, 그 밖은 기억 용량 끝. 실행 옵션(--autocompact)·환경 변수(CLAUDE_CODE_AUTO_COMPACT_WINDOW)로 정한 창은 알지 못한다 */
export function contextInfo(model, tokens, settings = {}, env = {}) {
  const window = contextWindowOf(model, env);
  if (!window) return null;
  const saved = settings.modelSettings?.[String(model).replace(/-\d{8}$/, "")]?.autoCompactWindow ?? settings.autoCompactWindow;
  const at = Math.min(window, Number.isInteger(saved) && saved >= 100_000 ? saved : window === WINDOW_1M ? AUTO_COMPACT_1M : window);
  return {
    tokens: tokens ?? null, window, percent: tokens == null ? null : (tokens / window) * 100,
    auto: settings.autoCompactEnabled !== false && env.DISABLE_AUTO_COMPACT !== "1", reserve: window - at,
  };
}

/** 대화 기록 줄 → 폰 메시지(같은 응답의 조각은 하나로 모음) */
export function createConverter() {
  const order = [];
  const byId = new Map();
  const calls = new Map();    // 도구 호출 id → {name, input}
  const results = new Map();  // 도구 호출 id → 결과 메시지
  const images = new Map();   // 도구 호출 id → 읽은 그림(base64)
  const tasks = new Map();    // 할 일(새 방식 TaskCreate·TaskUpdate): 번호 → {content, status, activeForm}
  let todoList = null;        // 할 일(예전 방식 TodoWrite) 마지막 목록
  let model = null;
  let usage = null;           // 마지막 응답이 쓴 입력 토큰(= 지금 컨텍스트에 든 양). 모르면 null(첫 응답 전, 압축 직후)
  const queue = [];           // Claude Code 가 받아 둔 글(작업 중에 들어온 것): 넣은 순서대로 {id, text}
  let queueSeq = 0;
  const STATUS = new Set(["pending", "in_progress", "completed"]);
  const put = (m) => {
    if (!byId.has(m.id)) order.push(m.id);
    byId.set(m.id, m);
    return m;
  };
  const add = (o) => {
    if (!o || o.isSidechain) return [];
    // 압축이 끝남: 앞부분이 요약으로 바뀌어 사용량이 달라졌다. 다음 응답이 올 때까지는 모름
    if (o.type === "system" && o.subtype === "compact_boundary") {
      usage = null;
      return [];
    }
    // 받아 둔 글: 넣기(enqueue)·차례가 돼 꺼내기(dequeue)·작업 중에 전달돼 빼기(remove)·모두 꺼내기(popAll)를 따라감
    if (o.type === "queue-operation") {
      const text = String(o.content ?? "");
      if (o.operation === "enqueue") queue.push({ id: `q${++queueSeq}`, text });
      else if (o.operation === "dequeue") queue.shift();
      else if (o.operation === "popAll") queue.length = 0;
      else if (o.operation === "remove") {
        const i = queue.findIndex((q) => q.text === text);
        if (i >= 0) queue.splice(i, 1);
      }
      return [];
    }
    // 작업 중에 보낸 글은 사용자 메시지가 아니라 첨부(queued_command)로 기록됨 → 내 말풍선으로.
    // 사람이 보낸 것만(작업 알림·다른 세션이 보낸 글도 같은 형태로 들어옴)
    if (o.type === "attachment") {
      const a = o.attachment;
      if (a?.type !== "queued_command" || a.origin?.kind !== "human") return [];
      const p = a.prompt;
      const t = cleanUserText(typeof p === "string" ? p : textOf(p));
      const imgs = Array.isArray(p) ? p.filter((b) => b?.type === "image").length : 0;
      return t || imgs ? [put({ id: o.uuid, role: "user", text: t, images: imgs })] : [];
    }
    if (o.type === "user") {
      const c = o.message?.content;
      if (o.isCompactSummary) return [put({ id: o.uuid, role: "summary", text: clip(textOf(c), 3000) })];
      if (o.isMeta) return [];
      // 내가 보낸 글이 아닌 것: 뒤에서 돌린 작업이 끝났다는 알림, 다른 세션·하위 에이전트가 보낸 글(peer). 내 말풍선으로 보이지 않게
      if (o.origin?.kind === "task-notification" || o.origin?.kind === "peer") return [];
      // 멈춤 표시는 내 말풍선이 아니라 앱의 '중단됨' 줄로: 끝 표시가 aborted 인 빈 답(pi 에서 멈출 때와 같은 모양, 사용자 보고 11-19).
      // interrupted 는 피드가 멈춤을 알아채는 데 씀
      const said = typeof c === "string" ? c : Array.isArray(c) && !c.some((b) => b?.type === "tool_result") ? c.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n") : "";
      if (INTERRUPT_TEXT.test(cleanUserText(said))) return [put({ id: o.uuid, role: "assistant", blocks: [], stop: "aborted", error: null, interrupted: true })];
      const out = [];
      if (typeof c === "string") {
        const t = cleanUserText(c);
        if (t) out.push(put({ id: o.uuid, role: "user", text: t, images: 0 }));
        return out;
      }
      if (!Array.isArray(c)) return out;
      const t = cleanUserText(c.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n"));
      const imgs = c.filter((b) => b?.type === "image").length;
      if (t || imgs) out.push(put({ id: o.uuid, role: "user", text: t, images: imgs }));
      c.filter((b) => b?.type === "tool_result").forEach((b, i) => {
        const img = Array.isArray(b.content) ? b.content.find((x) => x?.type === "image" && x.source?.data) : null;
        if (img) images.set(b.tool_use_id, img.source.data);
        const call = calls.get(b.tool_use_id);
        // 할 일 만들기 결과의 번호('Task #3 created …')로 목록에 넣음
        if (call?.name === "TaskCreate" && !b.is_error) {
          const num = (textOf(b.content).match(/#(\d+)/) ?? [])[1] ?? String(tasks.size + 1);
          tasks.set(num, { content: String(call.input?.subject ?? ""), status: "pending", ...(call.input?.activeForm ? { activeForm: String(call.input.activeForm) } : {}) });
        }
        const r = put({
          id: `${o.uuid}:${i}`, role: "toolResult", toolCallId: b.tool_use_id, isError: !!b.is_error,
          output: clip(textOf(b.content), MAX_TOOL_OUTPUT),
          ...(call?.name === "AskUserQuestion" ? { answer: questionAnswer(textOf(b.content)) } : {}),
        });
        results.set(b.tool_use_id, { ...r, full: textOf(b.content) });
        out.push(r);
      });
      return out;
    }
    if (o.type === "assistant") {
      const m = o.message ?? {};
      // 모델이 답한 줄(오류 안내처럼 Claude Code 가 지어 넣은 줄은 뺌)에서 모델과 사용량을 따라간다.
      // 사용량은 이 응답에 들어간 입력 토큰: 새 입력 + 캐시에 쓴 것 + 캐시에서 읽은 것(출력은 빼고)
      if (m.model && m.model !== "<synthetic>") {
        model = m.model;
        const u = m.usage;
        if (u) usage = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      }
      const id = m.id || o.uuid;
      const prev = byId.get(id) ?? { id, role: "assistant", blocks: [], stop: null, error: null };
      const blocks = [...prev.blocks];
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type === "text") blocks.push({ type: "text", text: b.text ?? "" });
        else if (b?.type === "thinking" || b?.type === "redacted_thinking") {
          // 요즘 Claude Code 는 도구를 부르기 전에 쓴 설명 글을 한두 문장으로 줄여 '생각' 칸에 담아 남긴다
          // (그 줄의 thinkingDisplay 가 "updates". 진짜 생각은 내용 없이 서명만 옴). 맥 화면이 '… · summary'로 보여 주는 글이라,
          // 폰에서도 단계 속에 접지 않고 대화 글로 보인다(update 표시: 답변 복사·끝남 알림에는 넣지 않음)
          const said = o.thinkingDisplay === "updates" ? String(b.thinking ?? "").trim() : "";
          if (said) blocks.push({ type: "text", text: said, update: true });
          else blocks.push({ type: "thinking", ref: `${o.uuid}:${blocks.length}`, desc: (lines(b.thinking ?? "")[0] ?? "").replace(/[*#`>_]/g, "").slice(0, 80), _text: b.thinking ?? "" });
        } else if (b?.type === "tool_use") {
          calls.set(b.id, { name: b.name, input: b.input ?? {} });
          if (b.name === "TodoWrite" && Array.isArray(b.input?.todos)) {
            todoList = b.input.todos.map((t) => ({ content: String(t?.content ?? ""), status: STATUS.has(t?.status) ? t.status : "pending", ...(t?.activeForm ? { activeForm: String(t.activeForm) } : {}) }));
          }
          if (b.name === "TaskUpdate") {
            const t = tasks.get(String(b.input?.taskId ?? ""));
            if (t && b.input.status === "deleted") tasks.delete(String(b.input.taskId));
            else if (t) {
              if (STATUS.has(b.input.status)) t.status = b.input.status;
              if (b.input.subject) t.content = String(b.input.subject);
              if (b.input.activeForm) t.activeForm = String(b.input.activeForm);
            }
          }
          blocks.push({
            type: "tool", id: b.id, name: TOOL_NAMES[b.name] ?? b.name,
            summary: summarizeTool(b.name, b.input), desc: describeTool(b.name, b.input),
            image: b.name === "Read" && /\.(png|jpe?g|gif|webp|heic)$/i.test(String(b.input?.file_path ?? "")),
          });
        }
      }
      const stop = m.stop_reason === "tool_use" ? "toolUse" : m.stop_reason ? "stop" : prev.stop;
      const error = o.isApiErrorMessage ? textOf(m.content) : prev.error;
      // Cloudflare 가 막은 403 을 Claude Code 는 'Please run /login' 으로 보여 준다. 로그인 문제가 아니라는 안내를 붙임
      // (다시 로그인하다 다른 계정으로 승인되면 이 맥의 다른 탭까지 그 계정으로 바뀐다: 2026-11-13 개인 탭이 회사 계정으로 돈 일)
      if (o.isApiErrorMessage && CLOUDFLARE_BLOCK.test(error ?? "") && !blocks.some((b) => b.text === CLOUDFLARE_NOTE)) blocks.push({ type: "text", text: CLOUDFLARE_NOTE });
      return [put({ ...prev, blocks, stop, error })];
    }
    return [];
  };
  /** 폰에 보낼 모양(생각 본문은 상세 요청 때만) */
  const publicMsg = (m) => (m.role === "assistant" ? { ...m, blocks: m.blocks.map(({ _text, ...b }) => b) } : m);
  const lastAssistant = () => {
    for (let i = order.length - 1; i >= 0; i--) {
      const m = byId.get(order[i]);
      if (m.role === "assistant") return m;
      if (m.role === "user") return null;
    }
    return null;
  };
  return {
    add: (o) => add(o).map(publicMsg),
    messages: () => order.map((id) => publicMsg(byId.get(id))),
    model: () => model,
    usage: () => usage,
    /** 받아 둔 글 가운데 사람이 보낸 것(작업 알림은 빼고): 앱의 대기 말풍선으로 보임. 작업 중에 들어온 글은 다음 단계에서 전달됨 */
    queue: () => queue.map((q) => ({ id: q.id, text: cleanUserText(q.text), kind: "steer" })).filter((q) => q.text),
    /** 작업이 끝나면 남은 것은 버림(꺼낸 기록이 빠져도 대기 표시가 남지 않게) */
    clearQueue: () => { queue.length = 0; },
    /** 할 일 목록(새 방식이 있으면 그것, 없으면 예전 방식) */
    todos: () => (tasks.size ? [...tasks.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, t]) => ({ ...t })) : (todoList ?? [])),
    image: (id) => images.get(id),
    lastAssistant,
    /** 마지막 답의 글(도구를 부르기 전의 진행 설명은 빼고): 작업이 끝났을 때 알림·백그라운드 보고에 씀 */
    lastAnswerText: () => (lastAssistant()?.blocks ?? []).filter((b) => b.type === "text" && !b.update).map((b) => b.text).join("\n"),
    /** 마지막 사람 글 뒤의 답(없으면 null): 번호와, API 오류였으면 그 글(한도 오류 등) */
    lastAnswerId: () => lastAssistant()?.id ?? null,
    lastAnswerError: () => lastAssistant()?.error ?? null,
    /** 마지막 사람 글(계정 전환 때 입력창에 되돌아온 글인지 견줌) */
    lastPrompt: () => {
      for (let i = order.length - 1; i >= 0; i--) {
        const m = byId.get(order[i]);
        if (m.role === "user") return m.text ?? "";
      }
      return "";
    },
    /** 단계 상세(pi 피드와 같은 모양) */
    detail: (o) => {
      if (o.kind === "thinking") {
        for (const m of byId.values()) for (const b of m.blocks ?? []) if (b.type === "thinking" && b.ref === o.ref)
          return { kind: "thinking", text: b._text ? clip(b._text, BIG) : "(Claude Code 가 생각 내용을 남기지 않았어요)" };
        return { kind: "thinking", error: "생각 내용을 찾지 못했어요" };
      }
      const call = calls.get(o.id);
      if (!call) return { kind: "other", error: "도구 기록을 찾지 못했어요" };
      const res = results.get(o.id);
      const output = res ? clip(res.full, BIG) : "";
      const isError = !!res?.isError, done = !!res, a = call.input;
      switch (call.name) {
        case "Bash": return { kind: "bash", command: clip(String(a.command ?? ""), BIG), output, isError, done };
        case "Edit": return { kind: "edit", path: String(a.file_path ?? ""), isError, output, done, edits: [{ old: clip(String(a.old_string ?? ""), 10_000), new: clip(String(a.new_string ?? ""), 10_000) }] };
        case "MultiEdit": return { kind: "edit", path: String(a.file_path ?? ""), isError, output, done, edits: (a.edits ?? []).slice(0, 30).map((e) => ({ old: clip(String(e?.old_string ?? ""), 10_000), new: clip(String(e?.new_string ?? ""), 10_000) })) };
        case "Write": return { kind: "write", path: String(a.file_path ?? ""), content: clip(String(a.content ?? ""), BIG), isError, output, done };
        case "Read": return { kind: "read", path: String(a.file_path ?? ""), output, isError, done };
        default: {
          let args = "";
          try {
            args = clip(JSON.stringify(a, null, 2), BIG);
          } catch {
            /* 표시 못 하면 빈 값 */
          }
          return { kind: "other", title: call.name, args, output, isError, done };
        }
      }
    },
  };
}

// ───────────────────────── 피드 프로그램 ─────────────────────────

function tmux(...args) {
  try {
    return execFileSync(TMUX, args, { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function readSettings() {
  try {
    return JSON.parse(readFileSync(`${HOME}/.claude/settings.json`, "utf8"));
  } catch {
    return {};
  }
}

// 맥의 /model 화면과 같은 선택지: 앱의 모델 메뉴가 이 목록을 그대로 보인다(pi 탭은 pi 가 아는 모델 목록).
// id 는 '/model <id>' 로 들어간다. 맥 화면의 선택지가 바뀌면 여기만 고치면 된다(앱은 받은 대로 그림)
export const MODEL_CHOICES = [
  { id: "default", name: "기본(추천)" },
  { id: "opus", name: "Opus" },
  { id: "fable", name: "Fable" },
  { id: "sonnet", name: "Sonnet" },
  { id: "haiku", name: "Haiku" },
];
const EFFORT = { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const COMMANDS = [
  { name: "compact", description: "대화를 요약해 컨텍스트 줄이기" },
  { name: "clear", description: "새 대화(컨텍스트 비우기)" },
  { name: "model", description: "모델 바꾸기" },
  { name: "effort", description: "생각 깊이 바꾸기" },
  { name: "context", description: "컨텍스트 사용량 보기" },
  { name: "usage", description: "사용량 보기" },
  { name: "review", description: "코드 리뷰" },
  { name: "security-review", description: "보안 리뷰(지금 브랜치의 바뀐 코드)" },
  { name: "bgtab", description: "새 탭에서 백그라운드로 실행: /bgtab <할 일>" },
].map((c) => ({ ...c, source: "claude" }));

/** 같은 칸의 예전 연결부를 끄고 끝날 때까지(최대 3초) 기다림. 훅이 바쁜 연결부에 못 붙어 새로 띄우면 둘이 같이 돌며
 *  소켓을 빼앗긴 쪽이 '작업 중'에 갇힌 채 탭 상태를 덮어씀(사용자 보고 11-12) */
export function stopOtherFeeds(pane) {
  let pids = [];
  try {
    // -a: 이 프로세스를 띄운 쪽(부모·조부모)도 찾는다. 새 판으로 자리를 넘길 때는 옛 연결부가 새 연결부를 띄우므로,
    // 기본값(조상은 뺌)으로는 옛 연결부를 찾지 못해 둘이 같이 돌았다
    pids = execFileSync("pgrep", ["-a", "-f", `claude-feed\\.mjs ${pane}$`], { encoding: "utf8", timeout: 3000 })
      .split("\n").map(Number).filter((p) => p && p !== process.pid);
  } catch {
    return 0;   // 없음
  }
  for (const p of pids) {
    try {
      process.kill(p, "SIGTERM");
    } catch {
      /* 이미 끝남 */
    }
  }
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 30 && pids.some((p) => { try { process.kill(p, 0); return true; } catch { return false; } }); i++) Atomics.wait(wait, 0, 0, 100);
  return pids.length;
}

export function runFeed(pane) {
  const dir = `${HOME}/.cache/pi-remote/feed`;
  const sockPath = `${dir}/${pane.replace(/\W/g, "")}.sock`;
  const revPath = `${dir}/${pane.replace(/\W/g, "")}.rev`;
  const dropRev = () => {
    try {
      unlinkSync(revPath);
    } catch {
      /* 이미 없음 */
    }
  };
  stopOtherFeeds(pane);
  let transcript = null;
  let offset = 0;
  let rest = "";
  let conv = createConverter();
  let working = false;
  let workSince = null;
  let lastAskNotify = 0;
  const clients = new Set();
  const approvals = new Map();   // 승인 창: id → 폰 카드 항목
  const questions = new Map();   // 질문 창: id → {item, qs}
  let screenAsk = null;          // 훅 없이 묻는 맥 화면 창(피드백 초안 종료 안내 등) → 폰 질문 카드 하나: {id, sig, item, press}
  let lastCardAt = 0;            // 승인·질문 카드가 닫힌 때(그 답으로 맥 창의 키를 누르는 동안 화면 창으로 잘못 보지 않게)
  let todosSent = "[]";

  const write = (sock, o) => {
    try {
      sock.write(`${JSON.stringify(o)}\n`);
    } catch {
      /* 끊긴 연결 */
    }
  };
  const broadcast = (o) => {
    for (const c of clients) write(c, o);
  };
  /** 폰 할 일 칸: 일하는 중이거나 남은 일이 있을 때만 */
  const visibleTodos = () => {
    const t = conv.todos();
    return t.length && (working || t.some((x) => x.status !== "completed")) ? t : [];
  };
  const pushTodos = () => {
    const t = visibleTodos();
    const j = JSON.stringify(t);
    if (j !== todosSent) {
      todosSent = j;
      broadcast({ t: "todos", todos: t });
    }
  };
  let queueSent = "[]";
  /** 받아 둔 글(쉬는 중에는 없음) */
  const queueNow = () => (working ? conv.queue() : []);
  /** 받아 둔 글이 바뀌었으면 앱에 알림 → 앱이 먼저 띄운 말풍선이 대기 표시로 넘어가고, 탭을 바꾸면 그 탭 것만 보임 */
  const pushQueue = () => {
    const q = queueNow();
    const j = JSON.stringify(q);
    if (j === queueSent) return;
    queueSent = j;
    broadcast({ t: "queue", items: q });
  };
  // 컨텍스트 사용량(앱 위쪽의 고리): 응답이 적히거나 압축되면 바뀐다. 모델·사용량이 달라졌을 때만 다시 계산해 보낸다
  // (설정에서 자동 압축 창을 바꾼 것은 다음 응답 때 반영). 환경 변수는 Claude Code 에서 물려받은 것과 설정 파일의 env 를 함께 본다
  let contextKey = "";
  const contextNow = () => {
    contextKey = `${conv.model()}:${conv.usage()}`;
    const s = readSettings();
    return contextInfo(conv.model(), conv.usage(), s, { ...s.env, ...process.env });
  };
  const pushContext = () => {
    if (`${conv.model()}:${conv.usage()}` !== contextKey) broadcast({ t: "context", context: contextNow() });
  };
  // 압축하는 중(앱 대화 아래의 '대화를 압축하는 중'): 맥 화면에 압축 진행 줄이 보이는 동안. 화면이 기준이라 /compact 와 자동 압축을
  // 같은 식으로 알고, 맥 화면과 앱이 어긋나지 않는다. 화면 타이머(아래 권한 모드 읽기)가 2초마다 보고, 보이면 바로 켠다(시작한 때는 그 줄의 경과 시간으로 셈).
  // 끄는 것은 압축이 끝났다는 기록 줄을 읽었을 때 바로, 또는 진행 줄이 두 번 연속 안 보일 때(취소·실패하면 기록에 남는 것이 없다. 한 번은 화면을 다시 그리는 틈일 수 있음).
  // 한 시간쯤 쉰 뒤에 하는 압축은 직접 보지 못했다(같은 줄일 것으로 봄): 오래 걸린 압축인데 진행 줄을 못 봤으면 훅 기록에 남으니 그것으로 안다
  let compactSince = 0;   // 압축을 시작한 때(ms). 0 이면 압축하는 중이 아님
  let compactGone = 0;
  const setCompacting = (since, why = "") => {
    if (!since === !compactSince) return;
    compactSince = since;
    compactGone = 0;
    broadcast({ t: "compacting", value: !!since, since: since || null });
    logHook(since ? "압축하는 중(맥 화면에 압축 진행 줄)" : `압축하는 중 끝(${why})`);
  };
  const noteCompacting = (scr) => {
    const sec = compactingFor(scr);
    if (sec !== null) {
      compactGone = 0;
      if (!compactSince) setCompacting(Date.now() - sec * 1000);
    } else if (compactSince && ++compactGone >= 2) setCompacting(0, "진행 줄이 사라짐");
  };
  const snapshot = () => {
    const msgs = conv.messages();
    const q = queueNow();
    queueSent = JSON.stringify(q);
    return {
      t: "snapshot", v: FEED_VERSION, agent: "claude", messages: msgs.slice(-MAX_MESSAGES), truncated: Math.max(0, msgs.length - MAX_MESSAGES),
      working, queue: q, canSend: true, notice: null, context: contextNow(), compacting: !!compactSince, since: working ? workSince : null,
      approvals: [...approvals.values()], questions: [...[...questions.values()].map((q) => q.item), ...(screenAsk ? [screenAsk.item] : [])], todos: visibleTodos(), planMode: permMode === "plan", compactSince: compactSince || null,
      permMode, modelChoices: MODEL_CHOICES, rev: CODE_REV,
    };
  };

  // 탭 상태 점(tmux-tab-status 와 같은 값)과 폰 칩용 모델·생각 깊이
  const setStatus = (v) => tmux("set-option", "-w", "-t", pane, "@pi_status", v);
  const viewing = () => /^1[1-9]/.test(tmux("display", "-p", "-t", pane, "#{window_active}#{session_attached}") ?? "");
  // 칩에 보일 모델·생각 깊이를 창 옵션에 적는다. 실제 값은 브리지가 맥 화면의 상태 줄에서 읽어 이 옵션을 고쳐 적는다
  // (세션에서 바꾼 생각 깊이·모델별 값 포함, server/status-line.mjs). 그래서 여기서는 대화 기록의 모델과,
  // 생각 깊이가 아직 비어 있을 때만 설정 파일의 기본값을 적는다(예전에는 늘 기본값을 적어 맥 화면과 달랐음)
  const updateChips = () => {
    const m = conv.model();
    if (m) tmux("set-option", "-w", "-t", pane, "@ai_model", prettyModel(m));
    if (!(tmux("show-options", "-w", "-v", "-t", pane, "@ai_thinking") ?? "").trim()) {
      const d = readSettings().effortLevel;
      if (d) tmux("set-option", "-w", "-t", pane, "@ai_thinking", String(d));
    }
  };
  /** 앱에서 생각 깊이를 바꿈: 맥 화면에 반영되기 전에 칩부터 바꿔 둠 */
  const setThinkingChip = (level) => tmux("set-option", "-w", "-t", pane, "@ai_thinking", String(level));

  /** 폰 알림(브리지 알림 소켓) */
  const notifyPhone = (kind, title, body, extra = {}) => {
    const out = tmux("display", "-p", "-t", pane, "#{session_name}:::#{window_index}");
    if (!out) return;
    const [session, idx] = out.split(":::");
    const path = `${HOME}/.cache/pi-remote/notify-${session}.sock`;
    if (!existsSync(path)) return;
    const c = createConnection(path);
    c.on("error", () => {});
    c.end(`${JSON.stringify({ kind, title, body: cut(String(body ?? ""), 200), window: Number(idx), ...extra })}\n`);
  };

  // ── 뒤에서 도는 작업(Claude Code 의 백그라운드 셸·하위 에이전트·감시) 목록: 대화 기록으로 시작·끝·멈춤을 따라간다 ──
  // 앱 서랍의 '백그라운드 작업 N'을 누르면 이 목록(이름·걸린 시간·셸의 최근 출력)을 보이고 끌 수 있다(11-14 사용자 요청)
  const bgJobs = new Map();     // 작업 번호 → { id, kind: shell|agent|monitor, title, output, startedAt }
  const bgStarting = new Map(); // 도구 호출 번호 → { kind, title } (시작 결과를 기다림)
  const bgStopping = new Map(); // 멈춤 도구(TaskStop 등) 호출 번호 → 작업 번호
  // Claude Code 가 감시를 끝내며 보내는 이벤트 글: [Monitor expired after 30m with 1 event delivered. …](시간 제한), [Monitor timed out …],
  // [Monitor stopped — too much output …]. 끝 상태(<status>)가 없는 알림으로 온다(2.1.326 실행 파일과 실제 기록에서 확인, 11-18)
  const MONITOR_ENDED = /<event>\s*\[Monitor (expired after|timed out|stopped)\b/;
  const trackJobs = (o) => {
    if (o.isSidechain) return;
    const c = o.message?.content;
    if (o.type === "assistant" && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== "tool_use") continue;
        const inp = b.input ?? {};
        const desc = String(inp.description ?? "").trim();
        if (b.name === "Bash" && inp.run_in_background) bgStarting.set(b.id, { kind: "shell", title: desc || lines(inp.command)[0] || "셸" });
        else if (b.name === "Agent" || b.name === "Task") {
          // 하위 에이전트는 이제 부를 때 run_in_background 를 적지 않고 늘 뒤에서 돈다(2.1.32x, 11-16 확인). 뒤에서 도는지는 결과의 isAsync 로 가림.
          // 생각 깊이를 정할 때 쓸 것도 적어 둠: 종류·부를 때 적은 깊이·이 호출을 만든 시킨 쪽 모델·정의를 찾을 폴더
          bgStarting.set(b.id, { kind: "agent", bg: !!inp.run_in_background, title: desc || String(inp.subagent_type ?? "에이전트"),
            type: String(inp.subagent_type ?? "") || "general-purpose", effort: inp.effort, parentModel: o.message?.model || conv.model(), cwd: o.cwd });
        }
        else if (b.name === "Monitor") bgStarting.set(b.id, { kind: "monitor", title: desc || "감시" });
        else if (/^(TaskStop|KillShell|KillBash)$/.test(b.name)) bgStopping.set(b.id, String(inp.task_id ?? inp.shell_id ?? inp.bash_id ?? ""));
      }
    }
    if (o.type === "user" && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== "tool_result") continue;
        const r = o.toolUseResult ?? {};
        const s = bgStarting.get(b.tool_use_id);
        if (s) {
          bgStarting.delete(b.tool_use_id);
          const text = textOf(b.content);
          const id = String(r.backgroundTaskId ?? r.agentId ?? r.taskId ?? text.match(/with ID: (\w+)/)?.[1] ?? "");
          const output = String(r.outputFile ?? text.match(/Output is being written to: (\S+?\.output)/)?.[1] ?? "");
          // 끝까지 기다린 하위 에이전트(뒤에서 돌지 않은 호출)는 넣지 않음. 모델은 결과의 resolvedModel(실제로 답한 모델과 같음, 11-16 확인)
          const inBackground = s.kind !== "agent" || s.bg || r.isAsync === true;
          if (id && !b.is_error && inBackground) {
            const startedAt = Date.parse(o.timestamp ?? "") || Date.now();
            // 감시의 시간 제한(결과의 timeoutMs. 계속 도는 감시는 0): 그때가 지나면 Claude Code 가 감시를 끝낸다
            bgJobs.set(id, { id, ...s, output, startedAt, ...(s.kind === "agent" ? { model: String(r.resolvedModel ?? "") } : {}),
              ...(s.kind === "monitor" && Number(r.timeoutMs) > 0 ? { expiresAt: startedAt + Number(r.timeoutMs) } : {}) });
          }
        }
        const stop = bgStopping.get(b.tool_use_id);
        if (stop !== undefined) {
          bgStopping.delete(b.tool_use_id);
          if (!b.is_error) bgJobs.delete(String(r.task_id ?? stop));
        }
      }
    }
    // 끝 알림(<task-notification> … <task-id>X</task-id> … <status>completed</status>): 대기열 줄·사람 줄·첨부 줄 어디에 적히든.
    // 감시는 이벤트마다 알림이 올 수 있어, 끝 상태가 적힌 알림만 끝으로 본다. 다만 시간 제한이 지났거나 출력이 너무 많아 Claude Code 가
    // 감시를 끝낼 때는 끝 상태 없이 이벤트 알림 하나만 온다(MONITOR_ENDED): 그 글로 시작하는 이벤트도 끝으로 본다
    const note = o.type === "queue-operation" ? o.content
      : o.type === "user" && o.origin?.kind === "task-notification" ? textOf(c)
      : o.type === "attachment" && o.attachment?.type === "queued_command" ? o.attachment.prompt : null;
    if (typeof note === "string" && note.includes("<task-notification>")) {
      for (const m of note.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const id = m[1].match(/<task-id>([^<]+)<\/task-id>/)?.[1];
        const status = m[1].match(/<status>([^<]+)<\/status>/)?.[1] ?? "";
        const ended = status ? !/^(running|in_progress|event)$/i.test(status) : MONITOR_ENDED.test(m[1]);
        if (id && ended) bgJobs.delete(id);
      }
    }
  };
  let lastConvAt = 0;   // 대화 기록에 새 내용이 들어온 때(훅이 빠져도 일하는 중인 것을 알 수 있게, 바로잡기가 씀)
  let lastStopAt = 0;   // 마지막 끝 훅(또는 Esc 멈춤)을 받은 때. 그 전에 생긴 기록 줄로는 작업 중을 다시 켜지 않음
  /** 차례가 이어지는 중이라는 기록인지: 도구 호출·생각 조각(끝 표시가 '끝'이 아님), 도구 결과, 사람이 보낸 글(슬래시 명령은 뺌). 멈춤 표시(aborted)는 아님 */
  const inProgress = (m) =>
    m.role === "toolResult" ||
    (m.role === "assistant" && m.stop !== "stop" && m.stop !== "aborted" && !m.error) ||
    (m.role === "user" && Boolean(m.text || m.images) && !/^\//.test(m.text ?? ""));
  const readNew = (initial) => {
    if (!transcript) return;
    let size;
    try {
      size = statSync(transcript).size;
    } catch {
      return;
    }
    if (size < offset) { offset = 0; rest = ""; conv = createConverter(); initial = true; }   // 파일이 새로 쓰임
    if (size === offset) return;
    const { from, skip } = readStart(size, offset);
    const fd = openSync(transcript, "r");
    const buf = Buffer.alloc(size - from);
    try {
      readSync(fd, buf, 0, buf.length, from);
    } finally {
      closeSync(fd);
    }
    offset = size;
    const text = (skip ? "" : rest) + buf.toString("utf8");
    const parts = text.split("\n");
    rest = parts.pop() ?? "";
    if (skip) parts.shift();   // 건너뛴 자리의 첫 줄은 중간부터라 버림
    const changed = [];
    let fresh = false;   // 마지막 끝 훅 뒤에 생긴, 차례가 이어지는 중이라는 기록
    const asks = [];   // 마지막 끝 훅 뒤에 적힌 질문 호출(AskUserQuestion). 훅이 빠져도 폰 카드·푸시를 띄우게
    let compacted = 0;   // 압축이 끝났다는 줄을 읽음(그 압축에 걸린 시간 ms, 모르면 1)
    for (const l of parts) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        const ms = conv.add(o);
        changed.push(...ms);
        trackJobs(o);
        if (o.type === "system" && o.subtype === "compact_boundary" && !o.isSidechain) compacted = Number(o.compactMetadata?.durationMs) || 1;
        if (o.type === "assistant" && !o.isSidechain && Date.parse(o.timestamp ?? "") > lastStopAt) {
          for (const b of Array.isArray(o.message?.content) ? o.message.content : []) if (b?.type === "tool_use" && b.name === "AskUserQuestion") asks.push(b);
        }
        // 뒤에서 돌던 작업이 끝났다는 알림(task-notification)은 대화에 보이지 않지만 새 차례를 시작함
        const notice = o.type === "user" && o.origin?.kind === "task-notification" && !o.isSidechain;
        if (Date.parse(o.timestamp ?? "") > lastStopAt && (notice || ms.some(inProgress))) fresh = true;
      } catch {
        /* 깨진 줄 무시 */
      }
    }
    if (changed.length && !initial) lastConvAt = Date.now();
    const interrupted = !initial && changed.some((m) => m.interrupted);
    // 훅이 빠져도 대화가 이어지면 작업 중으로(11-14: 한 탭에서 끝 훅이 21번 중 17번 연결부에 닿지 않았고, 시작 훅도 빠져 처음부터 표시가 안 켜졌다)
    if (fresh && !initial && !interrupted && !working) {
      working = true;
      workSince = workSince || Date.now();
      broadcast({ t: "working", value: true, since: workSince });
      setStatus("working");
      logHook("대화 기록이 이어져 작업 중으로(시작 훅을 받지 못함)");
    }
    // 질문 카드: 답(도구 결과)이 적히면 닫고, 새 질문 호출이 적히면 연다(11-14 사용자 보고 '왜 푸시로 물어보지 않나': 질문 훅이 연결부에 닿지 않았다)
    const answered = new Set(changed.filter((m) => m.role === "toolResult").map((m) => m.toolCallId));
    if (!initial) {
      for (const id of answered) questionDone(`cc-q-${id}`);
      for (const b of asks) {
        if (answered.has(b.id) || questions.has(`cc-q-${b.id}`)) continue;
        openQuestion({ tool_use_id: b.id, tool_input: b.input });
        if (questions.has(`cc-q-${b.id}`)) logHook("대화 기록에서 질문을 보고 폰에 카드·알림(질문 훅을 받지 못함)");
      }
    } else {
      // 연결부가 새로 떴을 때 맥에 질문 창이 떠 있으면 답이 없는 마지막 질문을 폰 카드로(옛 질문은 열지 않음)
      const open = asks.filter((b) => !answered.has(b.id)).pop();
      if (open && /Esc to cancel/.test(tmux("capture-pane", "-p", "-t", pane) ?? "")) {
        openQuestion({ tool_use_id: open.id, tool_input: open.input });
        if (questions.has(`cc-q-${open.id}`)) logHook("새로 뜰 때 맥에 떠 있던 질문을 폰에 카드·알림");
      }
    }
    if (initial) broadcast(snapshot());
    else {
      pushQueue();   // 대기 표시부터 고침: 전달된 글이 대기 표시와 말풍선으로 겹쳐 보이지 않게
      for (const m of changed) broadcast({ t: "upsert", message: m });
    }
    if (changed.some((m) => m.role === "assistant")) updateChips();
    if (changed.length) pushTodos();
    pushContext();
    // 처음 읽을 때의 옛 압축 줄로는 끄지 않음(지금 압축하는 중인지는 화면이 알려 줌)
    if (compacted && !initial) {
      // 오래 걸린 압축인데 화면에서 압축 진행 줄을 보지 못했으면 적어 둔다(진행 줄의 모양이 바뀌어 못 알아보는 것인지 나중에 알 수 있게)
      if (!compactSince && compacted >= 10_000) logHook(`압축이 끝났는데 화면에서 압축 진행 줄을 보지 못함(${Math.round(compacted / 1000)}초 걸림)`);
      setCompacting(0, "기록의 압축 줄");
    }
    // Esc 로 멈춤(승인 거부·질문 취소 포함): 작업 끝 훅이 안 올 수 있어 기록의 '[Request interrupted by user' 로 끝냄
    if (interrupted) {
      if (working) broadcast({ t: "working", value: false });
      working = false;
      workSince = null;
      lastStopAt = Date.now();
      clearCards();
      setStatus(viewing() ? "" : "yourturn");   // 사용자가 멈추면 작업 끝 훅이 안 옴 → 보라·주황이 남지 않게
    }
  };
  const load = (path) => {
    if (!path || path === transcript) return;
    transcript = path;
    offset = 0;
    rest = "";
    conv = createConverter();
    readNew(true);
    updateChips();
  };

  /** 맥 Claude Code 입력창에 붙여 넣고 Enter */
  const paste = (text) => {
    const name = `pr-claude-${process.pid}`;
    try {
      execFileSync(TMUX, ["load-buffer", "-b", name, "-"], { input: text, timeout: 3000 });
      tmux("paste-buffer", "-p", "-d", "-b", name, "-t", pane);
      setTimeout(() => tmux("send-keys", "-t", pane, "Enter"), 150);
      return true;
    } catch {
      return false;
    }
  };

  // ── 승인·질문 카드: 맥 Claude Code 창과 같은 일을 폰 카드로. 폰에서 답하면 맥 창의 키를 대신 누름 ──
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  /** 키를 차례로 누름: {key} 는 tmux 키 이름, {text} 는 글자 그대로.
   *  맥 창이 아직 다 뜨기 전에 누르면 키가 사라지므로, 화면에 창이 보일 때까지(최대 5초) 기다린 뒤 누름 */
  const pressKeys = async (seq) => {
    for (let i = 0; i < 33 && !/Esc to cancel/.test(tmux("capture-pane", "-p", "-t", pane) ?? ""); i++) await sleepMs(150);
    await sleepMs(150);
    for (const k of seq) {
      if (k.text !== undefined) tmux("send-keys", "-t", pane, "-l", k.text);
      else tmux("send-keys", "-t", pane, k.key);
      await sleepMs(k.wait ?? 400);
    }
  };
  const approvalDone = (id) => {
    if (!approvals.delete(id)) return;
    lastCardAt = Date.now();
    broadcast({ t: "approval-done", id });
  };
  // 맥은 질문 창을 한 번에 하나씩 띄운다(한 응답에서 질문 도구를 여러 번 부르면 차례로). 폰 카드도 하나씩: 앞 카드가 열려 있으면 뒤 질문은
  // 기다렸다가 앞 카드가 닫히면 연다. 두 카드가 함께 보이면 뒤 카드의 답이 맥에 떠 있는 앞 질문 창에 들어갔다(11-15 실제 Claude Code 로 확인)
  const questionWaiting = [];   // 열기를 기다리는 질문 호출(훅 이벤트 모양: tool_use_id·tool_input)
  const questionDone = (id) => {
    const wi = questionWaiting.findIndex((w) => `cc-q-${w.tool_use_id}` === id);
    if (wi >= 0) questionWaiting.splice(wi, 1);   // 기다리던 질문이 맥에서 먼저 끝났으면 열지 않음
    if (questions.delete(id)) {
      lastCardAt = Date.now();
      broadcast({ t: "question-done", id });
    }
    // 앞 질문이 끝나면 다음 질문 카드(방금 답했으니 알림은 보내지 않음)
    while (!questions.size && questionWaiting.length) openQuestion(questionWaiting.shift(), { quiet: true });
  };
  /** 맥 창이 닫혔으면(맥에서 먼저 답함·작업 끝) 남은 카드 지우기 */
  const clearCards = () => {
    questionWaiting.length = 0;
    for (const id of [...approvals.keys()]) approvalDone(id);
    for (const id of [...questions.keys()]) questionDone(id);
  };
  // ── 권한 모드: 입력창 아래 줄('⏵⏵ auto mode on' 등)을 읽고, 폰에서 고르면 Shift+Tab 으로 돌려 맞춤 ──
  const readMode = () => shownMode(tmux("capture-pane", "-p", "-t", pane) ?? "");   // 확인 창 등으로 모드 줄이 안 보이면 null
  let permMode = readMode() ?? "auto";
  const noteMode = (m) => {
    if (!m || m === permMode) return;
    permMode = m;
    broadcast({ t: "permmode", mode: m });
    broadcast({ t: "planmode", on: m === "plan" });
  };
  setInterval(() => {
    const scr = tmux("capture-pane", "-p", "-t", pane) ?? "";
    noteMode(shownMode(scr));
    noteCompacting(scr);
  }, 2000);
  let modeBusy = false;
  const setMode = async (target, sock) => {
    if (modeBusy) return;
    modeBusy = true;
    try {
      for (let i = 0; i < 6; i++) {
        const cur = readMode();
        if (!cur) return void write(sock, { t: "notice", text: "맥 Claude Code 에 확인 창이 떠 있어 모드를 바꾸지 못했어요" });
        noteMode(cur);
        if (cur === target) return;
        tmux("send-keys", "-t", pane, "BTab");
        for (let t = 0; t < 10 && readMode() === cur; t++) await sleepMs(150);
      }
      write(sock, { t: "notice", text: "이 Claude Code 에서는 그 모드로 바꿀 수 없어요" });
    } finally {
      modeBusy = false;
      noteMode(readMode());
    }
  };

  let dialogGone = 0;
  setInterval(() => {
    if (!approvals.size && !questions.size) return void (dialogGone = 0);
    const scr = tmux("capture-pane", "-p", "-t", pane) ?? "";
    dialogGone = /Esc to cancel/.test(scr) ? 0 : dialogGone + 1;
    if (dialogGone >= 2) {
      dialogGone = 0;
      clearCards();
      // 맥 창이 닫혔는데 점이 보라(답을 기다림)로 남아 있으면 지금 상태로
      if (tmux("show-options", "-w", "-v", "-t", pane, "@pi_status") === "asking") setStatus(working ? "working" : viewing() ? "" : "yourturn");
    }
  }, 1500);

  // ── 훅 없이 묻는 맥 화면 창 → 폰 질문 카드(11-15 사용자 보고 '이런 것도 나에게 물어봐야': /exit 뒤 피드백 초안 창이 맥에서 기다렸다) ──
  // 같은 창이 두 번 연속(약 3초) 보이면 카드를 열고, 두 번 연속 안 보이면 닫는다. 승인·질문 카드가 있거나 막 닫혔으면
  // (그 답으로 맥 창의 키를 누르는 중) 보지 않는다. 일하는 중의 'cancel' 창은 대개 승인·질문 창이라 훅이 카드를 열 때까지
  // 6초쯤 기다리고, 그래도 카드가 없을 때만(훅이 빠졌거나 사용량 한도 창처럼 훅 없이 뜬 창) 연다.
  // 폰에서 고르면 그 키를 맥에서 누르고, '취소'는 카드만 닫는다(Esc 가 '초안 버리고 종료'처럼 되돌릴 수 없는 창도 있어서).
  // 취소로 닫은 창은 사라질 때까지 다시 띄우지 않는다. 알림은 창이 이어서 떠 있는 한 흐름(종료 안내 → 목록 → 검토처럼 바뀌기만 함)에
  // 처음 한 번만 보내고, 창이 사라졌다(두 번 연속 안 보임) 다시 뜨면 새로 보낸다
  let dlgSeen = null;
  let dlgMiss = 0;
  let dlgDismissed = null;
  let dlgGone = 0;              // 창이 연속으로 안 보인 횟수
  let dlgTicks = 0;             // 같은 창을 연속으로 본 횟수
  let flowNotified = false;     // 이번 흐름에서 알림을 보냈는지
  const screenAskDone = () => {
    if (!screenAsk) return;
    broadcast({ t: "question-done", id: screenAsk.id });
    screenAsk = null;
    if (!approvals.size && !questions.size && tmux("show-options", "-w", "-v", "-t", pane, "@pi_status") === "asking") setStatus(working ? "working" : viewing() ? "" : "yourturn");
  };
  const openScreenAsk = (d) => {
    const quiet = flowNotified;
    const card = dialogCard(d);
    const id = `cc-s-${Date.now()}`;
    screenAsk = { id, sig: d.sig, press: card.press, item: { id, question: card.question, options: card.options, multiSelect: false, since: Date.now(), kind: "select" } };
    broadcast({ t: "question", question: screenAsk.item });
    setStatus("asking");
    logHook(`맥 화면 창을 폰 카드로${quiet ? "(알림 없이)" : ""}: ${d.title}`);
    if (quiet) return;
    flowNotified = true;
    askNotify("prompt", "Claude Code 가 물어봐요", card.title);
  };
  const answerScreenAsk = (o) => {
    const a = screenAsk;
    if (!a) return;
    if (o.cancel === true) {
      dlgDismissed = a.sig;
      return void screenAskDone();
    }
    const k = a.press.get(String((Array.isArray(o.answers) ? o.answers[0] : "") ?? ""));
    screenAskDone();
    if (!k) return;
    dlgSeen = null;
    // 누르기 직전에 그 창이 아직 떠 있는지(맥에서 먼저 답해 다른 창이 됐으면 그 창에 엉뚱한 키가 들어감)
    if (screenDialog(tmux("capture-pane", "-p", "-t", pane) ?? "")?.sig !== a.sig) {
      broadcast({ t: "notice", text: "맥 화면이 그사이 바뀌어 누르지 않았어요" });
      return;
    }
    logHook(`폰에서 맥 화면 창에 답: ${k.text ?? k.key}`);
    if (k.text !== undefined) tmux("send-keys", "-t", pane, "-l", k.text);
    else tmux("send-keys", "-t", pane, k.key);
  };
  setInterval(() => {
    if (switching) return;
    const busy = approvals.size > 0 || questions.size > 0 || Date.now() - lastCardAt < 4000;
    const d = busy ? null : screenDialog(tmux("capture-pane", "-p", "-t", pane) ?? "");
    if (!d) {
      if (!busy) {
        dlgDismissed = null;
        if (++dlgGone >= 2) flowNotified = false;
      }
      dlgSeen = null;
      if (!screenAsk) dlgMiss = 0;
      else if (busy || ++dlgMiss >= 2) screenAskDone();
      return;
    }
    dlgMiss = 0;
    dlgGone = 0;
    if (screenAsk && screenAsk.sig !== d.sig) screenAskDone();   // 다른 창으로 바뀜: 앞 카드는 바로 닫고 새 창은 다음에
    if (screenAsk || dlgDismissed === d.sig) return;
    if (dlgSeen !== d.sig) {
      dlgSeen = d.sig;
      dlgTicks = 1;
      return;
    }
    const slow = working && d.guide.some((g) => /^cancel$/i.test(g.action));
    if (++dlgTicks < (slow ? 4 : 2)) return;
    openScreenAsk(d);
  }, 1500);

  /** 승인 창 → 폰 승인 카드 */
  const openApproval = (ev) => {
    const name = String(ev.tool_name ?? "");
    const inp = ev.tool_input ?? {};
    let detail;
    if (name === "Bash") detail = String(inp.command ?? "");
    else if (name === "Write") detail = `${inp.file_path ?? ""}\n\n${String(inp.content ?? "")}`;
    else if (name === "Edit") detail = `${inp.file_path ?? ""}\n\n- ${String(inp.old_string ?? "")}\n+ ${String(inp.new_string ?? "")}`;
    else {
      try {
        detail = JSON.stringify(inp, null, 2);
      } catch {
        detail = "";
      }
    }
    const id = `cc-a-${Date.now()}`;
    const item = {
      id, kind: "danger", label: `Claude Code · ${describeTool(name, inp)}`, to: "", detail: clip(detail, 20_000), since: Date.now(),
      source: "approval", ...(name === "Bash" && inp.description ? { purpose: String(inp.description) } : {}),
    };
    for (const old of [...approvals.keys()]) approvalDone(old);   // 맥 창은 한 번에 하나
    screenAskDone();   // 같은 창을 화면에서 먼저 보고 연 카드가 있으면 승인 카드로 바꿈
    approvals.set(id, item);
    broadcast({ t: "approval", item });
    setStatus("asking");
    askNotify("approval", "승인이 필요합니다", `${describeTool(name, inp)}\n${summarizeTool(name, inp)}`);
  };

  /** 묻는 알림(질문·승인·Claude Code 의 '입력이 필요함'): 같은 탭에서 5초 안에는 한 번만. 한 응답에서 카드가 연달아 열려도 알림은 하나
   *  (카드는 모두 열리므로 폰을 열면 다 보인다. 11-15 사용자 보고 '질문이 두세 개면 알림도 두세 개') */
  const askNotify = (kind, title, body) => {
    if (Date.now() - lastAskNotify < 5000) return;
    lastAskNotify = Date.now();
    notifyPhone(kind, title, body);
  };

  /** 고르는 질문(AskUserQuestion) → 폰 질문 카드 */
  const openQuestion = (ev, { quiet = false } = {}) => {
    const qs = (Array.isArray(ev.tool_input?.questions) ? ev.tool_input.questions : [])
      .map((q) => ({
        question: String(q?.question ?? ""),
        options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({ label: String(o?.label ?? ""), description: String(o?.description ?? "") })),
        multiSelect: !!q?.multiSelect,
        ...((Array.isArray(q?.options) ? q.options : []).some((o) => o?.preview) && !q?.multiSelect ? { preview: true } : {}),   // 맥 창의 키가 다름(answerKeys)
      }))
      .filter((q) => q.question.trim() && q.options.length);
    if (!qs.length) return;
    const id = `cc-q-${ev.tool_use_id ?? Date.now()}`;
    if (questions.has(id)) return;   // 훅과 대화 기록이 둘 다 알려 와도 카드·푸시는 한 번
    if (questions.size) {   // 앞 질문 카드가 열려 있으면 기다림(맥도 차례로 띄움)
      if (!questionWaiting.some((w) => w.tool_use_id === ev.tool_use_id)) questionWaiting.push(ev);
      return;
    }
    const first = (t) => lines(t)[0] ?? t;
    const item = qs.length > 1
      ? { id, question: [`질문 ${qs.length}개`, ...qs.map((q, i) => `${i + 1}. ${first(q.question)}`)].join("\n"), options: [], multiSelect: false, items: qs, since: Date.now() }
      : { id, question: qs[0].question, options: qs[0].options, multiSelect: qs[0].multiSelect, since: Date.now() };
    screenAskDone();
    questions.set(id, { item, qs });
    broadcast({ t: "question", question: item });
    setStatus("asking");
    if (!quiet) askNotify("choice", "선택이 필요해요", qs.length > 1 ? `질문 ${qs.length}개 · ${first(qs[0].question)}` : first(qs[0].question));
  };

  // 같은 훅이 두 군데(전역 설정·플러그인 등)에 걸려 같은 이벤트가 두 번 오면 한 번만
  const seenHooks = new Map();
  // 받은 훅 기록(원인 찾기용, 칸마다 최근 300줄): 시각 이벤트 도구 대화번호앞 출처
  const hookLog = `${dir}/${pane.replace(/\W/g, "")}.hooks.log`;
  let hookLogLines = 0;
  const logHook = (line) => {
    try {
      appendFileSync(hookLog, `${new Date().toLocaleTimeString("en-GB")} ${line}\n`);
      if (++hookLogLines % 50 === 0) {
        const ls = readFileSync(hookLog, "utf8").split("\n").filter(Boolean);
        if (ls.length > 400) writeFileSync(hookLog, `${ls.slice(-300).join("\n")}\n`);
      }
    } catch {
      /* 기록 실패는 무시 */
    }
  };
  noteCompacting(tmux("capture-pane", "-p", "-t", pane) ?? "");   // 압축하는 도중에 뜬 연결부도 처음부터 알게(기록을 남기므로 logHook 뒤에서)
  let lastHookAt = 0;
  const onHook = (ev) => {
    lastActivity = Date.now();
    lastHookAt = Date.now();
    logHook(`${ev?.hook_event_name ?? "?"} ${ev?.tool_name ?? ""} ${String(ev?.session_id ?? "").slice(0, 8)} ${ev?.source ?? ev?.trigger ?? ""}${ev?.agent_id ? ` 에이전트=${ev.agent_type || String(ev.agent_id).slice(0, 6)}` : ""} 작업중=${working}`);
    const key = `${ev?.hook_event_name}|${ev?.tool_use_id ?? ""}|${JSON.stringify(ev?.tool_input ?? ev?.prompt ?? ev?.message ?? "")}`;
    const now = Date.now();
    for (const [k, at] of seenHooks) if (now - at > 1500) seenHooks.delete(k);
    if (seenHooks.has(key)) return;
    seenHooks.set(key, now);
    if (ev?.transcript_path) load(ev.transcript_path);
    const name = ev?.hook_event_name;
    // 하위·백그라운드 에이전트의 도구 훅(agent_id 가 있음)은 본 세션의 작업이 아님 → 작업 중·탭 점을 바꾸지 않음
    // (사용자 보고 11-12: 백그라운드 에이전트가 많은 탭이 쉬는데도 '작업 중'으로 남음. 승인 요청은 그대로 카드로)
    if (ev?.agent_id && (name === "PreToolUse" || name === "PostToolUse")) return;
    if (name === "SessionStart") {
      setStatus("");
    } else if (name === "UserPromptSubmit") {
      clearCards();
      working = true;
      workSince = Date.now();
      broadcast({ t: "working", value: true, since: workSince });
      setStatus("working");
    } else if (name === "PreToolUse") {
      readNew(false);
      for (const id of [...approvals.keys()]) approvalDone(id);   // 다음 도구가 돌면 앞 승인은 끝난 것
      // 도구 실행 직전 훅은 작업 중에만 옴 → 피드가 새로 떠서 모르고 있었어도 작업 중으로(주황)
      if (!working) {
        working = true;
        workSince = workSince || Date.now();
        broadcast({ t: "working", value: true, since: workSince });
      }
      if (ev.tool_use_id) broadcast({ t: "tool", id: ev.tool_use_id, state: "running" });
      if (ev.tool_name === "AskUserQuestion") openQuestion(ev);
      else setStatus("working");
    } else if (name === "PostToolUse") {
      readNew(false);
      for (const id of [...approvals.keys()]) approvalDone(id);
      if (ev.tool_name === "AskUserQuestion") questionDone(`cc-q-${ev.tool_use_id}`);
      pushTodos();
      if (ev.tool_use_id) broadcast({ t: "tool", id: ev.tool_use_id, state: ev.tool_response?.is_error ? "error" : "done" });
      // 도구가 끝난 뒤에도 본 세션은 이어서 일함 → 시작 훅을 놓쳤거나 잘못 꺼졌어도 다시 작업 중으로(11-14: 맥이 바쁘면 훅이 빠짐)
      if (!working) {
        working = true;
        workSince = workSince || Date.now();
        broadcast({ t: "working", value: true, since: workSince });
      }
      setStatus("working");
    } else if (name === "PermissionRequest") {
      if (ev.tool_name !== "AskUserQuestion") openApproval(ev);
    } else if (name === "Notification") {
      const type = String(ev.notification_type ?? "");
      if (type === "idle_prompt") return;   // 입력을 기다린다는 알림은 '끝남'으로 이미 표시
      setStatus("asking");
      // 폰에 질문·승인 카드가 떠 있으면 그 카드를 열 때 이미 알렸다. Claude Code 는 창이 뜨고 6~7초 뒤 같은 일로 이 알림을 또 보내서
      // 질문 하나에 알림이 둘씩 갔다('선택이 필요해요' 뒤 'Claude Code 가 물어봐요', 11-15 사용자 보고). 카드가 없을 때(연결부가 모르는 창)만 알림
      if (questions.size || approvals.size || screenAsk) return;
      askNotify(type.includes("permission") ? "approval" : "prompt", "Claude Code 가 물어봐요", ev.message ?? "");
    } else if (name === "Stop") {
      lastStopAt = Date.now();   // 같은 차례의 늦게 읽힌 기록 줄로 다시 켜지지 않게(아래 readNew 전에)
      readNew(false);
      clearCards();
      working = false;
      conv.clearQueue();
      pushQueue();
      broadcast({ t: "working", value: false });
      const text = conv.lastAnswerText();
      const ls = lines(text);
      const tail = ls[ls.length - 1] ?? "";
      const durationSec = workSince ? (Date.now() - workSince) / 1000 : 0;
      pushTodos();
      const bg = QUESTION_END.test(tail) ? null : bgInfo(pane);
      if (switching) {
        setStatus(viewing() ? "" : "yourturn");   // 계정 전환 중의 인수인계 답: 폰 알림 없음(전환 안내가 따로 감)
      } else if (bg) {
        // 다른 탭이 시킨 백그라운드 일(/bgtab)·단축어로 시킨 일: 시간과 상관없이 알림 + (시킨 탭이 있으면) 그 탭에 결과 요약
        setStatus(viewing() ? "" : "yourturn");
        notifyPhone("done", `백그라운드 작업이 끝났어요: ${bg.name}`, ls[0] ?? "결과를 확인해 주세요", { durationSec, background: true });
        bgReport(bg, text);
      } else if (QUESTION_END.test(tail)) {
        setStatus("asking");
        notifyPhone("question", "질문이 있어요", tail);
      } else {
        setStatus(viewing() ? "" : "yourturn");
        const min = Math.round(durationSec / 60);
        notifyPhone("done", min >= 1 ? `작업이 끝났어요(${min}분)` : "작업이 끝났어요", ls[0] ?? "답을 확인해 주세요", { durationSec });
      }
      workSince = null;
    } else if (name === "SessionEnd") {
      if (!switching) finish();   // 계정을 바꾸려고 끈 것이면 이 연결부가 다시 켜서 이어 씀
    }
  };

  /** 끝난 백그라운드 일 보고: 시킨 탭 연결부에 결과, 이 탭은 다시 보고하지 않게 표시를 지우고 끝난 때를 적음(앱 서랍이 보임) */
  const bgReport = (bg, text) => {
    const win = tmux("display", "-p", "-t", pane, "#{window_index}");
    tmux("set-option", "-w", "-u", "-t", pane, "@bg_origin");
    tmux("set-option", "-w", "-t", pane, "@bg_done", String(Math.floor(Date.now() / 1000)));
    if (!bg.origin) return;   // 단축어로 시킨 일: 시킨 탭이 없어 폰 알림만
    const path = `${HOME}/.cache/pi-remote/feed/${bg.origin.replace(/\W/g, "")}.sock`;
    if (!existsSync(path)) return;   // 시킨 탭이 닫혔음(폰 알림은 감)
    const c = createConnection(path);
    c.on("error", () => {});
    c.end(`${JSON.stringify({ cmd: "bg-result", name: bg.name, window: Number(win), by: bg.by, ok: true, text: clip(String(text ?? ""), 3000) })}\n`);
  };
  // ── 잘못 남은 '작업 중' 바로잡기(사용자 보고 11-12: 쉬는 동안 자동 압축 뒤 '작업 중'이 계속 남음, 끝 훅을 못 받은 경우) ──
  // 작업 중으로 알고 있는데 화면에 일하는 표시(screenBusy: 'esc to interrupt' 또는 진행 줄)가 없고, 입력창 위쪽 화면도 그대로이고,
  // 확인 창·카드도 없고, 마지막 훅·대화 기록이 20초 넘게 조용한 상태가 15초(5초 × 3번) 이어지면 쉬는 중으로 되돌림. 폰 알림은 보내지 않음.
  // 화면이 움직이는지도 보는 까닭(11-14 사용자 보고 '처리 중인데 표시가 안 보임'): 맥이 바쁘면 훅이 시간 안에 못 끝나 연결부에 안 오고,
  // 진행 줄 모양도 판마다 달라져(예: 훅이 도는 동안의 '(running … hooks… 1/2 · 8m 49s')) 일하는 중을 끄는 일이 하루 수십 번 있었다
  let idleSeen = 0;
  let lastTop = null;
  setInterval(() => {
    // 연결부는 쉬는 중으로 아는데 탭 상태만 '작업 중'으로 남은 경우(예전 연결부가 남긴 값 등)도 같이 봄
    const stale = !working && tmux("show-options", "-w", "-v", "-t", pane, "@pi_status") === "working";
    const quiet = Date.now() - Math.max(lastHookAt, lastConvAt) >= 20_000;
    if ((!working && !stale) || switching || approvals.size || questions.size || !quiet) {
      idleSeen = 0;
      lastTop = null;
      return;
    }
    const scr = tmux("capture-pane", "-p", "-t", pane) ?? "";
    const top = aboveInput(scr);
    const moving = top !== null && lastTop !== null && top !== lastTop;
    lastTop = top;
    const busy = screenBusy(scr) || /Esc to cancel/.test(scr) || moving;
    idleSeen = !busy && readMode() ? idleSeen + 1 : 0;
    if (idleSeen < 3) return;
    idleSeen = 0;
    lastTop = null;
    if (working) {
      working = false;
      workSince = null;
      broadcast({ t: "working", value: false });
    }
    if (tmux("show-options", "-w", "-v", "-t", pane, "@pi_status") === "working") setStatus(viewing() ? "" : "yourturn");
    // 다음에 원인을 볼 수 있게 그때 화면의 진행 줄 자리(입력창 바로 위 두 줄)와 모드 줄을 함께 적음
    const near = (top ?? "").split("\n").filter((l) => l.trim()).slice(-2);
    const mode = scr.split("\n").filter((l) => l.trim()).slice(-1);
    logHook(`바로잡음: 화면에 작업 표시가 없어 작업 중 → 쉬는 중 | ${[...near, ...mode].map((l) => l.trim().slice(0, 120)).join(" ⏎ ")}`);
  }, Number(process.env.PI_REMOTE_IDLE_CHECK_MS ?? 5000));

  // 뒤에서 도는 일(셸·에이전트)을 탭 옵션 @ai_jobs 에 적음(바뀔 때만). 브리지가 탭 목록과 함께 앱에 보내 서랍에 보임.
  // 화면에서 센 것에 대화 기록으로 아는 에이전트·감시 수를 합친다(knownJobs: 화면 표시가 바뀌어 못 세도 서랍에 보이게).
  // 처음 한 번은 꼭 적거나 지움(예전 연결부가 남긴 값이 있을 수 있어서)
  let jobsShown = null;
  setInterval(() => {
    if (switching) return;
    const jobs = mergeJobs(backgroundJobs(tmux("capture-pane", "-p", "-t", pane) ?? ""), knownJobs());
    if (jobs === jobsShown) return;
    jobsShown = jobs;
    if (jobs) tmux("set-option", "-w", "-t", pane, "@ai_jobs", jobs);
    else tmux("set-option", "-w", "-u", "-t", pane, "@ai_jobs");
  }, Number(process.env.PI_REMOTE_JOBS_TICK_MS ?? 5000));

  // 이 탭이 시킨 백그라운드 일의 결과: 쉬는 동안(작업·확인 창·카드 없음, 입력창 빔) 대화에 넣음
  const bgResults = [];
  setInterval(() => {
    if (!bgResults.length || switching || working || approvals.size || questions.size) return;
    const scr = tmux("capture-pane", "-p", "-t", pane) ?? "";
    if (/Esc to cancel/.test(scr) || !readMode() || !inputEmpty(scr)) return;
    const r = bgResults.shift();
    const head = `[백그라운드 작업 ${r.ok === false ? "멈춤" : "끝"}] '${r.name}'(탭 ${r.window})`;
    paste(`${head}\n${String(r.text ?? "").trim()}\n\n(백그라운드 탭에서 끝난 일의 결과예요. 확인하고 한두 줄로만 답해 주세요)`);
  }, Number(process.env.PI_REMOTE_BG_TICK_MS ?? 3000));

  // ── 뒤에서 도는 작업 목록·종료(앱 서랍의 '백그라운드 작업 N') ──
  const run = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 });
    } catch (e) {
      return String(e?.stdout ?? "");   // lsof·pgrep 은 찾은 것이 없으면 1 로 끝남
    }
  };
  /** 그 파일을 열고 있는 프로세스 번호들 */
  const openers = (path) => (path ? run("lsof", ["-t", path]).split("\n").map(Number).filter(Boolean) : []);
  /** 이 칸 Claude Code 를 켠 때(ms, 세션 파일). 그 전에 시작한 에이전트·감시는 Claude Code 와 함께 끝났다 */
  const claudeStartedAt = () => {
    const shell = String(tmux("display", "-p", "-t", pane, "#{pane_pid}") ?? "").trim();
    if (!shell) return 0;
    for (const pid of [shell, ...run("pgrep", ["-P", shell]).split("\n").filter(Boolean)]) {
      try {
        const s = JSON.parse(readFileSync(`${HOME}/.claude/sessions/${pid}.json`, "utf8"));
        if (s.startedAt) return Number(s.startedAt);
      } catch {
        /* 세션 파일 없음 */
      }
    }
    return 0;
  };
  /** 셸 출력의 끝 몇 줄(색 코드는 뺌) */
  const tailOf = (path) => {
    try {
      const size = statSync(path).size;
      const n = Math.min(size, 4096);
      const buf = Buffer.alloc(n);
      const fd = openSync(path, "r");
      try {
        readSync(fd, buf, 0, n, size - n);
      } finally {
        closeSync(fd);
      }
      return buf.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n|\r/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-4).map((l) => l.slice(0, 160)).join("\n");
    } catch {
      return "";
    }
  };
  /** 그 출력 파일을 연 프로세스 가운데, 이 칸의 Claude Code 가 띄운 명령 셸(shell-snapshots 를 읽음)이 우두머리인 프로세스 묶음들.
   *  비어 있으면 그 셸 작업은 끝났다(끝 알림을 못 받았어도). Claude Code 자신이나 칸 밖에서 같은 파일을 연 프로세스는 넣지 않는다 */
  const shellGroups = (output) => {
    const pids = openers(output);
    if (!pids.length) return new Set();
    const panePid = Number(String(tmux("display", "-p", "-t", pane, "#{pane_pid}") ?? "").trim());
    const table = new Map();
    for (const l of run("ps", ["-axo", "pid=,ppid=,pgid=,command="]).split("\n")) {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (m) table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4] });
    }
    const inPane = (pid) => {
      for (let p = pid, i = 0; p > 1 && i < 16; i++) {
        if (p === panePid) return true;
        p = table.get(p)?.ppid ?? 0;
      }
      return false;
    };
    const groups = new Set();
    for (const pid of pids) {
      const g = table.get(pid)?.pgid;
      const leader = g ? table.get(g) : null;
      if (leader && leader.pid !== panePid && /shell-snapshots\//.test(leader.command) && inPane(leader.pid)) groups.add(g);
    }
    return groups;
  };
  /** 하위 에이전트의 종류·모델(짧은 이름)·생각 깊이(확실할 때만, subagentThinking). 깊이는 처음 물을 때 한 번 정함(시작 때 시킨 쪽 깊이에 가깝게) */
  const agentInfo = (j) => {
    j.thinking ??= subagentThinking({ type: j.type, effort: j.effort, defEffort: agentDefEffort(j.type, j.cwd), model: j.model, parentModel: j.parentModel,
      parentThinking: tmux("show-options", "-w", "-v", "-t", pane, "@ai_thinking") ?? "", envEffort: process.env.CLAUDE_CODE_EFFORT_LEVEL });
    return { agentType: j.type, model: j.model ? prettyModel(j.model) : "", thinking: j.thinking };
  };
  /** 시간 제한이 지난 감시: 끝났다는 알림을 못 읽었어도 끝난 것으로 본다(제한이 없는 감시·에이전트는 늘 아님) */
  const expired = (j) => Boolean(j.expiresAt) && Date.now() > j.expiresAt;
  /** 지금 도는 작업(시작 순). 셸은 이 칸 Claude Code 가 띄운 셸이 출력 파일을 열고 있어야, 에이전트·감시는 Claude Code 를 켠 뒤에 시작했어야
   *  (감시는 시간 제한도 남아 있어야) */
  const jobList = () => {
    const since = claudeStartedAt();
    const out = [];
    for (const j of bgJobs.values()) {
      if (j.kind === "shell" ? !shellGroups(j.output).size : (since && j.startedAt < since) || expired(j)) continue;
      out.push({ id: j.id, kind: j.kind, title: j.title.slice(0, 120), startedAt: j.startedAt, ...(j.kind === "shell" ? { tail: tailOf(j.output) } : {}),
        ...(j.kind === "agent" ? agentInfo(j) : {}) });
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  };
  /** 대화 기록으로 아는, 지금 뒤에서 도는 에이전트·감시 수(jobList 와 같은 조건) → { 에이전트, 감시 }. 서랍의 수(@ai_jobs)에 합침.
   *  셸은 넣지 않는다: 도는지 알려면 프로세스를 뒤져야 하고, 화면의 모드 줄에 수가 그대로 나온다 */
  const knownJobs = () => {
    const tracked = [...bgJobs.values()].filter((j) => j.kind !== "shell");
    if (!tracked.length) return {};
    const since = claudeStartedAt();
    const live = tracked.filter((j) => !(since && j.startedAt < since) && !expired(j));
    return { 에이전트: live.filter((j) => j.kind === "agent").length, 감시: live.filter((j) => j.kind === "monitor").length };
  };
  /** 뒤에서 도는 하위 에이전트(jobList 와 같은 조건) → 맥 화면 한 줄에 쓸 [{ type, model, thinking }] */
  const runningAgents = () => {
    const agents = [...bgJobs.values()].filter((j) => j.kind === "agent");
    if (!agents.length) return [];
    const since = claudeStartedAt();
    return agents.filter((j) => !(since && j.startedAt < since)).map((j) => {
      const a = agentInfo(j);
      return { type: a.agentType, model: a.model, thinking: a.thinking };
    });
  };
  // 맥 화면 상태 줄 아래 한 줄: 이 탭이 맡긴 백그라운드 탭과 뒤에서 도는 하위 에이전트의 모델·생각 깊이, 셸 수(사용자 결정 11-16).
  // 칸 옵션 @ai_bg_line 에 적으면 상태 줄 스크립트(~/.claude/statusline.py 등)가 붙인다. 바뀔 때만 적고, 처음 한 번은 꼭 적거나 지움
  let bgLineShown = null;
  setInterval(() => {
    if (switching) return;
    const line = bgLine({ tabs: bgTabsFrom(pane), agents: runningAgents(), jobs: jobsShown ?? "" });
    if (line === bgLineShown) return;
    bgLineShown = line;
    if (line) tmux("set-option", "-w", "-t", pane, "@ai_bg_line", line);
    else tmux("set-option", "-w", "-u", "-t", pane, "@ai_bg_line");
  }, Number(process.env.PI_REMOTE_JOBS_TICK_MS ?? 5000));
  /** 앱에 보낼 목록(어느 탭의 목록인지 창 번호를 실음: 탭을 바꾸는 사이 들어온 다른 탭의 목록은 앱이 버림) */
  const jobsReply = () => ({ t: "bg-jobs", window: Number(tmux("display", "-p", "-t", pane, "#{window_index}") ?? -1), jobs: jobList() });
  /** 셸 작업 종료: 그 셸의 프로세스 묶음만(셸과 그 안에서 돌던 명령까지) 종료한다. 못 하면 그 까닭 */
  const killShell = async (j) => {
    if (!openers(j.output).length) return "이미 끝난 작업이에요";
    const groups = shellGroups(j.output);
    if (!groups.size) return "이 탭의 Claude Code 가 띄운 셸을 찾지 못해 종료하지 않았어요";
    for (const g of groups) {
      try {
        process.kill(-g, "SIGTERM");
      } catch {
        /* 이미 끝남 */
      }
    }
    await sleepMs(1500);
    for (const g of groups) {
      try {
        process.kill(-g, 0);
        process.kill(-g, "SIGKILL");   // 1.5초 뒤에도 남았으면
      } catch {
        /* 끝남 */
      }
    }
    return null;
  };
  /** 작업 종료: 셸은 바로 종료하고, 에이전트·감시는 Claude 에게 TaskStop 으로 종료해 달라고 보냄(사용자 결정 11-14). 끝나면 새 목록을 보냄 */
  const killJob = async (id, sock) => {
    const j = bgJobs.get(String(id ?? ""));
    if (!j || expired(j)) write(sock, { t: "notice", text: "그 작업은 이미 끝났어요" });
    else if (j.kind === "shell") {
      const err = await killShell(j);
      write(sock, { t: "notice", text: err ?? `'${j.title.slice(0, 40)}' 작업을 종료했어요` });
      logHook(`뒤에서 도는 셸 종료 ${j.id}: ${err ?? "종료함"}`);
    } else {
      const what = j.kind === "agent" ? "에이전트" : "감시";
      const ok = paste(`TaskStop 도구로 뒤에서 도는 ${what} '${j.title.slice(0, 80)}'(작업 번호 ${j.id}) 작업을 종료해 주세요. 그 밖의 일은 하던 대로 이어서 하세요.`);
      write(sock, { t: "notice", text: ok ? `Claude 에게 ${what} 작업을 종료해 달라고 보냈어요` : "맥 Claude Code 에 보내지 못했어요" });
      logHook(`뒤에서 도는 ${what} 종료 부탁 ${j.id}: ${ok ? "보냄" : "보내지 못함"}`);
    }
    write(sock, jobsReply());
  };

  const onCommand = (o, sock) => {
    if (o?.cmd !== "hook" && o?.cmd !== "detail" && o?.cmd !== "toolimage" && o?.cmd !== "bg-jobs") lastActivity = Date.now();
    // 계정 전환 중(인수인계·비우기·다시 켜기)에 넣은 글은 비워질 대화나 셸에 들어가므로 받지 않음
    if (switching && ["send", "slash", "set-model", "set-thinking", "compact", "set-account"].includes(o?.cmd)) {
      return void write(sock, { t: "notice", text: "계정을 바꾸는 중이라 지금은 보낼 수 없어요. 다시 켜진 뒤 보내 주세요" });
    }
    switch (o?.cmd) {
      case "hook": return onHook(o.event);
      case "set-account": return pickAccount(String(o.account ?? ""), sock);
      case "bg-jobs": return void write(sock, jobsReply());
      case "bg-job-kill": return void killJob(o.id, sock);
      case "bg-result": {
        bgResults.push(o);
        broadcast({ t: "notice", text: `백그라운드 작업 '${String(o.name ?? "")}'(탭 ${o.window})이 끝났어요. 쉴 때 결과를 대화에 넣을게요` });
        return;
      }
      case "send": {
        // 앱은 글 안에 '@사진경로'를 넣어 보냄 → 글에 없는 사진만 덧붙임
        const body = String(o.text ?? "");
        const imgs = (Array.isArray(o.images) ? o.images : []).map(String)
          .filter((p) => /\/\.cache\/pi-remote\/img-\d+\.(jpe?g|png)$/i.test(p) && !body.includes(p));
        const text = [body, ...imgs].filter(Boolean).join("\n");
        // '멈추고 보내기'면 먼저 Esc 로 Claude Code 작업을 멈춤
        if (o.mode === "interrupt" && working) tmux("send-keys", "-t", pane, "Escape");
        if (!text || !paste(text)) write(sock, { t: "notice", text: "맥 Claude Code 에 보내지 못했어요" });
        return;
      }
      case "slash": {
        // 브리지가 넘긴 pi 식 명령을 Claude Code 명령으로
        let t = String(o.text ?? "").trim();
        const pm = t.match(/^\/mode (\S+)$/) ?? (t === "/plan on" ? [t, "plan"] : t === "/plan off" ? [t, "auto"] : null);
        if (pm) return void setMode(pm[1] === "ask" ? "manual" : pm[1], sock);   // 권한 모드는 Shift+Tab 으로
        if (t === "/new") t = "/clear";
        const th = t.match(/^\/thinking (\S+)$/);
        if (th) { const lv = EFFORT[th[1]] ?? th[1]; t = `/effort ${lv}`; setThinkingChip(lv); }
        const md = t.match(/^\/model (?:[^/\s]+\/)?(\S+)$/);
        if (md) t = `/model ${md[1]}`;
        paste(t);
        return;
      }
      case "set-model": return void paste(`/model ${String(o.id ?? "")}`);
      case "set-thinking": {
        const lv = EFFORT[String(o.level ?? "")] ?? String(o.level ?? "");
        setThinkingChip(lv);
        return void paste(`/effort ${lv}`);
      }
      case "compact":
        if (compactSince) return void write(sock, { t: "notice", text: "이미 대화를 압축하는 중이에요" });
        return void paste("/compact");
      case "approval": {
        // 폰 승인 카드: 허용은 '1', 거부는 Esc(맥 창과 같음)
        const id = String(o.id ?? "");
        if (!approvals.has(id)) return;
        approvalDone(id);
        if (o.approved === true) setStatus("working");
        return void pressKeys([{ key: o.approved === true ? "1" : "Escape" }]);
      }
      case "question-answer": {
        const id = String(o.id ?? "");
        if (screenAsk?.id === id) return void answerScreenAsk(o);
        const q = questions.get(id);
        if (!q) return;
        questionDone(id);
        if (o.cancel === true) return void pressKeys([{ key: "Escape" }]);
        const answers = q.qs.length > 1 ? (Array.isArray(o.items) ? o.items : []) : [{ answers: o.answers, other: o.other }];
        setStatus("working");
        return void pressKeys(answerKeys(q.qs, answers));
      }
      case "detail": return write(sock, { t: "detail", detail: { key: String(o.key ?? ""), ...conv.detail(o) } });
      case "toolimage": {
        const data = conv.image(String(o.id ?? ""));
        return write(sock, { t: "toolimage", id: String(o.id ?? ""), ...(data ? { data } : { error: "그림을 찾지 못했어요" }) });
      }
      default:
        if (o?.cmd) write(sock, { t: "notice", text: "Claude Code 탭에서는 아직 안 되는 기능이에요" });
    }
  };

  let server = null;
  const finish = () => {
    screenAskDone();   // 종료 안내 창에서 끈 것이면 폰 카드도 닫음
    setStatus("");
    tmux("set-option", "-w", "-u", "-t", pane, "@ai_model");
    tmux("set-option", "-w", "-u", "-t", pane, "@ai_thinking");
    tmux("set-option", "-w", "-u", "-t", pane, "@ai_jobs");
    tmux("set-option", "-w", "-u", "-t", pane, "@ai_bg_line");
    try {
      server?.close();
      unlinkSync(sockPath);
    } catch {
      /* 이미 없음 */
    }
    dropRev();
    setTimeout(() => process.exit(0), 200);
  };

  mkdirSync(dir, { recursive: true });
  try {
    unlinkSync(sockPath);
  } catch {
    /* 없으면 무시 */
  }
  server = createServer((sock) => {
    const drop = () => clients.delete(sock);
    sock.on("close", drop);
    sock.on("error", drop);
    // 붙자마자 대화 전체를 쓰지 않는다. 훅은 한 줄을 보내고 곧 닫는데, 연결부가 바빠 그 연결을 늦게 받으면 닫힌 소켓에 쓰다 오류가 나고
    // 아직 읽지 않은 그 줄까지 버려졌다(11-14: 한 탭에서 훅이 대부분 사라짐, 연결부를 멈춘 사이 보낸 훅 5개가 모두 사라지는 것으로 확인).
    // 첫 줄이 훅(once)이면 대화를 보내지 않고 처리한 뒤 '받았음'만 답한다. 그 밖(브리지 등)에는 첫 줄이나 잠시 뒤에 대화를 보내고 방송 대상에 넣는다
    let greeted = false;
    const greet = () => {
      if (greeted || sock.destroyed) return;
      greeted = true;
      clients.add(sock);
      write(sock, snapshot());
      write(sock, { t: "commands", commands: COMMANDS });
    };
    const timer = setTimeout(greet, 150);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;   // 잘못된 줄 무시
        }
        const once = !greeted && o?.cmd === "hook" && o.once === true;
        if (once) {
          clearTimeout(timer);
          greeted = true;
        } else greet();
        try {
          onCommand(o, sock);
        } catch {
          /* 처리 중 오류는 무시 */
        }
        if (once) write(sock, { t: "ack" });
      }
    });
  });
  server.listen(sockPath);
  // 이 칸의 연결부가 어느 판으로 도는지(점검 명령이 설치본과 견줘 봄)
  try {
    writeFileSync(revPath, `${CODE_REV}\n`);
  } catch {
    /* 적지 못해도 동작은 그대로 */
  }
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => {
      try {
        unlinkSync(sockPath);
      } catch {
        /* 이미 없음 */
      }
      dropRev();
      process.exit(0);
    });
  }
  // tmux 가 프로그램 이름으로 붙인 탭 이름(claude.exe·경로·버전 등)이면 'Claude' 로(직접 지은 이름은 그대로).
  // tmux 가 이름을 늦게 바꾸므로 시작 2초 뒤와 주기 확인 때 봄
  let lastActivity = Date.now();
  let switching = false;
  const tidyName = () => {
    const n = tmux("display", "-p", "-t", pane, "#{window_name}") ?? "";
    if (/^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i.test(n)) tmux("rename-window", "-t", pane, "Claude");
  };
  setTimeout(tidyName, 2000);

  // ── 계정 자동 전환(pi 처럼, 사용자 결정 11-12): 폴더 기본 계정이 95% 넘으면 다른 계정, 초기화되면 돌아옴 ──
  // 셸에서 켠 Claude Code 만. 순서(사용자 결정 11-18): 일하는 중이면 멈춤 → 지금 세션에게 인수인계 문서를 받아 저장 → /clear →
  // /exit → 그 셸에 'claude-as.sh <계정> [켤 때 옵션] --permission-mode <지금 모드>'(같은 대화를 이어 켜지 않음) → 새 세션에 문서를 읽고 이어 가라는 글.
  // 기본 계정을 떠날 때(95% 넘음)는 일하는 중이어도 바로 시작(남은 5%로 문서를 써야 함). 돌아올 때는 예전처럼 쉴 때(1분 넘게 조용)만.
  // 어느 쪽이든 확인 창·질문 카드·돌고 있는 명령·뒤에서 도는 작업·입력창의 글이 있으면 기다린다.
  // 셸 함수 claude() 에 맡기지 않는다: 셸이 켜질 때 읽혀서, 함수를 고치기 전에 켠 셸에는 예전 정의가 남는다
  // (11-15: 11-11 에 켠 셸이 늘 개인으로 켜, 1분마다 끄고 켜기를 되풀이). claude-as.sh 가 없으면(예전 설치) 셸 함수로
  const SWITCH_TICK_MS = Number(process.env.PI_REMOTE_ACCOUNT_TICK_SEC ?? 30) * 1000;
  const SWITCH_IDLE_MS = Number(process.env.PI_REMOTE_SWITCH_IDLE_SEC ?? 60) * 1000;
  const SHELL_RE = /^-?(\S*\/)?(zsh|bash)$/;
  const CLAUDE_RE = /^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i;
  // 계정 전환을 쉬는 때. 연결부가 새로 떠도(Claude Code 를 다시 켜면 연결부도 새로 뜸) 이어지게 파일에 남긴다.
  // 남기지 않았을 때는 실패로 꺼진 Claude Code 를 다시 켜자마자 1분 뒤 같은 전환을 또 시도해 또 꺼졌다(11-15)
  const pauseFile = `${dir}/${pane.replace(/\W/g, "")}.switch-pause`;
  let switchPausedUntil = (() => {
    try {
      return Number(readFileSync(pauseFile, "utf8")) || 0;
    } catch {
      return 0;
    }
  })();
  const pauseSwitch = (ms) => {
    switchPausedUntil = Date.now() + ms;
    try {
      writeFileSync(pauseFile, String(switchPausedUntil));
    } catch {
      /* 남기지 못해도 이 연결부는 쉼 */
    }
  };
  const tabName = () => tmux("display", "-p", "-t", pane, "#{window_name}") ?? "";
  /** 이 대화의 기록 파일이 있는지(켜고 아무것도 묻지 않은 세션은 아직 없음). 폴더를 못 읽으면 있다고 봄(예전처럼 이어 켬) */
  const convExists = (sid) => {
    if (transcript && basename(transcript) === `${sid}.jsonl`) return existsSync(transcript);
    try {
      return readdirSync(`${HOME}/.claude/projects`).some((d) => existsSync(`${HOME}/.claude/projects/${d}/${sid}.jsonl`));
    } catch {
      return true;
    }
  };
  /** 셸에 칠 claude-as.sh 경로(이 파일 옆, 설치 때 함께 복사). 집 폴더 아래면 '~/…' 로 짧게, 특수 문자가 있으면 따옴표 */
  const claudeAs = () => {
    const p = join(dirname(SELF_PATH), "claude-as.sh");
    if (!existsSync(p)) return null;
    const rel = p.startsWith(`${HOME}/`) ? p.slice(HOME.length + 1) : "";
    if (rel && /^[\w./-]+$/.test(rel)) return `~/${rel}`;
    return /^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`;
  };
  const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4 << 20 });
  /** 이 칸의 Claude Code 프로세스(셸의 자식만): pid, 켤 때 명령, 폴더, 지금 계정(회사 토큰 환경 변수가 있으면 회사. 값은 읽지 않음) */
  const claudeProc = () => {
    const shellPid = String(tmux("display", "-p", "-t", pane, "#{pane_pid}") ?? "").trim();
    if (!shellPid || !SHELL_RE.test(sh("ps", ["-o", "comm=", "-p", shellPid]).trim())) return null;   // 셸 없이 켰으면 끄는 순간 탭이 닫힘
    for (const pid of sh("pgrep", ["-P", shellPid]).split("\n").filter(Boolean)) {
      const f = `${HOME}/.claude/sessions/${pid}.json`;
      if (!existsSync(f)) continue;
      const info = JSON.parse(readFileSync(f, "utf8"));
      const account = /(^|\s)CLAUDE_CODE_OAUTH_TOKEN=\S/.test(sh("ps", ["eww", "-o", "command=", "-p", pid])) ? "work" : "personal";
      return { pid, args: sh("ps", ["-ww", "-o", "args=", "-p", pid]).trim(), cwd: String(info.cwd ?? ""), sessionId: String(info.sessionId ?? ""), account };
    }
    return null;
  };
  const paneCmd = () => String(tmux("display", "-p", "-t", pane, "#{pane_current_command}") ?? "").trim();
  const screenNow = () => tmux("capture-pane", "-p", "-t", pane) ?? "";
  /** 다듬지 않은 화면(앞쪽 빈 줄·첫 칸 공백이 그대로라 줄 번호가 커서 줄과 맞음)과 커서 자리 */
  const screenRaw = () => {
    try {
      return execFileSync(TMUX, ["capture-pane", "-p", "-t", pane], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  const cursorAt = () => {
    const [x, y, width] = String(tmux("display", "-p", "-t", pane, "#{cursor_x} #{cursor_y} #{pane_width}") ?? "").split(" ").map(Number);
    return { x, y, width };
  };
  /** Claude Code 가 명령을 돌리는 중인지: 명령용 셸은 shell-snapshots 파일을 읽어 들인다(claude-reload.py 와 같은 판단) */
  const runsCommand = (pid) => {
    try {
      return sh("pgrep", ["-P", String(pid)]).split("\n").filter(Boolean).some((kid) => sh("ps", ["-o", "command=", "-p", kid]).includes("shell-snapshots/"));
    } catch {
      return false;   // 자식 없음
    }
  };
  const waitFor = async (fn, ms) => {
    for (let t = 0; t < ms; t += 250) {
      if (fn()) return true;
      await sleepMs(250);
    }
    return false;
  };
  // 인수인계 문서를 기다리는 최대 시간(사용자 결정 11-18: 10분). 넘으면 못 받은 것으로 보고 앞 대화 기록으로 이어 감
  const HANDOFF_WAIT_MS = Number(process.env.PI_REMOTE_HANDOFF_WAIT_SEC ?? 600) * 1000;
  /** 답이 끝난 화면: 일하는 표시·확인 창이 없고 모드 줄이 보임(입력창은 보지 않음: 그사이 맥에서 쓰는 글이 있어도 답은 끝남) */
  const doneScreen = () => {
    const s = screenNow();
    return !screenBusy(s) && !/Esc to cancel/.test(s) && !!shownMode(s);
  };
  /** 쉬는 화면: 답이 끝났고 입력창도 빔(글을 넣어도 되는 때) */
  const idleScreen = () => doneScreen() && inputEmpty(screenNow());
  /** '/명령'을 쓰고, 정확히 그 글만 들어갔는지 본 뒤 Enter(그사이 맥에서 글을 쓰기 시작했으면 지우고 false) */
  const typeSlash = async (cmd) => {
    tmux("send-keys", "-t", pane, "-l", cmd);
    await sleepMs(500);
    const line = screenNow().split("\n").filter((l) => /^❯/.test(l)).pop() ?? "";
    if (line.replace(/^❯\s?/, "").trim() !== cmd) {
      for (let i = 0; i < cmd.length; i++) tmux("send-keys", "-t", pane, "BSpace");
      return false;
    }
    tmux("send-keys", "-t", pane, "Enter");
    return true;
  };
  /** 입력창에 글을 넣고 Claude Code 가 받았는지(일하는 표시·새 답) 확인. 막 켜져 Enter 가 먹지 않았으면 Enter 를 다시 */
  const submit = async (text) => {
    const before = conv.lastAnswerText();
    if (!paste(text)) return false;
    for (let k = 0; k < 4; k++) {
      if (await waitFor(() => screenBusy(screenNow()) || conv.lastAnswerText() !== before, 5000)) return true;
      tmux("send-keys", "-t", pane, "Enter");
    }
    return false;
  };
  /** 인수인계 문서 저장: <작업 폴더>/.work/handoff/<시각>.md(작업 파일 자리, 사용자 규칙 11-18). 그 폴더에 쓸 수 없으면 ~/.cache/pi-remote/handoff.
   *  git 에 잡히지 않게 handoff 폴더에 모든 것을 빼는 .gitignore 를 둠 */
  const saveHandoff = (cwd, doc) => {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    for (const at of [join(cwd, ".work", "handoff"), `${HOME}/.cache/pi-remote/handoff`]) {
      try {
        mkdirSync(at, { recursive: true });
        if (!existsSync(join(at, ".gitignore"))) writeFileSync(join(at, ".gitignore"), "*\n");
        const p = join(at, `${stamp}.md`);
        writeFileSync(p, doc);
        return p;
      } catch {
        /* 다음 자리 */
      }
    }
    return null;
  };
  // ── 앱에서 탭마다 계정 고르기(사용자 결정 11-18) ──
  // 고른 계정은 tmux 탭 옵션 @ai_account_pin(work | personal, 없으면 자동: 폴더 기본·한도). 고른 계정도 한도 95% 면 다른 계정으로 넘김.
  // 앱이 보는 상태도 탭 옵션에 적는다(브리지가 탭 목록에 실음): @ai_account(지금 계정) · @ai_account_next(바꿀 계정) ·
  // @ai_account_phase(wait: 작업이 끝나기를 기다림 | switch: 바꾸는 중)
  const accountPin = () => {
    const v = String(tmux("show-options", "-w", "-v", "-t", pane, "@ai_account_pin") ?? "").trim();
    return v === "work" || v === "personal" ? v : "";
  };
  const shownAccount = {};   // 마지막으로 적은 값(같은 값은 다시 적지 않음)
  const showAccount = (key, value) => {
    if (shownAccount[key] === value) return;
    shownAccount[key] = value;
    if (value) tmux("set-option", "-w", "-t", pane, key, value);
    else tmux("set-option", "-w", "-u", "-t", pane, key);
  };
  // 앱에서 고른 때(0 이면 아님): 이 요청은 쉬는 즉시(1분 조용하기를 기다리지 않고, 쉬는 때 설정도 무시) 바꾼다. 한 번 시도하면 지움
  let manualAt = 0;

  const switchAccount = async (want, proc, { pin = "", manual = false } = {}) => {
    const back = want === baseAccount(proc.cwd || process.cwd(), pin);
    const name = want === "work" ? "회사" : "개인";
    const other = want === "work" ? "개인" : "회사";
    const args = relaunchArgs(proc.args, permMode);
    const sid = transcript ? basename(transcript).replace(/\.jsonl$/, "") : proc.sessionId;
    if (!args || !/^[0-9a-f-]{36}$/i.test(sid)) {
      pauseSwitch(6 * 3600_000);
      broadcast({ t: "notice", text: `${name} 계정으로 바꿔야 하는데, 켤 때 옵션을 알 수 없어 그대로 둬요. 맥에서 /clear 하고 나갔다가 claude 로 다시 켜 주세요` });
      return;
    }
    // 이어 받을 대화: 켜고 아무것도 묻지 않은 세션은 기록 파일이 아직 없음 → 인수인계·비우기 없이 바로 바꿈
    const hasConv = convExists(sid);
    const prevTranscript = transcript;
    const reason = manual ? (pin ? `앱에서 ${name} 계정을 골라` : `앱에서 자동으로 되돌려 ${name} 계정으로 바꾸려고`)
      : back ? (pin ? `고른 계정(${name})의 한도가 풀려` : `기본 계정(${name})의 한도가 풀려`)
      : pin ? `고른 ${other} 계정 사용 한도가 95%를 넘어` : `${other} 계정 사용 한도가 95%를 넘어`;
    let docPath = null;
    const docNote = () => (docPath ? ` 인수인계 문서: ${docPath}` : "");
    switching = true;
    showAccount("@ai_account_next", want);
    showAccount("@ai_account_phase", "switch");
    try {
      if (hasConv) {
        // 0) 일하는 중이면 Esc 로 멈춤(사용자 결정 11-18: 남은 5%로 문서를 써야 하므로 답이 끝나기를 기다리지 않음)
        let pending = "";
        if (!doneScreen()) {
          tmux("send-keys", "-t", pane, "Escape");
          await waitFor(doneScreen, 30_000);
          // 답이 나오기 전에 멈췄으면 방금 보낸 글이 입력창에 되돌아옴(11-18 확인) → 그 글은 인수인계로 넘기고 입력창을 비움
          await sleepMs(500);
          readNew(false);
          const shown = inputLine(screenNow());
          if (!inputEmpty(screenNow()) && restoredPrompt(shown, conv.lastPrompt())) {
            pending = conv.lastPrompt();
            tmux("send-keys", "-t", pane, "C-u");
          }
        }
        if (!(await waitFor(idleScreen, 30_000))) {
          pauseSwitch(5 * 60_000);
          return;
        }
        // 1) 인수인계 문서: 답으로 받아 이 연결부가 저장(권한 확인 창에 막히지 않게). 답이 끝나 화면이 3초 쉬면 끝으로 봄.
        //    첫 줄 '# 인수인계' 가 없으면(한도 오류 글 등) 못 받은 것
        broadcast({ t: "notice", text: `${reason} 하던 일을 멈추고 인수인계 문서를 받고 있어요(최대 ${Math.round(HANDOFF_WAIT_MS / 60_000)}분)` });
        const before = conv.lastAnswerText();
        const beforeId = conv.lastAnswerId();
        let doc = null;
        if (await submit(handoffAsk(reason, pending))) {
          let still = 0;
          for (const end = Date.now() + HANDOFF_WAIT_MS; Date.now() < end; ) {
            await sleepMs(1000);
            readNew(false);
            const text = conv.lastAnswerText();
            // 떠나는 계정이 이미 한도에 걸림: 문서는 오지 않으니 기다리지 않고 아래에서 그 창을 닫은 뒤 앞 대화 기록으로 이어 감.
            // 오류는 인수인계를 물은 뒤 새로 온 답만 본다(번호로 가림: 앞 답도 같은 한도 오류 글일 수 있음. 두 번째부터는 창 없이 글만 뜸)
            const id = conv.lastAnswerId();
            if (limitStopped(screenNow(), id && id !== beforeId ? conv.lastAnswerError() : null)) {
              logHook("계정 전환 인수인계: 떠나는 계정이 한도에 걸려 기다리지 않음");
              broadcast({ t: "notice", text: `${other} 계정이 사용 한도에 걸려 인수인계 문서를 쓸 수 없어요. 앞 대화 기록으로 이어 가게 할게요` });
              break;
            }
            still = text && text !== before && doneScreen() ? still + 1 : 0;
            if (still >= 3) {
              doc = handoffDoc(text);
              break;
            }
          }
        }
        if (!doneScreen()) {
          tmux("send-keys", "-t", pane, "Escape");   // 시간 안에 다 쓰지 못함 → 멈춤
          await waitFor(doneScreen, 30_000);
          // 답이 나오기 전이었으면(예: 한도가 다 차 재시도만 함) 인수인계 요청 글이 입력창에 되돌아옴 → 우리가 넣은 글이니 지움
          await sleepMs(500);
          readNew(false);
          if (!inputEmpty(screenNow()) && restoredPrompt(inputLine(screenNow()), conv.lastPrompt())) tmux("send-keys", "-t", pane, "C-u");
        }
        if (doc) docPath = saveHandoff(proc.cwd || process.cwd(), handoffWithPending(doc, pending));
        logHook(`계정 전환 인수인계: ${docPath ?? "받지 못함"}`);
        // 2) 대화 비우기(사용자가 정한 순서: /clear → 종료 → 계정 변경 → 다시 실행)
        if (!(await typeSlash("/clear"))) {
          pauseSwitch(5 * 60_000);
          if (docPath) broadcast({ t: "notice", text: `계정을 바꾸려다 맥 입력창에 글이 있어 멈췄어요. 5분 뒤 다시 해 볼게요.${docNote()}` });
          return;
        }
        await sleepMs(1000);
        await waitFor(idleScreen, 15_000);
      }
      // 3) /exit
      if (!(await typeSlash("/exit"))) {
        pauseSwitch(5 * 60_000);
        if (docPath) broadcast({ t: "notice", text: `계정을 바꾸려다 맥 입력창에 글이 있어 멈췄어요. 5분 뒤 다시 해 볼게요.${docNote()}` });
        return;
      }
      if (!(await waitFor(() => SHELL_RE.test(paneCmd()), 15_000))) {
        if (/Esc to cancel/.test(screenNow())) tmux("send-keys", "-t", pane, "Escape");
        pauseSwitch(30 * 60_000);
        broadcast({ t: "notice", text: `${name} 계정으로 바꾸려고 Claude Code 를 끄지 못했어요. 30분 뒤 다시 해 볼게요.${docNote()}` });
        return;
      }
      await sleepMs(400);
      // 4) 정한 계정으로 새 대화로 켬(claude-as.sh). 셸이 막 돌아왔을 때 첫 글자가 사라질 수 있어
      //    줄을 비우고 친 뒤 화면에 그대로 들어갔는지 보고 Enter(다르면 3번까지 다시)
      const as = claudeAs();
      const cmd = [...(as ? [as, want] : ["claude"]), ...args].join(" ");
      let typed = false;
      for (let k = 0; k < 3 && !typed; k++) {
        tmux("send-keys", "-t", pane, "C-u");
        await sleepMs(300);
        tmux("send-keys", "-t", pane, "-l", cmd);
        await sleepMs(500);
        typed = typedOnPrompt(screenRaw(), cmd, cursorAt());
      }
      if (!typed) {
        tmux("send-keys", "-t", pane, "C-u");
        pauseSwitch(6 * 3600_000);   // Claude Code 가 꺼진 채 남는 실패라 다시 켜도 한동안 시도하지 않음
        broadcast({ t: "notice", text: `Claude Code 를 끈 뒤 셸에 다시 켜는 명령을 넣지 못했어요. 맥에서 claude 로 다시 켜 주세요.${docNote()}` });
        notifyPhone("error", "Claude Code 계정 전환 실패", `'${tabName()}' 탭의 Claude Code 가 꺼졌어요. claude 로 다시 켜 주세요(6시간 동안 다시 시도하지 않아요).${docNote()}`);
        return;
      }
      tmux("send-keys", "-t", pane, "Enter");
      const up = await waitFor(() => CLAUDE_RE.test(paneCmd()) && !!readMode(), 40_000);
      // 3) 다시 켠 Claude Code 가 정말 그 계정인지(세션 파일이 생길 때까지 잠깐). 보지 않으면 계정이 그대로일 때
      //    맞게 켰다고 알리고, 쉴 때마다 끄고 켜기를 되풀이한다(11-15)
      let now = null;
      if (up) {
        await waitFor(() => {
          try {
            now = claudeProc();
          } catch {
            now = null;
          }
          return !!now;
        }, 10_000);
      }
      const wrong = !!now && now.account !== want;
      const how = !hasConv ? "" : docPath ? "(인수인계 문서로 이어 감)" : "(인수인계 문서를 받지 못해 앞 대화 기록으로 이어 감)";
      let text;
      if (!up) text = `${name} 계정으로 다시 켜는 데 실패했어요. claude 로 다시 켜 주세요(6시간 동안 다시 바꾸지 않아요).${docNote()}`;
      else if (wrong) text = `${name} 계정으로 다시 켰는데 ${other} 계정으로 켜졌어요. 6시간 동안 다시 바꾸지 않아요${how}`;
      else if (manual) text = `앱에서 고른 대로 ${name} 계정으로 다시 켰어요${how}`;
      else if (back) text = `한도가 풀려 ${pin ? "고른 " : ""}${name} 계정으로 돌아왔어요${how}`;
      else text = `${pin ? "고른 " : ""}${other} 계정 사용량이 95%를 넘어 ${name} 계정으로 다시 켰어요${how}`;
      broadcast({ t: "notice", text });
      if (!up || wrong) {
        pauseSwitch(6 * 3600_000);
        notifyPhone("error", "Claude Code 계정 전환 실패", `'${tabName()}' 탭: ${text}`);
      } else if (pin && !manual && !back) {
        // 앱에서 직접 고른 계정을 한도 때문에 떠남: 고른 것과 달라졌으니 폰에도 알림(사용자 결정 11-18)
        notifyPhone("account", "Claude Code 계정을 바꿨어요", `'${tabName()}' 탭: ${text}`);
      }
      // 5) 새 세션에 인수인계 문서(못 받았으면 앞 대화 기록)를 읽고 이어 가라는 글. 계정이 틀리게 켜졌어도 대화는 이미 비웠으니 넣음
      if (up && hasConv) {
        if (!(await waitFor(idleScreen, 20_000)) || !(await submit(handoffResume({ reason, docPath, transcript: prevTranscript })))) {
          broadcast({ t: "notice", text: `새 세션에 이어 갈 글을 넣지 못했어요. 맥에서 인수인계 문서를 읽게 해 주세요.${docNote() || ` 앞 대화 기록: ${prevTranscript}`}` });
        }
      }
    } finally {
      switching = false;
      lastActivity = Date.now();
      showAccount("@ai_account_next", "");
      showAccount("@ai_account_phase", "");
    }
  };
  /** 계정 판정에 쓸 모델: 대화 기록의 모델, 아직 없으면(막 켬·첫 답이 한도 오류) 켤 때 준 --model, 그것도 없으면 판정이 설정의 기본 모델을 씀 */
  const modelNow = (proc) => conv.model() ?? (String(proc?.args ?? "").match(/(?:^|\s)--model[= ](\S+)/) ?? [])[1] ?? "";
  const accountTick = () => {
    if (switching) return;
    let proc;
    try {
      proc = claudeProc();
    } catch {
      return;
    }
    if (!proc) return;
    showAccount("@ai_account", proc.account);
    const pin = accountPin();
    const cwd = proc.cwd || process.cwd();
    const want = desiredAccount(cwd, modelNow(proc), pin);
    if (want === proc.account) {
      manualAt = 0;
      showAccount("@ai_account_next", "");
      showAccount("@ai_account_phase", "");
      return;
    }
    showAccount("@ai_account_next", want);
    showAccount("@ai_account_phase", "wait");
    const manual = manualAt > 0;
    // 압축하는 중에도 끄지 않음: 쉬다가 하는 압축은 작업 중이 아닌 채로 1~2분 돈다(끄면 그 압축이 버려짐)
    if ((!manual && Date.now() < switchPausedUntil) || compactSince || approvals.size || questions.size) return;
    if (!working && !manual && Date.now() - lastActivity < SWITCH_IDLE_MS) return;
    const scr = screenNow();
    // 일하는 중에는 돌아올 곳(고른 계정·폴더 기본)을 떠날 때(95% 넘음)만 멈추고 바꿈(사용자 결정 11-18).
    // 돌아올 때와 앱에서 고른 때는 하던 일이 끝날 때까지 기다림(사용자 결정 11-18: '끝나면 바꾸기').
    // 글을 막 보낸 순간에는 '글을 받음' 훅이 아직 안 와 working 이 거짓일 수 있어 화면의 작업 표시도 본다
    // (11-19 시험: 그 순간 고른 요청이 쉬는 것으로 보고 인수인계 없이 꺼서 쓰던 답이 사라짐)
    if ((manual || want === baseAccount(cwd, pin)) && (working || screenBusy(scr))) return;
    if (/Esc to cancel/.test(scr) || !readMode() || !inputEmpty(scr)) return;
    // 뒤에서 도는 작업(셸·초안)이 있으면 끝날 때까지 기다림: 끄면 그 작업이 같이 죽는다(11-13 회사 탭의 23:33 대기 같은 것)
    if (backgroundShown(scr) || runsCommand(proc.pid)) return;
    manualAt = 0;   // 앱 요청은 한 번만 서두름: 실패하면 평소처럼 쉬는 때를 따름(실패한 전환을 되풀이하지 않게)
    void switchAccount(want, proc, { pin, manual });
  };
  setInterval(accountTick, SWITCH_TICK_MS);
  setTimeout(accountTick, 3000);   // 켜자마자 앱에 지금 계정을 알림
  /** 앱에서 이 탭의 계정을 고름(account: work | personal | auto) */
  const pickAccount = (account, sock) => {
    const pin = account === "work" || account === "personal" ? account : "";
    if (pin === "work" && !hasWorkToken()) return void write(sock, { t: "notice", text: "이 맥에 회사 계정 토큰이 없어 회사 계정을 고를 수 없어요" });
    if (pin) tmux("set-option", "-w", "-t", pane, "@ai_account_pin", pin);
    else tmux("set-option", "-w", "-u", "-t", pane, "@ai_account_pin");
    let proc = null;
    try {
      proc = claudeProc();
    } catch {
      proc = null;
    }
    if (!proc) return void write(sock, { t: "notice", text: "셸에서 켠 Claude Code 가 아니라 계정을 바꿀 수 없어요. 고른 계정은 다음에 켤 때부터 써요" });
    const want = desiredAccount(proc.cwd || process.cwd(), modelNow(proc), pin);
    const name = (a) => (a === "work" ? "회사" : "개인");
    let text;
    if (want === proc.account) {
      text = pin ? `이미 ${name(want)} 계정이에요. 이 탭은 앞으로 ${name(want)} 계정을 써요(한도가 95%를 넘으면 다른 계정으로 넘어가요)` : "이 탭은 다시 자동(폴더·한도 기준)으로 계정을 골라요. 지금 계정 그대로예요";
    } else {
      manualAt = Date.now();
      switchPausedUntil = 0;   // 직접 고른 것이니 실패 뒤 쉬는 때도 무시
      const why = pin === want ? "" : pin ? `(고른 ${name(pin)} 계정이 한도 95%를 넘어 ${name(want)} 계정으로) ` : "(자동: 폴더·한도 기준) ";
      text = working || screenBusy(screenNow()) || questions.size || approvals.size
        ? `${why}지금 일이 끝나면 ${name(want)} 계정으로 바꿔요. 인수인계 문서를 쓰게 한 뒤 대화를 비우고 새로 켜요`
        : `${why}곧 ${name(want)} 계정으로 바꿔요. 인수인계 문서를 쓰게 한 뒤 대화를 비우고 새로 켜요`;
    }
    broadcast({ t: "notice", text });
    accountTick();
  };

  // ── 새 판으로 스스로 바꾸기 ──
  // 설치된 파일이 바뀌었으면, 쉬는 틈(작업·확인 창·질문·받아 둔 글 없음, 한동안 조용함)에 새 연결부를 띄운다.
  // 새 연결부는 뜨면서 이 연결부를 끄고(stopOtherFeeds) 대화 기록을 다시 읽어 같은 화면을 만든다.
  // Claude Code 는 건드리지 않는다. 브리지는 끊긴 소켓에 0.5초마다 다시 붙으며 그동안 폰 화면을 그대로 둔다
  const REV_TICK_MS = Number(process.env.PI_REMOTE_REV_TICK_SEC ?? 30) * 1000;
  const REV_IDLE_MS = Number(process.env.PI_REMOTE_REV_IDLE_SEC ?? 15) * 1000;
  let handingOver = false;
  let failedRev = "";
  let failedAt = 0;
  setInterval(() => {
    if (handingOver || switching || working || compactSince || approvals.size || questions.size || screenAsk || conv.queue().length) return;
    if (Date.now() - lastActivity < REV_IDLE_MS) return;
    const now = codeRev();
    if (!now || now === CODE_REV) return;
    if (now === failedRev && Date.now() - failedAt < 10 * 60_000) return;   // 뜨지 못한 판은 10분 뒤에나 다시
    handingOver = true;
    const env = { ...process.env };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      spawn(process.execPath, [SELF_PATH, pane], { detached: true, stdio: "ignore", env }).unref();
    } catch {
      /* 아래에서 실패로 적음 */
    }
    // 새 연결부가 뜨면 이 프로세스는 그 전에 꺼진다. 20초 뒤에도 살아 있으면 새 판이 뜨지 못한 것(깨진 파일 등) → 이 연결부가 계속 맡음
    setTimeout(() => {
      handingOver = false;
      failedRev = now;
      failedAt = Date.now();
    }, 20_000);
  }, REV_TICK_MS);

  // 시작할 때 대화 기록 파일 찾기(훅이 오기 전에도 채팅이 보이게. 연결부를 새로 설치해 다시 띄운 경우 등):
  // 이 칸의 Claude Code 프로세스 기록(~/.claude/sessions/<pid>.json)의 대화 번호 → ~/.claude/projects/*/<번호>.jsonl
  try {
    const shell = String(tmux("display", "-p", "-t", pane, "#{pane_pid}") ?? "").trim();
    let kids = [];
    try {
      kids = execFileSync("pgrep", ["-P", shell], { encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      /* 자식 없음 */
    }
    for (const pid of [shell, ...kids]) {
      const f = `${HOME}/.claude/sessions/${pid}.json`;
      if (!pid || !existsSync(f)) continue;
      const id = String(JSON.parse(readFileSync(f, "utf8")).sessionId ?? "");
      const dir = `${HOME}/.claude/projects`;
      const hit = id && readdirSync(dir).map((d) => `${dir}/${d}/${id}.jsonl`).find((x) => existsSync(x));
      if (hit) {
        load(hit);
        break;
      }
    }
  } catch {
    /* 못 찾으면 훅이 알려 줄 때까지 기다림 */
  }

  // 대화 기록 따라 읽기, 칸이 사라지거나 Claude Code 가 끝나면 스스로 끝냄(끝 훅을 못 받은 경우)
  setInterval(() => readNew(false), 400);
  let gone = 0;
  setInterval(() => {
    const cmd = tmux("display", "-p", "-t", pane, "#{pane_current_command}");
    gone = switching || (cmd && /^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i.test(cmd)) ? 0 : gone + 1;
    if (!gone) tidyName();
    if (gone >= 3) finish();
  }, 10_000);
  return { onCommand, snapshot };
}

// 직접 실행했을 때만 돈다(시험에서 불러 쓸 때는 돌지 않게). 경로는 바로가기를 풀어서 견준다:
// 글자 그대로 견주면 홈이나 설치 폴더가 바로가기(/tmp → /private/tmp 등)일 때 아무 일도 하지 않고 조용히 끝났다
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(SELF_PATH);
  } catch {
    return false;
  }
})();
if (isMain) {
  const pane = process.argv[2];
  if (!pane || !/^%\d+$/.test(pane)) process.exit(1);
  runFeed(pane);
}
