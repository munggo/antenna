/**
 * 화면 글에서 현재 모델·생각 깊이를 읽는다(브리지가 앱의 모델·생각 깊이 칩과 선택 메뉴의 현재 값에 쓴다).
 * - pi: 화면 맨 아래 줄이 상태 줄 — '경로 [브랜치] 모델 (생각) …'
 * - Claude Code: 입력창 아래 가로줄 밑에 같은 모양의 상태 줄(~/.claude/statusline.py)이 있고, 그 아래 모드 줄이 하나 더 있다.
 *   이 줄은 Claude Code 가 주는 현재 값이라, 세션에서 바꾼 생각 깊이나 모델별 값도 그대로 보인다
 * 마지막 가로줄 아래의 줄에서만 찾는다(대화나 입력창에 쓴 글을 상태 줄로 잘못 읽지 않게). 가로줄이 가까이 없으면 맨 아래 줄만 본다.
 * 맥 입력창이 비었는지(editorEmpty)도 여기서 본다.
 * 작성: 서문교
 */
export const LEVELS = "off|minimal|low|medium|high|xhigh|max";
const STATUS = new RegExp(`^\\S+(?:\\s+\\[[^\\]]*\\])?\\s+(.+?)\\s+\\((${LEVELS})\\)`);
const isRule = (l) => (l.match(/─/g) || []).length >= 20;

/** → { model, thinking, last } 또는 null. last: 그 줄이 화면 맨 아래 줄인지(pi 는 맨 아래, Claude Code 는 아래에 모드 줄이 더 있음) */
export function parseStatusLine(screen) {
  const lines = String(screen ?? "").split("\n").filter((l) => l.trim());
  if (!lines.length) return null;
  let from = lines.length - 1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    if (isRule(lines[i])) {
      from = i + 1;
      break;
    }
  }
  for (let i = from; i < lines.length; i++) {
    const m = lines[i].trim().match(STATUS);
    if (m) return { model: m[1], thinking: m[2], last: i === lines.length - 1 };
  }
  return null;
}

/**
 * 맥 입력창이 비었는지(폰에서 보낸 /명령을 붙여 넣어도 되는지). 화면 맨 아래쪽 가로줄 두 개 사이가 입력창이다.
 * 쓰던 글이 있으면 명령이 그 글과 합쳐져 메시지로 나가 버리므로, 모양을 못 찾으면(선택 창이 떠 있는 등) 비지 않은 것으로 본다.
 * - pi: 비면 빈 줄뿐
 * - Claude Code: 비어 있어도 '❯' 표시가 있고, 안내 문구('Try "…"')가 흐리게 보이기도 한다
 *   (11-15: 이걸 쓰던 글로 봐서 Claude Code 탭에서는 폰에서 보낸 /명령이 늘 막혔다)
 */
export function editorEmpty(screen) {
  const lines = String(screen ?? "").split("\n");
  const rules = [];
  lines.forEach((l, i) => {
    if (isRule(l)) rules.push(i);
  });
  if (rules.length < 2) return false;
  const [a, b] = rules.slice(-2);
  const inside = lines.slice(a + 1, b).map((l) => l.trim()).filter(Boolean);
  if (!inside.length) return true;
  if (inside.length > 1 || !/^❯/.test(inside[0])) return false;
  const t = inside[0].replace(/^❯\s*/, "");
  return t === "" || /^Try ".*"$/.test(t);
}
