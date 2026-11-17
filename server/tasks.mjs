/**
 * 단축어로 시킨 일(앱의 단축어 동작 '맥의 AI 에게 일 시키기'): 폰이 짧은 접속('/push')으로 보낸 할 일을 새 백그라운드 탭에서 시작한다.
 * - 폰의 사건(시간·도착·충전·NFC 등)에 걸어 둔 단축어 자동화가 앱을 뒤에서 깨워 보낸다. 앱을 열지 않으므로 '보는 탭'이 없다
 *   → 어느 도구(Claude Code | pi)로, 어느 폴더에서 시작할지를 요청에 싣는다(폴더를 비우면 홈 폴더. 앱의 '새 탭'과 같음)
 * - 탭은 폰의 '백그라운드로 보내기'와 같은 실행기(claude-remote/bg-launch.mjs)로 연다. 시킨 쪽은 'shortcut':
 *   끝나면 그 탭의 연결부가 걸린 시간과 상관없이 폰에 알리고, 앱 서랍의 '백그라운드' 칸에 '단축어로 시킴'으로 보인다
 * - 앱은 맥 주소 후보마다 같은 요청을 보낸다(먼저 닿는 길을 모름) → 요청 번호(id)가 같은 것은 한 번만 실행하고 같은 답을 돌려준다
 * 작성: 서문교
 */
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** 같은 요청 번호를 기억하는 시간(앱은 12초 안에 그만두므로 넉넉히) */
const KEEP_MS = 5 * 60_000;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_TASK = 100_000;

/** 요청의 폴더 글 → 절대 경로. 비어 있으면 홈 폴더, '~'·'~/x' 와 상대 경로('works/x')는 홈 폴더 아래로 */
export function resolveFolder(input, home) {
  const s = String(input ?? "").trim();
  if (!s || s === "~") return home;
  if (s.startsWith("~/")) return resolve(home, s.slice(2));
  return isAbsolute(s) ? resolve(s) : resolve(home, s);
}

const isFolder = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * 요청 처리기를 만든다 → start(요청) 은 폰에 돌려줄 답:
 *   { type: "task-started", id, window, name } | { type: "task-failed", id, reason, message }
 * launch: 탭을 여는 함수(bg-launch.mjs 의 launchBackground).
 * 그 도구가 맥에 깔려 있는지는 여기서 가리지 않는다: 새 탭의 로그인 셸이 찾으므로 브리지가 아는 자리와 다를 수 있다(앱의 '새 탭'도 같음)
 */
export function createTaskStarter({ launch, home, session, now = Date.now, log = () => {} }) {
  const seen = new Map();   // 요청 번호 → { at, reply }
  const run = (m, id) => {
    const fail = (reason, message) => ({ type: "task-failed", id, reason, message });
    const text = typeof m.text === "string" ? m.text.trim().slice(0, MAX_TASK) : "";
    if (!text) return fail("empty", "할 일이 비어 있어요");
    const agent = m.agent === undefined || m.agent === "" ? "claude" : m.agent;
    if (agent !== "claude" && agent !== "pi") return fail("agent", `모르는 도구예요: ${String(agent).slice(0, 40)}`);
    const cwd = resolveFolder(m.cwd, home);
    if (!isFolder(cwd)) return fail("folder", `그 폴더가 맥에 없어요: ${String(m.cwd ?? "").trim().slice(0, 200)}`);
    try {
      const r = launch({ agent, cwd, task: text, originPane: "", by: "shortcut", session });
      log(`단축어로 시킨 일: 탭 ${r.window}(${r.name}, ${agent}, ${cwd})`);
      return { type: "task-started", id, window: r.window, name: r.name };
    } catch (e) {
      return fail("launch", `맥에서 새 탭을 열지 못했어요: ${e.message}`);
    }
  };
  return function start(m) {
    const id = String(m?.id ?? "");
    if (!ID_RE.test(id)) return { type: "task-failed", id: "", reason: "bad-request", message: "요청 번호가 잘못됐어요" };
    for (const [k, v] of seen) if (now() - v.at > KEEP_MS) seen.delete(k);
    const done = seen.get(id);
    if (done) return done.reply;
    const reply = run(m, id);
    seen.set(id, { at: now(), reply });
    return reply;
  };
}
