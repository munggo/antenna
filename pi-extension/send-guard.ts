/**
 * 보내기·위험 동작 승인(send-guard)
 *
 * 원칙: 누군가에게 메시지가 최종적으로 나가기 직전(Slack·Jira·이메일·GitHub 댓글·메신저·문자 등. 커밋·푸시·PR 올리기는 제외, 셀프머지는 승인)과
 *       되돌리기 어려운 위험 명령은 항상 사용자 승인을 받은 뒤에만 실행한다.
 *
 * - 도구 실행 직전(tool_call)에 명령·MCP 도구를 보고 해당하면 멈춘다.
 * - 맥 화면에 확인 창을 띄우고, 폰(pi-remote)에도 같은 요청을 보낸다. 먼저 답한 쪽을 따른다.
 * - 화면이 없는 실행(하위 에이전트·pi -p 등)은 물어볼 곳이 없으므로 막는다.
 * - 명령 글자로 알 수 없는 전송(직접 만든 스크립트 등)은 request_approval 도구로 먼저 승인받게 한다.
 *
 * 폰과는 pi-remote-feed 확장이 pi.events 로 이어 준다:
 *   pi-remote:approval-request {id, kind, label, to, detail, since, task, intent, note, scripts, summarizing}   승인 요청
 *   pi-remote:approval-update  {id, headline, summary, summarizing, risk}  Opus 한 문장 설명·위험도(나중에)
 *   pi-remote:approval-response {id, approved}                        폰의 답
 *   pi-remote:approval-done {id, approved}                            끝(맥에서 답했거나 중단)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isReadOnlyCommand } from "./lib/readonly.ts";
// 비밀번호가 필요한 sudo 판정(Claude Code 훅과 같이 쓰는 함수들)
import { needsSudoPassword, nopasswdRules, stripFileHeredocs, sudoCalls } from "./lib/sudo-rules.mjs";
export { needsSudoPassword, nopasswdRules, stripFileHeredocs, sudoCalls };
import { Type } from "typebox";

export type Hit = { kind: "send" | "danger"; label: string };

// 임시 폴더 안의 삭제는 묻지 않음(사용자 결정). 경로를 정리한 뒤 판단('/tmp/../Users/…' 처럼 밖으로 나가면 승인)
const TEMP_PATH = /^(\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\$TMPDIR\/|\$\{TMPDIR\}\/|~\/\.cache\/|\/Users\/[^/]+\/\.cache\/)/;
const HAS_UP = /(^|\/)\.\.(\/|$)/;
/** 지울 대상이 임시 폴더 안인지. cdDir: rm 앞에서 들어간 폴더(상대 경로 대상일 때) */
export function isTempTarget(t: string, cdDir?: string): boolean {
  const home = process.env.HOME ?? "";
  const abs = (p: string) => p.replace(/^~(?=\/|$)/, home);
  let p = abs(t);
  if (/^\$/.test(p)) return !HAS_UP.test(p) && TEMP_PATH.test(p);   // $TMPDIR/… 는 .. 없을 때만
  if (!isAbsolute(p)) {
    // 상대 경로: 임시 폴더로 cd 한 뒤면 그 안(.. 로 나가면 안 됨)
    if (!cdDir || HAS_UP.test(p)) return false;
    const base = abs(cdDir);
    if (!isAbsolute(base)) return false;
    p = join(base, p);
  }
  // 경로 정리(..) 뒤 임시 폴더 안의 무언가여야 함(임시 폴더 자체는 안 됨)
  return TEMP_PATH.test(resolvePath(p));
}

/** curl·http 요청이 서버에 쓰는 요청인지(POST·PUT·PATCH·DELETE 또는 본문 전송) */
function isWriteRequest(cmd: string): boolean {
  if (/(-X|--request)\s*['"]?(POST|PUT|PATCH|DELETE)\b/i.test(cmd)) return true;
  // -G(--get): --data 를 주소 뒤에 붙여 조회(GET)로 보냄 → 쓰기 아님(예: Jira 검색)
  if (/\s(-G|--get)(\s|$)/.test(cmd) && !/\s(-F|--form|-T|--upload-file|--json)(\s|=)/.test(cmd)) return false;
  return /\s(-d|--data(-raw|-binary|-urlencode)?|--json|-F|--form|-T|--upload-file)(\s|=)/.test(cmd);
}

// --- DB 쓰기 SQL ---
// 문장 첫 단어가 데이터·구조를 바꾸는 것
const WRITE_LEAD = /^(insert|update|delete|merge|replace|upsert|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|refresh|comment|lock|call|do|import|load)\b/i;
// WITH·EXPLAIN 안에 숨은 쓰기(EXPLAIN ANALYZE 는 실제로 실행됨)
const INNER_WRITE = /\b(insert\s+into|update\s+\S+\s+set|delete\s+from|merge\s+into)\b/i;

/** SQL(여러 문장 가능)에 쓰기가 있는지. 주석과 '문자열' 안의 글자는 빼고 본다 */
export function isWriteSql(raw: string): boolean {
  const sql = raw
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  return sql.split(";").some((st) => {
    const s = st.trim().replace(/^\(+\s*/, "");
    if (WRITE_LEAD.test(s)) return true;
    return /^(with|explain)\b/i.test(s) && INNER_WRITE.test(s);
  });
}

// bash 의 DB 명령 안 쓰기 SQL(명령 전체에서 찾음: SQL 이 따옴표 안에 들어가 있어서)
const DB_CLIENT = /^(psql|pgcli|mysql|mariadb|mycli|sqlite3|duckdb|clickhouse-client|clickhouse)$/;
const SQL_WRITE_ANYWHERE = /\b(insert\s+into|update\s+\S+\s+set|delete\s+from|merge\s+into|truncate|drop\s+(table|database|schema|index|view|function|role|user)|alter\s+(table|database|schema|index|view|role|user)|create\s+(table|database|schema|index|view|function|role|user|extension)|grant\s|revoke\s)\b/i;

/** 명령의 각 부분(; && || | 줄바꿈으로 나눔)의 첫 단어들 */
function commandWords(cmd: string): string[] {
  return cmd
    .split(/;|&&|\|\||\||\n|\$\(|`/)
    .map((p) => p.trim().replace(/^(sudo\s+|env\s+(\S+=\S+\s+)*|exec\s+|nohup\s+)+/, ""))
    .map((p) => p.split(/\s+/)[0] ?? "")
    .filter(Boolean)
    .map((w) => w.replace(/^.*\//, ""));
}

/** bash 명령 판정: 사람에게 보내기 / 위험 / 해당 없음 */
/** cat·tee 로 파일에 적기만 하는 heredoc 본문은 뺀다(적는 글 속 'rm -rf' 같은 글자로 걸지 않게).
 *  본문을 셸·인터프리터·전송 도구로 넘기는 경우(| bash, | curl 등)는 그대로 둔다 */

export function classifyCommand(raw: string): Hit | null {
  // 주석 줄(첫 줄 설명 등)과 파일에 적기만 하는 heredoc 본문은 판정에서 뺀다
  const cmd = stripFileHeredocs(raw)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const words = commandWords(cmd);

  // --- 사람에게 보내기 ---
  if (/hooks\.slack\.com/i.test(cmd)) return { kind: "send", label: "Slack 메시지 보내기" };
  if (/slack\.com\/api\/(chat\.|files\.(upload|completeUpload)|reactions\.add|conversations\.(invite|create|join))/i.test(cmd))
    return { kind: "send", label: "Slack에 쓰기" };
  // Jira 상태 바꾸기(전환)만 하는 요청은 묻지 않음(사용자 결정). 댓글을 함께 달면 사람에게 가는 글이라 승인
  const jiraUrls = cmd.match(/\S*(atlassian\.net|\/rest\/api\/[23]\/issue)\S*/gi) ?? [];
  const jiraTransitionOnly = jiraUrls.length > 0 && jiraUrls.every((u) => /\/issue\/[A-Za-z][A-Za-z0-9_]*-\d+\/transitions\b/i.test(u)) && !/comment/i.test(cmd);
  if (!jiraTransitionOnly && jiraUrls.length && isWriteRequest(cmd)) return { kind: "send", label: "Jira·Confluence에 쓰기" };
  if (/\b(acli\s+jira|jira\s+(issue|comment|sprint|workitem))\b.*\b(create|comment|edit|move|assign|transition|add)\b/i.test(cmd) &&
      !(/\b(transition|move)\b/i.test(cmd) && !/\b(create|comment|edit|assign|add)\b/i.test(cmd)))
    return { kind: "send", label: "Jira에 쓰기" };
  if (words.some((w) => /^(mail|mailx|sendmail|mutt|neomutt|msmtp|swaks)$/.test(w))) return { kind: "send", label: "이메일 보내기" };
  if (/smtps?:\/\//i.test(cmd) || /gmail\.googleapis\.com\/.*\/send\b/i.test(cmd) ||
      (/api\.(sendgrid\.com|mailgun\.net|resend\.com|postmarkapp\.com)/i.test(cmd) && isWriteRequest(cmd)))
    return { kind: "send", label: "이메일 보내기" };
  if (/osascript/.test(cmd) && /\b(Mail|Messages)\b/.test(cmd) && /\bsend\b/i.test(cmd)) return { kind: "send", label: "메일·메시지 앱으로 보내기" };
  // GitHub: 커밋·푸시·PR 올리기는 묻지 않고(사용자 결정), 셀프머지(PR 병합)는 승인
  if (/\bgh\s+pr\s+merge\b/.test(cmd) || /\bgh\s+api\b[^\n]*\/pulls\/\d+\/merge\b/.test(cmd) || /\bgh\s+api\b[^\n]*mergePullRequest/.test(cmd))
    return { kind: "danger", label: "PR 병합(셀프머지)" };
  if (/\bgh\s+(pr|issue)\s+(comment|review|close|reopen|edit)\b/.test(cmd) || /\bgh\s+issue\s+create\b/.test(cmd)) return { kind: "send", label: "GitHub에 글 남기기" };
  if (/\bgh\s+(release\s+create|gist\s+create)\b/.test(cmd)) return { kind: "send", label: "GitHub에 올리기" };
  const prCreateApi = /\bgh\s+api\b[^\n]*\brepos\/[^/\s]+\/[^/\s]+\/pulls(?![/\w])/.test(cmd);   // PR 올리기(API)는 묻지 않음
  if (/\bgh\s+api\b/.test(cmd) && !prCreateApi && (/(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b/i.test(cmd) || /\s(-f|-F|--field|--raw-field|--input)\s/.test(cmd)))
    return { kind: "send", label: "GitHub에 쓰기" };
  if (/discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot[^/\s]+\/send|kapi\.kakao\.com\/v[12]\/api\/talk|api\.line\.me\/v2\/bot\/message|webhook\.office\.com|outlook\.office\.com\/webhook|api\.twilio\.com\/.*\/Messages/i.test(cmd))
    return { kind: "send", label: "메신저·문자 보내기" };
  if (/api\.notion\.com\/v1\/comments/i.test(cmd) && isWriteRequest(cmd)) return { kind: "send", label: "Notion 댓글 남기기" };

  // --- 위험 명령 ---
  if (words.some((w) => DB_CLIENT.test(w))) {
    if (SQL_WRITE_ANYWHERE.test(cmd)) return { kind: "danger", label: /prod/i.test(cmd) ? "운영 DB 쓰기" : "DB 쓰기(SQL)" };
    // SQL 파일을 실행하면 내용을 미리 볼 수 없으므로 승인
    if (/\s(-f|--file)[\s=]\S|\s<\s*\S+\.sql\b|\.read\s/.test(cmd)) return { kind: "danger", label: "DB에 SQL 파일 실행" };
  }
  const rm = cmd.match(/\brm\s+((?:-[a-zA-Z]+\s+|--[a-z-]+\s+)*)(.*)/);
  if (rm && /(^|\s)(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(\s|$)/.test(` ${rm[1]}`)) {
    const targets = rm[2].split(/[;&|\n]/)[0].trim().split(/\s+/).filter((t) => t && !t.startsWith("-")).map((t) => t.replace(/^['"]|['"]$/g, ""));
    // rm 앞에서 들어간 폴더(cd /tmp/작업 && rm -rf build)
    const cdDir = [...cmd.slice(0, rm.index).matchAll(/\bcd\s+(['"]?)([^\s;&|'"]+)\1/g)].pop()?.[2];
    if (targets.length === 0 || targets.some((t) => !isTempTarget(t, cdDir))) return { kind: "danger", label: "폴더째 지우기" };
  }
  if (words.includes("sudo") || /(^|[;&|(\s])sudo\s/.test(cmd)) return { kind: "danger", label: "관리자 권한(sudo)" };
  if (/\bgit\s+push\b[^\n;&|]*(\s(-f|--force|--force-with-lease|--mirror|--delete|-d)\b|\s\+\S|\s:\S)/.test(cmd)) return { kind: "danger", label: "강제 푸시·원격 브랜치 삭제" };
  if (/\bgit\s+reset\s+[^\n;&|]*--hard\b/.test(cmd)) return { kind: "danger", label: "git reset --hard" };
  if (/\bgit\s+clean\s+-[a-zA-Z]*f/.test(cmd)) return { kind: "danger", label: "git clean -f" };
  if (/\bgit\s+branch\s+[^\n;&|]*-D\b/.test(cmd)) return { kind: "danger", label: "브랜치 강제 삭제" };
  if (/\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?\w)/i.test(cmd)) return { kind: "danger", label: "DB 삭제(DROP·TRUNCATE)" };
  if (/\bdelete\s+from\s+[\w."`]+\s*(;|"|'|$)/im.test(cmd)) return { kind: "danger", label: "조건 없는 DB 삭제" };
  if (/\baws\s+(\S+\s+)?(delete|terminate|remove|deregister|destroy)[\w-]*/i.test(cmd) || /\baws\s+s3\s+(rm|rb)\b/.test(cmd))
    return { kind: "danger", label: "AWS 자원 삭제" };
  if (/\baws\s+ssm\s+send-command\b/.test(cmd)) return { kind: "danger", label: "서버 원격 실행(SSM)" };
  if (/\bkubectl\s+delete\b/.test(cmd)) return { kind: "danger", label: "kubectl delete" };
  if (/\bterraform\s+(apply|destroy)\b/.test(cmd)) return { kind: "danger", label: "terraform apply·destroy" };
  if (/\bdocker\s+(system|volume|image)\s+prune\b/.test(cmd)) return { kind: "danger", label: "docker 정리(prune)" };
  if (/\bmkfs|\bdd\s+[^\n]*of=\/dev\/|\bdiskutil\s+(erase|partition)/.test(cmd)) return { kind: "danger", label: "디스크 지우기" };
  if (words.some((w) => /^(shutdown|reboot|halt)$/.test(w))) return { kind: "danger", label: "맥 끄기·다시 시작" };
  if (/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b/.test(cmd)) return { kind: "danger", label: "패키지 공개 배포" };
  return null;
}

// 메시지·협업 서비스 MCP: 읽기가 아닌 도구는 모두 승인(남에게 보이는 쓰기)
// 공유 문서·관제 서비스도 쓰기는 승인(시트·문서는 남도 보고, 모니터 변경은 담당자에게 알림이 갈 수 있음)
const COLLAB_SERVER = /(slack|notion|atlassian|jira|confluence|gmail|mail|email|outlook|github|gitlab|linear|discord|telegram|kakao|teams|line|sms|twilio|calendar|sheets|drive|docs|datadog|figma)/i;
// DB MCP: 질의 도구의 SQL 을 보고 쓰기면 승인
const DB_SERVER = /(postgres|mysql|mariadb|sqlite|supabase|redshift|bigquery|snowflake|clickhouse|duckdb|mssql|oracle|(^|[-_])db([-_]|$)|sql)/i;
const DB_TOOL = /(query|sql|execute|exec|run)/i;
// 맥 안에서만 도는 서버(보내기·공유가 없음): 이름에 comment 등이 있어도 승인하지 않음
const LOCAL_SERVER = /^(blender|rea)$/i;
// 읽기 도구: send_message 같은 밑줄·하이픈 이름(API-retrieve-a-page, notion-search)과 낙타 표기(getJiraIssue) 모두
const READ_WORDS = "get|list|search|read|fetch|find|describe|lookup|query|export|view|retrieve|download|count|check|whoami";
const READ_SPLIT = new RegExp(`(^|[-_])(${READ_WORDS})([-_]|$)`, "i");
const READ_CAMEL = new RegExp(`^(${READ_WORDS})[A-Z]`);
const READ_SET = new Set(READ_WORDS.split("|"));
// 첫 동사가 이것이면 쓰기(notion-create-view 처럼 뒤에 읽기 단어가 있어도)
const WRITE_SET = new Set((
  "create|update|delete|remove|add|set|put|insert|move|upload|send|cancel|restore|convert|complete|spawn|stop|link|resolve|" +
  "duplicate|archive|edit|write|modify|publish|share|invite|assign|transition|rename|merge|replace|reset|clear|enable|disable|" +
  "install|save|mute|unmute|schedule|reply|forward").split("|"));
/** 읽기 도구인지: 서버 이름·api 접두어를 떼고 첫 단어로 먼저 판단, 애매하면 이름 어디든 읽기 단어 */
const isReadTool = (t: string, server = "") => {
  const tokens = t.split(/[-_]|(?=[A-Z])/).filter(Boolean).map((x) => x.toLowerCase());
  const parts = server.toLowerCase().split(/[-_]/);
  while (tokens.length > 1 && (tokens[0] === "api" || parts.includes(tokens[0]))) tokens.shift();
  if (READ_SET.has(tokens[0])) return true;
  if (WRITE_SET.has(tokens[0])) return false;
  return READ_SPLIT.test(t) || READ_CAMEL.test(t);
};
const SEND_TOOL = /(send|post|reply|comment|publish|notify|invite|share|forward|message|email)/i;

/** MCP 도구(mcp__서버__도구) 판정. input 은 DB 질의의 SQL 을 보려고 받는다 */
export function classifyMcp(toolName: string, input: Record<string, unknown> = {}): Hit | null {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return null;
  const [, server, tool] = m;
  if (LOCAL_SERVER.test(server)) return null;
  if (DB_SERVER.test(server) || DB_TOOL.test(tool)) {
    const sql = Object.values(input ?? {}).filter((v) => typeof v === "string").join(";\n");
    if (sql && isWriteSql(sql)) return { kind: "danger", label: `${/prod/i.test(server) ? "운영 DB 쓰기" : "DB 쓰기"} · ${server}` };
    if (DB_SERVER.test(server)) return null;   // DB 서버의 읽기 질의는 통과
  }
  if (isReadTool(tool, server)) return null;
  // Jira 상태 바꾸기는 묻지 않음(사용자 결정). 댓글을 함께 달면 사람에게 가는 글이라 승인
  if (/jira|atlassian/i.test(server) && /transition/i.test(tool)) {
    return String((input as any)?.comment ?? "").trim() ? { kind: "send", label: `Jira 상태 바꾸기 + 댓글 · ${tool}` } : null;
  }
  if (/github|gitlab/i.test(server)) {
    // 커밋·푸시·PR 올리기는 묻지 않고, 병합(셀프머지)은 승인
    if (/merge/i.test(tool)) return { kind: "danger", label: `PR 병합(셀프머지) · ${server}` };
    if (/(create_pull_request|create_pr|push_files|create_or_update_file|create_branch|commit)/i.test(tool)) return null;
  }
  if (COLLAB_SERVER.test(server) || SEND_TOOL.test(tool)) return { kind: "send", label: `${server} · ${tool}` };
  return null;
}

const GUIDE =
  "Never send a message to another person (Slack, Jira comments or issues, email, GitHub comments, issues or reviews, messengers, SMS, " +
  "or any other channel) without the user's explicit approval for that exact content. Git commits, pushes and opening GitHub pull " +
  "requests do not need approval, but merging a pull request (self-merge) does. Known sending commands and tools pause " +
  "automatically for approval. If you send through any other path (for example a custom script or an unfamiliar CLI), first call " +
  "request_approval with the recipient and the exact final content, and send only if it returns approved. If a send is denied, do not retry it. " +
  "Changing a Jira issue status (transition) without a comment needs no approval: just do it, then tell the user in Korean which issue " +
  "changed from which status to which (e.g. 'PROJ-123: 진행 중 → 완료'). Deleting files or folders inside temporary folders (/tmp, $TMPDIR) needs no approval.";

/** 내용 비교용: 공백을 하나로 */

// --- 승인 카드에 실을 정보: 어떤 작업 중인지, 실행되는 스크립트 ---
const clipText = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const textOf = (m: any) =>
  (Array.isArray(m?.content) ? m.content : [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => String(b.text ?? ""))
    .join("\n")
    .trim();

/** 작업 맥락: 사용자가 맡긴 요청(마지막 메시지), 명령 직전 pi 의 설명, 명령 첫 줄 주석 */
export function contextOf(branch: any[], command = ""): { task: string; intent: string; note: string } {
  let task = "";
  let intent = "";
  for (let i = (branch?.length ?? 0) - 1; i >= 0; i--) {
    const e = branch[i];
    const m = e?.type === "message" ? e.message : null;
    if (!m) continue;
    if (!intent && m.role === "assistant") intent = textOf(m);
    if (m.role === "user") {
      task = textOf(m) || (typeof m.content === "string" ? m.content : "");
      break;
    }
  }
  const first = command.split("\n").find((l) => l.trim()) ?? "";
  const note = /^\s*#\s*(.+)/.exec(first)?.[1]?.trim() ?? "";
  return { task: clipText(task.trim(), 400), intent: clipText(intent.trim(), 400), note: clipText(note, 200) };
}

export type ScriptInfo = { path: string; lines: number; content: string; truncated: boolean };
const RUNNERS = /^(sh|bash|zsh|dash|source|\.|python[0-9.]*|node|deno|bun|tsx|ts-node|ruby|perl|php|osascript|psql|mysql|sqlite3)$/;
const PREFIX = /^(sudo|env|nohup|exec|time|timeout|caffeinate|command|nice|arch)$/;
const SCRIPT_EXT = /\.(sh|bash|zsh|py|mjs|cjs|js|ts|rb|pl|php|sql|scpt|applescript)$/i;
const SYSTEM = /^\/(usr|bin|sbin|System|Library|opt\/homebrew|private\/var\/db)\//;

/** 명령이 실행하는 스크립트 파일(최대 3개, 각 400줄·40KB) */
export function scriptsIn(command: string, cwd: string, home = process.env.HOME ?? ""): ScriptInfo[] {
  const out: ScriptInfo[] = [];
  const seen = new Set<string>();
  let dir = cwd;
  const abs = (w: string) => {
    const x = w.replace(/^~(?=\/|$)/, home);
    return isAbsolute(x) ? x : resolvePath(dir, x);
  };
  const add = (w: string, sourced = false) => {
    if (out.length >= 3 || !w || /^-/.test(w)) return;
    const p = abs(w);
    if (seen.has(p) || SYSTEM.test(p)) return;
    // 비밀값이 든 파일은 어떤 경우에도 읽지 않음(승인 카드·요약으로 나가지 않게)
    if (/(credential|secret|token|passw|\.env($|\.)|(^|[/._-])env$|\.pem$|\.p8$|\.key$|id_rsa|apikey|api_key|auth\.json)/i.test(p)) return;
    // source·. 로 불러오는 건 대개 설정 파일: 셸 스크립트일 때만
    if (sourced && !/\.(sh|bash|zsh)$/i.test(p)) return;
    try {
      const st = statSync(p);
      if (!st.isFile() || st.size > 2_000_000) return;
      const buf = readFileSync(p);
      if (buf.subarray(0, 4096).includes(0)) return;   // 실행 파일 등 이진 파일
      seen.add(p);
      const text = buf.toString("utf8");
      const all = text.split("\n");
      let content = all.slice(0, 400).join("\n");
      if (content.length > 40_000) content = content.slice(0, 40_000);
      out.push({ path: p.replace(home, "~"), lines: all.length - (text.endsWith("\n") ? 1 : 0), content, truncated: content.length < text.length });
    } catch {
      /* 없는 파일 */
    }
  };
  for (const seg of command.split(/&&|\|\||[;\n|]/)) {
    const words = (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ""));
    if (!words.length || words[0].startsWith("#")) continue;
    let i = 0;
    while (i < words.length && (PREFIX.test(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || (i > 0 && PREFIX.test(words[i - 1]) && /^-|^\d+[smh]?$/.test(words[i])))) i++;
    const head = words[i] ?? "";
    if (head === "cd" && words[i + 1]) { dir = abs(words[i + 1]); continue; }
    const base = head.split("/").pop() ?? "";
    if (RUNNERS.test(base)) {
      const rest = words.slice(i + 1);
      if (rest.some((w) => w === "-c" || w === "-e" || w === "--eval") && !/^(psql|mysql)$/.test(base)) continue;   // 글로 넘긴 코드는 이미 명령에 있음
      const fi = rest.findIndex((w, k) => (base === "psql" || base === "mysql") ? rest[k - 1] === "-f" || rest[k - 1] === "--file" : !w.startsWith("-"));
      if (fi >= 0) add(rest[fi], base === "source" || base === ".");
    } else if (/^(\.{0,2}\/|~\/)/.test(head)) {
      add(head);   // ./deploy.sh, ~/bin/x 처럼 직접 실행
    }
    for (const w of words.slice(i + 1)) if (SCRIPT_EXT.test(w) && !w.includes("=")) add(w);   // 인자로 넘긴 스크립트 파일
  }
  return out;
}

// --- 비밀번호가 필요한 sudo: 새 tmux 탭에서 사용자가 실행 ---
export type SudoRule = { path: string; args: string | null };   // args null: 인자 아무거나

// --- 승인 카드에 코드·JSON 대신 읽기 쉬운 내용 ---
const FIELD_GROUPS: [string, RegExp][] = [
  ["받는 곳", /^(to|recipients?|channel(_?id|_?name)?|chat_?id|email|users?(_?ids?)?|assignee|cc|bcc|thread_?ts|conversation)$/i],
  ["대상", /^(issue(_?key|_?id)?|page_?id|database_?id|parent(_?id)?|project(_?key)?|repo(sitory)?|owner|pull_?number|pr|ticket|space(_?key)?|file_?key|node_?id)$/i],
  ["제목", /^(title|subject|summary|name)$/i],
  ["내용", /^(text|body|content|message|comment|description|markdown)$/i],
];
/** MCP 입력 → '받는 곳: …', '내용: …' 같은 읽기 쉬운 줄(객체·배열 같은 나머지는 개수만) */
export function readableInput(input: any): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const lines: string[] = [];
  const used = new Set<string>();
  let other = 0;
  for (const [k, v] of Object.entries(input)) {
    const g = FIELD_GROUPS.find(([, re]) => re.test(k));
    const val = typeof v === "string" ? v.trim()
      : typeof v === "number" ? String(v)
      : Array.isArray(v) && v.length && v.every((x) => typeof x === "string") ? v.join(", ") : "";
    if (!g || !val) {
      other++;
      continue;
    }
    const label = used.has(g[0]) ? `${g[0]}(${k})` : g[0];
    used.add(g[0]);
    lines.push(`${label}: ${clipText(val, g[0] === "내용" ? 1500 : 200)}`);
  }
  if (!lines.length) return "";
  if (other) lines.push(`그 밖의 항목 ${other}개(원본 보기)`);
  return lines.join("\n");
}
/** 보낼 내용이 JSON·코드인지(그러면 카드에 그대로 보이지 않고 요약으로) */
export function looksLikeCode(s: string): boolean {
  const t = String(s ?? "").trim();
  if (!t) return false;
  if (/^[\[{]/.test(t)) {
    try {
      JSON.parse(t);
      return true;
    } catch {
      /* JSON 아님 */
    }
  }
  if (/```/.test(t)) return true;
  const lines = t.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const codey = lines.filter((l) =>
    /[;{}]\s*$|^\s*(def |function |const |let |var |import |from \S+ import|class |return |if \(|for \(|select |insert |update |delete from|create (table|index)|<\/?[a-z][\w-]*[ >])/i.test(l)).length;
  return codey / lines.length >= 0.4;
}

/** 보낼 글을 그대로 보이지 않고 요약할지: 3줄 넘거나 길거나 마크다운·HTML·코드가 있으면(사용자 결정) */
export function needsCondense(s: string): boolean {
  const t = String(s ?? "").trim();
  if (!t) return false;
  if (looksLikeCode(t)) return true;
  if (t.split("\n").filter((l) => l.trim()).length > 3 || t.length > 280) return true;
  return /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>\s|\|.*\|)|```|\*\*|`[^`]+`|<\/?[a-z][\w-]*[\s>]/i.test(t);
}

export type ApprovalView = {
  risk: string; reason: string; purpose: string; to: string; content: string; scripts: string[];
  sentence: string; caution: string; summarizing: boolean;
};
export const APPROVAL_OPTIONS = ["거부", "허용", "거부하고 다르게 하라고 말하기"];
/** TUI 승인 상자(Claude Code CLI 의 권한 창처럼): 무엇·왜만, 코드 없음 */
export function approvalBox(v: ApprovalView, sel: number, width: number, theme?: any): string[] {
  const fg = (k: string, t: string) => (theme?.fg ? theme.fg(k, t) : t);
  const bold = (t: string) => (theme?.bold ? theme.bold(t) : t);
  const W = Math.max(30, Math.min(width - 1, 100));
  const inner = W - 4;
  const riskColor = v.risk === "상" ? "error" : v.risk === "중" ? "warning" : "muted";
  // 제목: 위험도 색 동그라미 + '승인이 필요합니다 (하)'(사용자 결정: 이모지 대신 동그라미, 위험도는 괄호)
  const title = ` ${fg(riskColor, "●")} ${bold("승인이 필요합니다")} ${fg(riskColor, `(${v.risk})`)} `;
  const fill = Math.max(1, W - 3 - visibleWidth(title));
  const out = [fg("accent", "╭─") + title + fg("accent", `${"─".repeat(fill)}╮`)];
  const row = (t = "") => {
    const cut = truncateToWidth(t, inner);
    out.push(`${fg("accent", "│")} ${cut}${" ".repeat(Math.max(0, inner - visibleWidth(cut)))} ${fg("accent", "│")}`);
  };
  const para = (t: string, color?: string, max = 6) => {
    for (const l of wrapTextWithAnsi(t, inner).slice(0, max)) row(color ? fg(color, l) : l);
  };
  row();
  if (v.sentence) para(v.sentence, undefined, 4);
  else para(v.purpose || v.reason, undefined, 3);
  if (v.caution) para(v.caution, "muted", 3);
  if (!v.sentence && v.summarizing) row(fg("dim", "설명을 쓰는 중…"));
  row();
  para([v.reason, v.sentence ? v.purpose : ""].filter(Boolean).join(" · "), "dim", 2);
  if (v.to) para(`받는 곳: ${v.to}`, "dim", 2);
  if (v.content) para(v.content, "muted", 6);
  if (v.scripts.length) para(`스크립트: ${v.scripts.join(", ")}`, "dim", 1);
  row();
  APPROVAL_OPTIONS.forEach((o, i) => row(i === sel ? fg("accent", `❯ ${i + 1}. ${o}`) : `  ${i + 1}. ${o}`));
  row();
  row(fg("dim", "↑↓ 고르기 · Enter 확인 · 숫자 바로 고르기 · Esc 거부"));
  out.push(fg("accent", `╰${"─".repeat(W - 2)}╯`));
  return out;
}

export type Risk = "상" | "중" | "하";
/** 걸린 이유로 정하는 위험도(Opus 가 실제 내용을 보고 바꿀 수 있음) */
export function riskOf(hit: Hit, guessed = false): Risk {
  if (guessed) return "하";
  const l = hit.label;
  if (/운영 DB|DB 삭제|조건 없는 DB 삭제|디스크 지우기|AWS 자원 삭제|강제 푸시|terraform|kubectl delete|패키지 공개 배포/.test(l)) return "상";
  if (/폴더째 지우기/.test(l)) return "상";
  if (/^(파일 (수정|쓰기)|명령 실행) ·/.test(l)) return "하";   // 권한 모드 '매번 묻기'의 일반 수정·명령(위험한 것은 위 규칙으로 따로 걸림)
  return "중";
}

/** 설명 글(Opus) → 위험도(첫 줄 '위험도: 상|중|하'), 한 문장 설명, 주의(나머지) */
export function splitSummary(text: string): { headline: string; summary: string; risk?: Risk } {
  let lines = String(text ?? "").split("\n").map((l) => l.replace(/^[#*\-\s]+|\*\*/g, "").trim()).filter(Boolean);
  let risk: Risk | undefined;
  const r = lines[0]?.match(/^위험도\s*[:：]?\s*(상|중|하)(?=$|[\s.)(·,])/);   // \b 는 한글에 맞지 않음
  if (r) {
    risk = r[1] as Risk;
    lines = lines.slice(1);
  }
  if (!lines.length) return { headline: "", summary: "", ...(risk ? { risk } : {}) };
  const head = lines[0].replace(/^(한 ?줄 ?(요약|설명)|요약|설명)\s*[:：]\s*/, "");
  const ok = head.length <= 120;
  return { headline: ok ? head : "", summary: (ok ? lines.slice(1) : lines).join(" "), ...(risk ? { risk } : {}) };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export default function (pi: ExtensionAPI) {
  let seq = 0;
  const waiting = new Map<string, (approved: boolean) => void>();
  // request_approval 로 방금 승인받은 내용: 실제 보내기 도구가 같은 내용을 보내면 다시 묻지 않음(5분 안, 한 번)
  const preApproved: { content: string; at: number }[] = [];
  const takePreApproved = (detail: string): boolean => {
    const d = norm(detail);
    const now = Date.now();
    const i = preApproved.findIndex((p) => now - p.at < 5 * 60_000 && p.content.length >= 2 && d.includes(p.content));
    if (i < 0) return false;
    preApproved.splice(i, 1);
    return true;
  };

  // 폰의 답(pi-remote-feed 가 전달)
  pi.events.on("pi-remote:approval-response", (r: any) => {
    waiting.get(String(r?.id ?? ""))?.(!!r?.approved);
  });

  /** 위험 명령·스크립트를 Opus 5.5 로 한국어 한 문장 설명(자동 계정 → 개인 구독 순). 실패하면 빈 글 */
  const summarize = async (ctx: any, hit: Hit, detail: string, info: { task: string; intent: string; note: string }, scripts: ScriptInfo[], signal: AbortSignal, display = ""): Promise<string> => {
    const reg = ctx?.modelRegistry;
    if (!reg?.streamSimple) return "";
    const prompt = [
      "너는 사용자의 동료 개발자다. 사용자는 코드를 보지 않고 네 글만 보고 몇 초 안에 이 명령을 허용할지 정한다.",
      "출력 형식(다른 말 없이 줄마다):",
      "1줄: 위험도: 상|중|하  (상=되돌리기 어렵거나 운영 서버·데이터·다른 사람에게 영향, 중=되돌릴 수 있지만 조심할 일, 하=조회·확인 위주)",
      "2줄: 이 명령이 실제로 하는 일을 한 문장으로. 자연스러운 '~해요'체, 50자 안팎. 무엇을 어디에 하는지 구체적으로 쓰고, 경로·이름은 꼭 필요할 때만 짧게.",
      "3줄(선택): 되돌릴 수 없거나 꼭 알아야 할 점이 있을 때만 한 문장. 없으면 쓰지 않는다.",
      "쓰지 말 것: '이 명령은', '주의:', '~로 보입니다', '~할 수 있으나' 같은 상투어와 늘어놓는 추측, 코드·명령어를 그대로 옮기기, 영어 문장, 목록·제목.",
      "보내기로 걸린 경우: 2줄에 어디에 무엇을 보내는지 쓰고(주소가 글자로만 들어 있어 실제로 보내지 않으면 그렇다고), 3줄에 보낼 글의 요지를 한두 문장으로(마크다운·HTML 기호 없이 말로).",
      `걸린 이유(분류): ${hit.label}`,
      info.task ? `사용자가 맡긴 작업(참고만, 되풀이하지 말 것): ${clipText(info.task, 600)}` : "",
      info.intent ? `명령 직전 pi 의 설명: ${clipText(info.intent, 600)}` : "",
      display ? `읽기 쉬운 항목:\n${display}` : "",
      `명령·내용 원본:\n${detail.slice(0, 6000)}`,
      ...scripts.map((sc) => `스크립트 ${sc.path} (${sc.lines}줄${sc.truncated ? ", 앞부분만" : ""}):\n${sc.content.slice(0, 12_000)}`),
    ].filter(Boolean).join("\n\n");
    // 문장은 Opus 5.5 만 씀(사용자 결정: 사용자에게 보일 문장에 Haiku 는 쓰지 않음). 폴더별 자동 계정 → 개인 구독
    const candidates: [string, string][] = [["claude", "claude-opus-5-5"], ["anthropic", "claude-opus-5-5"]];
    for (const [p, mid] of candidates) {
      const model = reg.find(p, mid);
      if (!model) continue;
      try {
        const msg: any = await reg.streamSimple(model, {
          systemPrompt: "You write the short Korean explanation shown on a command approval card. Follow the requested format exactly.",
          messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
        }, { signal, maxTokens: 300 }).result();
        const text = textOf(msg);
        if (msg?.stopReason !== "error" && text) return text;
      } catch {
        /* 다음 모델 */
      }
      if (signal.aborted) break;
    }
    return "";
  };

  /** 승인 받기: 맥 확인 창 + 폰. 먼저 답한 쪽, 작업이 중단되면 거부 */
  type AskResult = { ok: boolean; why: string; note?: string; sentence?: string; caution?: string };
  const ask = async (ctx: any, hit: Hit, detail: string, to = "", command = "", display = ""): Promise<AskResult> => {
    if (!ctx?.hasUI) return { ok: false, why: "no-ui" };
    const id = `ap-${Date.now()}-${++seq}`;
    const ac = new AbortController();
    // 어떤 작업 중인지, 실행되는 스크립트(명령일 때)
    let info = { task: "", intent: "", note: "" };
    let scripts: ScriptInfo[] = [];
    try {
      info = contextOf(ctx.sessionManager?.getBranch?.() ?? [], command);
      if (command) scripts = scriptsIn(command, ctx.cwd ?? process.cwd());
    } catch {
      /* 맥락 없이도 승인은 받음 */
    }
    // 명령 글자로 추정한 보내기(예: 명령 속 Slack 주소)는 실제로 보내는지 요약으로 확인
    const guessed = hit.kind === "send" && !!command;
    // 보낼 글이 길거나 마크다운·HTML·코드면 그대로 보이지 않고 요약으로(사용자 결정: 승인에 원문·코드를 보이지 않음)
    const codeLike = !command && !display && needsCondense(detail);
    const source = command ? "bash" : display ? "mcp" : "approval";
    const wantSummary = guessed || hit.kind === "danger" || !!display || codeLike;
    // 하려는 일: 명령 첫 줄 한국어 주석만(pi 가 직전에 한 '승인을 요청하겠습니다' 같은 말은 쓸모가 없음)
    const purpose = info.note;
    const why = guessed ? `${hit.label}(명령 글자로 판단)` : hit.label;
    const risk = riskOf(hit, guessed);
    const lineCount = detail.split("\n").filter((l) => l.trim()).length;
    // 맥 승인 상자(Claude Code CLI 처럼): 무엇·왜만, 원문·코드는 보이지 않음
    const view: ApprovalView = {
      risk, reason: why, purpose, to, scripts: scripts.map((sc) => sc.path.split("/").pop() ?? sc.path),
      content: command ? "" : display ? clipText(display, 600)
        : codeLike ? `보낼 글 ${lineCount}줄(원문은 폰 카드의 '원본 보기')`
        : `보낼 글: ${clipText(detail, 400)}`,
      sentence: "", caution: "", summarizing: wantSummary,
    };
    let redraw = () => {};
    pi.events.emit("pi-remote:approval-request", {
      id, kind: hit.kind, label: hit.label, to, detail: detail.slice(0, 20_000), since: Date.now(),
      task: info.task, intent: info.intent, note: info.note, purpose, guessed, scripts, summarizing: wantSummary,
      display, codeLike, source, risk,
    });
    if (wantSummary) {
      void summarize(ctx, hit, detail, info, scripts, ac.signal, display).then((text) => {
        if (ac.signal.aborted) return;
        const { headline, summary, risk: aiRisk } = splitSummary(text);
        pi.events.emit("pi-remote:approval-update", { id, headline, summary, summarizing: false, ...(aiRisk ? { risk: aiRisk } : {}) });
        Object.assign(view, { sentence: headline, caution: summary, summarizing: false, ...(aiRisk ? { risk: aiRisk } : {}) });
        redraw();
      });
    }
    try {
      const phone = new Promise<AskResult>((resolve) => waiting.set(id, (ok) => resolve({ ok, why: "phone" })));
      // 맥: 승인 상자. 기본(첫 번째)은 거부 — 글을 치다 상자가 뜨는 순간 Enter 를 눌러도 보내지 않게.
      // '거부하고 다르게 하라고 말하기'를 고르면 할 말을 받아 pi 에게 전함(Claude Code 와 같은 방식)
      const TELL = APPROVAL_OPTIONS[2];
      const pick = async (): Promise<string | undefined> => {
        if (typeof ctx.ui.custom !== "function") {
          // 상자를 못 그리는 환경: 기본 선택 창(같은 내용)
          const title = [`● 승인이 필요합니다 (${view.risk})`, `  ${view.purpose || view.reason}`, `  ${view.reason}`, view.to ? `  받는 곳: ${view.to}` : "", view.content ? `  ${view.content}` : ""].filter(Boolean).join("\n");
          return ctx.ui.select(title, APPROVAL_OPTIONS, { signal: ac.signal });
        }
        return ctx.ui.custom((tui: any, theme: any, kb: any, done: (v: string | undefined) => void) => {
          let sel = 0;
          redraw = () => tui.requestRender();
          ac.signal.addEventListener("abort", () => done(undefined), { once: true });
          const is = (data: string, name: string, key: string) => (kb?.matches?.(data, name) ?? false) || matchesKey(data, key as any);
          return {
            render: (width: number) => approvalBox(view, sel, width, theme),
            handleInput: (data: string) => {
              if (/^[1-3]$/.test(data)) return done(APPROVAL_OPTIONS[Number(data) - 1]);
              if (is(data, "tui.select.up", "up")) sel = (sel + APPROVAL_OPTIONS.length - 1) % APPROVAL_OPTIONS.length;
              else if (is(data, "tui.select.down", "down")) sel = (sel + 1) % APPROVAL_OPTIONS.length;
              else if (is(data, "tui.select.confirm", "enter")) return done(APPROVAL_OPTIONS[sel]);
              else if (is(data, "tui.select.cancel", "escape")) return done(APPROVAL_OPTIONS[0]);
              tui.requestRender();
            },
            invalidate: () => {},
          };
        });
      };
      const mac = (async (): Promise<AskResult> => {
        const choice = await pick();
        if (ac.signal.aborted) return { ok: false, why: "closed" };
        if (choice === undefined) return { ok: false, why: "mac" };
        if (choice !== TELL) return { ok: choice === APPROVAL_OPTIONS[1], why: "mac" };
        const note = await ctx.ui.input("pi에게 할 말(어떻게 다르게 할지)", "", { signal: ac.signal });
        if (ac.signal.aborted) return { ok: false, why: "closed" };
        return { ok: false, why: "mac", note: String(note ?? "").trim() };
      })().catch(() => ({ ok: false, why: "closed" }));
      const aborted = new Promise<AskResult>((resolve) => {
        const s: AbortSignal | undefined = ctx.signal;
        if (s?.aborted) resolve({ ok: false, why: "aborted" });
        s?.addEventListener("abort", () => resolve({ ok: false, why: "aborted" }), { once: true });
      });
      // 맥 상자가 닫혀서(폰이 답해서) 끝난 경우는 폰 답을 기다린다
      const macReal = mac.then((r) => (r.why === "closed" ? new Promise<never>(() => {}) : r));
      const r = await Promise.race([phone, macReal, aborted]);
      return { ...r, sentence: view.sentence, caution: view.caution };
    } finally {
      waiting.delete(id);
      ac.abort();   // 폰이 먼저 답했으면 맥 상자 닫기
      pi.events.emit("pi-remote:approval-done", { id });
    }
  };

  // 비밀번호 없이 되는 sudo 명령(5분 기억)
  let rulesCache = { at: 0, rules: [] as SudoRule[] };
  const sudoNeedsPassword = (cmd: string): boolean => {
    if (!sudoCalls(cmd).length) return false;
    try {
      if (Date.now() - rulesCache.at > 300_000) {
        let out = "";
        try {
          out = execFileSync("sudo", ["-n", "-l"], { encoding: "utf8", timeout: 5000 });
        } catch (e: any) {
          out = String(e?.stdout ?? "");
        }
        rulesCache = { at: Date.now(), rules: nopasswdRules(out) };
      }
      const which = (c: string) => {
        try {
          return execFileSync("/usr/bin/which", [c], { encoding: "utf8", timeout: 3000 }).trim();
        } catch {
          return c;
        }
      };
      return needsSudoPassword(cmd, rulesCache.rules, which);
    } catch {
      return true;
    }
  };
  const SUDO_TAB = join(dirname(fileURLToPath(import.meta.url)), "sudo-tab.sh");
  /** 새 tmux 탭에서 사용자가 확인·실행(비밀번호·Touch ID). 끝나면 출력 파일과 종료 코드 */
  const runInSudoTab = async (ctx: any, cmd: string, label: string, explain = ""): Promise<{ kind: "done"; out: string; code: number } | { kind: "blocked"; reason: string }> => {
    const pane = process.env.TMUX_PANE;
    if (!pane || !existsSync(SUDO_TAB)) {
      return { kind: "blocked", reason: "Blocked: this sudo command needs the user's password, but pi cannot open a terminal tab here. Ask the user to run it themselves and paste the result." };
    }
    const dir = join(tmpdir(), `pi-sudo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, "cmd"), cmd, { mode: 0o600 });
    writeFileSync(join(dir, "cwd"), ctx?.cwd ?? process.cwd());
    // 탭에는 명령 대신 설명(사용자 결정: 코드는 보이지 않음, v 를 누르면 보임)
    writeFileSync(join(dir, "explain"), explain || `pi가 관리자 권한으로 명령을 실행하려고 해요(${label}).`);
    let win = "";
    try {
      const session = execFileSync("tmux", ["display", "-p", "-t", pane, "#{session_name}"], { encoding: "utf8" }).trim();
      win = execFileSync("tmux", ["new-window", "-P", "-F", "#{window_id} #{window_index}", "-t", `${session}:`, "-n", "🔐sudo",
        "-c", ctx?.cwd ?? process.cwd(), `bash ${JSON.stringify(SUDO_TAB)} ${JSON.stringify(dir)}`], { encoding: "utf8" }).trim();
    } catch (e: any) {
      rmSync(dir, { recursive: true, force: true });
      return { kind: "blocked", reason: `Blocked: could not open a terminal tab for sudo (${e?.message ?? e}). Ask the user to run it themselves.` };
    }
    const [winId, winIndex] = win.split(" ");
    pi.events.emit("pi-remote:sudo-tab", { window: Number(winIndex), label });
    try {
      ctx.ui.notify(`관리자 비밀번호가 필요해요: ${winIndex}번 탭(🔐sudo)에서 Enter를 누르고 비밀번호를 입력해 주세요`, "info");
    } catch {
      /* 화면 없음 */
    }
    const kill = () => {
      try {
        execFileSync("tmux", ["kill-window", "-t", winId]);
      } catch {
        /* 이미 닫힘 */
      }
    };
    const end = Date.now() + 15 * 60_000;
    try {
      while (Date.now() < end) {
        if (ctx?.signal?.aborted) {
          kill();
          rmSync(dir, { recursive: true, force: true });
          return { kind: "blocked", reason: "Blocked: the run was stopped while waiting for the sudo tab." };
        }
        if (existsSync(join(dir, "code"))) {
          const code = Number(readFileSync(join(dir, "code"), "utf8").trim()) || 0;
          if (!existsSync(join(dir, "out"))) writeFileSync(join(dir, "out"), "");
          return { kind: "done", out: join(dir, "out"), code };
        }
        if (existsSync(join(dir, "cancelled"))) {
          rmSync(dir, { recursive: true, force: true });
          return { kind: "blocked", reason: "Blocked: the user cancelled this sudo command in the terminal tab. Do not retry unless the user asks." };
        }
        // 닫힌 창을 물으면 tmux 는 오류가 아니라 빈 값을 준다 → 받은 번호가 같은지로 판단(오류 여부로 보면 탭을 닫아도 15분을 기다림)
        let alive = false;
        try {
          alive = execFileSync("tmux", ["display", "-p", "-t", winId, "#{window_id}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === winId;
        } catch {
          /* 없음 */
        }
        if (!alive) {
          rmSync(dir, { recursive: true, force: true });
          return { kind: "blocked", reason: "Blocked: the sudo terminal tab was closed before the command finished." };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      kill();
      rmSync(dir, { recursive: true, force: true });
      return { kind: "blocked", reason: "Blocked: nobody ran the sudo command within 15 minutes. Ask the user before retrying." };
    } finally {
      pi.events.emit("pi-remote:sudo-tab-done", { window: Number(winIndex) });
    }
  };

  const blockReason = (hit: Hit, why: string, note?: string) =>
    note
      ? `Blocked: the user declined "${hit.label}" and said: ${note}\nDo not retry it as is; follow what the user said.`
      : why === "no-ui"
      ? `Blocked: "${hit.label}" needs the user's approval, but this run has no screen to ask (subagent or print mode). ` +
        "Do not retry here; return the draft to the main session so it can be sent there with approval."
      : why === "aborted"
        ? "Blocked: the run was stopped while waiting for approval."
        : `Blocked: the user did not approve "${hit.label}". Do not retry it unless the user asks.`;

  // Jira 상태를 바꾸면(승인 없이 진행) 맥 화면에 무엇이 바뀌었는지 알림
  pi.on("tool_result", async (event: any, ctx: any) => {
    const name = String(event?.toolName ?? "");
    if (event?.isError || !/^mcp__.*(jira|atlassian).*__/i.test(name) || !/transition/i.test(name) || /get_?transitions/i.test(name)) return;
    const i = event.input ?? {};
    try {
      ctx?.ui?.notify?.(`Jira 상태 변경: ${i.issueKey ?? "?"} → ${i.transitionName ?? `전환 ${i.transitionId ?? "?"}`}`, "info");
    } catch {
      /* 화면 없음 */
    }
  });

  // ── 권한 모드(Claude Code 의 Shift+Tab 처럼): 자동(보내기·위험만 승인) / 매번 묻기(파일 수정·명령도 승인) / 계획(읽기만, plan-mode 확장) ──
  let askMode = false;
  let planOn = false;
  let modeCtx: any = null;
  const MODE_LABEL: Record<string, string> = { auto: "자동", ask: "매번 묻기", plan: "계획" };
  const modeName = () => (planOn ? "plan" : askMode ? "ask" : "auto");
  const announceMode = (ctx: any) => {
    pi.events.emit("perm-mode:changed", { mode: modeName() });
    try {
      // 하단 줄은 상태 줄 확장이 직접 그려서, 계획 모드처럼 입력창 위 한 줄로
      if (ctx?.hasUI) ctx.ui.setWidget("perm-mode", askMode && !planOn ? [" ⏸ 매번 묻기 — 파일 수정·명령도 실행 전에 물어요(/mode 로 바꾸기)"] : undefined);
    } catch {
      /* 화면 없음 */
    }
  };
  const setMode = (m: string, ctx: any) => {
    if (m === "plan") {
      if (!planOn) pi.events.emit("plan-mode:set", { on: true });
    } else {
      if (planOn) pi.events.emit("plan-mode:set", { on: false });
      if (askMode !== (m === "ask")) {
        askMode = m === "ask";
        pi.appendEntry("perm-mode", { ask: askMode });
      }
    }
    announceMode(ctx);
  };
  pi.events.on("plan-mode:changed", (e: any) => {
    planOn = !!e?.on;
    announceMode(modeCtx);
  });
  // 폰 모드 칩(피드가 보냄). 모르는 모드면 지금 모드를 다시 알려 칩을 되돌림
  pi.events.on("perm-mode:set", (e: any) => {
    const m = e?.mode === "manual" ? "ask" : String(e?.mode ?? "");
    if (["auto", "ask", "plan"].includes(m)) setMode(m, modeCtx);
    else announceMode(modeCtx);
  });
  const restoreMode = (ctx: any) => {
    modeCtx = ctx;
    askMode = false;
    try {
      for (const e of ctx?.sessionManager?.getBranch?.() ?? []) if (e?.type === "custom" && e.customType === "perm-mode") askMode = !!e.data?.ask;
    } catch {
      /* 못 읽으면 자동 */
    }
    announceMode(ctx);
  };
  pi.on("session_start", async (_e: any, ctx: any) => restoreMode(ctx));
  pi.on("session_tree", async (_e: any, ctx: any) => restoreMode(ctx));
  pi.registerCommand("mode", {
    description: "권한 모드 바꾸기: 자동 → 매번 묻기 → 계획 (auto|ask|plan)",
    handler: async (args: string, ctx: any) => {
      modeCtx = ctx;
      let a = String(args ?? "").trim();
      if (a === "manual") a = "ask";   // Claude Code 이름
      const order = ["auto", "ask", "plan"];
      if (a && !order.includes(a)) return void ctx.ui.notify(`pi 에는 없는 모드예요: ${a} (auto·ask·plan)`, "warning");
      const next = a || order[(order.indexOf(modeName()) + 1) % order.length];
      setMode(next, ctx);
      ctx.ui.notify(
        next === "ask" ? "권한 모드: 매번 묻기 — 파일 수정·명령도 실행 전에 물어요" : next === "plan" ? "권한 모드: 계획 — 읽기만 하며 계획을 세워요" : "권한 모드: 자동 — 보내기·위험한 일만 물어요",
        "info",
      );
    },
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    modeCtx = ctx ?? modeCtx;
    let hit: Hit | null = null;
    let detail = "";
    let matchText = "";   // 방금 승인받은 내용과 견주는 글(입력값 원래 글자)
    let display = "";     // MCP 입력의 읽기 쉬운 항목(카드에 JSON 대신)
    if (event.toolName === "bash") {
      detail = String(event.input?.command ?? "");
      hit = classifyCommand(detail);
      // 명령이 실행하는 스크립트 파일 속 위험 명령도(스크립트를 만들어 실행하면 승인을 건너뛰던 빈틈)
      if (!hit) {
        try {
          // 판정 규칙은 셸 명령용이라 셸 스크립트만(시험 파일 속 주소 같은 글자로 잘못 걸지 않게)
          for (const sc of scriptsIn(detail, ctx?.cwd ?? process.cwd()).filter((x) => /\.(sh|bash|zsh)$/i.test(x.path) || /^#!.*\b(ba|z|da)?sh\b/.test(x.content))) {
            const h = classifyCommand(sc.content);
            if (h) {
              hit = { kind: h.kind, label: `${h.label} · 스크립트 ${sc.path.split("/").pop()} 안` };
              break;
            }
          }
        } catch {
          /* 스크립트를 못 읽으면 명령만으로 판정 */
        }
      }
      matchText = detail;
    } else if (String(event.toolName).startsWith("mcp__")) {
      hit = classifyMcp(String(event.toolName), event.input ?? {});
      try {
        detail = JSON.stringify(event.input ?? {}, null, 2);
      } catch {
        detail = String(event.input ?? "");
      }
      matchText = Object.values(event.input ?? {}).filter((v) => typeof v === "string").join(" ");
      display = readableInput(event.input ?? {});
    }
    // 매번 묻기: 위험·보내기로 걸리지 않은 파일 수정·쓰기와 읽기 전용이 아닌 명령도 실행 전에
    if (!hit && askMode && !planOn) {
      const name = String(event.toolName);
      const inp = event.input ?? {};
      const base = (p: unknown) => String(p ?? "").split("/").pop() || String(p ?? "");
      if (name === "edit") {
        hit = { kind: "danger", label: `파일 수정 · ${base(inp.path)}` };
        detail = `${inp.path ?? ""}\n\n${(Array.isArray(inp.edits) ? inp.edits : []).map((e: any) => `- ${String(e?.oldText ?? "")}\n+ ${String(e?.newText ?? "")}`).join("\n\n")}`;
      } else if (name === "write") {
        hit = { kind: "danger", label: `파일 쓰기 · ${base(inp.path)}` };
        detail = `${inp.path ?? ""}\n\n${String(inp.content ?? "")}`;
      } else if (name === "bash" && !isReadOnlyCommand(String(inp.command ?? ""))) {
        hit = { kind: "danger", label: "명령 실행 · 매번 묻기" };
        detail = String(inp.command ?? "");
      }
    }
    if (!hit) return undefined;
    if (hit.kind === "send" && takePreApproved(matchText)) return undefined;   // 방금 같은 내용을 승인받음
    const { ok, why, note, sentence, caution } = await ask(ctx, hit, detail, "", event.toolName === "bash" ? detail : "", display);
    if (ok && event.toolName === "bash" && sudoNeedsPassword(detail)) {
      // 비밀번호가 필요한 sudo: pi 의 명령 실행에는 입력할 터미널이 없어 새 탭에서 사용자가 실행
      const r = await runInSudoTab(ctx, detail, hit.label, [sentence, caution].filter(Boolean).join("\n"));
      if (r.kind === "done") {
        event.input.command = `# 새 탭에서 사용자가 실행한 sudo 명령의 결과\ncat ${JSON.stringify(r.out)}; rm -rf ${JSON.stringify(dirname(r.out))}; exit ${r.code}`;
        return undefined;
      }
      return { block: true, reason: r.reason };
    }
    if (ok) return undefined;
    return { block: true, reason: blockReason(hit, why, note) };
  });

  // 명령 글자로 알 수 없는 전송용: 먼저 이 도구로 최종 내용을 보여 주고 승인받는다
  pi.registerTool({
    name: "request_approval",
    label: "승인 요청",
    description:
      "Ask the user to approve sending a message to another person (or another irreversible external action) through a path " +
      "that is not guarded automatically, such as a custom script. Show the recipient and the exact final content. " +
      "Proceed only if the result starts with 'approved'.",
    parameters: Type.Object({
      action: Type.String({ description: "What you are about to do, one short line in Korean (e.g. 'Slack #dev 채널에 배포 공지 보내기')" }),
      to: Type.Optional(Type.String({ description: "Recipient: person, channel, address, or ticket" })),
      content: Type.String({ description: "The exact final content that will be sent" }),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const { ok, why, note } = await ask(ctx, { kind: "send", label: String(params.action ?? "보내기") }, String(params.content ?? ""), String(params.to ?? ""));
      if (ok) preApproved.push({ content: norm(String(params.content ?? "")), at: Date.now() });
      const text = ok
        ? "approved: the user approved this exact content. You may send it now, unchanged."
        : why === "no-ui"
          ? "denied: no screen to ask in this run. Return the draft to the main session."
          : note ? `denied: the user did not approve and said: ${note}\nDo not send it as is; follow what the user said.`
          : "denied: the user did not approve. Do not send it.";
      return { content: [{ type: "text", text }], details: { approved: ok } };
    },
  });

  pi.on("before_agent_start", async (event: any) => {
    const g = event?.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(g) && !g.includes(GUIDE)) g.push(GUIDE);
  });
}
