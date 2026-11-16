// Claude Code 연결부 실제 시험: 시험 tmux 세션(pitest)에 Claude Code(Haiku)를 띄우고, 훅은 이 실행에만(--settings),
// 시험 브리지(8799, 알림은 시험 모드)로 폰처럼 붙어 확인. 실행: node claude-remote/test/claude-e2e.mjs
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname;
const S = "pitest", PORT = 8799, TOKEN = "cc-e2e-token", LOG = "/tmp/cc-e2e-bridge.log", DIR = "/tmp/cctest";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch { return ""; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 250) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };

// 준비: 시험 폴더, 이 실행에만 쓰는 훅 설정
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const node = process.execPath, hook = `${REPO}claude-remote/pi-remote-hook.mjs`;
const H = { matcher: "", hooks: [{ type: "command", command: `"${node}" "${hook}"`, timeout: 5 }] };
const events = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"];
writeFileSync(`${DIR}/../cctest-hooks.json`, JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [H]])) }));
const claude = execFileSync("/bin/zsh", ["-lc", "whence -p claude"], { encoding: "utf8" }).trim();

execFileSync("sh", [`${REPO}claude-remote/test/stop-test-feeds.sh`, S]);   // 시험 세션 피드만(쓰는 창 피드는 그대로)
tm("kill-session", "-t", S);
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
tm("new-window", "-t", S, "-c", DIR, `${claude} --model haiku --permission-mode manual --setting-sources project,local --settings /tmp/cctest-hooks.json --allowedTools 'Bash(echo:*)'`);
const pane = tm("display", "-p", "-t", `${S}:1`, "#{pane_id}");
const sock = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
// 처음 여는 폴더면 '이 폴더를 믿나요?' → 믿음
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const scr = tm("capture-pane", "-p", "-t", `${S}:1`);
  if (/Yes, I trust this folder/.test(scr)) { tm("send-keys", "-t", `${S}:1`, "Down"); await sleep(300); tm("send-keys", "-t", `${S}:1`, "Enter"); }
  if (existsSync(sock)) break;
}
ok(existsSync(sock), `Claude Code 시작 훅이 이 탭의 피드를 띄움(${pane})`);
ok(await waitFor(() => tm("display", "-p", "-t", `${S}:1`, "#{window_name}") === "Claude", 5000), `탭 이름이 'Claude'로(${tm("display", "-p", "-t", `${S}:1`, "#{window_name}")})`);

// 시험 브리지
writeFileSync(LOG, "");
// 맥이 잠긴 것으로(시험을 돌리는 동안 맥을 쓰고 있어 알림이 보류되지 않게)
writeFileSync("/tmp/cc-test-locked", "1");
const bridge = spawn(node, ["bridge.mjs"], {
  cwd: `${REPO}server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S,
    PI_REMOTE_SESSION_DIR: "/tmp/cc-e2e-sessions", PI_REMOTE_PUSH_FILE: "/tmp/cc-e2e-push.json", PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_FAKE_LOCKED_FILE: "/tmp/cc-test-locked" },
  stdio: ["ignore", "pipe", "pipe"],
});
const append = (d) => writeFileSync(LOG, readFileSync(LOG, "utf8") + d);
bridge.stdout.on("data", append); bridge.stderr.on("data", append);
await sleep(2500);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = []; let status = {};
ws.on("message", (d, bin) => {
  if (bin) return;
  try {
    const m = JSON.parse(d.toString());
    if (m.type === "chat") ev.push(m.d);
    if (m.type === "pistatus") status = m;
  } catch {}
});
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
const snap = await waitFor(() => ev.find((e) => e.t === "snapshot"), 10000);
ok(snap?.agent === "claude" && snap.canSend === true && Array.isArray(snap.messages), "브리지가 Claude Code 탭 피드에 붙음(채팅 화면, 보내기 가능)");

const assistantText = () => ev.filter((e) => e.t === "upsert" && e.message?.role === "assistant")
  .flatMap((e) => e.message.blocks.filter((b) => b.type === "text").map((b) => b.text)).join("\n");
// 1) 보내기 → 답
ev.length = 0;
ws.send(JSON.stringify({ type: "pi-send", text: "Reply with exactly one word: pong", mode: "auto" }));
ok(await waitFor(() => ev.some((e) => e.t === "working" && e.value === true), 20000), "보내면 '작업 중'");
ok(await waitFor(() => ev.some((e) => e.t === "upsert" && e.message?.role === "user" && /pong/.test(e.message.text)), 20000), "내 메시지가 채팅에 나타남");
ok(await waitFor(() => /pong/i.test(assistantText()), 60000), "답(pong)이 채팅에 나타남");
ok(await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 30000), "끝나면 '작업 끝'");
ok(await waitFor(() => /^Haiku \d/.test(status.model ?? ""), 8000), `모델 칩: ${status.model}`);
ok(["", "yourturn"].includes(tm("show-options", "-w", "-v", "-t", `${S}:1`, "@pi_status")), "탭 점: 끝남(보고 있으면 비움)");

// 2) 명령 실행 줄
ev.length = 0;
ws.send(JSON.stringify({ type: "pi-send", text: "Run this exact bash command once: echo hello-cc . Then reply with: done", mode: "auto" }));
const toolMsg = await waitFor(() => ev.find((e) => e.t === "upsert" && e.message?.role === "assistant" && e.message.blocks.some((b) => b.type === "tool" && b.name === "bash")), 60000);
const toolBlock = toolMsg?.message.blocks.find((b) => b.type === "tool");
ok(toolBlock && /echo hello-cc/.test(toolBlock.summary), `명령 단계 줄(bash · ${toolBlock?.desc})`);
ok(await waitFor(() => ev.some((e) => e.t === "upsert" && e.message?.role === "toolResult" && /hello-cc/.test(e.message.output)), 30000), "명령 결과(hello-cc)");
ok(ev.some((e) => e.t === "tool" && e.state === "running") && ev.some((e) => e.t === "tool" && e.state === "done"), "단계 진행 표시(실행 중 → 끝)");
await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 60000);

// 3) 단계 상세
ws.send(JSON.stringify({ type: "detail", id: toolBlock?.id, kind: "tool", key: "k1" }));
const det = await waitFor(() => ev.find((e) => e.t === "detail"), 8000);
ok(det?.detail?.kind === "bash" && /echo hello-cc/.test(det.detail.command) && /hello-cc/.test(det.detail.output), "단계 상세(명령·출력)");

// 4) 승인 알림: 허용 안 된 도구(Write) → 권한 요청 훅 → 폰 알림(시험 모드 기록), 탭 점 '답을 기다림'
ev.length = 0; writeFileSync(LOG, "");
ws.send(JSON.stringify({ type: "pi-send", text: `Use the Write tool to create the file ${DIR}/perm.txt containing the single word x.`, mode: "auto" }));
ok(await waitFor(() => /알림\(시험·안 보냄\) approval 탭 1/.test(readFileSync(LOG, "utf8")), 60000), "승인 창 → 폰 승인 알림");
ok(tm("show-options", "-w", "-v", "-t", `${S}:1`, "@pi_status") === "asking", "탭 점: 답을 기다림(보라)");
tm("send-keys", "-t", `${S}:1`, "Escape");   // 거부
await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 30000);
ok(!existsSync(`${DIR}/perm.txt`), "거부했으니 파일은 안 생김");

// 5) 생각 깊이(폰 메뉴) → /effort
ws.send(JSON.stringify({ type: "pi-command", text: "/thinking high" }));
ok(await waitFor(() => tm("show-options", "-w", "-v", "-t", `${S}:1`, "@ai_thinking") === "high" && status.thinking === "high", 10000), `생각 깊이 칩: ${status.thinking}`);

// 6) 새 대화(/new → /clear)
await sleep(2000); ev.length = 0;
ws.send(JSON.stringify({ type: "pi-command", text: "/new" }));
const fresh = await waitFor(() => ev.find((e) => e.t === "snapshot" && e.messages.length <= 2), 20000);
ok(fresh, `새 대화: 새 기록으로 갈아탐(메시지 ${fresh?.messages.length ?? "?"}개)`);

// 7) 끝내기 → 피드 정리
tm("send-keys", "-t", `${S}:1`, "-l", "/exit"); tm("send-keys", "-t", `${S}:1`, "Enter");
ok(await waitFor(() => !existsSync(sock), 20000), "Claude Code 를 끝내면 피드도 끝나고 소켓 정리");

ws.close(); bridge.kill(); await sleep(500);
execFileSync("sh", [`${REPO}claude-remote/test/stop-test-feeds.sh`, S]);   // 시험 세션 피드만(쓰는 창 피드는 그대로)
tm("kill-session", "-t", S);
rmSync("/tmp/cc-e2e-sessions", { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
