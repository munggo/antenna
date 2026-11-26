// Claude Code 계정 전환 실제 시험: 시험 tmux 세션(pitest)의 셸에서 Claude Code(Haiku)를 켜고, 시험용 사용량 파일을 바꿔 가며 확인.
// 95%를 넘으면 저절로 바꾸지 않고, 일하는 탭을 멈춘 뒤 폰 카드로 묻는다(사용자 결정 11-24). 카드에서 바꾸기를 고르면
// 전환 순서(사용자 결정 11-18): 인수인계 문서 → /clear → /exit → 다른 계정으로 새 대화 → 문서를 읽고 이어 감. 두 계정을 조금씩 씀.
// 토큰은 값을 읽지 않고 '있음/없음'만 봄. 실행: node claude-remote/test/claude-switch-e2e.mjs (포트 8799, 세션 pitest 를 만들고 끝나면 지움)
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = require("ws");

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { procAccount } = await import(`${REPO}/claude-remote/claude-account.mjs`);   // 프로세스 환경 → 계정(연결부와 같은 판단)
const S = "pitest", PORT = 8799, TOKEN = "cc-switch-token", DIR = "/tmp/cctest", ACCT = "/tmp/cctest-acct.json", HOOKS = "/tmp/cctest-hooks.json";
const BOUT = "/tmp/cctest-bridge.out";   // 시험 브리지 출력(폰 알림은 보내지 않고 여기에 적힘)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }); } catch { return ""; } };
const scr = (w) => tm("capture-pane", "-p", "-t", `${S}:${w}`);
const tail = (w, n) => scr(w).split("\n").filter((l) => l.trim()).slice(-n).join("\n");   // 빈 줄 빼고 아래쪽 n 줄
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 500) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return null; };
const fut = Math.floor(Date.now() / 1000) + 86400;
const setPersonal = (util) => writeFileSync(ACCT, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));

// 이 창의 Claude Code 프로세스: 계정(회사 토큰 환경 변수 있음/없음), 켤 때 명령, 대화 번호
const proc = (w) => {
  const shell = tm("display", "-p", "-t", `${S}:${w}`, "#{pane_pid}").trim();
  let pids = [];
  try { pids = execFileSync("pgrep", ["-P", shell], { encoding: "utf8" }).split("\n").filter(Boolean); } catch {}
  for (const pid of [shell, ...pids]) {
    const f = `${process.env.HOME}/.claude/sessions/${pid}.json`;
    if (!existsSync(f)) continue;
    // 보는 사이에 Claude Code 가 꺼지면 세션 파일·프로세스가 사라짐(계정을 바꾸려고 끄는 중) → 다음 후보
    try {
      const sid = JSON.parse(readFileSync(f, "utf8")).sessionId;
      const env = execFileSync("ps", ["eww", "-o", "command=", "-p", pid], { encoding: "utf8" });
      // work: 개인(기본 로그인)이 아닌 계정으로 돎. 개인 폴더에서 바꿔 가는 곳은 추가 개인(11-25), 13번은 앱에서 고른 회사
      const account = procAccount(env);
      return { pid, account, work: account !== "personal", args: execFileSync("ps", ["-ww", "-o", "args=", "-p", pid], { encoding: "utf8" }).trim(), sid };
    } catch {
      continue;
    }
  }
  return null;
};
const dump = (w, n = 14) => console.log(scr(w).split("\n").filter((l) => l.trim() && !/sk-ant/.test(l)).slice(-n).map((l) => "     | " + l.slice(0, 110)).join("\n"));
const modeLine = (w) => (scr(w).match(/(⏸|⏵⏵) [a-z ]+ on/g) ?? []).pop() ?? "";
const paste = (w, t) => { tm("send-keys", "-t", `${S}:${w}`, "-l", t); tm("send-keys", "-t", `${S}:${w}`, "Enter"); };
// Claude Code 입력창에 보내기: 글 → 잠깐 → Enter, 입력창에 글이 남아 있으면 Enter 다시(막 켜졌을 때 Enter 가 먹지 않는 경우)
const ask = async (w, t) => {
  tm("send-keys", "-t", `${S}:${w}`, "-l", t);
  await sleep(600);
  const head = t.slice(0, 30);
  for (let k = 0; k < 4; k++) {
    tm("send-keys", "-t", `${S}:${w}`, "Enter");
    await sleep(1500);
    const input = scr(w).split("\n").filter((l) => l.trim()).slice(-6).join("\n");
    if (!input.includes(head) || /esc to interrupt/i.test(scr(w))) return;
  }
};
// 대화 기록 파일의 줄들(대화 번호로 찾음)과 줄의 글
const rows = (sid) => {
  const dir = `${process.env.HOME}/.claude/projects`;
  for (const d of execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    const f = `${dir}/${d}/${sid}.jsonl`;
    if (existsSync(f)) return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  }
  return [];
};
const text = (r) => { const c = r?.message?.content; return typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text ?? "").join(" ") : ""; };
// 대화 기록 파일에서: 그 질문 뒤에 온 답에 word 가 있는지(화면 글보다 정확)
const answeredAfter = (sid, question, word) => {
  const rs = rows(sid);
  const qi = rs.findIndex((r) => r.type === "user" && text(r).includes(question));
  return qi >= 0 && rs.slice(qi + 1).some((r) => r.type === "assistant" && new RegExp(word, "i").test(text(r)));
};
// 일을 마치고 쉬는 화면이 될 때까지(다시 켠 세션은 이어 가기 글을 받아 한동안 일함)
const settle = (w) => waitFor(() => !/esc to interrupt/i.test(scr(w)) && /(⏸|⏵⏵) [a-z ]+ on/.test(scr(w)), 120000, 1000);
const HANDOFF_DIR = `${DIR}/.work/handoff`;
const handoffs = () => (existsSync(HANDOFF_DIR) ? execFileSync("ls", [HANDOFF_DIR], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".md")).map((f) => `${HANDOFF_DIR}/${f}`) : []);
const paneLog = (w) => `${process.env.HOME}/.cache/pi-remote/feed/${tm("display", "-p", "-t", `${S}:${w}`, "#{pane_id}").trim().replace(/\W/g, "")}.hooks.log`;
const trust = async (w) => {
  for (let i = 0; i < 40; i++) {
    const s = scr(w);
    if (/Yes, I trust this folder/.test(s)) { tm("send-keys", "-t", `${S}:${w}`, "Down"); await sleep(300); tm("send-keys", "-t", `${S}:${w}`, "Enter"); }
    if (/(⏸|⏵⏵) [a-z ]+ on/.test(s)) return true;
    await sleep(500);
  }
  return false;
};

// ── 준비: 시험 폴더, 이 실행에만 쓰는 훅, 시험 브리지, 셸 탭 ──
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
try { execFileSync("sh", ["-c", `lsof -ti tcp:${PORT} | xargs kill 2>/dev/null`]); } catch {}
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const NODE = process.execPath;
const H = { matcher: "", hooks: [{ type: "command", command: `"${NODE}" "${REPO}/claude-remote/pi-remote-hook.mjs"`, timeout: 5 }] };
writeFileSync(HOOKS, JSON.stringify({ hooks: Object.fromEntries(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"].map((k) => [k, [H]])) }));
setPersonal(0.5);
const bout = openSync(BOUT, "w");
const bridge = spawn(NODE, ["bridge.mjs"], {
  cwd: `${REPO}/server`,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PI_REMOTE_TOKEN: TOKEN, PORT: String(PORT), PI_TMUX_SESSION: S,
    PI_REMOTE_SESSION_DIR: "/tmp/pitest-sessions", PI_REMOTE_PUSH_FILE: "/tmp/pitest-push.json", PI_REMOTE_PUSH_DRYRUN: "1" },
  stdio: ["ignore", bout, bout],
});
tm("new-session", "-d", "-s", S, "-x", "160", "-y", "45", "-c", DIR);
// 1번: 셸(실제 탭처럼). 시험 값은 창을 만들 때 환경 변수로(셸이 막 켜졌을 때 친 첫 글자는 사라질 수 있음)
const ENVS = ["-e", `PI_ACCOUNTS_CACHE=${ACCT}`, "-e", "PI_REMOTE_ACCOUNT_TICK_SEC=3", "-e", "PI_REMOTE_SWITCH_IDLE_SEC=5"];
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
const FLAGS = `--model haiku --permission-mode manual --setting-sources project,local --settings ${HOOKS}`;
tm("send-keys", "-t", `${S}:1`, "C-u"); await sleep(300);
paste(1, `claude ${FLAGS}`);
ok(await trust(1), "셸에서 claude 켬");
let p = proc(1);
ok(p && !p.work, `1) 개인 50% → 개인 계정으로 켜짐(회사 토큰 ${p?.work ? "있음" : "없음"})`);
const sid0 = p?.sid;

// 폰처럼 시험 브리지에 붙어 안내 문구를 받음
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=120&rows=40`);
const ev = [];
ws.on("message", (d, bin) => { if (!bin) try { const m = JSON.parse(d.toString()); if (m.type === "chat") ev.push(m.d); } catch {} });
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "select-window", index: 1 }));
await waitFor(() => ev.find((e) => e.t === "snapshot"), 15000);
const since = () => { const n = ev.length; return () => ev.slice(n); };
// 95%를 넘어 묻는 계정 카드(번호 cc-a-…)와 답. 카드는 일하는 탭에만 열린다
const accountCards = (list) => list.filter((e) => e.t === "question" && /^cc-a-/.test(e.question?.id ?? "")).map((e) => e.question);
const waitCard = (list, ms = 60000) => waitFor(() => accountCards(list()).at(-1), ms);
const pick = (q, i) => ws.send(JSON.stringify({ type: "question-answer", id: q.id, answers: [q.options[i].label], other: "" }));
// 한 번만 보냄(멈추면 글이 입력창에 되돌아오는데, ask 는 입력창에 글이 남으면 Enter 를 다시 눌러 그 글을 또 보내 버림)
const sendOnce = async (w, t) => { tm("send-keys", "-t", `${S}:${w}`, "-l", t); await sleep(600); tm("send-keys", "-t", `${S}:${w}`, "Enter"); };
const STORY = (name) => `Write a 400-word short story about a cat named ${name}. Do not use any tools.`;
// 입력창 판정은 연결부와 같은 함수로(빈 입력창에 Claude Code 가 띄우는 추천 문구 등을 글로 잘못 보지 않게)
const { inputEmpty, inputLine } = await import(`${REPO}/claude-remote/claude-feed.mjs`);
const inputHas = (w, head) => String(inputLine(scr(w)) ?? "").startsWith(head);

await ask(1, "Reply with exactly one word: pong");
const pong = await waitFor(() => /⏺ pong/i.test(tail(1, 8)) && !/esc to interrupt/i.test(scr(1)), 60000);
if (!pong) dump(1);
ok(pong, "대화 한 번(pong)");

// 2) 개인 97%: 쉬는 탭은 묻지도 바꾸지도 않음(사용자 결정 11-24 '다음 글을 보낼 때'). 글을 보내면 멈추고 묻고, 바꾸기를 고르면
//    인수인계 문서를 받고 /clear → 끄고 → 회사 계정으로 새 대화로 켜고 → 문서를 읽고 이어 감(사용자 결정 11-18)
const ev2 = since();
setPersonal(0.97);
await sleep(15000);
ok(proc(1)?.pid === p?.pid && proc(1)?.work === false && !accountCards(ev2()).length, "2) 쉬는 탭: 97% 여도 묻지 않고 그대로(15초)");
await sendOnce(1, STORY("Nabi"));
const q2 = await waitCard(ev2);
ok(q2 && /^개인 계정 사용량이 97%예요\(전체 한도 · .+ 초기화\)\. 하던 일을 멈췄어요\./.test(q2.question) && q2.options.map((o) => o.label).join("|") === "개인 계정 그대로|추가 개인 계정으로 바꾸기",
  `2) 글을 보내자 멈추고 물음(${q2?.question?.slice(0, 50)})`);
ok(await waitFor(() => !/esc to interrupt/i.test(scr(1)), 30000) && proc(1)?.pid === p?.pid, "2) 하던 일은 멈추고, 답할 때까지 바꾸지 않음");
pick(q2, 1);
const t0 = Date.now();
ok(await waitFor(() => ev2().some((e) => e.t === "notice" && /개인 계정 사용량이 95%를 넘어 고른 대로 추가 개인 계정으로 바꾸려고 하던 일을 멈추고 인수인계 문서를 받고 있어요/.test(e.text)), 60000), "2) 바꾸기 → 폰에 안내(인수인계 문서를 받고 있어요)");
// 전환 중에 폰에서 보낸 글은 비워질 대화에 넣지 않고 안내만
ws.send(JSON.stringify({ type: "pi-send", text: "phone words during switch", mode: "auto" }));
ok(await waitFor(() => ev.some((e) => e.t === "notice" && /계정을 바꾸는 중이라 지금은 보낼 수 없어요/.test(e.text)), 10000), "2) 전환 중 폰 글은 받지 않음(안내)");
const switched = await waitFor(() => { const q = proc(1); return q && q.work && q.pid !== p.pid ? q : null; }, 180000);
ok(switched?.account === "personal2", `2) 개인 97% → 추가 개인 계정으로 다시 켜짐(${switched?.account}, ${Math.round((Date.now() - t0) / 1000)}초)`);
p = switched ?? proc(1);
ok(p && !p.args.includes("--resume"), "2) 같은 대화를 이어 켜지 않음(--resume 없음)");
ok(p && p.args.includes("--model haiku") && p.args.includes(`--settings ${HOOKS}`) && p.args.includes("--permission-mode manual"), `2) 켤 때 옵션·권한 모드 유지(${p?.args.replace(/^\S+\s/, "")})`);
ok(await waitFor(() => modeLine(1).includes("manual mode"), 20000), "2) 맥 화면 권한 모드 = 매번 묻기");
const docs = handoffs();
const doc = docs.length ? readFileSync(docs[0], "utf8") : "";
ok(docs.length === 1 && /^# 인수인계/.test(doc), `2) 인수인계 문서 저장(${docs[0] ?? "없음"})`);
if (doc) console.log(doc.split("\n").slice(0, 12).map((l) => "     | " + l.slice(0, 110)).join("\n"));
ok(/pong/i.test(doc), "2) 문서에 앞 대화(pong)가 담김");
ok(readFileSync(`${HANDOFF_DIR}/.gitignore`, "utf8") === "*\n", "2) 문서 폴더는 git 에서 뺌(.gitignore)");
const old = rows(sid0);
ok(old.some((r) => r.type === "user" && text(r).includes("[계정 전환]")) && old.some((r) => r.type === "assistant" && /^# 인수인계/m.test(text(r))), "2) 앞 세션이 인수인계 요청을 받고 문서를 답함");
ok(!old.some((r) => text(r).includes("phone words during switch")), "2) 폰 글이 앞 대화에 들어가지 않음");
const log1 = readFileSync(paneLog(1), "utf8").split("\n");
const iDoc = log1.findIndex((l) => l.includes("계정 전환 인수인계: /"));
ok(iDoc >= 0 && log1.slice(iDoc + 1).some((l) => /SessionStart .*clear/.test(l)), "2) 문서를 받은 뒤 /clear 를 거침(연결부 훅 기록)");
// 문서 경로는 연결부가 실제 경로로 적음(/tmp → /private/tmp)이라 파일 이름으로 견줌
ok(p && p.sid !== sid0 && Boolean(await waitFor(() => rows(p.sid).some((r) => r.type === "user" && text(r).includes(`/.work/handoff/${(docs[0] ?? "").split("/").pop()} 를 먼저 읽으세요`)), 30000)),
  "2) 새 대화에 이어 가기 글(문서 경로)");
ok(await waitFor(() => ev.some((e) => e.t === "notice" && /고른 대로 추가 개인 계정으로 다시 켰어요\(인수인계 문서로 이어 감\)/.test(e.text)), 10000), "2) 폰에 안내(고른 대로 회사 계정으로 다시 켰어요, 문서로 이어 감)");
ok(/^# 인수인계/.test(doc) && /Nabi/.test(doc), "2) 멈춘 요청(Nabi)도 문서에 담김");
await settle(1);
await ask(1, "According to the handoff document, what single word did you reply with in the previous session? Answer with that word only.");
const remembered = await waitFor(() => answeredAfter(p.sid, "According to the handoff document", "pong"), 60000);
if (!remembered) dump(1, 18);
ok(remembered, "2) 새 세션이 문서로 앞 대화를 앎(pong)");
await settle(1);

// 3) 다시 50% → 입력창에 글이 있으면 그대로, 지우면 개인으로 돌아옴
setPersonal(0.5);
const pidBefore = proc(1)?.pid;
tm("send-keys", "-t", `${S}:1`, "-l", "draft words");
await sleep(15000);
const kept = proc(1)?.work === true && proc(1)?.pid === pidBefore && /❯\s+draft words/.test(scr(1));
if (!kept) { console.log(`     프로세스 같음: ${proc(1)?.pid === pidBefore}, 회사: ${proc(1)?.work}`); dump(1); }
ok(kept, "3) 입력창에 쓰던 글이 있으면 다시 켜지 않음(글도 그대로)");
for (let i = 0; i < 11; i++) tm("send-keys", "-t", `${S}:1`, "BSpace");
const back = await waitFor(() => { const q = proc(1); return q && !q.work ? q : null; }, 180000);
ok(Boolean(back), "3) 글을 지우면 개인 계정으로 돌아옴");
ok(back && !back.args.includes("--resume"), "3) 돌아올 때도 같은 대화를 이어 켜지 않음");
ok(await waitFor(() => ev.some((e) => e.t === "notice" && /개인 계정으로 돌아왔어요\(인수인계 문서로 이어 감\)/.test(e.text)), 10000), "3) 폰에 안내(개인 계정으로 돌아왔어요, 문서로 이어 감)");
ok(handoffs().length === 2, `3) 인수인계 문서 하나 더(${handoffs().length}개)`);
await waitFor(() => modeLine(1).includes("manual mode"), 20000);
await settle(1);

// 4) 확인 창이 떠 있으면 묻지도 바꾸지도 않음. 거부한 뒤 물으면(멈춘 직전 일로 바로, 또는 다음 글에) 바꾸기
await ask(1, "Use the Bash tool to run exactly: touch /tmp/cctest/switch.txt");
ok(await waitFor(() => /Esc to cancel/.test(scr(1)), 60000), "4) 확인 창 뜸");
const ev4 = since();
setPersonal(0.97);
await sleep(15000);
ok(proc(1)?.work === false && /Esc to cancel/.test(scr(1)) && !accountCards(ev4()).length, "4) 확인 창이 떠 있는 동안은 묻지도 다시 켜지도 않음");
tm("send-keys", "-t", `${S}:1`, "Escape");
let q4 = await waitCard(ev4, 20000);
if (!q4) { await settle(1); await sendOnce(1, STORY("Bori")); q4 = await waitCard(ev4); }
ok(Boolean(q4), "4) 거부한 뒤 물음");
if (q4) pick(q4, 1);
ok(Boolean(await waitFor(() => { const q = proc(1); return q && q.work ? q : null; }, 180000)), "4) 바꾸기 → 회사 계정으로 다시 켬");
ok(!existsSync("/tmp/cctest/switch.txt"), "4) 거부한 명령은 실행되지 않음");

// 5) 셸 없이 바로 켠 Claude Code 는 건드리지 않음(끄면 탭이 닫히므로)
tm("new-window", "-t", S, "-c", DIR, `env PI_ACCOUNTS_CACHE=${ACCT} PI_REMOTE_ACCOUNT_TICK_SEC=3 PI_REMOTE_SWITCH_IDLE_SEC=5 claude ${FLAGS}`);
ok(await trust(2), "5) 셸 없이 켬(개인 97% 이지만 개인 로그인으로)");
const d0 = proc(2);
const ev5 = since();
ws.send(JSON.stringify({ type: "select-window", index: 2 }));
await sendOnce(2, "Reply with exactly one word: plum");
await sleep(15000);
const d1 = proc(2);
ok(d0 && d1 && d0.pid === d1.pid && !d1.work && !accountCards(ev5()).length, "5) 셸 없이 켠 탭은 그대로(같은 프로세스·개인, 바꿀 수 없으니 묻지도 않음)");

// 6) 셸 함수 claude() 를 고치기 전에 켠 셸(11-15 실제 탭: 11-11 에 켠 셸은 11-12 에 바뀐 함수를 몰라 늘 개인으로 켬).
//    다시 켤 때 그 셸 함수를 쓰면 또 개인으로 켜져 1분마다 끄고 켜기를 되풀이했다
setPersonal(0.5);
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:3`, "C-u"); await sleep(300);
paste(3, `claude() { env -u CLAUDE_CODE_OAUTH_TOKEN claude "$@"; }`);   // 예전 정의 흉내: 늘 개인
await sleep(500);
paste(3, `claude ${FLAGS}`);
ok(await trust(3), "6) 예전 셸 함수가 남은 셸에서 켬");
const o0 = proc(3);
await ask(3, "Reply with exactly one word: pong");
ok(await waitFor(() => /⏺ pong/i.test(tail(3, 8)) && !/esc to interrupt/i.test(scr(3)), 60000), "6) 대화 한 번(pong)");
const ev6 = since();
ws.send(JSON.stringify({ type: "select-window", index: 3 }));
setPersonal(0.97);
await sleep(2000);
await sendOnce(3, STORY("Duri"));
const q6 = await waitCard(ev6);
ok(Boolean(q6), "6) 글을 보내자 물음");
if (q6) pick(q6, 1);
const o1 = await waitFor(() => { const q = proc(3); return q && q.pid !== o0?.pid ? q : null; }, 180000);
if (!o1) { console.log("     안내:", JSON.stringify(ev6().filter((e) => e.t === "notice").map((e) => e.text))); dump(3, 16); }
ok(o1?.work === true, `6) 셸 함수가 예전 것이어도 회사 계정으로 다시 켬(${o1 ? (o1.work ? "추가 개인" : "개인") : "다시 켜지 않음"})`);
ok(o1 && o0 && !o1.args.includes("--resume") && o1.sid !== o0.sid, "6) 새 대화로(--resume 없음)");
ok(await waitFor(() => ev6().some((e) => e.t === "notice" && /고른 대로 추가 개인 계정으로 다시 켰어요\(인수인계 문서로 이어 감\)/.test(e.text)), 10000), "6) 폰에 안내(회사 계정으로 다시 켰어요, 문서로 이어 감)");
await settle(3);
await sleep(15000);
ok(o1 && proc(3)?.pid === o1.pid, "6) 다시 켠 뒤 그대로(끄고 켜기를 되풀이하지 않음)");

// 7) 다시 켜도 계정이 바뀌지 않으면(여기서는 PATH 앞의 claude 가 회사 토큰을 지움) 한 번만 해 보고 6시간 쉬며 폰에 알림
setPersonal(0.5);
const realClaude = execFileSync("sh", ["-c", "command -v claude"], { encoding: "utf8" }).trim();
mkdirSync(`${DIR}/bin`, { recursive: true });
writeFileSync(`${DIR}/bin/claude`, `#!/bin/sh\nunset CLAUDE_CODE_OAUTH_TOKEN\nexec "${realClaude}" "$@"\n`, { mode: 0o755 });
tm("new-window", "-t", S, "-c", DIR, ...ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:4`, "C-u"); await sleep(300);
paste(4, `export PATH="${DIR}/bin:$PATH"; hash -r`);
await sleep(500);
paste(4, `claude ${FLAGS}`);
ok(await trust(4), "7) 회사 토큰을 지우는 claude 가 PATH 앞에 있는 셸에서 켬");
const r0 = proc(4);
ok(r0 && !r0.work, "7) 개인 계정으로 켜짐");
const ev7 = since();
ws.send(JSON.stringify({ type: "select-window", index: 4 }));
setPersonal(0.97);
await sleep(2000);
await sendOnce(4, STORY("Kong"));
const q7 = await waitCard(ev7);
ok(Boolean(q7), "7) 글을 보내자 물음");
if (q7) pick(q7, 1);
const r1 = await waitFor(() => { const q = proc(4); return q && q.pid !== r0?.pid ? q : null; }, 180000);
if (!r1) { console.log("     안내:", JSON.stringify(ev7().filter((e) => e.t === "notice").map((e) => e.text))); dump(4, 16); }
ok(r1 && !r1.work, `7) 한 번 다시 켬(이번에도 ${r1 ? (r1.work ? "추가 개인" : "개인") : "다시 켜지 않음"})`);
ok(r1 && !r1.args.includes("--resume"), "7) --resume 없이 새로 켬");
ok(await waitFor(() => ev7().some((e) => e.t === "notice" && /추가 개인 계정으로 다시 켰는데 개인 계정으로 켜졌어요/.test(e.text)), 15000),
  "7) 폰에 안내(회사 계정으로 다시 켰는데 개인 계정으로 켜졌어요)");
ok(await waitFor(() => /알림\(시험·안 보냄\) error 탭 4 · Claude Code 계정 전환 실패/.test(readFileSync(BOUT, "utf8")), 10000), "7) 폰 알림(계정 전환 실패)");
await sleep(15000);
ok(r1 && proc(4)?.pid === r1.pid, "7) 다시 시도하지 않음(15초 동안 같은 프로세스)");
// 8) 답을 쓰는 중에 95%를 넘으면 바로 멈추고 묻고, 바꾸기를 고르면 인수인계(사용자 결정 11-18·11-24).
//    다른 창이 덩달아 바뀌지 않게 이 창만 따로 사용량 파일을 씀. 1초마다 보고, 쉴 때 바꾸기는 일어나지 않게(일하는 중 경로만)
const ACCT8 = "/tmp/cctest-acct8.json";
const setPersonal8 = (util) => writeFileSync(ACCT8, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));
const BUSY_ENVS = ["-e", "PI_REMOTE_ACCOUNT_TICK_SEC=1", "-e", "PI_REMOTE_SWITCH_IDLE_SEC=9999"];
setPersonal8(0.5);
tm("new-window", "-t", S, "-c", DIR, "-e", `PI_ACCOUNTS_CACHE=${ACCT8}`, ...BUSY_ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:5`, "C-u"); await sleep(300);
paste(5, `claude ${FLAGS}`);
ok(await trust(5), "8) 셸에서 claude 켬");
const w0 = proc(5);
ok(w0 && !w0.work, "8) 개인 계정으로 켜짐");
const ev8 = since();
ws.send(JSON.stringify({ type: "select-window", index: 5 }));
await ask(5, "Write a 1500-word short story about a lighthouse keeper named Ilsu. Do not use any tools.");
// 답이 화면에 나오기 시작한 뒤에 넘김(그 전에 멈추는 경우는 10번)
ok(await waitFor(() => /esc to interrupt/i.test(scr(5)) && scr(5).split("\n").some((l) => /^⏺ \S/.test(l)), 60000, 300), "8) 일하는 중(답이 나오는 중)");
setPersonal8(0.97);
const q8 = await waitCard(ev8, 30000);
ok(Boolean(q8) && await waitFor(() => !/esc to interrupt/i.test(scr(5)), 30000), "8) 쓰던 답을 멈추고 물음");
if (q8) pick(q8, 1);
const w1 = await waitFor(() => { const q = proc(5); return q && q.pid !== w0?.pid ? q : null; }, 180000);
if (!w1) { console.log("     안내:", JSON.stringify(ev8().filter((e) => e.t === "notice").map((e) => e.text))); dump(5, 16); }
ok(w1?.work === true, `8) 일하는 중에도 회사 계정으로 다시 켬(${w1 ? (w1.work ? "추가 개인" : "개인") : "다시 켜지 않음"})`);
const r8 = rows(w0?.sid);
const iInt = r8.findIndex((r) => r.type === "user" && /^\[Request interrupted by user/.test(text(r)));
const iAsk = r8.findIndex((r) => r.type === "user" && text(r).includes("[계정 전환]"));
ok(iInt >= 0 && iAsk > iInt, `8) 하던 답을 멈춘 뒤(중단 기록 ${iInt}번째 줄) 인수인계를 요청(${iAsk}번째 줄)`);
ok(await waitFor(() => ev8().some((e) => e.t === "notice" && /추가 개인 계정으로 다시 켰어요\(인수인계 문서로 이어 감\)/.test(e.text)), 15000), "8) 폰에 안내(문서로 이어 감)");
ok(Boolean(await waitFor(() => rows(w1?.sid).some((r) => r.type === "user" && text(r).includes("[계정 전환]")), 30000)), "8) 새 대화에 이어 가기 글");

// 9) 인수인계 문서를 시간 안에 못 받으면(여기서는 기다리는 시간 2초) 그래도 바꾸고, 새 세션이 앞 대화 기록 파일을 읽게 함(사용자 결정 11-18)
const ACCT9 = "/tmp/cctest-acct9.json";
const setPersonal9 = (util) => writeFileSync(ACCT9, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));
setPersonal9(0.5);
tm("new-window", "-t", S, "-c", DIR, "-e", `PI_ACCOUNTS_CACHE=${ACCT9}`, "-e", "PI_REMOTE_ACCOUNT_TICK_SEC=3", "-e", "PI_REMOTE_SWITCH_IDLE_SEC=5", "-e", "PI_REMOTE_HANDOFF_WAIT_SEC=2");
await sleep(3000);
tm("send-keys", "-t", `${S}:6`, "C-u"); await sleep(300);
paste(6, `claude ${FLAGS}`);
ok(await trust(6), "9) 셸에서 claude 켬(인수인계 기다림 2초)");
const x0 = proc(6);
await ask(6, "Reply with exactly one word: pong");
ok(await waitFor(() => /⏺ pong/i.test(tail(6, 8)) && !/esc to interrupt/i.test(scr(6)), 60000), "9) 대화 한 번(pong)");
const docsBefore = handoffs().length;
const ev9 = since();
ws.send(JSON.stringify({ type: "select-window", index: 6 }));
setPersonal9(0.97);
await sleep(2000);
await sendOnce(6, STORY("Haru"));
const q9 = await waitCard(ev9);
ok(Boolean(q9), "9) 글을 보내자 물음");
if (q9) pick(q9, 1);
const x1 = await waitFor(() => { const q = proc(6); return q && q.pid !== x0?.pid ? q : null; }, 180000);
if (!x1) { console.log("     안내:", JSON.stringify(ev9().filter((e) => e.t === "notice").map((e) => e.text))); dump(6, 16); }
ok(x1?.work === true, `9) 문서 없이도 회사 계정으로 다시 켬(${x1 ? (x1.work ? "추가 개인" : "개인") : "다시 켜지 않음"})`);
ok(handoffs().length === docsBefore, "9) 문서를 저장하지 않음");
ok(await waitFor(() => ev9().some((e) => e.t === "notice" && /추가 개인 계정으로 다시 켰어요\(인수인계 문서를 받지 못해 앞 대화 기록으로 이어 감\)/.test(e.text)), 15000), "9) 폰에 안내(앞 대화 기록으로 이어 감)");
ok(Boolean(await waitFor(() => rows(x1?.sid).some((r) => r.type === "user" && text(r).includes("인수인계 문서를 남기지 못했습니다") && text(r).includes(`${x0?.sid}.jsonl`)), 30000)),
  "9) 새 대화에 앞 대화 기록 파일 경로를 줌");

// 10) 글을 보내자마자 95%를 넘어 답이 나오기 전에 멈추면, Claude Code 가 그 글을 입력창에 되돌려 놓음(11-18 확인).
//     입력창을 비우고 그 글을 인수인계로 넘겨야 함(남겨 두면 '입력창에 글이 있음'으로 전환이 멈춤)
const ACCT10 = "/tmp/cctest-acct10.json";
const setPersonal10 = (util) => writeFileSync(ACCT10, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));
setPersonal10(0.5);
tm("new-window", "-t", S, "-c", DIR, "-e", `PI_ACCOUNTS_CACHE=${ACCT10}`, ...BUSY_ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:7`, "C-u"); await sleep(300);
paste(7, `claude ${FLAGS}`);
ok(await trust(7), "10) 셸에서 claude 켬");
const y0 = proc(7);
const ev10 = since();
ws.send(JSON.stringify({ type: "select-window", index: 7 }));
setPersonal10(0.97);
// Enter 는 한 번만(ask 는 입력창에 글이 남으면 Enter 를 다시 눌러, 되돌아온 글을 다시 보내 버림)
await sleep(2000);
tm("send-keys", "-t", `${S}:7`, "-l", "Write a 1500-word short story about a sailor named Mina. Do not use any tools.");
await sleep(600);
tm("send-keys", "-t", `${S}:7`, "Enter");
const q10 = await waitCard(ev10, 30000);
const kept10 = await waitFor(() => inputHas(7, "Write a 1500-word short story about a sailor named Mina"), 5000);
if (!kept10) dump(7, 8);
ok(Boolean(q10) && kept10, "10) 답이 나오기 전에 멈추고 물음(보낸 글은 입력창에 그대로)");
if (q10) pick(q10, 1);
const y1 = await waitFor(() => { const q = proc(7); return q && q.pid !== y0?.pid ? q : null; }, 180000);
if (!y1) { console.log("     안내:", JSON.stringify(ev10().filter((e) => e.t === "notice").map((e) => e.text))); dump(7, 16); }
ok(y1?.work === true, `10) 회사 계정으로 다시 켬(${y1 ? (y1.work ? "추가 개인" : "개인") : "다시 켜지 않음"})`);
// 되돌아왔는지: 앞 대화에서 그 글 뒤, 인수인계 요청 전에 답·중단 기록이 없음
const r10 = rows(y0?.sid);
const iMina = r10.findIndex((r) => r.type === "user" && text(r).includes("sailor named Mina"));
const iAsk10 = r10.findIndex((r) => r.type === "user" && text(r).includes("[계정 전환]"));
const restored = iMina >= 0 && iAsk10 > iMina && !r10.slice(iMina + 1, iAsk10).some((r) => r.type === "assistant" || /^\[Request interrupted/.test(text(r)));
ok(restored, `10) 답이 나오기 전에 멈춤(그 글 ${iMina}번째 줄, 인수인계 요청 ${iAsk10}번째 줄)`);
const doc10 = handoffs().map((f) => readFileSync(f, "utf8")).find((d) => d.includes("sailor named Mina")) ?? "";
ok(/## 멈추느라 답하지 못한 사용자 요청/.test(doc10), "10) 되돌아온 글을 인수인계 문서에 넘김");
ok(Boolean(await waitFor(() => rows(y1?.sid).some((r) => r.type === "user" && text(r).includes("[계정 전환]")), 30000)), "10) 새 대화에 이어 가기 글");
ok(await waitFor(() => ev10().some((e) => e.t === "notice" && /추가 개인 계정으로 다시 켰어요\(인수인계 문서로 이어 감\)/.test(e.text)), 15000), "10) 폰에 안내(문서로 이어 감)");

// 11) '그대로 쓰기'(사용자 결정 11-24): 멈춘 글을 다시 보내 같은 계정으로 이어 하고, 그 뒤로는 묻지 않음. 한도가 내려오면 기록을 지움
const ACCT11 = "/tmp/cctest-acct11.json";
const setPersonal11 = (util) => writeFileSync(ACCT11, JSON.stringify({ anthropic: { "7d": { util, reset: fut, at: Date.now() } } }));
setPersonal11(0.5);
tm("new-window", "-t", S, "-c", DIR, "-e", `PI_ACCOUNTS_CACHE=${ACCT11}`, ...BUSY_ENVS);
await sleep(3000);
tm("send-keys", "-t", `${S}:8`, "C-u"); await sleep(300);
paste(8, `claude ${FLAGS}`);
ok(await trust(8), "11) 셸에서 claude 켬");
const k0 = proc(8);
const ev11 = since();
ws.send(JSON.stringify({ type: "select-window", index: 8 }));
setPersonal11(0.97);
await sleep(2000);
await sendOnce(8, "Count from one to thirty in English words, one per line, then write the word kiwi on the last line. Do not use any tools.");
const q11 = await waitCard(ev11, 30000);
ok(Boolean(q11), "11) 글을 보내자 멈추고 물음");
if (q11) pick(q11, 0);
ok(await waitFor(() => ev11().some((e) => e.t === "notice" && /개인 계정을 그대로 써요\. 한도가 꽉 차 멈추면 다시 물어요/.test(e.text)), 10000), "11) 폰에 안내(그대로 써요)");
const kiwi = await waitFor(() => answeredAfter(k0?.sid, "Count from one to thirty", "kiwi"), 90000);
if (!kiwi) dump(8, 16);
ok(kiwi && proc(8)?.pid === k0?.pid && proc(8)?.work === false, "11) 멈춘 일을 같은 개인 계정으로 이어 함(kiwi)");
ok(tm("show-options", "-w", "-v", "-t", `${S}:8`, "@ai_account_keep").trim() === "personal", "11) 탭에 '그대로 쓰기' 기록");
await settle(8);
const n11 = accountCards(ev11()).length;
await sendOnce(8, "Reply with exactly one word: lime");
const lime = await waitFor(() => answeredAfter(k0?.sid, "Reply with exactly one word: lime", "lime"), 60000);
ok(lime && accountCards(ev11()).length === n11, "11) 다음 글은 묻지 않고 그대로(lime)");
setPersonal11(0.5);
ok(await waitFor(() => tm("show-options", "-w", "-v", "-t", `${S}:8`, "@ai_account_keep").trim() === "", 15000), "11) 한도가 내려오면 '그대로 쓰기' 기록을 지움(다음에 넘으면 다시 물음)");

// 12) 카드를 닫으면(취소) 계정을 정하지 않음: 바꾸지 않고, 되돌아온 글은 입력창에서 지우고 보내지 않았다고 알림
//     (남기면 폰에서 보낸 다음 글이 그 뒤에 붙어 함께 나감). 다음 글을 보내면 다시 물음
await settle(8);
const ev12 = since();
setPersonal11(0.97);
await sleep(2000);
await sendOnce(8, "Write a 1500-word short story about a fox named Saebom. Do not use any tools.");
const q12 = await waitCard(ev12, 30000);
ok(Boolean(q12), "12) 다시 넘자 물음");
if (q12) ws.send(JSON.stringify({ type: "question-answer", id: q12.id, answers: [], other: "", cancel: true }));
await sleep(10000);
ok(proc(8)?.pid === k0?.pid && proc(8)?.work === false && !ev12().some((e) => e.t === "notice" && /인수인계/.test(e.text)), "12) 취소 → 바꾸지 않음");
const told = ev12().some((e) => e.t === "notice" && /보낸 글은 보내지 않았어요\('Write a 1500-word short story about a fo/.test(e.text));
const empty12 = inputEmpty(scr(8));
if (!empty12) dump(8, 8);
ok((told && empty12) || answeredAfter(k0?.sid, "fox named Saebom", "Saebom"), `12) 되돌아온 글은 지우고 알림(${told ? "알림 받음" : "답이 이미 나오던 중"}, 입력창 ${empty12 ? "빔" : "글 남음"})`);
await sendOnce(8, "Write a 1500-word short story about an owl named Dal. Do not use any tools.");
const q12b = await waitFor(() => { const cs = accountCards(ev12()); return cs.length >= 2 ? cs.at(-1) : null; }, 30000);
ok(Boolean(q12b) && q12b.id !== q12?.id, "12) 다음 글에 다시 물음");

// 13) 카드가 열린 채 앱에서 계정 칩으로 회사를 고르면 그것이 답: 카드를 닫고, 되돌아온 글을 인수인계로 넘겨 회사 계정으로
const ev13 = since();
ws.send(JSON.stringify({ type: "set-account", account: "work" }));
ok(await waitFor(() => ev13().some((e) => e.t === "question-done" && e.id === q12b?.id), 10000), "13) 칩으로 고르자 카드가 닫힘");
const m1 = await waitFor(() => { const q = proc(8); return q && q.account === "work" ? q : null; }, 180000);
ok(Boolean(m1), "13) 회사 계정으로 다시 켬");
const doc13 = handoffs().map((f) => readFileSync(f, "utf8")).find((d) => d.includes("owl named Dal")) ?? "";
ok(/## 멈추느라 답하지 못한 사용자 요청/.test(doc13), "13) 되돌아온 글(Dal)을 인수인계 문서에 넘김");

const [pane3, pane4] = [3, 4].map((w) => tm("display", "-p", "-t", `${S}:${w}`, "#{pane_id}").trim().replace(/\W/g, ""));

ws.close();
bridge.kill();
execFileSync("sh", [`${REPO}/claude-remote/test/stop-test-feeds.sh`, S], { stdio: "ignore" });
tm("kill-session", "-t", S);
rmSync(ACCT, { force: true });
rmSync(ACCT8, { force: true });
rmSync(ACCT9, { force: true });
rmSync(ACCT10, { force: true });
rmSync(ACCT11, { force: true });
for (const p of [pane3, pane4]) if (p) rmSync(`${process.env.HOME}/.cache/pi-remote/feed/${p}.switch-pause`, { force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
