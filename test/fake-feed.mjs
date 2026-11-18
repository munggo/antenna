// 시험용 가짜 대화 피드(모델도 pi·Claude Code 도 띄우지 않음): tmux 칸 하나의 대화 피드 소켓을 열고, 붙는 브리지에 정해 둔 대화를 준다.
// 앱 화면 시험 YY(긴 것 접기)가 쓴다: 짧은 글, 화면 두 장을 넘는 내 메시지·답, 12줄을 넘는 '!' 명령 출력, 긴 코드 블록.
//   node fake-feed.mjs <칸 id> <신호 폴더>
//   <신호 폴더>/fold-arrive 가 생기면 긴 답을 통째로 하나 더 보낸다(Claude Code 탭에서 답이 오는 모양)
//   <신호 폴더>/fold-grow   가 생기면 답 하나를 조금씩 키워 가며 보낸다(쓰는 중인 답)
//   <신호 폴더>/fold-busy   가 있는 동안은 '작업 중'인 탭으로 보인다(새로 붙는 앱이 받는 처음 대화에도). 없어지면 쉬는 중으로
// 소켓 자리는 진짜 피드와 같은 ~/.cache/pi-remote/feed/<칸 번호>.sock (시험 세션의 칸이라 쓰는 탭과 겹치지 않음). 끝날 때 지운다.
// 작성: 서문교
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";

const [pane, signals] = process.argv.slice(2);
if (!pane || !signals) { console.error("쓰기: node fake-feed.mjs <칸 id> <신호 폴더>"); process.exit(2); }
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

const messages = [
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
const snapshot = () => ({ t: "snapshot", v: 3, messages, truncated: 0, working: busySince > 0, since: busySince || null, queue: [], canSend: true, notice: null, context: null, compacting: false });
const server = createServer((c) => {
  clients.add(c);
  c.on("error", () => {});
  c.on("close", () => clients.delete(c));
  c.on("data", () => {});   // 앱이 보내는 요청(명령 목록 등)은 답하지 않는다
  c.write(`${JSON.stringify(snapshot())}\n`);
});
server.listen(sock);

const upsert = (m) => {
  const i = messages.findIndex((x) => x.id === m.id);
  if (i >= 0) messages[i] = m; else messages.push(m);
  send({ t: "upsert", message: m });
};
const once = (name, run) => {
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
  const busy = existsSync(`${signals}/fold-busy`);
  if (busy === busySince > 0) return;
  busySince = busy ? Date.now() - 65_000 : 0;
  send(busy ? { t: "working", value: true, since: busySince } : { t: "working", value: false });
}, 200);

const bye = () => { rmSync(sock, { force: true }); process.exit(0); };
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
