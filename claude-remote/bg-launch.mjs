/**
 * 백그라운드 탭(/bgtab): 같은 tmux 세션 끝에 새 탭을 열고, 시킨 탭과 같은 것(pi | Claude Code)을 할 일과 함께 켬
 * - 새 탭은 로그인 셸 안에서 켬: 셸 함수 claude()(계정 고르기)가 쓰이고, 끝나도 셸이 남아 이어 쓸 수 있음
 * - 탭 옵션 @bg_origin(시킨 칸)·@bg_by(user | ai | phone | shortcut)·@bg_name: 그 탭의 연결부가 끝났을 때 읽어
 *   폰 알림(시간과 상관없이)과 시킨 탭에 결과 요약을 보냄. 보낸 뒤 @bg_origin 은 지우고 @bg_done(끝난 때)을 적음.
 *   단축어로 시킨 탭(shortcut: 폰의 단축어 동작이 브리지에 보낸 일, server/tasks.mjs)은 시킨 칸이 없어 폰 알림만 보냄
 * - @bg_from(시킨 칸, 지우지 않음)·@bg_started(시작): 앱 서랍의 '백그라운드' 칸이 시킨 탭·걸린 시간을 보임(server/windows.mjs)
 * - 맥 화면의 '백그라운드: …' 한 줄(bgLine): 시킨 탭에서, 맡긴 백그라운드 탭과 뒤에서 도는 하위 에이전트를 모델·생각 깊이와 함께 보임.
 *   Claude Code 는 연결부가 칸 옵션 @ai_bg_line 에 적고 상태 줄 스크립트가 붙이며, pi 는 확장이 입력창 아래 위젯으로 보임(사용자 결정 11-16)
 * 쓰는 곳: pi 확장 bgtab.ts(/bgtab·background_task 도구)·pi-remote-feed.ts(위젯), Claude Code 훅(/bgtab)·연결부,
 *          브리지(폰 '백그라운드로 보내기'·단축어로 시킨 일)
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 폰에 보일 글의 언어(PI_REMOTE_LANG). 설치본은 같은 폴더(Claude Code 쪽)나 lib/(pi 쪽), 저장소에서는 pi-extension/lib/
const LANG_FILE = ["lang.mjs", "../pi-extension/lib/lang.mjs"].map((f) => join(dirname(fileURLToPath(import.meta.url)), f)).find((p) => existsSync(p));
const { tr } = LANG_FILE ? await import(LANG_FILE) : { tr: (ko) => ko };

const HOME = process.env.HOME ?? "";
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? "tmux";
const tmux = (...a) => execFileSync(TMUX, a, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();

/** 탭 이름: 'bg ' + 할 일의 앞부분(사진 경로는 빼고, 글자 12개까지) */
export function shortName(task) {
  const t = String(task ?? "").replace(/@\S+/g, " ").replace(/\s+/g, " ").trim();
  const chars = [...t];
  return tr(`bg ${chars.length > 12 ? `${chars.slice(0, 12).join("")}…` : t || "작업"}`, `bg ${chars.length > 12 ? `${chars.slice(0, 12).join("")}…` : t || "task"}`);
}

/** 새 탭에서 실행할 셸 줄: 할 일 파일을 읽어 지우고 pi/claude 를 그 글과 함께 켬. 끝나면 로그인 셸로 남음 */
export function shellScript(agent, file, shell) {
  // 시험: PI_BG_PI_CMD·PI_BG_CLAUDE_CMD 로 켤 명령을 바꿈(저장소의 확장·훅을 쓰는 감싼 실행 파일)
  const run = agent === "pi" ? `${process.env.PI_BG_PI_CMD || "pi"} -- "$t"` : `${process.env.PI_BG_CLAUDE_CMD || "claude"} "$t"`;
  return `t="$(cat '${file}')"; rm -f '${file}'; ${run}; exec ${shell} -l`;
}

/** 새 탭 열기 → { window, pane, name, session }. 실패하면 오류(메시지는 한국어) */
export function launchBackground({ agent, cwd, task, originPane = "", by = "user", session = "", env = {} }) {
  const body = String(task ?? "").trim();
  if (!body) throw new Error("할 일을 적어 주세요. 예: /bgtab 테스트 고치기");
  if (agent !== "pi" && agent !== "claude") throw new Error(`모르는 종류: ${agent}`);
  let sess = session;
  if (!sess && originPane) {
    try {
      sess = tmux("display", "-p", "-t", originPane, "#{session_name}");
    } catch {
      /* 시킨 칸이 없으면 기본 세션 */
    }
  }
  sess ||= process.env.PI_TMUX_SESSION || "antenna";
  const dir = `${HOME}/.cache/pi-remote/bg`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`;
  // '-'로 시작하면 옵션으로 읽히지 않게
  writeFileSync(file, body.startsWith("-") ? tr(`작업: ${body}`, `Task: ${body}`) : body, { mode: 0o600 });
  const shell = process.env.SHELL && /\/(zsh|bash)$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/zsh";
  const name = shortName(body);
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const out = tmux("new-window", "-d", "-P", "-F", "#{window_index} #{pane_id}", "-t", `${sess}:`, "-c", cwd || HOME, "-n", name, ...envArgs,
    "/usr/bin/env", "DISABLE_AUTO_UPDATE=true", shell, "-lic", shellScript(agent, file, shell));   // oh-my-zsh 업데이트 질문에서 멈추지 않게
  const [win, pane] = out.split(" ");
  for (const [k, v] of [["@bg_origin", originPane || ""], ["@bg_from", originPane || ""], ["@bg_by", by], ["@bg_name", name], ["@bg_started", String(Math.floor(Date.now() / 1000))]]) {
    tmux("set-option", "-w", "-t", pane, k, v);
  }
  return { window: Number(win), pane, name, session: sess };
}

/** 이 칸의 백그라운드 정보(없으면 null): 끝났을 때 연결부가 읽음.
 *  보고할 것이 남은 탭만: 시킨 칸(@bg_origin)이 있거나, 단축어로 시킨 탭(시킨 칸이 없음)이 아직 끝난 때(@bg_done)를 적지 않았을 때 */
export function bgInfo(pane) {
  let out = "";
  try {
    out = tmux("show-options", "-w", "-t", pane);
  } catch {
    return null;
  }
  const get = (k) => (out.match(new RegExp(`^${k} (.*)$`, "m")) ?? [])[1]?.replace(/^(["'])(.*)\1$/, "$2") ?? "";
  const origin = get("@bg_origin");
  const by = get("@bg_by") || "user";
  if (!origin && !(by === "shortcut" && !get("@bg_done"))) return null;
  return { origin, by, name: get("@bg_name") || "bg" };
}

/** 모델 ID → 짧은 이름('claude-opus-5-5' → 'Opus 5.5'). 이미 짧은 이름이면 그대로 */
export function prettyModel(id) {
  const parts = String(id ?? "").replace(/^.*\//, "").split("-").filter((p) => p !== "claude" && !/^\d{8}$/.test(p));
  const fam = parts.find((p) => /^[a-z]+$/i.test(p));
  if (!fam) return String(id ?? "");
  const ver = parts.filter((p) => /^\d+$/.test(p)).join(".");
  return `${fam[0].toUpperCase()}${fam.slice(1)}${ver ? ` ${ver}` : ""}`;
}

/** 생각 깊이 → 짧은 한글(앱 서랍·작업 목록과 같은 낱말). 모르는 값은 "" */
const THINKING_KO = { off: "생각 끔", minimal: "최소", low: "낮음", medium: "보통", high: "높음", xhigh: "매우 높음", max: "최대" };
export const thinkingKo = (level) => THINKING_KO[String(level ?? "")] ?? "";

const SEP = ":::";
/** 이 칸이 시킨 백그라운드 탭 가운데 아직 일하는 것(결과를 보내기 전이거나, 보낸 뒤 다시 일하거나 묻는 것) → [{ name, model, thinking }] */
export function bgTabsFrom(pane) {
  if (!pane) return [];
  let out = "";
  try {
    out = tmux("list-windows", "-a", "-F", ["@bg_from", "@bg_origin", "@bg_done", "@pi_status", "window_name", "@ai_model", "@ai_thinking"].map((f) => `#{${f}}`).join(SEP));
  } catch {
    return [];
  }
  return out.split("\n").filter(Boolean).map((l) => l.split(SEP))
    .filter(([from, origin, done, status]) => (from || origin) === pane && (!Number(done) || status === "working" || status === "asking"))
    .map(([, , , , name, model, thinking]) => ({ name: name.replace(/^bg /, ""), model: prettyModel(model), thinking }));
}

/**
 * 맥 화면에 보일 한 줄 → "백그라운드: 하네스 조사 Opus 5.5 높음 · 에이전트 Explore Haiku 5.5 ×2 · 셸 2". 보일 것이 없으면 "".
 * tabs: bgTabsFrom 결과. agents: 뒤에서 도는 하위 에이전트 [{ type, model(짧은 이름), thinking }], 모르는 값은 "".
 * jobs: 화면 맨 아래에서 센 뒤에서 도는 일('셸 2개 · 에이전트 3개'). 셸·감시처럼 모델이 없는 일은 그 수를 그대로 쓰고,
 * 에이전트는 대화 기록에서 찾지 못한 만큼만 '에이전트 N'으로 더한다
 */
export function bgLine({ tabs = [], agents = [], jobs = "" } = {}) {
  const words = (...a) => a.filter(Boolean).join(" ");
  const parts = tabs.map((t) => words(t.name, t.model, thinkingKo(t.thinking)));
  const groups = new Map();
  for (const a of agents) {
    const k = words("에이전트", a.type, a.model, thinkingKo(a.thinking));
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  for (const [k, n] of groups) parts.push(n > 1 ? `${k} ×${n}` : k);
  const counts = new Map();
  for (const m of String(jobs).matchAll(/(\S+) (\d+)개/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + Number(m[2]));
  const more = (counts.get("에이전트") ?? 0) - agents.length;
  if (more > 0) parts.push(`에이전트 ${more}`);
  for (const [kind, n] of counts) if (kind !== "에이전트") parts.push(`${kind} ${n}`);
  return parts.length ? `백그라운드: ${parts.join(" · ")}` : "";
}
