// Claude Code 탭의 '압축하는 중'이 앱까지 가는지: 가짜 Claude Code 화면의 진행 줄을 바꿔 가며 연결부가 보내는 소식을 본다(모델을 부르지 않음, 1분쯤)
// 1) 쉬는 화면이면 압축 중이 아님  2) 압축 진행 줄이 보이면 '압축하는 중'과 시작한 때(그 줄의 경과 시간으로 셈)
// 3) 뒤늦게 붙은 쪽도 지금 상태를 받음  4) 압축하는 중에 '지금 압축하기'를 또 누르면 맥에 넣지 않고 안내
// 5) 진행 줄이 잠깐 안 보여도(화면을 다시 그리는 틈) 끄지 않음  6) 압축이 끝났다는 기록 줄을 읽으면 바로 끔(사용량은 '모름')
// 7) 쉬는 중의 '지금 압축하기'는 맥 입력창에 /compact  8) 취소(진행 줄만 사라지고 기록에 남는 것이 없음)면 화면이 두 번 연속 쉬는 것을 보고 끔
// 9) 압축하는 도중에 새로 뜬 연결부도 처음부터 '압축하는 중'(기록의 옛 압축 줄로 끄지 않음)
// 10) 압축하는 중에는 연결부가 새 판으로 바뀌지 않고, 끝나면 바뀜
// 11-17 사용자 요청 '컨텍스트가 압축 중일 때 앱에서도 확인이 되어야 됩니다'. 진행 줄의 모양은 실제 Claude Code 2.1.326 에서 모은 것
// (압축 직전 훅은 뒤에서 요약을 미리 쓰기 시작할 때도 와서 쓰지 않는다). 시험 세션(compactingtest)·가짜 홈을 만들고 끝나면 지운다.
// 실행: node claude-remote/test/compacting.test.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { appendFileSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = "compactingtest", ROOT = `/tmp/antenna-compacting-${process.pid}`, HOME = `${ROOT}/home`, INSTALL = `${ROOT}/install`, FEED = `${INSTALL}/claude-feed.mjs`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 100) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
mkdirSync(`${ROOT}/bin`, { recursive: true });
mkdirSync(INSTALL, { recursive: true });
// 연결부는 사본으로 돌린다(10번에서 설치된 파일이 바뀐 것처럼 사본을 고침)
for (const f of ["claude-feed.mjs", "claude-account.mjs", "bg-launch.mjs"]) copyFileSync(join(SRC, f), join(INSTALL, f));

// 가짜 Claude Code: progress 파일의 글을 진행 줄 자리에 0.3초마다 다시 그리고, 입력창에 들어온 글은 typed.txt 에 적는다
const PROGRESS = `${ROOT}/progress`, TYPED = `${ROOT}/typed.txt`;
const IDLE = "✻ Cooked for 2s · done 10:00 PM", DONE = "✻ Conversation compacted (ctrl+o for the summary)";
const show = (text) => writeFileSync(PROGRESS, text);
show(IDLE);
writeFileSync(TYPED, "");
writeFileSync(`${ROOT}/fake.mjs`, `
import { appendFileSync, readFileSync } from "node:fs";
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (d) => appendFileSync(${JSON.stringify(TYPED)}, d));
const line = "─".repeat(60);
setInterval(() => {
  const progress = readFileSync(${JSON.stringify(PROGRESS)}, "utf8");
  const busy = /…/.test(progress);
  const rows = ["⏺ 답 줄", ...progress.split("\\n"), line, "❯ ", line, "  ~/x [main] Opus 5.5 (high) · 개인", "  ⏸ manual mode on · " + (busy ? "esc to interrupt" : "? for shortcuts")];
  // 화면을 통째로 지우지 않고 줄마다 덮어씀(지운 직후를 읽으면 빈 화면이 잡혀 시험이 흔들림)
  process.stdout.write("\\x1b[H" + rows.map((r) => r + "\\x1b[K").join("\\r\\n") + "\\x1b[J");
}, 300);
`);
// 칸에서 도는 프로그램 이름이 버전 번호 꼴이면 연결부가 Claude Code 로 여긴다
const fakeBin = `${ROOT}/bin/9.9.9`;
try { linkSync(process.execPath, fakeBin); } catch { symlinkSync(process.execPath, fakeBin); }

// 대화 기록: 답 하나(입력 토큰 152,000)
const T = `${ROOT}/t.jsonl`;
const put = (o) => appendFileSync(T, `${JSON.stringify({ timestamp: new Date().toISOString(), ...o })}\n`);
put({ type: "assistant", uuid: "a1", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "text", text: "답" }], stop_reason: "end_turn", usage: { input_tokens: 5, cache_creation_input_tokens: 1_995, cache_read_input_tokens: 150_000, output_tokens: 9 } } });

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
tm("send-keys", "-t", pane, "-l", `exec ${fakeBin} ${ROOT}/fake.mjs`);
tm("send-keys", "-t", pane, "Enter");
await waitFor(() => /^\d+\.\d+\.\d+$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), 5000);
await waitFor(() => (tm("capture-pane", "-p", "-t", pane) ?? "").includes("Cooked for 2s"), 5000);

const SOCK = `${HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`, LOG = `${HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.hooks.log`;
const pids = () => { try { return execFileSync("pgrep", ["-f", `claude-feed\\.mjs ${pane}$`], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number); } catch { return []; } };
const start = async () => {
  // 판 확인은 1초마다·2초 조용하면(10번), 계정 전환은 돌지 않게
  const env = { ...process.env, HOME, PI_REMOTE_REV_TICK_SEC: "1", PI_REMOTE_REV_IDLE_SEC: "2", PI_REMOTE_ACCOUNT_TICK_SEC: "3600" };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  spawn(process.execPath, [FEED, pane], { detached: true, stdio: "ignore", env }).unref();
  await waitFor(() => existsSync(SOCK) && pids().length === 1, 5000);
};
/** 연결부에 붙어 받은 소식을 모음: snaps(대화 전체), comp(압축하는 중 소식과 받은 때), ctx(사용량), notices(안내) */
const connect = async () => {
  const got = { snaps: [], comp: [], ctx: [], notices: [], sock: createConnection(SOCK) };
  let buf = "";
  got.sock.setEncoding("utf8");
  got.sock.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(l);
        if (m.t === "snapshot") got.snaps.push(m);
        if (m.t === "compacting") got.comp.push({ value: m.value, since: m.since, at: Date.now() });
        if (m.t === "context") got.ctx.push(m.context);
        if (m.t === "notice") got.notices.push(m.text);
      } catch { /* 반쪽 줄 */ }
    }
  });
  got.sock.on("error", () => {});
  await new Promise((r) => got.sock.on("connect", r));
  return got;
};
const typed = () => readFileSync(TYPED, "utf8");

await start();
let c = await connect();
const send = (o) => c.sock.write(`${JSON.stringify(o)}\n`);
const last = () => c.comp[c.comp.length - 1];
/** 압축하는 중 소식이 n 번이 될 때까지 기다려 마지막 것을 돌려줌 */
const nextComp = async (n, ms) => { await waitFor(() => c.comp.length >= n, ms); return c.comp.length >= n ? last() : undefined; };

try {
  // 1) 쉬는 화면
  send({ cmd: "hook", event: { hook_event_name: "SessionStart", transcript_path: T, source: "resume" } });
  const s1 = await waitFor(() => c.snaps.find((s) => s.messages?.length), 5000);
  ok(s1 && s1.compacting === false && s1.compactSince === null && s1.context?.tokens === 152_000, `1) 쉬는 화면: 압축 중이 아님(${s1?.compacting}, ${s1?.compactSince})`);
  await sleep(2500);
  ok(c.comp.length === 0, "1) 쉬는 동안에는 압축 소식이 없음");

  // 2) 압축 진행 줄이 보이면 켜지고, 시작한 때는 그 줄의 경과 시간(12초)만큼 앞
  show("✽ Compacting conversation… (12s · ↓ 1.0k tokens)\n  ⎿  Tip: 시험");
  const on = await nextComp(1, 4000);
  ok(on?.value === true && Math.abs(on.at - on.since - 12_000) < 1500, `2) 압축 진행 줄 → '압축하는 중', 시작한 때는 12초 전(${on ? ((on.at - on.since) / 1000).toFixed(1) : "?"}초 전)`);
  await sleep(2500);
  ok(c.comp.length === 1, "2) 진행 줄이 이어지는 동안에는 다시 보내지 않음");

  // 3) 뒤늦게 붙은 쪽
  const late = await connect();
  const s3 = await waitFor(() => late.snaps[0], 3000);
  ok(s3?.compacting === true && s3.compactSince === on?.since, `3) 뒤늦게 붙어도 '압축하는 중'과 같은 시작 시각(${s3?.compacting}, ${s3?.compactSince === on?.since})`);
  late.sock.destroy();

  // 4) 압축하는 중에 '지금 압축하기'를 또 누름 → 맥에 넣지 않고 안내
  send({ cmd: "compact" });
  ok(await waitFor(() => c.notices.includes("이미 대화를 압축하는 중이에요"), 3000), "4) 압축하는 중의 '지금 압축하기'는 안내만");
  await sleep(700);
  ok(typed() === "", `4) 맥 입력창에는 아무것도 넣지 않음('${typed().trim()}')`);

  // 5) 진행 줄이 잠깐(0.8초) 안 보였다가 다시 보여도 끄지 않음
  show(IDLE);
  await sleep(800);
  show("✶ Compacting conversation… (20s · ↓ 2.0k tokens)");
  await sleep(4500);
  ok(c.comp.length === 1, `5) 잠깐 안 보인 것으로는 끄지 않음(소식 ${c.comp.length}번)`);

  // 6) 끝남: 화면이 바뀌고 기록에 압축 줄·요약 줄 → 화면을 두 번 볼 때까지 기다리지 않고 바로 끔
  const t6 = Date.now();
  show(DONE);
  put({ type: "system", subtype: "compact_boundary", uuid: "c1", content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 967_452, postTokens: 44_018, durationMs: 109_219 } });
  put({ type: "user", uuid: "u-sum", isCompactSummary: true, message: { role: "user", content: "앞 대화 요약" } });
  const off = await nextComp(2, 1500);
  ok(off?.value === false && off.since === null && off.at - t6 < 1500, `6) 압축이 끝났다는 기록 줄 → 바로 끔(${off ? off.at - t6 : "?"}ms)`);
  ok(await waitFor(() => c.ctx.some((x) => x && x.tokens === null && x.window === 1_000_000), 3000), "6) 사용량은 다음 응답까지 '모름'");
  await sleep(4500);
  ok(c.comp.length === 2, "6) 끝난 화면에서는 다시 켜지지 않음");
  // 압축 중이 아닐 때 읽은 압축 줄(미리 써 둔 요약으로 바로 끝나는 압축: 화면에 진행 줄이 뜰 틈이 없음)로는 압축 소식을 보내지 않음
  put({ type: "system", subtype: "compact_boundary", uuid: "c2", content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 967_000, postTokens: 40_000, durationMs: 45 } });
  // 오래 걸린 압축(1분 49초)인데 화면에서 진행 줄을 보지 못한 것은 기록에 남긴다(진행 줄의 모양이 바뀌어 못 알아보는지 나중에 알 수 있게)
  put({ type: "system", subtype: "compact_boundary", uuid: "c3", content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 300_000, postTokens: 30_000, durationMs: 109_219 } });
  await sleep(1200);
  ok(c.comp.length === 2, `6) 압축 중이 아닐 때 읽은 압축 줄로는 소식을 보내지 않음(소식 ${c.comp.length}번)`);
  const log6 = existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
  ok(/압축하는 중\(맥 화면에 압축 진행 줄\)/.test(log6) && /압축하는 중 끝\(기록의 압축 줄\)/.test(log6), "6) 켜고 끈 것을 연결부 기록에 남김(끈 까닭도)");
  ok((log6.match(/화면에서 압축 진행 줄을 보지 못함/g) ?? []).length === 1 && /보지 못함\(109초 걸림\)/.test(log6), "6) 오래 걸렸는데 진행 줄을 못 본 압축만 기록에 남김(바로 끝난 것은 아님)");

  // 7) 쉬는 중의 '지금 압축하기' → 맥 입력창에 /compact
  send({ cmd: "compact" });
  ok(await waitFor(() => typed().includes("/compact"), 3000), `7) 쉬는 중이면 맥 입력창에 /compact('${typed().trim()}')`);

  // 8) 취소: 진행 줄만 사라지고 기록에는 남는 것이 없음 → 화면이 두 번 연속 쉬는 것을 보고 끔
  show("· Compacting conversation… (0s)");
  const on8 = await nextComp(3, 4000);
  ok(on8?.value === true, "8) 다시 압축 진행 줄 → '압축하는 중'");
  const t8 = Date.now();
  show(IDLE);
  await sleep(1500);
  ok(c.comp.length === 3, "8) 진행 줄이 사라진 직후에는 아직 끄지 않음(한 번 더 봄)");
  const off8 = await nextComp(4, 6000);
  ok(off8?.value === false && off8.at - t8 >= 1500 && off8.at - t8 < 7500, `8) 취소·실패면 화면을 두 번 보고 끔(${off8 ? ((off8.at - t8) / 1000).toFixed(1) : "?"}초 뒤)`);
  ok(/압축하는 중 끝\(진행 줄이 사라짐\)/.test(readFileSync(LOG, "utf8")), "8) 기록에는 '진행 줄이 사라짐'으로 남음");

  // 9) 압축하는 도중에 새로 뜬 연결부: 처음부터 '압축하는 중'(기록에 옛 압축 줄이 있어도)
  show("✢ Compacting conversation… (1m 49s · ↓ 4.2k tokens)");
  await sleep(600);
  c.sock.destroy();
  spawnSync("pkill", ["-f", `claude-feed\\.mjs ${pane}$`]);
  await waitFor(() => pids().length === 0, 5000);
  rmSync(SOCK, { force: true });
  await start();
  c = await connect();
  const s9 = await waitFor(() => c.snaps[0], 3000);
  const ago = s9 ? (Date.now() - s9.compactSince) / 1000 : NaN;
  ok(s9?.compacting === true && Math.abs(ago - 109) < 4, `9) 새로 뜬 연결부의 첫 소식부터 '압축하는 중', 1분 49초 전에 시작(${ago.toFixed(0)}초 전)`);
  // 대화 기록을 알려 주면 옛 압축 줄(6번에서 적은 것)이 든 기록을 처음부터 읽는다. 그 줄로 끄면 안 됨
  send({ cmd: "hook", event: { hook_event_name: "SessionStart", transcript_path: T, source: "resume" } });
  const s9b = await waitFor(() => c.snaps.find((s) => s.messages?.some((m) => m.role === "summary")), 5000);
  await sleep(1000);
  ok(s9b?.compacting === true && c.comp.length === 0, `9) 옛 압축 줄이 든 기록을 처음 읽고도 꺼지지 않음(${s9b?.compacting}, 소식 ${c.comp.length}번)`);

  // 10) 압축하는 중에는 새 판으로 바뀌지 않고(바뀌면 표시가 끊김), 끝나면 바뀜
  const before = pids();
  appendFileSync(FEED, "\n// 시험: 설치된 파일이 바뀜\n");
  await sleep(6500);
  ok(pids().join() === before.join() && before.length === 1, `10) 압축하는 중에는 연결부가 그대로(${before} → ${pids()})`);
  show(IDLE);
  const swapped = await waitFor(() => { const p = pids(); return p.length === 1 && p[0] !== before[0]; }, 25_000, 250);
  ok(swapped, `10) 압축이 끝나 쉬게 되면 새 판으로 바뀜(${before} → ${pids()})`);
  c.sock.destroy();
  await waitFor(() => existsSync(SOCK), 5000);
  c = await connect();
  const s10 = await waitFor(() => c.snaps[0], 3000);
  ok(s10?.compacting === false && s10.compactSince === null, "10) 새 판 연결부: 쉬는 화면이라 압축 중이 아님");
} finally {
  c.sock.destroy();
  spawnSync("pkill", ["-f", `claude-feed\\.mjs ${pane}$`]);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
