// 짝짓기와 기기별 토큰을 시험 브리지로 확인: 코드로 짝짓기, 토큰으로 붙기, 토큰 바꾸기, 기기 끊기, 예전 공유 토큰에서 옮기기
// 가짜 홈·시험 세션(pairtest)·포트 8792 를 쓰고 끝나면 지운다. 쓰는 브리지와 쓰는 tmux 세션은 건드리지 않는다.
// 실행: node server/test/pairing.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeviceStore } from "../devices.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "pairtest", PORT = 8792, ROOT = `/tmp/antenna-pairing-${process.pid}`, HOME = `${ROOT}/home`, CONF = `${HOME}/.config/pi-remote`;
const SHARED = "c".repeat(64);   // 예전 방식의 공유 토큰
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const store = createDeviceStore(CONF);   // 맥의 짝짓기 명령이 하는 일(코드 만들기·기기 끊기)을 흉내
const mode = (f) => (statSync(f).mode & 0o777).toString(8);

let bridge = null, log = "", allLog = "", exited = null;
const start = async (shared, extra = {}) => {
  log = ""; exited = null;
  bridge = spawn(process.execPath, ["bridge.mjs"], {
    cwd: SERVER,
    env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, ...(shared ? { PI_REMOTE_TOKEN: shared } : {}),
      HOST: "127.0.0.1", PORT: String(PORT), PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_REVOKE_CHECK_MS: "400", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stdout.on("data", (d) => { log += d; allLog += d; });
  bridge.stderr.on("data", (d) => { log += d; allLog += d; });
  bridge.on("exit", (code) => (exited = code));
  for (let i = 0; i < 40 && !/브리지 시작/.test(log) && exited === null; i++) await sleep(250);
  return /브리지 시작/.test(log) && exited === null;
};
const stop = async () => { bridge?.kill("SIGTERM"); await sleep(500); };
/** 이 맥(시험 브리지)의 인증서만 믿는 연결 옵션: 폰이 QR 로 받은 지문의 맥만 믿는 것과 같은 뜻 */
const trust = () => ({ ca: readFileSync(`${CONF}/tls/cert.pem`, "utf8"), checkServerIdentity: () => undefined });
/** 붙어 보기 → { open, code(닫힌 까닭), windows(탭 목록을 받았는지), ws }. plain: 암호화 없이(예전 앱) */
const connect = (opt = {}) => new Promise((res) => {
  const q = opt.query ? `token=${opt.query}&` : "";
  const ws = new WebSocket(`${opt.plain ? "ws" : "wss"}://127.0.0.1:${PORT}/?${q}cols=80&rows=24`, { ...(opt.plain ? {} : trust()), ...(opt.header ? { headers: { Authorization: `Bearer ${opt.header}` } } : {}) });
  const out = { open: false, code: null, windows: false, ws, got: {} };
  const done = () => res(out);
  ws.on("open", () => { out.open = true; });
  ws.on("message", (d, bin) => { if (!bin) { try { const m = JSON.parse(String(d)); out.got[m.type] = m; if (m.type === "windows") { out.windows = true; done(); } } catch { /* 글 */ } } });
  ws.on("close", (code) => { out.code = code; done(); });
  ws.on("error", () => done());
  setTimeout(done, 5000);
});
/** 짝짓기 요청 → 브리지의 답. plain: 암호화 없이 */
const pair = (msg, plain = false) => new Promise((res) => {
  const ws = new WebSocket(`${plain ? "ws" : "wss"}://127.0.0.1:${PORT}/pair`, plain ? {} : trust());
  ws.on("open", () => { if (msg !== null) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); });
  ws.on("message", (d) => { try { res(JSON.parse(String(d))); } catch { res({}); } });
  ws.on("close", (code) => res({ closed: code }));
  ws.on("error", () => res({ error: true }));
  setTimeout(() => res({ timeout: true }), 12000);
});
const waitClose = (ws, ms) => new Promise((res) => { ws.on("close", (c) => res(c)); setTimeout(() => res(null), ms); });

mkdirSync(CONF, { recursive: true });
writeFileSync(`${CONF}/env`, `# 시험\nPI_REMOTE_TOKEN=${SHARED}\nPORT=${PORT}\n`, { mode: 0o600 });
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
try {
  ok(await start(SHARED), "예전 공유 토큰이 있는 브리지가 뜸");
  ok(/암호화 연결, 예전 앱용으로 암호화 없는 연결도/.test(log) && mode(`${CONF}/tls/key.pem`) === "600", "브리지가 인증서를 만들고(개인 키는 나만), 이행 기간에는 두 가지 연결을 모두 받음");
  // ── 예전 방식 그대로 ──
  let c = await connect({ query: SHARED, plain: true });
  ok(c.windows, "예전 앱처럼 암호화 없이, 공유 토큰을 주소 뒤에 붙여도 붙음(이행 기간)");
  c.ws.close();
  c = await connect({ query: "f".repeat(64), plain: true });
  ok(!c.windows && c.code === 4001, `틀린 토큰은 받지 않음(닫힌 까닭 ${c.code})`);
  c = await connect({});
  ok(!c.windows && c.code === 4001, "토큰 없이는 붙지 못함");
  const insecure = await pair({ type: "pair", code: "a".repeat(32), name: "폰" }, true);
  ok(insecure.type === "pair-failed" && insecure.reason === "insecure", "짝짓기는 암호화 연결로만 받음(코드와 새 토큰이 지나가는 길)");

  // ── 짝짓기 ──
  let p = await pair({ type: "pair", code: "a".repeat(32), name: "폰" });
  ok(p.type === "pair-failed" && p.reason === "invalid", "코드를 만든 적이 없으면 짝짓기 실패");
  const code = store.startPairing().code;
  p = await pair({ type: "pair", code: "b".repeat(32), name: "폰" });
  ok(p.type === "pair-failed" && p.reason === "invalid", "틀린 코드는 짝짓기 실패");
  p = await pair("이건 JSON 이 아님");
  ok(p.type === "pair-failed", "모양이 다른 요청은 짝짓기 실패");
  const mine = await pair({ type: "pair", code, name: "시험 iPhone" });
  ok(mine.type === "paired" && /^[0-9a-f]{64}$/.test(mine.token ?? "") && Boolean(mine.id), "맞는 코드를 내면 이 기기만의 토큰을 받음");
  p = await pair({ type: "pair", code, name: "따라 한 폰" });
  ok(p.type === "pair-failed", "같은 코드를 다시 내면 실패(한 번만)");
  ok(store.list().length === 1 && store.list()[0].name === "시험 iPhone", "맥에 기기 하나가 등록됨(이름 포함)");

  // ── 기기 토큰으로 붙기 ──
  c = await connect({ header: mine.token });
  ok(c.windows, "기기 토큰을 머리말(Authorization)로 보내, 암호화 연결로 붙음");
  const live = c.ws;
  let q = await connect({ query: mine.token, plain: true });
  ok(q.windows, "기기 토큰을 암호화 없이 주소 뒤에 붙여도 붙음(예전 앱이 옮겨 온 경우, 이행 기간)");
  q.ws.close();

  // ── 이 기기의 토큰만 바꾸기 ──
  const rotated = await new Promise((res) => {
    live.on("message", (d, bin) => { if (!bin) { try { const m = JSON.parse(String(d)); if (m.type === "token-rotated") res(m.token); } catch { /* 글 */ } } });
    live.send(JSON.stringify({ type: "rotate-token" }));
    setTimeout(() => res(null), 4000);
  });
  ok(/^[0-9a-f]{64}$/.test(rotated ?? "") && rotated !== mine.token, "토큰 바꾸기: 새 토큰을 받음");
  await sleep(300);
  ok(exited === null, "기기 토큰을 바꿀 때는 브리지가 다시 시작하지 않음");
  q = await connect({ header: mine.token });
  ok(!q.windows && q.code === 4001, "바꾸기 전의 토큰으로는 못 붙음");
  q = await connect({ header: rotated });
  ok(q.windows, "새 토큰으로 붙음");

  // ── 기기 끊기: 붙어 있던 연결도 닫힘 ──
  const closing = waitClose(q.ws, 4000);
  ok(store.revoke(mine.id).length === 1, "맥에서 그 기기를 끊음");
  ok((await closing) === 4003, "끊긴 기기의 열려 있던 연결이 닫힘");
  q = await connect({ header: rotated });
  ok(!q.windows && q.code === 4001, "끊긴 기기의 토큰으로는 다시 못 붙음");
  live.close();

  // ── 예전 공유 토큰으로 붙은 폰이 '토큰 새로 바꾸기' → 기기 토큰으로 옮기고 공유 토큰은 없앰 ──
  c = await connect({ query: SHARED, plain: true });
  const moved = await new Promise((res) => {
    c.ws.on("message", (d, bin) => { if (!bin) { try { const m = JSON.parse(String(d)); if (m.type === "token-rotated") res(m.token); } catch { /* 글 */ } } });
    c.ws.send(JSON.stringify({ type: "rotate-token" }));
    setTimeout(() => res(null), 4000);
  });
  ok(/^[0-9a-f]{64}$/.test(moved ?? "") && moved !== SHARED, "공유 토큰으로 붙은 폰: 이 폰만의 토큰을 받음");
  for (let i = 0; i < 20 && exited === null; i++) await sleep(250);
  ok(exited === 0, "공유 토큰을 없앤 뒤 브리지가 스스로 끝남(자동 실행이 다시 띄움)");
  const envNow = readFileSync(`${CONF}/env`, "utf8");
  ok(!/PI_REMOTE_TOKEN/.test(envNow) && envNow.includes(`PORT=${PORT}`) && envNow.startsWith("# 시험"), "설정 파일에서 공유 토큰 줄만 지워짐(다른 줄은 그대로)");

  // ── 공유 토큰 없이 다시 뜬 브리지 ──
  ok(await start(null), "공유 토큰이 없어도 브리지가 뜸");
  q = await connect({ query: SHARED, plain: true });
  ok(!q.windows && q.code === 4001, "없앤 공유 토큰으로는 못 붙음");
  q = await connect({ query: moved, plain: true });
  ok(q.windows, "옮겨 받은 기기 토큰으로 붙음(예전 앱처럼 암호화 없이 주소 뒤에 붙여도)");
  q.ws.close();

  // ── 되풀이해 틀리면 잠깐 받지 않음 ──
  let last = null;
  for (let i = 0; i < 13; i++) last = await connect({ query: "e".repeat(64), plain: true });
  ok(last.code === 4029, `틀린 토큰을 되풀이하면 잠깐 받지 않음(닫힌 까닭 ${last.code})`);

  // ── 암호화 연결만 받는 브리지(새 설치의 기본) ──
  await stop();
  ok(await start(null, { PI_REMOTE_TLS_ONLY: "1" }) && /암호화 연결만/.test(log), "암호화 연결만 받게 켠 브리지가 뜸");
  q = await connect({ header: moved });
  ok(q.windows, "암호화 연결로는 붙음");
  q.ws.close();
  q = await connect({ query: moved, plain: true });
  ok(!q.windows && q.code !== 4001, `암호화 없는 연결은 토큰이 맞아도 받지 않음(${q.code ?? "붙지 못함"})`);
  const all = allLog + readFileSync(`${CONF}/env`, "utf8");
  ok(/짝짓기: .* 기기 d[0-9a-f]{8} 등록/.test(allLog) && ![mine.token, rotated, moved, code, SHARED].some((x) => all.includes(x)), "브리지 기록에 짝짓기가 남되, 기록·설정 파일에 토큰·코드 원문은 남지 않음");
} catch (e) {
  ok(false, `시험 중 오류: ${e.stack ?? e.message}`);
} finally {
  await stop();
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
