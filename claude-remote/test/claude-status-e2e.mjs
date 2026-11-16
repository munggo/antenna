// Claude Code 탭 점 시험: 작업 중 피드가 다시 떠도 주황, Esc 로 질문을 취소하면 보라가 남지 않음,
// 시험 정리는 시험 창 피드만 끔(쓰는 다른 창 피드는 그대로). 실행: node claude-remote/test/claude-status-e2e.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const REPO = new URL("../..", import.meta.url).pathname;
const S = "pitest", DIR = "/tmp/cctest", STOP = `${REPO}claude-remote/test/stop-test-feeds.sh`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const feeds = () => execFileSync("sh", ["-c", "ps -ax -o command= | grep 'claude-feed.mjs %' | grep -v grep || true"], { encoding: "utf8" })
  .split("\n").map((l) => (l.match(/claude-feed\.mjs (%\d+)/) ?? [])[1]).filter(Boolean);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };

rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const node = process.execPath, hook = `${REPO}claude-remote/pi-remote-hook.mjs`;
const H = { matcher: "", hooks: [{ type: "command", command: `"${node}" "${hook}"`, timeout: 5 }] };
const events = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"];
writeFileSync("/tmp/cctest-hooks.json", JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [H]])) }));
const claude = execFileSync("/bin/zsh", ["-lc", "whence -p claude"], { encoding: "utf8" }).trim();
execFileSync("sh", [STOP, S]);
tm("kill-session", "-t", S);
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
tm("new-window", "-t", S, "-c", DIR, `${claude} --model haiku --permission-mode manual --setting-sources project,local --settings /tmp/cctest-hooks.json --allowedTools 'Bash(sleep:*)'`);
const W = `${S}:1`, pane = tm("display", "-p", "-t", W, "#{pane_id}");
const sock = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  if (/Yes, I trust this folder/.test(tm("capture-pane", "-p", "-t", W))) { tm("send-keys", "-t", W, "Down"); await sleep(300); tm("send-keys", "-t", W, "Enter"); }
  if (existsSync(sock)) break;
}
ok(existsSync(sock), `시험 창 피드 뜸(${pane})`);
const others = feeds().filter((p) => p !== pane);
const status = () => tm("show-options", "-w", "-v", "-t", W, "@pi_status");
const type = (t) => { tm("send-keys", "-t", W, "-l", t); tm("send-keys", "-t", W, "Enter"); };

// 1) 작업 중에 시험 창 피드만 끔 → 다음 도구 때 다시 떠서 주황
type("Run the bash command 'sleep 7', then run the bash command 'sleep 7', then reply with one word: done");
ok(await waitFor(() => status() === "working", 30000), "보내면 주황(작업 중)");
// 명령이 실제로 도는 중(도구 줄 'Bash(sleep 7)')에 끔
ok(await waitFor(() => /Bash\(sleep 7\)/.test(tm("capture-pane", "-p", "-t", W)), 40000), "첫 명령이 도는 중");
await sleep(1000);
execFileSync("sh", [STOP, S]);
tm("set-option", "-w", "-t", W, "@pi_status", "");   // 점이 사라진 상태(실제 증상) 재현
ok(!feeds().includes(pane) && !existsSync(sock), "시험 정리: 시험 창 피드만 꺼짐");
ok(others.every((p) => feeds().includes(p)), `쓰는 다른 창 피드는 그대로(${others.join(", ") || "없음"})`);
ok(await waitFor(() => feeds().includes(pane), 25000), "다음 훅 때 시험 창 피드가 다시 뜸");
// 둘째 명령이 도는 동안 점 기록
const seen = [];
for (let t = 0; t < 30000; t += 500) {
  const sc = tm("capture-pane", "-p", "-t", W);
  const n = (sc.match(/Bash\(sleep 7\)/g) ?? []).length;
  seen.push(`${n}:${status() || "-"}`);
  if (n >= 2 && status() === "working") break;
  if (/done/i.test(sc.split("\n").slice(-8).join("\n")) && n >= 2) break;
  await sleep(500);
}
console.log("   (명령 줄 수:점) " + [...new Set(seen)].join(" → "));
ok(seen.some((x) => x.startsWith("2:") && x.endsWith(":working")), "다시 뜬 피드도 다음 도구 때 주황");
ok(await waitFor(() => status() !== "working", 60000), `작업 끝나면 주황이 아님(${status()})`);

// 2) 피드가 다시 뜬 뒤 질문을 Esc 로 취소 → 보라가 남지 않음
type("Run the bash command 'sleep 4', then use the AskUserQuestion tool once with one question 'Pet?' (header Pet) with options Cat and Dog. Then reply with the answer only.");
await waitFor(() => /Bash\(sleep 4\)/.test(tm("capture-pane", "-p", "-t", W)), 40000);
await sleep(1000);
execFileSync("sh", [STOP, S]);   // 작업 중에 다시 뜨게
ok(await waitFor(() => status() === "asking" && /Esc to cancel/.test(tm("capture-pane", "-p", "-t", W)), 60000), "질문 창 → 보라(답을 기다림)");
tm("send-keys", "-t", W, "Escape");
ok(await waitFor(() => status() !== "asking", 8000), `Esc 로 취소하면 보라가 남지 않음(${status() || "비움"})`);
ok(status() !== "working", "주황도 남지 않음");

execFileSync("sh", [STOP, S]);
tm("kill-session", "-t", S);
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
