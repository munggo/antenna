#!/usr/bin/env node
/**
 * Claude Code 계정 고르기(pi 의 claude-accounts 와 같은 규칙)
 * - 폴더 기본 계정: 회사 폴더(~/.config/pi-remote/work-dirs 에 적은 폴더) 아래면 회사, 그 밖이면 개인.
 *   그 파일이 없으면 어디서나 개인 계정(계정을 하나만 쓰는 사람은 아무것도 하지 않아도 됨)
 * - 기본 계정의 관련 한도(5시간·주간·그 모델 전용 주간·한도 오류) 중 하나라도 95% 이상이면 다른 계정
 *   (다른 계정도 95% 이상이면 기본 계정). 초기화 시각이 지난 값은 무시 → 초기화되면 기본 계정으로 돌아옴
 * - 사용량은 pi·Claude Code 상태줄이 함께 쓰는 공유 파일(~/.cache/pi-remote/claude-accounts.json)
 * 쓰는 곳: ~/.zshrc 의 claude() (켤 때), claude-feed.mjs (실행 중인 탭을 쉬는 동안 다시 켬)
 * 실행: node claude-account.mjs <폴더> [모델 id]  →  work | personal
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
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
const KEY = { work: "anthropic-work", personal: "anthropic" };

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

/** 앱에서 이 탭에 고른 계정(work | personal)이 있으면 그것, 없으면 폴더 기본 계정. 한도가 풀리면 돌아올 곳 */
export function baseAccount(cwd, pin = "", workDirs = WORK_DIRS) {
  return pin === "work" || pin === "personal" ? pin : homeAccount(cwd, workDirs);
}

/** 계정 고르기(순수 함수). pin: 앱에서 이 탭에 직접 고른 계정(없으면 폴더 기본).
 *  고른 계정도 한도가 95% 이상이면 다른 계정으로 넘긴다(사용자 결정 11-18: 한도 때문에 일이 멈추지 않게) */
export function decideAccount({ cwd, modelId = "", usage = {}, hasWork = true, now = Date.now(), workDirs = WORK_DIRS, pin = "" }) {
  const over = (a) => usageFor(usage, KEY[a], modelId, now).util >= THRESHOLD;
  const ok = (a) => (a === "work" ? hasWork : true) && !over(a);
  const home = baseAccount(cwd, pin, workDirs);
  if (ok(home)) return home;
  const other = home === "work" ? "personal" : "work";
  if (ok(other)) return other;
  return home === "work" && !hasWork ? "personal" : home;
}

export function readUsage() {
  try {
    return JSON.parse(readFileSync(process.env.PI_ACCOUNTS_CACHE || `${HOME}/.cache/pi-remote/claude-accounts.json`, "utf8"));
  } catch {
    return {};
  }
}

/** 회사 토큰이 키체인에 있는지(값은 읽지 않음) */
export function hasWorkToken() {
  try {
    execFileSync("/usr/bin/security", ["find-generic-password", "-s", process.env.PI_WORK_KEYCHAIN || "pi-anthropic-work"], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

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

export const desiredAccount = (cwd, modelId = "", pin = "") => decideAccount({ cwd, modelId: modelId || defaultModel(), usage: readUsage(), hasWork: hasWorkToken(), pin });

// 직접 실행했을 때만(경로는 바로가기를 풀어서 견줌: 홈·설치 폴더가 바로가기여도 되게)
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  process.stdout.write(`${desiredAccount(process.argv[2] || process.cwd(), process.argv[3] || "")}\n`);
}
