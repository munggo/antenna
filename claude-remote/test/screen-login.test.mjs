// 로그인 같은 맥 화면 창(주소를 열어 로그인하고 받은 코드를 칸에 붙여 넣음)을 폰 카드로 끝까지 하는지 가짜 창으로 시험(모델을 부르지 않음, 20초쯤).
// 11-27 사용자 보고: Claude Code /login 화면이 폰 카드에는 'Opening browser to sign in…' 과 취소만 보였다(주소·코드 칸이 없음)
// 1) 처음 창('Opening browser…')은 보통 카드  2) 주소와 칸이 나타나면 카드를 새로 만듦: 폰 폭(50칸)에 접힌 긴 주소가 한 줄로 이어져
//    잘리지 않고, 입력해서 답하는 카드(kind input)  3) 폰에서 보낸 코드가 맥 칸에 그대로 들어가고 Enter  4) 카드는 닫힘
// 5) 맥 화면이 그사이 다른 창으로 바뀌었으면 넣지 않음
// 시험 세션(logintest)·가짜 홈을 만들고 끝나면 지운다. 쓰는 tmux 세션과 쓰는 연결부는 건드리지 않는다.
// 실행: node claude-remote/test/screen-login.test.mjs
// 작성: 서문교
import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FEED = join(dirname(fileURLToPath(import.meta.url)), "..", "claude-feed.mjs");
const S = "logintest", ROOT = `/tmp/antenna-login-${process.pid}`, HOME = `${ROOT}/home`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 200) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
// 가짜 로그인 창(Claude Code 2.1.332 의 모양): 처음엔 'Opening browser…', 신호 파일이 생기면 주소·칸. 친 글은 Enter 까지 파일에 적고 끝남
const URL = "https://claude.ai/oauth/authorize?code=true&client_id=00000000-1111-2222-3333-444444444444&response_type=code" +
  "&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abcDEF123_-xyz&state=st4te";
const LOGIN = `${ROOT}/login.mjs`, SHOW = `${ROOT}/show-url`, TYPED = `${ROOT}/typed`;
writeFileSync(LOGIN, `import { existsSync, writeFileSync } from "node:fs";
let typed = "";
const draw = () => {
  const url = existsSync(${JSON.stringify(SHOW)});
  const box = "─".repeat(44);
  const rows = ["           Claude Code v9.9.9", "", "▔".repeat(50), "  Login", "",
    ...(url ? ["  Browser didn't open? Use the URL below to sign", "  in (c to copy)", "", ${JSON.stringify(URL)}, "",
      "  Paste code here if prompted", "  ╭" + box + "╮", "  │ " + typed.padEnd(42) + " │", "  ╰" + box + "╯"]
      : ["  ✻ Opening browser to sign in…"]),
    "", "  Esc to cancel"];
  process.stdout.write("\\x1b[2J\\x1b[H" + rows.join("\\r\\n"));
};
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (k) => {
  if (k === "\\r") { writeFileSync(${JSON.stringify(TYPED)}, typed); process.stdout.write("\\x1b[2J\\x1b[H  Login successful"); setTimeout(() => process.exit(0), 300); return; }
  if (k === "\\x1b") process.exit(0);
  typed += k;
  draw();
});
setInterval(draw, 500);
draw();
`);

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "50", "-y", "30", "-c", "/tmp");
// 폰으로 볼 때의 폭(50칸)으로 고정: 긴 주소가 여러 줄로 접힌다(tmux 설정에 따라 새 창이 다른 화면 크기를 따라가므로 손으로 정함)
tm("set-option", "-t", S, "window-size", "manual");
tm("resize-window", "-t", `${S}:`, "-x", "50", "-y", "30");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
const tag = pane.replace(/\W/g, "");
const SOCK = `${HOME}/.cache/pi-remote/feed/${tag}.sock`;
const feed = spawn(process.execPath, [FEED, pane], { env: { ...process.env, HOME }, stdio: "ignore" });
await waitFor(() => existsSync(SOCK), 5000);
const cards = [], closed = [], notices = [];
const c = createConnection(SOCK);
let buf = "";
c.setEncoding("utf8");
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try {
      const m = JSON.parse(l);
      if (m.t === "question" && /^cc-s-/.test(m.question?.id ?? "")) cards.push(m.question);
      if (m.t === "question-done") closed.push(m.id);
      if (m.t === "notice") notices.push(m.text);
    } catch { /* 반쪽 줄 */ }
  }
});
c.on("error", () => {});
await new Promise((r) => c.on("connect", r));
const cmd = (o) => c.write(`${JSON.stringify(o)}\n`);
const start = async () => {
  rmSync(SHOW, { force: true });
  rmSync(TYPED, { force: true });
  tm("send-keys", "-t", pane, "-l", `clear; ${process.execPath} ${LOGIN}`);
  tm("send-keys", "-t", pane, "Enter");
};

try {
  // 1) 처음 창
  await start();
  const q1 = await waitFor(() => cards[0], 15000);
  ok(/^맥 화면: Login/.test(q1?.question ?? "") && /Opening browser/.test(q1?.question ?? "") && q1?.kind === "select", `1) 처음 창은 보통 카드(${q1?.kind})`);
  // 2) 주소와 칸이 나타남 → 카드를 새로
  writeFileSync(SHOW, "");
  const q2 = await waitFor(() => cards.find((q) => q.kind === "input"), 15000);
  const rows = (tm("capture-pane", "-p", "-t", pane) ?? "").split("\n").filter((l) => /^[A-Za-z0-9%&=_.:/?-]+$/.test(l.trim()) && l.trim().length >= 20);
  ok(Boolean(q2) && closed.includes(q1?.id), "2) 주소와 칸이 나타나면 앞 카드를 닫고 입력해서 답하는 카드를 새로 엶");
  ok(rows.length >= 3 && (q2?.question ?? "").split("\n").includes(URL), `2) 폰 폭에 접힌 주소(화면 ${rows.length}줄)가 한 줄로 이어져 잘리지 않음`);
  ok(q2?.placeholder === "로그인 뒤 받은 코드" && /주소를 눌러 로그인한 뒤/.test(q2?.question ?? ""), `2) 입력창 안내·카드 안내(${q2?.placeholder})`);
  ok((q2?.options ?? []).some((o) => o.label === "취소 (Esc)"), "2) 맥 창의 취소(Esc) 선택지는 그대로");
  // 3) 폰에서 보낸 코드 → 맥 칸에 넣고 Enter
  cmd({ cmd: "question-answer", id: q2?.id, answers: [], other: "  CODE-123#abc_DEF  " });
  ok(await waitFor(() => existsSync(TYPED) && readFileSync(TYPED, "utf8"), 5000) === "CODE-123#abc_DEF", "3) 폰에서 보낸 코드가 맥 칸에 그대로(앞뒤 빈칸은 빼고) 들어가고 Enter");
  ok(closed.includes(q2?.id), "4) 카드는 닫힘");
  const log = readFileSync(`${HOME}/.cache/pi-remote/feed/${tag}.hooks.log`, "utf8");
  ok(/칸에 글을 넣음\(16자\)/.test(log) && !log.includes("CODE-123"), "3) 기록에는 글자 수만(코드는 남기지 않음)");

  // 5) 맥 화면이 그사이 바뀌었으면 넣지 않음: 카드를 연 뒤 창을 끄고 답함
  await sleep(1500);
  const n = cards.length;
  await start();
  writeFileSync(SHOW, "");
  const q5 = await waitFor(() => cards.slice(n).find((q) => q.kind === "input"), 15000);
  tm("send-keys", "-t", pane, "Escape");
  await waitFor(() => !/Login/.test(tm("capture-pane", "-p", "-t", pane) ?? ""), 3000);
  cmd({ cmd: "question-answer", id: q5?.id, answers: [], other: "LATE-CODE" });
  await sleep(1500);
  ok(Boolean(q5) && !existsSync(TYPED) && !(tm("capture-pane", "-p", "-t", pane) ?? "").includes("LATE-CODE"), "5) 맥 창이 그사이 닫혔으면 글을 넣지 않음");
  ok(notices.some((t) => /그사이 바뀌어 넣지 않았어요/.test(t)) || closed.includes(q5?.id), "5) 넣지 않았다고 알리거나 카드를 닫음");
} finally {
  c.destroy();
  feed.kill();
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
