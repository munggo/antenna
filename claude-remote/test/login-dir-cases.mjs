// 추가 계정을 직접 로그인으로 쓰는 설정 폴더(login-dir.mjs)와 켜는 스크립트(claude-as.sh)의 분기 시험.
// 임시 폴더만 쓴다(이 맥의 ~/.claude·열쇠고리·실제 claude 는 건드리지 않는다. claude 는 가짜 실행 파일로 바꿔 환경만 찍는다)
// 실행: node claude-remote/test/login-dir-cases.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const T = mkdtempSync(join(tmpdir(), "login-dir-"));
const HOME = join(T, "home");
const BASE = join(HOME, ".claude");
const DIR = join(HOME, ".claude-personal2");
mkdirSync(join(BASE, "projects", "-p", "memory"), { recursive: true });
mkdirSync(join(BASE, "sessions"));
mkdirSync(join(BASE, "skills"));
mkdirSync(join(BASE, "daemon"));
mkdirSync(join(BASE, "chrome"));
writeFileSync(join(BASE, "CLAUDE.md"), "지침\n");
writeFileSync(join(BASE, "JIRA.md"), "지침이 가리키는 문서\n");
writeFileSync(join(BASE, "JIRA.md.bak-before"), "백업\n");
writeFileSync(join(BASE, "settings.json"), '{"model":"x"}\n');
writeFileSync(join(BASE, "policy-limits.json"), "{}\n");
writeFileSync(join(BASE, "projects", "-p", "memory", "MEMORY.md"), "메모\n");
const MAIN = "main-user@example.com", SECOND = "second-user@example.com";
writeFileSync(join(HOME, ".claude.json"), JSON.stringify({
  oauthAccount: { emailAddress: MAIN }, userID: "u", anonymousId: "a", machineID: "m", hasCompletedOnboarding: true,
  projects: { "/p": { hasTrustDialogAccepted: true } }, mcpServers: { rea: { command: "x" } }, claudeInChromeDefaultEnabled: true,
  cachedChromeExtensionInstalled: true, cachedFeatureFlags: { a: 1 }, modelAccessCache: [], s1mAccessCache: {}, clientDataCacheSlots: {},
  passesEligibilityCache: {}, passesLastSeenCampaign: "c", overageCreditGrantCache: {}, hasAvailableSubscription: true, tipsHistory: { t: 1 },
}));
process.env.HOME = HOME;
delete process.env.PI_PERSONAL2_CONFIG_DIR;
delete process.env.PI_WORK_CONFIG_DIR;
const mod = await import(new URL("../login-dir.mjs", import.meta.url).pathname);
const acc = await import(new URL("../claude-account.mjs", import.meta.url).pathname);

let fail = 0, total = 0;
const ok = (c, n) => { total++; if (c) console.log(`통과: ${n}`); else { fail++; console.log(`실패: ${n}`); } };
const isLinkTo = (name) => lstatSync(join(DIR, name)).isSymbolicLink() && readlinkSync(join(DIR, name)) === join(BASE, name);

// ── 준비 ──
ok(acc.LOGIN_DIR.personal2 === DIR && !acc.loginReady("personal2"), "설정 폴더는 홈 아래 .claude-personal2, 처음에는 준비되지 않음");
const r1 = mod.prepare("personal2");
ok(existsSync(DIR) && (statSync(DIR).mode & 0o077) === 0, "폴더를 만들고 나만 읽게 둔다");
ok(["CLAUDE.md", "JIRA.md", "settings.json", "projects", "sessions", "skills"].every(isLinkTo), "지침·설정·대화 기록·실행 중 세션·스킬은 ~/.claude 의 것을 바로가기로");
ok(!existsSync(join(DIR, "daemon")) && !existsSync(join(DIR, "chrome")) && !existsSync(join(DIR, "policy-limits.json")) && !existsSync(join(DIR, "JIRA.md.bak-before")),
  "데몬·크롬 연결 파일·정책 캐시·백업 사본은 걸지 않는다(계정마다 따로)");
ok(readFileSync(join(DIR, "projects", "-p", "memory", "MEMORY.md"), "utf8") === "메모\n", "바로가기로 같은 메모를 읽는다");
const seeded = JSON.parse(readFileSync(join(DIR, ".claude.json"), "utf8"));
ok(r1.seeded && !("oauthAccount" in seeded) && !("userID" in seeded) && !("anonymousId" in seeded) && !("hasAvailableSubscription" in seeded), ".claude.json: 로그인한 계정에 묶인 것은 옮기지 않는다");
ok(!("cachedFeatureFlags" in seeded) && !("modelAccessCache" in seeded) && !("s1mAccessCache" in seeded) && !("clientDataCacheSlots" in seeded) && !("passesEligibilityCache" in seeded) && !("passesLastSeenCampaign" in seeded) && !("overageCreditGrantCache" in seeded),
  ".claude.json: 계정에 묶인 캐시는 옮기지 않는다");
ok(seeded.projects["/p"].hasTrustDialogAccepted && seeded.mcpServers.rea && seeded.hasCompletedOnboarding && seeded.claudeInChromeDefaultEnabled && seeded.cachedChromeExtensionInstalled && seeded.machineID === "m" && seeded.tipsHistory.t === 1,
  ".claude.json: 프로젝트 설정·MCP 서버·첫 실행 안내를 본 기록·크롬 기본 켬은 옮긴다");
ok((statSync(join(DIR, ".claude.json")).mode & 0o077) === 0, ".claude.json 은 나만 읽게");

// ── 다시 돌려도 같음, 새로 생긴 것과 풀린 것 ──
const r2 = mod.prepare("personal2");
ok(r2.made.length === 0 && r2.moved.length === 0 && !r2.seeded && r2.kept === r1.made.length, "다시 돌려도 바뀌는 것이 없다");
mkdirSync(join(BASE, "agents"));
rmSync(join(DIR, "settings.json"));
writeFileSync(join(DIR, "settings.json"), '{"model":"갈라짐"}\n');   // 설정을 새로 써서 바로가기가 일반 파일로 바뀐 경우
rmSync(join(DIR, "sessions"));
mkdirSync(join(DIR, "sessions"));                                    // 빈 폴더가 먼저 생긴 경우
const r3 = mod.syncLinks(BASE, DIR, new Date("2026-11-25T03:04:05Z"));
ok(isLinkTo("agents") && r3.made.includes("agents"), "~/.claude 에 새로 생긴 것도 다음에 맞출 때 걸린다");
ok(isLinkTo("settings.json") && r3.moved.join() === "settings.json" && readFileSync(join(DIR, "settings.json.split-20261125T030405"), "utf8").includes("갈라짐"),
  "일반 파일로 바뀐 것은 옆으로 치우고(내용 보존) 다시 건다");
ok(isLinkTo("sessions") && !readdirSync(DIR).some((n) => n.startsWith("sessions.split")), "빈 폴더는 지우고 건다");

// ── 로그인 확인과 표식 ──
ok(mod.markReady("personal2").ok === false && !acc.loginReady("personal2"), "로그인 전에는 표식을 두지 않는다");
const state = JSON.parse(readFileSync(join(DIR, ".claude.json"), "utf8"));
writeFileSync(join(DIR, ".claude.json"), JSON.stringify({ ...state, oauthAccount: { emailAddress: MAIN.toUpperCase() } }));
const same = mod.markReady("personal2");
ok(same.ok === false && /메인 계정과 같은/.test(same.why) && !same.why.includes(MAIN) && !acc.loginReady("personal2"), "메인 계정과 같은 계정으로 로그인됐으면 표식을 두지 않고, 메일은 가려서 알린다");
writeFileSync(join(DIR, ".claude.json"), JSON.stringify({ ...state, oauthAccount: { emailAddress: SECOND } }));
const good = mod.markReady("personal2");
ok(good.ok && acc.loginReady("personal2") && acc.hasToken("personal2"), "다른 계정으로 로그인됐으면 표식을 두고, 그 계정은 토큰이 없어도 켤 수 있는 계정이 된다");
ok(mod.mask(SECOND) === "se***@example.com", "메일은 앞 두 글자만 보인다");

// ── 켜는 스크립트(claude-as.sh): 가짜 claude 가 받은 환경을 찍는다 ──
const BIN = join(T, "bin");
mkdirSync(BIN);
writeFileSync(join(BIN, "claude"), '#!/bin/sh\necho "DIR=${CLAUDE_CONFIG_DIR:-} TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:+있음} ACCOUNT=${PI_CLAUDE_ACCOUNT:-} ARGS=$*"\n');
chmodSync(join(BIN, "claude"), 0o755);
const AS = new URL("../claude-as.sh", import.meta.url).pathname;
const as = (account, env = {}) => spawnSync("/bin/sh", [AS, account, "--x"], { encoding: "utf8", env: { PATH: `${BIN}:/usr/bin:/bin`, HOME, PI_PERSONAL2_KEYCHAIN: "pi-test-없는-항목", PI_WORK_KEYCHAIN: "pi-test-없는-항목", ...env } });
let out = as("personal2", { CLAUDE_CODE_OAUTH_TOKEN: "남은-토큰" });
ok(out.stdout.trim() === `DIR=${DIR} TOKEN= ACCOUNT=personal2 ARGS=--x`, "표식이 있으면 그 설정 폴더로 켜고 토큰은 넘기지 않는다(남아 있던 토큰도 뺌)");
out = as("personal", { CLAUDE_CODE_OAUTH_TOKEN: "t", PI_CLAUDE_ACCOUNT: "personal2", CLAUDE_CONFIG_DIR: DIR });
ok(out.stdout.trim() === "DIR= TOKEN= ACCOUNT= ARGS=--x", "개인(메인)으로 켤 때는 토큰·표시·설정 폴더를 모두 뺀다(추가 계정 탭 안에서 불려도)");
out = as("work", { CLAUDE_CONFIG_DIR: DIR });
ok(out.status === 1 && /토큰을 열쇠고리 항목/.test(out.stderr) && out.stdout === "", "표식이 없는 계정은 예전처럼 토큰으로(토큰이 없으면 켜지 않음)");
execFileSync(process.execPath, [new URL("../login-dir.mjs", import.meta.url).pathname, "personal2", "off"], { env: { ...process.env, HOME } });
ok(!acc.loginReady("personal2"), "off: 표식을 지운다");
out = as("personal2");
ok(out.status === 1 && /토큰을 열쇠고리 항목/.test(out.stderr), "표식을 지우면 토큰 방식으로 돌아간다");

rmSync(T, { recursive: true, force: true });
console.log(fail ? `${total}가지 가운데 ${fail}가지 실패` : `${total}가지 통과`);
process.exit(fail ? 1 : 0);
