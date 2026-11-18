// 사용량 기록 시험: node server/test/usage-history.test.mjs (임시 폴더에서)
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(`${tmpdir()}/usage-`);
process.env.PI_REMOTE_USAGE_DIR = dir;
process.env.PI_ACCOUNTS_CACHE = `${dir}/claude-accounts.json`;
const m = await import("../usage-history.mjs");
let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };

// 1. 하루 사용량: 오늘을 11/11 로 두고 7일(11/05~11/11)
const now = new Date(2026, 10, 11, 15, 0);
const at = (d, h, mi = 0) => new Date(2026, 10, d, h, mi).getTime();
const samples = [
  { t: at(4, 23), w: 10 },   // 7일 밖(시작점으로만 씀)
  { t: at(5, 9), w: 12 },    // 11/05 +2
  { t: at(5, 18), w: 20 },   // 11/05 +8
  { t: at(6, 23, 59), w: 25 }, // 11/06 +5
  { t: at(7, 0, 1), w: 26 }, // 11/07 +1(날짜 경계)
  { t: at(9, 16, 10), w: 3 }, // 11/09 주간 초기화(26→3): 초기화 뒤 3만
  { t: at(9, 20), w: null }, // 값 없음 → 건너뜀
  { t: at(10, 10), w: 9 },   // 11/10: 빈 기록을 건너뛰고 앞의 3 과 비교 → +6
  { t: at(11, 14), w: 15.25 }, // 11/11 +6.25 → 6.3(반올림)
];
const d = m.dailyUsage(samples, 7, now);
const byDate = Object.fromEntries(d.map((x) => [x.date, x.used]));
ok(d.length === 7 && d[0].date === "2026-11-05" && d[6].date === "2026-11-11", "최근 7일(11/05~11/11)");
ok(byDate["2026-11-05"] === 10, "11/05: 7일 밖 기록에서 이어진 +2 와 +8");
ok(byDate["2026-11-06"] === 5 && byDate["2026-11-07"] === 1, "날짜 경계: 23:59 는 앞날, 00:01 은 뒷날");
ok(byDate["2026-11-08"] === 0, "기록 없는 날은 0");
ok(byDate["2026-11-09"] === 3, "주간 초기화로 줄면 초기화 뒤 사용량만");
ok(byDate["2026-11-10"] === 6, "값이 빈 기록은 건너뛰고 앞의 값 있는 기록과 비교");
ok(byDate["2026-11-11"] === 6.3, "소수 첫째 자리 반올림");

// 2. 기록·요약 파일
m.recordUsage({ limits: [{ key: "session", percent: 23, resetsAt: "s" }, { key: "week", percent: 51, resetsAt: "w" }, { key: "week:Opus", percent: 70 }] });
m.recordUsage({ error: "로그인 만료" });   // 오류는 기록하지 않음
m.recordUsage({ limits: [{ key: "week:Opus", percent: 70 }] }); // 세션·주간 없으면 기록하지 않음
const hist = readFileSync(`${dir}/usage-history.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(hist.length === 1 && hist[0].s === 23 && hist[0].w === 51 && hist[0].wr === "w", "기록: 세션·주간 %와 초기화 시각, 오류·빈 값은 건너뜀");
const sum = JSON.parse(readFileSync(`${dir}/usage-summary.json`, "utf8"));
ok(sum.week === 51 && sum.session === 23 && Array.isArray(sum.daily) && sum.daily.length === 7, "요약: 지금 주간·세션 %와 7일 하루 사용량");

// 3. 앱용: 20분 간격으로 줄이기
const base = Date.now() - 3 * 3600_000;
writeFileSync(`${dir}/usage-history.jsonl`, Array.from({ length: 18 }, (_, i) => JSON.stringify({ t: base + i * 10 * 60_000, s: i, w: i })).join("\n") + "\n");
const app = m.usageHistoryForApp();
ok(app.length === 9 && app[1][0] - app[0][0] >= 19 * 60_000 && app[0].length === 3, `앱용: 10분 기록 18개 → 20분 간격 9개([시각, 세션, 주간])`);

// 4. 15일 넘은 기록 정리(오래된 것이 하루치 넘게 쌓이면)
const old = Array.from({ length: 150 }, (_, i) => JSON.stringify({ t: Date.now() - 20 * 86400_000 + i, s: 1, w: 1 }));
writeFileSync(`${dir}/usage-history.jsonl`, old.join("\n") + "\n");
m.recordUsage({ limits: [{ key: "week", percent: 5 }] });
const after = readFileSync(`${dir}/usage-history.jsonl`, "utf8").trim().split("\n");
ok(after.length === 1 && JSON.parse(after[0]).w === 5, "15일 넘은 기록 150개는 정리하고 새 기록만 남음");

// 회사 계정 요약(터미널 하단 줄 막대): usage-summary-work.json
{
  const SUM = `${dir}/usage-summary-work.json`;
  const ACC = `${dir}/claude-accounts.json`;
  const readSum = () => { try { return JSON.parse(readFileSync(SUM, "utf8")); } catch { return null; } };
  const setWork = (util, atMs) => writeFileSync(ACC, JSON.stringify({ anthropic: { "7d": { util: 0.9, at: atMs } }, "anthropic-work": { "7d": { util, reset: Math.floor(Date.now() / 1000) + 86400, at: atMs } } }));
  // 기록 없음 → 요약 안 씀
  m.recordWorkUsage();
  ok(readSum() === null, "회사 기록이 없으면 요약을 쓰지 않음");
  // 어제·오늘 값 → 하루 사용량
  const t0 = Date.now();
  const yest = new Date(); yest.setDate(yest.getDate() - 1); yest.setHours(15, 0, 0, 0);
  setWork(0.03, yest.getTime()); m.recordWorkUsage();
  setWork(0.05, yest.getTime() + 3600_000); m.recordWorkUsage();
  setWork(0.08, t0 - 60_000); m.recordWorkUsage();
  let s1 = readSum();
  ok(s1 && s1.week === 8 && s1.daily.length === 7, `요약: 주간 8%, 7일(${JSON.stringify(s1?.daily?.map((d) => d.used))})`);
  ok(s1.daily[5].used === 2 && s1.daily[6].used === 3, "어제 +2, 오늘 +3");
  ok(Math.abs(s1.at - Date.now()) < 5000 && s1.updatedAt === t0 - 60_000, "쓴 시각은 지금, 갱신 시각은 마지막 값");
  // 새 값 없이 다시 → 기록은 그대로, 요약은 다시 씀(쓴 시각 갱신)
  const lines = readFileSync(`${dir}/usage-history-work.jsonl`, "utf8").trim().split("\n").length;
  writeFileSync(SUM, JSON.stringify({ ...s1, at: 1 }));
  m.recordWorkUsage();
  ok(readFileSync(`${dir}/usage-history-work.jsonl`, "utf8").trim().split("\n").length === lines, "새 값이 없으면 기록을 더하지 않음");
  ok(readSum().at > 1, "새 값이 없어도 요약은 다시 씀(날짜가 바뀌어도 막대가 맞게)");
  // 공유 파일이 깨져도 요약은 씀
  writeFileSync(ACC, "{깨짐");
  writeFileSync(SUM, JSON.stringify({ ...s1, at: 1 }));
  m.recordWorkUsage();
  ok(readSum().at > 1 && readSum().week === 8, "공유 파일이 깨져도 기록으로 요약을 씀");
}

// 공유 파일의 값 → 한도 목록(pi 로그인 없이 Claude Code 상태 줄이 적은 값만으로 사용량을 보여 줄 때)
{
  const F = `${dir}/shared.json`;
  const T = new Date(2026, 10, 13, 12, 0).getTime();
  const sec = (ms) => Math.round(ms / 1000);
  writeFileSync(F, JSON.stringify({
    anthropic: {
      "7d:fable": { util: 0.105, reset: sec(T + 86400_000), at: T - 60_000 },
      "7d": { util: 0.42, reset: sec(T + 3 * 86400_000), at: T - 25 * 60_000 },
      "5h": { util: 0.07, reset: sec(T + 3600_000), at: T - 60_000 },
      "7d:old": { util: 0.9, reset: sec(T - 1000), at: T - 86400_000 },   // 초기화가 지난 값
      "1h": { util: 0.5, reset: sec(T + 1000), at: T },                    // 모르는 구분
      "bad": "x",
    },
    "anthropic-work": { "7d": { util: 0.633, reset: sec(T + 86400_000), at: T - 3 * 3600_000 } },
  }));
  const p = m.sharedLimits("anthropic", true, T, F);
  ok(p.map((l) => l.key).join() === "session,week,week:Fable", `개인: 세션·주간·Fable 차례, 지난 값·모르는 구분은 뺌 → ${p.map((l) => l.key).join()}`);
  ok(p[0].percent === 7 && p[0].session === true && p[0].label === "현재 세션 (5시간)", "개인: 세션 값과 이름(방금 값이면 기준 시각 표시 없음)");
  ok(p[1].percent === 42 && p[1].label === "주간 한도 · 모든 모델 (25분 전 기준)" && p[1].resetsAt === new Date(T + 3 * 86400_000).toISOString(), `개인: 주간 값·초기화 시각, 오래된 값은 기준 시각 표시 → ${p[1].label}`);
  ok(p[2].percent === 10.5 && p[2].label === "주간 한도 · Fable" && p[2].session === false, `개인: Fable 한도는 사용량 조회 결과와 같은 구분·이름 → ${p[2].label} ${p[2].percent}`);
  const w = m.sharedLimits("anthropic-work", false, T, F);
  ok(w.length === 1 && w[0].key === "work:7d" && w[0].label === "회사 계정 · 주간 한도 (3시간 전 기준)" && w[0].percent === 63.3, `회사: 예전과 같은 구분·이름 → ${w[0]?.label}`);
  ok(m.sharedLimits("anthropic", true, T, `${dir}/none.json`).length === 0 && m.sharedLimits("nobody", true, T, F).length === 0, "파일이나 계정이 없으면 빈 목록");

  // Fable 한도는 적는 쪽마다 이름이 다르다(응답 헤더 oi · pi 의 한도 오류 overage_included · pi 의 조회 fable): 같은 한도라 가장 최근 값 하나만, 이름은 Fable
  const keys = (l) => l.map((x) => `${x.key}=${x.percent}`).join(" ");
  const fableOf = (claims, personal = false) => {
    writeFileSync(F, JSON.stringify({ [personal ? "anthropic" : "anthropic-work"]: { "7d": { util: 0.11, reset: sec(T + 86400_000), at: T }, ...claims } }));
    return m.sharedLimits(personal ? "anthropic" : "anthropic-work", personal, T, F);
  };
  const c = (util, agoMin, extra = {}) => ({ util, reset: sec(T + 86400_000), at: T - agoMin * 60_000, ...extra });
  let f = fableOf({ "7d:oi": c(0.31, 2) });
  ok(keys(f) === "work:7d=11 work:7d:Fable=31" && f[1].label === "회사 계정 · 주간 한도 · Fable", `회사: 응답에 실려 온 oi 는 Fable 한도 → ${keys(f)} '${f[1]?.label}'`);
  f = fableOf({ "7d:oi": c(0.31, 30), "7d:fable": c(0.4, 5), "7d:overage_included": c(1, 50) });
  ok(keys(f) === "work:7d=11 work:7d:Fable=40", `이름이 여럿이면 가장 최근에 적힌 값 하나 → ${keys(f)}`);
  f = fableOf({ "7d:oi": c(1, 200, { hit: true }) });
  ok(keys(f) === "work:7d=11 work:7d:Fable=100" && f[1].label === "회사 계정 · 주간 한도 · Fable", `한도에 걸려 적힌 값은 100%, 오래돼도 '전 기준'을 붙이지 않음 → '${f[1]?.label}'`);
  f = fableOf({ "7d:oi": { at: T - 60_000, ok: true } });
  ok(keys(f) === "work:7d=11", `한도가 풀렸다는 표시(사용률 없음)는 내보내지 않음 → ${keys(f)}`);
  f = fableOf({ "7d:oi": { util: 1, reset: sec(T - 60), at: T - 86400_000, hit: true } });
  ok(keys(f) === "work:7d=11", `초기화 시각이 지난 한도 오류는 내보내지 않음 → ${keys(f)}`);
  f = fableOf({ "7d:opus": c(0.2, 1), "7d:oi": c(0.31, 1) });
  ok(keys(f) === "work:7d=11 work:7d:opus=20 work:7d:Fable=31" && f[1].label === "회사 계정 · 주간 한도 · Opus", `회사: 다른 구분은 전처럼 그 이름으로 → ${keys(f)}`);
  f = fableOf({ "7d:opus": c(0.2, 1), "7d:oi": c(1, 1, { hit: true }) }, true);
  ok(keys(f) === "week=11 week:Fable=100", `개인: Fable 만 보태고 다른 구분은 뺌 → ${keys(f)}`);
  // 개인 값은 사용량 기록(session·week)에 그대로 쌓인다 → pi 없이도 주간 그래프가 이어짐
  const before = m.readUsageHistory(0).length;
  m.recordUsage({ limits: p });
  const last = m.readUsageHistory(0).at(-1);
  ok(m.readUsageHistory(0).length === before + 1 && last.s === 7 && last.w === 42, "공유 값으로 만든 사용량도 기록에 쌓임");
}

// 개인·회사 계정이 섞였는지(개인 탭이 회사 계정으로 돎): 개인 칸의 주간 값이 회사 칸과 같은 계정의 것인지
{
  const F = `${dir}/mixed.json`;
  const T = Date.UTC(2026, 10, 13, 10, 5);
  const wk = (util, reset, agoMin = 1) => ({ util, reset, at: T - agoMin * 60_000 });
  const R1 = T / 1000 + 6 * 86400, R2 = T / 1000 + 3 * 86400;   // 두 계정의 서로 다른 초기화 시각
  const mixed = (o) => { writeFileSync(F, JSON.stringify(o)); return m.accountsMixed(T, F); };
  ok(mixed({ anthropic: { "7d": wk(0.31, R1) }, "anthropic-work": { "7d": wk(0.31, R1, 5) } }) === true, "섞임: 개인 칸과 회사 칸의 주간 사용률·초기화 시각이 같음(11-13 저녁의 모양)");
  ok(mixed({ anthropic: { "7d": wk(0.58, R2) }, "anthropic-work": { "7d": wk(0.31, R1) } }) === false, "따로 돎: 사용률·초기화 시각이 다름(지금 모양)");
  ok(mixed({ anthropic: { "7d": wk(0.31, R2) }, "anthropic-work": { "7d": wk(0.31, R1) } }) === false, "사용률만 우연히 같고 초기화 시각이 다르면 따로 도는 것");
  ok(mixed({ anthropic: { "7d": wk(0.31, R1, 45) }, "anthropic-work": { "7d": wk(0.31, R1) } }) === false, "한쪽 값이 30분보다 오래됐으면 판정하지 않음(예전에 섞였던 값)");
  ok(mixed({ anthropic: { "7d": wk(0.31, T / 1000 - 60) }, "anthropic-work": { "7d": wk(0.31, T / 1000 - 60) } }) === false, "초기화 시각이 지난 값은 판정하지 않음");
  ok(mixed({ anthropic: { "7d": wk(0.4, R1) } }) === false && mixed({}) === false, "계정을 하나만 쓰면(회사 칸 없음) 늘 따로");
  writeFileSync(F, "{깨짐");
  ok(m.accountsMixed(T, F) === false && m.accountsMixed(T, `${dir}/없는-파일.json`) === false, "파일이 깨졌거나 없으면 거짓(죽지 않음)");
  // 세 가지 상태: 풀린 것이 확인될 때만 'separate'(한쪽이 오래되면 'unknown' 이라 알린 기록을 지우지 않음)
  const state = (o) => { writeFileSync(F, JSON.stringify(o)); return m.accountsState(T, F); };
  ok(state({ anthropic: { "7d": wk(0.31, R1) }, "anthropic-work": { "7d": wk(0.31, R1, 5) } }) === "mixed", "상태: 섞임");
  ok(state({ anthropic: { "7d": wk(0.58, R2) }, "anthropic-work": { "7d": wk(0.31, R1) } }) === "separate", "상태: 둘 다 최근 값이고 다르면 따로 돎");
  ok(state({ anthropic: { "7d": wk(0.58, R2) }, "anthropic-work": { "7d": wk(0.58, R2, 45) } }) === "unknown", "상태: 한쪽 탭이 30분 넘게 쉬면 모름(풀린 것으로 보지 않음)");
  ok(state({ anthropic: { "7d": wk(0.4, R1) } }) === "unknown" && m.accountsState(T, `${dir}/없는-파일.json`) === "unknown", "상태: 계정을 하나만 쓰거나 파일이 없으면 모름");

  // 어느 쪽인지: 두 칸의 같은 값이 개인 계정 것인지 개인 계정 조회 기록(api)과 견줌
  const N = Date.now();
  const PR = Math.floor(N / 1000) + 3 * 86400, WR = Math.floor(N / 1000) + 6 * 86400;   // 개인·회사 초기화 시각
  const hist = (src, resetSec) => appendFileSync(`${dir}/usage-history.jsonl`, `${JSON.stringify({ t: Date.now(), s: null, w: 59, sr: null, wr: new Date(resetSec * 1000 - 1500).toISOString(), src })}\n`);
  writeFileSync(F, JSON.stringify({ anthropic: { "7d": wk(0.59, PR) }, "anthropic-work": { "7d": wk(0.59, PR) } }));
  hist("api", PR);
  ok(m.mixedDirection(Date.now(), F) === "work-on-personal", "같은 값이 개인 계정 것이면: 회사 탭이 개인 계정으로(초기화 시각이 1~2초 달라도 같은 것으로)");
  writeFileSync(F, JSON.stringify({ anthropic: { "7d": wk(0.31, WR) }, "anthropic-work": { "7d": wk(0.31, WR) } }));
  ok(m.mixedDirection(Date.now(), F) === "personal-on-work", "같은 값이 개인 계정 것이 아니면: 개인 탭이 회사 계정으로");
  hist("shared", WR);
  ok(m.mixedDirection(Date.now(), F) === "personal-on-work", "공유 파일로 대신한 기록(shared)은 판정에 쓰지 않음");
  ok(m.mixedDirection(Date.now() + 2 * 3600_000, F) === null, "1시간 안의 개인 계정 조회 기록이 없으면 모름");
  ok(Object.values(m.MIXED_TEXT).every((t) => t.title && t.body), "알림 글: 세 경우 모두 제목·본문");
}

rmSync(dir, { recursive: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
