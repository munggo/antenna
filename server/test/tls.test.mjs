// 연결 암호화 시험(server/tls.mjs): 인증서 만들기·지문, 포트 하나에서 암호화 연결과 암호화 없는 연결 가려 받기
// 임시 폴더와 임시 포트(8791)만 쓴다. 실행: node server/test/tls.test.mjs
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDualServer, ensureCert, fingerprintOf } from "../tls.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const { WebSocket, WebSocketServer } = createRequire(join(SERVER, "package.json"))("ws");
const D = mkdtempSync(join(tmpdir(), "antenna-tls-"));
const PORT = 8791;
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const mode = (f) => (statSync(f).mode & 0o777).toString(8);

/** 서버를 열고 붙어 본 결과들을 돌려준다 */
const withServer = async (opt, fn) => {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws, req) => ws.send(req.socket.encrypted ? "암호화" : "평문"));
  const server = createDualServer({ ...opt, onUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)) });
  await new Promise((res) => server.listen(PORT, "127.0.0.1", res));
  try { return await fn(); } finally { await new Promise((res) => { for (const c of wss.clients) c.terminate(); server.close(res); }); }
};
/** 붙어서 첫 글을 받음 → { text, fp(서버 인증서 지문) } 또는 { error } */
const dial = (url, opts = {}) => new Promise((res) => {
  const ws = new WebSocket(url, opts);
  let fp = null;
  ws.on("upgrade", (r) => { fp = r.socket.getPeerCertificate?.()?.fingerprint256?.replace(/:/g, "").toLowerCase() ?? null; });
  ws.on("message", (d) => { res({ text: String(d), fp }); ws.close(); });
  ws.on("error", (e) => res({ error: e.code ?? e.message }));
  ws.on("close", () => res({ error: "닫힘" }));
  setTimeout(() => res({ error: "답 없음" }), 4000);
});

try {
  // ── 인증서 ──
  const dir = join(D, "tls");
  const a = ensureCert(dir);
  ok(Boolean(a) && /^[0-9a-f]{64}$/.test(a.fingerprint) && a.key.includes("PRIVATE KEY") && a.cert.includes("BEGIN CERTIFICATE"), "인증서를 만들고 지문(16진수 64자)을 냄");
  ok(mode(join(dir, "key.pem")) === "600" && mode(dir) === "700", `개인 키는 나만 읽을 수 있음(파일 ${mode(join(dir, "key.pem"))}, 폴더 ${mode(dir)})`);
  ok(fingerprintOf(a.cert) === a.fingerprint && ensureCert(dir).fingerprint === a.fingerprint, "다시 불러도 같은 인증서(새로 만들지 않음)");
  writeFileSync(join(dir, "cert.pem"), "깨진 인증서");
  const b = ensureCert(dir);
  ok(Boolean(b) && b.fingerprint !== a.fingerprint && fingerprintOf(readFileSync(join(dir, "cert.pem"), "utf8")) === b.fingerprint, "인증서 파일이 깨져 있으면 새로 만듦");
  ok(ensureCert(join(D, "none"), join(D, "no-such-openssl")) === null, "openssl 이 없으면 만들지 못했다고 알림(죽지 않음)");

  // ── 포트 하나에서 가려 받기 ──
  const trust = { ca: b.cert, checkServerIdentity: () => undefined };   // 이 인증서만 믿음(폰의 지문 고정과 같은 뜻)
  await withServer({ tls: b, allowPlain: true }, async () => {
    const s = await dial(`wss://127.0.0.1:${PORT}/`, trust);
    ok(s.text === "암호화" && s.fp === b.fingerprint, "암호화 연결로 붙고, 서버가 내민 인증서의 지문이 맥의 지문과 같음");
    const p = await dial(`ws://127.0.0.1:${PORT}/`);
    ok(p.text === "평문", "같은 포트로 암호화 없는 연결도 받음(예전 앱)");
    const strict = await dial(`wss://127.0.0.1:${PORT}/`);
    ok(Boolean(strict.error), `인증서를 믿지 않는 쪽은 붙지 못함(${strict.error})`);
    const other = ensureCert(join(D, "other"));
    const wrong = await dial(`wss://127.0.0.1:${PORT}/`, { ca: other.cert, checkServerIdentity: () => undefined });
    ok(Boolean(wrong.error), `다른 인증서를 믿는 쪽은 붙지 못함(${wrong.error})`);
    const status = await new Promise((res) => http.get(`http://127.0.0.1:${PORT}/`, (r) => { r.resume(); res(r.statusCode); }).on("error", () => res(0)));
    ok(status === 426, `WebSocket 이 아닌 보통 요청은 받지 않음(${status})`);
  });
  await withServer({ tls: b, allowPlain: false }, async () => {
    ok((await dial(`wss://127.0.0.1:${PORT}/`, trust)).text === "암호화", "암호화 연결만 받게 하면: 암호화 연결은 붙음");
    ok(Boolean((await dial(`ws://127.0.0.1:${PORT}/`)).error), "암호화 연결만 받게 하면: 암호화 없는 연결은 끊음");
  });
  await withServer({ tls: null, allowPlain: true }, async () => {
    ok((await dial(`ws://127.0.0.1:${PORT}/`)).text === "평문" && Boolean((await dial(`wss://127.0.0.1:${PORT}/`, trust)).error), "인증서가 없으면 암호화 없는 연결만");
  });
} catch (e) {
  ok(false, `시험 중 오류: ${e.stack ?? e.message}`);
} finally {
  rmSync(D, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
