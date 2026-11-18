// 사용량 조회용 로그인 시험(server/usage-auth.mjs): 만료가 가까우면 pi 가 쓰는 함수로 갱신해 저장하는지, 갱신이 한 번만 일어나는지,
// 실패해도 로그인 파일이 그대로인지. 진짜 로그인·진짜 Anthropic 은 쓰지 않는다: 임시 폴더의 가짜 로그인 파일에, pi 의 진짜 저장·잠금
// 코드(pi 가 깔려 있을 때)와 가짜 갱신 응답을 쓴다. pi 가 없는 맥에서는 그 부분을 건너뛴다.
// 실행: node server/test/usage-auth.test.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "usage-auth-"));
process.env.HOME = dir;   // 모듈이 기본 경로를 만들 때 진짜 홈을 보지 않게(시험은 경로를 직접 준다)
const m = await import("../usage-auth.mjs");
const { claimsFromUsage, recordSharedClaims, sharedLimits } = await import("../usage-history.mjs");
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const NOW = Date.now();
const MIN = 60_000;
const FILE = join(dir, "auth.json");
const cred = (n, expiresInMin) => ({ type: "oauth", access: `시험-접근-${n}`, refresh: `시험-갱신-${n}`, expires: NOW + expiresInMin * MIN });
const put = (data, file = FILE) => writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
const get = (file = FILE) => JSON.parse(readFileSync(file, "utf8"));
const ask = (provider, pi, file = FILE) => m.usageToken({ file, provider, pi, now: () => NOW });

// --- pi 없이 되는 갈래 ---
ok((await ask("anthropic", null, join(dir, "없는-파일.json"))).error === "none", "로그인 파일이 없으면 '로그인 없음'");
put({ other: cred(0, 600) });
ok((await ask("anthropic", null)).error === "none", "그 계정 항목이 없으면 '로그인 없음'");
put({ anthropic: { type: "api_key", key: "!어떤 명령" } });
ok((await ask("anthropic", null)).error === "none", "정식 로그인이 아니면(키 방식) '로그인 없음': 조회 권한이 없는 토큰");
writeFileSync(FILE, "{ 깨진 글");
ok((await ask("anthropic", null)).error === "none", "로그인 파일이 깨졌으면 '로그인 없음'(죽지 않음)");
put({ anthropic: cred(1, 120) });
let r = await ask("anthropic", null);
ok(r.token === "시험-접근-1" && r.refreshed === false, "만료까지 넉넉하면 그 토큰 그대로");
put({ anthropic: cred(1, 3) });
r = await ask("anthropic", null);
ok(r.token === "시험-접근-1", "pi 를 못 불러오는 맥: 만료가 가까워도 아직 만료 전이면 그 토큰으로 조회");
put({ anthropic: cred(1, -1) });
ok((await ask("anthropic", null)).error === "expired", "pi 를 못 불러오는 맥: 만료됐으면 '만료'(전과 같은 동작)");
ok((await m.loadPiAuth(join(dir, "no-such-pi"))) === null && (await m.loadPiAuth("")) === null, "pi 패키지가 없으면 갱신 수단 없음(null)");

// --- pi 의 진짜 저장·잠금 코드로 ---
const PI_PKG = process.env.PI_PKG || `${dirname(process.execPath)}/../lib/node_modules/@earendil-works/pi-coding-agent`;
const real = await m.loadPiAuth(PI_PKG);
if (!real) {
  console.log("건너뜀: pi 가 깔려 있지 않아 갱신 시험은 하지 않음");
} else {
  ok(real === (await m.loadPiAuth(PI_PKG)), "pi 의 저장소·갱신 함수를 불러옴(두 번째는 불러 둔 것)");
  let calls = 0;
  let failWith = null;
  // 갱신 응답만 가짜: 부를 때마다 새 토큰(진짜처럼 갱신 토큰도 바뀐다)
  const pi = { ...real, anthropicOAuth: { ...real.anthropicOAuth, refresh: async (c) => {
    calls++;
    await new Promise((res) => setTimeout(res, 60));
    if (failWith) throw new Error(failWith);
    return { type: "oauth", access: `${c.access}+`, refresh: `${c.refresh}+`, expires: NOW + 480 * MIN };
  } } };

  put({ anthropic: cred(2, 120), "anthropic-work": { type: "api_key", key: "!키체인 명령" } });
  r = await ask("anthropic", pi);
  ok(r.token === "시험-접근-2" && calls === 0, "만료까지 넉넉하면 갱신하지 않음");

  put({ anthropic: cred(2, 4), "anthropic-work": { type: "api_key", key: "!키체인 명령" } });
  r = await ask("anthropic", pi);
  let d = get();
  ok(r.token === "시험-접근-2+" && r.refreshed === true && calls === 1, `만료 5분 안이면 갱신해 새 토큰으로 → ${r.error ?? "갱신됨"}`);
  ok(d.anthropic.access === "시험-접근-2+" && d.anthropic.refresh === "시험-갱신-2+" && d.anthropic.expires === NOW + 480 * MIN, "새 로그인(접근·갱신 토큰·만료)을 파일에 저장");
  ok(d["anthropic-work"]?.key === "!키체인 명령", "같은 파일의 다른 계정 항목은 그대로");
  ok((statSync(FILE).mode & 0o777) === 0o600, "로그인 파일은 본인만 읽는 권한 그대로");

  calls = 0;
  put({ anthropic: cred(3, -30) });
  r = await ask("anthropic", pi);
  ok(r.token === "시험-접근-3+" && calls === 1, "이미 만료된 로그인도 갱신해 조회(pi 를 며칠 안 쓴 뒤)");

  // 동시에 여럿이 갱신하려 해도 한 번만(파일을 잠근 채 다시 확인). 갱신 토큰은 한 번 쓰면 못 쓰게 되므로 두 번 갱신하면 로그인이 깨진다
  calls = 0;
  put({ anthropic: cred(4, 2) });
  const both = await Promise.all([ask("anthropic", pi), ask("anthropic", pi), ask("anthropic", pi)]);
  ok(calls === 1 && both.every((x) => x.token === "시험-접근-4+"), `동시에 셋이 갱신하려 해도 갱신은 한 번, 모두 새 토큰(갱신 ${calls}번)`);

  // 갱신 실패: 로그인 파일은 그대로. 아직 만료 전이면 그 토큰으로 조회는 계속, 만료됐으면 실패로
  calls = 0;
  failWith = "Anthropic token refresh request failed. url=https://example.invalid; details=body={\"secret\":\"시험-갱신-5\"}";
  put({ anthropic: cred(5, 3) });
  r = await ask("anthropic", pi);
  ok(r.token === "시험-접근-5" && r.refreshed === false && typeof r.detail === "string", "갱신 실패 + 아직 만료 전: 그 토큰으로 조회는 됨");
  ok(get().anthropic.access === "시험-접근-5" && get().anthropic.refresh === "시험-갱신-5", "갱신에 실패하면 로그인 파일을 바꾸지 않음");
  ok(!/시험-갱신|시험-접근|secret/.test(r.detail), `실패 까닭에 토큰이나 응답 본문이 섞이지 않음 → '${r.detail}'`);
  put({ anthropic: cred(5, -10) });
  r = await ask("anthropic", pi);
  ok(r.error === "refresh-failed" && !/시험-갱신|시험-접근|secret/.test(r.detail ?? ""), `갱신 실패 + 이미 만료: 실패로 알림 → '${r.detail}'`);
  failWith = "invalid_grant";
  r = await ask("anthropic", pi);
  ok(r.error === "refresh-failed" && /다시 로그인/.test(r.detail), `로그인이 더는 유효하지 않으면 다시 로그인하라고 → '${r.detail}'`);
  failWith = null;

  // 회사 계정 조회 전용 로그인: 다른 파일·다른 항목도 같은 방식. pi 의 로그인 파일은 건드리지 않는다
  calls = 0;
  const WORK = join(dir, "conf", "usage-auth.json");
  const before = readFileSync(FILE, "utf8");
  const store = real.AuthStorage.create(WORK);
  await store.modify("anthropic-work", async () => cred(6, 2));
  ok(existsSync(WORK) && (statSync(WORK).mode & 0o777) === 0o600 && (statSync(dirname(WORK)).mode & 0o777) === 0o700, "조회 전용 로그인 파일은 본인만 읽게 만들어짐(폴더도)");
  r = await ask("anthropic-work", pi, WORK);
  ok(r.token === "시험-접근-6+" && calls === 1 && get(WORK)["anthropic-work"].access === "시험-접근-6+", "회사 계정 조회용 로그인도 만료가 가까우면 갱신");
  ok(readFileSync(FILE, "utf8") === before, "그동안 pi 의 로그인 파일은 그대로");
}

// --- 조회 응답 → 공유 파일 → 화면에 보낼 한도(회사 계정) ---
{
  const F = join(dir, "accounts.json");
  const reset = new Date(NOW + 3 * 86400_000).toISOString();
  const lim = (percent, model, group = "weekly") => ({ kind: "x", group, percent, resets_at: reset, scope: model ? { model: { display_name: model } } : null });
  let c = claimsFromUsage({ limits: [lim(11), lim(37, "Fable"), lim(5, null, "session")] }, NOW);
  ok(Object.keys(c).sort().join() === "5h,7d,7d:oi" && c["7d"].util === 0.11 && c["7d:oi"].util === 0.37 && c["7d"].reset === Math.floor(Date.parse(reset) / 1000),
    `조회 응답 → 5시간·모든 모델·Fable(응답에 실려 오는 이름 oi 로) → ${Object.keys(c).sort().join()}`);
  c = claimsFromUsage({ five_hour: { utilization: 20, resets_at: reset }, limits: [lim(11), lim(8, "Claude Opus")] }, NOW);
  ok(Object.keys(c).sort().join() === "5h,7d,7d:opus" && c["5h"].util === 0.2, `5시간 값이 예전 자리에만 와도, 다른 모델별 한도는 그 모델 이름으로 → ${Object.keys(c).sort().join()}`);
  ok(Object.keys(claimsFromUsage({})).length === 0 && Object.keys(claimsFromUsage(null)).length === 0 && Object.keys(claimsFromUsage({ limits: [{ group: "weekly" }] })).length === 0, "한도가 없거나 값이 숫자가 아닌 응답은 아무것도 적지 않음");

  writeFileSync(F, JSON.stringify({ anthropic: { "7d": { util: 0.4, reset: 1, at: 1 } }, "anthropic-work": { "7d": { util: 0.1, reset: 2, at: 2 }, "7d:oi": { util: 1, reset: 3, at: 3, hit: true }, "429": { util: 1, at: 4 } } }));
  ok(recordSharedClaims("anthropic-work", claimsFromUsage({ limits: [lim(12), lim(40, "Fable")] }, NOW), F), "조회한 회사 값을 공유 파일에 적음");
  const all = JSON.parse(readFileSync(F, "utf8"));
  ok(all["anthropic-work"]["7d"].util === 0.12 && all["anthropic-work"]["7d:oi"].util === 0.4 && all["anthropic-work"]["7d:oi"].hit === undefined, "조회한 값이 옛 값(한도에 걸려 적힌 100%)을 바꿈");
  ok(all["anthropic-work"]["429"]?.util === 1 && all.anthropic["7d"].util === 0.4, "다른 구분과 개인 계정 칸은 그대로");
  const w = sharedLimits("anthropic-work", false, NOW, F);
  ok(w.map((l) => `${l.key}=${l.percent}`).join(" ") === "work:7d=12 work:7d:Fable=40", `앱에는 모든 모델과 Fable 로 → ${w.map((l) => `${l.key}=${l.percent}`).join(" ")}`);
  ok(recordSharedClaims("anthropic-work", {}, F) === false && recordSharedClaims("anthropic-work", null, F) === false, "적을 값이 없으면 파일을 건드리지 않음");
  writeFileSync(F, "{깨짐");
  ok(recordSharedClaims("anthropic-work", { "7d": { util: 0.5, at: NOW } }, F) && JSON.parse(readFileSync(F, "utf8"))["anthropic-work"]["7d"].util === 0.5, "공유 파일이 깨졌으면 새로 씀");
}

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
