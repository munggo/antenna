// 탭을 고르면 '끝났어요'(yourturn)를 지우는 tmux 훅 시험(server/windows.mjs 의 SEEN_HOOK·SEEN_HOOK_CMD).
// 따로 띄운 tmux 서버(-L 소켓)만 쓴다: 쓰는 tmux 서버·세션은 건드리지 않음. 끝나면 그 서버를 끈다.
// 실행: node server/test/seen-hook.test.mjs
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { SEEN_HOOK, SEEN_HOOK_CMD } from "../windows.mjs";

const SOCK = `antenna-seen-${process.pid}`, S = "seentest";
const tm = (...a) => execFileSync("tmux", ["-L", SOCK, "-f", "/dev/null", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const st = (i) => tm("show-options", "-w", "-v", "-t", `${S}:${i}`, "@pi_status");
const set = (i, v) => tm("set-option", "-w", "-t", `${S}:${i}`, "@pi_status", v);
// 브리지가 폰의 탭 바꾸기에 쓰는 것과 같은 꼴(클라이언트 밖에서 select-window -t 세션:번호)
const pick = (i) => { tm("select-window", "-t", `${S}:${i}`); execFileSync("sleep", ["0.3"]); };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

try {
  tm("new-session", "-d", "-s", S, "-x", "80", "-y", "24");
  for (let i = 1; i <= 4; i++) tm("new-window", "-d", "-t", `${S}:${i}`);
  tm("select-window", "-t", `${S}:0`);

  // 대조: 훅이 없으면(재부팅 뒤 pi 를 켜지 않은 맥) 탭을 골라도 그대로 남는다 = 사용자가 본 증상
  set(1, "yourturn");
  pick(1);
  ok(st(1) === "yourturn", "훅이 없으면 골라도 '끝났어요'가 남음(증상 재현)");

  // pi 확장이 거는 [0] 칸이 있어도 같이 돈다(서로 덮지 않음)
  tm("set-hook", "-g", "after-select-window[0]", "set-option -w @zero_ran 1");
  tm("set-hook", "-g", SEEN_HOOK, SEEN_HOOK_CMD);
  tm("set-hook", "-g", SEEN_HOOK, SEEN_HOOK_CMD);   // 브리지는 접속마다 다시 건다
  const hooks = tm("show-hooks", "-g", "after-select-window").split("\n").filter(Boolean);
  ok(hooks.length === 2 && hooks.some((h) => h.startsWith("after-select-window[0]")) && hooks.filter((h) => h.startsWith(SEEN_HOOK)).length === 1,
    `여러 번 걸어도 한 칸, pi 의 칸은 그대로(${hooks.length}줄)`);

  set(2, "yourturn");
  set(3, "working");
  set(4, "asking");
  pick(2);
  ok(st(2) === "", "끝났어요 탭을 고르면 지워짐");
  ok(tm("show-options", "-w", "-v", "-t", `${S}:2`, "@zero_ran") === "1", "pi 확장의 훅도 함께 돔");
  pick(3);
  ok(st(3) === "working", "작업 중인 탭은 골라도 그대로");
  pick(4);
  ok(st(4) === "asking", "답을 기다리는 탭은 골라도 그대로");
  pick(1);
  ok(st(1) === "", "훅을 건 뒤에는 예전에 남은 '끝났어요'도 고르면 지워짐");
  ok(st(3) === "working" && st(4) === "asking", "다른 탭을 골라도 남의 상태는 그대로");
  set(0, "yourturn");
  pick(2);
  ok(st(0) === "yourturn", "고르지 않은 탭의 '끝났어요'는 그대로(다른 탭을 고른 것)");
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  let sock = "";
  try { sock = tm("display-message", "-p", "#{socket_path}"); } catch { /* 서버가 없음 */ }
  try { tm("kill-server"); } catch { /* 이미 꺼짐 */ }
  if (sock.includes(SOCK)) rmSync(sock, { force: true });   // 꺼진 서버의 소켓 파일이 남지 않게
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
