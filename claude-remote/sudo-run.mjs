#!/usr/bin/env node
/**
 * 관리자 권한(sudo) 명령을 새 tmux 탭(🔐sudo)에서 사용자가 확인하고 실행하게 한다(Claude Code 용).
 * Claude Code 의 명령 실행에는 비밀번호를 넣을 터미널이 없어서, 훅(pi-remote-hook.mjs)이 비밀번호가 필요한 sudo 명령을
 * 이 스크립트 호출로 바꿔 넣는다. 탭 화면은 pi 와 같은 sudo-tab.sh(설명을 보고 Enter 실행·v 명령 보기·q 취소).
 * - 탭을 열면 폰에 알림. 폰은 tmux 현재 창을 따라 그 탭 터미널로 가므로 폰에서 비밀번호를 넣을 수 있다
 * - 끝나면 탭의 출력을 그대로 내고 같은 종료 코드로 끝난다
 * - 취소·탭 닫힘·시간 초과는 그 사실을 AI 에 알리고(영어, pi 와 같은 문구) 실패로 끝난다
 * 인자: base64(JSON { cmd: 실행할 명령, explain: 무엇을 하는지 설명 })
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 폰에 보일 글의 언어(PI_REMOTE_LANG). 설치본은 같은 폴더, 저장소에서는 pi-extension/lib/
const LANG_FILE = ["lang.mjs", "../pi-extension/lib/lang.mjs"].map((f) => join(dirname(fileURLToPath(import.meta.url)), f)).find((p) => existsSync(p));
const { tr } = LANG_FILE ? await import(LANG_FILE) : { tr: (ko) => ko };

const HERE = dirname(fileURLToPath(import.meta.url));
// 설치본(~/.claude/pi-remote)은 같은 폴더에, 저장소에서는 pi 확장 폴더에 있다
const SUDO_TAB = [join(HERE, "sudo-tab.sh"), join(HERE, "../pi-extension/sudo-tab.sh")].find((p) => existsSync(p));
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? "tmux";
const tmux = (...a) => execFileSync(TMUX, a, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
// 기다리는 시간: Claude Code 명령 실행 한도(10분)보다 조금 짧게. 시험에서는 줄여 씀
const WAIT_MS = Number(process.env.PI_REMOTE_SUDO_WAIT_MS ?? 570_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

let job;
try {
  job = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
} catch {
  /* 아래에서 알림 */
}
if (!job?.cmd) fail("sudo-run: no command was given.");
const pane = process.env.TMUX_PANE;
if (!pane || !SUDO_TAB) fail("This sudo command needs the user's password, but no terminal tab can be opened here. Ask the user how to proceed.");

const dir = mkdtempSync(join(tmpdir(), "claude-sudo-"));
const cleanup = () => rmSync(dir, { recursive: true, force: true });
writeFileSync(join(dir, "cmd"), String(job.cmd), { mode: 0o600 });
writeFileSync(join(dir, "cwd"), process.cwd());
// 탭에는 명령 대신 설명(코드는 v 를 눌러야 보임)
writeFileSync(join(dir, "explain"), String(job.explain ?? "").trim() || tr("Claude Code가 관리자 권한으로 명령을 실행하려고 해요.", "Claude Code wants to run a command with admin rights."));

let session = "";
let winId = "";
let winIndex = "";
try {
  // tmux 는 없는 칸을 물어도 오류 없이 빈 값을 주고, 빈 세션으로 창을 열면 엉뚱한 세션에 열린다 → 이 칸이 정말 있는지부터 확인
  const [paneId, sessionId, name] = tmux("display", "-p", "-t", pane, "#{pane_id}:::#{session_id}:::#{session_name}").split(":::");
  if (paneId !== pane || !sessionId) throw new Error("the tmux pane of this session was not found");
  session = name;
  [winId, winIndex] = tmux("new-window", "-P", "-F", "#{window_id} #{window_index}", "-t", `${sessionId}:`, "-n", "🔐sudo", "-c", process.cwd(),
    `bash ${JSON.stringify(SUDO_TAB)} ${JSON.stringify(dir)}`).split(" ");
} catch (e) {
  cleanup();
  fail(`Could not open a terminal tab for sudo (${e?.message ?? e}). Ask the user how to proceed.`);
}
const kill = () => {
  try {
    tmux("kill-window", "-t", winId);
  } catch {
    /* 이미 닫힘 */
  }
};
// 작업을 멈추면(Claude Code 가 이 실행을 끝냄) 탭도 닫는다
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    kill();
    cleanup();
    process.exit(130);
  });
}

// 폰 알림(브리지 알림 소켓). 브리지가 없으면 그냥 넘어간다
await new Promise((res) => {
  const path = `${process.env.HOME}/.cache/pi-remote/notify-${session}.sock`;
  if (!existsSync(path)) return res();
  const c = createConnection(path);
  const t = setTimeout(() => {
    c.destroy();
    res();
  }, 1500);
  const done = () => {
    clearTimeout(t);
    res();
  };
  c.on("error", done);
  c.on("connect", () => c.end(`${JSON.stringify({ kind: "prompt", title: tr("관리자 비밀번호가 필요해요", "Admin password needed"), body: tr(`${winIndex}번 탭(🔐sudo)에서 Enter를 누르고 비밀번호를 입력해 주세요`, `Press Enter in tab ${winIndex} (🔐sudo) and type the password`), window: Number(winIndex) })}\n`, done));
});

const end = Date.now() + WAIT_MS;
while (Date.now() < end) {
  if (existsSync(join(dir, "code"))) {
    const code = Number(readFileSync(join(dir, "code"), "utf8").trim()) || 0;
    let out = "";
    try {
      out = readFileSync(join(dir, "out"), "utf8");
    } catch {
      /* 출력 없음 */
    }
    cleanup();
    process.stdout.write(out, () => process.exit(code));
    await sleep(5000);   // 출력이 다 나갈 때까지(위에서 끝냄)
    process.exit(code);
  }
  if (existsSync(join(dir, "cancelled"))) {
    cleanup();
    fail("The user cancelled this sudo command in the terminal tab. Do not retry unless the user asks.");
  }
  // 닫힌 창을 물으면 오류가 아니라 빈 값이 온다 → 받은 번호가 같은지로 판단
  let alive = false;
  try {
    alive = tmux("display", "-p", "-t", winId, "#{window_id}") === winId;
  } catch {
    /* 없음 */
  }
  if (!alive) {
    cleanup();
    fail("The sudo terminal tab was closed before the command finished.");
  }
  await sleep(500);
}
kill();
cleanup();
fail(`Nobody ran the sudo command within ${Math.max(1, Math.round(WAIT_MS / 60_000))} minutes. Ask the user before retrying.`);
