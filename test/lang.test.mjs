// 맥이 폰에 보내는 글의 언어(PI_REMOTE_LANG) 시험: 언어 고르기, 영어일 때 주요 글에 한글이 없는지, 한국어일 때는 예전 그대로인지.
// 모듈은 불러올 때 언어를 정하므로 언어마다 따로 띄운 node 에서 본다. 모델·tmux·쓰는 브리지를 쓰지 않는다
//   node test/lang.test.mjs
// 작성: 서문교
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let fail = 0, n = 0;
const ok = (c, name) => { n++; console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };
const hangul = (s) => /[가-힣]/.test(JSON.stringify(s));
const TMP = mkdtempSync(join(tmpdir(), "antenna-lang-"));

/** 그 언어로 띄운 node 에서 코드를 돌려 JSON 결과를 받는다(env: 더할 환경 변수) */
function run(code, env = {}) {
  const file = join(TMP, `c${n}-${Math.random().toString(36).slice(2, 7)}.mjs`);
  writeFileSync(file, `const R = (p) => import(${JSON.stringify(REPO)} + "/" + p);\nconst out = await (async () => { ${code} })();\nconsole.log(JSON.stringify(out));\n`);
  const base = { ...process.env };
  delete base.PI_REMOTE_LANG;
  return JSON.parse(execFileSync(process.execPath, [file], { env: { ...base, PI_REMOTE_ENV: join(TMP, "none"), ...env }, encoding: "utf8" }).trim().split("\n").pop());
}

// 1. 언어 고르기: 환경 변수 → 설정 파일 → macOS 첫 언어
ok(run(`return (await R("pi-extension/lib/lang.mjs")).LANG`, { PI_REMOTE_LANG: "en" }) === "en", "환경 변수 en");
ok(run(`return (await R("pi-extension/lib/lang.mjs")).LANG`, { PI_REMOTE_LANG: "ko-KR" }) === "ko", "환경 변수 ko-KR → ko");
writeFileSync(join(TMP, "env"), "PORT=8787\nexport PI_REMOTE_LANG=\"en\"\n");
ok(run(`return (await R("pi-extension/lib/lang.mjs")).LANG`, { PI_REMOTE_ENV: join(TMP, "env") }) === "en", "설정 파일의 PI_REMOTE_LANG(export·따옴표)");
const mac = run(`return (await R("pi-extension/lib/lang.mjs")).macLang()`);
ok(run(`return (await R("pi-extension/lib/lang.mjs")).LANG`) === mac && ["ko", "en"].includes(mac), `둘 다 없으면 macOS 첫 언어(${mac})`);
ok(run(`const m = await R("pi-extension/lib/lang.mjs"); return [m.tr("가", "A")]`, { PI_REMOTE_LANG: "en" })[0] === "A"
  && run(`const m = await R("pi-extension/lib/lang.mjs"); return [m.tr("가", "A")]`, { PI_REMOTE_LANG: "ko" })[0] === "가", "tr 이 언어대로 고름");

// 2. Claude Code 연결부
const FEED = `
  const f = await R("claude-remote/claude-feed.mjs");
  const lim = { family: "Fable" };
  const card = f.dialogCard({ title: "You have 2 unsent feedback drafts", lines: ["You have 2 unsent feedback drafts", "Review them?"],
    guide: [{ key: "Enter", action: "review & send" }, { key: "Esc", action: "close" }], items: [{ n: 1, nav: true, label: "Yes", desc: "" }, { n: 2, nav: true, label: "No", desc: "" }], cursor: 0 });
  return {
    read: f.describeTool("Read", { file_path: "/w/LoginView.swift" }),
    grep: f.describeTool("Grep", { pattern: "keyboard" }),
    todo: f.describeTool("TodoWrite", { todos: [{ status: "completed", content: "a" }, { status: "in_progress", content: "b", activeForm: "doing b" }] }),
    ask: f.describeTool("AskUserQuestion", { questions: [{ question: "Q1?" }, { question: "Q2?" }] }),
    reset: f.resetText(Math.floor(new Date(2026, 10, 23, 16, 30).getTime() / 1000)),
    card: { title: card.title, question: card.question, options: card.options.map((o) => o.label + " " + o.description) },
    limit: f.limitCard(lim, { resetAt: Math.floor(Date.now() / 1000) + 3600, account: "personal", effort: "high" }),
    account: f.accountCard({ cur: "personal", other: "personal2", util: 0.96, otherUtil: 0.2 }),
    efforts: f.EFFORT_CHOICES.map((c) => f.effortLabel(c)), wait: f.LIMIT_WAIT_LABEL, note: f.CLOUDFLARE_NOTE,
  };`;
const en = run(FEED, { PI_REMOTE_LANG: "en" });
ok(en.read === "Read LoginView.swift" && en.grep === "Search: keyboard", `도구 단계 설명(지금: ${en.read} / ${en.grep})`);
ok(en.todo === "To-dos 1/2 · now: doing b" && en.ask === "Q1? and 1 more", `할 일·질문 단계(지금: ${en.todo} / ${en.ask})`);
ok(en.reset === "Nov 23 (Mon) 4:30 PM", `초기화 시각(지금: ${en.reset})`);
ok(!hangul(en.card), `맥 화면 창 카드는 화면의 영어 그대로(지금: ${JSON.stringify(en.card).slice(0, 160)})`);
ok(!hangul(en.limit) && !hangul(en.account), `한도·계정 카드(지금: ${JSON.stringify(en.limit).slice(0, 120)})`);
ok(!hangul(en.efforts) && en.wait === "Wait" && !hangul(en.note), "생각 깊이 이름·기다리기·Cloudflare 안내");
const ko = run(FEED, { PI_REMOTE_LANG: "ko" });
ok(ko.read === "LoginView.swift 읽기" && ko.grep === "검색: keyboard" && ko.todo === "할 일 1/2 · 지금: doing b", "한국어는 예전 그대로(단계 설명)");
ok(ko.reset === "11월 23일(월) 오후 4시 30분" && ko.wait === "기다리기", `한국어는 예전 그대로(초기화 시각·기다리기, 지금: ${ko.reset})`);
ok(ko.card.options.some((o) => o.startsWith("예 (Yes)")), "한국어는 예전 그대로(화면 창 카드의 '예 (Yes)')");

// 3. 브리지 쪽 모듈
const SERVER = `
  const reach = await R("server/reach.mjs"), mp = await R("server/mac-prompts.mjs"), uh = await R("server/usage-history.mjs"), tasks = await R("server/tasks.mjs");
  const starter = tasks.createTaskStarter({ launch: () => ({}), home: "/tmp", session: "s" });
  const empty = await starter({ type: "task", id: "abcdefgh1234", text: "", agent: "claude" });
  return { reach: [reach.reachText(true), reach.reachText(false)], prompt: mp.promptMessage({ service: "kTCCServiceCamera", target: "x" }, { name: "web", index: 3 }),
    mixed: uh.MIXED_TEXT, empty };`;
const sen = run(SERVER, { PI_REMOTE_LANG: "en" });
ok(sen.reach[0] === " · VPN connected" && !hangul(sen.reach), "VPN 상태 글");
ok(!hangul(sen.prompt) && /camera access/.test(sen.prompt.body), `맥 권한 창 알림(지금: ${JSON.stringify(sen.prompt)})`);
ok(!hangul(sen.mixed), "계정이 섞였을 때 알림");
ok(!hangul(sen.empty), `단축어로 시킨 일이 비었을 때(지금: ${JSON.stringify(sen.empty)})`);
const sko = run(SERVER, { PI_REMOTE_LANG: "ko" });
ok(sko.reach[0] === " · VPN 연결됨" && /카메라 사용/.test(sko.prompt.body), "한국어는 예전 그대로(VPN·권한 창)");

rmSync(TMP, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개 / ${n}개` : `모두 통과(${n}개)`);
process.exit(fail ? 1 : 0);
