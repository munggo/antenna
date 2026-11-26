#!/usr/bin/env node
/**
 * 사용자가 맥 앞에 없을 때 로그인 비밀번호를 폰에서 받는다(Claude Code 용, 브라우저 로그인에서 씀).
 * 맥의 '암호' 앱은 잠금 해제에 Touch ID 가 필요해 원격으로 못 연다. 대신 새 tmux 탭(🔐암호)을 열고 폰에 알리면,
 * 사용자가 폰 앱의 가려진 칸에서 아이폰 '암호'(Face ID)로 골라 보낸다. 탭은 받은 값을 맥 클립보드에만 잠깐 넣는다(secret-clip.js).
 * - 값은 AI 에 돌려주지 않는다. AI 는 브라우저 비밀번호 칸에서 cmd+v 로 붙여 넣고 지우기만 한다
 * - 넣은 뒤 CLEAR_S 초가 지나면 저절로 지운다(그 사이 사용자가 다른 것을 복사했으면 그대로)
 * - 취소·탭 닫힘·시간 초과는 그 사실을 AI 에 알리고(영어) 실패로 끝난다
 * 인자: 무엇의 비밀번호인지(탭과 폰 알림에 보임). 예: "naver.com 로그인(개인 계정)"
 * 작성: 서문교
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TAB = join(HERE, "password-tab.sh");
const CLIP = join(HERE, "secret-clip.js");
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? "tmux";
const tmux = (...a) => execFileSync(TMUX, a, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
// 기다리는 시간: Claude Code 명령 실행 한도(10분)보다 조금 짧게. 시험에서는 줄여 씀
const WAIT_MS = Number(process.env.PI_REMOTE_PASSWORD_WAIT_MS ?? 570_000);
// 클립보드에 두는 시간(초): 붙여 넣는 데 브라우저 도구 몇 번이면 충분한 길이
const CLEAR_S = Number(process.env.PI_REMOTE_PASSWORD_CLEAR_S ?? 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

const label = (process.argv[2] ?? "").trim();
if (!label) fail('password-run: say which login the password is for, e.g. password-run.mjs "naver.com 로그인(개인 계정)".');
const pane = process.env.TMUX_PANE;
if (!pane || !existsSync(TAB) || !existsSync(CLIP)) fail("No terminal tab can be opened here to receive the password from the phone. Tell the user this login step needs them.");

const dir = mkdtempSync(join(tmpdir(), "claude-password-"));
const cleanup = () => rmSync(dir, { recursive: true, force: true });
writeFileSync(join(dir, "label"), label);

let session = "";
let winId = "";
let winIndex = "";
try {
  // tmux 는 없는 칸을 물어도 오류 없이 빈 값을 준다 → 이 칸이 정말 있는지부터 확인(빈 세션으로 열면 엉뚱한 세션에 열림)
  const [paneId, sessionId, name] = tmux("display", "-p", "-t", pane, "#{pane_id}:::#{session_id}:::#{session_name}").split(":::");
  if (paneId !== pane || !sessionId) throw new Error("the tmux pane of this session was not found");
  session = name;
  [winId, winIndex] = tmux("new-window", "-P", "-F", "#{window_id} #{window_index}", "-t", `${sessionId}:`, "-n", "🔐암호", "-c", tmpdir(),
    `bash ${JSON.stringify(TAB)} ${JSON.stringify(dir)}`).split(" ");
} catch (e) {
  cleanup();
  fail(`Could not open a terminal tab for the password (${e?.message ?? e}). Tell the user this login step needs them.`);
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
  c.on("connect", () => c.end(`${JSON.stringify({ kind: "prompt", title: "로그인 비밀번호가 필요해요", body: `${label}: ${winIndex}번 탭(🔐암호)의 가려진 칸을 누르고 키보드 위 '암호'에서 골라 주세요`, window: Number(winIndex) })}\n`, done));
});

const end = Date.now() + WAIT_MS;
while (Date.now() < end) {
  if (existsSync(join(dir, "done"))) {
    cleanup();
    // 붙여 넣지 못하고 끝나도 클립보드에 남지 않게, 이 실행과 따로 도는 지우기를 걸어 둔다
    spawn("/bin/sh", ["-c", `sleep ${CLEAR_S}; exec /usr/bin/osascript -l JavaScript "$0" clear`, CLIP], { detached: true, stdio: "ignore" }).unref();
    process.stdout.write(
      `The user sent the password from their phone. It is on the Mac clipboard now (this Mac only, hidden from clipboard history); you never see it.\n` +
        `Click the password field of the login page (check the address is the service's real one first) and press cmd+v with the browser tool, then submit.\n` +
        `Right after pasting, clear it: /usr/bin/osascript -l JavaScript ${JSON.stringify(CLIP)} clear\n` +
        `It is also cleared automatically in ${CLEAR_S} seconds. Never read the clipboard (no read_clipboard, pbpaste or screenshots of a revealed field).\n`,
      () => process.exit(0),
    );
    await sleep(5000);
    process.exit(0);
  }
  if (existsSync(join(dir, "error"))) {
    const why = readFileSync(join(dir, "error"), "utf8").trim().slice(0, 200);
    cleanup();
    fail(`The password arrived but could not be put on the clipboard (${why}). Tell the user this login step needs them.`);
  }
  if (existsSync(join(dir, "cancelled"))) {
    cleanup();
    fail("The user cancelled the password request. Do not ask again unless the user asks.");
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
    fail("The password tab was closed before the password arrived.");
  }
  await sleep(500);
}
kill();
cleanup();
fail(`No password arrived from the phone within ${Math.max(1, Math.round(WAIT_MS / 60_000))} minutes. Ask the user before trying again.`);
