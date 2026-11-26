// 번호 없는 고르기 창('❯ No / Yes')을 폰 카드로 묻고, 폰에서 고른 대로 맥에서 ↑/↓·Enter 를 누르는지 시험(모델을 부르지 않음).
// 11-24 사용자 보고: 아티팩트 지우기 확인 창이 폰 카드에 No·Yes 없이 '취소(Esc)·amend(Tab)'만 나왔다.
// 시험 tmux 세션(pickertest)에 그 창을 그리고 키를 받는 가짜 프로그램을 띄우고, 연결부를 가짜 홈으로 따로 띄워 소켓으로 카드를 받는다.
// 쓰는 tmux 세션과 쓰는 연결부는 건드리지 않는다. 실행: node claude-remote/test/screen-picker.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FEED = join(dirname(fileURLToPath(import.meta.url)), "..", "claude-feed.mjs");
const S = "pickertest", ROOT = `/tmp/antenna-picker-${process.pid}`, HOME = `${ROOT}/home`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 200) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

mkdirSync(`${HOME}/.cache/pi-remote/feed`, { recursive: true });
// 가짜 확인 창: 스크린숏과 같은 모양(맨 앞 칸 '❯ No', 두 칸 들여 쓴 'Yes'). ↑/↓ 로 옮기고 Enter 면 고른 것을 파일에 적고 끝남
const PICKER = `${ROOT}/picker.mjs`, PICKED = `${ROOT}/picked`;
writeFileSync(PICKER, `import { writeFileSync } from "node:fs";
const opts = ["No", "Yes"];
let cur = Number(process.argv[2] ?? 0);
const draw = () => process.stdout.write("\\x1b[2J\\x1b[H" + ['● Artifact(delete "시험" · https://claude.ai/artifact/abc)', "  ⎿  Waiting…", "", "─".repeat(70),
  'Permanently delete "시험"?', "", ...opts.map((o, i) => (i === cur ? "❯ " : "  ") + o), "", "Esc to cancel · Tab to amend"].join("\\r\\n"));
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (k) => {
  if (/^\\x1b[[O]A$/.test(k)) cur = Math.max(0, cur - 1);
  else if (/^\\x1b[[O]B$/.test(k)) cur = Math.min(opts.length - 1, cur + 1);
  else if (k === "\\r" || k === "\\x1b") {
    writeFileSync(${JSON.stringify(PICKED)}, k === "\\r" ? opts[cur] : "esc");
    process.stdout.write("\\x1b[2J\\x1b[H");
    process.exit(0);
  }
  draw();
});
draw();
`);

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
const tag = pane.replace(/\W/g, "");
const SOCK = `${HOME}/.cache/pi-remote/feed/${tag}.sock`;
const feed = spawn(process.execPath, [FEED, pane], { env: { ...process.env, HOME }, stdio: "ignore" });
await waitFor(() => existsSync(SOCK), 5000);
const cards = [];
const c = createConnection(SOCK);
let buf = "";
c.setEncoding("utf8");
c.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(l); if (m.t === "question" && /^cc-s-/.test(m.question?.id ?? "")) cards.push(m.question); } catch { /* 반쪽 줄 */ }
  }
});
c.on("error", () => {});
await new Promise((r) => c.on("connect", r));
const cmd = (o) => c.write(`${JSON.stringify(o)}\n`);
const run = async (start) => {
  rmSync(PICKED, { force: true });
  tm("send-keys", "-t", pane, "-l", `clear; ${process.execPath} ${PICKER} ${start}`);
  tm("send-keys", "-t", pane, "Enter");
  const n = cards.length;
  return waitFor(() => cards.length > n && cards.at(-1), 15000);
};

try {
  // 1) 맥에서 No 에 있는 창 → 폰 카드에 아니요·예, 예를 고르면 ↓ 다음 Enter
  const q1 = await run(0);
  const labels1 = (q1?.options ?? []).map((o) => o.label);
  ok(/^맥 화면: Permanently delete "시험"\?/.test(q1?.question ?? ""), `카드 제목(${String(q1?.question ?? "").split("\n")[0]})`);
  ok(labels1.slice(0, 2).join("|") === "아니요 (No)|예 (Yes)", `카드 선택지에 아니요·예(${labels1.join(", ")})`);
  cmd({ cmd: "question-answer", id: q1?.id, answers: ["예 (Yes)"] });
  ok(await waitFor(() => existsSync(PICKED) && readFileSync(PICKED, "utf8"), 5000) === "Yes", "예를 고르자 맥 창에서 Yes 가 골라짐");

  // 2) 맥에서 Yes 로 옮겨 둔 창 → 아니요를 고르면 ↑ 다음 Enter
  await sleep(3500);   // 창이 사라진 것을 연결부가 알 때까지
  const q2 = await run(1);
  ok(Boolean(q2) && q2.id !== q1?.id, "다시 뜬 창도 카드로");
  cmd({ cmd: "question-answer", id: q2?.id, answers: ["아니요 (No)"] });
  ok(await waitFor(() => existsSync(PICKED) && readFileSync(PICKED, "utf8"), 5000) === "No", "아니요를 고르자 맥 창에서 No 가 골라짐");

  // 3) 카드의 '취소'는 카드만 닫고 맥 창은 그대로(키를 누르지 않음)
  await sleep(3500);
  const q3 = await run(0);
  cmd({ cmd: "question-answer", id: q3?.id, answers: [], cancel: true });
  await sleep(2000);
  ok(!existsSync(PICKED) && /❯ No/.test(tm("capture-pane", "-p", "-t", pane) ?? ""), "카드 취소는 맥 창을 건드리지 않음");
  tm("send-keys", "-t", pane, "Escape");

  // 4) 칸이 보기 모드로 덮여 있어도(다른 탭이 맡긴 tmux run-shell 의 실패 글이 뜬 경우, 11-25 쓰던 탭) 폰에서 고른 키가 맥 창에 닿고
  //    보기 모드는 닫힌다. 전에는 키가 보기 모드에 먹혀 맥 창은 그대로인 채 카드만 사라졌다
  await sleep(3500);
  const q4 = await run(0);
  tm("run-shell", "-t", pane, "echo 다른 탭의 명령 실패 글; exit 1");
  ok(tm("display", "-p", "-t", pane, "#{pane_in_mode}") === "1", "칸이 보기 모드로 덮임(시험 준비)");
  cmd({ cmd: "question-answer", id: q4?.id, answers: ["예 (Yes)"] });
  ok(await waitFor(() => existsSync(PICKED) && readFileSync(PICKED, "utf8"), 5000) === "Yes", "보기 모드로 덮여 있어도 예를 고르자 맥 창에서 Yes 가 골라짐");
  ok(tm("display", "-p", "-t", pane, "#{pane_in_mode}") === "0", "보기 모드는 닫힘");
} finally {
  c.destroy();
  feed.kill();
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
