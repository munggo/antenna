#!/usr/bin/env node
/**
 * claude.ai 아티팩트는 폴더 기준 계정에 둔다(사용자 결정 11-24: 어느 계정·모델로 일하든 개인 폴더면 개인 계정, 회사 폴더면 회사 계정).
 * 95%를 넘어 다른 계정으로 바꾼 탭처럼 지금 계정이 폴더 계정과 다르면, 아티팩트 도구 호출을 폴더 계정으로 대신 실행한다.
 *
 * - Claude Code 의 PreToolUse 훅(Artifact·ArtifactComments·ArtifactData): 폴더 계정의 비대화 Claude Code
 *   (claude-as.sh <계정> -p, CLAUDE_CODE_ARTIFACT=1. 비대화 실행은 이 변수가 있어야 아티팩트 도구가 켜짐)로 같은 호출을 하고,
 *   그 도구 결과를 거절 까닭에 담아 돌려준다(훅은 도구 결과를 바꿀 수 없어 '거절 + 결과 글'. 모델은 그것을 결과로 쓴다)
 * - 지금 계정은 이 훅을 부른 Claude Code 프로세스의 환경에 회사 토큰이 있는지로 본다(훅에는 토큰 변수가 넘어오지 않음. 값은 읽지 않음)
 * - 대신 실행은 매번 새 대화라 '같은 파일 경로로 다시 올리면 같은 주소' 규칙이 통하지 않는다 → 대화마다 파일 → 주소를 기억해 붙이고,
 *   고치는 올리기는 그 대화에서 먼저 읽어야 하므로(도구 규칙) 읽기·파일 목록을 먼저 부르게 한다
 * - 폴더 계정으로 실행하지 못하면(한도·연결 문제) 올리기는 파일을 복사해 대기열에 넣고, 뒤에서(--drain) 몇 분마다 다시 시도해
 *   올라가면 폰으로 알리고 <작업 폴더>/.work/artifact-relay/ 에 주소를 적는다
 * 실행: (훅) node artifact-relay.mjs < 훅 입력 JSON   ·   (뒤에서 다시 시도) node artifact-relay.mjs --drain
 * 작성: 서문교
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hasToken, homeAccount, LABEL, procAccount } from "./claude-account.mjs";

const HOME = process.env.HOME ?? "";
const SELF = fileURLToPath(import.meta.url);
const DIR = process.env.PI_ARTIFACT_RELAY_DIR || `${HOME}/.cache/pi-remote/artifact-relay`;
// 남이 쓴 파일은 다 읽고 올리라는 도구 규칙 때문에 Read 도 준다(없으면 읽으려다 멈춤, 11-24 확인)
const TOOLS = "Artifact,ArtifactComments,ArtifactData,Read";
const MODEL = process.env.PI_ARTIFACT_RELAY_MODEL || "sonnet";
const RUN_MS = Number(process.env.PI_ARTIFACT_RELAY_TIMEOUT_SEC ?? 240) * 1000;
const RETRY_MS = Number(process.env.PI_ARTIFACT_RELAY_RETRY_SEC ?? 600) * 1000;
const GIVE_UP_MS = 8 * 86_400_000;   // 주간 한도도 일주일이면 풀림
const AS = process.env.PI_ARTIFACT_RELAY_AS || join(dirname(SELF), "claude-as.sh");   // 시험은 가짜로 바꿈
const CLAUDE_RE = /^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i;
export const URL_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/;
const N = (a) => LABEL[a] ?? a;
const abs = (base, p) => resolve(base, String(p ?? "").replace(/^~(?=\/|$)/, HOME));

/** 이 훅을 부른 Claude Code 의 계정: 부모 프로세스를 거슬러 올라가 Claude Code 를 찾고 그 환경으로 가림(procAccount:
 *  claude-as.sh 의 PI_CLAUDE_ACCOUNT, 없으면 토큰이 있으면 회사). 추가 개인(personal2)으로 일해도 개인 폴더의 아티팩트는 메인 개인에(11-25). 못 찾으면 null */
export function currentAccount(pid = process.ppid) {
  for (let i = 0; i < 8 && pid > 1; i++) {
    let line = "";
    try {
      line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 }).trim();
    } catch {
      return null;
    }
    const m = line.match(/^(\d+)\s+(.*)$/);
    if (!m) return null;
    if (CLAUDE_RE.test(basename(m[2].trim()))) {
      const env = execFileSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 3000, maxBuffer: 16 << 20 });
      return procAccount(env);
    }
    pid = Number(m[1]);
  }
  return null;
}

/** 대신 실행할 세션에게 줄 글: prior(먼저 할 읽기 등) 다음에 그 호출 하나 */
export function relayPrompt(tool, input, prior = []) {
  const steps = [...prior.map((p) => `Artifact ${JSON.stringify(p)}`), `${tool} ${JSON.stringify(input)}`];
  return [
    "You relay Artifact tool calls for another Claude Code session that runs on a different account. Make exactly these tool calls, in this order, with these inputs unchanged:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "If your instructions require reading a local file before publishing it, Read it first. Do not call any other Artifact action, do not change or create files, and do not retry a call that returned an error. After the last call reply with the single word DONE.",
  ].join("\n");
}

const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : "")).join("\n") : String(c ?? ""));

/** 비대화 실행의 stream-json 출력 → { ran(그 호출이 실행됨), ok, text(도구 결과나 못 한 까닭) }.
 *  입력이 똑같은 호출의 결과를 찾고, 없으면 같은 도구·같은 동작의 마지막 결과 */
export function parseRelay(out, tool, input) {
  const uses = new Map();
  let exact = null, near = null, result = null;
  const act = (i) => String(i?.action ?? "publish");
  for (const line of String(out ?? "").split("\n")) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type === "result") result = j;
    for (const c of Array.isArray(j.message?.content) ? j.message.content : []) {
      if (c?.type === "tool_use") uses.set(c.id, c);
      if (c?.type !== "tool_result") continue;
      const u = uses.get(c.tool_use_id);
      if (!u || u.name !== tool) continue;
      const r = { text: textOf(c.content), isError: !!c.is_error };
      if (same(u.input, input)) exact = r;
      else if (act(u.input) === act(input)) near = r;
    }
  }
  const r = exact ?? near;
  if (r) return { ran: true, ok: !r.isError, text: r.text };
  return { ran: false, ok: false, text: String(result?.result || (result ? `실행 결과: ${result.subtype}` : "출력이 없음")).slice(0, 500) };
}

/** 입력이 가리키는 로컬 파일 경로들(올리기의 file_path·file_paths·files 의 원본) */
function sourcesOf(input, cwd) {
  const out = [];
  const base = input.root ? abs(cwd, input.root) : cwd;
  if (input.file_path) out.push({ key: "file_path", path: abs(cwd, input.file_path) });
  for (const [i, p] of (Array.isArray(input.file_paths) ? input.file_paths : []).entries()) out.push({ key: `file_paths.${i}`, path: abs(cwd, p) });
  const files = input.files;
  if (files && typeof files === "object" && !Array.isArray(files)) {
    for (const [k, v] of Object.entries(files)) {
      const src = typeof v === "string" ? v : v && typeof v === "object" && typeof v.from === "string" ? v.from : null;
      if (src) out.push({ key: `files.${k}`, path: abs(base, src) });
    }
  } else if (Array.isArray(files)) {
    for (const [i, f] of files.entries()) if (typeof f?.path === "string") out.push({ key: `filelist.${i}`, path: abs(base, f.path) });
  }
  return out;
}
/** 작업 폴더 밖에 있는 원본 파일의 폴더들(대신 실행에 --add-dir 로 줌. 없으면 도구가 그 파일을 보내지 않음) */
export function extraDirs(input, cwd) {
  const c = resolve(cwd);
  const dirs = new Set();
  for (const s of sourcesOf(input, cwd)) {
    const d = dirname(s.path);
    if (d !== c && !d.startsWith(c + sep)) dirs.add(d);
  }
  if (input.root) dirs.add(abs(cwd, input.root));
  return [...dirs].filter((d) => existsSync(d));
}

function runRelay({ tool, input, cwd, account, prior = [] }) {
  const env = { ...process.env, CLAUDE_CODE_ARTIFACT: "1", PI_ARTIFACT_RELAY: "1", PATH: `${HOME}/.local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` };
  delete env.TMUX;
  delete env.TMUX_PANE;
  const dirs = extraDirs(input, cwd).flatMap((d) => ["--add-dir", d]);
  const args = [account, "-p", "--model", MODEL, "--tools", TOOLS, "--allowedTools", TOOLS, "--strict-mcp-config", "--setting-sources", "",
    "--no-session-persistence", "--output-format", "stream-json", "--verbose", ...dirs, "--", relayPrompt(tool, input, prior)];
  const r = spawnSync(AS, args, { cwd: existsSync(cwd) ? cwd : HOME, env, encoding: "utf8", timeout: RUN_MS, maxBuffer: 64 << 20 });
  const parsed = parseRelay(r.stdout, tool, input);
  if (!parsed.ran && r.error) parsed.text = `${r.error.code === "ETIMEDOUT" ? "시간 초과" : r.error.message}`;
  else if (!parsed.ran && r.status && r.stderr) parsed.text = String(r.stderr).trim().slice(0, 300) || parsed.text;
  return parsed;
}

// ── 대화마다 대신 올린 파일 → 주소 ──
const URLS = () => join(DIR, "urls.json");
const loadUrls = () => {
  try {
    return JSON.parse(readFileSync(URLS(), "utf8"));
  } catch {
    return {};
  }
};
const saveUrl = (sid, file, url) => {
  const u = loadUrls();
  u[`${sid}\t${file}`] = url;
  mkdirSync(DIR, { recursive: true });
  const tmp = `${URLS()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(u));
  renameSync(tmp, URLS());
};

// ── 대기열(지금 올리지 못한 올리기) ──
/** 원본 파일을 대기열 폴더로 복사하고 입력의 경로를 그 사본으로 바꿈(원본이 지워져도 나중에 올릴 수 있게) */
function enqueue(job) {
  const id = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const jd = join(DIR, "queue", id);
  const files = join(jd, "files");
  mkdirSync(files, { recursive: true });
  const input = JSON.parse(JSON.stringify(job.input));
  const copy = (p) => {
    const dst = join(files, p);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(p, dst);
    return dst;
  };
  for (const s of sourcesOf(input, job.cwd)) {
    if (!existsSync(s.path)) continue;
    const dst = copy(s.path);
    const [kind, k] = [s.key.split(".")[0], s.key.slice(s.key.indexOf(".") + 1)];
    if (kind === "file_path") input.file_path = dst;
    else if (kind === "file_paths") input.file_paths[Number(k)] = dst;
    else if (kind === "files") input.files[k] = typeof input.files[k] === "string" ? dst : { ...input.files[k], from: dst };
    else if (kind === "filelist") input.files[Number(k)] = { ...input.files[Number(k)], path: dst };
  }
  delete input.root;   // 원본 경로를 모두 사본의 절대 경로로 바꿨음
  writeFileSync(join(jd, "job.json"), JSON.stringify({ ...job, id, input, at: Date.now(), tries: 0 }, null, 1));
  return id;
}
function startDrain() {
  try {
    spawn(process.execPath, [SELF, "--drain"], { detached: true, stdio: "ignore", env: { ...process.env, PI_ARTIFACT_RELAY: "1" } }).unref();
  } catch {
    /* 다음 훅이 다시 띄움 */
  }
}
/** 폰 알림: 그 탭이 있는 tmux 세션의 알림 소켓(연결부와 같은 길). 탭이 닫혔으면 보내지 않음 */
function notify(pane, kind, title, body) {
  if (!pane) return;
  let out = "";
  try {
    out = execFileSync("tmux", ["display", "-p", "-t", pane, "#{session_name}:::#{window_index}"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return;
  }
  const [session, idx] = out.split(":::");
  const path = `${HOME}/.cache/pi-remote/notify-${session}.sock`;
  if (!session || !existsSync(path)) return;
  const c = createConnection(path);
  c.on("error", () => {});
  c.end(`${JSON.stringify({ kind, title, body: body.slice(0, 200), window: Number(idx) })}\n`);
}
/** <작업 폴더>/.work/artifact-relay/<번호>.md 에 결과를 적음(작업 파일 자리, 사용자 규칙 11-18). 못 쓰면 대기열 폴더에만 */
function note(job, text) {
  const d = join(job.cwd, ".work", "artifact-relay");
  try {
    mkdirSync(d, { recursive: true });
    if (!existsSync(join(d, ".gitignore"))) writeFileSync(join(d, ".gitignore"), "*\n");
    writeFileSync(join(d, `${job.id}.md`), text);
    return join(d, `${job.id}.md`);
  } catch {
    return null;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function drain() {
  mkdirSync(DIR, { recursive: true });
  const lock = join(DIR, "drain.pid");
  try {
    const pid = Number(readFileSync(lock, "utf8"));
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      return;   // 이미 도는 중
    }
  } catch {
    /* 없거나 끝난 프로세스 */
  }
  writeFileSync(lock, String(process.pid));
  try {
    for (;;) {
      const q = join(DIR, "queue");
      const ids = existsSync(q) ? readdirSync(q).filter((f) => existsSync(join(q, f, "job.json"))).sort() : [];
      if (!ids.length) break;
      for (const id of ids) {
        const jd = join(q, id);
        const job = JSON.parse(readFileSync(join(jd, "job.json"), "utf8"));
        const to = (where) => {
          mkdirSync(join(DIR, where), { recursive: true });
          renameSync(jd, join(DIR, where, id));
        };
        if (Date.now() - job.at > GIVE_UP_MS) {
          note(job, `# 아티팩트를 올리지 못함\n\n${N(job.account)} 계정으로 8일 동안 올리지 못해 그만뒀어요. 원본: ${job.origFile ?? "(없음)"}\n마지막 까닭: ${job.last ?? ""}\n`);
          notify(job.pane, "error", "아티팩트를 올리지 못했어요", `${N(job.account)} 계정으로 8일 동안 올리지 못했어요: ${basename(job.origFile ?? "")}`);
          to("failed");
          continue;
        }
        const r = runRelay({ tool: job.tool, input: job.input, cwd: job.cwd, account: job.account, prior: job.input.url ? [{ action: "read", url: job.input.url }, { action: "list", scope: "files", url: job.input.url }] : [] });
        if (r.ok) {
          const url = (r.text.match(URL_RE) ?? [])[0] ?? "";
          if (url && job.sid && job.origFile) saveUrl(job.sid, job.origFile, url);
          note(job, `# 아티팩트를 올림\n\n- 계정: ${N(job.account)}\n- 주소: ${url}\n- 원본: ${job.origFile ?? ""}\n\n${r.text}\n`);
          notify(job.pane, "done", "아티팩트를 올렸어요", `${N(job.account)} 계정: ${url || basename(job.origFile ?? "")}`);
          to("done");
        } else if (r.ran) {
          note(job, `# 아티팩트를 올리지 못함\n\n도구가 오류를 돌려줬어요(다시 시도하지 않음).\n\n${r.text}\n`);
          notify(job.pane, "error", "아티팩트를 올리지 못했어요", r.text.split("\n")[0]);
          to("failed");
        } else {
          job.tries += 1;
          job.last = r.text;
          writeFileSync(join(jd, "job.json"), JSON.stringify(job, null, 1));
        }
      }
      await sleep(RETRY_MS);
    }
  } finally {
    rmSync(lock, { force: true });
  }
}

const deny = (reason) => process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })}\n`);

async function hook() {
  if (process.env.PI_ARTIFACT_RELAY === "1") return;   // 대신 실행하는 세션 자신
  let ev;
  try {
    ev = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const tool = String(ev?.tool_name ?? "");
  if (!/^Artifact(Comments|Data)?$/.test(tool)) return;
  const cwd = String(ev.cwd || process.cwd());
  const want = homeAccount(cwd);
  const cur = process.env.PI_ARTIFACT_RELAY_CURRENT || currentAccount();
  if (!cur || cur === want) return;   // 폴더 계정 그대로(또는 모름): 그대로 실행
  if (!hasToken(want)) return;   // 그 계정으로 실행할 수 없음(회사 토큰이 없는 맥 등)
  const orig = ev.tool_input && typeof ev.tool_input === "object" ? ev.tool_input : {};
  const input = JSON.parse(JSON.stringify(orig));
  const sid = String(ev.session_id ?? "");
  const act = tool === "Artifact" ? String(input.action ?? "publish") : "";
  const file = input.file_path ? abs(cwd, input.file_path) : "";
  let reused = "";
  if (act === "publish" && !input.url && !input.type_url && !input.asset && file) {
    reused = loadUrls()[`${sid}\t${file}`] ?? "";
    if (reused) input.url = reused;
  }
  const prior = act === "publish" && input.url && !input.asset ? [{ action: "read", url: input.url }, { action: "list", scope: "files", url: input.url }] : [];
  const head = `[아티팩트 계정 맞춤] 이 탭은 ${N(cur)} 계정으로 돌고 있지만 이 폴더의 아티팩트는 ${N(want)} 계정에 둡니다(사용자 규칙). 그래서 이 호출은 여기서 실행하지 않고 ${N(want)} 계정으로 대신 실행했습니다.`;
  const r = runRelay({ tool, input, cwd, account: want, prior });
  if (r.ok) {
    const url = (r.text.match(URL_RE) ?? [])[0];
    if (url && act === "publish" && file) saveUrl(sid, file, url);
    const again = reused ? ` 이 대화에서 앞서 올린 파일이라 같은 주소(${reused})에 새 버전으로 올렸습니다.` : "";
    return deny(`${head} 성공했습니다.${again} 아래가 그 도구 결과이니 이 호출의 결과로 쓰세요. 같은 호출을 다시 하지 마세요.\n\n${r.text}`);
  }
  if (r.ran) return deny(`${head} 도구가 오류를 돌려줬습니다. 오류를 보고 입력을 고쳐 다시 부르세요(다시 불러도 ${N(want)} 계정으로 갑니다).\n\n${r.text}`);
  if (act === "publish") {
    const id = enqueue({ tool, input, cwd, account: want, sid, pane: process.env.TMUX_PANE ?? "", origFile: file });
    startDrain();
    return deny(`${head} 그런데 지금은 ${N(want)} 계정으로 실행하지 못해(${r.text.split("\n")[0]}) 대기열에 넣었습니다(번호 ${id}). 뒤에서 몇 분마다 다시 시도해 올라가면 폰으로 주소를 알리고 ${join(cwd, ".work", "artifact-relay", `${id}.md`)} 에 적습니다. 사용자에게 그렇게 알리세요. 지금 계정(${N(cur)})으로 올리지 마세요.`);
  }
  return deny(`${head} 그런데 지금은 ${N(want)} 계정으로 실행하지 못했습니다(${r.text.split("\n")[0]}). 잠시 뒤 다시 부르거나 사용자에게 알리세요. 지금 계정(${N(cur)})으로 실행하지 마세요.`);
}

// 직접 실행했을 때만(시험이 불러 쓸 때는 아님. 경로는 바로가기를 풀어서 견줌)
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(SELF);
  } catch {
    return false;
  }
})();
if (isMain) {
  if (process.argv[2] === "--drain") await drain();
  else await hook();
}
