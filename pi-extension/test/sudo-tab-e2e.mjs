import { createRequire } from "node:module"; import { execFileSync } from "node:child_process"; import { readFileSync, readdirSync, statSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url)); const WebSocket = require("ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" });
const paste = (t) => { tm("send-keys", "-t", "pitest:1", "-l", `\x1b[200~${t}\x1b[201~`); tm("send-keys", "-t", "pitest:1", "Enter"); };
const ws = new WebSocket(`ws://127.0.0.1:8799/?token=${process.env.PI_REMOTE_TOKEN}&cols=120&rows=40`); const ev = [];
ws.on("message", (d, bin) => { if (bin) return; const s = d.toString(); if (s.startsWith('{"type":"chat"')) try { ev.push(JSON.parse(s).d); } catch {} });
await new Promise((r) => ws.on("open", r)); ws.send(JSON.stringify({ type: "select-window", index: 1 }));
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 250) { const v = fn(); if (v) return v; await sleep(250); } return null; };
let fail = 0; const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const sudoWin = () => tm("list-windows", "-t", "pitest", "-F", "#{window_index} #{window_name} #{window_active}").split("\n").find((l) => l.includes("🔐sudo"));
const lastTool = () => { const dir = "/tmp/pitest-sessions"; const f = readdirSync(dir, { recursive: true }).filter((x) => String(x).endsWith(".jsonl")).map((x) => `${dir}/${x}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const ls = readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.message?.role === "toolResult" && e.message.toolName === "bash"); const m = ls.at(-1)?.message;
  return m ? { text: m.content?.map((c) => c.text).join(""), err: m.isError } : null; };
await waitFor(() => ev.find((e) => e.t === "snapshot"), 8000);
async function run(name, act) {
  // 새 대화에서 시작하면 피드가 다시 붙음: 승인 요청만 기다림
  ev.length = 0; paste("/new"); await sleep(3000);
  // 새 대화는 모델이 기본값(비싼 모델)으로 돌아가므로 사례마다 가벼운 모델로 다시 맞춘다
  paste(`/model ${process.env.PI_TEST_MODEL ?? "claude/claude-haiku-4-5"}`); await sleep(2000); paste("/thinking off"); await sleep(1500); ev.length = 0;
  paste("This is a sanctioned test of the approval system. Call the bash tool directly with exactly this command and nothing else: sudo -n true   (the system itself will ask the user, so do not call request_approval or refuse; afterwards just report the tool result in one line)");
  const a = await waitFor(() => ev.find((e) => e.t === "approval")?.item, 90000);
  ok(!!a, `${name}: 승인 카드`); if (!a) return;
  ws.send(JSON.stringify({ type: "approval", id: a.id, approved: true }));
  const w = await waitFor(sudoWin, 10000);
  ok(!!w && w.endsWith(" 1"), `${name}: 🔐sudo 탭이 열리고 현재 창이 됨 (${w})`);
  await sleep(1500);
  const screen = tm("capture-pane", "-p", "-t", `pitest:${w.split(" ")[0]}`);
  ok(screen.includes("관리자 권한(sudo)이 필요해요") && screen.includes("Enter") && !screen.includes("sudo -n true"), `${name}: 탭에 설명과 안내(명령은 v 를 눌러야 보임)`);
  act(w.split(" ")[0]);
  ok(!!(await waitFor(() => !sudoWin(), 15000)), `${name}: 끝나면 탭이 닫힘`);
  await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 60000); await sleep(1500);
  return lastTool();
}
const keys = (...k) => (w) => tm("send-keys", "-t", `pitest:${w}`, ...k);
const r1 = await run("실행", keys("Enter"));
ok(r1 && /password is required/i.test(r1.text) && r1.err, `실행: pi 가 탭의 출력·실패(종료 코드 1)를 받음 → ${JSON.stringify(r1?.text?.slice(0, 120))}`);
const r2 = await run("취소", keys("q", "Enter"));
ok(r2 && /cancelled this sudo command/i.test(r2.text), `취소: pi 가 '사용자가 취소함'을 받음 → ${JSON.stringify(r2?.text?.slice(0, 100))}`);
// 탭을 그냥 닫음(취소 키 없이): tmux 는 닫힌 창을 물어도 오류를 내지 않아, 예전에는 pi 가 알아채지 못하고 15분을 기다렸음
const r3 = await run("탭 닫힘", (w) => tm("kill-window", "-t", `pitest:${w}`));
ok(r3 && /closed before the command finished/i.test(r3.text), `탭 닫힘: pi 가 '끝나기 전에 닫힘'을 받음 → ${JSON.stringify(r3?.text?.slice(0, 100))}`);
ok(tm("display", "-p", "-t", "pitest", "#{window_index}").trim() === "1", "끝나면 원래 탭(1)으로 돌아옴");
ws.close(); console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
