#!/usr/bin/env node
/**
 * Claude Code 계정 고르기(pi 의 claude-accounts 와 같은 규칙)
 * - 폴더 기본 계정: 회사 폴더(~/.config/pi-remote/work-dirs 에 적은 폴더) 아래면 회사, 그 밖이면 개인.
 *   그 파일이 없으면 어디서나 개인 계정(계정을 하나만 쓰는 사람은 아무것도 하지 않아도 됨)
 * - 한도가 95%를 넘어도 저절로 바꾸지 않는다(사용자 결정 11-24: 멈추고 그대로 쓸지·어느 계정으로 바꿀지 묻는다.
 *   묻기는 claude-feed.mjs). 95%는 계정 전체 한도(5시간·주간, 모든 모델)만 본다. 모델 전용 한도(Fable 등)는 모델 한도 카드가 맡음
 * - 물어서 다른 계정으로 바꾼 탭(away: 떠난 계정)은 떠난 계정의 전체 한도가 95% 아래로 내려오면(초기화) 돌아옴(사용자 결정 11-24)
 * - 계정 셋(사용자 결정 11-25): 개인(메인) · 추가 개인 · 회사. 바꿀 곳은 개인 → 추가 개인, 추가 개인 → 개인, 회사 → 개인(SWITCH_TO)
 * - 사용량은 pi·Claude Code 상태줄이 함께 쓰는 공유 파일(~/.cache/pi-remote/claude-accounts.json)
 * 쓰는 곳: ~/.zshrc 의 claude() (켤 때), claude-feed.mjs (실행 중인 탭을 쉬는 동안 다시 켬), pi 의 claude-artifact 스킬(올릴 계정)
 * 실행: node claude-account.mjs <폴더>  →  work | personal (켤 때는 늘 폴더 기본 계정, 회사 토큰이 없으면 개인)
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.HOME ?? "";
export const THRESHOLD = 0.95;   // pi 와 같은 값(사용자가 고른 값)
/** 회사 계정을 기본으로 쓸 폴더 목록 파일: 한 줄에 폴더 하나(~ 가능, # 뒤는 주석). pi 확장(claude-accounts.ts)과 같이 씀 */
export const WORK_DIRS_FILE = process.env.PI_REMOTE_WORK_DIRS_FILE || `${HOME}/.config/pi-remote/work-dirs`;
export function readWorkDirs(file = WORK_DIRS_FILE) {
  try {
    return readFileSync(file, "utf8").split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean)
      .map((p) => resolve(p === "~" || p.startsWith("~/") ? HOME + p.slice(1) : p));
  } catch {
    return [];   // 파일이 없음: 회사 폴더 없음
  }
}
export const WORK_DIRS = readWorkDirs();
// 계정 셋(사용자 결정 11-25): 개인(메인, Claude Code 기본 로그인) · 추가 개인(personal2) · 회사(work).
// 추가 개인·회사는 장기 토큰으로 켜거나, 직접 로그인해 둔 설정 폴더(LOGIN_DIR)가 있으면 그 폴더로 켠다.
// 이메일은 코드에 적지 않는다(공개 사본으로도 나감). KEY: 공유 사용량 파일(claude-accounts.json)의 이름, LABEL: 화면·카드 이름
export const ACCOUNTS = ["personal", "personal2", "work"];
export const KEY = { work: "anthropic-work", personal: "anthropic", personal2: "anthropic-personal2" };
export const LABEL = { personal: "개인", personal2: "추가 개인", work: "회사" };
export const isAccount = (a) => ACCOUNTS.includes(a);
/** 토큰을 넣어 둔 맥 열쇠고리 항목(개인 메인은 기본 로그인이라 없음) */
export const KEYCHAIN = { work: process.env.PI_WORK_KEYCHAIN || "pi-anthropic-work", personal2: process.env.PI_PERSONAL2_KEYCHAIN || "pi-anthropic-personal2" };
/** 추가 계정을 토큰 대신 '직접 로그인'으로 쓰는 설정 폴더(계정마다 하나, 11-25). 크롬 연결·원격 제어는 claude.ai 로그인으로 켠 세션에서만
 *  되고 장기 토큰이면 계정이 같아도 꺼져서 둔 길이다. 폴더는 login-dir.mjs 가 만들고, 로그인을 확인한 표식(LOGIN_MARK)이 있을 때만
 *  claude-as.sh 가 이 폴더로(CLAUDE_CONFIG_DIR) 켠다. 표식이 없으면 예전처럼 토큰으로 켠다 */
export const LOGIN_DIR = { work: process.env.PI_WORK_CONFIG_DIR || `${HOME}/.claude-work`, personal2: process.env.PI_PERSONAL2_CONFIG_DIR || `${HOME}/.claude-personal2` };
export const LOGIN_MARK = ".pi-login-ready";
export const loginReady = (account) => !!LOGIN_DIR[account] && existsSync(`${LOGIN_DIR[account]}/${LOGIN_MARK}`);
/** 95%를 넘어 물을 때 바꿀 곳(사용자 결정 11-25): 원래 계정(폴더 기본·고른 계정)에 있으면 개인 → 추가 개인, 추가 개인 → 개인, 회사 → 개인.
 *  이미 바꿔 간 계정에 있으면 원래 계정으로 돌아가기(switchTarget) */
export const SWITCH_TO = { personal: "personal2", personal2: "personal", work: "personal" };
export const switchTarget = (cur, base) => (cur !== base ? base : SWITCH_TO[cur]);
/** Claude Code 프로세스의 환경(ps eww 의 명령 줄) → 계정. claude-as.sh 가 넣는 PI_CLAUDE_ACCOUNT 가 먼저,
 *  그 표시 없이 토큰만 있으면 예전처럼 회사(셸 함수 claude() 가 회사 폴더에서 넣음), 둘 다 없으면 개인(기본 로그인).
 *  추가 계정은 토큰으로 켠 것(CLAUDE_CODE_OAUTH_TOKEN)과 직접 로그인으로 켠 것(설정 폴더를 따로 줌, CLAUDE_CONFIG_DIR) 두 가지다(11-25) */
export function procAccount(envText) {
  const env = String(envText ?? "");
  const token = /(^|\s)CLAUDE_CODE_OAUTH_TOKEN=\S/.test(env);
  const ownDir = /(^|\s)CLAUDE_CONFIG_DIR=\S/.test(env);
  if (!token && !ownDir) return "personal";   // 토큰도 따로 준 설정 폴더도 없으면 표시와 상관없이 기본 로그인(표시만 남은 채 켜진 경우)
  const m = env.match(/(?:^|\s)PI_CLAUDE_ACCOUNT=(personal2|work)(?=\s|$)/);
  if (m) return m[1];
  return token ? "work" : "personal";   // 표시 없이 설정 폴더만 따로 준 것은 우리가 켠 것이 아니다: 개인으로 본다
}

/** 폴더별 기본 계정 */
export function homeAccount(cwd, workDirs = WORK_DIRS) {
  const c = resolve(cwd || "/");
  return workDirs.some((d) => c === d || c.startsWith(d + sep)) ? "work" : "personal";
}

/** 한도 구분 이름 → 그 한도가 걸리는 모델 이름. Fable 전용 주간 한도는 응답 헤더의 내부 이름(oi = overage_included)으로 적힌다.
 *  이것을 모르면 Fable 한도가 차도 다른 계정으로 넘어가지 않아, 앱에서 계정을 바꾸려 할 때 이미 한도에 걸려 있었다(11-21) */
export const SCOPE_MODEL = { oi: "fable", overage_included: "fable" };
/** 이 모델에 걸리는 한도 중 가장 높은 사용률(초기화 시각이 지난 것은 뺌). pi 의 usageFor 와 같음 */
export function usageFor(usage, provider, modelId = "", now = Date.now()) {
  let best = { util: 0, key: "" };
  for (const [key, c] of Object.entries(usage?.[provider] ?? {})) {
    if (!c || typeof c.util !== "number") continue;
    if (c.reset && c.reset * 1000 <= now) continue;
    const raw = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
    const scope = SCOPE_MODEL[raw] ?? raw;
    if (scope && !String(modelId).toLowerCase().includes(scope)) continue;   // 다른 모델 전용 한도
    if (c.util > best.util) best = { util: c.util, key };
  }
  return best;
}

/** 앱에서 이 탭에 고른 계정(work | personal | personal2)이 있으면 그것, 없으면 폴더 기본 계정. 한도가 풀리면 돌아올 곳 */
export function baseAccount(cwd, pin = "", workDirs = WORK_DIRS) {
  return isAccount(pin) ? pin : homeAccount(cwd, workDirs);
}

/** 계정 전체 한도(모든 모델에 걸리는 5시간·주간) 가운데 가장 높은 것 { util, reset(초|null) }.
 *  모델 전용 한도와 한도 오류 표시(429)는 뺀다(사용자 11-24 '95%는 전체 사용량'). 초기화 시각이 지난 값도 뺀다 */
export const TOTAL_KEYS = ["5h", "7d"];
export function totalLimit(usage, account, now = Date.now()) {
  let best = { util: 0, reset: null };
  for (const k of TOTAL_KEYS) {
    const c = usage?.[KEY[account]]?.[k];
    if (!c || typeof c.util !== "number" || (c.reset && c.reset * 1000 <= now)) continue;
    if (c.util > best.util) best = { util: c.util, reset: c.reset ?? null };
  }
  return best;
}

/** 계정 고르기(순수 함수). pin: 앱에서 이 탭에 직접 고른 계정(없으면 폴더 기본).
 *  한도로는 바꾸지 않는다(사용자 결정 11-24). away: 95%를 넘어 물었을 때 사용자가 떠나기로 한 계정 —
 *  그 계정의 전체 한도가 아직 95% 이상이면 바꿀 곳(SWITCH_TO), 내려오면(초기화) 그 계정으로 돌아옴.
 *  토큰이 없는 계정(hasWork·hasPersonal2 거짓)은 쓰지 않고 개인으로 */
export function decideAccount({ cwd, usage = {}, hasWork = true, hasPersonal2 = true, now = Date.now(), workDirs = WORK_DIRS, pin = "", away = "" }) {
  const usable = (a) => a === "personal" || (a === "work" ? hasWork : hasPersonal2);
  const base = baseAccount(cwd, pin, workDirs);
  if (!usable(base)) return "personal";
  const to = SWITCH_TO[base];
  if (away === base && totalLimit(usage, base, now).util >= THRESHOLD && usable(to)) return to;
  return base;
}

export function readUsage() {
  try {
    return JSON.parse(readFileSync(process.env.PI_ACCOUNTS_CACHE || `${HOME}/.cache/pi-remote/claude-accounts.json`, "utf8"));
  } catch {
    return {};
  }
}

/** 그 계정으로 켤 수 있는지: 직접 로그인해 둔 설정 폴더가 있거나(loginReady) 토큰이 열쇠고리에 있는지(값은 읽지 않음).
 *  개인 메인은 기본 로그인이라 늘 참 */
export function hasToken(account) {
  if (account === "personal") return true;
  if (loginReady(account)) return true;
  if (!KEYCHAIN[account]) return false;
  try {
    execFileSync("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN[account]], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
export const hasWorkToken = () => hasToken("work");

/** 모델을 모를 때(켤 때, 또는 첫 답이 한도 오류라 기록에 모델이 없을 때) 쓸 기본 모델: 환경 변수 ANTHROPIC_MODEL,
 *  없으면 Claude Code 설정의 model(예: 별칭 'fable'). 모르면 Fable 한도가 찬 계정으로 켜져 첫 글부터 멈췄다(11-21) */
export function defaultModel(home = HOME) {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  for (const f of [`${home}/.claude/settings.local.json`, `${home}/.claude/settings.json`]) {
    try {
      const m = JSON.parse(readFileSync(f, "utf8"))?.model;
      if (typeof m === "string" && m) return m;
    } catch {
      /* 없거나 깨짐: 다음 파일 */
    }
  }
  return "";
}

/** 그 계정의 그 모델 전용 한도(family: 'Fable' 등)가 풀리는 때(초). 공유 파일에 95% 이상으로 적힌 것 가운데 가장 늦은 것, 없으면 null.
 *  Claude Code 는 24시간 안이면 'resets 4pm' 처럼 시각만 적어 날짜를 알 수 없어 이 값을 쓴다(11-22 사용자 '정확한 날짜와 시간') */
export function limitResetAt(account, family, usage = readUsage(), now = Date.now()) {
  let at = null;
  for (const [key, c] of Object.entries(usage?.[KEY[account]] ?? {})) {
    if (!c || typeof c.util !== "number" || c.util < THRESHOLD || !c.reset || c.reset * 1000 <= now) continue;
    const raw = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
    if ((SCOPE_MODEL[raw] ?? raw) !== String(family ?? "").toLowerCase()) continue;
    at = Math.max(at ?? 0, c.reset);
  }
  return at;
}

/** 그 계정이 이 모델에 대해 지금 쓰는 비율(공유 파일 기준, 0~1) */
export const accountUsage = (account, modelId = "") => usageFor(readUsage(), KEY[account], modelId || defaultModel()).util;

/** 그 계정의 전체 한도(공유 파일 기준) { util, reset } */
export const accountTotal = (account) => totalLimit(readUsage(), account);

export const desiredAccount = (cwd, pin = "", away = "") => decideAccount({ cwd, usage: readUsage(), hasWork: hasToken("work"), hasPersonal2: hasToken("personal2"), pin, away });

// 직접 실행했을 때만(경로는 바로가기를 풀어서 견줌: 홈·설치 폴더가 바로가기여도 되게)
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  process.stdout.write(`${desiredAccount(process.argv[2] || process.cwd())}\n`);
}
