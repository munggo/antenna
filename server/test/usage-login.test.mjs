// 회사 계정 조회용 로그인 명령(deploy/usage-login.mjs) 시험. 진짜 로그인·진짜 Anthropic 은 쓰지 않는다:
//  - 가짜 홈에서 돌리고, 브라우저 승인은 가짜(시험이 넣는 코드에 따라 회사 계정·개인 계정·틀린 코드),
//  - 계정 정보·사용량 조회는 가로채 가짜 응답을 준다(node --import 로 fetch 를 바꿈. 다른 주소로 나가면 실패),
//  - 저장·잠금은 pi 의 진짜 코드 그대로(가짜 pi 패키지가 진짜 파일을 다시 내보냄). pi 가 없는 맥에서는 건너뛴다.
// 실행: node server/test/usage-login.test.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REAL_PI = process.env.PI_PKG || `${dirname(process.execPath)}/../lib/node_modules/@earendil-works/pi-coding-agent`;
const REAL_AI = [join(REAL_PI, "node_modules/@earendil-works/pi-ai"), join(REAL_PI, "../pi-ai")].find((d) => existsSync(join(d, "dist/auth/resolve.js")));
if (!REAL_AI || !existsSync(join(REAL_PI, "dist/core/auth-storage.js"))) {
  console.log("건너뜀: pi 가 깔려 있지 않음");
  process.exit(0);
}
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const dir = mkdtempSync(join(tmpdir(), "usage-login-"));
const HOME = join(dir, "home");
const PI = join(dir, "pi-pkg");
const AUTH = join(HOME, ".pi/agent/auth.json"), STORE = join(HOME, ".config/pi-remote/usage-auth.json"), SHARED = join(dir, "accounts.json");
mkdirSync(dirname(AUTH), { recursive: true });
// 가짜 pi 패키지: 저장소와 갱신 함수는 진짜 것을 다시 내보내고, 브라우저 승인(login)만 가짜
mkdirSync(join(PI, "dist/core"), { recursive: true });
mkdirSync(join(PI, "node_modules/@earendil-works/pi-ai/dist/auth/oauth"), { recursive: true });
writeFileSync(join(PI, "dist/core/auth-storage.js"), `export * from ${JSON.stringify(join(REAL_PI, "dist/core/auth-storage.js"))};\n`);
writeFileSync(join(PI, "node_modules/@earendil-works/pi-ai/dist/auth/resolve.js"), `export * from ${JSON.stringify(join(REAL_AI, "dist/auth/resolve.js"))};\n`);
writeFileSync(join(PI, "node_modules/@earendil-works/pi-ai/dist/auth/oauth/anthropic.js"), `
export const anthropicOAuth = {
  async login(interaction) {
    const method = await interaction.prompt({ type: "select", message: "방식", options: [{ id: "browser" }, { id: "copy_code" }] });
    if (method !== "copy_code") throw new Error("시험: 코드 붙여넣기 방식이 아님 → " + method);
    interaction.notify({ type: "auth_url", url: "https://claude.ai/oauth/authorize?fake=1&state=test-state", instructions: "" });
    const code = await interaction.prompt({ type: "manual_code", message: "코드", placeholder: "code#state" });
    interaction.notify({ type: "progress", message: "..." });
    if (code === "work-code#test-state") return { type: "oauth", access: "test-work-access", refresh: "test-work-refresh", expires: Date.now() + 8 * 3600e3 };
    if (code === "personal-code#test-state") return { type: "oauth", access: "test-personal-access-2", refresh: "test-personal-refresh-2", expires: Date.now() + 8 * 3600e3 };
    if (code === "p2-code#test-state") return { type: "oauth", access: "test-p2-access", refresh: "test-p2-refresh", expires: Date.now() + 8 * 3600e3 };
    throw new Error("Token exchange failed: invalid_grant body={\\"refresh\\":\\"test-leak\\"}");
  },
  refresh: async (c) => ({ ...c, access: c.access + "+", refresh: c.refresh + "+", expires: Date.now() + 8 * 3600e3 }),
  async toAuth(c) { return { apiKey: c.access }; },
};
`);
// 조회를 가로채는 가짜: 토큰에 따라 계정이 정해진다. Anthropic 말고 다른 주소로 나가면 실패
const FETCH = join(dir, "fake-fetch.mjs");
writeFileSync(FETCH, `
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://api.anthropic.com/")) throw new Error("시험: 예상하지 못한 주소 " + u);
  const token = String(init?.headers?.Authorization ?? "").replace("Bearer ", "");
  const acct = token.startsWith("test-work") ? "work" : token.startsWith("test-personal") ? "personal" : token.startsWith("test-p2") ? "p2" : null;
  const json = (status, body) => ({ ok: status === 200, status, json: async () => body });
  if (!acct) return json(401, {});
  if (u.endsWith("/api/oauth/profile")) {
    if (process.env.FAKE_PROFILE_FAIL === acct) return json(500, {});
    return json(200, acct === "work"
      ? { account: { uuid: "acct-work", email: "work@example.com" }, organization: { name: "Example Co", organization_type: "claude_team" } }
      : acct === "p2"
        ? { account: { uuid: "acct-p2", email: "second@example.com" }, organization: { name: "Second", organization_type: "claude_max" } }
        : { account: { uuid: "acct-personal", email: "me@example.com" }, organization: { name: "Personal", organization_type: "claude_max" } });
  }
  if (u.endsWith("/api/oauth/usage")) {
    if (process.env.FAKE_USAGE_FAIL) return json(500, {});
    const reset = new Date(Date.now() + 3 * 86400e3).toISOString();
    return json(200, { limits: [{ group: "weekly", percent: 12, resets_at: reset, scope: null }, { group: "weekly", percent: 55, resets_at: reset, scope: { model: { display_name: "Fable" } } }] });
  }
  return json(404, {});
};
`);
const personalLogin = () => { writeFileSync(AUTH, JSON.stringify({ anthropic: { type: "oauth", access: "test-personal-access", refresh: "test-personal-refresh", expires: Date.now() + 6 * 3600e3 } }), { mode: 0o600 }); };
/** 명령을 돌린다. code 가 있으면 코드를 물을 때 넣는다 → { status, out } */
const run = (args, { code, env = {} } = {}) => new Promise((res) => {
  const p = spawn(process.execPath, ["--import", FETCH, join(REPO, "deploy/usage-login.mjs"), ...args], {
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_PKG: PI, PI_ACCOUNTS_CACHE: SHARED, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "", sent = false;
  const feed = (d) => {
    out += d;
    if (!sent && code !== undefined && /붙여넣고 Enter/.test(out)) { sent = true; p.stdin.write(`${code}\n`); }
  };
  p.stdout.on("data", feed);
  p.stderr.on("data", feed);
  const timer = setTimeout(() => p.kill("SIGKILL"), 20000);
  p.on("exit", (status) => { clearTimeout(timer); res({ status, out }); });
});
const stored = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : {});
const noSecrets = (out) => !/test-work-access|test-work-refresh|test-personal-access|test-personal-refresh|test-p2-access|test-p2-refresh|test-leak/.test(out);

personalLogin();
let r = await run(["status"]);
ok(r.status === 1 && /조회용 로그인이 없어요/.test(r.out), "처음에는 조회용 로그인이 없다고 알림");
r = await run([]);
ok(r.status === 2 && /쓰기:/.test(r.out), "무엇을 할지 안 적으면 쓰는 법을 알려 줌");

// 틀린 코드: 저장하지 않음, 오류 글에 응답 본문이 섞이지 않음
r = await run(["work"], { code: "wrong#test-state" });
ok(r.status === 1 && /로그인하지 못했어요: Token exchange failed: invalid_grant/.test(r.out) && !existsSync(STORE), `코드가 틀리면 저장하지 않음 → 끝 코드 ${r.status}`);
ok(noSecrets(r.out) && !/body=/.test(r.out), "실패 까닭에 응답 본문을 붙여 찍지 않음");
ok(/회사 계정/.test(r.out) && /https:\/\/claude\.ai\/oauth\/authorize/.test(r.out), "승인할 주소와 '회사 계정으로' 안내를 보여 줌");

// 개인 계정으로 승인(브라우저가 개인 계정이었던 경우): 회사 칸에 개인 값이 들어가지 않게 저장하지 않음
r = await run(["work"], { code: "personal-code#test-state" });
ok(r.status === 1 && /개인 계정\(me@example\.com/.test(r.out) && /저장하지 않았어요/.test(r.out) && !existsSync(STORE), `개인 계정으로 승인하면 알리고 저장하지 않음 → 끝 코드 ${r.status}`);
ok(!existsSync(SHARED), "저장하지 않았으면 공유 사용량 파일에도 적지 않음");

// 계정 정보를 읽지 못하면(어느 계정인지 확인 불가) 저장하지 않음
r = await run(["work"], { code: "work-code#test-state", env: { FAKE_PROFILE_FAIL: "work" } });
ok(r.status === 1 && /계정 정보를 읽지 못했어요/.test(r.out) && !existsSync(STORE), "어느 계정인지 확인하지 못하면 저장하지 않음");

// 회사 계정으로 승인: 저장하고, 바로 조회해 공유 파일에 적음
const urlFile = join(dir, "url.txt");
r = await run(["work", "--url-file", urlFile], { code: "work-code#test-state" });
ok(r.status === 0 && /저장했어요: work@example\.com · Example Co\(claude_team\)/.test(r.out), `회사 계정으로 승인하면 저장하고 어느 계정인지 보여 줌 → 끝 코드 ${r.status}`);
ok(stored()["anthropic-work"]?.access === "test-work-access" && stored()["anthropic-work"].type === "oauth", "조회용 로그인이 정해진 자리에 저장됨");
ok((statSync(STORE).mode & 0o777) === 0o600, "저장한 파일은 본인만 읽기");
ok(readFileSync(urlFile, "utf8").trim() === "https://claude.ai/oauth/authorize?fake=1&state=test-state" && (statSync(urlFile).mode & 0o777) === 0o600, "승인할 주소를 파일로도 남김(본인만 읽기)");
ok(/모든 모델 12% · Fable 55%/.test(r.out), "저장한 뒤 지금 사용량을 보여 줌");
const shared = JSON.parse(readFileSync(SHARED, "utf8"))["anthropic-work"];
ok(shared?.["7d"]?.util === 0.12 && shared?.["7d:oi"]?.util === 0.55, "조회한 값을 공유 사용량 파일의 회사 칸에 적음(앱에 바로 보이게)");
ok(JSON.parse(readFileSync(AUTH, "utf8")).anthropic.access === "test-personal-access", "pi 의 로그인 파일(개인 계정)은 그대로");
ok(noSecrets(r.out), "화면에 토큰을 찍지 않음");

r = await run(["status"]);
ok(r.status === 0 && /work@example\.com · Example Co/.test(r.out) && /접근 토큰 만료/.test(r.out) && noSecrets(r.out), "상태: 어느 계정인지와 만료(토큰은 찍지 않음)");

// 추가 개인 계정(11-25): 같은 방식으로 받아 그 칸에. 메인 개인·회사 계정으로 승인하면 저장하지 않는다
r = await run(["status", "personal2"]);
ok(r.status === 1 && /추가 개인 계정 조회용 로그인이 없어요/.test(r.out), "상태(추가 개인): 아직 없다고 알림");
r = await run(["personal2"], { code: "personal-code#test-state" });
ok(r.status === 1 && /개인 계정\(me@example\.com/.test(r.out) && !stored()["anthropic-personal2"], `추가 개인 자리에 메인 개인 계정으로 승인하면 저장하지 않음 → 끝 코드 ${r.status}`);
ok(/'추가 개인 계정'으로 승인해 주세요/.test(r.out) && /usage-login\.mjs personal2/.test(r.out), "추가 개인: 안내 글이 그 계정 이름과 다시 할 명령으로");
r = await run(["personal2"], { code: "work-code#test-state" });
ok(r.status === 1 && /회사 계정\(work@example\.com/.test(r.out) && !stored()["anthropic-personal2"], `추가 개인 자리에 회사 계정으로 승인하면 저장하지 않음 → 끝 코드 ${r.status}`);
r = await run(["personal2"], { code: "p2-code#test-state" });
ok(r.status === 0 && /저장했어요: second@example\.com/.test(r.out) && stored()["anthropic-personal2"]?.access === "test-p2-access", `추가 개인 계정으로 승인하면 그 칸에 저장 → 끝 코드 ${r.status}`);
ok(stored()["anthropic-work"]?.access?.startsWith("test-work-access"), "회사 계정 조회용 로그인은 그대로");
ok(/지금 추가 개인 계정: 모든 모델 12% · Fable 55%/.test(r.out), "추가 개인: 저장한 뒤 지금 사용량을 보여 줌");
const p2 = JSON.parse(readFileSync(SHARED, "utf8"))["anthropic-personal2"];
ok(p2?.["7d"]?.util === 0.12 && p2?.["7d:oi"]?.util === 0.55, "조회한 값을 공유 사용량 파일의 추가 개인 칸에 적음(앱에 Fable 이 따로 보이게)");
ok(noSecrets(r.out), "추가 개인: 화면에 토큰을 찍지 않음");
r = await run(["work"], { code: "p2-code#test-state" });
ok(r.status === 1 && /추가 개인 계정\(second@example\.com/.test(r.out) && stored()["anthropic-work"]?.access?.startsWith("test-work-access"), "회사 자리에 추가 개인 계정으로 승인하면 저장하지 않음");
r = await run(["status"]);
ok(r.status === 0 && /회사 계정 조회용 로그인: work@example\.com/.test(r.out) && /추가 개인 계정 조회용 로그인: second@example\.com/.test(r.out) && noSecrets(r.out), "상태: 계정을 안 적으면 둘 다");
r = await run(["status", "personal2"]);
ok(r.status === 0 && /second@example\.com/.test(r.out) && !/work@example\.com/.test(r.out), "상태(추가 개인): 그 계정만");
r = await run(["logout", "personal2"]);
ok(r.status === 0 && stored()["anthropic-personal2"] === undefined && stored()["anthropic-work"] !== undefined, "지우기(추가 개인): 그 계정만 지우고 회사는 그대로");
// 사용량 조회가 안 돼도 로그인은 저장됨
rmSync(STORE);
r = await run(["work"], { code: "work-code#test-state", env: { FAKE_USAGE_FAIL: "1" } });
ok(r.status === 0 && stored()["anthropic-work"]?.access === "test-work-access" && /아직 조회하지 못했어요/.test(r.out), "사용량 조회가 안 돼도 로그인은 저장하고 알림");
// 개인 계정 로그인이 없는 맥(pi 로그인 없음): 견줄 수 없으니 어느 계정인지 보여 주고 저장
rmSync(STORE);
rmSync(AUTH);
r = await run(["work"], { code: "work-code#test-state" });
ok(r.status === 0 && /저장했어요: work@example\.com/.test(r.out), "개인 계정 로그인이 없어도 회사 계정 로그인은 됨");
personalLogin();
r = await run(["logout"]);
ok(r.status === 0 && stored()["anthropic-work"] === undefined, "지우기: 조회용 로그인을 지움");
r = await run(["status"], { env: { PI_PKG: join(dir, "no-such-pi") } });
ok(r.status === 2 && /pi 를 찾지 못했어요/.test(r.out), "pi 가 없으면 그렇다고 알림");

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
