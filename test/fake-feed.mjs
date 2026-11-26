// 시험용 가짜 대화 피드(모델도 pi·Claude Code 도 띄우지 않음): tmux 칸 하나의 대화 피드 소켓을 열고, 붙는 브리지에 정해 둔 대화를 준다.
// 앱 화면 시험 YY(긴 것 접기)가 쓴다: 짧은 글, 화면 두 장을 넘는 내 메시지·답(링크가 든 것 포함), 12줄을 넘는 '!' 명령 출력, 긴 코드 블록.
//   node fake-feed.mjs <칸 id> <신호 폴더>
//   <신호 폴더>/fold-arrive 가 생기면 긴 답을 통째로 하나 더 보낸다(Claude Code 탭에서 답이 오는 모양)
//   <신호 폴더>/fold-link   가 생기면 링크가 든 긴 답을 보낸다(접힌 답의 링크 시험)
//   <신호 폴더>/fold-grow   가 생기면 답 하나를 조금씩 키워 가며 보낸다(쓰는 중인 답)
//   <신호 폴더>/fold-busy   가 있는 동안은 '작업 중'인 탭으로 보인다(새로 붙는 앱이 받는 처음 대화에도). 없어지면 쉬는 중으로
// --account 를 붙이면 계정 고르기 시험(AAC)용 Claude Code 탭 흉내: 짧은 대화만 주고, 탭 옵션에 계정(개인)을 적고,
//   앱이 보낸 {cmd:"set-account"} 를 <신호 폴더>/acct-cmds 에 한 줄씩 적은 뒤 맥 연결부처럼 상태를 바꿔 준다
//   (고른 계정이 지금과 다르면 기다림 → 바꾸는 중 → 그 계정. 자동이면 이 탭의 기본인 개인으로)
// --tabcache <이름> 을 붙이면 탭마다 대화를 저장해 두는 시험(AAE)용 탭: 이름이 cache1 이면 메시지 70개(앱이 처음엔 최근 것만 그림), 그 밖은 4개.
//   <신호 폴더>/<이름>-slow 가 있는 동안 새로 붙는 쪽에 처음 대화를 6초 늦게 준다(느린 연결 흉내: 앱은 저장해 둔 것을 먼저 보여야 함)
//   <신호 폴더>/<이름>-add  가 생기면 새 답을 하나 더하고 탭 상태를 '끝남'으로 바꾼 뒤 신호를 지운다(앱이 이 탭을 미리 받아야 함)
// 소켓 자리는 진짜 피드와 같은 ~/.cache/pi-remote/feed/<칸 번호>.sock (시험 세션의 칸이라 쓰는 탭과 겹치지 않음). 끝날 때 지운다.
// 작성: 서문교
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { crc32, deflateSync } from "node:zlib";

const [pane, signals] = process.argv.slice(2);
if (!pane || !signals) { console.error("쓰기: node fake-feed.mjs <칸 id> <신호 폴더> [--account | --image]"); process.exit(2); }
const ACCOUNT = process.argv.includes("--account");
// --image: 답 속 맥의 그림 경로 시험(AAD)용. 그림 파일(<신호 폴더>/맥 그림 01.png, 한글·띄어쓰기 이름)을 만들고,
//   그 경로를 코드 글자로 쓴 답과 없는 그림 경로를 쓴 답을 준다(앱이 경로를 누르면 브리지가 그 파일을 줌)
const IMAGE = process.argv.includes("--image");
const CACHE = process.argv.includes("--tabcache") ? process.argv[process.argv.indexOf("--tabcache") + 1] ?? "" : "";
const PIC = `${signals}/맥 그림 01.png`, NO_PIC = `${signals}/없는 그림.png`;
if (IMAGE) {
  // 600x400, 위 절반은 주황·아래 절반은 파랑인 PNG
  const w = 600, h = 400;
  const row = (rgb) => { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) r.set(rgb, 1 + x * 3); return r; };
  const raw = Buffer.concat([...Array(h / 2).fill(row([230, 120, 40])), ...Array(h / 2).fill(row([40, 90, 200]))]);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  writeFileSync(PIC, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  rmSync(NO_PIC, { force: true });
}
const dir = `${process.env.HOME}/.cache/pi-remote/feed`;
const sock = `${dir}/${pane.replace(/\W/g, "")}.sock`;
mkdirSync(dir, { recursive: true });
rmSync(sock, { force: true });

// 문단 n개짜리 글. 끝난 글(ended)의 마지막 문단에만 '마지막 문단'이라고 적는다(쓰는 중인 글에는 아직 없음)
const paras = (name, n, ended = true) => Array.from({ length: n }, (_, i) =>
  i === 0 ? `${name}의 첫 문단입니다.` : ended && i === n - 1 ? `${name}의 마지막 문단입니다.`
    : `${name}의 ${i + 1}번째 문단입니다. 접히는지 보려고 일부러 길게 쓴 글이라 한 문단이 폰 화면에서 두 줄을 넘습니다.`).join("\n\n");
const answer = (id, text, stop = "stop") => ({ id, role: "assistant", blocks: [{ type: "text", text }], stop, error: null });
const user = (id, text) => ({ id, role: "user", text, images: 0 });
const code = Array.from({ length: 120 }, (_, i) => `let line${i + 1} = ${i + 1}`).join("\n");
// 링크가 든 긴 답(시험 YY ⑥, 신호 fold-link): 접힌 채 보이는 둘째 문단은 링크 하나뿐, 잘려서 안 보이는 다섯째 문단부터 끝 문단 앞까지는 링크로 빽빽하게
const linked = (name, n) => paras(name, n).split("\n\n").map((p, i) =>
  i === 1 ? "https://example.com/fold-visible"
    : i >= 4 && i < n - 1 ? Array.from({ length: 6 }, () => `https://example.com/fold-hidden-${i + 1}`).join(" ") : p).join("\n\n");

const cacheTalk = (name, n) => Array.from({ length: n }, (_, i) => i % 2 === 0
  ? user(`u${i}`, i === 0 ? `${name} 맨 처음 질문` : `${name} 질문 ${i}`)
  : answer(`a${i}`, `${name} 답 ${i}`));
const messages = CACHE ? cacheTalk(CACHE, CACHE === "cache1" ? 70 : 4) : IMAGE ? [user("u1", "QR 그림을 만들어 주세요"),
  answer("a1", `QR 그림은 맥에 저장했습니다.\n\n\`${PIC}\`\n\n지운 그림은 아래였습니다.\n\n\`${NO_PIC}\``)]
  : ACCOUNT ? [user("u1", "계정 시험 질문입니다"), answer("a1", "계정 시험 답입니다.")] : [
  user("u1", "짧은 질문입니다"),
  answer("a1", "짧은 답입니다."),
  user("u2", Array.from({ length: 80 }, (_, i) => `붙여 넣은 글 ${i + 1}번째 줄`).join("\n")),
  answer("a2", paras("중간 답", 8)),
  { id: "b1", role: "bash", command: "seq 1 40", output: Array.from({ length: 40 }, (_, i) => `출력 ${i + 1}`).join("\n"), exitCode: 0 },
  answer("a3", `코드 앞의 글입니다.\n\n\`\`\`swift\n${code}\n\`\`\`\n\n코드 뒤의 글입니다.`),
  user("u3", "긴 답을 주세요"),
  answer("a4", paras("긴 답", 30)),
];

const clients = new Set();
const send = (o) => { for (const c of clients) c.write(`${JSON.stringify(o)}\n`); };
let busySince = 0;   // 0 이 아니면 '작업 중'(그때부터 일한 것으로)
const snapshot = () => ({ t: "snapshot", v: 3, messages, truncated: 0, working: busySince > 0, since: busySince || null, queue: [], canSend: true, notice: null, context: null, compacting: false,
  ...(ACCOUNT ? { agent: "claude" } : {}) });

// 계정 시험: 맥 연결부처럼 탭 옵션에 계정 상태를 적는다(브리지가 탭 목록에 실어 앱에 보냄)
const tmuxSet = (key, value) => {
  try {
    execFileSync("tmux", value ? ["set-option", "-w", "-t", pane, key, value] : ["set-option", "-w", "-u", "-t", pane, key], { stdio: "ignore" });
  } catch { /* 시험 세션이 이미 닫힘 */ }
};
let accountNow = "personal";
const pickAccount = (account) => {
  appendFileSync(`${signals}/acct-cmds`, `${account}\n`);
  const pin = account === "work" || account === "personal" ? account : "";
  tmuxSet("@ai_account_pin", pin);
  const want = pin || "personal";
  if (want === accountNow) return;
  tmuxSet("@ai_account_next", want);
  tmuxSet("@ai_account_phase", "wait");
  setTimeout(() => tmuxSet("@ai_account_phase", "switch"), 2500);
  setTimeout(() => {
    accountNow = want;
    tmuxSet("@ai_account", want);
    tmuxSet("@ai_account_next", "");
    tmuxSet("@ai_account_phase", "");
  }, 5000);
};
if (ACCOUNT) {
  for (const k of ["@ai_account_pin", "@ai_account_next", "@ai_account_phase"]) tmuxSet(k, "");
  tmuxSet("@ai_account", accountNow);
}

const server = createServer((c) => {
  clients.add(c);
  c.on("error", () => {});
  c.on("close", () => clients.delete(c));
  let buf = "";
  c.on("data", (d) => {   // 앱이 보내는 요청: 계정 시험의 계정 고르기만 받고, 나머지(명령 목록 등)는 답하지 않는다
    if (!ACCOUNT) return;
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const o = JSON.parse(line);
        if (o.cmd === "set-account") pickAccount(String(o.account ?? ""));
      } catch { /* 줄 단위 JSON 이 아님 */ }
    }
  });
  if (CACHE && existsSync(`${signals}/${CACHE}-slow`)) setTimeout(() => c.writable && c.write(`${JSON.stringify(snapshot())}\n`), 6000);
  else c.write(`${JSON.stringify(snapshot())}\n`);
});
server.listen(sock);

const upsert = (m) => {
  const i = messages.findIndex((x) => x.id === m.id);
  if (i >= 0) messages[i] = m; else messages.push(m);
  send({ t: "upsert", message: m });
};
const once = (name, run) => {
  if (ACCOUNT || IMAGE || CACHE) return;   // 계정·그림·탭 저장 시험 탭은 접기 시험 신호를 받지 않음
  const t = setInterval(() => {
    if (!existsSync(`${signals}/${name}`)) return;
    clearInterval(t);
    run();
  }, 200);
};
once("fold-arrive", () => {
  upsert(user("u4", "하나 더 주세요"));
  upsert(answer("a5", paras("둘째 긴 답", 30)));
});
// 링크가 든 긴 답은 신호가 있을 때만 보낸다(처음부터 두면 주황 링크가 시험 AAB 의 '작업 중' 점 찾기에 점으로 잡힘)
once("fold-link", () => {
  upsert(user("u6", "링크를 주세요"));
  upsert(answer("a7", linked("링크 답", 30)));
});
once("fold-grow", () => {
  upsert(user("u5", "천천히 써 주세요"));
  send({ t: "working", value: true, since: Date.now() });
  // 한 문단에서 시작해 여섯 문단씩 늘린다(1 → 31). 처음에는 짧은 글이라 앱이 높이를 재지 않다가, 길어지면 그때부터 재는 길을 지난다
  let n = -5;
  const t = setInterval(() => {
    n += 6;
    const done = n >= 30;
    upsert(answer("a6", paras("자라는 답", n, done), done ? "stop" : "pending"));
    if (!done) return;
    clearInterval(t);
    send({ t: "working", value: false });
  }, 250);
});

// '작업 중'인 탭 흉내: 신호 파일이 생기고 없어질 때마다 붙어 있는 앱에 알린다(1분 넘게 일한 것처럼)
setInterval(() => {
  const busy = !ACCOUNT && !CACHE && existsSync(`${signals}/fold-busy`);
  if (busy === busySince > 0) return;
  busySince = busy ? Date.now() - 65_000 : 0;
  send(busy ? { t: "working", value: true, since: busySince } : { t: "working", value: false });
}, 200);

// 탭 저장 시험: 새 답을 더하고 탭 상태를 '끝남'으로(앱은 다른 탭을 보는 중이므로 이 탭을 미리 받아야 함)
if (CACHE) {
  setInterval(() => {
    const sig = `${signals}/${CACHE}-add`;
    if (!existsSync(sig)) return;
    rmSync(sig, { force: true });
    upsert(answer(`new${messages.length}`, `${CACHE} 새 답입니다`));
    tmuxSet("@pi_status", "yourturn");
  }, 200);
}

const bye = () => { rmSync(sock, { force: true }); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
