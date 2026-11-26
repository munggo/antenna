/**
 * 탭 목록(앱 서랍·☰ 점용): tmux list-windows 출력 → 앱에 보낼 모양.
 * - 백그라운드 탭(/bgtab·AI·폰·단축어가 연 탭)은 탭 옵션 @bg_by(시킨 쪽 user | ai | phone | shortcut)가 있다.
 *   단축어로 시킨 탭은 시킨 칸이 없다(from 이 null).
 *   @bg_started(시작)·@bg_done(끝나 결과를 보낸 때)은 초 단위 시각. 시킨 칸은 @bg_from(결과를 보낸 뒤에도 남음),
 *   그 옵션이 없는 예전 탭은 @bg_origin(결과를 보내면 지워짐)
 * - 뒤에서 도는 일은 @ai_jobs(Claude Code 연결부가 서랍에서 눌러 보는 목록과 같은 기준, 곧 실제로 도는 셸·에이전트·감시만 세어
 *   '셸 1개 · 에이전트 2개'처럼 적음. 11-24 부터 화면 모드 줄의 수는 쓰지 않음)
 * - 그 탭의 모델·생각 깊이는 @ai_model·@ai_thinking(Claude Code 는 연결부·브리지, pi 는 확장이 적음). 앱 서랍의 백그라운드 탭 줄에 보임(11-16)
 * 작성: 서문교
 */
const SEP = ":::";

/**
 * 탭을 고르면(맥에서 바꾸든 폰에서 바꾸든 select-window) 그 탭의 '끝났어요'(@pi_status = yourturn)를 지우는 tmux 훅.
 * 예전에는 pi 확장(tmux-tab-status)만 이 훅을 걸어서, pi 를 켜지 않은 맥(재부팅 뒤 Claude Code 탭만 되살린 때 등)에서는
 * 탭을 열어 봐도 '끝났어요'가 남았다(11-19). 브리지가 세션을 챙길 때마다 건다(여러 번 걸어도 같음).
 * pi 확장이 거는 [0] 칸과 겹치지 않게 다른 칸에, 외부 스크립트 없이 tmux 명령으로. 작업 중·답을 기다림은 그대로 둔다
 */
export const SEEN_HOOK = "after-select-window[47]";
export const SEEN_HOOK_CMD = `if-shell -F '#{==:#{@pi_status},yourturn}' 'set-option -w @pi_status ""'`;
const FIELDS = ["window_id", "window_index", "window_name", "window_active", "@pi_status", "@sudo_stage", "pane_id",
  "@bg_by", "@bg_started", "@bg_done", "@bg_from", "@bg_origin", "@ai_jobs", "@ai_model", "@ai_thinking",
  "@ai_account", "@ai_account_pin", "@ai_account_next", "@ai_account_phase"];
export const WINDOW_FORMAT = FIELDS.map((f) => `#{${f}}`).join(SEP);

/**
 * list-windows 출력 → [{ id, index, name, active, status, sudo, bg, jobs, model, thinking, account, key }]. id(창 고유 번호)는 맥 쪽에서만 쓴다.
 * key: 그 탭 칸의 번호(%12 처럼). 폰이 탭마다 대화를 저장해 두는 열쇠다(탭 순서가 바뀌어도 같음, 11-25)
 * account: Claude Code 탭의 계정(연결부가 적음, 11-18) { now: 지금 계정, pin: 앱에서 고른 계정(없으면 자동), next: 바꿀 계정,
 * phase: wait(일이 끝나기를 기다림) | switch(바꾸는 중) } — 모르면(Claude Code 탭이 아니거나 예전 연결부) null
 */
export function parseWindows(out) {
  const rows = String(out ?? "").split("\n").filter(Boolean).map((line) => {
    const [id, index, name, active, status, sudo, pane, by, started, done, from, origin, jobs, model, thinking, acNow, acPin, acNext, acPhase] = line.split(SEP);
    const account = acNow ? { now: acNow, pin: acPin || "", next: acNext || "", phase: acPhase || "" } : null;
    return { id, index: parseInt(index, 10), name: name || "", active: active === "1", status: status || "", sudo: sudo || "",
      pane, by, started, done, from: from || origin || "", jobs: jobs || "", model: model || "", thinking: thinking || "", account };
  });
  const byPane = new Map(rows.map((r) => [r.pane, r]));
  return rows.map((r) => {
    const src = r.from ? byPane.get(r.from) : undefined;
    const bg = r.by
      ? { by: r.by, started: Number(r.started) || 0, done: Number(r.done) || 0, from: src ? src.index : null, fromName: src ? src.name : "" }
      : null;
    return { id: r.id, index: r.index, name: r.name, active: r.active, status: r.status, sudo: r.sudo, bg, jobs: r.jobs, model: r.model, thinking: r.thinking, account: r.account, key: r.pane || "" };
  });
}

/** 앱에 보낼 모양(창 고유 번호는 뺌) */
export const forApp = (windows) => windows.map(({ id, ...w }) => w);

/** '끝난 것 모두 닫기'로 닫을 탭인지: 결과를 보낸 백그라운드 탭 가운데 다시 일하거나 묻지 않고, 뒤에서 도는 일도 없는 것(앱도 같은 규칙) */
export const isFinishedBackground = (w) => Boolean(w.bg && w.bg.done > 0 && w.status !== "working" && w.status !== "asking" && !w.jobs);

/** 닫을 탭들의 창 고유 번호. 세션에 탭이 하나도 남지 않게는 닫지 않는다(그럴 땐 맨 앞 하나를 남김) */
export function finishedBackgroundIds(windows) {
  const ids = windows.filter(isFinishedBackground).map((w) => w.id);
  return ids.length >= windows.length ? ids.slice(1) : ids;
}
