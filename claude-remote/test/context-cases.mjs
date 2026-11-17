// Claude Code 탭의 컨텍스트 사용량(앱 위쪽의 고리) 판정 시험: node claude-remote/test/context-cases.mjs
// 11-17 사용자 보고 '앱에서 현재 컨텍스트 확인이 안 보인다': Claude Code 연결부가 사용량을 늘 빈 값으로 보내 고리가 pi 탭에서만 보였다.
// 기억 용량·자동 압축 지점의 규칙은 Claude Code 문서(model-config)와 이 맥의 기록에서 실제로 압축된 지점으로 확인한 것
import { contextInfo, contextWindowOf, createConverter } from "../claude-feed.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const M = 1_000_000, K200 = 200_000;

// 1. 기억 용량: 모델 이름으로
const win = (id, env) => contextWindowOf(id, env);
ok(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-5-5"].every((id) => win(id) === M),
  "1M: Fable, Opus 4.7 이상, Sonnet 5 이상, Haiku 5.5");
ok(["claude-opus-4-6", "claude-opus-4-5-20251101", "claude-opus-4-1-20250805", "claude-opus-4-20250514", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"].every((id) => win(id) === K200),
  "200K: 그 앞 모델(이름 끝의 날짜를 판 번호로 읽지 않음)");
ok(win("claude-opus-6") === M && win("claude-sonnet-6-1") === M, "Opus·Sonnet 은 그 뒤 판도 1M(문서의 'and later')");
ok(win("us.anthropic.claude-opus-4-7-v1:0") === M && win("Claude-Opus-5-5") === M, "앞뒤에 다른 글이 붙거나 대문자여도 읽음");
ok([null, undefined, "", "<synthetic>", "my-gateway-model", "claude-3-5-sonnet-20241022", "gpt-5"].every((id) => win(id) === null), "모르는 이름은 null(고리를 숨김)");
ok(win("claude-fable-5-2", { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" }) === K200 && win("claude-opus-4-6", { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" }) === K200, "1M 을 끈 환경이면 모두 200K");
ok(win("claude-fable-5-2", { CLAUDE_CODE_DISABLE_1M_CONTEXT: "0" }) === M && win("claude-fable-5-2", {}) === M, "끄지 않았으면 그대로 1M");
ok(win("nope", { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" }) === null, "1M 을 꺼도 모르는 이름은 null");

// 2. 고리에 보낼 값: 사용 중 토큰·기억 용량·사용률
const a = contextInfo("claude-fable-5-2", 152_000);
ok(a.tokens === 152_000 && a.window === M && Math.abs(a.percent - 15.2) < 1e-9, `사용률 = 사용 중 / 기억 용량(${a.percent})`);
ok(Object.keys(a).sort().join(",") === "auto,percent,reserve,tokens,window", "앱이 읽는 다섯 값이 모두 있음(하나라도 빠지면 앱이 그 소식을 통째로 버림)");
ok([a.tokens, a.window, a.reserve].every(Number.isInteger) && typeof a.auto === "boolean", "토큰 수들은 정수, 자동 압축 여부는 참·거짓(앱이 그 꼴로만 읽음)");
const b = contextInfo("claude-fable-5-2", null);
ok(b.tokens === null && b.percent === null && b.window === M && b.reserve === 33_000, "사용량을 모르면(압축 직후) 토큰·사용률만 비움");
ok(contextInfo("claude-fable-5-2", undefined).tokens === null && contextInfo("claude-fable-5-2", 0).percent === 0, "값이 없으면 null, 0 은 0%");
ok(contextInfo("모르는-모델", 1000) === null && contextInfo(null, null) === null, "모르는 모델·아직 답이 없는 대화는 null");
ok(Math.abs(contextInfo("claude-opus-4-6", 50_000).percent - 25) < 1e-9, "200K 모델은 200K 기준");

// 3. 자동 압축 지점(= 기억 용량 - reserve)
ok(a.auto === true && a.window - a.reserve === 967_000, "1M 모델의 기본: 967K 에서 시작");
const c = contextInfo("claude-opus-4-6", 1000);
ok(c.auto === true && c.reserve === 0, "200K 모델의 기본: 기억 용량 끝에서");
ok(contextInfo("claude-fable-5-2", 1000, {}, { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" }).reserve === 0, "1M 을 끈 환경: 200K 끝에서");
const at = (model, settings, env) => { const i = contextInfo(model, 1000, settings, env); return i.window - i.reserve; };
ok(at("claude-fable-5-2", { autoCompactWindow: 500_000 }) === 500_000, "모든 모델용 설정(autoCompactWindow)");
ok(at("claude-fable-5-2", { autoCompactWindow: 500_000, modelSettings: { "claude-fable-5-2": { autoCompactWindow: 300_000 } } }) === 300_000, "모델마다 저장한 값(/autocompact)이 먼저");
ok(at("claude-opus-5-5", { autoCompactWindow: 500_000, modelSettings: { "claude-fable-5-2": { autoCompactWindow: 300_000 } } }) === 500_000, "다른 모델에 저장한 값은 쓰지 않음");
ok(at("claude-fable-5-2", { autoCompactWindow: 500_000, modelSettings: { "claude-fable-5-2": { autoCompactWindow: "auto" } } }) === 967_000, "모델에 'auto' 로 저장했으면 모든 모델용 값 대신 기본");
ok(at("claude-fable-5-2", { modelSettings: { "claude-fable-5-2": { effortLevel: "xhigh" } } }) === 967_000, "모델 설정에 생각 깊이만 있으면 기본");
ok(at("claude-haiku-4-5-20251001", { modelSettings: { "claude-haiku-4-5": { autoCompactWindow: 150_000 } } }) === 150_000, "날짜가 붙은 모델 이름은 날짜 없는 이름으로 찾음");
ok(at("claude-opus-4-6", { autoCompactWindow: 500_000 }) === K200, "기억 용량보다 큰 값은 기억 용량까지만");
ok(at("claude-fable-5-2", { autoCompactWindow: 50_000 }) === 967_000 && at("claude-fable-5-2", { autoCompactWindow: "500000" }) === 967_000 && at("claude-fable-5-2", { autoCompactWindow: 300_000.5 }) === 967_000,
  "쓸 수 없는 값(10만 미만·글자·소수)은 기본");
ok(at("claude-fable-5-2", { autoCompactWindow: 1_000_000 }) === M && at("claude-fable-5-2", { autoCompactWindow: 100_000 }) === 100_000, "설정할 수 있는 양 끝(10만·100만)");
ok(contextInfo("claude-fable-5-2", 1000, { autoCompactEnabled: false }).auto === false, "자동 압축을 끔(설정)");
ok(contextInfo("claude-fable-5-2", 1000, {}, { DISABLE_AUTO_COMPACT: "1" }).auto === false && contextInfo("claude-fable-5-2", 1000, { autoCompactEnabled: true }, { DISABLE_AUTO_COMPACT: "1" }).auto === false,
  "자동 압축을 끔(환경 변수는 설정보다 먼저)");
ok(contextInfo("claude-fable-5-2", 1000, { autoCompactEnabled: true }, { DISABLE_AUTO_COMPACT: "0" }).auto === true && contextInfo("claude-fable-5-2", 1000, {}, {}).auto === true, "끄지 않았으면 켜짐");

// 4. 대화 기록에서 사용량 따라가기(줄 모양은 실제 기록에서 본뜸)
const use = (input, write, read, out) => ({
  input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: out,
  output_tokens_details: {}, server_tool_use: { web_search_requests: 0 }, service_tier: "standard", cache_creation: { ephemeral_1h_input_tokens: write }, iterations: [], speed: "standard",
});
const ans = (uuid, id, usage, extra = {}) => ({ type: "assistant", uuid, timestamp: "2026-11-17T09:00:00.000Z", message: { id, model: "claude-fable-5-2", content: [{ type: "text", text: "답" }], stop_reason: "end_turn", usage }, ...extra });
const v = createConverter();
ok(v.usage() === null && contextInfo(v.model(), v.usage()) === null, "답이 오기 전에는 모름(고리 없음)");
v.add({ type: "user", uuid: "u1", message: { role: "user", content: "안녕" } });
ok(v.usage() === null, "내 글만으로는 모름");
v.add(ans("a1", "m1", use(3, 1_000, 150_000, 9_999)));
ok(v.usage() === 151_003, `입력 토큰 합계 = 새 입력 + 캐시에 쓴 것 + 캐시에서 읽은 것, 출력은 뺌(${v.usage()})`);
v.add(ans("a2", "m1", use(3, 1_000, 150_000, 9_999)));
ok(v.usage() === 151_003, "같은 응답의 다음 조각은 같은 값");
v.add(ans("s1", "ms", use(1, 2, 3, 4), { isSidechain: true }));
ok(v.usage() === 151_003, "하위 에이전트의 줄은 보지 않음");
v.add({ type: "assistant", uuid: "e1", isApiErrorMessage: true, message: { id: "me", model: "<synthetic>", content: [{ type: "text", text: "API Error" }], usage: use(0, 0, 0, 0) } });
ok(v.usage() === 151_003 && v.model() === "claude-fable-5-2", "오류 안내 줄(Claude Code 가 지어 넣은 줄)로 0 이 되지 않음");
v.add({ type: "assistant", uuid: "n1", message: { id: "mn", model: "claude-fable-5-2", content: [{ type: "text", text: "사용량 없는 줄" }] } });
ok(v.usage() === 151_003, "사용량이 없는 줄은 앞 값을 그대로");
v.add(ans("a3", "m2", use(10, 0, 199_990, 5)));
ok(v.usage() === 200_000 && Math.abs(contextInfo(v.model(), v.usage()).percent - 20) < 1e-9, "다음 응답으로 갱신(20%)");
v.add({ type: "system", subtype: "compact_boundary", uuid: "c1", content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 967_452, postTokens: 44_018 } });
const afterCompact = contextInfo(v.model(), v.usage());
ok(v.usage() === null && afterCompact.tokens === null && afterCompact.percent === null && afterCompact.window === M, "압축이 끝나면 다음 응답까지 모름(기억 용량은 그대로)");
ok(v.add({ type: "user", uuid: "u9", isCompactSummary: true, message: { role: "user", content: "요약" } })[0]?.role === "summary" && v.usage() === null, "요약 줄은 대화에 보이고 사용량은 아직 모름");
v.add({ type: "system", subtype: "turn_duration", uuid: "t1", durationMs: 5 });
ok(v.usage() === null, "다른 시스템 줄은 상관없음");
v.add(ans("a4", "m3", use(5, 100_000, 44_645, 1)));
ok(v.usage() === 144_650, "압축 뒤 첫 응답으로 다시 앎");
v.add({ ...ans("a5", "m4", use(1, 2, 3, 4)), message: { ...ans("a5", "m4", use(1, 2, 3, 4)).message, model: "claude-opus-4-6" } });
ok(contextInfo(v.model(), v.usage()).window === K200, "모델을 바꾸면 그 모델의 기억 용량으로");

console.log(fail ? `\n실패 ${fail}개` : "\n컨텍스트 사용량 판정 모두 통과");
process.exit(fail ? 1 : 0);
