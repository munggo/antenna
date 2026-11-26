// 폰에 이미 있는 메시지는 다시 보내지 않기·다른 탭 미리 받기 시험(사용자 요청 11-25: 탭을 바꿀 때마다 긴 대화를 통째로 다시 받아 느렸음).
//  1) 지문·처음 대화 바꾸기(server/chat-delta.mjs): 내용이 같으면 같은 지문, 가진 것은 빼고, 이상한 입력은 버림
//  2) 브리지(가짜 홈으로 따로 띄움, 쓰는 브리지·tmux 세션은 건드리지 않음)와 가짜 연결부 소켓으로
//     - 예전 앱: 받는 것은 그대로(지문 없음, 통째로). 다만 0.15초 기다림 없이 바로 받음
//     - 새 앱(chat=2): 가진 지문을 알릴 때까지 기다렸다가 없는 것만 · 알리지 않으면 1.5초 뒤 통째로
//     - 탭 고르기에 지문을 실으면 그 탭은 없는 것만 · 연결부가 대화를 다시 보내면(압축 등) 그때도 바뀐 것만
//     - 미리 받기: 없는 것만·처음이면 통째로·연결부 없는 탭은 '없음'·이 세션이 아닌 칸은 거절·이상한 칸 번호는 무시 · 안내 글은 그대로
//     - 다시 통째로(chat-resync)
// 실행: node server/test/chat-delta.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashMessage, parseHave, snapshotForApp } from "../chat-delta.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "chatdeltatest", PORT = 8783, ROOT = `/tmp/antenna-chatdelta-${process.pid}`, HOME = `${ROOT}/home`, TOKEN = "d".repeat(64);
const FEED = `${HOME}/.cache/pi-remote/feed`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// ── 1) 지문·처음 대화 바꾸기 ──
const msg = (id, text) => ({ id, role: "assistant", blocks: [{ type: "text", text }], stop: "stop", error: null });
ok(hashMessage(msg("a", "글")) === hashMessage(msg("a", "글")) && /^[A-Za-z0-9_-]{10}$/.test(hashMessage(msg("a", "글"))), "내용이 같으면 같은 지문(10글자)");
ok(hashMessage(msg("a", "글")) !== hashMessage(msg("a", "글!")), "내용이 한 글자만 달라도 다른 지문");
ok(parseHave("abc") === null && parseHave(null) === null && parseHave(Array(2001).fill("AAAAAAAAAA")) === null, "지문 목록이 아니거나 너무 많으면 버림");
ok(parseHave(["AAAAAAAAAA", "짧음", 3, "AAAAAAAAAA/", "BBBBBBBBBB"]).size === 2, "모양이 맞는 지문만 받음");
const snap = { t: "snapshot", v: 3, messages: [msg("1", "하나"), msg("2", "둘"), msg("3", "셋")], truncated: 7, working: false, notice: "업데이트했어요" };
const full = snapshotForApp(JSON.stringify(snap), undefined, "%5");
const fullObj = JSON.parse(full.json);
ok(fullObj.messages.length === 3 && fullObj.hashes.length === 3 && fullObj.key === "%5" && !fullObj.delta && fullObj.truncated === 7 && fullObj.notice === "업데이트했어요",
  "가진 것을 모르면 통째로 + 지문·탭 번호(나머지 값은 그대로)");
const part = JSON.parse(snapshotForApp(JSON.stringify(snap), new Set([full.hashes[0], full.hashes[2]]), "%5").json);
ok(part.delta === true && part.messages.length === 1 && part.messages[0].id === "2" && part.hashes.join() === full.hashes.join() && part.fresh.join() === "1",
  "가진 것은 빼고 없는 것만(지문은 모두 순서대로, 보낸 것의 자리)");
ok(snapshotForApp('{"t":"upsert","message":{}}', undefined, "%5") === null && snapshotForApp("{깨진", undefined, "%5") === null, "처음 대화가 아니거나 깨진 줄은 손대지 않음");

// ── 2) 브리지와 가짜 연결부 ──
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(FEED, { recursive: true });
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
tm("new-window", "-d", "-t", S, "-c", "/tmp");
tm("new-window", "-d", "-t", S, "-c", "/tmp");
const panes = tm("list-panes", "-s", "-t", S, "-F", "#{window_index} #{pane_id}").split("\n").map((l) => l.split(" ")[1]);
const [A, B, C] = panes;   // A·B 는 연결부가 있는 탭, C 는 셸 탭(연결부 없음)

// 가짜 연결부: Claude Code 연결부처럼 첫 줄을 받거나 0.15초가 지나면 처음 대화를 준다. 받은 첫 줄과 연결 수를 적어 둔다
const feeds = {};
const fakeFeed = (pane, count, notice) => {
  const f = { messages: Array.from({ length: count }, (_, i) => msg(`${pane}-${i}`, `${pane} 탭의 ${i}번째 답입니다. `.repeat(20))), clients: new Set(), firstLines: [], conns: 0, notice };
  f.snapshot = () => ({ t: "snapshot", v: 3, agent: "claude", messages: f.messages, truncated: 0, working: false, canSend: true, notice: f.notice ?? null });
  f.server = createServer((sock) => {
    f.conns++;
    let greeted = false;
    const greet = () => {
      if (greeted) return;
      greeted = true;
      f.clients.add(sock);
      sock.write(`${JSON.stringify(f.snapshot())}\n${JSON.stringify({ t: "commands", commands: [] })}\n`);
    };
    const t = setTimeout(greet, 150);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) return;
      if (!greeted) f.firstLines.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
      clearTimeout(t);
      greet();
    });
    sock.on("error", () => {});
    sock.on("close", () => f.clients.delete(sock));
  });
  f.server.listen(`${FEED}/${pane.replace(/\W/g, "")}.sock`);
  f.broadcast = () => { for (const c of f.clients) c.write(`${JSON.stringify(f.snapshot())}\n`); };
  feeds[pane] = f;
};
fakeFeed(A, 50);
fakeFeed(B, 30, "연결부를 새로 켰어요");

const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: SERVER,
  env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
    PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
    PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log` },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
let exited = null;
bridge.stdout.on("data", (d) => (log += d));
bridge.stderr.on("data", (d) => (log += d));
bridge.on("exit", (code) => (exited = code));

/** 앱 흉내: 받은 제어 메시지를 차례로 모음 */
const connect = async (query) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30${query}`);
  const got = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try { got.push({ at: Date.now(), m: JSON.parse(data.toString()) }); } catch { /* 터미널 글 */ }
  });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const opened = Date.now();
  /** 조건에 맞는 메시지를 from 번째부터 기다림 */
  const wait = async (pred, ms = 5000, from = 0) => {
    for (let t = 0; t < ms; t += 20) {
      const hit = got.slice(from).find((g) => pred(g.m));
      if (hit) return hit;
      await sleep(20);
    }
    return null;
  };
  const send = (o) => ws.send(JSON.stringify(o));
  return { ws, got, wait, send, opened };
};
const isSnap = (m) => m.type === "chat" && m.d?.t === "snapshot";
const hashesOf = (pane) => feeds[pane].messages.map(hashMessage);

try {
  for (let i = 0; i < 40 && !/브리지 시작/.test(log) && exited === null; i++) await sleep(250);
  if (!/브리지 시작/.test(log) || exited !== null) throw new Error(`브리지가 뜨지 않음(끝 코드 ${exited})\n${log.slice(-400)}`);
  tm("select-window", "-t", `${S}:0`);

  // 예전 앱: 그대로(지문 없음), 0.15초 기다리지 않음
  let app = await connect("");
  let s = await app.wait(isSnap);
  ok(s && s.m.d.messages.length === 50 && !("hashes" in s.m.d) && !s.m.d.delta, `예전 앱은 전처럼 통째로·지문 없이(${s?.m.d.messages.length}개)`);
  ok(feeds[A].firstLines.at(-1) === '{"hello":true}', `브리지가 연결부에 붙자마자 명령 이름 없는 첫 줄을 보냄(${feeds[A].firstLines.at(-1)})`);
  const w = await app.wait((m) => m.type === "windows");
  ok(w && w.m.windows.find((x) => x.index === 0)?.key === A, `탭 목록에 칸 번호(${w?.m.windows.map((x) => x.key).join(",")})`);
  app.ws.close();

  // 새 앱: 가진 지문을 알릴 때까지 기다림 → 없는 것만
  app = await connect("&chat=2");
  await sleep(700);
  ok(!app.got.some((g) => isSnap(g.m)), "새 앱은 가진 지문을 알리기 전에는 대화를 받지 않음(0.7초 동안)");
  app.send({ type: "chat-have", key: A, have: hashesOf(A).slice(0, 45) });
  const sentAt = Date.now();
  s = await app.wait(isSnap);
  ok(s && s.m.d.delta === true && s.m.d.key === A && s.m.d.hashes.length === 50 && s.m.d.messages.length === 5 && s.m.d.messages[0].id === `${A}-45` && s.m.d.fresh.join() === "45,46,47,48,49",
    `가진 45개는 빼고 5개만(받은 ${s?.m.d.messages.length}개, 지문 ${s?.m.d.hashes?.length}개, 탭 ${s?.m.d.key})`);
  ok(s && s.at - sentAt < 120, `알린 뒤 곧바로 받음(${s ? s.at - sentAt : "?"}ms, 예전엔 연결부가 0.15초 기다림)`);
  const fullSize = JSON.stringify(feeds[A].snapshot()).length;
  ok(s && JSON.stringify(s.m.d).length < fullSize / 4, `받는 양이 크게 줆(${Math.round(JSON.stringify(s?.m.d ?? {}).length / 1024)}KB ← 통째로 ${Math.round(fullSize / 1024)}KB)`);

  // 연결부가 대화를 다시 보냄(압축·되감기 등): 브리지가 마지막으로 준 것과 견줘 바뀐 것만
  feeds[A].messages.push(msg(`${A}-new`, "새 답입니다"));
  let from = app.got.length;
  feeds[A].broadcast();
  s = await app.wait(isSnap, 3000, from);
  ok(s && s.m.d.delta && s.m.d.messages.length === 1 && s.m.d.messages[0].id === `${A}-new` && s.m.d.hashes.length === 51, `연결부가 다시 보낸 대화도 새것만(${s?.m.d.messages.map((m) => m.id).join(",")})`);

  // 탭 고르기에 지문을 실음: 그 탭은 없는 것만, 안내 글은 그대로
  from = app.got.length;
  app.send({ type: "select-window", index: 1, key: B, have: hashesOf(B).slice(0, 29) });
  s = await app.wait((m) => isSnap(m) && m.d.key === B, 5000, from);
  ok(s && s.m.d.delta && s.m.d.messages.length === 1 && s.m.d.notice === "연결부를 새로 켰어요", `고른 탭은 없는 1개만·안내 글은 그대로(${s?.m.d.messages.length}개, ${s?.m.d.notice})`);

  // 다시 통째로
  from = app.got.length;
  app.send({ type: "chat-resync", key: B });
  s = await app.wait(isSnap, 3000, from);
  ok(s && !s.m.d.delta && s.m.d.messages.length === 30, `다시 통째로 청하면 통째로(${s?.m.d.messages.length}개)`);

  // 미리 받기
  const bg = async (o) => {
    const n = app.got.length;
    app.send({ type: "chat-prefetch", ...o });
    return (await app.wait((m) => m.type === "chat-bg", 6000, n))?.m;
  };
  let r = await bg({ key: A, have: hashesOf(A) });
  ok(r && r.key === A && r.d?.delta && r.d.messages.length === 0 && r.d.hashes.length === 51, `미리 받기: 다 가졌으면 지문만(${r?.d?.messages.length}개)`);
  r = await bg({ key: A });
  ok(r && r.d && !r.d.delta && r.d.messages.length === 51, `미리 받기: 처음이면 통째로(${r?.d?.messages.length}개)`);
  r = await bg({ key: C, have: [] });
  ok(r && r.key === C && r.unavailable === true && !r.d, `연결부가 없는 탭은 '없음'(${JSON.stringify(r)})`);
  r = await bg({ key: "%99999", have: [] });
  ok(r && r.error === "no-tab" && !r.d, `이 세션의 탭이 아닌 칸은 거절(${JSON.stringify(r)})`);
  const n = app.got.length;
  app.send({ type: "chat-prefetch", key: "../../etc", have: [] });
  await sleep(500);
  ok(!app.got.slice(n).some((g) => g.m.type === "chat-bg"), "칸 번호 모양이 아니면 아무것도 하지 않음");
  const conns = feeds[B].conns;
  r = await bg({ key: B, have: [] });
  ok(r && r.d?.notice === "연결부를 새로 켰어요" && feeds[B].conns === conns + 1 && feeds[B].clients.size === 1, `미리 받은 탭의 연결은 바로 끊음·안내 글은 그대로(붙어 있는 것 ${feeds[B].clients.size}개: 지금 보는 탭 것만)`);
  app.ws.close();

  // 새 앱이 가진 지문을 알리지 않으면 1.5초 뒤 통째로(앱이 막 깨어나 첫 메시지가 늦어도 멈추지 않게)
  tm("select-window", "-t", `${S}:0`);
  app = await connect("&chat=2");
  s = await app.wait(isSnap, 4000);
  ok(s && !s.m.d.delta && s.m.d.messages.length === 51 && s.at - app.opened >= 1300, `알리지 않으면 1.5초 뒤 통째로(${s ? s.at - app.opened : "?"}ms)`);
  app.ws.close();
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  bridge.kill();
  for (const f of Object.values(feeds)) f.server.close();
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
