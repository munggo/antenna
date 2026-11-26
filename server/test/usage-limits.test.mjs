// 사용량 한도가 앱까지 가는 모양 시험: 모든 모델 주간(week)과 모델별 주간(week:<모델>)을 계정별로 나눠 보내는지.
// 앱은 이 구분으로 서랍의 두 겹 고리(바깥: 모든 모델, 안쪽: 모델별)와 사용량 화면의 막대 색을 정한다.
// 브리지를 따로 띄운다(시험 세션 usagetest · 포트 8785 · 가짜 홈). 사용량 조회는 Anthropic 에 묻지 않고
// 파일(PI_REMOTE_FAKE_USAGE_FILE)의 응답으로 대신한다. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/usage-limits.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "usagetest", PORT = 8785, ROOT = `/tmp/antenna-usage-${process.pid}`, TOKEN = "f".repeat(64);
const FAKE = `${ROOT}/usage.json`, ACCOUNTS = `${ROOT}/accounts.json`, WORKFAKE = `${ROOT}/work-usage.json`, WORKPROFILE = `${ROOT}/work-profile.json`;
const P2FAKE = `${ROOT}/personal2-usage.json`, P2PROFILE = `${ROOT}/personal2-profile.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const now = Date.now();
const RESET = new Date(now + 5 * 86400_000).toISOString();
/** 사용량 조회 응답의 한도 하나(모델이 없으면 모든 모델) */
const weekly = (percent, model) => ({
  kind: model ? "weekly_scoped" : "weekly_all", group: "weekly", percent, severity: "normal", resets_at: RESET,
  scope: model ? { model: { id: null, display_name: model }, surface: null } : null,
});
/** 공유 파일의 값 하나(사용률 0~1, 초기화는 초) */
const claim = (util, agoMin = 1) => ({ util, reset: Math.floor(now / 1000) + 3 * 86400, at: now - agoMin * 60_000 });

mkdirSync(`${ROOT}/home`, { recursive: true });
writeFileSync(FAKE, JSON.stringify({ limits: [weekly(43), weekly(74, "Fable")] }));
writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-work": { "7d": claim(0.06) } }));
// 회사 계정 요금제 조회 응답(조회 전용 로그인이 있을 때만 쓰임: 7-1 에서 회사 조회 응답 파일을 만든 뒤부터)
writeFileSync(WORKPROFILE, JSON.stringify({ organization: { organization_type: "claude_max", rate_limit_tier: "default_claude_max_20x" } }));
writeFileSync(P2PROFILE, JSON.stringify({ organization: { organization_type: "claude_max", rate_limit_tier: "default_claude_max_5x" } }));
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: SERVER,
  env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME: `${ROOT}/home`, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
    PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
    PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: ACCOUNTS, PI_REMOTE_FAKE_USAGE_FILE: FAKE, PI_REMOTE_FAKE_WORK_USAGE_FILE: WORKFAKE, PI_REMOTE_FAKE_WORK_PROFILE_FILE: WORKPROFILE,
    PI_REMOTE_FAKE_PERSONAL2_USAGE_FILE: P2FAKE, PI_REMOTE_FAKE_PERSONAL2_PROFILE_FILE: P2PROFILE, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log` },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
let exited = null;
bridge.stdout.on("data", (d) => (log += d));
bridge.stderr.on("data", (d) => (log += d));
bridge.on("exit", (code) => (exited = code));
try {
  for (let i = 0; i < 40 && !/브리지 시작/.test(log) && exited === null; i++) await sleep(250);
  if (!/브리지 시작/.test(log) || exited !== null) throw new Error(`브리지가 뜨지 않음(끝 코드 ${exited})\n${log.slice(-400)}`);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let usage = null;
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "usage") usage = m;
    } catch { /* 줄 단위가 아닌 글 */ }
  });
  /** 새로 조회해 달라고 하고(1분 저장을 건너뜀) 답을 돌려준다 */
  const ask = async () => {
    usage = null;
    ws.send(JSON.stringify({ type: "usage", force: true }));
    for (let t = 0; t < 5000 && !usage; t += 100) await sleep(100);
    return usage;
  };
  const keys = (limits) => (limits ?? []).map((l) => `${l.key}=${l.percent}`).join(" ");
  const acct = (u, key) => (u?.accounts ?? []).find((a) => a.key === key);

  // 1) 모든 모델 43% · Fable 74%, 회사 계정 6%
  let u = await ask();
  ok(keys(acct(u, "personal")?.limits) === "week=43 week:Fable=74", `개인: 모든 모델과 모델별 주간 한도를 따로 보냄 → ${keys(acct(u, "personal")?.limits)}`);
  ok(acct(u, "personal")?.limits.map((l) => l.label).join(" | ") === "주간 한도 · 모든 모델 | 주간 한도 · Fable", `개인: 이름 → ${acct(u, "personal")?.limits.map((l) => l.label).join(" | ")}`);
  ok(acct(u, "personal")?.limits.every((l) => l.resetsAt === RESET && l.session === false), "개인: 초기화 시각을 그대로, 세션 한도가 아님");
  ok(keys(acct(u, "work")?.limits) === "work:7d=6" && acct(u, "work").limits[0].label === "주간 한도 · 모든 모델", `회사: 공유 파일의 주간 값(이름은 개인처럼) → ${keys(acct(u, "work")?.limits)} '${acct(u, "work")?.limits[0]?.label}'`);
  ok(acct(u, "work")?.plan === "회사 계정", `회사: 조회 전용 로그인이 없으면 요금제 대신 '회사 계정' → ${acct(u, "work")?.plan}`);
  ok(keys(u?.limits) === "week=43 week:Fable=74 work:7d=6", `계정을 나눠 받지 않는 예전 앱에는 한 목록으로 → ${keys(u?.limits)}`);

  // 2) 모델별 한도가 없는 요금제: 모든 모델만
  writeFileSync(FAKE, JSON.stringify({ limits: [weekly(12)] }));
  u = await ask();
  ok(keys(acct(u, "personal")?.limits) === "week=12", `모델별 한도가 없으면 모든 모델만 → ${keys(acct(u, "personal")?.limits)}`);

  // 3) 모델별 한도가 둘 이상이어도 모두 보낸다(어느 것을 고리에 그릴지는 앱이 고름)
  writeFileSync(FAKE, JSON.stringify({ limits: [weekly(50), weekly(30, "Opus"), weekly(91, "Fable")] }));
  u = await ask();
  ok(keys(acct(u, "personal")?.limits) === "week=50 week:Opus=30 week:Fable=91", `모델별 한도 여럿 → ${keys(acct(u, "personal")?.limits)}`);

  // 4) 5시간 한도가 예전 자리(five_hour)에만 오는 응답: 세션 한도로 앞에
  writeFileSync(FAKE, JSON.stringify({ five_hour: { utilization: 20, resets_at: RESET }, limits: [weekly(43), weekly(74, "Fable")] }));
  u = await ask();
  ok(keys(acct(u, "personal")?.limits) === "session=20 week=43 week:Fable=74" && acct(u, "personal").limits[0].session === true,
    `5시간 한도는 세션으로 → ${keys(acct(u, "personal")?.limits)}`);

  // 4-2) 추가 개인 계정(11-25): 그 계정을 쓸 때 공유 파일에 적힌 값 → 개인·추가 개인·회사 차례, 이름은 개인처럼
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-personal2": { "7d": claim(0.03) }, "anthropic-work": { "7d": claim(0.06) } }));
  u = await ask();
  ok((u?.accounts ?? []).map((a) => a.key).join(",") === "personal,personal2,work", `계정 차례: 개인·추가 개인·회사 → ${(u?.accounts ?? []).map((a) => a.key).join(",")}`);
  ok(keys(acct(u, "personal2")?.limits) === "work:7d=3" && acct(u, "personal2").limits[0].label === "주간 한도 · 모든 모델" && acct(u, "personal2").label === "추가 개인",
    `추가 개인: 공유 파일의 주간 값 → ${keys(acct(u, "personal2")?.limits)} '${acct(u, "personal2")?.limits[0]?.label}'`);

  // 5) 회사 계정의 Fable 한도: pi 로 회사 계정을 쓸 때 응답에 실려 온 값(구분 이름 oi)을 Fable 로 보낸다
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-work": { "7d": claim(0.06), "7d:oi": claim(0.31) } }));
  u = await ask();
  ok(keys(acct(u, "work")?.limits) === "work:7d=6 work:7d:Fable=31" && acct(u, "work").limits[1].label === "주간 한도 · Fable",
    `회사: Fable 한도 → ${keys(acct(u, "work")?.limits)} '${acct(u, "work")?.limits[1]?.label}'`);
  ok(!keys(acct(u, "personal")?.limits).includes("work:"), "개인 쪽에는 회사 값이 섞이지 않음");

  // 5-1) 회사 탭이 Fable 한도에 걸려 적힌 값(Claude Code 상태 줄이 대화 기록에서 읽어 적음): 100%. 풀렸다는 표시로 바뀌면 사라진다
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-work": { "7d": claim(0.11), "7d:oi": { util: 1, reset: Math.floor(now / 1000) + 86400, at: now - 3 * 3600_000, hit: true } } }));
  u = await ask();
  ok(keys(acct(u, "work")?.limits) === "work:7d=11 work:7d:Fable=100" && acct(u, "work").limits[1].label === "주간 한도 · Fable",
    `회사: 한도에 걸린 Fable 은 100% → ${keys(acct(u, "work")?.limits)}`);
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-work": { "7d": claim(0.11), "7d:oi": { at: now, ok: true } } }));
  u = await ask();
  ok(keys(acct(u, "work")?.limits) === "work:7d=11", `회사: 한도가 풀리면(리셋·초기화) 모든 모델 값만 → ${keys(acct(u, "work")?.limits)}`);

  // 6) 초기화 시각이 지난 회사 값은 보내지 않는다
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-work": { "7d": claim(0.06), "7d:oi": { util: 0.9, reset: Math.floor(now / 1000) - 60, at: now - 86400_000 } } }));
  u = await ask();
  ok(keys(acct(u, "work")?.limits) === "work:7d=6", `초기화가 지난 값은 뺌 → ${keys(acct(u, "work")?.limits)}`);

  // 7) 조회가 안 될 때(응답 파일이 없음·깨짐): 공유 파일에 적힌 개인 값으로 대신한다(모든 모델과, 적혀 있으면 Fable)
  writeFileSync(ACCOUNTS, JSON.stringify({ anthropic: { "7d": claim(0.4), "7d:fable": claim(0.7) }, "anthropic-work": { "7d": claim(0.06) } }));
  for (const [how, make] of [["없음", () => rmSync(FAKE, { force: true })], ["깨짐", () => writeFileSync(FAKE, "{ 깨진 글")]]) {
    make();
    u = await ask();
    ok(!u?.error && keys(acct(u, "personal")?.limits) === "week=40 week:Fable=70", `조회 응답 ${how}: 공유 파일의 개인 값 → ${u?.error ?? keys(acct(u, "personal")?.limits)}`);
  }

  // 7-1) 회사 계정의 조회 전용 로그인이 있을 때(시험에서는 그 조회 응답을 파일로 대신): 회사 계정도 조회한 값으로(모든 모델과 Fable %)
  writeFileSync(FAKE, JSON.stringify({ limits: [weekly(43), weekly(74, "Fable")] }));
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-work": { "7d": claim(0.06, 30) } }));   // 상태 줄이 30분 전에 적은 값
  writeFileSync(WORKFAKE, JSON.stringify({ limits: [weekly(12), weekly(55, "Fable")] }));
  u = await ask();
  ok(keys(acct(u, "work")?.limits) === "work:7d=12 work:7d:Fable=55", `회사: 조회한 값으로(모든 모델·Fable) → ${keys(acct(u, "work")?.limits)}`);
  ok(acct(u, "work")?.limits.map((l) => l.label).join(" | ") === "주간 한도 · 모든 모델 | 주간 한도 · Fable", `회사: 이름 → ${acct(u, "work")?.limits.map((l) => l.label).join(" | ")}`);
  ok(acct(u, "work")?.plan === "Claude Max 20x", `회사: 조회 전용 로그인이 있으면 요금제 이름도(개인처럼) → ${acct(u, "work")?.plan}`);
  ok(keys(acct(u, "personal")?.limits) === "week=43 week:Fable=74", "개인 계정 값은 그대로");
  const shared = JSON.parse(readFileSync(ACCOUNTS, "utf8"))["anthropic-work"];
  ok(shared["7d"].util === 0.12 && shared["7d:oi"].util === 0.55 && !("7d:fable" in shared),
    `조회한 회사 값을 공유 파일에도 적음(터미널 하단 줄·기록이 같은 값을 봄. Fable 은 응답에 실려 오는 이름으로) → ${Object.keys(shared).join()}`);
  // 회사 조회가 실패해도(응답이 깨짐) 개인 계정 값과 앞서 적힌 회사 값은 그대로 나온다
  writeFileSync(WORKFAKE, "{ 깨진 글");
  u = await ask();
  u = await ask();
  ok(keys(acct(u, "personal")?.limits) === "week=43 week:Fable=74" && keys(acct(u, "work")?.limits) === "work:7d=12 work:7d:Fable=55",
    `회사 조회가 실패해도 나머지는 그대로 → ${keys(acct(u, "work")?.limits)}`);
  ok((log.match(/회사 계정 사용량 조회 실패/g) ?? []).length === 1, `같은 실패는 기록에 한 번만 남김(${(log.match(/회사 계정 사용량 조회 실패/g) ?? []).length}번)`);
  rmSync(WORKFAKE, { force: true });

  // 7-2) 추가 개인 계정도 조회 전용 로그인이 있으면(11-25): 모든 모델과 Fable 을 따로, 요금제 이름도. 회사 값과 섞이지 않는다
  writeFileSync(ACCOUNTS, JSON.stringify({ "anthropic-personal2": { "7d": claim(0.03, 30) }, "anthropic-work": { "7d": claim(0.06) } }));
  writeFileSync(P2FAKE, JSON.stringify({ limits: [weekly(8), weekly(21, "Fable")] }));
  u = await ask();
  ok(keys(acct(u, "personal2")?.limits) === "work:7d=8 work:7d:Fable=21", `추가 개인: 조회한 값으로(모든 모델·Fable) → ${keys(acct(u, "personal2")?.limits)}`);
  ok(acct(u, "personal2")?.limits.map((l) => l.label).join(" | ") === "주간 한도 · 모든 모델 | 주간 한도 · Fable", `추가 개인: 이름 → ${acct(u, "personal2")?.limits.map((l) => l.label).join(" | ")}`);
  ok(acct(u, "personal2")?.plan === "Claude Max 5x", `추가 개인: 요금제 이름 → ${acct(u, "personal2")?.plan}`);
  ok(keys(acct(u, "work")?.limits) === "work:7d=6" && keys(acct(u, "personal")?.limits) === "week=43 week:Fable=74", "추가 개인 값이 회사·개인에 섞이지 않음");
  const p2shared = JSON.parse(readFileSync(ACCOUNTS, "utf8"))["anthropic-personal2"];
  ok(p2shared["7d"].util === 0.08 && p2shared["7d:oi"].util === 0.21, `조회한 추가 개인 값을 공유 파일의 그 칸에 적음 → ${Object.keys(p2shared).join()}`);
  // 추가 개인 조회가 실패해도 앞서 적힌 값과 다른 계정은 그대로, 기록은 한 번만
  writeFileSync(P2FAKE, "{ 깨진 글");
  u = await ask();
  u = await ask();
  ok(keys(acct(u, "personal2")?.limits) === "work:7d=8 work:7d:Fable=21" && keys(acct(u, "work")?.limits) === "work:7d=6",
    `추가 개인 조회가 실패해도 나머지는 그대로 → ${keys(acct(u, "personal2")?.limits)}`);
  ok((log.match(/추가 개인 계정 사용량 조회 실패/g) ?? []).length === 1, `같은 실패는 기록에 한 번만 남김(${(log.match(/추가 개인 계정 사용량 조회 실패/g) ?? []).length}번)`);
  rmSync(P2FAKE, { force: true });

  // 8) 아무 값도 없으면 안내 글(계정 카드는 보내지 않음)
  rmSync(FAKE, { force: true });
  rmSync(ACCOUNTS, { force: true });
  u = await ask();
  ok(typeof u?.error === "string" && u.error.length > 0 && !u.accounts, `값이 하나도 없으면 안내 글만 → ${u?.error}`);
  ok(exited === null, "브리지가 계속 살아 있음");
  ws.close();
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  bridge.kill("SIGTERM");
  await sleep(500);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
