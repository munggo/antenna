// 관리자 권한(sudo) 새 탭 실행기(sudo-run.mjs) 시험.
// 시험 tmux 세션에서 실행기를 직접 돌려, 탭이 열리고(현재 창이 됨) 실행·취소·탭 닫힘·시간 초과·중단이 각각 맞는 결과를 내는지 본다.
// 진짜 비밀번호는 쓰지 않는다: 'sudo -n true' 는 비밀번호 없이는 실패하므로, 탭에서 Enter 를 누르면 그 실패(종료 코드 1)가 돌아와야 한다.
// 준비: 시험 tmux 세션(창 0 은 셸). 시험 브리지가 그 세션을 보고 있으면 알림 기록도 확인한다(PI_REMOTE_BRIDGE_LOG).
// 쓰기: node sudo-run-e2e.mjs [세션=pitest]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION = process.argv[2] ?? "pitest";
if (SESSION === "antenna") { console.error("쓰는 세션(antenna)에서는 돌리지 않아요. 시험 세션 이름을 주세요"); process.exit(2); }
const RUN = join(dirname(fileURLToPath(import.meta.url)), "../sudo-run.mjs");
const LOG = process.env.PI_REMOTE_BRIDGE_LOG ?? "/tmp/q-bridge.log";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { const v = fn(); if (v) return v; await sleep(200); } return null; };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const pane0 = tm("display", "-p", "-t", `${SESSION}:0`, "#{pane_id}");
const home = tm("display", "-p", "-t", SESSION, "#{window_index}");   // 시작할 때 보고 있던 창
const TMP = mkdtempSync(join(tmpdir(), "sudo-run-e2e-"));              // 실행기가 만드는 임시 폴더를 여기에 가둠
const sudoWin = () => tm("list-windows", "-t", SESSION, "-F", "#{window_index} #{window_name} #{window_active}").split("\n").find((l) => l.includes("🔐sudo"));
const leftovers = () => readdirSync(TMP).filter((f) => f.startsWith("claude-sudo-"));
const notifyCount = () => (existsSync(LOG) ? (readFileSync(LOG, "utf8").match(/알림\(시험·안 보냄\) prompt/g) ?? []).length : -1);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

/** 실행기를 띄우고, 탭이 열리면 act(창 번호)를 한 뒤 끝날 때까지 기다림 */
async function run(job, act, env = {}, arg) {
  const before = new Set(leftovers());
  const p = spawn(process.execPath, [RUN, ...(arg === undefined ? [b64(job)] : arg === null ? [] : [arg])], { env: { ...process.env, TMUX_PANE: pane0, TMPDIR: TMP, ...env }, cwd: TMP });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (err += d));
  const done = new Promise((r) => p.on("close", (code, sig) => r({ code, sig })));
  const w = await waitFor(sudoWin, 6000);
  let screen = "";
  if (w) {
    await sleep(1200);
    screen = tm("capture-pane", "-p", "-t", `${SESSION}:${w.split(" ")[0]}`);
    if (act) await act(w.split(" ")[0], p);
  }
  // 30초 안에 끝나지 않으면 실행기를 강제로 끝냄(뒤에 남아 다른 사례를 흐리지 않게)
  const r = await Promise.race([done, sleep(30000).then(() => { p.kill("SIGKILL"); return { code: "시간 초과(시험)" }; })]);
  await sleep(300);
  return { ...r, out, err, opened: w, screen, closed: await waitFor(() => !sudoWin(), 8000), left: leftovers().filter((f) => !before.has(f)) };
}
const key = (...k) => (w) => tm("send-keys", "-t", `${SESSION}:${w}`, ...k);

const n0 = notifyCount();
// 1. 실행: Enter → 탭이 명령을 돌리고, 출력과 종료 코드가 돌아옴
let r = await run({ cmd: "sudo -n true", explain: "시험: 관리자 권한으로 아무 일도 하지 않는 명령을 실행해요" }, key("Enter"));
ok(!!r.opened && r.opened.endsWith(" 1"), `실행: 🔐sudo 탭이 열리고 현재 창이 됨 (${r.opened})`);
ok(r.screen.includes("시험: 관리자 권한으로") && r.screen.includes("Enter") && !r.screen.includes("sudo -n true"), "실행: 탭에는 설명과 안내만 보이고 명령은 보이지 않음");
ok(r.code === 1 && /password is required/i.test(r.out), `실행: 탭의 출력과 종료 코드 1 이 돌아옴 → ${JSON.stringify(r.out.trim().slice(0, 80))}`);
ok(r.closed && r.left.length === 0, "실행: 탭이 닫히고 임시 폴더가 남지 않음");
const n1 = notifyCount();
if (n0 >= 0) ok(n1 === n0 + 1, `실행: 폰 알림 1번(브리지 기록 ${n0} → ${n1})`);
else console.log("건너뜀: 브리지 기록이 없어 알림은 확인하지 않음");
ok(tm("display", "-p", "-t", SESSION, "#{window_index}") === home, `실행: 끝나면 원래 보던 창(${home})으로 돌아옴`);

// 2. 성공·종료 코드 전달, 설명이 없을 때의 기본 문구
r = await run({ cmd: "echo 첫째 줄; echo 둘째 줄 >&2; exit 7" }, key("Enter"));
ok(r.code === 7 && r.out.includes("첫째 줄") && r.out.includes("둘째 줄"), `종료 코드와 출력(표준 오류 포함)을 그대로 전달 → 코드 ${r.code}`);
ok(r.screen.includes("Claude Code가 관리자 권한으로"), "설명이 없으면 기본 문구");
r = await run({ cmd: "printf 'ok\\n'" }, key("Enter"));
ok(r.code === 0 && r.out === "ok\n", "성공하면 종료 코드 0");

// 3. 명령 보기(v) 뒤 실행
r = await run({ cmd: "echo 보였나", explain: "시험" }, async (w) => { key("v", "Enter")(w); await sleep(800); const s = tm("capture-pane", "-p", "-t", `${SESSION}:${w}`); ok(s.includes("echo 보였나"), "v 를 누르면 명령이 보임"); key("Enter")(w); });
ok(r.code === 0 && r.out.includes("보였나"), "명령을 본 뒤 Enter 로 실행");

// 3-1. 확인 단계에서 누른 글자는 화면에 보이지 않는다(여기에 비밀번호를 미리 쳐도 드러나지 않게). 그 글은 버리고 실행으로 넘어감
r = await run({ cmd: "echo 실행됨", explain: "시험" }, async (w) => {
  key("-l", "hunter2-NotShown")(w);
  await sleep(600);
  const s = tm("capture-pane", "-p", "-t", `${SESSION}:${w}`);
  ok(!s.includes("hunter2") && !s.includes("NotShown"), "확인 단계에서 친 글자가 화면에 보이지 않음");
  ok(s.includes("누른 글자는 화면에 보이지 않아요") && s.includes("실행을 시작한 뒤에 물어요"), "비밀번호를 언제 넣는지 안내가 보임");
  key("Enter")(w);
});
ok(r.code === 0 && r.out.includes("실행됨") && !r.out.includes("hunter2"), "미리 친 글은 버리고 실행(출력에도 남지 않음)");

// 3-2. 터미널 입력을 기다리는 명령도 멈추지 않는다(입력 없이 돌려, 끝나면 탭이 닫힘). 예전에는 여기서 멈춰 탭이 닫히지 않았음
r = await run({ cmd: "cat; echo 입력없이끝남" }, key("Enter"));
ok(r.code === 0 && r.out.includes("입력없이끝남") && r.closed, `입력을 기다리는 명령도 멈추지 않고 끝나 탭이 닫힘 (코드 ${r.code})`);

// 3-3. 미리 눌러 둔 글자가 뒤따르는 비밀번호 칸(터미널을 직접 여는 입력)으로 흘러 들어가지 않는다
r = await run({ cmd: "IFS= read -r -t 2 x < /dev/tty; echo \"받음[$x]\"" }, key("-l", "abc\nzzz-leftover\n"));
ok(r.out.includes("받음[]") && !r.out.includes("leftover"), `미리 눌러 둔 글자는 비워짐 → ${JSON.stringify(r.out.trim().slice(-30))}`);

// 3-3-1. 실행하는 동안 누른 글자도 화면에 보이지 않는다(비밀번호를 묻는 때가 아닐 때 쳐도 드러나지 않게)
r = await run({ cmd: "sleep 3; echo 실행끝" }, async (w) => {
  key("Enter")(w);
  await sleep(1000);
  key("-l", "typed-While-Running")(w);
  await sleep(700);
  const s = tm("capture-pane", "-p", "-t", `${SESSION}:${w}`);
  ok(!s.includes("typed-While") && s.includes("실행 중이에요"), "실행 중에 친 글자가 화면에 보이지 않음");
});
ok(r.code === 0 && r.out.includes("실행끝") && !r.out.includes("typed-While"), "실행 중에 친 글자는 명령에도 출력에도 들어가지 않음");

// 3-3-2. 단계 표시(창 옵션 @sudo_stage): 확인 단계 confirm → 실행하면 running. 브리지가 탭 목록에 실어 보내 폰 앱이 단계에 맞는 화면을 보여 줌
r = await run({ cmd: "sleep 3; echo 단계끝" }, async (w) => {
  const stage = () => { try { return tm("show-options", "-w", "-v", "-t", `${SESSION}:${w}`, "@sudo_stage"); } catch { return "(없음)"; } };
  ok(stage() === "confirm", `단계: 창이 열리면 confirm → ${stage()}`);
  key("v", "Enter")(w);
  await sleep(600);
  ok(stage() === "confirm", `단계: 명령을 봐도 confirm 그대로 → ${stage()}`);
  key("Enter")(w);
  await sleep(1200);
  ok(stage() === "running", `단계: 실행하면 running → ${stage()}`);
});
ok(r.code === 0 && r.out.includes("단계끝"), "단계를 적어도 실행 결과는 그대로");

// 3-4. 실행 중 Ctrl+C: 멈추고 취소로 알림, 탭이 닫힘
r = await run({ cmd: "sleep 25; echo 끝까지감" }, async (w) => { key("Enter")(w); await sleep(1500); key("C-c")(w); });
ok(r.code === 1 && /cancelled this sudo command/i.test(r.err) && r.closed && r.left.length === 0, `실행 중 Ctrl+C: 멈추고 취소로 알림, 탭 닫힘 → ${JSON.stringify(r.err.trim().slice(0, 50))}`);

// 4. 취소
r = await run({ cmd: "sudo -n true" }, key("q", "Enter"));
ok(r.code === 1 && /cancelled this sudo command/i.test(r.err) && r.out === "", `취소: 사용자가 취소했다고 알림 → ${JSON.stringify(r.err.trim().slice(0, 60))}`);
ok(r.closed && r.left.length === 0, "취소: 탭이 닫히고 임시 폴더가 남지 않음");

// 5. 탭을 그냥 닫음
r = await run({ cmd: "sudo -n true" }, (w) => tm("kill-window", "-t", `${SESSION}:${w}`));
ok(r.code === 1 && /closed before the command finished/i.test(r.err), "탭 닫힘: 끝나기 전에 닫혔다고 알림");
ok(r.left.length === 0, "탭 닫힘: 임시 폴더가 남지 않음");

// 6. 아무도 실행하지 않음(기다리는 시간을 3초로 줄임)
r = await run({ cmd: "sudo -n true" }, null, { PI_REMOTE_SUDO_WAIT_MS: "3000" });
ok(r.code === 1 && /Nobody ran the sudo command/i.test(r.err), `시간 초과: 아무도 실행하지 않았다고 알림 → ${JSON.stringify(r.err.trim().slice(0, 70))}`);
ok(r.closed && r.left.length === 0, "시간 초과: 탭을 닫고 임시 폴더를 지움");

// 7. 작업을 멈춤(실행기를 끝냄) → 탭도 닫힘
r = await run({ cmd: "sudo -n true" }, (w, p) => p.kill("SIGTERM"));
ok(r.code === 130 && r.closed && r.left.length === 0, `중단: 실행기를 끝내면 탭이 닫히고 임시 폴더가 남지 않음 (코드 ${r.code})`);

// 8. 탭을 열 수 없는 곳·잘못된 인자
r = await run({ cmd: "sudo -n true" }, null, { TMUX_PANE: "" });
ok(r.code === 1 && !r.opened && /no terminal tab can be opened/i.test(r.err), "tmux 밖: 탭을 열 수 없다고 알림(탭 안 열림)");
r = await run(null, null, {}, null);
ok(r.code === 1 && !r.opened && /no command/i.test(r.err), "인자 없음: 명령이 없다고 알림");
r = await run(null, null, {}, "깨진-인자!!");
ok(r.code === 1 && !r.opened && /no command/i.test(r.err), "깨진 인자: 명령이 없다고 알림");
// 없는 칸 번호: tmux 는 없는 칸을 물어도 오류를 내지 않고, 빈 세션으로 창을 열면 엉뚱한 세션에 열린다(11-13 시험 중 쓰는 세션에 열렸음).
// 그래서 이 사례는 따로 띄운 tmux 서버에서만 돌린다: 어느 세션에도 창이 생기지 않아야 함
{
  const L = `sudo-run-e2e-${process.pid}`;
  const iso = (...a) => execFileSync("tmux", ["-L", L, ...a], { encoding: "utf8" }).trim();
  iso("new-session", "-d", "-s", "iso", "-x", "80", "-y", "24");
  try {
    const env = { TMUX: `${iso("display", "-p", "-t", "iso:0", "#{socket_path}")},${iso("display", "-p", "#{pid}")},${iso("display", "-p", "-t", "iso:0", "#{session_id}").replace("$", "")}`, TMUX_PANE: "%99999" };
    const count = () => iso("list-windows", "-a").split("\n").length;
    const n = count();
    r = await run({ cmd: "sudo -n true" }, null, env);
    ok(r.code === 1 && /Could not open a terminal tab/i.test(r.err) && r.left.length === 0, `없는 칸: 탭을 열지 못했다고 알리고 임시 폴더를 지움 → ${JSON.stringify(r.err.trim().slice(0, 90))}`);
    ok(count() === n && !r.opened, "없는 칸: 어느 세션에도 창이 생기지 않음");
  } finally {
    iso("kill-server");
  }
}

ok(tm("display", "-p", "-t", SESSION, "#{window_index}") === home, `모두 끝난 뒤 원래 보던 창(${home})`);
ok(!sudoWin(), "남은 🔐sudo 탭 없음");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
