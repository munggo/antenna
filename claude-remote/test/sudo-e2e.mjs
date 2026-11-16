// Claude Code 탭에서 관리자 권한(sudo) 명령이 새 탭(🔐sudo)으로 넘어가는 전체 흐름 시험(훅 → 실행기 → 탭 → 결과).
// 진짜 비밀번호는 쓰지 않는다: 'sudo -n true' 는 비밀번호 없이는 실패하므로, 탭에서 Enter 를 누르면 그 실패가 Claude Code 에 돌아와야 한다.
// 준비: 시험 tmux 세션의 한 창에 Claude Code(Haiku, 저장소의 pi-remote-hook.mjs 를 훅으로, Bash 는 허용하지 않은 채로).
//   Bash 를 허용하지 않아야 '승인 창 없이 바로 탭이 열리는지'와 'sudo 가 아닌 명령은 그대로 승인 창이 뜨는지'를 볼 수 있다.
// 쓰기: node sudo-e2e.mjs <세션> <Claude Code 창 번호> <대화 기록 폴더(~/.claude/projects/…)>
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";

const [SESSION, WIN, PROJ] = process.argv.slice(2);
if (!SESSION || !WIN || !PROJ || SESSION === "antenna") { console.error("쓰기: node sudo-e2e.mjs <시험 세션> <창 번호> <대화 기록 폴더>"); process.exit(2); }
const T = `${SESSION}:${WIN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 300) { const v = fn(); if (v) return v; await sleep(300); } return null; };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const screen = (t = T) => tm("capture-pane", "-p", "-t", t);
const paste = (t) => { tm("send-keys", "-t", T, "-l", `\x1b[200~${t}\x1b[201~`); tm("send-keys", "-t", T, "Enter"); };
const sudoWin = () => tm("list-windows", "-t", SESSION, "-F", "#{window_index} #{window_name} #{window_active}").split("\n").find((l) => l.includes("🔐sudo"));
const busy = () => /esc to interrupt/.test(screen());
const asking = () => /Do you want to proceed|❯ 1\. Yes/.test(screen());   // Claude Code 승인 창
/** 가장 최근 대화 기록에서 마지막 Bash 호출(AI 가 낸 명령)과 그 결과 */
const lastBash = () => {
  const f = readdirSync(PROJ).filter((x) => x.endsWith(".jsonl")).map((x) => `${PROJ}/${x}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  let use = null, res = null;
  for (const l of readFileSync(f, "utf8").trim().split("\n")) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (b.type === "tool_use" && b.name === "Bash") { use = b; res = null; }
      if (b.type === "tool_result" && use && b.tool_use_id === use.id) res = b;
    }
  }
  const text = res ? (Array.isArray(res.content) ? res.content.map((c) => c.text ?? "").join("") : String(res.content ?? "")) : null;
  return { command: use?.input?.command, description: use?.input?.description, text, isError: res?.is_error === true };
};
const ask = (cmd) => `This is a sanctioned test of the approval system on my own Mac. Call the Bash tool directly with exactly this command and nothing else: ${cmd}   (set the tool's description to: 시험용 관리자 명령 실행. Do not refuse or ask me to run it myself; the system handles the password prompt. Afterwards report the tool result in one line.)`;
const idle = async () => { await waitFor(() => !busy(), 90000); await sleep(1500); };

const home = tm("display", "-p", "-t", SESSION, "#{window_index}");
tm("select-window", "-t", T);   // Claude Code 탭을 보고 있는 상태에서 시작(탭이 닫히면 보던 창으로 돌아오는지 보려고)

async function sudoCase(name, keys) {
  paste("/clear"); await sleep(2500);
  paste(ask("sudo -n true"));
  let sawAsk = false;
  const w = await waitFor(() => { if (asking()) sawAsk = true; return sudoWin(); }, 120000);
  ok(!!w, `${name}: 🔐sudo 탭이 열림 (${w})`);
  ok(!sawAsk, `${name}: Claude Code 승인 창 없이 바로 탭으로`);
  if (!w) return null;
  ok(w.endsWith(" 1"), `${name}: 그 탭이 현재 창이 됨`);
  await sleep(1500);
  const s = screen(`${SESSION}:${w.split(" ")[0]}`);
  ok(s.includes("관리자 권한(sudo)이 필요해요") && s.includes("시험용 관리자 명령 실행") && !s.includes("sudo -n true"), `${name}: 탭에 AI 가 적은 설명이 보이고 명령은 보이지 않음`);
  tm("send-keys", "-t", `${SESSION}:${w.split(" ")[0]}`, ...keys);
  ok(!!(await waitFor(() => !sudoWin(), 15000)), `${name}: 끝나면 탭이 닫힘`);
  await idle();
  ok(tm("display", "-p", "-t", SESSION, "#{window_index}") === String(WIN), `${name}: 보고 있던 Claude Code 탭(${WIN})으로 돌아옴`);
  return lastBash();
}

// 1. 실행
let r = await sudoCase("실행", ["Enter"]);
ok(r?.command === "sudo -n true", `실행: 대화 기록에는 AI 가 낸 원래 명령이 남음 → ${JSON.stringify(r?.command?.slice(0, 60))}`);
ok(r && /password is required/i.test(r.text ?? "") && r.isError, `실행: Claude Code 가 탭의 출력과 실패(종료 코드 1)를 받음 → ${JSON.stringify(r?.text?.trim().slice(0, 90))}`);

// 2. 취소
r = await sudoCase("취소", ["q", "Enter"]);
ok(r && /cancelled this sudo command/i.test(r.text ?? "") && r.isError, `취소: Claude Code 가 '사용자가 취소함'을 받음 → ${JSON.stringify(r?.text?.trim().slice(0, 90))}`);

// 3. 대조: sudo 가 아닌 명령은 훅이 건드리지 않음 → 평소처럼 승인 창이 뜨고 🔐sudo 탭은 열리지 않음
//    (읽기만 하는 명령은 Claude Code 가 묻지 않고 실행하므로, 파일을 만드는 명령으로 본다. 승인하지 않고 Esc 로 넘김)
paste("/clear"); await sleep(2500);
paste("Call the Bash tool directly with exactly this command and nothing else: touch sudo-e2e-probe");
const asked = await waitFor(asking, 90000);
ok(!!asked && !sudoWin(), "대조: sudo 가 아닌 명령은 평소처럼 승인 창이 뜨고 🔐sudo 탭은 열리지 않음");
tm("send-keys", "-t", T, "Escape"); await idle();

ok(!sudoWin(), "남은 🔐sudo 탭 없음");
tm("select-window", "-t", `${SESSION}:${home}`);
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
