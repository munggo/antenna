/**
 * 두 Claude 구독 계정을 폴더별로 나눠 쓰고, 한도가 차면 서로 대체한다.
 *
 * - 개인: pi 기본 Anthropic 로그인(anthropic). 회사: anthropic-work 공급자
 *   (auth.json 의 api_key 가 키체인을 읽는 명령. 회사 토큰은 `claude setup-token` 으로 만든 장기 토큰)
 * - 가상 모델 claude/<모델 id>: 요청마다 계정을 고른다
 *   - 기본 계정: 회사 폴더(~/.config/pi-remote/work-dirs 에 적은 폴더) 아래는 회사, 나머지는 개인.
 *     그 파일이 없으면 어디서나 개인 계정
 *   - 기본 계정의 관련 한도(5시간·주간·그 모델 전용 주간)가 95% 이상이면 다음 메시지부터 다른 계정
 *   - 한도 오류(429)로 다시 시도할 때는 바로 다른 계정
 *   - 도구 결과 뒤 이어지는 요청은 같은 계정(프롬프트 캐시 유지)
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
export const VIRTUAL = "claude";
export const THRESHOLD = 0.95;   // 사용자가 고른 값: 95% 넘으면 다음 메시지부터 다른 계정
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
export const LABEL: Record<string, string> = { [PERSONAL]: "개인", [WORK]: "회사" };
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
export const otherAccount = (p: string) => (p === WORK ? PERSONAL : WORK);
const isAccount = (p?: string) => p === PERSONAL || p === WORK;

/** 이 모델에 걸리는 한도 중 가장 높은 사용률(초기화 시각이 지난 것은 뺌) */
export function usageFor(usage: Usage, provider: string, modelId: string, now = Date.now()): { util: number; key: string } {
  let best = { util: 0, key: "" };
  for (const [key, c] of Object.entries(usage[provider] ?? {})) {
    if (c.reset && c.reset * 1000 <= now) continue;
    const scope = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
    if (scope && !modelId.toLowerCase().includes(scope)) continue;   // 다른 모델 전용 한도
    if (c.util > best.util) best = { util: c.util, key };
  }
  return best;
}

/** 구독 한도 오류인지(오류 문구) */
export function isLimitError(msg?: string): boolean {
  return /(?<![0-9])429(?![0-9])|rate.?limit|usage.?limit|exceed/i.test(msg ?? "");
}

/** 계정 고르기(순수 함수) */
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
}): { provider: string; why: "home" | "fallback" | "both-limited" | "continuation" | "retry" | "limit-error"; limited?: string } {
  const { reason, modelId, usage, hasAuth } = input;
  const now = input.now ?? Date.now();
  const over = (p: string) => usageFor(usage, p, modelId, now).util >= THRESHOLD;
  const ok = (p: string) => hasAuth(p) && !over(p);
  if (reason === "retry" && input.failed && isAccount(input.failed.provider)) {
    const f = input.failed.provider;
    if (isLimitError(input.failed.error)) {
      const o = otherAccount(f);
      if (ok(o)) return { provider: o, why: "limit-error", limited: f };
      return { provider: f, why: "retry", limited: f };
    }
    return { provider: f, why: "retry" };
  }
  if (reason === "continuation" && isAccount(input.previous) && hasAuth(input.previous!)) {
    return { provider: input.previous!, why: "continuation" };
  }
  const home = homeAccount(input.cwd, input.workDirs);
  if (ok(home)) return { provider: home, why: "home" };
  const o = otherAccount(home);
  if (ok(o)) return { provider: o, why: "fallback" };
  return { provider: hasAuth(home) ? home : o, why: "both-limited" };
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
  // --- 회사 계정 공급자: pi 기본 Anthropic 모델·요청 방식 재사용, 인증은 저장된 키만(환경 변수는 보지 않음) ---
  const base: any = builtinProviders().find((p: any) => p.id === PERSONAL);
  pi.registerProvider(
    createProvider({
      id: WORK,
      name: "Anthropic 회사 계정",
      baseUrl: "https://api.anthropic.com",
      auth: {
        apiKey: {
          name: "회사 Claude 구독 토큰(claude setup-token)",
          login: async (interaction: any) => {
            const key = await interaction.prompt({ type: "secret", message: "회사 계정 토큰(sk-ant-oat…)" });
            return { type: "api_key", key };
          },
          resolve: async ({ credential }: any) =>
            credential?.key ? { auth: { apiKey: credential.key }, source: "stored credential" } : undefined,
        },
      },
      models: ANTHROPIC_MODELS.map((m: any) => ({ ...m, provider: WORK })),
      api: { stream: base.stream, streamSimple: base.streamSimple },
    } as any) as any,
  );

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
    const u = usageFor(usage, from!, modelId);
    const text =
      why === "limit-error" ? `${LABEL[from!]} 계정이 한도에 걸려 ${LABEL[to]} 계정으로 다시 보냈어요`
      : why === "fallback" ? `${LABEL[from!]} 계정 사용량이 ${pct(u.util)}라 ${LABEL[to]} 계정으로 보낼게요`
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
        const d = decide({
          reason: req.reason,
          modelId: id,
          cwd: ctx.cwd ?? process.cwd(),
          previous: req.previous?.model?.provider,
          failed: req.failed ? { provider: req.failed.model?.provider, error: req.failed.message?.errorMessage } : undefined,
          usage,
          hasAuth,
        });
        if (d.limited && !usageFor(usage, d.limited, id).util) {
          record(d.limited, { "429": { util: 1, reset: Math.floor(Date.now() / 1000) + LIMIT_ERROR_HOLD_SEC, at: Date.now() } });
        }
        const model = ctx.modelRegistry.find(d.provider, id);
        if (!model) throw new Error(`${LABEL[d.provider] ?? d.provider} 계정에 ${id} 모델이 없어요`);
        const from = req.reason === "retry" ? req.failed?.model?.provider : req.previous?.model?.provider;
        const cwd = ctx.cwd ?? process.cwd();
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
