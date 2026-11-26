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
// 한도로는 저절로 바꾸지 않음(사용자 결정 11-24: 95%를 넘으면 연결부가 묻는다)
ok(d(P, { anthropic: { "7d": c(0.94) } }) === "personal", "94% → 그대로");
ok(d(P, { anthropic: { "7d": c(0.97) } }) === "personal" && d(W, { "anthropic-work": { "7d": c(1) } }) === "work", "97%·100% 여도 저절로 바꾸지 않음");
ok(d(P, { anthropic: { "7d:oi": c(1), 429: c(1) } }) === "personal", "모델 전용 한도·한도 오류 표시로도 바꾸지 않음");
// 물어서 떠난 계정(away): 떠난 계정이 95% 이상인 동안만 바꿀 곳, 내려오면(초기화) 돌아옴(사용자 결정 11-24).
// 바꿀 곳(11-25 계정 셋): 개인 → 추가 개인, 회사 → 개인
ok(d(P, { anthropic: { "7d": c(0.97) } }, { away: "personal" }) === "personal2", "떠난 개인 97% → 추가 개인");
ok(d(P, { anthropic: { "7d": c(0.95) } }, { away: "personal" }) === "personal2", "떠난 개인 95%(경계) → 추가 개인");
ok(d(P, { anthropic: { "5h": c(0.96), "7d": c(0.5) } }, { away: "personal" }) === "personal2", "떠난 개인 5시간 한도 96% → 추가 개인");
ok(d(P, { anthropic: { "7d": c(0.94) } }, { away: "personal" }) === "personal", "떠난 개인이 94% 로 내려옴 → 돌아옴");
ok(d(P, { anthropic: { "7d": c(0.99, past) } }, { away: "personal" }) === "personal", "초기화 시각이 지난 값은 무시 → 돌아옴");
ok(d(P, { anthropic: { "7d": c(0.5), "7d:oi": c(1) } }, { away: "personal" }) === "personal", "모델 전용 한도는 전체 한도가 아님 → 돌아옴");
ok(d(P, { anthropic: { "7d": c(0.97) } }, { away: "work" }) === "personal", "떠난 계정이 돌아올 곳이 아니면 무시");
ok(d(P, { anthropic: { "7d": c(0.97) } }, { away: "personal", hasPersonal2: false }) === "personal", "추가 개인 토큰이 없으면 떠날 수 없음");
ok(d(P, { anthropic: { "7d": c(0.97) } }, { away: "personal", hasWork: false }) === "personal2", "개인 폴더는 회사 토큰과 상관없음");
ok(d(W, { "anthropic-work": { "7d": c(0.97) } }, { away: "work" }) === "personal", "회사 폴더, 떠난 회사 97% → 개인(추가 개인 아님)");
ok(d(P, {}, { pin: "personal2" }) === "personal2" && d(P, {}, { pin: "personal2", hasPersonal2: false }) === "personal", "추가 개인을 고르면 추가 개인(토큰이 없으면 개인)");
{
  const { procAccount, switchTarget, SWITCH_TO, LABEL } = await import(SCRIPT);
  ok(procAccount("claude PI_CLAUDE_ACCOUNT=personal2 CLAUDE_CODE_OAUTH_TOKEN=x HOME=/h") === "personal2", "켠 계정 표시: 추가 개인");
  ok(procAccount("claude PI_CLAUDE_ACCOUNT=work CLAUDE_CODE_OAUTH_TOKEN=x") === "work" && procAccount("claude CLAUDE_CODE_OAUTH_TOKEN=x HOME=/h") === "work", "회사: 표시가 있거나, 표시 없이 토큰만(예전 셸 함수)");
  ok(procAccount("claude HOME=/h") === "personal" && procAccount("claude PI_CLAUDE_ACCOUNT=personal2x CLAUDE_CODE_OAUTH_TOKEN=x") === "work", "표시·토큰이 없으면 개인, 모르는 표시는 무시(토큰만 보면 회사)");
  ok(procAccount("claude PI_CLAUDE_ACCOUNT=personal2 HOME=/h") === "personal", "표시만 남고 토큰이 빠지면 개인(실제로 기본 로그인으로 돎)");
  // 직접 로그인으로 켠 추가 계정(11-25): 토큰 없이 설정 폴더를 따로 준다
  ok(procAccount("claude PI_CLAUDE_ACCOUNT=personal2 CLAUDE_CONFIG_DIR=/h/.claude-personal2 HOME=/h") === "personal2", "직접 로그인으로 켠 추가 개인: 토큰 없이 설정 폴더와 표시");
  ok(procAccount("claude CLAUDE_CONFIG_DIR=/h/.claude-work PI_CLAUDE_ACCOUNT=work") === "work", "직접 로그인으로 켠 회사");
  ok(procAccount("claude CLAUDE_CONFIG_DIR=/h/.other HOME=/h") === "personal", "표시 없이 설정 폴더만 따로 준 것은 개인으로(우리가 켠 것이 아님)");
  ok(procAccount("claude XCLAUDE_CONFIG_DIR=/x PI_CLAUDE_ACCOUNT=personal2") === "personal", "이름만 비슷한 변수는 설정 폴더로 보지 않음");
  ok(switchTarget("personal", "personal") === "personal2" && switchTarget("personal2", "personal") === "personal" && switchTarget("work", "work") === "personal" && switchTarget("personal", "work") === "work",
    "바꿀 곳: 원래 계정이면 SWITCH_TO, 바꿔 간 계정이면 원래 계정으로");
  ok(SWITCH_TO.personal2 === "personal" && LABEL.personal2 === "추가 개인", "추가 개인에서 바꿀 곳은 개인, 이름은 '추가 개인'");
}
{
  const { totalLimit } = await import(SCRIPT);
  const U = { anthropic: { "5h": c(0.4, fut + 9), "7d": c(0.96, fut), "7d:oi": c(1), 429: c(1) } };
  const t = totalLimit(U, "personal", now);
  ok(t.util === 0.96 && t.reset === fut, "전체 한도: 5시간·주간 가운데 높은 것과 초기화 시각(모델 전용·오류 표시는 뺌)");
  ok(totalLimit(U, "work", now).util === 0 && totalLimit({ anthropic: { "7d": c(0.99, past) } }, "personal", now).util === 0, "기록 없음·지난 값은 0");
  ok(totalLimit({ anthropic: { "7d": { util: "x" } } }, "personal", now).util === 0, "숫자가 아니면 무시");
}
// 그 계정의 모델 전용 한도가 풀리는 정확한 때(카드에 날짜로 적음. 11-22)
{
  const { limitResetAt } = await import(SCRIPT);
  const U = { anthropic: { "7d": c(0.91), "7d:oi": c(1, fut + 100), "7d:fable": c(0.5, fut + 999) }, "anthropic-work": { "7d:overage_included": c(0.97, fut + 50) } };
  ok(limitResetAt("personal", "Fable", U, now) === fut + 100, "Fable 한도(oi)가 풀리는 때, 95% 안 된 값은 뺌");
  ok(limitResetAt("work", "fable", U, now) === fut + 50 && limitResetAt("personal", "Opus", U, now) === null, "회사 Fable 한도, 없는 모델은 없음");
  ok(limitResetAt("personal", "Fable", { anthropic: { "7d:oi": c(1, past) } }, now) === null, "이미 지난 때는 없음");
}
// 모델을 모를 때(켤 때) 쓸 기본 모델: 환경 변수, 없으면 Claude Code 설정(로컬 설정이 먼저)
{
  const { defaultModel } = await import(SCRIPT);
  const home = mkdtempSync(join(tmpdir(), "acc-home-"));
  const keep = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  ok(defaultModel(home) === "", "설정이 없으면 기본 모델 없음");
  execFileSync("mkdir", ["-p", join(home, ".claude")]);
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "fable" }));
  ok(defaultModel(home) === "fable", "설정의 model(별칭)");
  writeFileSync(join(home, ".claude", "settings.local.json"), JSON.stringify({ model: "opus" }));
  ok(defaultModel(home) === "opus", "로컬 설정이 먼저");
  process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
  ok(defaultModel(home) === "claude-sonnet-5-5", "환경 변수가 가장 먼저");
  if (keep === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = keep;
  rmSync(home, { recursive: true, force: true });
}
ok(d(W, {}, { hasWork: false }) === "personal", "회사 토큰 없음 → 개인");

// 앱에서 탭에 고른 계정(pin). 고른 계정도 95% 면 묻는다(사용자 결정 11-24, 11-18 의 자동으로 넘김을 바꿈)
ok(d(P, {}, { pin: "work" }) === "work" && d(W, {}, { pin: "personal" }) === "personal", "고른 계정이 폴더 기본보다 먼저");
ok(d(P, {}, { pin: "" }) === "personal" && d(W, {}, { pin: "auto" }) === "work" && d(P, {}, { pin: "x" }) === "personal", "고르지 않음·모르는 값 → 폴더 기본");
ok(d(P, { "anthropic-work": { "7d": c(0.96) } }, { pin: "work" }) === "work", "고른 회사 계정이 96% 여도 그대로");
ok(d(P, { "anthropic-work": { "7d": c(0.96) } }, { pin: "work", away: "work" }) === "personal", "고른 회사 계정을 물어서 떠남 → 개인");
ok(d(P, { "anthropic-work": { "7d": c(0.99, past) } }, { pin: "work", away: "work" }) === "work", "떠난 고른 계정의 한도가 초기화되면 돌아옴");
ok(d(W, {}, { pin: "work", hasWork: false }) === "personal", "회사를 골랐는데 회사 토큰 없음 → 개인");
ok(baseAccount(P, "work") === "work" && baseAccount(W, "") === "work" && baseAccount(P, "") === "personal", "돌아올 곳: 고른 계정, 없으면 폴더 기본");

// 명령줄: 공유 파일 경로를 바꿔서
const dir = mkdtempSync(join(tmpdir(), "acct-"));
const F = join(dir, "a.json");
const cli = (cwd, model = "") => execFileSync(process.execPath, [SCRIPT, cwd, ...(model ? [model] : [])], { env: { ...process.env, PI_ACCOUNTS_CACHE: F }, encoding: "utf8" }).trim();
writeFileSync(F, JSON.stringify({ anthropic: { "7d": c(0.97) } }));
ok(cli(P) === "personal", "명령줄: 개인 97% 여도 켤 때는 폴더대로(묻기는 연결부가 함)");
ok(cli(P, "claude-fable-5-2") === "personal", "명령줄: 예전처럼 모델 id 를 붙여도 됨");
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
