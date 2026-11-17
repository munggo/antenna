// Claude Code 탭의 컨텍스트 사용량이 앱까지 가는지: 연결부를 실제로 띄우고 대화 기록에 줄을 적어 가며 연결부가 보내는 소식을 본다(모델을 부르지 않음, 20초쯤)
// 1) 붙으면 대화와 함께 사용량(사용 중 토큰·기억 용량·사용률·자동 압축 지점)이 옴  2) 새 응답이 적히면 바뀐 사용량이 옴
// 3) 같은 응답의 다음 조각으로는 다시 보내지 않음  4) 압축이 끝나면 '모름'  5) 다음 응답으로 다시 앎
// 6) 설정 파일의 자동 압축 창·1M 끄기를 다음 응답 때 반영  7) 뒤늦게 붙은 쪽도 지금 값을 받음
// 8) 모르는 모델이면 빈 값(고리를 숨김)  9) 새 대화로 바뀌면 첫 응답 전까지 빈 값
// 11-17 사용자 보고 '앱에서 현재 컨텍스트 확인이 안 보인다'(연결부가 늘 빈 값을 보냄)
// 시험 세션(contextfeedtest)·가짜 홈을 만들고 끝나면 지운다. 쓰는 tmux 세션과 쓰는 연결부는 건드리지 않는다.
// 실행: node claude-remote/test/context-feed.test.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { appendFileSync, existsSync, linkSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FEED = join(HERE, "..", "claude-feed.mjs"), FAKE = join(HERE, "fake-claude.mjs");
const S = "contextfeedtest", ROOT = `/tmp/antenna-ctx-${process.pid}`, HOME = `${ROOT}/home`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 100) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };
const show = (c) => JSON.stringify(c);

mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
mkdirSync(`${HOME}/.claude`, { recursive: true });
mkdirSync(`${ROOT}/bin`, { recursive: true });
mkdirSync(`${ROOT}/fake`, { recursive: true });
const SETTINGS = `${HOME}/.claude/settings.json`;
// 칸에서 도는 프로그램 이름이 버전 번호 꼴이면 연결부가 Claude Code 로 여긴다
const fakeBin = `${ROOT}/bin/9.9.9`;
try { linkSync(process.execPath, fakeBin); } catch { symlinkSync(process.execPath, fakeBin); }

// 대화 기록 줄(모양은 실제 기록에서 본뜸): 사용량은 새 입력 + 캐시에 쓴 것 + 캐시에서 읽은 것
const T = `${ROOT}/t.jsonl`, T2 = `${ROOT}/t2.jsonl`;
let seq = 0;
const answer = (id, model, [input, write, read, out], text = "답") => ({
  type: "assistant", uuid: `a${++seq}`, timestamp: new Date().toISOString(),
  message: { id, model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: out, service_tier: "standard" } },
});
const put = (file, o) => appendFileSync(file, `${JSON.stringify(o)}\n`);
put(T, answer("m1", "claude-fable-5-2", [5, 1_995, 150_000, 7_777]));

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
tm("send-keys", "-t", pane, "-l", `exec ${fakeBin} ${FAKE} ${ROOT}/fake`);
tm("send-keys", "-t", pane, "Enter");
await waitFor(() => /^\d+\.\d+\.\d+$/.test(tm("display", "-p", "-t", pane, "#{pane_current_command}") ?? ""), 5000);

const SOCK = `${HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
const feed = spawn(process.execPath, [FEED, pane], { env: { ...process.env, HOME }, stdio: "ignore" });
await waitFor(() => existsSync(SOCK), 5000);

/** 연결부에 붙어 받은 소식을 모음: snaps(대화 전체에 실린 사용량), ctx(사용량 소식) */
const connect = async () => {
  const got = { snaps: [], ctx: [], sock: createConnection(SOCK) };
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
        if (m.t === "context") got.ctx.push(m.context);
      } catch { /* 반쪽 줄 */ }
    }
  });
  got.sock.on("error", () => {});
  await new Promise((r) => got.sock.on("connect", r));
  return got;
};
const c = await connect();
const hook = (event) => c.sock.write(`${JSON.stringify({ cmd: "hook", event })}\n`);
const lastCtx = () => c.ctx[c.ctx.length - 1];
/** 사용량 소식이 n 개가 될 때까지 기다려 마지막 것을 돌려줌 */
const nextCtx = async (n) => { await waitFor(() => c.ctx.length >= n, 4000); return c.ctx.length >= n ? lastCtx() : undefined; };

try {
  // 1) 대화 기록을 알려 주면(시작 훅) 대화와 함께 사용량이 온다
  hook({ hook_event_name: "SessionStart", transcript_path: T, source: "resume" });
  const s1 = await waitFor(() => c.snaps.find((s) => s.messages?.length), 5000);
  const x1 = s1?.context;
  ok(x1 && x1.tokens === 152_000 && x1.window === 1_000_000 && Math.abs(x1.percent - 15.2) < 1e-9 && x1.auto === true && x1.reserve === 33_000,
    `1) 대화와 함께 사용량이 옴: 152K / 1M = 15.2%, 자동 압축은 967K 에서(${show(x1)})`);
  ok(s1?.agent === "claude" && c.ctx.length === 0, "1) Claude Code 탭의 대화로 오고, 따로 보낸 사용량 소식은 아직 없음");

  // 2) 새 응답이 적히면 바뀐 사용량이 온다
  put(T, answer("m2", "claude-fable-5-2", [10, 0, 199_990, 5]));
  const x2 = await nextCtx(1);
  ok(x2 && x2.tokens === 200_000 && Math.abs(x2.percent - 20) < 1e-9 && x2.window === 1_000_000, `2) 새 응답 → 사용량 소식(20%)(${show(x2)})`);

  // 3) 같은 응답의 다음 조각(사용량이 같음)으로는 다시 보내지 않는다
  put(T, answer("m2", "claude-fable-5-2", [10, 0, 199_990, 5], "이어지는 조각"));
  await sleep(1300);
  ok(c.ctx.length === 1, `3) 같은 응답의 다음 조각으로는 다시 보내지 않음(소식 ${c.ctx.length}번)`);

  // 4) 압축이 끝나면 다음 응답까지 모름(고리에는 '–')
  put(T, { type: "system", subtype: "compact_boundary", uuid: "c1", timestamp: new Date().toISOString(), content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 967_452, postTokens: 44_018 } });
  const x4 = await nextCtx(2);
  ok(x4 && x4.tokens === null && x4.percent === null && x4.window === 1_000_000 && x4.reserve === 33_000, `4) 압축이 끝나면 사용 중 토큰·사용률은 모름, 기억 용량은 그대로(${show(x4)})`);
  put(T, { type: "user", uuid: "u-sum", isCompactSummary: true, timestamp: new Date().toISOString(), message: { role: "user", content: "앞 대화 요약" } });
  await sleep(900);
  ok(c.ctx.length === 2, "4) 요약 줄로는 사용량 소식이 다시 가지 않음");

  // 5) 압축 뒤 첫 응답으로 다시 안다
  put(T, answer("m3", "claude-fable-5-2", [5, 99_995, 0, 1]));
  const x5 = await nextCtx(3);
  ok(x5 && x5.tokens === 100_000 && Math.abs(x5.percent - 10) < 1e-9, `5) 압축 뒤 첫 응답으로 다시 앎(10%)(${show(x5)})`);

  // 6) 설정 파일: 자동 압축 창, 자동 압축 끄기, 1M 끄기(설정 파일의 env). 다음 응답 때 반영한다
  writeFileSync(SETTINGS, JSON.stringify({ autoCompactWindow: 800_000, modelSettings: { "claude-fable-5-2": { autoCompactWindow: 500_000, effortLevel: "xhigh" } } }));
  put(T, answer("m4", "claude-fable-5-2", [5, 0, 109_995, 1]));
  const x6 = await nextCtx(4);
  ok(x6 && x6.tokens === 110_000 && x6.window - x6.reserve === 500_000 && x6.auto === true, `6) 그 모델에 저장한 자동 압축 창(50만)을 씀(${show(x6)})`);
  writeFileSync(SETTINGS, JSON.stringify({ autoCompactEnabled: false }));
  put(T, answer("m5", "claude-fable-5-2", [5, 0, 119_995, 1]));
  const x6b = await nextCtx(5);
  ok(x6b && x6b.auto === false && x6b.reserve === 33_000, `6) 설정에서 자동 압축을 끄면 꺼짐으로(${show(x6b)})`);
  writeFileSync(SETTINGS, JSON.stringify({ env: { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" } }));
  put(T, answer("m6", "claude-fable-5-2", [5, 0, 99_995, 1]));
  const x6c = await nextCtx(6);
  ok(x6c && x6c.window === 200_000 && Math.abs(x6c.percent - 50) < 1e-9 && x6c.reserve === 0 && x6c.auto === true, `6) 설정 파일의 env 로 1M 을 끄면 200K 기준(50%)(${show(x6c)})`);
  writeFileSync(SETTINGS, "{}");

  // 7) 뒤늦게 붙은 쪽(앱을 다시 열었을 때의 브리지)도 지금 값을 받는다
  const late = await connect();
  const s7 = await waitFor(() => late.snaps[0], 3000);
  ok(s7?.context?.tokens === 100_000 && s7.context.window === 1_000_000 && Math.abs(s7.context.percent - 10) < 1e-9, `7) 뒤늦게 붙어도 지금 사용량을 받음(${show(s7?.context)})`);
  late.sock.destroy();

  // 8) 모르는 모델의 응답이면 빈 값(틀린 숫자 대신 고리를 숨김), 아는 모델로 돌아오면 다시
  put(T, answer("m7", "my-gateway-model", [5, 0, 49_995, 1]));
  await waitFor(() => c.ctx.length >= 7, 4000);
  ok(c.ctx.length >= 7 && lastCtx() === null, `8) 모르는 모델이면 빈 값(${show(lastCtx())})`);
  put(T, answer("m8", "claude-opus-4-6", [5, 0, 49_995, 1]));
  const x8 = await nextCtx(8);
  ok(x8 && x8.window === 200_000 && Math.abs(x8.percent - 25) < 1e-9 && x8.reserve === 0, `8) 200K 모델로 바꾸면 그 기준(25%), 자동 압축은 끝에서(${show(x8)})`);

  // 9) 새 대화(다른 기록 파일): 첫 응답 전까지는 빈 값, 첫 응답이 오면 보임
  put(T2, { type: "user", uuid: "n1", timestamp: new Date().toISOString(), message: { role: "user", content: "새 대화 첫 글" } });
  await sleep(1600);   // 같은 훅이 1.5초 안에 다시 오면 연결부가 겹친 것으로 보고 버림
  const before = c.snaps.length;
  hook({ hook_event_name: "SessionStart", transcript_path: T2, source: "clear" });
  const s9 = await waitFor(() => c.snaps[before], 5000);
  ok(s9 && s9.messages?.length === 1 && s9.context === null, `9) 새 대화는 첫 응답 전까지 빈 값(${show(s9?.context)})`);
  const n9 = c.ctx.length;
  put(T2, answer("n-m1", "claude-opus-5-5", [3, 30_000, 19_997, 2]));
  const x9 = await nextCtx(n9 + 1);
  ok(x9 && x9.tokens === 50_000 && x9.window === 1_000_000 && Math.abs(x9.percent - 5) < 1e-9, `9) 새 대화의 첫 응답으로 보임(5%)(${show(x9)})`);
} finally {
  c.sock.destroy();
  feed.kill();
  spawnSync("pkill", ["-f", `claude-feed\\.mjs ${pane}$`]);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
