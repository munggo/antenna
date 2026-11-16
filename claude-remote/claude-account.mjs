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

/** 이 모델에 걸리는 한도 중 가장 높은 사용률(초기화 시각이 지난 것은 뺌). pi 의 usageFor 와 같음 */
export function usageFor(usage, provider, modelId = "", now = Date.now()) {
  let best = { util: 0, key: "" };
  for (const [key, c] of Object.entries(usage?.[provider] ?? {})) {
    if (!c || typeof c.util !== "number") continue;
    if (c.reset && c.reset * 1000 <= now) continue;
    const scope = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
    if (scope && !String(modelId).toLowerCase().includes(scope)) continue;   // 다른 모델 전용 한도
    if (c.util > best.util) best = { util: c.util, key };
  }
  return best;
}

/** 계정 고르기(순수 함수) */
export function decideAccount({ cwd, modelId = "", usage = {}, hasWork = true, now = Date.now(), workDirs = WORK_DIRS }) {
  const over = (a) => usageFor(usage, KEY[a], modelId, now).util >= THRESHOLD;
  const ok = (a) => (a === "work" ? hasWork : true) && !over(a);
  const home = homeAccount(cwd, workDirs);
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

export const desiredAccount = (cwd, modelId = "") => decideAccount({ cwd, modelId, usage: readUsage(), hasWork: hasWorkToken() });

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
