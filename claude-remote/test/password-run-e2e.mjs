// 폰에서 로그인 비밀번호 받기(password-run.mjs) 시험.
// 시험 tmux 세션에서 실행기를 직접 돌려, 탭(🔐암호)이 열리고 폰이 보낸 것처럼 글을 넣으면 클립보드에만 들어가는지,
// 취소·탭 닫힘·시간 초과·중단·저절로 지우기가 각각 맞게 되는지 본다. 진짜 비밀번호는 쓰지 않는다(시험 글).
// 시험이 클립보드를 덮어쓰므로, 시작 때의 글을 기억했다가 끝에 되돌린다(글만, 서식은 못 되돌림).
// 준비: 시험 tmux 세션(창 0 은 셸). 폰 알림은 가짜 홈에 연 알림 소켓으로 받아 내용까지 확인한다.
// 쓰기: node password-run-e2e.mjs [세션=pitest]
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION = process.argv[2] ?? "pitest";
if (SESSION === "antenna") { console.error("쓰는 세션(antenna)에서는 돌리지 않아요. 시험 세션 이름을 주세요"); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "../password-run.mjs");
const CLIP = join(HERE, "../secret-clip.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { const v = fn(); if (v) return v; await sleep(200); } return null; };
const clip = (op, input) => execFileSync("/usr/bin/osascript", ["-l", "JavaScript", CLIP, op], { encoding: "utf8", input }).trim();
const paste = () => execFileSync("pbpaste", { encoding: "utf8" });
const copy = (s) => execFileSync("pbcopy", { input: s });
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const saved = paste();
const pane0 = tm("display", "-p", "-t", `${SESSION}:0`, "#{pane_id}");
const home = tm("display", "-p", "-t", SESSION, "#{window_index}");
const TMP = mkdtempSync(join(tmpdir(), "password-run-e2e-"));            // 실행기가 만드는 임시 폴더를 여기에 가둠
const pwWin = () => tm("list-windows", "-t", SESSION, "-F", "#{window_index} #{window_name} #{window_active} #{@sudo_stage}").split("\n").find((l) => l.includes("🔐암호"));
const leftovers = () => readdirSync(TMP).filter((f) => f.startsWith("claude-password-"));
// 폰 알림: 실행기는 ~/.cache/pi-remote/notify-<세션>.sock 에 알림을 쓴다 → 가짜 홈에 소켓을 열어 받은 알림을 모음
// (소켓 경로는 104자를 넘으면 안 돼서 짧은 곳에)
const HOME = mkdtempSync("/tmp/pwe2e-");
mkdirSync(join(HOME, ".cache/pi-remote"), { recursive: true });
const notes = [];
const sock = createServer((c) => { let b = ""; c.on("data", (d) => (b += d)); c.on("end", () => b.trim() && notes.push(JSON.parse(b))); });
await new Promise((r) => sock.listen(join(HOME, `.cache/pi-remote/notify-${tm("display", "-p", "-t", `${SESSION}:0`, "#{session_name}")}.sock`), r));
const send = (text) => (w) => { tm("send-keys", "-t", `${SESSION}:${w}`, "-l", text); tm("send-keys", "-t", `${SESSION}:${w}`, "Enter"); };

/** 실행기를 띄우고, 탭이 열리면 act(창 번호)를 한 뒤 끝날 때까지 기다림 */
async function run(args, act, env = {}) {
  const before = new Set(leftovers());
  const p = spawn(process.execPath, [RUN, ...args], { env: { ...process.env, HOME, TMUX_PANE: pane0, TMPDIR: TMP, PI_REMOTE_PASSWORD_CLEAR_S: "3", ...env }, cwd: TMP });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (err += d));
  const done = new Promise((r) => p.on("close", (code, sig) => r({ code, sig })));
  const w = await waitFor(pwWin, 6000);
  let screen = "", after = "", opened = w;
  if (w) {
    await sleep(1000);
    opened = pwWin() ?? w;   // 단계(@sudo_stage)는 탭 스크립트가 켜진 뒤에 적힘
    screen = tm("capture-pane", "-p", "-t", `${SESSION}:${w.split(" ")[0]}`);
    if (act) await act(w.split(" ")[0], p);
    await sleep(400);
    try { after = tm("capture-pane", "-p", "-t", `${SESSION}:${w.split(" ")[0]}`); } catch { /* 이미 닫힘 */ }
  }
  const r = await Promise.race([done, sleep(20000).then(() => { p.kill("SIGKILL"); return { code: "시간 초과(시험)" }; })]);
  await sleep(300);
  return { ...r, out, err, opened, screen, after, closed: await waitFor(() => !pwWin(), 8000), left: leftovers().filter((f) => !before.has(f)) };
}

try {
  // 1. 받기: 폰이 보낸 것처럼 글 + Enter → 클립보드에만, 숨김 표시, 탭 닫힘, 원래 창으로
  const FAKE = " 시험-Pw\\$HOME'\"`x` 끝 ";
  copy("사용자가 원래 복사해 둔 글");
  let r = await run(["example.com 로그인(시험)"], send(FAKE));
  ok(!!r.opened && / 1 running$/.test(r.opened), `받기: 🔐암호 탭이 열리고 현재 창, 단계 running(폰이 가려진 칸을 띄움) (${r.opened})`);
  ok(r.screen.includes("example.com 로그인(시험)") && r.screen.includes("'암호'"), "받기: 탭에 무엇의 비밀번호인지와 안내가 보임");
  ok(r.code === 0 && /clipboard/.test(r.out) && !r.out.includes(FAKE.trim()), "받기: 성공(0)으로 끝나고, AI 에 가는 글에 값이 없음");
  ok(paste() === FAKE, "받기: 클립보드 글이 보낸 글과 같음(앞뒤 공백·따옴표·역슬래시·$·한글 그대로)");
  const c = JSON.parse(clip("check"));
  ok(c.ours && c.hidden, "받기: 클립보드에 우리 표시와 숨김 표시가 붙음");
  ok(!r.after.includes("시험-Pw") && !r.screen.includes("시험-Pw"), "받기: 친 글이 탭 화면에 보이지 않음");
  ok(r.closed && r.left.length === 0, "받기: 탭이 닫히고 임시 폴더가 남지 않음");
  ok(tm("display", "-p", "-t", SESSION, "#{window_index}") === home, `받기: 끝나면 원래 보던 창(${home})으로 돌아옴`);
  const note = notes[0];
  ok(notes.length === 1 && note.kind === "prompt" && note.title === "로그인 비밀번호가 필요해요" && note.body.startsWith("example.com 로그인(시험): ") && note.window === Number(r.opened.split(" ")[0]),
    `받기: 폰 알림 1번, 무엇의 비밀번호인지와 탭 번호가 담김 → ${JSON.stringify(note)}`);
  // 1-1. 저절로 지우기(시험에서는 3초)
  await sleep(4500);
  ok(JSON.parse(clip("check")).length === 0, "저절로 지우기: 정한 시간이 지나면 클립보드가 비워짐");

  // 2. 그 사이 사용자가 다른 것을 복사했으면 저절로 지우기가 건드리지 않음
  r = await run(["시험"], send("pw-2"));
  ok(r.code === 0 && paste() === "pw-2", "다른 것 복사: 먼저 비밀번호가 들어감");
  copy("사용자가 새로 복사한 글");
  await sleep(4500);
  ok(paste() === "사용자가 새로 복사한 글", "다른 것 복사: 저절로 지우기가 사용자가 복사한 글은 그대로 둠");

  // 3. 빈 Enter 는 무시하고 계속 기다림 → 그다음 글을 받음
  r = await run(["시험"], async (w) => { tm("send-keys", "-t", `${SESSION}:${w}`, "Enter"); await sleep(800); ok(!!pwWin(), "빈 Enter: 탭이 그대로 기다림"); send("pw-3")(w); });
  ok(r.code === 0 && paste() === "pw-3", "빈 Enter 뒤 보낸 글을 받음");
  clip("clear");
  ok(JSON.parse(clip("check")).length === 0, "AI 가 붙여 넣은 뒤 부르는 지우기 명령이 비움");

  // 4. 취소(폰의 멈추기 = Ctrl+C)
  copy("그대로여야 함");
  r = await run(["시험"], (w) => tm("send-keys", "-t", `${SESSION}:${w}`, "C-c"));
  ok(r.code === 1 && /cancelled/.test(r.err), `취소: 실패(1)와 취소 알림 → ${r.err.trim().slice(0, 60)}`);
  ok(r.closed && r.left.length === 0 && paste() === "그대로여야 함", "취소: 탭이 닫히고 임시 폴더가 없고 클립보드는 그대로");

  // 5. 탭이 닫힘
  r = await run(["시험"], (w) => tm("kill-window", "-t", `${SESSION}:${w}`));
  ok(r.code === 1 && /closed/.test(r.err) && r.left.length === 0, "탭 닫힘: 실패와 알림, 임시 폴더 없음");

  // 6. 시간 초과
  r = await run(["시험"], null, { PI_REMOTE_PASSWORD_WAIT_MS: "2500" });
  ok(r.code === 1 && /No password arrived/.test(r.err) && r.closed && r.left.length === 0, "시간 초과: 실패, 탭 닫힘, 임시 폴더 없음");

  // 7. 중단(Claude Code 가 실행을 끝냄) → 탭도 닫힘
  r = await run(["시험"], async (w, p) => { p.kill("SIGTERM"); await sleep(500); });
  ok(r.code === 130 && r.closed && r.left.length === 0, `중단: 130 으로 끝나고 탭이 닫힘 (${r.code})`);

  // 8. 잘못 부름: 설명 없음·tmux 칸 없음 → 탭을 열지 않고 바로 실패
  const n2 = tm("list-windows", "-t", SESSION).split("\n").length;
  r = await run([], null);
  ok(r.code === 1 && /say which login/.test(r.err) && !r.opened, "설명 없이 부르면 탭 없이 실패");
  r = await run(["시험"], null, { TMUX_PANE: "" });
  ok(r.code === 1 && /No terminal tab/.test(r.err) && !r.opened, "tmux 밖에서 부르면 탭 없이 실패");
  ok(tm("list-windows", "-t", SESSION).split("\n").length === n2, "잘못 부른 경우 창이 늘지 않음");
} finally {
  sock.close();
  rmSync(HOME, { recursive: true, force: true });
  rmSync(TMP, { recursive: true, force: true });
  copy(saved);
  console.log(paste() === saved ? "클립보드를 시험 전 글로 되돌림" : "클립보드를 되돌리지 못함");
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
