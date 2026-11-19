// pi-remote 브리지 서버
// 폰이 WebSocket으로 접속하면 pty 안에서 `tmux attach -t <세션>`을 실행해
// 맥 iTerm2와 같은 tmux 세션을 공유한다. pty 출력 ↔ WebSocket 바이트를 중계한다.
//
// 환경변수:
//   PI_REMOTE_TOKEN  (없어도 됨) 예전 방식의 공유 토큰. 지금은 폰마다 짝짓기로 받은 토큰을 쓴다(devices.mjs)
//   PI_TMUX_SESSION  (기본 "antenna") attach 할 tmux 세션 이름(없으면 새로 만듦)
//   HOST             (기본 "0.0.0.0")
//   PORT             (기본 8787)

import { WebSocketServer } from "ws";
import pty from "node-pty";
import { execSync, execFile, execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { createConnection } from "node:net";
import { closeSync, existsSync, openSync, readSync, writeFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { advertise } from "./advertise.mjs";
import { createDepsGuard } from "./deps.mjs";
import { installCrashLog } from "./crash-log.mjs";
import { createDeviceStore, sameHex } from "./devices.mjs";
import { createDualServer, ensureCert } from "./tls.mjs";
import { outsideReach, parseHosts, reachText } from "./reach.mjs";
import { getPrefs, notify, pushEnabled, registerActivity, registerLiveStart, registerToken, setNotifyGate, setPrefs, startNotifySocket } from "./push.mjs";
import { readBattery } from "./battery.mjs";
import { createPromptWatch, readRequests, readWindows, tabFinder } from "./mac-prompts.mjs";
import { launchBackground } from "../claude-remote/bg-launch.mjs";
import { createTaskStarter } from "./tasks.mjs";
import { createSession, loadSnapshot, saveSnapshot, snapshotTabs } from "./tabs-restore.mjs";
import { editorEmpty, LEVELS, parseStatusLine } from "./status-line.mjs";
import { finishedBackgroundIds, forApp, parseWindows, SEEN_HOOK, SEEN_HOOK_CMD, WINDOW_FORMAT } from "./windows.mjs";
import { accountsState, claimsFromUsage, dailyUsage, MIXED_TEXT, mixedDirection, readUsageHistory, recordSharedClaims, recordUsage, recordWorkUsage, sharedLimits, usageHistoryForApp, workUsageForApp } from "./usage-history.mjs";
import { loadPiAuth, PI_AUTH_FILE, USAGE_AUTH_FILE, usageToken } from "./usage-auth.mjs";

// launchd 로 실행되면 언어 설정이 없어 tmux 가 한글(창 이름 등)을 "_" 로 바꿔 출력한다 → UTF-8 지정.
// (이 프로세스에서 실행하는 tmux 명령들이 이 환경을 물려받는다)
if (!process.env.LC_ALL && !process.env.LC_CTYPE && !/UTF-8/i.test(process.env.LANG || "")) {
  process.env.LANG = "en_US.UTF-8";
}

// 잡지 못한 오류는 왜 죽었는지를 재부팅해도 남는 곳(~/.cache/pi-remote/crash.log)에 적는다
installCrashLog();

const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "0.0.0.0";
// 예전 방식의 공유 토큰(모든 폰이 같이 쓰던 것). 없어도 된다: 지금은 폰마다 짝짓기로 받은 토큰을 쓴다(devices.mjs).
// 이 값이 있으면 아직 다시 짝짓지 않은 폰도 붙을 수 있다(이행 기간). 끄려면 설정 파일에서 그 줄을 지운다
const LEGACY_TOKEN = process.env.PI_REMOTE_TOKEN || "";
const SESSION = process.env.PI_TMUX_SESSION || "antenna";
const CONFIG_DIR = dirname(process.env.PI_REMOTE_ENV || `${process.env.HOME}/.config/pi-remote/env`);
const devices = createDeviceStore(CONFIG_DIR);

/**
 * 이 연결이 누구인지: 기기 토큰이면 { device }, 예전 공유 토큰이면 { legacy: true }, 아니면 null.
 * 토큰은 Authorization 머리말(Bearer)로 받는다. 예전 앱은 주소 뒤(token=)에 붙여 보낸다
 */
function authenticate(req, url) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""));
  const token = m ? m[1] : url.searchParams.get("token") ?? "";
  if (!token) return null;
  const device = devices.verify(token);
  if (device) return { device };
  // 예전 공유 토큰: 해시끼리 견줘 길이·걸린 시간으로 값을 짐작할 수 없게
  const h = (s) => createHash("sha256").update(s).digest("hex");
  if (LEGACY_TOKEN && sameHex(h(token), h(LEGACY_TOKEN))) return { legacy: true };
  return null;
}

// 틀린 토큰·코드를 되풀이해 넣는 주소는 잠깐 받지 않는다(1분에 10번 넘게 틀리면 1분 동안)
const FAIL_LIMIT = 10, FAIL_WINDOW_MS = 60_000;
const fails = new Map();   // 주소 → { n, since }
const blocked = (addr, now = Date.now()) => {
  const f = fails.get(addr);
  if (f && now - f.since > FAIL_WINDOW_MS) fails.delete(addr);
  return (fails.get(addr)?.n ?? 0) > FAIL_LIMIT;
};
const failed = (addr, now = Date.now()) => {
  const f = fails.get(addr);
  if (!f || now - f.since > FAIL_WINDOW_MS) fails.set(addr, { n: 1, since: now });
  else f.n++;
  if (fails.size > 1000) fails.clear();   // 주소가 끝없이 쌓이지 않게
};

// node-pty는 PATH 검색을 안 하므로 tmux 절대경로를 미리 찾는다.
const TMUX_BIN = resolveTmux();
console.log(`[pi-remote] tmux 경로: ${TMUX_BIN}`);

function resolveTmux() {
  if (process.env.TMUX_BIN && existsSync(process.env.TMUX_BIN)) {
    return process.env.TMUX_BIN;
  }
  try {
    const p = execSync("command -v tmux", { encoding: "utf8" }).trim();
    if (p && existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  for (const c of ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]) {
    if (existsSync(c)) return c;
  }
  console.error("[pi-remote] tmux 실행파일을 찾지 못했습니다. TMUX_BIN 환경변수로 지정하세요.");
  process.exit(1);
}

// tmux 창 목록 조회 (앱 탭바·서랍용). 탭마다 번호·이름·지금 보는 탭인지와
// status: pi 상태(맥 tmux 탭 확장이 기록) working | asking(답을 기다림) | yourturn(끝남, 아직 안 봄) | ""
// sudo: 관리자 권한 확인 창(🔐sudo)의 단계(sudo-tab.sh 가 기록) confirm | running | done | ""(그 창이 아님)
// bg: 백그라운드 탭이면 시킨 쪽·시작·끝·시킨 탭, jobs: 뒤에서 도는 일(server/windows.mjs)
function listWindows() {
  try {
    return parseWindows(execFileSync(TMUX_BIN, ["list-windows", "-t", SESSION, "-F", WINDOW_FORMAT], { encoding: "utf8" }));
  } catch {
    return [];
  }
}

// --- 지난 대화(폰 '지난 대화' 화면) ---
// 목록은 pi 공식 함수(SessionManager.listAll)로 뽑는다. 브리지에 pi 전체를 올리지 않도록 잠깐 도는 별도 프로세스에서.
// PI_REMOTE_SESSION_DIR: 시험용 대화 폴더(지정하면 그 폴더만 보고, 새 탭의 pi 도 그 폴더를 씀)
// 원래 node 폴더: 브리지가 이름을 바꾼 복사본('Antenna 연결부', run.sh)으로 돌면 그 옆에는 pi·npm 이 없어 run.sh 가 알려 준다
const NODE_DIR = process.env.PI_REMOTE_NODE_DIR || dirname(process.execPath);
const PI_PKG = process.env.PI_PKG || `${NODE_DIR}/../lib/node_modules/@earendil-works/pi-coding-agent`;
const SESSION_DIR = process.env.PI_REMOTE_SESSION_DIR || "";
const SESSIONS_ROOT = SESSION_DIR || `${process.env.HOME}/.pi/agent/sessions`;

function listSessions() {
  // pi 를 쓰지 않는 맥(Claude Code 만): 지난 대화가 없을 뿐 오류가 아니다
  if (!existsSync(`${PI_PKG}/dist/index.js`)) return Promise.resolve({ items: [] });
  const code = `
    const { SessionManager } = await import(${JSON.stringify(`${PI_PKG}/dist/index.js`)});
    const { realpathSync } = await import("node:fs");
    const dir = process.env.PI_REMOTE_SESSION_DIR;
    const all = dir ? await SessionManager.listAll(dir) : await SessionManager.listAll();
    const items = all
      .filter((s) => s.messageCount > 0)
      .sort((a, b) => +new Date(b.modified) - +new Date(a.modified))
      .slice(0, 100)
      .map((s) => {
        let path = s.path;
        try { path = realpathSync(s.path); } catch {}
        return {
          path, cwd: s.cwd || "", name: s.name || "",
          first: String(s.firstMessage || "").replace(/\\s+/g, " ").trim().slice(0, 200),
          modified: +new Date(s.modified), count: s.messageCount,
        };
      });
    process.stdout.write(JSON.stringify(items));
  `;
  return new Promise((resolve) => {
    execFile(process.execPath, ["--input-type=module", "--no-warnings", "-e", code],
      { timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PI_REMOTE_SESSION_DIR: SESSION_DIR } },
      (err, stdout) => {
        if (err) return resolve({ items: [], error: "지난 대화 목록을 읽지 못했어요" });
        try {
          resolve({ items: JSON.parse(stdout) });
        } catch {
          resolve({ items: [], error: "지난 대화 목록을 읽지 못했어요" });
        }
      });
  });
}

/** 살아 있는 모든 tmux 탭이 지금 연 대화 파일(확장이 남기는 <pane>.session 기록) → 그 탭 위치 */
function openSessions() {
  const map = new Map();
  let lines = [];
  try {
    lines = execFileSync(TMUX_BIN, ["list-panes", "-a", "-F", "#{pane_id}:::#{session_name}:::#{window_index}:::#{window_name}"],
      { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return map;
  }
  for (const line of lines) {
    const [paneId, sess, idx, name] = line.split(":::");
    try {
      const o = JSON.parse(readFileSync(`${FEED_DIR}/${paneId.replace(/\W/g, "")}.session`, "utf8"));
      if (!o?.session) continue;
      process.kill(o.pid, 0);   // 이미 끝난 pi 의 기록이면 예외 → 건너뜀
      map.set(o.session, { session: sess, index: parseInt(idx, 10), name: name || "" });
    } catch {
      /* 기록이 없거나 오래된 것 */
    }
  }
  return map;
}

/** 폰이 보낸 경로가 대화 폴더 안의 .jsonl 인지(그 밖의 파일은 열지 않음) */
function safeSessionPath(p) {
  try {
    const real = realpathSync(String(p ?? ""));
    const root = realpathSync(SESSIONS_ROOT);
    return real.startsWith(`${root}/`) && real.endsWith(".jsonl") ? real : null;
  } catch {
    return null;
  }
}

/** 대화 파일 머리(첫 줄)의 작업 폴더. 없거나 사라졌으면 홈 */
function sessionCwd(path) {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const head = JSON.parse(buf.toString("utf8", 0, n).split("\n")[0]);
    if (head?.cwd && existsSync(head.cwd)) return head.cwd;
  } catch {
    /* 머리를 못 읽으면 홈 */
  }
  return process.env.HOME;
}

// pi 모델 목록(앱 선택 메뉴용). thinking 지원 + 날짜 스냅샷 제외. 시작 시 1회 비동기 조회.
let MODELS = [];
const PI_BIN = process.env.PI_BIN || `${NODE_DIR}/pi`;
// pi 는 tmux 안에서 돌므로, tmux 전역 환경(API 키 포함) 기준으로 목록을 뽑는다.
function tmuxEnv() {
  const env = { ...process.env };
  try {
    for (const line of execSync(`${TMUX_BIN} show-environment -g`, { encoding: "utf8" }).split("\n")) {
      const i = line.indexOf("=");
      if (i > 0 && !line.startsWith("-")) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch {
    /* tmux 서버 없으면 기본 환경 */
  }
  return env;
}
execFile(process.execPath, [PI_BIN, "--list-models"], { timeout: 30000, env: tmuxEnv() }, (err, out) => {
  if (err) return console.warn(`[pi-remote] 모델 목록 조회 실패: ${err.message}`);
  MODELS = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 5 && c[4] === "yes")
    .map((c) => `${c[0]}/${c[1]}`)
    .filter((id) => !/-\d{8}$|-\d{4}-\d{2}-\d{2}$/.test(id));
  console.log(`[pi-remote] 모델 ${MODELS.length}개 로드`);
});

// 화면의 상태 줄(예: "~ Opus (xhigh) 141K/1000K")에서 현재 모델·생각 깊이를 읽는다(status-line.mjs).
function readPiStatus() {
  try {
    const screen = execSync(`${TMUX_BIN} capture-pane -p -t ${SESSION}`, { encoding: "utf8" });
    const lines = screen.split("\n").filter((l) => l.trim());
    const st = parseStatusLine(screen);
    // 작업 중이면 하단에 "── ⠴ Working ──" 줄이 있다(점자 스피너 + Working)
    const working = lines.slice(-6).some((l) => /[\u2800-\u28FF]\s+Working/.test(l));
    if (st?.last) return { model: st.model, thinking: st.thinking, working };   // pi: 맨 아래 줄이 상태 줄
    const opt = (k) => {
      try {
        return execFileSync(TMUX_BIN, ["show-options", "-w", "-v", "-t", SESSION, k], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return "";
      }
    };
    if (st) {
      // Claude Code: 화면의 상태 줄이 맥 화면과 같은 실제 값(세션에서 바꾼 생각 깊이·모델별 값·/model 로 바꾼 모델 포함).
      // 승인 창 등에 가려 못 읽을 때 쓰도록 창 옵션에도 적어 둔다(피드가 적는 값은 추측일 수 있음). 작업 중은 탭 상태로
      for (const [k, v] of [["@ai_model", st.model], ["@ai_thinking", st.thinking]]) {
        if (opt(k) === v) continue;
        try {
          execFileSync(TMUX_BIN, ["set-option", "-w", "-t", SESSION, k, v], { stdio: "ignore" });
        } catch {
          /* 적지 못해도 이번 값은 그대로 씀 */
        }
      }
      return { model: st.model, thinking: st.thinking, working: opt("@pi_status") === "working" };
    }
    // 상태 줄을 못 읽은 탭: 창 옵션에 적어 둔 모델·생각 깊이, 탭 상태로 작업 중
    const model = opt("@ai_model");
    return model ? { model, thinking: opt("@ai_thinking"), working: opt("@pi_status") === "working" } : { model: "", thinking: "", working };
  } catch {
    return { model: "", thinking: "", working: false };
  }
}

// --- Claude 요금제 사용량 ---
// pi 가 로그인한 Anthropic 토큰(~/.pi/agent/auth.json)으로 사용량을 조회한다.
// 토큰은 폰으로 절대 보내지 않는다. 만료가 가까우면 pi 가 쓰는 함수로 갱신한다(usage-auth.mjs). 조회는 1분간 저장.
const AUTH_FILE = PI_AUTH_FILE;
// 시험용: 사용량 조회 응답을 이 파일의 JSON 으로 대신한다(Anthropic 에 묻지 않고 로그인 정보도 읽지 않음).
// 파일이 없거나 깨졌으면 조회가 안 된 것으로 본다(공유 파일 값으로 대신하는 길)
const FAKE_USAGE_FILE = process.env.PI_REMOTE_FAKE_USAGE_FILE || "";
// 시험용: 회사 계정 사용량 조회 응답을 이 파일의 JSON 으로 대신한다(조회 전용 로그인이 있는 것처럼)
const FAKE_WORK_USAGE_FILE = process.env.PI_REMOTE_FAKE_WORK_USAGE_FILE || "";
const USAGE_TTL_MS = 60_000;
let usageCache = null; // { at, data }
let planCache = null; // { at, plan }

/** 사용량 조회에 쓸 토큰. 못 얻었으면 까닭을 기록에 한 번씩만 남긴다(같은 까닭을 10분마다 되풀이하지 않게) */
const tokenNotes = new Map();
async function tokenFor(label, file, provider) {
  const r = await usageToken({ file, provider, pi: await loadPiAuth(PI_PKG) });
  if (r.refreshed) console.log(`[pi-remote] 사용량 조회용 로그인(${label})을 갱신함`);
  const note = r.token ? (r.detail ? `갱신 실패(아직 만료 전이라 조회는 됨): ${r.detail}` : "") : r.error === "none" ? "" : `${r.error}${r.detail ? `: ${r.detail}` : ""}`;
  if (note !== (tokenNotes.get(label) ?? "")) {
    tokenNotes.set(label, note);
    if (note) console.warn(`[pi-remote] 사용량 조회용 로그인(${label}): ${note}`);
  }
  return r;
}

async function anthropicToken() {
  const r = await tokenFor("개인", AUTH_FILE, "anthropic");
  if (r.token) return { token: r.token };
  if (r.error === "none") return { error: "pi 에 Anthropic 계정으로 로그인돼 있지 않아요" };
  return { error: "로그인 토큰이 만료됐어요. 맥 pi 를 한 번 사용하면 자동으로 갱신돼요" };
}

// 회사 계정: 조회 전용 로그인(deploy/usage-login.mjs 로 받아 둔 것)이 있으면 사용량을 조회해 공유 파일에 적는다.
// 그 뒤는 전과 같다(공유 파일 값 → 회사 계정 한도·기록·터미널 하단 줄). 로그인이 없으면 아무것도 하지 않는다:
// 그때 회사 값은 Claude Code 상태 줄이 적는 것(모든 모델 주간, 한도에 걸린 Fable)뿐이다
async function refreshWorkUsage() {
  try {
    let u;
    if (FAKE_WORK_USAGE_FILE) {
      if (!existsSync(FAKE_WORK_USAGE_FILE)) return;
      u = JSON.parse(readFileSync(FAKE_WORK_USAGE_FILE, "utf8"));
    } else {
      const r = await tokenFor("회사", USAGE_AUTH_FILE, "anthropic-work");
      if (!r.token) return;
      u = await anthropicGet("/api/oauth/usage", r.token);
    }
    recordSharedClaims("anthropic-work", claimsFromUsage(u));
    tokenNotes.delete("회사 조회");
  } catch (e) {
    if (tokenNotes.get("회사 조회") !== e.message) console.warn(`[pi-remote] 회사 계정 사용량 조회 실패: ${e.message}`);
    tokenNotes.set("회사 조회", e.message);
  }
}

async function anthropicGet(path, token) {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function planLabel(org) {
  const names = { claude_max: "Max", claude_pro: "Pro", claude_team: "Team", claude_enterprise: "Enterprise" };
  let name = names[org?.organization_type] || org?.organization_type || "";
  const tier = String(org?.rate_limit_tier || "").match(/(\d+)x/);
  if (tier) name += ` ${tier[1]}x`;
  return name ? `Claude ${name}` : "";
}

function limitLabel(l) {
  const model = l?.scope?.model?.display_name;
  if (l.group === "weekly") return model ? `주간 한도 · ${model}` : "주간 한도 · 모든 모델";
  if (/session|five|5h/.test(`${l.group} ${l.kind}`)) return "현재 세션 (5시간)";
  return model ? `${l.kind} · ${model}` : l.kind;
}

// 회사 계정(claude-accounts 확장): 사용량 API 권한이 없는 장기 토큰이라, 확장과 Claude Code 상태 줄이 공유 파일에 적어 둔 값을 읽는다
const workLimits = (now = Date.now()) => sharedLimits("anthropic-work", false, now);

/** pi 로그인으로 사용량을 조회하지 못할 때: 공유 파일에 적힌 값(Claude Code 상태 줄·pi 확장)으로 만든 사용량.
 *  pi 를 쓰지 않고 Claude Code 만 써도 사용량이 보이게 한다. 요금제 이름·모델별 한도·추가 사용량은 조회가 될 때만 알 수 있다 */
function sharedUsage() {
  const limits = [...sharedLimits("anthropic", true), ...workLimits()];
  if (!limits.length) return null;
  return {
    plan: "", limits, source: "shared",
    extra: { enabled: false, used: null, limit: null, currency: null, decimals: null, percent: null },
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchUsage(force = false) {
  if (!force && usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return usageCache.data;
  const work = refreshWorkUsage();   // 회사 계정 값을 공유 파일에(조회 전용 로그인이 있을 때만). 개인 조회와 나란히 하고, 값을 읽기 전에 기다린다
  const { token, error } = FAKE_USAGE_FILE ? { token: "" } : await anthropicToken();
  if (error) {
    await work;
    const data = sharedUsage();
    if (!data) return { error: "아직 사용량 값이 없어요. 맥에서 Claude Code 나 pi 를 한 번 쓰면 보여요" };
    usageCache = { at: Date.now(), data };
    return data;
  }
  try {
    const u = FAKE_USAGE_FILE ? JSON.parse(readFileSync(FAKE_USAGE_FILE, "utf8")) : await anthropicGet("/api/oauth/usage", token);
    if (!FAKE_USAGE_FILE && (!planCache || Date.now() - planCache.at > 3600_000)) {
      try {
        planCache = { at: Date.now(), plan: planLabel((await anthropicGet("/api/oauth/profile", token)).organization) };
      } catch {
        /* 요금제 이름은 없어도 됨 */
      }
    }
    const limits = [];
    const list = Array.isArray(u.limits) ? u.limits : [];
    const hasSession = list.some((l) => /session|five|5h/.test(`${l.group} ${l.kind}`));
    if (!hasSession && u.five_hour && typeof u.five_hour.utilization === "number") {
      limits.push({ key: "session", label: "현재 세션 (5시간)", percent: u.five_hour.utilization, resetsAt: u.five_hour.resets_at ?? null, session: true, severity: "normal" });
    }
    for (const l of list) {
      const model = l?.scope?.model?.display_name;
      limits.push({
        // 기록·그래프용 구분: session | week(모든 모델) | week:<모델>
        key: l.group === "weekly" ? (model ? `week:${model}` : "week") : "session",
        label: limitLabel(l),
        percent: typeof l.percent === "number" ? l.percent : 0,
        resetsAt: l.resets_at ?? null,
        session: l.group !== "weekly",
        severity: l.severity || "normal",
      });
    }
    await work;
    limits.push(...workLimits());
    const ex = u.extra_usage || {};
    const data = {
      plan: planCache?.plan || "",
      limits,
      extra: {
        enabled: !!ex.is_enabled,
        used: ex.used_credits ?? null,
        limit: ex.monthly_limit ?? null,
        currency: ex.currency ?? null,
        decimals: ex.decimal_places ?? null,
        percent: ex.utilization ?? null,
      },
      fetchedAt: new Date().toISOString(),
    };
    usageCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    // 조회가 안 되면(네트워크·권한) 공유 파일의 값이라도 보여 준다
    await work;
    return sharedUsage() ?? { error: `사용량을 불러오지 못했어요 (${e.message})` };
  }
}

// 개인·회사 계정이 섞였는지(한쪽 탭이 다른 계정으로 돎): 사용량을 기록할 때마다 보고, 섞였으면 폰에 알림.
// 같은 일로는 6시간에 한 번만(브리지를 다시 켜도 다시 보내지 않게 파일에 남김). 풀린 것이 확인되면(둘 다 최근 값이고 서로 다름)
// 지우고, 다시 섞이면 바로 알림. 한쪽 값이 오래돼 알 수 없을 때는 그대로 둔다. 계정을 하나만 쓰면 알리지 않음
const ACCOUNT_ALERT_FILE = `${process.env.HOME}/.cache/pi-remote/account-alert.json`;
function checkAccounts() {
  try {
    let last = {};
    try {
      last = JSON.parse(readFileSync(ACCOUNT_ALERT_FILE, "utf8"));
    } catch {
      /* 아직 알린 적 없음 */
    }
    const state = accountsState();
    if (state === "separate" && last.kind) writeFileSync(ACCOUNT_ALERT_FILE, "{}");   // 풀림: 다음에 섞이면 바로 알림
    if (state !== "mixed") return;
    const kind = mixedDirection() ?? "unknown";
    const t = MIXED_TEXT[kind];
    console.warn(`[pi-remote] ${t.title}(개인·회사 주간 사용률과 초기화 시각이 같음)`);
    if (last.kind === kind && Date.now() - (last.at ?? 0) < 6 * 3600_000) return;
    mkdirSync(dirname(ACCOUNT_ALERT_FILE), { recursive: true });
    writeFileSync(ACCOUNT_ALERT_FILE, JSON.stringify({ kind, at: Date.now() }));
    notify({ kind: "account", title: t.title, body: t.body }).catch(() => {});
  } catch (e) {
    console.warn(`[pi-remote] 계정 확인 실패: ${e.message}`);
  }
}

// 사용량 기록(주간 그래프): 10분마다(usage-history.mjs)
const usageTick = () => fetchUsage(true).then(recordUsage).then(recordWorkUsage).then(checkAccounts);
setTimeout(usageTick, Number(process.env.PI_REMOTE_USAGE_FIRST_MS ?? 10_000));
setInterval(usageTick, 10 * 60_000);

// 현재 보고 있는 tmux 창의 pane id(예: %0). 대화 피드 소켓을 고르는 데 쓴다.
const FEED_DIR = `${process.env.HOME}/.cache/pi-remote/feed`;
// 피드가 잠깐 끊겼을 때 채팅 화면을 유지하는 시간(측정: 다시 불러오기 0.3초, 긴 대화 pi 재시작 3.1초 → 여유 두고 8초)
const FEED_GRACE_MS = 8000;
function activePaneId() {
  try {
    return execSync(`${TMUX_BIN} display -p -t ${SESSION} '#{pane_id}'`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// 폰의 '새 탭'에서 고르는 도구(사용자 결정 11-18: 열 때마다 고름). cmd 는 새 탭의 셸에 넣을 명령이다
// (셸에 넣으므로 별칭·함수도 그대로 쓰임. 예: 계정을 고르는 claude 함수). 정해 둔 이 넷만 받는다(임의 입력 차단).
// 채팅 화면이 없는 도구(터미널 화면으로 씀)는 탭 이름을 정해 준다: 안 정하면 tmux 가 'node' 처럼 실행 파일 이름을 붙여 알아볼 수 없다.
// 앱에는 이름 목록을 탭 목록 메시지에 얹어 알린다(그 목록이 오는 브리지에서만 앱이 고르는 메뉴를 보임)
const NEW_TAB_TOOLS = {
  claude: { cmd: "claude" },
  pi: { cmd: "pi" },
  codex: { cmd: "codex", name: "Codex" },
  gemini: { cmd: "gemini", name: "Gemini" },
};
// 시험: 켤 명령 앞에 붙일 글(예: 'echo started:' → 진짜 도구를 켜지 않고 무엇을 켜려 했는지만 찍음)
const NEW_TAB_PREFIX = process.env.PI_NEW_TAB_PREFIX ? `${process.env.PI_NEW_TAB_PREFIX} ` : "";

// 앱이 보낼 수 있는 pi 명령은 모델·생각 깊이 지정만 허용(임의 입력 차단).
const PI_COMMAND = new RegExp(`^/(model [A-Za-z0-9._/:-]+|thinking (${LEVELS})|new|reload|plan (on|off)|mode (auto|ask|plan|manual|acceptEdits))$`);   // plan: 계획 모드, mode: 권한 모드 칩

/** 맥 입력창(pi·Claude Code)이 비었는지(status-line.mjs 의 editorEmpty). 명령은 입력창에 붙여 넣고 Enter 를 치는 방식이라 쓰던 글이 있으면 보내지 않음 */
function macEditorEmpty() {
  try {
    return editorEmpty(execFileSync(TMUX_BIN, ["capture-pane", "-p", "-t", SESSION], { encoding: "utf8" }));
  } catch {
    return false;
  }
}
const EDITOR_BUSY = "맥 입력창에 쓰던 글이 있어 명령을 보내지 않았어요";

// 폰에서 보낸 사진(~/.cache/pi-remote/img-*)과 썸네일은 7일 지나면 지운다(디스크가 계속 차지 않게)
const IMG_DIR = `${process.env.HOME}/.cache/pi-remote`;
const THUMB_DIR = `${IMG_DIR}/thumbs`;
const IMG_KEEP_MS = 7 * 24 * 3600_000;
function cleanupImages() {
  let n = 0;
  for (const dir of [IMG_DIR, THUMB_DIR]) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.startsWith("img-")) continue;
        const p = `${dir}/${f}`;
        if (Date.now() - statSync(p).mtimeMs > IMG_KEEP_MS) {
          unlinkSync(p);
          n++;
        }
      }
    } catch {
      /* 폴더가 없으면 무시 */
    }
  }
  if (n) console.log(`[pi-remote] 지난 사진 ${n}개 정리`);
}

// 썸네일(작게: 360px, 미리보기: 1024px). 요청 경로는 파일 이름만 보고 사진 폴더 안에서만 찾는다(다른 파일 못 읽게).
function makeThumb(path, size) {
  const base = String(path).split("/").pop();
  if (!/^img-\d+\.(jpe?g|png)$/i.test(base)) return { error: "허용되지 않은 경로" };
  const src = `${IMG_DIR}/${base}`;
  if (!existsSync(src)) return { error: "사진이 없어요(7일 지나 정리됐을 수 있어요)" };
  if (size === "full") {
    // 전체화면 확대용: 원본 그대로(폰에서 보낸 사진은 이미 긴 변 2048 이하)
    try {
      const data = readFileSync(src);
      if (data.length > 8 * 1024 * 1024) return { error: "사진이 너무 커요" };
      return { data: data.toString("base64") };
    } catch (e) {
      return { error: `읽기 실패: ${e.message}` };
    }
  }
  const px = size === "large" ? 1024 : 360;
  const out = `${THUMB_DIR}/${base.replace(/\.\w+$/, "")}-${px}.jpg`;
  try {
    if (!existsSync(out)) {
      mkdirSync(THUMB_DIR, { recursive: true });
      execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", String(px), src, "--out", out], { stdio: "ignore" });
    }
    return { data: readFileSync(out).toString("base64") };
  } catch (e) {
    return { error: `썸네일 실패: ${e.message}` };
  }
}
cleanupImages();
setInterval(cleanupImages, 6 * 3600_000).unref();

// --- 폰 알림은 맥이 잠겼거나 10분 넘게 맥을 안 만졌을 때만 보냄(사용자 결정 11-12) ---
// 맥을 쓰는 중(안 잠김 + 10분 안에 키보드·마우스) = 보내지 않음. 상태를 읽지 못하면 보냄(알림을 놓치지 않게).
// 질문·승인·확인 창은 잡아 뒀다가, 답하기 전에 맥을 잠그거나 10분이 지나면 그때 보낸다. 작업 끝·오류 알림은 버린다
// (이 맥은 화면이 꺼지지 않아 저절로 잠기지 않음 → 잠그지 않고 떠난 경우를 10분 기준으로 막음)
const MAC_IDLE_SEC = Number(process.env.PI_REMOTE_MAC_IDLE_SEC) || 600;
const HOLD_CHECK_MS = Number(process.env.PI_REMOTE_HOLD_CHECK_MS) || 15_000;
const HOLD_MAX_MS = 6 * 3600_000;
const ASKING_KINDS = new Set(["approval", "prompt", "choice", "question"]);

/** 맥 키보드·마우스를 마지막으로 쓴 뒤 지난 초(시험: PI_REMOTE_FAKE_IDLE_FILE 의 숫자) */
function macIdleSec() {
  try {
    if (process.env.PI_REMOTE_FAKE_IDLE_FILE) return Number(readFileSync(process.env.PI_REMOTE_FAKE_IDLE_FILE, "utf8").trim());
    const out = execFileSync("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"], { encoding: "utf8", timeout: 3000 });
    const m = out.match(/"HIDIdleTime" = (\d+)/);
    return m ? Number(m[1]) / 1e9 : null;
  } catch {
    return null;
  }
}

/** 맥 화면이 잠겼는지(내 계정이 화면 앞에 없으면 잠긴 것으로). 모르면 null(시험: PI_REMOTE_FAKE_LOCKED_FILE 의 1·0) */
function macLocked() {
  try {
    if (process.env.PI_REMOTE_FAKE_LOCKED_FILE) {
      const v = readFileSync(process.env.PI_REMOTE_FAKE_LOCKED_FILE, "utf8").trim();
      return v === "1" ? true : v === "0" ? false : null;
    }
    const out = execFileSync("/usr/sbin/ioreg", ["-n", "Root", "-d1"], { encoding: "utf8", timeout: 3000 });
    const users = (out.match(/"IOConsoleUsers" = \((.*)\)/) ?? [])[1];
    if (!users) return null;
    const me = users.split("},{").find((e) => e.includes(`"kCGSSessionUserNameKey"="${userInfo().username}"`));
    if (!me) return true;   // 다른 사용자로 바뀌었거나 로그인 창
    return /"CGSSessionScreenIsLocked"=Yes/.test(me) || !/"kCGSSessionOnConsoleKey"=Yes/.test(me);
  } catch {
    return null;
  }
}

/** 맥을 쓰는 중인지: 안 잠겼고 10분 안에 키보드·마우스를 씀. 확인하지 못하면 false(보냄) */
function macInUse() {
  if (macLocked() !== false) return false;
  const idle = macIdleSec();
  return idle !== null && idle < MAC_IDLE_SEC;
}

/** 탭 상태(tmux-tab-status 가 쓰는 @pi_status: asking 이면 아직 답을 기다림) */
function windowStatus(window) {
  try {
    return execFileSync(TMUX_BIN, ["show-options", "-w", "-v", "-t", `${SESSION}:${window}`, "@pi_status"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** 알림 보내기 전 확인: false 면 보류 */
function gateNotify(m) {
  const window = Number.isInteger(m?.window) ? m.window : null;
  if (window === null || !macInUse()) return true;
  console.log(`[pi-remote] 맥을 쓰는 중이라 알림 보류(${m.kind}, 탭 ${window})`);
  if (!ASKING_KINDS.has(m.kind)) return false;
  const since = Date.now();
  const tick = () => {
    if (windowStatus(window) !== "asking") return console.log(`[pi-remote] 답해서 보류한 알림 취소(${m.kind}, 탭 ${window})`);
    if (!macInUse()) {
      console.log(`[pi-remote] 맥이 잠겼거나 10분 넘게 안 써서 보류한 알림 보냄(${m.kind}, 탭 ${window})`);
      return void notify(m);
    }
    if (Date.now() - since < HOLD_MAX_MS) setTimeout(tick, HOLD_CHECK_MS).unref();
  };
  setTimeout(tick, HOLD_CHECK_MS).unref();
  return false;
}

// --- 맥북 배터리(사용자 요청 11-16): 1분마다 읽어 앱의 '연결됨' 옆에 보이고, 충전기 없이 20% 아래로 내려가면 폰에 한 번 알림 ---
// 배터리가 없는 맥이면 null 이라 아무것도 하지 않는다. 알림은 맥을 쓰는 중이면 미룬다(맥 화면이 스스로 경고함): 쓰지 않게 되면
// 다음 확인 때 보낸다. 충전기를 꽂거나 기준 위로 올라가면 풀려서, 다시 내려가면 또 한 번 알린다
let battery = null;
let batteryLowSent = false;
function batteryTick() {
  battery = readBattery();
  if (!battery?.low) batteryLowSent = false;
  else if (!batteryLowSent && !macInUse()) {
    batteryLowSent = true;
    notify({ kind: "battery", title: `맥 배터리 ${battery.percent}%`, body: "충전기를 연결해 주세요" }).catch(() => {});
  }
}
batteryTick();
setInterval(batteryTick, Number(process.env.PI_REMOTE_BATTERY_SEC ?? 60) * 1000).unref();

// --- 맥에 뜬 권한 창(사용자 요청 11-19): 10초마다 보고, 떠 있으면 어느 탭·무슨 권한인지 폰에 한 번 알림(맥을 쓰는 중이면 미룸) ---
// macOS 가 이 창을 프로그램이 누르지 못하게 막아 둬서 폰에서 허용할 수는 없다. 자세한 것은 mac-prompts.mjs
const promptTick = createPromptWatch({
  listWindows: readWindows,
  requests: readRequests,
  tabOf: tabFinder(TMUX_BIN, SESSION),
  inUse: macInUse,
  send: (m) => {
    console.log(`[pi-remote] 맥 권한 창: ${m.body}`);
    return notify({ kind: "permission", ...m });
  },
});
setInterval(() => promptTick().catch(() => {}), Number(process.env.PI_REMOTE_PROMPT_CHECK_SEC ?? 10) * 1000).unref();

// --- tmux 탭 저장·되살리기(재부팅 뒤, 사용자 결정 11-12) ---
// 1분마다 탭 목록(번호·이름·폴더·pi/Claude 대화)을 저장하고, 브리지가 켜질 때 세션이 없으면 그대로 되살린 뒤 폰에 한 번 알림
const TABS_FILE = process.env.PI_REMOTE_TABS_FILE || `${process.env.HOME}/.cache/pi-remote/tabs-${SESSION}.json`;
let restoreReport = null;   // 이번에 세션을 만들었으면 { restored, pi, claude, shell, fromSnapshot }
/** 탭을 고르면 '끝났어요'를 지우는 훅(windows.mjs). pi 를 켜지 않은 맥에서도 걸리게 세션을 챙길 때마다 건다(여러 번 걸어도 같음) */
function ensureSeenHook() {
  try {
    execFileSync(TMUX_BIN, ["set-hook", "-g", SEEN_HOOK, SEEN_HOOK_CMD], { stdio: "ignore" });
  } catch {
    /* tmux 서버가 없으면 다음에 */
  }
}
function ensureSession() {
  try {
    execFileSync(TMUX_BIN, ["has-session", "-t", `=${SESSION}`], { stdio: "ignore" });
    ensureSeenHook();
    return;
  } catch {
    /* 없음 → 만듦 */
  }
  const snap = loadSnapshot(TABS_FILE);
  try {
    const c = createSession(TMUX_BIN, SESSION, snap?.tabs ?? null);
    restoreReport = { ...c, fromSnapshot: !!snap };
    console.log(snap
      ? `[pi-remote] tmux 세션 '${SESSION}' 을 되살림: 탭 ${c.restored}개(pi ${c.pi}·Claude ${c.claude}·셸 ${c.shell})`
      : `[pi-remote] tmux 세션 '${SESSION}' 이 없어 새로 만듦(저장된 탭 목록 없음)`);
  } catch (e) {
    console.warn(`[pi-remote] tmux 세션을 만들지 못함: ${e.message}`);
  }
  ensureSeenHook();
}
ensureSession();
const saveTabs = () => {
  const tabs = snapshotTabs(TMUX_BIN, SESSION);
  if (tabs) saveSnapshot(TABS_FILE, SESSION, tabs);   // 세션이 없으면(지운 직후 등) 마지막 저장본을 그대로 둠
};
setTimeout(saveTabs, restoreReport ? 90_000 : 5_000).unref();   // 되살린 직후엔 pi·Claude 가 다 뜬 뒤에
setInterval(saveTabs, Number(process.env.PI_REMOTE_TABS_SAVE_SEC ?? 60) * 1000).unref();

/**
 * 재부팅 점검 알림: 세션을 만들었으면 밖에서 붙을 주소(PI_REMOTE_HOSTS: VPN·Tailscale)가 올라오기를 최대 90초 기다려 보고 폰에 한 번.
 * 주소를 적지 않았으면(같은 Wi-Fi 에서만 씀) 기다리지 않고, 알림에서도 말하지 않는다
 */
async function reportRestore() {
  if (!restoreReport) return;
  const reach = () => {
    try {
      return outsideReach({ hosts: parseHosts(process.env.PI_REMOTE_HOSTS), prefix: process.env.PI_REMOTE_VPN_PREFIX || "" });
    } catch {
      return false;
    }
  };
  let vpn = reach();
  const tries = Math.ceil(Number(process.env.PI_REMOTE_REACH_WAIT_SEC ?? 90) / 5);
  for (let i = 0; i < tries && vpn === false; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    vpn = reach();
  }
  let uptimeSec = 0;
  try {
    const m = execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8" }).match(/sec = (\d+)/);
    uptimeSec = m ? Math.floor(Date.now() / 1000) - Number(m[1]) : 0;
  } catch {
    /* 모르면 0 */
  }
  const r = restoreReport;
  const tabs = r.fromSnapshot ? `탭 ${r.restored}개 되살림(pi ${r.pi}·Claude ${r.claude}·셸 ${r.shell})` : "저장된 탭 목록이 없어 빈 세션을 만들었어요";
  const body = `${tabs}${reachText(vpn)} · 브리지 동작 중`;
  console.log(`[pi-remote] 재부팅 점검: ${body}`);
  notify({ kind: "boot", title: uptimeSec && uptimeSec < 20 * 60 ? "맥이 다시 켜졌어요" : "tmux 세션을 되살렸어요", body }).catch(() => {});
}
setTimeout(reportRestore, Number(process.env.PI_REMOTE_RESTORE_REPORT_DELAY_MS ?? 15_000)).unref();

// 연결 암호화: 이 맥의 인증서(없으면 만듦). 폰은 짝짓기 QR 로 받은 지문의 맥만 믿는다(tls.mjs).
// 예전 앱은 암호화 없이 붙으므로 기본으로는 둘 다 받고, 설정에 PI_REMOTE_TLS_ONLY=1 이면 암호화 연결만 받는다(새 설치의 기본)
const tlsCert = ensureCert(`${CONFIG_DIR}/tls`);
const TLS_ONLY = process.env.PI_REMOTE_TLS_ONLY === "1" && Boolean(tlsCert);
if (!tlsCert) console.warn("[pi-remote] 인증서를 만들지 못해 암호화 없이 엽니다(/usr/bin/openssl 확인)");
const wss = new WebSocketServer({ noServer: true });
const server = createDualServer({
  tls: tlsCert,
  allowPlain: !TLS_ONLY,
  onUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
});
server.listen(PORT, HOST);
// pi 확장이 폰 알림을 요청하는 로컬 소켓(이 브리지가 맡은 tmux 세션 전용)
startNotifySocket(`${process.env.HOME}/.cache/pi-remote/notify-${SESSION}.sock`);
setNotifyGate(gateNotify);
console.log(`[pi-remote] 폰 알림: ${pushEnabled ? "켜짐(Apple 푸시)" : "꺼짐(APNs 설정 없음)"}`);

server.on("listening", () => {
  const how = !tlsCert ? "암호화 없음" : TLS_ONLY ? "암호화 연결만" : "암호화 연결, 예전 앱용으로 암호화 없는 연결도";
  console.log(`[pi-remote] 브리지 시작: ${tlsCert ? "wss" : "ws"}://${HOST}:${PORT}  (tmux 세션: "${SESSION}", ${how})`);
});

// 같은 Wi-Fi 에서 폰이 IP 없이 자동 발견하도록 Bonjour(mDNS) 광고. 네트워크가 끊긴 순간의 오류로 죽지 않게 따로 뺌(advertise.mjs)
const advert = advertise({ port: PORT, session: SESSION });

// 모듈 폴더 지키기(deps.mjs): 켤 때와 1분마다 보고, 지워졌으면 잠금 파일대로 다시 설치한다(11-18 용량 정리로 지워져 앱이 '연결 중'에 멈춘 일).
// 이미 올려 둔 모듈은 그대로 쓰이므로 다시 시작하지 않아도 된다
const deps = createDepsGuard({ dir: dirname(fileURLToPath(import.meta.url)) });
deps.check("시작");
setInterval(() => deps.check("정기 점검"), Number(process.env.PI_REMOTE_DEPS_CHECK_SEC ?? 60) * 1000).unref();

function shutdown() {
  advert.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 단축어로 시킨 일: 폰이 짧은 접속으로 보낸 할 일을 새 백그라운드 탭에서 시작(폰의 '백그라운드로 보내기'와 같은 실행기)
const startTask = createTaskStarter({ launch: launchBackground, home: process.env.HOME, session: SESSION, log: (text) => console.log(`[pi-remote] ${text}`) });

wss.on("connection", (ws, req) => {
  const peer = req.socket.remoteAddress;
  const url = new URL(req.url || "/", "http://localhost");

  if (blocked(peer)) {
    ws.close(4029, "too many attempts");
    return;
  }

  // --- 짝짓기: 맥의 짝짓기 명령이 QR 에 담은 코드(5분, 한 번)를 내면 이 기기만의 토큰을 받는다 ---
  if (url.pathname === "/pair") {
    // 코드와 새 토큰이 지나가는 길이라 암호화 연결로만 받는다(인증서를 만들지 못한 맥은 어쩔 수 없이 그대로)
    if (tlsCert && !req.socket.encrypted) {
      ws.send(JSON.stringify({ type: "pair-failed", reason: "insecure" }));
      setTimeout(() => ws.close(), 300);
      return;
    }
    const giveUp = setTimeout(() => ws.close(4008, "timeout"), 10_000);
    ws.once("message", (raw) => {
      clearTimeout(giveUp);
      let m = null;
      try {
        m = JSON.parse(String(raw));
      } catch {
        /* 아래에서 잘못된 요청으로 */
      }
      const r = m?.type === "pair" ? devices.redeem(m.code, m.name) : { error: "invalid" };
      if (r.token) {
        console.log(`[pi-remote] 짝짓기: ${peer} → 기기 ${r.id} 등록`);
        ws.send(JSON.stringify({ type: "paired", token: r.token, id: r.id }));
      } else {
        failed(peer);
        console.warn(`[pi-remote] 짝짓기 실패(${r.error}): ${peer}`);
        ws.send(JSON.stringify({ type: "pair-failed", reason: r.error }));
      }
      setTimeout(() => ws.close(), 300);
    });
    return;
  }

  // --- 인증 ---
  const who = authenticate(req, url);
  if (!who) {
    failed(peer);
    console.warn(`[pi-remote] 인증 실패: ${peer}`);
    ws.close(4001, "unauthorized");
    return;
  }
  // 연결해 둔 사이에 끊긴 기기(짝짓기 명령의 끊기)는 1분 안에 내보낸다
  if (who.device) {
    const stillOk = setInterval(() => {
      if (!devices.list().some((d) => d.id === who.device.id)) {
        console.log(`[pi-remote] 끊긴 기기라 연결을 닫음: ${who.device.id}`);
        ws.close(4003, "revoked");
      }
    }, Number(process.env.PI_REMOTE_REVOKE_CHECK_MS ?? 60_000));
    stillOk.unref();
    ws.on("close", () => clearInterval(stillOk));
  }

  // 짧은 접속: 앱이 백그라운드로 깨어났을 때도 잠깐 붙어 요청 하나를 낸다. tmux 를 붙이지 않음
  // - 작업 표시(Live Activity) 토큰 등록  - 단축어로 시킨 일(새 백그라운드 탭에서 시작하고 답을 돌려줌. tasks.mjs)
  if (url.pathname === "/push") {
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m.type === "live-register") registerLiveStart(String(m.token ?? ""), String(m.env ?? ""));
        if (m.type === "activity-token") registerActivity(Number(m.window), String(m.token ?? ""), String(m.env ?? ""));
        if (m.type === "task-start") ws.send(JSON.stringify(startTask(m)));
      } catch {
        /* 잘못된 메시지는 무시 */
      }
    });
    setTimeout(() => ws.close(), 10_000);
    return;
  }

  const cols = clampInt(url.searchParams.get("cols"), 80, 20, 500);
  const rows = clampInt(url.searchParams.get("rows"), 24, 5, 300);

  console.log(`[pi-remote] 접속: ${peer}  (${cols}x${rows}${req.socket.encrypted ? ", 암호화" : ""}${who.device ? `, 기기 ${who.device.id}` : ", 예전 공유 토큰"})`);

  // --- pty에서 tmux attach ---
  let term;
  try {
    // ignore-size: 폰이 붙어도 맥 화면 크기를 바꾸지 않음(알림·작업 표시로 앱이 잠깐 깨어날 때 맥 창이 폰 크기로 줄던 문제).
    // 폰에서 터미널 보기를 실제로 보고 있을 때만 앱이 {type:"view",terminal:true} 로 알려 해제한다
    ensureSession();
    term = pty.spawn(TMUX_BIN, ["-u", "attach", "-f", "ignore-size", "-t", SESSION], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME,
      env: { ...process.env, TERM: "xterm-256color" },
    });
  } catch (err) {
    // 모듈(보조 실행 파일 등)이 지워졌으면 그 자리에서 다시 설치한다. 앱은 끊기면 스스로 다시 붙으므로 설치가 끝난 뒤의 접속부터 된다
    const fixing = deps.check("tmux 실행 실패");
    console.error(`[pi-remote] tmux 실행 실패: ${err.message}${fixing ? " → 모듈을 다시 설치하는 중" : ""}`);
    ws.close(4002, fixing ? "repairing" : "tmux spawn failed");
    return;
  }

  // pty 출력 → 폰 (바이너리)
  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, "utf8"));
  });

  // --- 대화 피드: 현재 창의 pi 확장(pi-remote-feed) 소켓에 붙어 줄 단위 JSON 을 폰으로 전달 ---
  // 폰으로는 {"type":"chat","d":<피드 이벤트>} 로 보낸다. pi 가 없거나 확장이 없는 창이면 {t:"unavailable"}.
  let feed = null;
  let feedPane = null;
  let feedBuf = "";
  let feedRetry = null;
  let feedOn = null; // 마지막으로 알린 상태(true/false). 같은 상태는 다시 알리지 않음
  let feedCanSend = false; // 확장이 send 명령을 처리할 수 있는지(대화 전체에 canSend 표시가 있을 때만)
  let feedAgent = "pi";   // 이 탭의 피드: pi 확장 | claude(Claude Code 용 피드)
  // 잘 붙어 있던 피드가 끊겼을 때(확장 다시 불러오기 0.3초·pi 재시작 3초 안팎) 이 시각까지는 '쓸 수 없음'을 보내지 않음
  // → 앱이 잠깐 터미널로 바뀌었다 돌아오는 깜빡임을 막는다. 처음부터 피드가 없는 창(셸 등)은 바로 알림
  let feedGraceUntil = 0;
  const sendChat = (raw) => {
    if (ws.readyState === ws.OPEN) ws.send(`{"type":"chat","d":${raw}}`);
  };
  const markFeed = (on) => {
    if (feedOn === on) return;
    feedOn = on;
    if (!on) sendChat('{"t":"unavailable"}');
  };
  const closeFeed = () => {
    clearTimeout(feedRetry);
    if (feed) {
      feed.removeAllListeners();
      feed.on("error", () => {});
      feed.destroy();
    }
    feed = null;
  };
  const connectFeed = (pane) => {
    closeFeed();
    if (pane !== feedPane) feedGraceUntil = 0; // 다른 창으로 바뀌면 기다리지 않음
    feedPane = pane;
    feedBuf = "";
    feedCanSend = false;
    if (!pane) return markFeed(false);
    const sock = createConnection(`${FEED_DIR}/${pane.replace(/\W/g, "")}.sock`);
    feed = sock;
    let gotData = false;
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => {
      gotData = true;
      feedGraceUntil = 0;
      feedOn = true;
      feedBuf += chunk;
      let i;
      while ((i = feedBuf.indexOf("\n")) >= 0) {
        const line = feedBuf.slice(0, i);
        feedBuf = feedBuf.slice(i + 1);
        if (line) {
          if (line.startsWith('{"t":"snapshot"')) {
            feedCanSend = line.includes('"canSend":true');
            feedAgent = line.includes('"agent":"claude"') ? "claude" : "pi";
          }
          sendChat(line);
        }
      }
    });
    const fail = () => {
      if (feed !== sock) return; // 이미 다른 연결로 바뀜
      feed = null;
      // 잘 붙어 있던 연결이 끊김(다시 불러오기·재시작): 잠깐은 채팅 화면을 그대로 두고 자주 다시 붙어 본다
      if (gotData && !feedGraceUntil) feedGraceUntil = Date.now() + FEED_GRACE_MS;
      const waiting = feedGraceUntil > 0 && Date.now() < feedGraceUntil;
      if (!waiting) {
        feedGraceUntil = 0;
        markFeed(false);
      }
      // pi 가 다시 뜨거나 /reload 하면 소켓이 생기므로 주기적으로 재시도
      feedRetry = setTimeout(() => {
        if (ws.readyState === ws.OPEN && feedPane === pane) connectFeed(pane);
      }, waiting ? 500 : 2000);
    };
    sock.on("error", fail);
    sock.on("close", fail);
  };

  // --- tmux 창 목록·pi 상태 실시간 푸시 (앱 탭바·상단바용) ---
  let lastWindowsJson = "";
  let lastStatusJson = "";
  let emptyReads = 0;
  let modelsSent = false;
  const pushWindows = () => {
    if (ws.readyState !== ws.OPEN) return;
    // 맥북 배터리는 이 메시지에 얹는다(새 종류의 메시지를 만들면 예전 앱이 그 글자를 터미널 화면에 그림). 값이 바뀌어도 다시 보냄
    // 새 탭에서 고를 수 있는 도구(newTabTools)도 같은 까닭으로 여기에 얹는다
    const json = JSON.stringify({ type: "windows", windows: forApp(listWindows()), newTabTools: Object.keys(NEW_TAB_TOOLS), ...(battery ? { battery } : {}) });
    if (json !== lastWindowsJson) {
      lastWindowsJson = json;
      ws.send(json);
    }
    // 화면 읽기가 잠깐 비는 건 무시하고, 3번(약 3초) 연속 비면 pi 가 없는 창으로 보고 빈 값을 보낸다
    const status = readPiStatus();
    emptyReads = status.model ? 0 : emptyReads + 1;
    const st = JSON.stringify({ type: "pistatus", ...status });
    if (st !== lastStatusJson && (status.model || emptyReads >= 3)) {
      lastStatusJson = st;
      ws.send(st);
    }
    if (!modelsSent && MODELS.length) {
      modelsSent = true;
      ws.send(JSON.stringify({ type: "models", models: MODELS }));
    }
    // 보고 있는 창이 바뀌면 그 창의 대화 피드로 갈아탄다
    // tmux 읽기가 한 번 실패해 빈 값이 오면 무시(창이 없어진 것으로 보지 않음)
    const pane = activePaneId();
    if (pane && pane !== feedPane) connectFeed(pane);
  };
  const winTimer = setInterval(pushWindows, 1000);
  pushWindows();

  // tmux 종료(세션 없음/detach) → 소켓 닫기
  term.onExit(({ exitCode }) => {
    console.log(`[pi-remote] tmux 종료 (code=${exitCode}): ${peer}`);
    clearInterval(winTimer);
    closeFeed();
    if (ws.readyState === ws.OPEN) ws.close(4003, "tmux exited");
  });

  // 폰 → pty
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // 키 입력
      term.write(data.toString("utf8"));
      return;
    }
    // 텍스트 = 제어 메시지(JSON)
    const text = data.toString("utf8");
    if (text && text[0] === "{") {
      try {
        const msg = JSON.parse(text);
        if (msg.type === "view") {
          // 터미널 보기를 보고 있으면 폰 크기로 맞추고, 아니면 크기에 영향 없음
          const on = msg.terminal === true;
          try {
            const line = execSync(`${TMUX_BIN} list-clients -F '#{client_pid} #{client_name}'`, { encoding: "utf8" })
              .split("\n").find((l) => l.startsWith(`${term.pid} `));
            const name = line?.split(" ")[1];
            if (name) execSync(`${TMUX_BIN} refresh-client -t ${name} -f ${on ? "!ignore-size" : "ignore-size"}`);
          } catch {
            /* 클라이언트가 막 끊겼으면 무시 */
          }
          return;
        }
        if (msg.type === "resize") {
          term.resize(
            clampInt(msg.cols, cols, 20, 500),
            clampInt(msg.rows, rows, 5, 300)
          );
          return;
        }
        if (msg.type === "select-window") {
          // 앱 탭 터치 → tmux 창 전환 (index 는 정수로 강제해 인젝션 방지)
          const idx = clampInt(msg.index, 0, 0, 999);
          try {
            execSync(`${TMUX_BIN} select-window -t ${SESSION}:${idx}`);
          } catch {
            /* 창이 없으면 무시 */
          }
          pushWindows();
          return;
        }
        if (msg.type === "sessions") {
          listSessions().then(({ items, error }) => {
            const open = openSessions();
            const out = items.map((s) => {
              const o = open.get(s.path);
              return { ...s, open: o ? { here: o.session === SESSION, index: o.index, name: o.name } : null };
            });
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "sessions", items: out, error }));
          });
          return;
        }
        if (msg.type === "open-session") {
          // 지난 대화 열기: 이미 열린 탭이면 그 탭으로, 아니면 새 탭에서(지금 대화는 그대로 둠).
          // 같은 대화 파일을 pi 두 개가 동시에 쓰지 않도록 다른 tmux 세션에서 열려 있으면 거절한다.
          const reply = (o) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "session-opened", ...o }));
          const path = safeSessionPath(msg.path);
          if (!path) {
            reply({ error: "열 수 없는 대화예요" });
            return;
          }
          const o = openSessions().get(path);
          if (o && o.session !== SESSION) {
            reply({ error: "다른 곳(tmux 세션)에서 이미 열려 있어요" });
            return;
          }
          try {
            if (o) {
              execFileSync(TMUX_BIN, ["select-window", "-t", `${SESSION}:${o.index}`]);
              reply({ existing: true, name: o.name });
            } else {
              // 탭 이름은 대화 제목 앞부분(이름을 주면 tmux 가 'node' 로 바꾸지 않음). 제어문자 제거·20자 제한
              const title = String(msg.title ?? "").replace(/[\x00-\x1f\x7f]/g, "").replace(/:{3,}/g, ":").trim().slice(0, 20);
              const id = execFileSync(TMUX_BIN, ["new-window", "-P", "-F", "#{window_id}", "-t", SESSION, "-c", sessionCwd(path),
                ...(title ? ["-n", title] : [])], { encoding: "utf8" }).trim();
              const q = (x) => `'${x.replace(/'/g, "'\\''")}'`;
              const cmd = `pi ${SESSION_DIR ? `--session-dir ${q(SESSION_DIR)} ` : ""}--session ${q(path)}`;
              execFileSync(TMUX_BIN, ["send-keys", "-t", id, "-l", cmd]);
              execFileSync(TMUX_BIN, ["send-keys", "-t", id, "Enter"]);
              reply({ existing: false });
            }
          } catch (e) {
            console.warn(`[pi-remote] 지난 대화 열기 실패: ${e.message}`);
            reply({ error: "탭을 열지 못했어요" });
          }
          pushWindows();
          return;
        }
        if (msg.type === "push-register") {
          // 폰 앱이 보낸 알림용 기기 주소 등록
          const ok = registerToken(String(msg.token ?? ""), String(msg.env ?? "sandbox"));
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "push-status", enabled: pushEnabled, registered: ok, prefs: getPrefs() }));
          return;
        }
        if (msg.type === "push-prefs") {
          setPrefs({ done: msg.done === true ? true : msg.done === false ? false : undefined });
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "push-status", enabled: pushEnabled, registered: true, prefs: getPrefs() }));
          return;
        }
        if (msg.type === "rotate-token") {
          // 연결 토큰 새로 바꾸기(이미 토큰으로 붙은 폰만 요청 가능)
          try {
            if (who.device) {
              // 기기 토큰으로 붙은 폰: 이 기기의 토큰만 새로(다른 기기는 그대로, 다시 시작하지 않음)
              const r = devices.rotate(who.device.id);
              if (!r) throw new Error("이 기기가 등록돼 있지 않아요");
              ws.send(JSON.stringify({ type: "token-rotated", token: r.token }));
              console.log(`[pi-remote] 폰 요청으로 기기 ${who.device.id} 의 토큰을 새로 바꿈`);
            } else {
              // 예전 공유 토큰으로 붙은 폰: 이 폰을 기기로 등록해 그 토큰을 주고, 공유 토큰은 설정 파일에서 지운 뒤 다시 시작한다
              // → 공유 토큰은 더 못 쓴다(새어 나간 토큰을 없애는 길). 그 토큰을 쓰던 다른 폰은 다시 짝짓는다
              const envPath = process.env.PI_REMOTE_ENV || `${process.env.HOME}/.config/pi-remote/env`;
              const cur = readFileSync(envPath, "utf8");
              const r = devices.add(String(msg.name ?? "") || "예전 토큰에서 옮긴 기기");
              writeFileSync(`${envPath}.tmp`, cur.replace(/^PI_REMOTE_TOKEN=.*\n?/m, ""), { mode: 0o600 });
              renameSync(`${envPath}.tmp`, envPath);
              ws.send(JSON.stringify({ type: "token-rotated", token: r.token }));
              console.log(`[pi-remote] 폰 요청으로 예전 공유 토큰을 없애고 기기 ${r.id} 로 옮김 — 다시 시작`);
              setTimeout(() => process.exit(0), 1500);   // launchd 가 공유 토큰 없이 다시 띄움
            }
          } catch (e) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: `토큰을 바꾸지 못했어요: ${e.message}` } }));
          }
          return;
        }
        if (msg.type === "push-test") {
          notify({ title: "알림 시험", body: "pi-remote 알림이 잘 와요", kind: "test" }).then((r) => {
            const ok = r.some((x) => x.status === 200);
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: ok ? "시험 알림을 보냈어요" : pushEnabled ? "시험 알림을 보내지 못했어요" : "맥에 알림 설정이 없어요" } }));
          });
          return;
        }
        if (msg.type === "usage") {
          fetchUsage(!!msg.force).then((data) => {
            const graph = data.error ? {} : { history: usageHistoryForApp(), daily: dailyUsage(readUsageHistory(Date.now() - 8 * 86400_000)) };
            // 계정별(개인·회사): 앱이 카드 두 개·그래프 두 선으로 그림. 회사는 회사 계정을 쓸 때만 갱신된 값
            recordWorkUsage();
            const work = workUsageForApp();
            const wl = workLimits();
            const accounts = data.error ? undefined : [
              { key: "personal", label: "개인", plan: data.plan || "", limits: (data.limits || []).filter((l) => !String(l.key).startsWith("work:")), ...graph },
              ...(wl.length || work.history.length
                ? [{ key: "work", label: "회사", plan: "회사 계정", limits: wl.map((l) => ({ ...l, label: l.label.replace(/^회사 계정 · /, "").replace(/\s*\([^)]*전 기준\)$/, "") })), ...work }]
                : []),
            ];
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "usage", ...data, ...graph, ...(accounts ? { accounts } : {}) }));
          });
          return;
        }
        if (msg.type === "rename-window") {
          // 창 이름 바꾸기. 셸을 거치지 않고 인자로 넘기며, 제어문자 제거·40자 제한
          const idx = clampInt(msg.index, 0, 0, 999);
          const name = String(msg.name ?? "").replace(/[\x00-\x1f\x7f]/g, "").replace(/:{3,}/g, ":").trim().slice(0, 40);
          if (name) {
            try {
              execFileSync(TMUX_BIN, ["rename-window", "-t", `${SESSION}:${idx}`, name]);
            } catch {
              /* 창이 없으면 무시 */
            }
          }
          pushWindows();
          return;
        }
        if (msg.type === "close-window") {
          // 창 닫기(그 창의 pi 도 종료). 마지막 창은 세션이 사라지므로 닫지 않는다.
          const idx = clampInt(msg.index, 0, 0, 999);
          if (listWindows().length > 1) {
            try {
              execFileSync(TMUX_BIN, ["kill-window", "-t", `${SESSION}:${idx}`]);
            } catch {
              /* 창이 없으면 무시 */
            }
          }
          pushWindows();
          return;
        }
        if (msg.type === "close-finished-bg") {
          // 서랍의 '끝난 것 모두 닫기': 결과를 보낸 백그라운드 탭 가운데 쉬는 것만(다시 일하거나 묻거나 뒤에서 도는 일이 있으면 남김).
          // 지금 목록으로 다시 가리고, 창 번호 대신 창 고유 번호로 닫는다(닫는 사이 번호가 바뀌어도 다른 탭을 닫지 않게)
          const ids = finishedBackgroundIds(listWindows());
          for (const id of ids) {
            try {
              execFileSync(TMUX_BIN, ["kill-window", "-t", id]);
            } catch {
              /* 그새 닫혔으면 무시 */
            }
          }
          if (ids.length) console.log(`[pi-remote] 끝난 백그라운드 탭 ${ids.length}개 닫음`);
          pushWindows();
          return;
        }
        if (msg.type === "new-window") {
          // 폰에서 새 탭 열기: 셸을 띄운 뒤 도구를 켠다(도구를 끝내도 탭은 남음).
          // 도구를 고르는 앱(agent 를 보냄)은 고른 것을 보던 탭의 폴더에서(사용자 결정 11-18), 예전 앱(안 보냄)은 전처럼 홈에서 pi 를
          const chosen = msg.agent !== undefined;
          const tool = !chosen ? NEW_TAB_TOOLS.pi
            : typeof msg.agent === "string" && Object.hasOwn(NEW_TAB_TOOLS, msg.agent) ? NEW_TAB_TOOLS[msg.agent] : null;
          if (!tool) {
            console.warn(`[pi-remote] 새 탭: 모르는 도구 무시(${String(msg.agent).slice(0, 40)})`);
            return;
          }
          try {
            let cwd = process.env.HOME;
            if (chosen) {
              const pane = activePaneId();
              const dir = pane ? execFileSync(TMUX_BIN, ["display", "-p", "-t", pane, "#{pane_current_path}"], { encoding: "utf8", timeout: 3000 }).trim() : "";
              if (dir && existsSync(dir)) cwd = dir;
            }
            const id = execFileSync(TMUX_BIN, ["new-window", "-P", "-F", "#{window_id}", "-t", SESSION, "-c", cwd, ...(tool.name ? ["-n", tool.name] : [])],
              { encoding: "utf8" }).trim();
            execFileSync(TMUX_BIN, ["send-keys", "-t", id, "-l", `${NEW_TAB_PREFIX}${tool.cmd}`]);
            execFileSync(TMUX_BIN, ["send-keys", "-t", id, "Enter"]);
          } catch (e) {
            console.warn(`[pi-remote] 새 창 실패: ${e.message}`);
          }
          pushWindows();
          return;
        }
        if (msg.type === "set-account") {
          // Claude Code 탭의 계정 고르기(앱 칩, 사용자 결정 11-18): 그 탭의 연결부가 고른 값을 탭 옵션에 적고,
          // 일이 끝나면 인수인계 문서를 받아 그 계정으로 새로 켠다(claude-remote/claude-feed.mjs 의 pickAccount)
          const account = ["work", "personal", "auto"].includes(msg.account) ? msg.account : null;
          if (account && feed && feedOn && feedAgent === "claude") {
            feed.write(`${JSON.stringify({ cmd: "set-account", account })}\n`);
            setTimeout(pushWindows, 900);
          } else {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: "Claude Code 탭에서만 계정을 고를 수 있어요" } }));
          }
          return;
        }
        if (msg.type === "pi-command" && typeof msg.text === "string") {
          // 모델·생각 깊이 메뉴 선택 → 명령을 붙여넣기로 입력 후 Enter
          if (PI_COMMAND.test(msg.text)) {
            // Claude Code 탭: 피드가 Claude Code 명령으로 바꿔 붙여 넣음(/new → /clear, /thinking → /effort 등)
            if (feed && feedOn && feedCanSend && feedAgent === "claude") {
              feed.write(`${JSON.stringify({ cmd: "slash", text: msg.text })}\n`);
              setTimeout(pushWindows, 900);
              return;
            }
            // 모델·생각 깊이는 피드 확장이 pi 에 바로 설정(맥 입력창을 거치지 않음 → 범위 밖 모델·맥 입력창에 글이 있어도 됨)
            // 권한 모드·계획 모드도 피드로(맥 입력창을 거치지 않음)
            const pm = msg.text.match(/^\/mode (\S+)$/) ?? (msg.text === "/plan on" ? [0, "plan"] : null);
            if (pm && feed && feedOn && feedCanSend) {
              feed.write(`${JSON.stringify({ cmd: "set-perm-mode", mode: pm[1] })}\n`);
              return;
            }
            const mm = msg.text.match(/^\/model ([^/\s]+)\/(\S+)$/);
            const tm = msg.text.match(new RegExp(`^/thinking (${LEVELS})$`));
            if ((mm || tm) && feed && feedOn && feedCanSend) {
              feed.write(`${JSON.stringify(mm ? { cmd: "set-model", provider: mm[1], id: mm[2] } : { cmd: "set-thinking", level: tm[1] })}\n`);
              setTimeout(pushWindows, 700);
              return;
            }
            if (!macEditorEmpty()) {
              ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: EDITOR_BUSY } }));
              return;
            }
            term.write(`\x1b[200~${msg.text}\x1b[201~\r`);
            setTimeout(pushWindows, 700);
          } else {
            console.warn(`[pi-remote] 허용되지 않은 명령 무시: ${msg.text.slice(0, 60)}`);
          }
          return;
        }
        if (msg.type === "image" && typeof msg.data === "string") {
          // 폰에서 고른 사진 → 맥에 미리 저장만 하고 경로를 알려준다(id 로 짝 맞춤).
          // pi 에는 폰이 보내기 버튼을 누를 때 글과 함께 "@경로" 로 넣는다.
          // (id 없는 예전 앱은 예전처럼 바로 pi 입력창에 @경로 삽입)
          try {
            mkdirSync(IMG_DIR, { recursive: true });
            const safeExt = String(msg.name || "png").split(".").pop().replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "png";
            const path = `${IMG_DIR}/img-${Date.now()}${Math.floor(Math.random() * 1000)}.${safeExt}`;
            writeFileSync(path, Buffer.from(msg.data, "base64"));
            console.log(`[pi-remote] 이미지 저장: ${path}`);
            if (typeof msg.id === "string") ws.send(JSON.stringify({ type: "image-saved", id: msg.id, path }));
            else term.write(`@${path} `);
          } catch (e) {
            console.warn(`[pi-remote] 이미지 저장 실패: ${e.message}`);
            if (typeof msg.id === "string") ws.send(JSON.stringify({ type: "image-saved", id: msg.id, error: e.message }));
          }
          return;
        }
        if (msg.type === "bg-start" && typeof msg.text === "string") {
          // 폰 '백그라운드로 보내기'(사용자 결정 11-12): 지금 보는 탭과 같은 것(pi | Claude Code)을 같은 폴더의 새 탭에서.
          // 끝나면 그 탭의 연결부가 폰 알림 + 이 탭에 결과 요약
          const notice = (text) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text } }));
          if (!feedPane || !feedOn) {
            notice("이 탭에는 pi·Claude Code 가 없어 백그라운드로 보낼 수 없어요");
            return;
          }
          try {
            const cwd = execFileSync(TMUX_BIN, ["display", "-p", "-t", feedPane, "#{pane_current_path}"], { encoding: "utf8", timeout: 3000 }).trim();
            const r = launchBackground({ agent: feedAgent === "claude" ? "claude" : "pi", cwd, task: msg.text.slice(0, 100_000), originPane: feedPane, by: "phone", session: SESSION });
            console.log(`[pi-remote] 백그라운드 탭 시작: ${r.window} (${feedAgent})`);
            notice(`백그라운드 탭 ${r.window}(${r.name})에서 시작했어요. 끝나면 결과를 이 탭으로 알려 드려요`);
            setTimeout(pushWindows, 500);
          } catch (e) {
            notice(`백그라운드 탭을 열지 못했어요: ${e.message}`);
          }
          return;
        }
        if (msg.type === "pi-send" && typeof msg.text === "string") {
          // 폰에서 보낸 메시지. 확장이 있으면 실행 시점(바로 반영·끝나고·멈추고)과 사진을 지정해 pi 에 직접 넣고,
          // 없거나 /명령·!셸 이면 예전처럼 pi 입력창에 붙여넣고 Enter.
          const text = msg.text.slice(0, 100_000);
          const mode = ["auto", "steer", "followUp", "interrupt"].includes(msg.mode) ? msg.mode : "auto";
          const images = (Array.isArray(msg.images) ? msg.images : [])
            .filter((p) => typeof p === "string" && /\/img-\d+\.(jpe?g|png)$/i.test(p))
            .slice(0, 10);
          const isCommand = /^\s*[\/!]/.test(text);
          if (isCommand && !macEditorEmpty()) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: EDITOR_BUSY } }));
            return;
          }
          if (feed && feedOn && feedCanSend && !isCommand) {
            feed.write(`${JSON.stringify({ cmd: "send", text, mode, images })}\n`);
          } else {
            // 앱이 이미 글 앞에 "@사진경로"를 붙여 보내므로 그대로 넣는다(다시 붙이면 사진이 두 번 들어감)
            term.write(`\x1b[200~${text}\x1b[201~\r`);
          }
          return;
        }
        if (msg.type === "question-answer") {
          // 질문 카드의 답 → 확장(ask-user)에 전달
          if (feed && feedOn && feedCanSend) {
            const answers = Array.isArray(msg.answers) ? msg.answers.map((a) => String(a)).slice(0, 10) : [];
            // 여러 질문 카드: 질문별 답(최대 6개)
            const items = Array.isArray(msg.items)
              ? msg.items.slice(0, 6).map((x) => ({ answers: Array.isArray(x?.answers) ? x.answers.map(String).slice(0, 10) : [], other: String(x?.other ?? "").slice(0, 4000) }))
              : undefined;
            feed.write(`${JSON.stringify({ cmd: "question-answer", id: String(msg.id ?? ""), answers, other: String(msg.other ?? "").slice(0, 4000), cancel: msg.cancel === true, ...(items ? { items } : {}) })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "approval") {
          // 승인 카드의 허용·거부 → 확장(send-guard)에 전달
          if (feed && feedOn && feedCanSend) {
            feed.write(`${JSON.stringify({ cmd: "approval", id: String(msg.id ?? ""), approved: msg.approved === true })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "compact") {
          // '지금 압축하기' → 확장이 pi 에 직접 요청(진행·결과는 대화 피드로 옴)
          if (feed && feedOn && feedCanSend) {
            feed.write(`${JSON.stringify({ cmd: "compact" })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "rewind" || msg.type === "memory-list" || msg.type === "memory-save") {
          // 되감기·메모리(지침 파일) → 확장(되감기는 쉬는 중에만, 저장은 목록의 파일만)
          if (feed && feedOn && feedCanSend) {
            const o = msg.type === "rewind" ? { cmd: "rewind", id: String(msg.id ?? "").slice(0, 200), text: String(msg.text ?? "").slice(0, 20000) }
              : msg.type === "memory-save" ? { cmd: "memory-save", path: String(msg.path ?? "").slice(0, 4000), content: String(msg.content ?? "").slice(0, 400000) }
              : { cmd: "memory-list" };
            feed.write(`${JSON.stringify(o)}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "notice", text: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "artifact") {
          // 아티팩트 내용 요청 → 확장(등록된 파일만 보냄)
          if (feed && feedOn && feedCanSend) {
            // offset: 나눠 받기 시작 위치(없으면 예전 앱 — 통째로)
            const offset = Number.isInteger(msg.offset) && msg.offset >= 0 ? msg.offset : undefined;
            feed.write(`${JSON.stringify({ cmd: "artifact", path: String(msg.path ?? "").slice(0, 4000), offset })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "artifact", path: String(msg.path ?? ""), error: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "toolimage") {
          // 도구가 읽은 사진 요청 → 확장에 전달(답은 대화 피드로)
          if (feed && feedOn && feedCanSend) {
            feed.write(`${JSON.stringify({ cmd: "toolimage", id: String(msg.id ?? "") })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "toolimage", id: String(msg.id ?? ""), error: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "files") {
          // 입력창 '@' 파일 찾기 → 확장에 전달(답은 대화 피드로 요청한 폰에만 돌아옴)
          if (feed && feedOn && feedCanSend) {
            feed.write(`${JSON.stringify({ cmd: "files", query: String(msg.query ?? "").slice(0, 200) })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "files", query: String(msg.query ?? ""), files: [], error: "pi 확장이 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "bg-jobs" || msg.type === "bg-job-kill") {
          // 뒤에서 도는 작업 목록·종료(서랍의 '백그라운드 작업 N') → Claude Code 연결부(답은 대화 피드로 돌아옴)
          if (feed && feedOn && feedCanSend) {
            feed.write(`${JSON.stringify(msg.type === "bg-jobs" ? { cmd: "bg-jobs" } : { cmd: "bg-job-kill", id: String(msg.id ?? "").slice(0, 100) })}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "bg-jobs", jobs: [], error: "이 탭의 Claude Code 에 연결되지 않았어요" } }));
          }
          return;
        }
        if (msg.type === "detail") {
          // 단계 상세(도구 전체 명령·출력, 생각 내용) 요청 → 확장에 전달(답은 대화 피드로 돌아옴)
          if (feed && feedOn && feedCanSend) {
            const req = { cmd: "detail", key: String(msg.key ?? ""), kind: String(msg.kind ?? ""), id: String(msg.id ?? ""), ref: String(msg.ref ?? "") };
            feed.write(`${JSON.stringify(req)}\n`);
          } else if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "chat", d: { t: "detail", detail: { key: String(msg.key ?? ""), error: "pi 확장이 연결되지 않았어요" } } }));
          }
          return;
        }
        if (msg.type === "thumb" && typeof msg.path === "string") {
          // 말풍선·답변 속 사진을 폰에 보여주기 위한 작은 그림. 사진 폴더의 img-숫자 파일만 허용.
          ws.send(JSON.stringify({ type: "thumb", path: msg.path, size: msg.size, ...makeThumb(msg.path, msg.size) }));
          return;
        }
      } catch {
        /* JSON 아니면 그냥 입력으로 취급 */
      }
    }
    term.write(text);
  });

  ws.on("close", () => {
    console.log(`[pi-remote] 연결 종료: ${peer}`);
    clearInterval(winTimer);
    closeFeed();
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  });

  ws.on("error", (err) => {
    console.warn(`[pi-remote] 소켓 오류 (${peer}): ${err.message}`);
  });
});

server.on("error", (err) => {
  console.error(`[pi-remote] 서버 오류: ${err.message}`);
  process.exit(1);
});

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
