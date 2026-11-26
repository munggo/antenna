// 사용량 기록(주간 그래프): 브리지가 10분마다 받은 사용량을 쌓고(15일치), 하루 사용량 요약을 만든다.
// 터미널 하단 줄·/usage 는 요약·기록 파일을 읽고, 앱은 usage 응답에 실린 기록을 그린다.
// 기록 폴더: PI_REMOTE_USAGE_DIR(시험용) 또는 ~/.cache/pi-remote
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const DIR = process.env.PI_REMOTE_USAGE_DIR || `${process.env.HOME}/.cache/pi-remote`;
const USAGE_HISTORY = `${DIR}/usage-history.jsonl`;
const USAGE_SUMMARY = `${DIR}/usage-summary.json`;
const USAGE_KEEP_MS = 15 * 24 * 3600_000;


export function readUsageHistory(sinceMs = 0) {
  try {
    return readFileSync(USAGE_HISTORY, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((x) => x.t >= sinceMs);
  } catch {
    return [];
  }
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 하루 사용량(주간 한도 대비 %p, 최근 days 일): 이웃한 기록 사이에 늘어난 만큼을 뒤 기록의 날짜에 더한다.
 *  줄었으면 주간 초기화 → 초기화 뒤 쓴 만큼(뒤 기록 값)만 더한다 */
export function dailyUsage(samples, days = 7, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push({ date: ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)), used: 0 });
  const idx = new Map(out.map((x, i) => [x.date, i]));
  const valid = samples.filter((x) => typeof x.w === "number"); // 값이 빈 기록은 건너뛰고 앞의 값 있는 기록과 비교
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1].w;
    const b = valid[i].w;
    const k = idx.get(ymd(new Date(valid[i].t)));
    if (k !== undefined) out[k].used += b >= a ? b - a : b;
  }
  return out.map((x) => ({ ...x, used: Math.round(x.used * 10) / 10 }));
}

export function recordUsage(data) {
  if (!data || data.error || !Array.isArray(data.limits)) return;
  const s = data.limits.find((l) => l.key === "session");
  const w = data.limits.find((l) => l.key === "week");
  if (!s && !w) return;
  // src: 개인 계정 사용량 조회로 얻은 값(api)인지, 조회가 안 돼 공유 파일 값으로 대신한 것(shared)인지
  const sample = { t: Date.now(), s: s?.percent ?? null, w: w?.percent ?? null, sr: s?.resetsAt ?? null, wr: w?.resetsAt ?? null, src: data.source === "shared" ? "shared" : "api" };
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(USAGE_HISTORY, `${JSON.stringify(sample)}\n`);
    // 15일 넘은 기록은 정리(파일이 하루치 이상 커졌을 때만 다시 씀)
    const all = readUsageHistory(0);
    const kept = all.filter((x) => x.t >= Date.now() - USAGE_KEEP_MS);
    if (all.length - kept.length > 144) writeFileSync(USAGE_HISTORY, kept.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const summary = {
      at: sample.t,
      week: sample.w,
      weekResetsAt: sample.wr,
      session: sample.s,
      sessionResetsAt: sample.sr,
      daily: dailyUsage(readUsageHistory(Date.now() - 8 * 86400_000)),
    };
    writeFileSync(USAGE_SUMMARY, JSON.stringify(summary));
  } catch (e) {
    console.warn(`[pi-remote] 사용량 기록 실패: ${e.message}`);
  }
}

// --- 회사 계정(claude-accounts): 사용량 API 권한이 없어 응답 헤더로 모인 값(공유 파일)을 갱신될 때만 쌓음 ---
const WORK_HISTORY = `${DIR}/usage-history-work.jsonl`;
// 토큰으로 쓰는 계정(사용량 API 를 못 씀)마다 공유 파일 값을 쌓는 기록: 회사, 추가 개인(11-25)
const HISTORY_FILES = { "anthropic-work": WORK_HISTORY, "anthropic-personal2": `${DIR}/usage-history-personal2.jsonl` };
const WORK_SUMMARY = `${DIR}/usage-summary-work.json`;   // 터미널 하단 줄의 회사 계정 막대그래프용
const ACCOUNTS_FILE = process.env.PI_ACCOUNTS_CACHE || `${process.env.HOME}/.cache/pi-remote/claude-accounts.json`;

/**
 * 공유 파일에서 Fable 전용 주간 한도를 가리키는 구분들. 이름은 달라도 모두 같은 한도다:
 *   oi               응답 헤더 anthropic-ratelimit-unified-7d_oi-*(seven_day_overage_included. Claude Code 화면에는 'Fable limit')
 *   overage_included pi 확장이 한도 오류 때 적는 이름(헤더의 대표 한도 이름에서)
 *   fable            pi 확장이 사용량 조회 결과로 적는 이름
 * 11-18 까지 oi 를 뜻 모를 모델 이름으로 다뤄 화면에 '주간 한도 · Oi'로 나왔다
 */
const FABLE_SCOPES = new Set(["oi", "overage_included", "fable"]);

/**
 * 공유 파일(claude-accounts.json)에 적힌 계정의 사용률 → 한도 목록.
 * 이 파일은 pi 확장(응답에 실려 온 값)과 Claude Code 상태 줄(Claude Code 가 넘겨 준 5시간·주간 사용률, 대화 기록에 남은 한도 오류)이 함께 쓴다:
 *   { "<계정>": { "5h" | "7d" | "7d:<구분>": { util: 0~1, reset: 초, at: 적은 시각(ms), hit?: 한도에 걸려 적힌 값 } } }
 * 초기화 시각이 지난 값과 사용률이 없는 값(한도가 풀렸다는 표시)은 뺀다. 10분 넘게 지난 값은 이름 뒤에 '(N분 전 기준)'을 붙인다
 * (한도에 걸려 적힌 값은 초기화 때까지 그대로라 붙이지 않는다).
 * personal 이 참이면 사용량 조회 결과와 같은 구분(session | week | week:Fable)과 이름으로(pi 로그인 없이도 개인 계정을 보여 줄 때).
 *   Fable 말고 다른 구분은 뺀다: 무엇의 한도인지 알 수 없다
 * 아니면 회사 계정 표시(work:…, '회사 계정 · …')로 만든다
 */
export function sharedLimits(provider, personal, now = Date.now(), file = ACCOUNTS_FILE) {
  let claims;
  try {
    claims = JSON.parse(readFileSync(file, "utf8"))[provider] ?? {};
  } catch {
    return [];   // 아직 아무것도 적히지 않음
  }
  const out = [];
  const ageOf = (c) => {
    const ageMin = Math.round((now - (c.at ?? now)) / 60_000);
    return ageMin >= 10 && !c.hit ? ` (${ageMin >= 120 ? `${Math.round(ageMin / 60)}시간` : `${ageMin}분`} 전 기준)` : "";
  };
  const commonOf = (c, base) => ({ percent: Math.round(c.util * 1000) / 10, resetsAt: c.reset ? new Date(c.reset * 1000).toISOString() : null, session: base === "5h", severity: "normal" });
  let fable = null;   // Fable 한도는 구분이 여럿이라 가장 최근에 적힌 값 하나만
  for (const [k, c] of Object.entries(claims)) {
    if (!c || typeof c.util !== "number" || (c.reset && c.reset * 1000 <= now)) continue;
    const [base, model] = k.split(":");
    if (base !== "5h" && base !== "7d") continue;
    if (base === "7d" && FABLE_SCOPES.has(model)) {
      if (!fable || (c.at ?? 0) > (fable.at ?? 0)) fable = c;
      continue;
    }
    const modelName = model ? `${model[0].toUpperCase()}${model.slice(1)}` : "";
    const age = ageOf(c), common = commonOf(c, base);
    if (personal) {
      if (model) continue;
      out.push({ key: base === "5h" ? "session" : "week", label: `${base === "5h" ? "현재 세션 (5시간)" : "주간 한도 · 모든 모델"}${age}`, ...common });
    } else {
      const name = base === "7d" ? (modelName ? `주간 한도 · ${modelName}` : "주간 한도") : "현재 세션 (5시간)";
      out.push({ key: `work:${k}`, label: `회사 계정 · ${name}${age}`, ...common });
    }
  }
  // 개인 계정은 사용량 조회 결과와 같은 차례로: 세션, 주간, 모델별
  if (personal) out.sort((a, b) => (a.key === "session" ? 0 : 1) - (b.key === "session" ? 0 : 1));
  if (fable) {
    out.push(personal
      ? { key: "week:Fable", label: `주간 한도 · Fable${ageOf(fable)}`, ...commonOf(fable, "7d") }
      : { key: "work:7d:Fable", label: `회사 계정 · 주간 한도 · Fable${ageOf(fable)}`, ...commonOf(fable, "7d") });
  }
  return out;
}

/**
 * 사용량 조회 응답 → 공유 파일에 적을 값들({ "5h" | "7d" | "7d:<구분>": { util, reset, at } }).
 * Fable 전용 주간 한도는 응답 헤더와 같은 구분 이름(7d:oi)으로 적는다(화면에는 Fable 로 보임). 계정 자동 전환 판단
 * (claude-account.mjs·pi 확장의 SCOPE_MODEL)은 oi 를 Fable 한도로 보아, Fable 을 쓰는 탭은 이 값이 95%를 넘으면 다른 계정으로 넘어간다(11-21)
 */
export function claimsFromUsage(u, now = Date.now()) {
  const out = {};
  const sec = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) || undefined : undefined);
  for (const l of Array.isArray(u?.limits) ? u.limits : []) {
    if (typeof l?.percent !== "number") continue;
    const model = String(l?.scope?.model?.display_name ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    const base = l.group === "weekly" ? "7d" : "5h";
    out[model ? `${base}:${model === "fable" ? "oi" : model}` : base] = { util: l.percent / 100, reset: sec(l.resets_at), at: now };
  }
  if (!out["5h"] && typeof u?.five_hour?.utilization === "number") {
    out["5h"] = { util: u.five_hour.utilization / 100, reset: sec(u.five_hour.resets_at), at: now };
  }
  return out;
}

/** 공유 파일의 그 계정 칸에 값을 적는다(다른 칸·다른 구분은 그대로, 통째로 바꿔 씀). 적었으면 참 */
export function recordSharedClaims(provider, claims, file = ACCOUNTS_FILE) {
  if (!claims || !Object.keys(claims).length) return false;
  let all = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {
    /* 아직 없거나 깨짐: 새로 씀 */
  }
  all[provider] = { ...(all[provider] ?? {}), ...claims };
  try {
    mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, file);
    return true;
  } catch (e) {
    console.warn(`[pi-remote] 공유 사용량 파일에 적지 못함: ${e.message}`);
    return false;
  }
}

/**
 * 개인·회사 계정이 섞였는지: 개인 칸에 적힌 주간 값이 회사 계정의 것으로 보이면 참.
 * 두 계정은 주간 한도가 따로라 사용률과 초기화 시각이 서로 다르다. 둘 다 최근(fresh 안)에 적혔는데 사용률과 초기화 시각이
 * 같으면 개인 탭이 회사 계정으로 돌고 있다는 뜻이다(이 맥의 Claude Code 기본 로그인이 회사 계정으로 바뀐 경우. 2026-11-13).
 * 계정을 하나만 쓰면 회사 칸이 없어 늘 거짓. 비밀값은 보지 않는다(사용률 숫자만)
 */
export function accountsMixed(now = Date.now(), file = ACCOUNTS_FILE, freshMs = 30 * 60_000) {
  return accountsState(now, file, freshMs) === "mixed";
}

/**
 * 개인·회사 계정 상태: "mixed"(두 칸에 같은 계정 값) | "separate"(둘 다 최근 값이고 서로 다름) |
 * "unknown"(한쪽 값이 오래됐거나 없음: 계정을 하나만 쓰거나, 한쪽 탭이 한동안 쉼). 알 수 없을 때를 '따로 돎'으로 보면
 * 쉬는 동안 풀린 것으로 잘못 알고 같은 알림을 되풀이한다(11-13 저녁)
 */
export function accountsState(now = Date.now(), file = ACCOUNTS_FILE, freshMs = 30 * 60_000) {
  let all;
  try {
    all = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "unknown";
  }
  const p = all?.anthropic?.["7d"], w = all?.["anthropic-work"]?.["7d"];
  const fresh = (c) => Boolean(c) && typeof c.util === "number" && Number.isFinite(c.at) && now - c.at < freshMs && Number(c.reset) * 1000 > now;
  if (!fresh(p) || !fresh(w)) return "unknown";
  return Math.abs(p.util - w.util) < 0.0005 && p.reset === w.reset ? "mixed" : "separate";
}

/**
 * 섞였을 때 어느 쪽이 다른 계정으로 도는지: 두 칸에 같이 적힌 값이 개인 계정의 것인지를 개인 계정 사용량 조회 기록(api)과 견준다.
 * → "work-on-personal": 회사 탭이 개인 계정으로(회사 탭에서 /login 을 하면 그 탭이 공유 로그인을 씀)
 *   "personal-on-work": 개인 탭이 회사 계정으로(이 맥의 공유 로그인이 회사 계정으로 바뀜)
 *   null: 개인 계정 조회 기록이 없어 모름(pi 를 안 쓰는 맥 등)
 */
export function mixedDirection(now = Date.now(), file = ACCOUNTS_FILE) {
  let p;
  try {
    p = JSON.parse(readFileSync(file, "utf8"))?.anthropic?.["7d"];
  } catch {
    return null;
  }
  if (!p?.reset) return null;
  const rec = readUsageHistory(now - 60 * 60_000).filter((r) => r.src === "api" && r.wr).at(-1);
  if (!rec) return null;
  return Math.abs(Date.parse(rec.wr) / 1000 - p.reset) < 120 ? "work-on-personal" : "personal-on-work";
}

/** 섞였을 때 폰 알림·점검 명령에 쓸 글 */
export const MIXED_TEXT = {
  "work-on-personal": {
    title: "회사 탭이 개인 계정으로 돌고 있어요",
    body: "회사 탭에서 /login 을 하면 그 탭은 회사 토큰 대신 이 맥의 공유 로그인을 써요. 그 회사 탭을 같은 대화로 다시 켜 주세요(/exit 뒤 claude --continue)",
  },
  "personal-on-work": {
    title: "개인 탭이 회사 계정으로 돌고 있어요",
    body: "이 맥의 Claude Code 로그인이 회사 계정으로 바뀌었어요. 개인 탭에서 /login 으로 개인 계정에 다시 로그인해 주세요(회사 탭에서는 /login 하지 마세요)",
  },
  unknown: {
    title: "개인·회사 계정이 섞였어요",
    body: "한쪽 탭이 다른 계정으로 돌고 있어요. 회사 탭에서 /login 을 했다면 그 탭을 같은 대화로 다시 켜고, 이 맥의 로그인이 회사 계정이면 개인 탭에서 /login 으로 개인 계정에 다시 로그인해 주세요",
  },
};

/** 그 계정(공유 파일 이름, 기본 회사)의 쌓인 기록 */
export function readWorkHistory(sinceMs = 0, provider = "anthropic-work") {
  try {
    return readFileSync(HISTORY_FILES[provider], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.t >= sinceMs);
  } catch {
    return [];
  }
}

/** 공유 파일의 그 계정(기본 회사) 주간 값이 새로 갱신됐으면 기록(시각은 값이 갱신된 때). 회사는 요약 파일도 매번(날짜가 바뀌어도 막대가 맞게) */
export function recordWorkUsage(provider = "anthropic-work") {
  const file = HISTORY_FILES[provider];
  try {
    const claims = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"))[provider] ?? {};
    const w = claims["7d"];
    const all = readWorkHistory(0, provider);
    if (file && w && typeof w.util === "number" && w.at && !(all.length && all[all.length - 1].t >= w.at)) {
      const s = claims["5h"];
      const sample = { t: w.at, w: Math.round(w.util * 1000) / 10, wr: w.reset ? new Date(w.reset * 1000).toISOString() : null,
        s: s && typeof s.util === "number" ? Math.round(s.util * 1000) / 10 : null };
      mkdirSync(DIR, { recursive: true });
      appendFileSync(file, `${JSON.stringify(sample)}\n`);
      const kept = all.filter((x) => x.t >= Date.now() - USAGE_KEEP_MS);
      if (all.length - kept.length > 144) writeFileSync(file, [...kept, sample].map((x) => JSON.stringify(x)).join("\n") + "\n");
    }
  } catch {
    /* 그 계정을 아직 안 씀 */
  }
  if (provider === "anthropic-work") writeWorkSummary();
}

/** 회사 계정 요약(터미널 하단 줄): 쓴 시각, 마지막 주간 값, 최근 7일 하루 사용량. 최근 8일 기록이 없으면 쓰지 않음 */
function writeWorkSummary(now = Date.now()) {
  try {
    const samples = readWorkHistory(now - 8 * 86400_000);
    if (!samples.length) return;
    const last = samples[samples.length - 1];
    const summary = { at: now, updatedAt: last.t, week: last.w, weekResetsAt: last.wr ?? null, daily: dailyUsage(samples, 7, new Date(now)) };
    mkdirSync(DIR, { recursive: true });
    const tmp = `${WORK_SUMMARY}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(summary));
    renameSync(tmp, WORK_SUMMARY);
  } catch (e) {
    console.warn(`[pi-remote] 회사 사용량 요약 실패: ${e.message}`);
  }
}

/** 그 계정(기본 회사) 기록(앱용): 최근 8일 [시각, 세션%, 주간%], 하루 사용량, 마지막 갱신 시각 */
export function workUsageForApp(provider = "anthropic-work") {
  const samples = readWorkHistory(Date.now() - 8 * 86400_000, provider);
  const out = [];
  let last = 0;
  for (const x of samples) {
    if (x.t - last < 19 * 60_000) continue;
    out.push([x.t, x.s ?? null, x.w]);
    last = x.t;
  }
  return { history: out, daily: dailyUsage(samples), updatedAt: samples.length ? samples[samples.length - 1].t : null };
}

/** 앱에 보낼 기록: 최근 8일, 20분에 하나 정도로 줄여서 [시각, 세션%, 주간%] */
export function usageHistoryForApp() {
  const out = [];
  let last = 0;
  for (const x of readUsageHistory(Date.now() - 8 * 86400_000)) {
    if (x.t - last < 19 * 60_000) continue;
    out.push([x.t, x.s, x.w]);
    last = x.t;
  }
  return out;
}
