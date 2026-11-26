/**
 * 두 Claude 구독 계정을 폴더별로 나눠 쓰고, 한도가 차면 서로 대체한다.
 *
 * - 개인: pi 기본 Anthropic 로그인(anthropic). 회사: anthropic-work 공급자
 *   (auth.json 의 api_key 가 키체인을 읽는 명령. 회사 토큰은 `claude setup-token` 으로 만든 장기 토큰)
 * - 가상 모델 claude/<모델 id>: 요청마다 계정을 고른다
 *   - 기본 계정: 회사 폴더(~/.config/pi-remote/work-dirs 에 적은 폴더) 아래는 회사, 나머지는 개인.
 *     그 파일이 없으면 어디서나 개인 계정
 *   - 한도가 차도 저절로 바꾸지 않는다(사용자 결정 11-24). 지금 계정의 전체 한도(5시간·주간, 모든 모델)가 95% 이상이면
 *     요청을 보내기 전에 멈추고 묻는다(그대로 / 다른 계정으로). 선택 창은 pi-remote-feed 가 폰 카드로 넘긴다.
 *     그대로를 고르면 한도에 걸려 멈출 때(429) 다시 묻고, 바꾸기를 고르면 떠난 계정 한도가 풀릴 때 저절로 돌아온다
 *   - 도구 결과 뒤 이어지는 요청은 같은 계정(프롬프트 캐시 유지). 그 사이 95%를 넘으면 그 자리에서 묻는다
 * - 사용량은 응답 헤더(anthropic-ratelimit-unified-*)로 계속 갱신하고, 탭끼리 파일로 나눠 본다.
 *   개인 계정은 처음에 사용량 API 로도 읽는다(회사 장기 토큰은 사용량 API 권한이 없음).
 * - 계정이 바뀌면 맥·폰에 알림 문구. 하단 줄은 claude-accounts:route 이벤트로 지금 계정을 보인다.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// 확장에서 쓸 수 있는 pi-ai 경로는 루트·models·oauth·providers/all 뿐(pi 확장 불러오기의 연결 목록)
import { createProvider } from "@earendil-works/pi-ai/models";
import { builtinProviders, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

const ANTHROPIC_MODELS: any[] = getBuiltinModels("anthropic");

export const PERSONAL = "anthropic";
export const WORK = "anthropic-work";
/** 추가 개인 계정(사용자 결정 11-25). auth.json 의 api_key 가 열쇠고리 pi-anthropic-personal2 를 읽는 명령 */
export const PERSONAL2 = "anthropic-personal2";
export const VIRTUAL = "claude";
export const THRESHOLD = 0.95;   // 사용자가 고른 값: 전체 한도가 95% 이상이면 묻는다(11-24)
/** 회사 계정을 기본으로 쓸 폴더 목록 파일: 한 줄에 폴더 하나(~ 가능, # 뒤는 주석). Claude Code 쪽(claude-account.mjs)과 같이 씀 */
export const WORK_DIRS_FILE = process.env.PI_REMOTE_WORK_DIRS_FILE || `${homedir()}/.config/pi-remote/work-dirs`;
export function readWorkDirs(file = WORK_DIRS_FILE): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean)
      .map((p) => resolve(p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p));
  } catch {
    return [];   // 파일이 없음: 회사 폴더 없음
  }
}
export const WORK_DIRS = readWorkDirs();
export const LABEL: Record<string, string> = { [PERSONAL]: "개인", [PERSONAL2]: "추가 개인", [WORK]: "회사" };
const CACHE = process.env.PI_ACCOUNTS_CACHE ?? `${homedir()}/.cache/pi-remote/claude-accounts.json`;
const API_TTL_MS = 15 * 60_000;     // 개인 계정 사용량 API 는 탭끼리 합쳐 15분에 한 번
const LIMIT_ERROR_HOLD_SEC = 300;   // 헤더 없이 한도 오류만 났을 때 그 계정을 피하는 시간

/** 한도 하나: util 0~1, reset 유닉스 초 */
export type Claim = { util: number; reset?: number; at: number };
/** 계정 → 한도 키(5h | 7d | 7d:<모델 이름> | 429) → 한도 */
export type Usage = Record<string, Record<string, Claim>>;

/** 폴더별 기본 계정 */
export function homeAccount(cwd: string, workDirs = WORK_DIRS): string {
  const c = resolve(cwd || "/");
  return workDirs.some((d) => c === d || c.startsWith(d + sep)) ? WORK : PERSONAL;
}
/** 95%를 넘어 물을 때 바꿀 곳(사용자 결정 11-25, claude-account.mjs 의 SWITCH_TO 와 같음): 원래 계정(폴더 기본)에 있으면
 *  개인 → 추가 개인, 추가 개인 → 개인, 회사 → 개인. 이미 바꿔 간 계정에 있으면 원래 계정으로 돌아가기 */
export const SWITCH_TO: Record<string, string> = { [PERSONAL]: PERSONAL2, [PERSONAL2]: PERSONAL, [WORK]: PERSONAL };
export const switchTarget = (cur: string, home: string) => (cur !== home ? home : SWITCH_TO[cur]);
const isAccount = (p?: string) => p === PERSONAL || p === WORK || p === PERSONAL2;

/** 한도 구분 이름 → 그 한도가 걸리는 모델 이름. Fable 전용 주간 한도는 응답 헤더의 내부 이름(oi = overage_included)으로 적힌다(11-21) */
const SCOPE_MODEL: Record<string, string> = { oi: "fable", overage_included: "fable" };
/** 이 모델에 걸리는 한도 중 가장 높은 사용률(초기화 시각이 지난 것은 뺌) */
export function usageFor(usage: Usage, provider: string, modelId: string, now = Date.now()): { util: number; key: string } {
  let best = { util: 0, key: "" };
  for (const [key, c] of Object.entries(usage[provider] ?? {})) {
    if (c.reset && c.reset * 1000 <= now) continue;
    const raw = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
    const scope = SCOPE_MODEL[raw] ?? raw;
    if (scope && !modelId.toLowerCase().includes(scope)) continue;   // 다른 모델 전용 한도
    if (c.util > best.util) best = { util: c.util, key };
  }
  return best;
}

/** 구독 한도 오류인지(오류 문구) */
export function isLimitError(msg?: string): boolean {
  return /(?<![0-9])429(?![0-9])|rate.?limit|usage.?limit|exceed/i.test(msg ?? "");
}

/** 계정 전체 한도(5시간·주간, 모든 모델) 가운데 가장 높은 것. 모델 전용 한도와 한도 오류 표시(429)는 뺀다
 *  (사용자 11-24 '95%는 전체 사용량'). Claude Code 쪽 claude-account.mjs 의 totalLimit 과 같음 */
export const TOTAL_KEYS = ["5h", "7d"];
export function totalLimit(usage: Usage, provider: string, now = Date.now()): { util: number; reset?: number } {
  let best: { util: number; reset?: number } = { util: 0 };
  for (const k of TOTAL_KEYS) {
    const c = usage?.[provider]?.[k];
    if (!c || typeof c.util !== "number" || (c.reset && c.reset * 1000 <= now)) continue;
    if (c.util > best.util) best = { util: c.util, reset: c.reset };
  }
  return best;
}

/** 물을 것: 그 계정(account)을 그대로 쓸지, other 로 바꿀지. limitHit: 한도 오류로 멈춤(꽉 참) */
export type Ask = { account: string; other: string; util: number; reset?: number; limitHit: boolean };

/** 계정 고르기(순수 함수). 한도로는 저절로 바꾸지 않고 물을 것(ask)을 돌려준다(사용자 결정 11-24).
 *  away: 물어서 떠난 계정 — 그 계정의 전체 한도가 아직 95% 이상이면 다른 계정, 내려오면 돌아옴. keep: 그대로 쓰기로 한 계정들 */
export function decide(input: {
  reason: string;
  modelId: string;
  cwd: string;
  previous?: string;
  failed?: { provider: string; error?: string };
  usage: Usage;
  hasAuth: (p: string) => boolean;
  now?: number;
  workDirs?: string[];
  away?: string;
  keep?: string[];
}): { provider: string; why: "home" | "away" | "no-auth" | "continuation" | "retry"; limited?: string; ask?: Ask } {
  const { reason, usage, hasAuth } = input;
  const now = input.now ?? Date.now();
  const home = homeAccount(input.cwd, input.workDirs);
  const askFor = (p: string, limitHit: boolean): Ask | undefined => {
    const o = switchTarget(p, home);
    if (!o || !hasAuth(o)) return undefined;   // 바꿀 계정이 없음: 물어도 소용없음
    const t = totalLimit(usage, p, now);
    return { account: p, other: o, util: t.util, reset: t.reset, limitHit };
  };
  if (reason === "retry" && input.failed && isAccount(input.failed.provider)) {
    const f = input.failed.provider;
    if (isLimitError(input.failed.error)) {
      const ask = askFor(f, true);
      return ask ? { provider: f, why: "retry", limited: f, ask } : { provider: f, why: "retry", limited: f };
    }
    return { provider: f, why: "retry" };
  }
  let cur: string;
  let why: "home" | "away" | "no-auth" | "continuation";
  if (reason === "continuation" && isAccount(input.previous) && hasAuth(input.previous!)) {
    cur = input.previous!;
    why = "continuation";
  } else {
    const o = SWITCH_TO[home];
    // 기본 계정에 로그인이 없으면 로그인된 다른 계정(바꿀 곳이 먼저)
    if (!hasAuth(home)) [cur, why] = [[o, PERSONAL, PERSONAL2, WORK].find((p) => hasAuth(p)) ?? o, "no-auth"];
    else if (input.away === home && totalLimit(usage, home, now).util >= THRESHOLD && hasAuth(o)) [cur, why] = [o, "away"];
    else [cur, why] = [home, "home"];
  }
  if (totalLimit(usage, cur, now).util >= THRESHOLD && !(input.keep ?? []).includes(cur)) {
    const ask = askFor(cur, false);
    if (ask) return { provider: cur, why, ask };
  }
  return { provider: cur, why };
}

/** 초 → '11월 23일(월) 오후 4시'(이 맥의 시간대). claude-feed.mjs 의 resetText 와 같음 */
export function resetText(sec: number): string {
  const d = new Date(sec * 1000);
  const h = d.getHours(), m = d.getMinutes();
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${"일월화수목금토"[d.getDay()]}) ${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시${m ? ` ${m}분` : ""}`;
}
/** 묻는 창의 글과 선택지(첫째 그대로·멈추기, 둘째 바꾸기) */
export function askPrompt(a: Ask): { title: string; keep: string; go: string } {
  const pct = `${Math.round(a.util * 100)}%`;
  const title = a.limitHit
    ? `${LABEL[a.account]} 계정이 사용 한도에 걸렸어요.${a.reset ? ` ${resetText(a.reset)}에 풀려요.` : ""} 어떻게 할까요?`
    : `${LABEL[a.account]} 계정 사용량이 ${pct}예요(전체 한도${a.reset ? ` · ${resetText(a.reset)} 초기화` : ""}). 하던 일을 멈췄어요. 어떻게 할까요?`;
  return { title, keep: a.limitHit ? "멈추기(한도가 풀린 뒤 다시 보내기)" : `${LABEL[a.account]} 계정 그대로`, go: `${LABEL[a.other]} 계정으로 바꾸기` };
}

/** 응답 헤더 → 한도들 */
export function claimsFromHeaders(headers: Record<string, any>, now = Date.now()): Record<string, Claim> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) h[k.toLowerCase()] = String(v);
  const out: Record<string, Claim> = {};
  const P = "anthropic-ratelimit-unified-";
  for (const [k, v] of Object.entries(h)) {
    const m = k.match(/^anthropic-ratelimit-unified-(5h|7d)(?:_([a-z_]+))?-utilization$/);
    if (!m) continue;
    const name = m[2] ? `${m[1]}_${m[2]}` : m[1];
    const reset = Number(h[`${P}${name}-reset`]) || undefined;
    out[m[2] ? `${m[1]}:${m[2]}` : m[1]] = { util: Number(v) || 0, reset, at: now };
  }
  if (/rejected/i.test(h[`${P}status`] ?? "")) {
    // 한도 도달: 대표 한도를 꽉 찬 것으로
    const rep = (h[`${P}representative-claim`] ?? "").toLowerCase();
    const m = rep.match(/^(five_hour|seven_day)(?:_([a-z_]+))?$/);
    const key = m ? `${m[1] === "five_hour" ? "5h" : "7d"}${m[2] ? `:${m[2]}` : ""}` : "429";
    out[key] = { util: 1, reset: Number(h[`${P}reset`]) || now / 1000 + LIMIT_ERROR_HOLD_SEC, at: now };
  }
  return out;
}

/** 사용량 API(개인 계정) 응답 → 한도들 */
export function claimsFromUsageApi(u: any, now = Date.now()): Record<string, Claim> {
  const out: Record<string, Claim> = {};
  const sec = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) || undefined : undefined);
  for (const l of Array.isArray(u?.limits) ? u.limits : []) {
    const model = String(l?.scope?.model?.display_name ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    const base = l.group === "weekly" ? "7d" : "5h";
    if (typeof l.percent !== "number") continue;
    out[model ? `${base}:${model}` : base] = { util: l.percent / 100, reset: sec(l.resets_at), at: now };
  }
  if (!out["5h"] && typeof u?.five_hour?.utilization === "number") {
    out["5h"] = { util: u.five_hour.utilization / 100, reset: sec(u.five_hour.resets_at), at: now };
  }
  return out;
}

export default function (pi: ExtensionAPI) {
  // --- 토큰 계정 공급자(회사·추가 개인): pi 기본 Anthropic 모델·요청 방식 재사용, 인증은 저장된 키만(환경 변수는 보지 않음) ---
  const base: any = builtinProviders().find((p: any) => p.id === PERSONAL);
  for (const id of [WORK, PERSONAL2]) {
    const who = LABEL[id];
    pi.registerProvider(
      createProvider({
        id,
        name: `Anthropic ${who} 계정`,
        baseUrl: "https://api.anthropic.com",
        auth: {
          apiKey: {
            name: `${who} Claude 구독 토큰(claude setup-token)`,
            login: async (interaction: any) => {
              const key = await interaction.prompt({ type: "secret", message: `${who} 계정 토큰(sk-ant-oat…)` });
              return { type: "api_key", key };
            },
            resolve: async ({ credential }: any) =>
              credential?.key ? { auth: { apiKey: credential.key }, source: "stored credential" } : undefined,
          },
        },
        models: ANTHROPIC_MODELS.map((m: any) => ({ ...m, provider: id })),
        api: { stream: base.stream, streamSimple: base.streamSimple },
      } as any) as any,
    );
  }

  // --- 사용량(탭끼리 파일로 공유) ---
  let usage: Usage = {};
  const merge = (d: Usage) => {
    for (const [p, claims] of Object.entries(d ?? {})) {
      for (const [k, c] of Object.entries(claims ?? {})) {
        const cur = usage[p]?.[k];
        if (!cur || (c as Claim).at > cur.at) (usage[p] ??= {})[k] = c as Claim;
      }
    }
  };
  const load = () => {
    try {
      merge(JSON.parse(readFileSync(CACHE, "utf8")));
    } catch {
      /* 아직 없음 */
    }
  };
  const save = () => {
    try {
      load();
      mkdirSync(dirname(CACHE), { recursive: true });
      const tmp = `${CACHE}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(usage));
      renameSync(tmp, CACHE);
    } catch {
      /* 기록 실패는 판단에만 영향 */
    }
  };
  const record = (p: string, claims: Record<string, Claim>) => {
    if (!isAccount(p) || !Object.keys(claims).length) return;
    load();
    for (const [k, c] of Object.entries(claims)) (usage[p] ??= {})[k] = c;
    save();
  };
  /** 개인 계정 사용량 API(15분에 한 번, 탭끼리 합쳐서) */
  let apiAt = 0;
  const refreshPersonal = async (ctx: any) => {
    load();
    const latest = Math.max(apiAt, ...Object.values(usage[PERSONAL] ?? {}).map((c) => c.at));
    if (Date.now() - latest < API_TTL_MS) return;
    apiAt = Date.now();
    try {
      const token = await ctx.modelRegistry.getApiKeyForProvider(PERSONAL);
      if (!token || !String(token).includes("sk-ant-oat")) return;
      const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) record(PERSONAL, claimsFromUsageApi(await r.json()));
    } catch {
      /* 다음에 다시 */
    }
  };

  // --- 가상 모델: 계정 고르기 ---
  let lastRouted = "";
  let uiRef: any = null;
  const pct = (u: number) => `${Math.round(u * 100)}%`;
  /** wasAway: 직전까지 기본 계정이 아닌 쪽을 쓰고 있었는지(라우터 상태) */
  const announce = (from: string | undefined, to: string, why: string, modelId: string, wasAway: boolean) => {
    if (!isAccount(from) || from === to) return;
    const u = totalLimit(usage, from!);
    const text =
      why === "asked-limit" ? `${LABEL[from!]} 계정이 한도에 걸려 고른 대로 ${LABEL[to]} 계정으로 다시 보냈어요`
      : why === "asked" ? `${LABEL[from!]} 계정 사용량이 ${pct(u.util)}라 고른 대로 ${LABEL[to]} 계정으로 보낼게요`
      : why === "home" && wasAway ? `${LABEL[to]} 계정으로 돌아왔어요`
      : why === "home" ? `이 폴더는 ${LABEL[to]} 계정으로 보낼게요`
      : `${LABEL[to]} 계정으로 보낼게요`;
    try {
      uiRef?.notify?.(text, "info");
    } catch {
      /* 화면 없음 */
    }
    pi.events.emit("claude-accounts:switch", { from, to, why, text });
  };

  // --- 95%를 넘으면 묻기(사용자 결정 11-24). 이 pi 프로세스(탭)에만 기억: 그대로 쓰기로 한 계정·물어서 떠난 계정 ---
  const keep = new Set<string>();
  let away = "";
  let asking: { key: string; pick: Promise<string | undefined> } | null = null;   // 같은 물음이 겹치면(동시 요청) 한 창만
  /** 묻고 고른 대로 계정을 정함. 화면이 없거나 창을 닫으면 그대로(저절로 바꾸지 않음). 한도에 걸려 멈춘 것이면 이번 요청을 멈춤 */
  const askAccount = async (d: ReturnType<typeof decide>, ctx: any): Promise<{ provider: string; why: string }> => {
    const a = d.ask!;
    const p = askPrompt(a);
    const ui = ctx?.hasUI ? ctx.ui : null;
    let pick: string | undefined;
    if (typeof ui?.select === "function") {
      const key = `${a.account}|${a.limitHit}`;
      if (asking?.key !== key) asking = { key, pick: Promise.resolve(ui.select(p.title, [p.keep, p.go])).catch(() => undefined) };
      const mine = asking;
      pick = await mine.pick;
      if (asking === mine) asking = null;
    }
    if (pick === p.go) {
      const to = a.other;
      const home = homeAccount(ctx?.cwd ?? process.cwd());
      away = to === home ? "" : home;
      if (totalLimit(usage, to).util >= THRESHOLD) keep.add(to);   // 바꿀 계정도 95% 이상인데 골랐음: 바로 다시 묻지 않게
      return { provider: to, why: a.limitHit ? "asked-limit" : "asked" };
    }
    if (a.limitHit) throw new Error(`${LABEL[a.account]} 계정이 사용 한도에 걸려 멈췄어요. 한도가 풀린 뒤 다시 보내 주세요`);
    keep.add(a.account);
    return { provider: d.provider, why: d.why };
  };

  for (const m of ANTHROPIC_MODELS) {
    if (m.type && m.type !== "chat") continue;
    pi.registerVirtualModel({
      provider: VIRTUAL,
      id: m.id,
      name: m.name,
      thinkingLevels: m.reasoning ? Object.keys(m.thinkingLevelMap ?? { off: 0, low: 0, medium: 0, high: 0 }) : ["off"],
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      input: m.input,
      async route(req: any, ctx: any) {
        uiRef = ctx?.hasUI ? ctx.ui : uiRef;
        const id = req.model.id;
        const hasAuth = (p: string) => {
          const pm = ctx.modelRegistry.find(p, id);
          return !!pm && ctx.modelRegistry.hasConfiguredAuth(pm);
        };
        if (req.reason !== "continuation") load();
        const cwd = ctx.cwd ?? process.cwd();
        for (const p of [...keep]) if (totalLimit(usage, p).util < THRESHOLD) keep.delete(p);   // 초기화됨: 다음에 넘으면 다시 물음
        const base = decide({
          reason: req.reason,
          modelId: id,
          cwd,
          previous: req.previous?.model?.provider,
          failed: req.failed ? { provider: req.failed.model?.provider, error: req.failed.message?.errorMessage } : undefined,
          usage,
          hasAuth,
          away,
          keep: [...keep],
        });
        if (base.limited && !usageFor(usage, base.limited, id).util) {
          record(base.limited, { "429": { util: 1, reset: Math.floor(Date.now() / 1000) + LIMIT_ERROR_HOLD_SEC, at: Date.now() } });
        }
        const d = base.ask ? await askAccount(base, ctx) : base;
        if (away && d.provider === homeAccount(cwd)) away = "";   // 돌아옴
        const model = ctx.modelRegistry.find(d.provider, id);
        if (!model) throw new Error(`${LABEL[d.provider] ?? d.provider} 계정에 ${id} 모델이 없어요`);
        const from = req.reason === "retry" ? req.failed?.model?.provider : req.previous?.model?.provider;
        const mode = d.provider === homeAccount(cwd) ? "home" : "away";
        if (req.reason !== "direct") announce(from, d.provider, d.why, id, req.state?.mode === "away");
        lastRouted = d.provider;
        pi.events.emit("claude-accounts:route", { provider: d.provider, label: LABEL[d.provider], why: d.why, modelId: id });
        const level =
          req.reason === "continuation" && req.previous ? req.previous.thinkingLevel ?? req.thinkingLevel
          : req.reason === "retry" && req.failed ? req.failed.thinkingLevel ?? req.thinkingLevel
          : req.thinkingLevel;
        return { model, thinkingLevel: level, state: req.state?.mode === mode ? undefined : { mode } };
      },
    } as any);
  }

  // 응답 헤더로 사용량 갱신(가상 모델이면 방금 고른 계정, 아니면 고른 공급자)
  pi.on("after_provider_response", async (e: any, ctx: any) => {
    const sel = ctx?.model?.provider;
    const p = sel === VIRTUAL ? lastRouted : sel;
    if (!isAccount(p)) return;
    const claims = claimsFromHeaders(e?.headers ?? {});
    if (e?.status === 429 && !Object.keys(claims).length) {
      claims["429"] = { util: 1, reset: Math.floor(Date.now() / 1000) + LIMIT_ERROR_HOLD_SEC, at: Date.now() };
    }
    record(p, claims);
  });

  // 기존 대화가 구독 모델(개인·회사)을 쓰고 있으면 같은 모델의 자동 계정으로 바꿈. /model 로 직접 고른 것은 그대로
  pi.on("session_start", async (_e: any, ctx: any) => {
    uiRef = ctx?.hasUI ? ctx.ui : null;
    const cur = ctx?.model;
    if (isAccount(cur?.provider)) {
      const v = ctx.modelRegistry.find(VIRTUAL, cur.id);
      if (v) await pi.setModel(v);
    }
    void refreshPersonal(ctx);
    if (ctx?.model?.provider === VIRTUAL) {
      const home = homeAccount(ctx.cwd ?? process.cwd());
      pi.events.emit("claude-accounts:route", { provider: home, label: LABEL[home], why: "start", modelId: ctx.model.id });
    }
  });
  pi.on("agent_start", async (_e: any, ctx: any) => {
    uiRef = ctx?.hasUI ? ctx.ui : uiRef;
    void refreshPersonal(ctx);
  });
}
