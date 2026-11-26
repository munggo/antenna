// 옛 판 연결부는 계정을 바꾸지 않는지 시험(11-25 안녕내친구 탭 일: 옛 판이 새 방식으로 켠 추가 개인을 개인으로 보고
// '전환 실패'로 6시간 쉬며 칩에 '개인→추가 개인'을 남김).
//  1) 설치본이 연결부보다 새 판이면 앱에서 계정을 골라도 바꾸지 않는다: 칩은 '기다림', 알림은 한 번만, 전환 쉼 기록도 남기지 않음
//  2) 판이 같아지면 평소처럼 바꾸기를 시작한다(막기가 평소 전환을 막지 않음)
// 진짜 Claude Code·모델은 쓰지 않는다: 시험 칸의 셸(경로에 claude 가 없음)에서 쉬는 화면만 그리는 가짜(이름이 버전 번호 꼴인 node)를 켜고,
// 연결부 사본을 가짜 홈으로 돌린다(소켓·기록이 가짜 홈에 생겨 쓰는 브리지와 섞이지 않음). 쓰는 세션 antenna 는 건드리지 않는다.
// 쓰기: node account-rev-guard-e2e.mjs [세션=acctrevtest]   (세션은 시험이 만들고 지움, 30초쯤)
// 작성: 서문교
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION = process.argv[2] ?? "acctrevtest";
if (SESSION === "antenna") { console.error("쓰는 세션(antenna)에서는 돌리지 않아요"); process.exit(2); }
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = `/tmp/acctrev-${process.pid}`;
const HOME = `${ROOT}/home`, INSTALL = `${ROOT}/install`, FEED = `${INSTALL}/claude-feed.mjs`;
const FILES = ["claude-feed.mjs", "claude-account.mjs", "bg-launch.mjs"];   // claude-as.sh 는 두지 않음(다시 켜는 명령이 진짜 계정 전환이 되지 않게)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const waitFor = async (fn, ms, step = 100) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
mkdirSync(`${HOME}/.claude/sessions`, { recursive: true });
mkdirSync(`${HOME}/.claude-personal2`, { recursive: true });
writeFileSync(`${HOME}/.claude-personal2/.pi-login-ready`, "");   // 추가 개인 계정을 고를 수 있게(직접 로그인 표식)
mkdirSync(INSTALL, { recursive: true });
mkdirSync(`${ROOT}/bin`, { recursive: true });
for (const f of FILES) copyFileSync(join(SRC, f), join(INSTALL, f));
const fakeBin = `${ROOT}/bin/9.9.9`;
try { linkSync(process.execPath, fakeBin); } catch { symlinkSync(process.execPath, fakeBin); }
// 쉬는 Claude Code 화면만 그리는 가짜. 누른 글자는 화면에 찍지 않고 버린다(/exit 로도 꺼지지 않음 → 전환은 '끄지 못함'으로 멈춤)
writeFileSync(`${ROOT}/idle.mjs`, `
process.stdout.write("\\x1b[2J\\x1b[H⏺ 답\\r\\n" + "─".repeat(60) + "\\r\\n❯ \\r\\n" + "─".repeat(60) + "\\r\\n  ⏵⏵ auto mode on");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", () => {});
setInterval(() => {}, 1e9);
`);

let feed = null;
try {
  tm("kill-session", "-t", `=${SESSION}`);
  // 셸의 경로에는 claude 가 없다: 전환이 끝까지 가도 진짜 Claude Code 가 켜지지 않게
  tm("new-session", "-d", "-s", SESSION, "-x", "100", "-y", "30", "-c", "/tmp", `env -i HOME=${HOME} PATH=/usr/bin:/bin TERM=xterm-256color /bin/zsh -f`);
  const pane = tm("display", "-p", "-t", `${SESSION}:`, "#{pane_id}");
  tm("send-keys", "-t", pane, "-l", `${fakeBin} ${ROOT}/idle.mjs`);
  tm("send-keys", "-t", pane, "Enter");
  ok(!!(await waitFor(() => /^\d+\.\d+\.\d+$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), 5000)), "시험 칸에 가짜 Claude Code 가 켜짐");
  const shellPid = tm("display", "-p", "-t", pane, "#{pane_pid}");
  const fakePid = Number(execFileSync("pgrep", ["-P", shellPid], { encoding: "utf8" }).trim().split("\n")[0]);
  writeFileSync(`${HOME}/.claude/sessions/${fakePid}.json`, JSON.stringify({ pid: fakePid, cwd: "/tmp", sessionId: randomUUID() }));
  const tag = pane.replace(/\W/g, "");
  const SOCK = `${HOME}/.cache/pi-remote/feed/${tag}.sock`, PAUSE = `${HOME}/.cache/pi-remote/feed/${tag}.switch-pause`;
  const opt = (k) => tm("show-options", "-w", "-v", "-t", pane, k) ?? "";

  const env = { ...process.env, HOME, PI_REMOTE_ACCOUNT_TICK_SEC: "1", PI_REMOTE_SWITCH_IDLE_SEC: "1", PI_REMOTE_REV_TICK_SEC: "3600", PI_REMOTE_REV_IDLE_SEC: "3600", PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json` };
  for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "PI_CLAUDE_ACCOUNT", "CLAUDE_CONFIG_DIR", "PI_PERSONAL2_CONFIG_DIR", "PI_WORK_CONFIG_DIR", "TMUX_PANE"]) delete env[k];
  feed = spawn(process.execPath, [FEED, pane], { env, stdio: "ignore" });
  ok(!!(await waitFor(() => existsSync(SOCK), 5000)), "연결부가 떠서 소켓을 엶");
  // 소켓에 붙어 있으며 알림을 모음
  const notices = [];
  const conn = createConnection(SOCK);
  conn.setEncoding("utf8");
  let buf = "";
  conn.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m?.t === "notice") notices.push(String(m.text)); } catch { /* 첫 화면 등 */ }
    }
  });
  conn.on("error", () => {});
  await sleep(500);
  ok(await waitFor(() => opt("@ai_account") === "personal", 6000), `연결부가 지금 계정을 개인으로 적음 → ${opt("@ai_account")}`);

  // 1) 설치본을 새 판으로(파일을 고침) → 앱에서 추가 개인을 골라도 바꾸지 않음
  const original = readFileSync(FEED, "utf8");
  appendFileSync(FEED, "\n// 새 판 흉내\n");
  conn.write(`${JSON.stringify({ cmd: "set-account", account: "personal2" })}\n`);
  ok(!!(await waitFor(() => notices.some((t) => /새 판으로 바꾸는 중/.test(t)), 6000)), `새 판이 깔려 있으면 바꾸지 않는다고 알림 → ${notices.filter((t) => /새 판/.test(t)).join(" / ")}`);
  let sawSwitch = false;
  for (let t = 0; t < 5000; t += 100) { if (opt("@ai_account_phase") === "switch") sawSwitch = true; await sleep(100); }
  ok(!sawSwitch && opt("@ai_account_phase") === "wait" && opt("@ai_account_next") === "personal2", `칩은 '추가 개인으로 바꾸기 기다림'에 머묾(단계 ${opt("@ai_account_phase")}, 바꿀 곳 ${opt("@ai_account_next")})`);
  ok(notices.filter((t) => /새 판으로 바꾸는 중/.test(t)).length === 1, `같은 판에는 한 번만 알림(${notices.filter((t) => /새 판으로 바꾸는 중/.test(t)).length}번, 1초마다 점검하는 5초 동안)`);
  ok(!existsSync(PAUSE) || Number(readFileSync(PAUSE, "utf8")) <= Date.now(), "전환 쉼 기록을 남기지 않음(새 연결부가 6시간 막히지 않게)");
  ok(alive(fakePid) && !notices.some((t) => /계정을 바꾸려다|끄지 못했|다시 켰/.test(t)), "Claude Code 를 건드리지 않음");
  ok(opt("@ai_account_pin") === "personal2", "고른 계정은 탭 옵션에 남음(새 연결부가 이어받음)");

  // 2) 판이 같아지면(파일을 되돌림) 평소처럼 바꾸기를 시작함
  writeFileSync(FEED, original);
  sawSwitch = false;
  for (let t = 0; t < 8000 && !sawSwitch; t += 100) { if (opt("@ai_account_phase") === "switch") sawSwitch = true; await sleep(100); }
  ok(sawSwitch, "판이 같아지면 바꾸기를 시작함(막기가 평소 전환을 막지 않음)");
  ok(!!(await waitFor(() => notices.some((t) => /계정을 바꾸려다|끄지 못했/.test(t)), 30000, 250)), `가짜는 꺼지지 않아 전환이 멈췄다고 알림 → ${notices.filter((t) => /계정을 바꾸려다|끄지 못했/.test(t)).join(" / ").slice(0, 80)}`);
  conn.destroy();
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  try { feed?.kill("SIGTERM"); } catch { /* 이미 끝남 */ }
  await sleep(500);
  tm("kill-session", "-t", `=${SESSION}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
