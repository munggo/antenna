// Claude Code 계정 고르기(claude-account.mjs) 판정 시험. ACC_PATH(pi 의 claude-accounts.ts)가 있으면 pi 규칙과 무작위 대조
// 실행: sh pi-extension/test/run.sh (또는 node claude-remote/test/account-cases.mjs)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../claude-account.mjs", import.meta.url).pathname;
// 회사 폴더 목록은 설정 파일에서 읽는다 → 시험용 파일을 가리키게(이 맥의 설정과 상관없이 같은 결과)
const WD = mkdtempSync(join(tmpdir(), "acc-wd-"));
process.env.PI_REMOTE_WORK_DIRS_FILE = join(WD, "work-dirs");
writeFileSync(process.env.PI_REMOTE_WORK_DIRS_FILE, "# 회사 폴더\n~/works/company   # 물결표는 홈\n\n/opt/company\n");
const { baseAccount, decideAccount, homeAccount, readWorkDirs } = await import(SCRIPT);
const H = process.env.HOME;
const P = `${H}/works/personal/x`, W = `${H}/works/company/x`;
const now = Date.now();
const fut = Math.floor(now / 1000) + 86400, past = Math.floor(now / 1000) - 60;
let fail = 0, total = 0;
const ok = (c, n) => { total++; if (!c) { fail++; console.log(`틀림: ${n}`); } };
const d = (cwd, usage, extra = {}) => decideAccount({ cwd, usage, now, ...extra });
const c = (util, reset = fut) => ({ util, reset, at: now });

ok(homeAccount(W) === "work" && homeAccount(`${H}/works/company`) === "work" && homeAccount(P) === "personal", "폴더 기본 계정");
ok(homeAccount(`${H}/works/companyx`) === "personal", "이름만 비슷한 폴더는 개인");
ok(JSON.stringify(readWorkDirs()) === JSON.stringify([`${H}/works/company`, "/opt/company"]), "회사 폴더 파일: 물결표는 홈으로, 주석·빈 줄은 뺌");
ok(homeAccount("/opt/company/app") === "work", "파일에 적은 다른 폴더도 회사");
ok(readWorkDirs(join(WD, "없는-파일")).length === 0 && homeAccount(`${H}/works/company`, readWorkDirs(join(WD, "없는-파일"))) === "personal", "파일이 없으면 어디서나 개인(계정을 하나만 쓰는 사람)");
ok(d(P, {}) === "personal", "사용량 기록 없음 → 기본 계정");
ok(d(P, { anthropic: { "7d": c(0.94) } }) === "personal", "94% → 그대로");
ok(d(P, { anthropic: { "7d": c(0.95) } }) === "work", "95% → 회사(경계)");
ok(d(P, { anthropic: { "7d": c(0.97) } }) === "work", "97% → 회사");
ok(d(P, { anthropic: { "5h": c(0.96) } }) === "work", "5시간 한도 96% → 회사");
ok(d(P, { anthropic: { "7d": c(0.99, past) } }) === "personal", "초기화 시각이 지난 값은 무시 → 개인으로 돌아옴");
ok(d(P, { anthropic: { "7d:fable": c(0.97) } }, { modelId: "claude-opus-5-5" }) === "personal", "다른 모델 전용 한도는 무시");
ok(d(P, { anthropic: { "7d:fable": c(0.97) } }, { modelId: "claude-fable-5-2" }) === "work", "그 모델 전용 한도 → 회사");
ok(d(P, { anthropic: { "7d:fable": c(0.97) } }) === "personal", "모델을 모르면(켤 때) 모델 전용 한도는 무시");
ok(d(P, { anthropic: { 429: c(1) } }) === "work", "한도 오류 기록 → 회사");
ok(d(P, { anthropic: { "7d": c(0.97) }, "anthropic-work": { "7d": c(0.96) } }) === "personal", "둘 다 넘음 → 기본 계정");
ok(d(W, { "anthropic-work": { "7d": c(0.97) } }) === "personal", "회사 폴더, 회사 97% → 개인");
ok(d(W, {}, { hasWork: false }) === "personal", "회사 토큰 없음 → 개인");
ok(d(P, { anthropic: { "7d": c(0.97) } }, { hasWork: false }) === "personal", "개인 97% 인데 회사 토큰 없음 → 개인");
ok(d(P, { anthropic: { "7d": { util: "x" } } }) === "personal", "값이 숫자가 아니면 무시");

// 앱에서 탭에 고른 계정(pin, 사용자 결정 11-18: 고른 계정도 95% 면 자동으로 넘김)
ok(d(P, {}, { pin: "work" }) === "work" && d(W, {}, { pin: "personal" }) === "personal", "고른 계정이 폴더 기본보다 먼저");
ok(d(P, {}, { pin: "" }) === "personal" && d(W, {}, { pin: "auto" }) === "work" && d(P, {}, { pin: "x" }) === "personal", "고르지 않음·모르는 값 → 폴더 기본");
ok(d(P, { "anthropic-work": { "7d": c(0.96) } }, { pin: "work" }) === "personal", "고른 회사 계정이 96% → 개인으로 넘김");
ok(d(W, { anthropic: { "7d": c(0.95) } }, { pin: "personal" }) === "work", "고른 개인 계정이 95%(경계) → 회사로 넘김");
ok(d(P, { "anthropic-work": { "7d": c(0.99, past) } }, { pin: "work" }) === "work", "고른 계정의 한도가 초기화되면 고른 계정으로 돌아옴");
ok(d(P, { anthropic: { "7d": c(0.97) }, "anthropic-work": { "7d": c(0.97) } }, { pin: "work" }) === "work", "둘 다 넘음 → 고른 계정");
ok(d(W, {}, { pin: "work", hasWork: false }) === "personal", "회사를 골랐는데 회사 토큰 없음 → 개인");
ok(d(P, { anthropic: { "7d": c(0.97) } }, { pin: "personal" }) === d(P, { anthropic: { "7d": c(0.97) } }), "폴더 기본과 같은 계정을 고르면 판단도 같음");
ok(baseAccount(P, "work") === "work" && baseAccount(W, "") === "work" && baseAccount(P, "") === "personal", "돌아올 곳: 고른 계정, 없으면 폴더 기본");

// 명령줄: 공유 파일 경로를 바꿔서
const dir = mkdtempSync(join(tmpdir(), "acct-"));
const F = join(dir, "a.json");
const cli = (cwd, model = "") => execFileSync(process.execPath, [SCRIPT, cwd, ...(model ? [model] : [])], { env: { ...process.env, PI_ACCOUNTS_CACHE: F }, encoding: "utf8" }).trim();
writeFileSync(F, JSON.stringify({ anthropic: { "7d": c(0.97) } }));
ok(cli(P) === "work", "명령줄: 개인 97% → work");
writeFileSync(F, JSON.stringify({ anthropic: { "7d": c(0.5) } }));
ok(cli(P) === "personal" && cli(W) === "work", "명령줄: 개인 50% → 폴더대로");
writeFileSync(F, "{깨짐");
ok(cli(P) === "personal" && cli(W) === "work", "명령줄: 공유 파일이 깨지면 → 폴더대로");
rmSync(F);
ok(cli(P) === "personal", "명령줄: 공유 파일이 없으면 → 폴더대로");
rmSync(dir, { recursive: true, force: true });

// pi 규칙(claude-accounts.ts decide)과 무작위 대조
if (process.env.ACC_PATH) {
  const pi = await import(process.env.ACC_PATH);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const KEYS = ["5h", "7d", "7d:fable", "7d:oi", "7d:opus", "429"];
  let diff = 0;
  for (let i = 0; i < 2000; i++) {
    const usage = {};
    for (const p of ["anthropic", "anthropic-work"]) {
      for (const k of KEYS) if (rnd() < 0.4) (usage[p] ??= {})[k] = { util: pick([0, 0.5, 0.9, 0.94, 0.95, 0.96, 1]), reset: pick([fut, past, undefined]), at: now };
    }
    const cwd = pick([P, W]), modelId = pick(["", "claude-opus-5-5", "claude-fable-5-2", "claude-haiku-4-5"]), hasWork = rnd() < 0.9;
    const mine = decideAccount({ cwd, modelId, usage, hasWork, now });
    const theirs = pi.decide({ reason: "new", modelId, cwd, usage, now, hasAuth: (p) => (p === "anthropic-work" ? hasWork : true) }).provider;
    if (mine !== (theirs === "anthropic-work" ? "work" : "personal")) {
      if (diff++ < 3) console.log(`다름: ${JSON.stringify({ cwd, modelId, hasWork, usage })} → 이것 ${mine}, pi ${theirs}`);
    }
  }
  ok(diff === 0, `pi 규칙과 무작위 2000가지 대조(다름 ${diff})`);
}

rmSync(WD, { recursive: true, force: true });
console.log(`전체 ${total}개 중 틀림 ${fail}개`);
process.exit(fail ? 1 : 0);
