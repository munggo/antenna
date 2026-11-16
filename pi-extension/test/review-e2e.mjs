// /review·/security-review 실제 시험: 시험 git 저장소에 버그·명령 주입을 넣고, 시험 tmux(pitest)의 pi(Opus, 저장소 템플릿)와
// 시험 브리지(8799)로 폰처럼 질문 카드에 답함. 실행: node pi-extension/test/review-e2e.mjs (세션 pitest 를 만들고 끝나면 지움)
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const S = "pitest", PORT = 8799, TOKEN = "review-token", R = "/tmp/revtest", LOG = "/tmp/review-bridge.log";
const NODE = process.execPath, PI = process.env.PI_BIN || execFileSync("/bin/zsh", ["-lc", "whence -p pi"], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const git = (...a) => execFileSync("git", ["-C", R, ...a], { encoding: "utf8" });
const W = `${S}:1`;
const scr = () => tm("capture-pane", "-p", "-J", "-S", "-300", "-t", W);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 1000) => { for (let t = 0; t < ms; t += step) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
const dump = (n = 25) => console.log(scr().split("\n").filter((l) => l.trim()).slice(-n).map((l) => "     | " + l.slice(0, 120)).join("\n"));

// ── 시험 저장소: main 에 기본 코드, 그 위에 바꾼 코드(버그 + 명령 주입) ──
rmSync(R, { recursive: true, force: true }); mkdirSync(R, { recursive: true });
git("init", "-q", "-b", "main");
git("config", "user.email", "t@t"); git("config", "user.name", "t");
const BASE = `import subprocess\n\n\ndef last_n(items, n):\n    """마지막 n개"""\n    return items[len(items) - n:]\n\n\ndef list_dir(path):\n    return subprocess.run(["ls", path], capture_output=True, text=True).stdout\n`;
const CHANGED = `import subprocess\n\n\ndef last_n(items, n):\n    """마지막 n개"""\n    return items[-n - 1:]\n\n\ndef list_dir(path):\n    # 사용자가 웹 폼에서 보낸 경로\n    return subprocess.run(f"ls {path}", shell=True, capture_output=True, text=True).stdout\n`;
writeFileSync(`${R}/util.py`, BASE);
git("add", "."); git("commit", "-q", "-m", "기본");

// ── 시험 브리지·pi ──
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
writeFileSync(LOG, "");
const bridge = spawn(NODE, ["bridge.mjs"], {
  cwd: `${REPO}/server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S,
    PI_REMOTE_SESSION_DIR: "/tmp/pitest-sessions", PI_REMOTE_PUSH_FILE: "/tmp/pitest-push.json", PI_REMOTE_PUSH_DRYRUN: "1" },
  stdio: "ignore",
});
const EXT = ["claude-accounts", "pi-remote-feed", "ask-user", "send-guard", "compact-tools"].map((n) => `-e ${REPO}/pi-extension/${n}.ts`).join(" ");
const PT = ["review", "security-review"].map((n) => `--prompt-template ${REPO}/pi-extension/prompts/${n}.md`).join(" ");
tm("new-session", "-d", "-s", S, "-x", "150", "-y", "45", "-c", R);
tm("new-window", "-t", S, "-c", R, `${PI} --model claude/claude-opus-5-5 --thinking low -ne ${EXT} -e ${process.env.HOME}/.pi/agent/extensions/subagent/index.ts ${PT}`);
ok(Boolean(await waitFor(() => /opus/i.test(scr()), 30000)), "pi(Opus, 저장소 템플릿) 켬");
await sleep(3000);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
ws.on("message", (d, bin) => { if (!bin) try { const m = JSON.parse(d.toString()); if (m.type === "chat") ev.push(m.d); } catch {} });
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await waitFor(() => ev.find((e) => e.t === "snapshot"), 15000);
const cmds = ev.filter((e) => e.t === "commands").pop()?.commands ?? [];
ok(cmds.some((c) => c.name === "review") && cmds.some((c) => c.name === "security-review"), "폰 명령 목록에 /review·/security-review");
const send = (t) => { tm("send-keys", "-t", W, "-l", t); tm("send-keys", "-t", W, "Enter"); };
const turnDone = () => waitFor(() => { const s = scr().split("\n").slice(-8).join("\n"); return !/Working|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/.test(s) ? true : null; }, 600000, 3000);

// ── 1) 검토할 게 없음(깨끗한 main) ──
// 화면에는 펼친 템플릿 글(subagent 라는 낱말 포함)이 보이므로, 연결부가 보낸 실제 도구 호출로 판정
let from1 = ev.length;
send("/review");
await sleep(5000); await turnDone(); await sleep(2000);
const calls1 = JSON.stringify(ev.slice(from1));
const usedSub = /"(name|tool|toolName)":"subagent"/.test(calls1);
const lastText = [...ev.slice(from1)].reverse().find((e) => e.t === "upsert" && e.message?.role === "assistant")?.message;
const said = JSON.stringify(lastText ?? "");
ok(/없어요|없습니다|없음|clean|nothing/i.test(said) && !usedSub, `1) 바뀐 게 없으면 리뷰어를 부르지 않고 '없다'고만(리뷰어 호출 ${usedSub ? "있음" : "없음"})`);
if (process.env.ONLY1) { ws.close(); bridge.kill(); tm("kill-session", "-t", S); rmSync(R, { recursive: true, force: true }); console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0); }

// ── 2) 커밋 안 한 변경 /review → 버그 찾기 → 카드에서 1번만 고르기 → 그것만 고침, 커밋 안 함 ──
writeFileSync(`${R}/util.py`, CHANGED);
let from = ev.length;
send("/new"); await sleep(3000);
send("/review");
const q2 = await waitFor(() => ev.slice(from).find((e) => e.t === "question"), 900000, 3000);
ok(Boolean(q2), "2) 리뷰 뒤 고칠 것 고르는 질문 카드");
if (!q2) dump(40);
const opts2 = (q2?.question?.options ?? q2?.question?.questions?.[0]?.options ?? []).map((o) => o.label ?? o);
console.log(`     카드 선택지: ${JSON.stringify(opts2)}`);
ok(opts2.length >= 2 && opts2.some((l) => /고치지 않음/.test(l)), "2) 선택지 = 찾은 문제들 + '고치지 않음'");
const bugOpt = opts2.find((l) => /last_n|n - 1|-n|마지막|off|하나 더|개수/i.test(l));
ok(Boolean(bugOpt), `2) last_n 의 개수 버그를 찾음(${bugOpt ?? "없음"})`);
ok(/\[상\]|\[중\]|\[하\]/.test(scr()) && /util\.py:\d+/.test(scr()), "2) 보고: 심각도·file:line 형식");
if (q2 && bugOpt) {
  ws.send(JSON.stringify({ type: "question-answer", id: q2.question.id, answers: [bugOpt], other: "" }));
  await sleep(5000); await turnDone();
  const now = readFileSync(`${R}/util.py`, "utf8");
  ok(!/items\[-n - 1:\]/.test(now), "2) 고른 버그는 고침");
  ok(/shell=True/.test(now), "2) 고르지 않은 문제(명령 주입)는 그대로");
  ok(git("log", "--oneline").trim().split("\n").length === 1, "2) 커밋하지 않음");
}

// ── 3) 브랜치 변경(커밋 안 한 것 없음) /security-review → 명령 주입 → '고치지 않음' ──
writeFileSync(`${R}/util.py`, CHANGED);
git("checkout", "-q", "-b", "feature"); git("commit", "-q", "-am", "바꿈");
from = ev.length;
send("/new"); await sleep(3000);
send("/security-review");
const q3 = await waitFor(() => ev.slice(from).find((e) => e.t === "question"), 900000, 3000);
const opts3 = (q3?.question?.options ?? q3?.question?.questions?.[0]?.options ?? []).map((o) => o.label ?? o);
console.log(`     카드 선택지: ${JSON.stringify(opts3)}`);
ok(Boolean(q3) && opts3.some((l) => /shell|명령|주입|injection|list_dir/i.test(l)), "3) 브랜치 vs main 에서 명령 주입을 찾음");
ok(!opts3.some((l) => /last_n/i.test(l)), "3) 보안 리뷰는 일반 버그(last_n)를 넣지 않음");
if (q3) {
  ws.send(JSON.stringify({ type: "question-answer", id: q3.question.id, answers: [opts3.find((l) => /고치지 않음/.test(l)) ?? "고치지 않음"], other: "" }));
  await sleep(5000); await turnDone();
  ok(readFileSync(`${R}/util.py`, "utf8") === CHANGED && git("status", "--porcelain").trim() === "", "3) '고치지 않음'이면 아무것도 바꾸지 않음");
}

ws.close(); bridge.kill();
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
rmSync(R, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
