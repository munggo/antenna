// 폰이 보는 Claude Code 탭에 연결부(claude-feed.mjs)가 없으면 브리지가 띄운다.
// 연결부는 그 탭 Claude Code 의 훅이 띄우므로, 연결부가 어떤 까닭으로든 꺼진 뒤 쉬는 탭에는 다시 띄워 줄 훅이 오지 않아
// 폰에 터미널 화면만 보였다(11-27 쉬던 탭 둘). 꺼진 까닭과 상관없이 폰이 볼 때 다시 띄운다.
// 작성: 서문교
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** 칸에서 도는 프로그램이 Claude Code 인지(연결부·훅과 같은 판정: 'claude' 또는 '2.1.332' 같은 버전 번호) */
export const CLAUDE_CMD = /^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i;

/** 연결부에 넘길 환경: 브리지 설정 파일의 비밀값(접속 토큰·알림 키 등)과 계정 표시는 뺀다(훅이 띄울 때와 같은 까닭) */
export function feedEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/TOKEN|KEY|SECRET|PASS|AUTH/i.test(k) || k === "PI_CLAUDE_ACCOUNT" || k === "CLAUDE_CONFIG_DIR") continue;
    out[k] = v;
  }
  return out;
}

const run = (cmd, args) =>
  new Promise((res) => execFile(cmd, args, { encoding: "utf8", timeout: 3000 }, (err, out) => res({ err, out: String(out ?? "").trim() })));

/**
 * revive(pane): 그 칸이 Claude Code 인데 연결부 프로세스가 없으면 띄우고 true.
 * 브리지는 연결부에 붙지 못하면 2초마다 다시 붙어 보므로, 칸마다 10초에 한 번만 살피고 띄운 뒤에는 30초 동안 다시 띄우지 않는다.
 */
export function createFeedReviver({ tmuxBin, feedScript, node, env = process.env, log = () => {} }) {
  const next = new Map();   // 칸 → 다음에 살필 수 있는 시각
  return async (pane) => {
    if (!/^%\d+$/.test(pane ?? "") || !existsSync(feedScript)) return false;
    const now = Date.now();
    if (now < (next.get(pane) ?? 0)) return false;
    next.set(pane, now + 10_000);
    const cmd = await run(tmuxBin, ["display", "-p", "-t", pane, "#{pane_current_command}"]);
    if (cmd.err || !CLAUDE_CMD.test(cmd.out)) return false;   // pi·셸 탭, 없는 칸, tmux 가 답하지 않음
    const ps = await run("pgrep", ["-f", `claude-feed\\.mjs ${pane}$`]);
    if (ps.err?.code !== 1) return false;   // 이미 돎(바쁘거나 막 뜨는 중) 또는 확인하지 못함
    next.set(pane, now + 30_000);
    spawn(node, [feedScript, pane], { detached: true, stdio: "ignore", env: feedEnv(env) }).unref();
    log(`칸 ${pane}: Claude Code 탭에 연결부가 없어 띄움`);
    return true;
  };
}
