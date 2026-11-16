/**
 * tmux 탭 저장·되살리기(재부팅 뒤, 사용자 결정 11-12)
 * - 저장: 탭마다 번호·이름(직접 지은 것만)·폴더·종류(pi | claude | shell)·이어 열 대화(pi 대화 파일 | Claude 대화 번호)
 *   pi 는 연결부가 적는 ~/.cache/pi-remote/feed/<칸>.session, Claude 는 ~/.claude/sessions/<pid>.json 의 대화 번호
 * - 되살리기: 세션이 없을 때 같은 번호·이름·폴더로 탭을 만들고, pi·Claude 는 로그인 셸 안에서 같은 대화로 켬
 *   (끝나도 셸이 남음. 셸 함수 claude() 가 계정을 고름). 다른 프로그램(vim 등)이 돌던 탭은 그 폴더의 셸로
 * - 브리지가 만든 tmux 서버에도 언어 설정(LANG·LC_ALL)을 넣음(launchd 환경에는 없음)
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const HOME = process.env.HOME ?? "";
const CLAUDE_RE = /^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i;
const SHELL_RE = /^-?(\S*\/)?(zsh|bash|sh|fish)$/;
export const LOCALE = { LANG: process.env.LANG || "en_US.UTF-8", LC_ALL: process.env.LC_ALL || process.env.LANG || "en_US.UTF-8" };

const alive = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};
const childPids = (pid) => {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8", timeout: 3000 }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
/** Claude 대화 번호의 기록 파일이 있는지 */
export function claudeTranscriptExists(id) {
  const dir = `${HOME}/.claude/projects`;
  try {
    return readdirSync(dir).some((d) => existsSync(`${dir}/${d}/${id}.jsonl`));
  } catch {
    return false;
  }
}

/** 지금 탭 목록 → [{ index, name, cwd, kind, resume }] (세션이 없으면 null) */
export function snapshotTabs(tmuxBin, session, feedDir = `${HOME}/.cache/pi-remote/feed`) {
  let out;
  try {
    out = execFileSync(tmuxBin, ["list-windows", "-t", `=${session}`, "-F",
      "#{window_index}\t#{window_name}\t#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{automatic-rename}"], { encoding: "utf8", timeout: 3000 });
  } catch {
    return null;
  }
  const tabs = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [index, name, pane, panePid, cmd, cwd, autoRename] = line.split("\t");
    const tab = { index: Number(index), name: autoRename === "1" ? "" : name, cwd, kind: "shell", resume: "" };
    // pi: 연결부가 적은 열린 대화(그 pi 가 살아 있을 때만)
    try {
      const o = JSON.parse(readFileSync(`${feedDir}/${pane.replace(/\W/g, "")}.session`, "utf8"));
      if (o?.session && alive(o.pid)) Object.assign(tab, { kind: "pi", resume: String(o.session) });
    } catch {
      /* pi 아님 */
    }
    // Claude Code: 칸의 프로세스나 그 자식의 대화 번호
    if (tab.kind === "shell" && (CLAUDE_RE.test(cmd) || !SHELL_RE.test(cmd))) {
      for (const pid of [panePid, ...childPids(panePid)]) {
        const f = `${HOME}/.claude/sessions/${pid}.json`;
        if (!existsSync(f)) continue;
        try {
          const id = String(JSON.parse(readFileSync(f, "utf8")).sessionId ?? "");
          if (/^[0-9a-f-]{36}$/i.test(id)) Object.assign(tab, { kind: "claude", resume: id });
        } catch {
          /* 못 읽음 */
        }
        break;
      }
    }
    tabs.push(tab);
  }
  return tabs;
}

/** 저장(내용이 바뀌었을 때만, 탭이 하나라도 있을 때만). 바뀌었으면 true */
export function saveSnapshot(file, session, tabs) {
  if (!tabs?.length) return false;
  const body = JSON.stringify({ session, tabs });
  try {
    const old = JSON.parse(readFileSync(file, "utf8"));
    if (JSON.stringify({ session: old.session, tabs: old.tabs }) === body) return false;
  } catch {
    /* 처음 */
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), session, tabs }, null, 1));
  renameSync(tmp, file);
  return true;
}

export function loadSnapshot(file) {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(s?.tabs) && s.tabs.length ? s : null;
  } catch {
    return null;
  }
}

// 저절로 여는 셸은 oh-my-zsh 업데이트 질문('Would you like to update? [Y/n]')에서 멈추지 않게(그 탭만)
export const NO_UPDATE_PROMPT = ["/usr/bin/env", "DISABLE_AUTO_UPDATE=true"];
/** 되살릴 때 탭에서 실행할 것: 셸이면 null(기본 셸), pi·Claude 면 로그인 셸 안에서 같은 대화로 켜고 끝나면 셸로 */
export function tabCommand(tab, shell = "/bin/zsh") {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  if (tab.kind === "pi" && tab.resume && existsSync(tab.resume)) {
    return [...NO_UPDATE_PROMPT, shell, "-lic", `${process.env.PI_RESTORE_PI_CMD || "pi"} --session ${q(tab.resume)}; exec ${shell} -l`];
  }
  if (tab.kind === "claude" && /^[0-9a-f-]{36}$/i.test(tab.resume) && claudeTranscriptExists(tab.resume)) {
    return [...NO_UPDATE_PROMPT, shell, "-lic", `${process.env.PI_RESTORE_CLAUDE_CMD || "claude"} --resume ${tab.resume}; exec ${shell} -l`];
  }
  return null;
}

/** 세션 만들기(+ 언어 설정). tabs 가 있으면 같은 번호·이름·폴더로 되살림 → { restored, pi, claude, shell } */
export function createSession(tmuxBin, session, tabs = null, shell = process.env.SHELL && /\/(zsh|bash)$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/zsh") {
  const t = (...a) => execFileSync(tmuxBin, a, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const env = Object.entries(LOCALE).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const list = (tabs ?? []).filter((x) => Number.isInteger(x.index)).sort((a, b) => a.index - b.index);
  const first = list[0];
  const winArgs = (tab) => [...(tab.name ? ["-n", tab.name] : []), "-c", tab.cwd && existsSync(tab.cwd) ? tab.cwd : HOME, ...env, ...(tabCommand(tab, shell) ?? [])];
  t("new-session", "-d", "-s", session, ...(first ? winArgs(first) : ["-c", HOME, ...env]));
  for (const [k, v] of Object.entries(LOCALE)) t("set-environment", "-g", k, v);
  const counts = { restored: 0, pi: 0, claude: 0, shell: 0 };
  if (!first) return counts;
  const count = (tab) => {
    counts.restored++;
    const kind = tabCommand(tab, shell) ? tab.kind : "shell";
    counts[kind]++;
  };
  // 첫 탭 번호 맞추기(새 세션의 첫 번호는 base-index)
  const cur = Number(t("display", "-p", "-t", `=${session}:`, "#{window_index}"));
  if (cur !== first.index) t("move-window", "-s", `=${session}:${cur}`, "-t", `=${session}:${first.index}`);
  count(first);
  for (const tab of list.slice(1)) {
    try {
      t("new-window", "-d", "-t", `=${session}:${tab.index}`, ...winArgs(tab));
      count(tab);
    } catch {
      /* 그 번호를 못 쓰면 건너뜀 */
    }
  }
  t("select-window", "-t", `=${session}:${first.index}`);
  return counts;
}
