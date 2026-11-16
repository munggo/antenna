// 백그라운드 일의 모델·생각 깊이 판정(모델·tmux 를 부르지 않음).
// - bgLine: 맥 화면 상태 줄 아래 한 줄(맡긴 백그라운드 탭·하위 에이전트·화면에서 센 셸 수)
// - thinkingKo·prettyModel: 깊이의 짧은 한글, 모델 짧은 이름(이미 짧으면 그대로)
// - subagentThinking: Claude Code 문서의 순서(환경 변수 > 갈래 > 부를 때 깊이 > 정의 > 같은 모델이면 세션 깊이), 모르면 ""
// - agentDefEffort: 정의 파일의 effort(프로젝트가 먼저)
// 실행: node claude-remote/test/bg-line-cases.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bgLine, prettyModel, thinkingKo } from "../bg-launch.mjs";
import { agentDefEffort, subagentThinking } from "../claude-feed.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const eq = (a, b, n) => ok(a === b, `${n} → ${JSON.stringify(a)}`);

// ── bgLine ──
eq(bgLine({}), "", "보일 것이 없으면 빈 글");
eq(bgLine(), "", "인자 없이도 빈 글");
eq(bgLine({ tabs: [{ name: "하네스 조사", model: "Opus 5.5", thinking: "high" }] }), "백그라운드: 하네스 조사 Opus 5.5 높음", "맡긴 백그라운드 탭: 이름·모델·깊이");
eq(bgLine({ tabs: [{ name: "문서 정리", model: "", thinking: "" }] }), "백그라운드: 문서 정리", "모델을 모르는 탭은 이름만");
eq(bgLine({ agents: [{ type: "Explore", model: "Haiku 5.5", thinking: "" }] }), "백그라운드: 에이전트 Explore Haiku 5.5", "깊이를 모르는 에이전트는 모델까지만");
eq(bgLine({ agents: [{ type: "Explore", model: "Haiku 5.5", thinking: "" }, { type: "Explore", model: "Haiku 5.5", thinking: "" }, { type: "fork", model: "Opus 5.5", thinking: "max" }] }),
  "백그라운드: 에이전트 Explore Haiku 5.5 ×2 · 에이전트 fork Opus 5.5 최대", "같은 종류·모델·깊이는 묶어 ×N");
eq(bgLine({ agents: [{ type: "general-purpose", model: "", thinking: "" }] }), "백그라운드: 에이전트 general-purpose", "모델을 모르는 에이전트는 종류만");
eq(bgLine({ jobs: "셸 2개" }), "백그라운드: 셸 2", "화면에서 센 셸 수만 있어도 보임");
eq(bgLine({ agents: [{ type: "Explore", model: "Haiku 5.5", thinking: "" }], jobs: "셸 1개 · 에이전트 3개" }),
  "백그라운드: 에이전트 Explore Haiku 5.5 · 에이전트 2 · 셸 1", "화면의 에이전트 수가 더 많으면 모르는 만큼 '에이전트 N'");
eq(bgLine({ agents: [{ type: "Explore", model: "Haiku 5.5", thinking: "" }, { type: "Plan", model: "Opus 5.5", thinking: "" }], jobs: "에이전트 1개" }),
  "백그라운드: 에이전트 Explore Haiku 5.5 · 에이전트 Plan Opus 5.5", "화면 수가 더 적으면(화면이 늦음) 기록대로만");
eq(bgLine({ jobs: "셸 1개 · 감시 1개 · 프로세스 2개" }), "백그라운드: 셸 1 · 감시 1 · 프로세스 2", "모델 없는 일은 종류별 수");
eq(bgLine({ jobs: "셸 1개 · 셸 2개" }), "백그라운드: 셸 3", "같은 종류가 두 번 나오면 합함");
eq(bgLine({ tabs: [{ name: "a", model: "Opus 5.5", thinking: "low" }], agents: [{ type: "Explore", model: "Haiku 5.5", thinking: "" }], jobs: "셸 1개 · 에이전트 1개" }),
  "백그라운드: a Opus 5.5 낮음 · 에이전트 Explore Haiku 5.5 · 셸 1", "순서: 탭 → 에이전트 → 셸");

// ── thinkingKo·prettyModel ──
ok(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(thinkingKo).join("|") === "생각 끔|최소|낮음|보통|높음|매우 높음|최대", "깊이 단계마다 짧은 한글");
eq(thinkingKo("turbo") + thinkingKo("") + thinkingKo(undefined), "", "모르는 깊이는 빈 글");
eq(prettyModel("claude-opus-5-5"), "Opus 5.5", "모델 ID → 짧은 이름");
eq(prettyModel("claude/claude-haiku-4-5-20251001"), "Haiku 4.5", "공급자·날짜가 붙은 ID");
eq(prettyModel("Opus 5.5"), "Opus 5.5", "이미 짧은 이름은 그대로(두 번 줄여도 같음)");
eq(prettyModel(""), "", "빈 값은 빈 글");

// ── subagentThinking: 문서 순서 ──
const base = { type: "general-purpose", effort: undefined, defEffort: "", model: "claude-opus-5-5", parentModel: "claude-opus-5-5", parentThinking: "xhigh", envEffort: undefined };
const st = (o) => subagentThinking({ ...base, ...o });
eq(st({ envEffort: "low", type: "fork", effort: "max", defEffort: "high" }), "low", "환경 변수 CLAUDE_CODE_EFFORT_LEVEL 이 가장 먼저");
eq(st({ type: "fork", effort: "low", model: "claude-haiku-5-5" }), "xhigh", "갈래(fork)는 시킨 쪽 깊이 그대로(부를 때 적은 깊이는 무시)");
eq(st({ effort: "low", model: "claude-haiku-5-5" }), "low", "부를 때 적은 깊이(다른 모델이어도)");
eq(st({ defEffort: "high", model: "claude-haiku-5-5" }), "high", "정의에 적힌 깊이");
eq(st({ effort: "low", defEffort: "high" }), "low", "부를 때 적은 깊이가 정의보다 먼저");
eq(st({}), "xhigh", "깊이 지정이 없고 시킨 쪽과 같은 모델이면 세션 깊이");
eq(st({ model: "claude-haiku-5-5" }), "", "다른 모델인데 지정이 없으면 모름");
eq(st({ parentThinking: "" }), "", "같은 모델이어도 세션 깊이를 모르면 모름");
eq(st({ effort: "turbo", defEffort: "nope" }), "xhigh", "잘못된 값은 넘어가고 다음 규칙");
eq(st({ model: "claude-opus-5-5[1m]" }), "xhigh", "모델 뒤 [1m] 같은 꼬리는 빼고 견줌");
eq(st({ model: "" }), "", "실제 모델을 모르면(예전 판 기록) 세션 깊이를 쓰지 않음");
eq(st({ parentThinking: "minimal" }), "", "Claude Code 에 없는 단계(pi 의 minimal)는 쓰지 않음");

// ── agentDefEffort ──
const T = join(tmpdir(), `bgline-${process.pid}`);
const proj = join(T, "proj"), home = join(T, "home");
mkdirSync(join(proj, ".claude", "agents"), { recursive: true });
mkdirSync(join(home, ".claude", "agents"), { recursive: true });
writeFileSync(join(proj, ".claude", "agents", "rev.md"), "---\nname: reviewer\ndescription: 검토\neffort: high\n---\n본문\n");
writeFileSync(join(home, ".claude", "agents", "reviewer.md"), "---\nname: reviewer\neffort: low\n---\n");
writeFileSync(join(home, ".claude", "agents", "helper.md"), "---\r\ndescription: 이름 칸 없음\r\neffort: \"medium\"\r\n---\r\n");
writeFileSync(join(home, ".claude", "agents", "plain.md"), "---\nname: plain\nmodel: haiku\n---\n");
try {
  eq(agentDefEffort("reviewer", proj, home), "high", "프로젝트 정의가 사용자 정의보다 먼저");
  eq(agentDefEffort("reviewer", "", home), "low", "프로젝트 폴더를 모르면 사용자 정의");
  eq(agentDefEffort("helper", proj, home), "medium", "이름 칸이 없으면 파일 이름, 따옴표·윈도 줄바꿈도 읽음");
  eq(agentDefEffort("plain", proj, home), "", "정의에 깊이가 없으면 빈 글");
  eq(agentDefEffort("general-purpose", proj, home), "", "정의가 없는 기본 에이전트는 빈 글");
  eq(agentDefEffort("reviewer", join(T, "없는폴더"), join(T, "없는홈")), "", "폴더가 없으면 빈 글");
} finally {
  rmSync(T, { recursive: true, force: true });
}

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
