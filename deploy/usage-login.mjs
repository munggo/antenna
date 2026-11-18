#!/usr/bin/env node
// 회사 계정의 '사용량 조회 전용' 로그인. Antenna 앱의 사용량(서랍 고리·사용량 화면)에 회사 계정의 Fable 사용률까지 보이게 한다.
//
// 왜 따로 받나: Claude Code·pi 가 회사 계정에 쓰는 토큰은 `claude setup-token` 의 장기 토큰이라 추론 권한뿐이다.
// 사용량 조회(/api/oauth/usage)는 정식 로그인(프로필 권한)만 할 수 있다. 여기서 받은 로그인은 브리지가 사용량을 조회할 때만 쓰고
// (server/usage-auth.mjs), Claude Code·pi 의 회사 토큰은 그대로 둔다. pi 의 로그인 파일(~/.pi/agent/auth.json)도 건드리지 않는다.
//
// 쓰기: node deploy/usage-login.mjs work [--url-file <파일>]   로그인: 찍히는 주소를 브라우저에서 열어 회사 계정으로 승인 → 받은 코드를 붙여넣기
//       node deploy/usage-login.mjs status                     저장된 조회용 로그인(어느 계정인지, 만료). 토큰은 찍지 않는다
//       node deploy/usage-login.mjs logout                     조회용 로그인을 지운다
// 로그인·저장·갱신은 pi 의 코드를 그대로 쓴다(pi 가 깔려 있어야 함). 저장 자리: ~/.config/pi-remote/usage-auth.json(본인만 읽기)
// 작성: 서문교
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { loadPiAuth, PI_AUTH_FILE, readCredential, USAGE_AUTH_FILE, usageToken } from "../server/usage-auth.mjs";
import { claimsFromUsage, recordSharedClaims } from "../server/usage-history.mjs";

const WORK = "anthropic-work";
const PI_PKG = process.env.PI_PKG || `${dirname(process.execPath)}/../lib/node_modules/@earendil-works/pi-coding-agent`;
const [mode, ...rest] = process.argv.slice(2);
const urlFile = rest.includes("--url-file") ? rest[rest.indexOf("--url-file") + 1] : "";

async function get(path, token) {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
/** 어느 계정인지(화면에 보일 것만) */
const who = (p) => `${p?.account?.email ?? "?"} · ${p?.organization?.name ?? "?"}(${p?.organization?.organization_type ?? "?"})`;
const when = (ms) => new Date(ms).toLocaleString("ko-KR", { hour12: false });

const pi = await loadPiAuth(PI_PKG);
if (!pi) {
  console.error("pi 를 찾지 못했어요. 로그인·갱신에 pi 의 코드를 쓰므로 pi 가 깔려 있어야 해요(npm i -g @earendil-works/pi-coding-agent).");
  process.exit(2);
}

if (mode === "status") {
  const c = readCredential(USAGE_AUTH_FILE, WORK);
  if (c?.type !== "oauth") { console.log("회사 계정 조회용 로그인이 없어요. node deploy/usage-login.mjs work"); process.exit(1); }
  const r = await usageToken({ file: USAGE_AUTH_FILE, provider: WORK, pi });
  if (!r.token) { console.log(`조회용 로그인을 쓸 수 없어요(${r.error}${r.detail ? `: ${r.detail}` : ""}). 다시 로그인해 주세요: node deploy/usage-login.mjs work`); process.exit(1); }
  const now = readCredential(USAGE_AUTH_FILE, WORK);
  console.log(`회사 계정 조회용 로그인: ${who(await get("/api/oauth/profile", r.token))}`);
  console.log(`접근 토큰 만료: ${when(now.expires)}(브리지가 그 전에 스스로 갱신해요)${r.refreshed ? " · 방금 갱신함" : ""}`);
  process.exit(0);
}

if (mode === "logout") {
  await pi.AuthStorage.create(USAGE_AUTH_FILE).delete(WORK);
  console.log("회사 계정 조회용 로그인을 지웠어요. 회사 계정의 사용량은 다시 '모든 모델'만 보여요.");
  process.exit(0);
}

if (mode !== "work") {
  console.error("쓰기: node deploy/usage-login.mjs work | status | logout");
  process.exit(2);
}

// --- 로그인 ---
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
const abort = new AbortController();
rl.on("SIGINT", () => { abort.abort(); console.log("\n그만둠"); process.exit(130); });
let credential;
try {
  credential = await pi.anthropicOAuth.login({
    signal: abort.signal,
    // 로그인 방식: 브라우저가 다른 기기(폰)여도 되게, 승인 뒤 화면에 뜨는 코드를 붙여넣는 방식만 쓴다
    prompt: async (p) => {
      if (p.type === "select") return "copy_code";
      return ask("\n승인한 뒤 화면에 뜨는 코드를 여기에 붙여넣고 Enter: ");
    },
    notify: (n) => {
      if (n.type === "auth_url") {
        if (urlFile) writeFileSync(urlFile, `${n.url}\n`, { mode: 0o600 });
        console.log("아래 주소를 브라우저에서 열어 '회사 계정'으로 승인해 주세요.");
        console.log("(브라우저가 개인 계정으로 로그인돼 있으면, 먼저 claude.ai 에서 회사 계정으로 바꾼 뒤 여세요)\n");
        console.log(n.url);
      } else if (n.type === "progress") {
        console.log("코드를 확인하는 중…");
      }
    },
  });
} catch (e) {
  // 까닭은 첫 마디만: pi 의 오류 글에는 실패한 응답의 본문이 붙어 있을 수 있다
  console.error(`로그인하지 못했어요: ${String(e?.message ?? e).replace(/\b(body|details|url)=[\s\S]*$/, "").split(/[.;\n]/)[0].trim().slice(0, 120)}`);
  process.exit(1);
} finally {
  rl.close();
}
if (credential?.type !== "oauth" || !credential.access) { console.error("로그인 결과를 받지 못했어요."); process.exit(1); }

// 어느 계정으로 승인했는지 확인: 개인 계정이면(브라우저가 개인 계정이었던 경우) 저장하지 않는다. 회사 칸에 개인 값이 들어가면 안 된다
let profile;
try {
  profile = await get("/api/oauth/profile", credential.access);
} catch (e) {
  console.error(`로그인은 됐지만 계정 정보를 읽지 못했어요(${e.message}). 저장하지 않았어요.`);
  process.exit(1);
}
const personal = await usageToken({ file: PI_AUTH_FILE, provider: "anthropic", pi });
if (personal.token) {
  try {
    const mine = await get("/api/oauth/profile", personal.token);
    if (mine?.account?.uuid && mine.account.uuid === profile?.account?.uuid) {
      console.error(`\n개인 계정(${who(profile)})으로 승인하셨어요. 저장하지 않았어요.`);
      console.error("브라우저에서 회사 계정으로 바꾼 뒤 다시 해 주세요: node deploy/usage-login.mjs work");
      process.exit(1);
    }
  } catch {
    /* 개인 계정 정보를 못 읽으면 견주지 않고, 아래에 어느 계정인지 보여 준다 */
  }
}

await pi.AuthStorage.create(USAGE_AUTH_FILE).modify(WORK, async () => credential);
console.log(`\n저장했어요: ${who(profile)}`);
console.log(`자리: ${USAGE_AUTH_FILE.replace(process.env.HOME, "~")}(본인만 읽기)`);

// 바로 한 번 조회해 앱에 보이게 한다(브리지는 10분마다, 앱이 사용량을 열 때마다 조회)
try {
  const claims = claimsFromUsage(await get("/api/oauth/usage", credential.access));
  recordSharedClaims(WORK, claims);
  const pct = (k) => (claims[k] ? `${Math.round(claims[k].util * 1000) / 10}%` : "값 없음");
  console.log(`지금 회사 계정: 모든 모델 ${pct("7d")} · Fable ${pct("7d:oi")}`);
  if (!existsSync(USAGE_AUTH_FILE)) console.error("주의: 저장한 파일이 보이지 않아요.");
} catch (e) {
  console.log(`사용량은 아직 조회하지 못했어요(${e.message}). 브리지가 곧 다시 조회해요.`);
}
