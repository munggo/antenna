// claude-accounts 판정 시험: sh test/run.sh (ACC_PATH 에 확장 사본 경로)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const dir = mkdtempSync(`${tmpdir()}/acc-`);
process.env.PI_ACCOUNTS_CACHE = `${dir}/cache.json`;
// 회사 폴더 목록은 설정 파일에서 읽는다 → 시험용 파일을 가리키게(이 맥의 설정과 상관없이 같은 결과)
process.env.PI_REMOTE_WORK_DIRS_FILE = `${dir}/work-dirs`;
writeFileSync(process.env.PI_REMOTE_WORK_DIRS_FILE, "# 회사 폴더\n~/works/company   # 물결표는 홈\n\n");
const m = await import(process.env.ACC_PATH);
const { PERSONAL: P, WORK: W, PERSONAL2: P2, VIRTUAL: V } = m;
let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };
const H = homedir();
const now = Date.now();
const future = Math.floor(now / 1000) + 3600;

// 1. 폴더 판정
ok(m.homeAccount(`${H}/works/company`) === W && m.homeAccount(`${H}/works/company/api/src`) === W, "회사 폴더와 그 아래는 회사");
ok(m.homeAccount(`${H}/works/companyx`) === P && m.homeAccount(`${H}/works/personal/antenna`) === P && m.homeAccount("/tmp") === P, "이름만 비슷한 폴더·개인·기타는 개인");

// 2. 사용률
const U = (o) => Object.fromEntries(Object.entries(o).map(([p, c]) => [p, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === "number" ? { util: v, reset: future, at: now } : v]))]));
ok(m.usageFor(U({ [P]: { "7d": 0.5, "7d:fable": 0.97 } }), P, "claude-opus-5-5").util === 0.5, "다른 모델 전용 한도는 빼고 봄");
ok(m.usageFor(U({ [P]: { "7d": 0.5, "7d:fable": 0.97 } }), P, "claude-fable-5-2").util === 0.97, "그 모델 전용 한도는 포함");
ok(m.usageFor(U({ [P]: { "7d": 0.5, "7d:oi": 1 } }), P, "claude-fable-5-2").util === 1, "Fable 한도(응답 헤더 이름 oi)는 Fable 모델에 포함");
ok(m.usageFor(U({ [P]: { "7d": 0.5, "7d:overage_included": 1 } }), P, "claude-opus-5-5").util === 0.5, "Fable 한도(overage_included)는 다른 모델에는 빼고 봄");
ok(m.usageFor({ [P]: { "7d": { util: 0.99, reset: Math.floor(now / 1000) - 10, at: now } } }, P, "x").util === 0, "초기화 시각이 지난 한도는 뺌");

// 3. 계정 고르기
const both = () => true;
const D = (o) => m.decide({ reason: "user", modelId: "claude-opus-5-5", cwd: "/tmp", usage: {}, hasAuth: both, ...o });
ok(D({}).provider === P && D({}).why === "home", "개인 폴더 → 개인");
ok(D({ cwd: `${H}/works/company` }).provider === W, "회사 폴더 → 회사");
// 한도로는 저절로 바꾸지 않고 물을 것(ask)을 돌려줌(사용자 결정 11-24). 95%는 전체 한도(5시간·주간)만
const a96 = D({ usage: U({ [P]: { "7d": 0.96 } }) });
ok(a96.provider === P && a96.ask?.account === P && a96.ask.other === P2 && a96.ask.util === 0.96 && a96.ask.reset === future && !a96.ask.limitHit, "개인 96% → 개인 그대로 + 물음(추가 개인으로 바꿀지, 11-25)");
ok(D({ cwd: `${H}/works/company`, usage: U({ [W]: { "7d": 0.96 } }) }).ask?.other === P, "회사 96% → 바꿀 곳은 개인");
ok(!D({ usage: U({ [P]: { "7d": 0.94 } }) }).ask, "개인 94% → 묻지 않음");
ok(D({ usage: U({ [P]: { "7d": 0.95 } }) }).ask?.account === P, "정확히 95% → 물음(이상)");
ok(D({ cwd: `${H}/works/company`, usage: U({ [W]: { "5h": 0.99 } }) }).ask?.account === W, "회사 폴더에서 회사 5시간 99% → 물음");
ok(!D({ modelId: "claude-fable-5-2", usage: U({ [P]: { "7d": 0.5, "7d:fable": 0.97, "7d:oi": 1, "429": 1 } }) }).ask, "모델 전용 한도·한도 오류 표시로는 묻지 않음");
ok(!D({ usage: U({ [P]: { "7d": 0.96 } }), keep: [P] }).ask, "그대로 쓰기로 한 계정은 다시 묻지 않음");
ok(!D({ usage: U({ [P]: { "7d": 0.96 } }), hasAuth: (p) => p === P }).ask, "바꿀 계정이 없으면 묻지 않음");
ok(D({ reason: "continuation", previous: P, usage: U({ [P]: { "7d": 0.97 } }) }).ask?.account === P, "이어지는 요청 사이에 넘어도 그 자리에서 물음");
ok(!D({ reason: "continuation", previous: W, usage: U({ [P]: { "7d": 0.97 } }) }).ask, "이어지는 요청은 같은 계정(다른 계정이 넘은 것은 상관없음)");
// 물어서 떠난 계정(away): 떠난 계정이 95% 이상이면 다른 계정, 내려오면 돌아옴
const aw = D({ usage: U({ [P]: { "7d": 0.97 } }), away: P });
ok(aw.provider === P2 && aw.why === "away" && !aw.ask, "떠난 개인 97% → 추가 개인(묻지 않음)");
ok(D({ usage: U({ [P]: { "7d": 0.5 } }), away: P }).provider === P, "떠난 개인이 50% 로 내려옴 → 돌아옴");
const a2 = D({ usage: U({ [P]: { "7d": 0.97 }, [P2]: { "7d": 0.96 } }), away: P });
ok(a2.ask?.account === P2 && a2.ask.other === P, "떠나 온 추가 개인도 96% → 물음(바꿀 곳은 원래 개인, 회사 아님)");
ok(D({ cwd: `${H}/works/company`, hasAuth: (p) => p === P }).provider === P, "회사 로그인이 없으면 개인");
ok(D({ hasAuth: (p) => p === W }).provider === W, "개인 로그인이 없으면 회사");
ok(D({ reason: "continuation", previous: "openai" }).provider === P, "이어지는 요청이라도 이전이 다른 공급자면 폴더 기본");
const r1 = D({ reason: "retry", failed: { provider: P, error: '429 {"type":"error","error":{"type":"rate_limit_error"}}' } });
ok(r1.provider === P && r1.limited === P && r1.ask?.limitHit === true && r1.ask.other === P2, "한도 오류(429) 다시 시도 → 바꾸지 않고 물음(꽉 참, 바꿀 곳 추가 개인)");
ok(D({ reason: "retry", failed: { provider: P, error: "This request would exceed your account's rate limit" } }).ask?.limitHit === true, "한도 문구(rate limit) → 물음");
ok(!D({ reason: "retry", failed: { provider: P, error: "overloaded_error: Overloaded" } }).ask, "과부하 오류는 같은 계정으로 다시(묻지 않음)");
ok(D({ reason: "retry", failed: { provider: P, error: "429" }, keep: [P] }).ask?.limitHit === true, "그대로 쓰기로 했어도 꽉 차 멈추면 다시 물음");
ok(D({ reason: "direct", cwd: `${H}/works/company` }).provider === W, "압축 요약 등 직접 요청도 폴더 기본");
ok(m.totalLimit(U({ [P]: { "5h": 0.3, "7d": 0.9, "7d:oi": 1 } }), P).util === 0.9, "전체 한도: 모델 전용 한도는 뺌");

// 4. 응답 헤더
const h1 = m.claimsFromHeaders({
  "anthropic-ratelimit-unified-7d-reset": "1794459600", "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.0", "anthropic-ratelimit-unified-status": "allowed",
  "anthropic-ratelimit-unified-representative-claim": "seven_day", "anthropic-ratelimit-unified-reset": "1794459600",
  "anthropic-ratelimit-unified-fallback-percentage": "0.5",
}, now);
ok(JSON.stringify(Object.keys(h1)) === '["7d"]' && h1["7d"].util === 0 && h1["7d"].reset === 1794459600, "실제 회사 응답 헤더 → 주간 0%, 초기화 시각");
const h2 = m.claimsFromHeaders({ "Anthropic-Ratelimit-Unified-5h-Utilization": "0.42", "anthropic-ratelimit-unified-5h-reset": "1794400000",
  "anthropic-ratelimit-unified-7d_opus-utilization": "0.9" }, now);
ok(h2["5h"]?.util === 0.42 && h2["5h"].reset === 1794400000 && h2["7d:opus"]?.util === 0.9, "대소문자 섞인 헤더·5시간·모델 전용 한도");
const h3 = m.claimsFromHeaders({ "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-representative-claim": "five_hour",
  "anthropic-ratelimit-unified-reset": "1794401111" }, now);
ok(h3["5h"]?.util === 1 && h3["5h"].reset === 1794401111, "거절됨 → 대표 한도(5시간)를 꽉 찬 것으로");
ok(Object.keys(m.claimsFromHeaders({ "content-type": "application/json" })).length === 0, "관련 헤더가 없으면 빈 값");

// 5. 사용량 API(개인)
const a1 = m.claimsFromUsageApi({ five_hour: null, limits: [
  { group: "weekly", percent: 58, resets_at: "2026-11-16T07:00:00Z" },
  { group: "weekly", percent: 52, scope: { model: { display_name: "Fable" } }, resets_at: "2026-11-16T07:00:00Z" },
] }, now);
ok(a1["7d"]?.util === 0.58 && a1["7d:fable"]?.util === 0.52 && a1["7d"].reset === Date.parse("2026-11-16T07:00:00Z") / 1000, "사용량 API → 주간·Fable 주간");
ok(m.claimsFromUsageApi({ five_hour: { utilization: 97, resets_at: "2026-11-11T12:00:00Z" } }, now)["5h"]?.util === 0.97, "옛 형식 5시간 값");

// 6. 확장 전체(가짜 pi)
const providers = [], virtuals = [], handlers = {}, events = [], notices = [];
let setTo = null;
const fakePi = {
  registerProvider: (p) => providers.push(p), registerVirtualModel: (v) => virtuals.push(v),
  on: (ev, fn) => ((handlers[ev] ??= []).push(fn)), events: { emit: (ch, d) => events.push([ch, d]) },
  setModel: async (mm) => { setTo = mm; return true; },
};
m.default(fakePi);
const work = providers.find((p) => p.id === W);
ok(!!work && work.getModels().length >= 10 && work.getModels().every((x) => x.provider === W), `회사 공급자 등록(모델 ${work?.getModels().length}개, 모두 공급자 ${W})`);
const p2prov = providers.find((p) => p.id === P2);
ok(!!p2prov && p2prov.getModels().every((x) => x.provider === P2), "추가 개인 공급자도 등록");
const opus = virtuals.find((v) => v.id === "claude-opus-5-5");
ok(virtuals.length >= 10 && virtuals.every((v) => v.provider === V) && opus?.thinkingLevels.includes("medium"), `가상 모델 ${virtuals.length}개(claude/…), 생각 깊이 포함`);
const auth = new Set([P, W, P2]);
let answer = null;   // 선택 창에 고를 답(0 그대로·멈추기, 1 바꾸기, null 창 닫음)
const asked = [];
const ctx = (cwd) => ({
  cwd, hasUI: true,
  ui: { notify: (t) => notices.push(t), select: async (title, opts) => { asked.push({ title, opts }); return answer === null ? undefined : opts[answer]; } },
  modelRegistry: { find: (p, id) => ({ provider: p, id }), hasConfiguredAuth: (mm) => auth.has(mm.provider), getApiKeyForProvider: async () => undefined },
});
const req = (o) => ({ model: { provider: V, id: "claude-opus-5-5" }, thinkingLevel: "medium", reason: "user", messages: [], ...o });
let r = await opus.route(req({}), ctx("/tmp"));
ok(r.model.provider === P && r.thinkingLevel === "medium" && r.state?.mode === "home", "개인 폴더: 개인 계정, 상태 home");
r = await opus.route(req({ previous: { model: { provider: P } } }), ctx(`${H}/works/company`));
ok(r.model.provider === W && notices.at(-1) === "이 폴더는 회사 계정으로 보낼게요", "회사 폴더: 회사 계정 + 알림 문구");
// 개인 96% 를 응답 헤더로 기록 → 다음 메시지는 회사로
await opus.route(req({}), ctx("/tmp"));
for (const fn of handlers.after_provider_response) await fn({ status: 200, headers: { "anthropic-ratelimit-unified-7d-utilization": "0.96", "anthropic-ratelimit-unified-7d-reset": String(future) } }, { model: { provider: V } });
const cache = JSON.parse(readFileSync(`${dir}/cache.json`, "utf8"));
ok(cache[P]?.["7d"]?.util === 0.96, "응답 헤더 → 공유 파일에 개인 96% 기록");
// 96%: 묻고 고른 대로(사용자 결정 11-24). 먼저 '그대로' → 개인, 다시 묻지 않음
answer = 0;
r = await opus.route(req({ previous: { model: { provider: P } }, state: { mode: "home" } }), ctx("/tmp"));
ok(r.model.provider === P && asked.length === 1 && /^개인 계정 사용량이 96%예요\(전체 한도 · .+ 초기화\)\. 하던 일을 멈췄어요\. 어떻게 할까요\?$/.test(asked[0].title)
  && JSON.stringify(asked[0].opts) === JSON.stringify(["개인 계정 그대로", "추가 개인 계정으로 바꾸기"]), `96% → 물음(${asked[0]?.title}) → 그대로 개인`);
r = await opus.route(req({ previous: { model: { provider: P } }, state: { mode: "home" } }), ctx("/tmp"));
ok(r.model.provider === P && asked.length === 1, "그대로 쓰기로 했으면 다음 메시지에 다시 묻지 않음");
// 꽉 차 멈춤(429): 다시 물음. 멈추기 → 이번 요청은 오류로 멈춤
let err = "";
try { await opus.route(req({ reason: "retry", failed: { model: { provider: P }, message: { errorMessage: "429 rate_limit_error" } } }), ctx("/tmp")); } catch (e) { err = String(e?.message ?? e); }
ok(asked.length === 2 && /^개인 계정이 사용 한도에 걸렸어요/.test(asked[1].title) && asked[1].opts[0] === "멈추기(한도가 풀린 뒤 다시 보내기)" && /사용 한도에 걸려 멈췄어요/.test(err), `꽉 차 멈춤 → 다시 물음 → 멈추기(${err})`);
// 새 탭(다른 pi 프로세스)처럼: 기억이 없는 확장으로 바꾸기를 고름 → 회사 + 알림
const providers2 = [], virtuals2 = [];
m.default({ ...fakePi, registerProvider: (p) => providers2.push(p), registerVirtualModel: (v) => virtuals2.push(v), on: () => {} });
const opus2 = virtuals2.find((v) => v.id === "claude-opus-5-5");
answer = 1;
r = await opus2.route(req({ previous: { model: { provider: P } }, state: { mode: "home" } }), ctx("/tmp"));
ok(r.model.provider === P2 && r.state?.mode === "away" && notices.at(-1) === "개인 계정 사용량이 96%라 고른 대로 추가 개인 계정으로 보낼게요", "바꾸기 → 추가 개인 + '고른 대로' 알림");
ok(events.some(([ch, d]) => ch === "claude-accounts:switch" && d.to === P2), "계정 바뀜 이벤트(폰 알림용)");
r = await opus2.route(req({ previous: { model: { provider: P2 } }, state: { mode: "away" } }), ctx("/tmp"));
ok(r.model.provider === P2 && asked.length === 3, "떠난 개인이 아직 96% → 다음 메시지도 추가 개인(묻지 않음)");
// 화면이 없으면(하위 에이전트 등) 묻지 못해 그대로 둠(저절로 바꾸지 않음)
const opus3 = (() => { const vs = []; m.default({ ...fakePi, registerProvider: () => {}, registerVirtualModel: (v) => vs.push(v), on: () => {} }); return vs.find((v) => v.id === "claude-opus-5-5"); })();
r = await opus3.route(req({}), { ...ctx("/tmp"), hasUI: false });
ok(r.model.provider === P && asked.length === 3, "화면이 없으면 묻지 않고 그대로 개인");
r = await opus.route(req({ reason: "continuation", previous: { model: { provider: W }, thinkingLevel: "high" }, state: { mode: "away" } }), ctx("/tmp"));
ok(r.model.provider === W && r.thinkingLevel === "high" && r.state === undefined, "이어지는 요청: 같은 계정·같은 생각 깊이, 상태 그대로");
// 초기화 → 돌아옴
for (const fn of handlers.after_provider_response) await fn({ status: 200, headers: { "anthropic-ratelimit-unified-7d-utilization": "0.1" } }, { model: { provider: P } });
r = await opus2.route(req({ previous: { model: { provider: P2 } }, state: { mode: "away" } }), ctx("/tmp"));
ok(r.model.provider === P && notices.at(-1) === "개인 계정으로 돌아왔어요", "떠난 개인 사용량이 내려가면 개인으로 + '돌아왔어요'");
// 기존 대화 모델 바꾸기
await handlers.session_start[0]({}, { ...ctx("/tmp"), model: { provider: P, id: "claude-opus-5-5" } });
ok(setTo?.provider === V && setTo?.id === "claude-opus-5-5", "기존 대화의 개인 구독 모델 → 자동 계정 모델로");
setTo = null;
await handlers.session_start[0]({}, { ...ctx("/tmp"), model: { provider: "openai", id: "gpt" } });
ok(setTo === null, "다른 공급자 모델은 그대로");

rmSync(dir, { recursive: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
