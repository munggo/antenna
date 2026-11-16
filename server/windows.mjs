/**
 * 탭 목록(앱 서랍·☰ 점용): tmux list-windows 출력 → 앱에 보낼 모양.
 * - 백그라운드 탭(/bgtab·AI·폰이 연 탭)은 탭 옵션 @bg_by(시킨 쪽 user | ai | phone)가 있다.
 *   @bg_started(시작)·@bg_done(끝나 결과를 보낸 때)은 초 단위 시각. 시킨 칸은 @bg_from(결과를 보낸 뒤에도 남음),
 *   그 옵션이 없는 예전 탭은 @bg_origin(결과를 보내면 지워짐)
 * - 뒤에서 도는 일은 @ai_jobs(Claude Code 연결부가 화면 맨 아래의 '· 1 shell' 같은 것을 읽어 '셸 1개'처럼 적음)
 * - 그 탭의 모델·생각 깊이는 @ai_model·@ai_thinking(Claude Code 는 연결부·브리지, pi 는 확장이 적음). 앱 서랍의 백그라운드 탭 줄에 보임(11-16)
 * 작성: 서문교
 */
const SEP = ":::";
const FIELDS = ["window_id", "window_index", "window_name", "window_active", "@pi_status", "@sudo_stage", "pane_id",
  "@bg_by", "@bg_started", "@bg_done", "@bg_from", "@bg_origin", "@ai_jobs", "@ai_model", "@ai_thinking"];
export const WINDOW_FORMAT = FIELDS.map((f) => `#{${f}}`).join(SEP);

/** list-windows 출력 → [{ id, index, name, active, status, sudo, bg, jobs, model, thinking }]. id(창 고유 번호)는 맥 쪽에서만 쓴다 */
export function parseWindows(out) {
  const rows = String(out ?? "").split("\n").filter(Boolean).map((line) => {
    const [id, index, name, active, status, sudo, pane, by, started, done, from, origin, jobs, model, thinking] = line.split(SEP);
    return { id, index: parseInt(index, 10), name: name || "", active: active === "1", status: status || "", sudo: sudo || "",
      pane, by, started, done, from: from || origin || "", jobs: jobs || "", model: model || "", thinking: thinking || "" };
  });
  const byPane = new Map(rows.map((r) => [r.pane, r]));
  return rows.map((r) => {
    const src = r.from ? byPane.get(r.from) : undefined;
    const bg = r.by
      ? { by: r.by, started: Number(r.started) || 0, done: Number(r.done) || 0, from: src ? src.index : null, fromName: src ? src.name : "" }
      : null;
    return { id: r.id, index: r.index, name: r.name, active: r.active, status: r.status, sudo: r.sudo, bg, jobs: r.jobs, model: r.model, thinking: r.thinking };
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
