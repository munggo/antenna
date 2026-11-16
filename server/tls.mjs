// 브리지의 연결 암호화(TLS).
// - 맥마다 자체 인증서를 한 번 만든다(맥에 딸린 openssl). 인증 기관이 없으므로, 짝짓기 QR 에 인증서 지문을 담아
//   폰이 "그 지문의 맥"만 믿게 한다(지문 고정). 같은 망의 다른 기기가 엿보거나 맥인 척할 수 없다
// - 포트는 하나로: 들어온 연결의 첫 바이트로 암호화 연결(TLS)인지 가려 알맞은 서버에 넘긴다.
//   예전 앱은 암호화 없이 붙으므로, 이행하는 동안은 둘 다 받을 수 있다(allowPlain)
// 작성: 서문교
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";

/** 인증서(PEM)의 지문: DER 의 SHA-256, 16진수 소문자 64자 */
export const fingerprintOf = (certPem) => new X509Certificate(certPem).fingerprint256.replace(/:/g, "").toLowerCase();

/**
 * 인증서를 읽거나(있으면) 만든다 → { key, cert, fingerprint }. 만들지 못하면 null(그때는 암호화 없이만 열 수 있음)
 * dir: 인증서를 둘 폴더(기본 ~/.config/pi-remote/tls). 개인 키는 나만 읽을 수 있게(600)
 */
export function ensureCert(dir, openssl = "/usr/bin/openssl") {
  const keyFile = join(dir, "key.pem"), certFile = join(dir, "cert.pem");
  const load = () => {
    const key = readFileSync(keyFile, "utf8"), cert = readFileSync(certFile, "utf8");
    return { key, cert, fingerprint: fingerprintOf(cert) };
  };
  try {
    if (existsSync(keyFile) && existsSync(certFile)) return load();
  } catch {
    /* 깨진 파일: 아래에서 새로 만듦 */
  }
  // 만드는 동안 새 파일은 나만 읽을 수 있게(openssl 이 만드는 개인 키 파일 포함)
  const oldMask = process.umask(0o077);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    rmSync(keyFile, { force: true });
    rmSync(certFile, { force: true });
    const opt = { stdio: ["ignore", "ignore", "ignore"], timeout: 20000 };
    execFileSync(openssl, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyFile], opt);
    chmodSync(keyFile, 0o600);
    execFileSync(openssl, ["req", "-new", "-x509", "-key", keyFile, "-out", certFile, "-days", "3650", "-subj", "/CN=Antenna bridge"], opt);
    return load();
  } catch {
    return null;
  } finally {
    process.umask(oldMask);
  }
}

/**
 * 포트 하나에서 암호화 연결과 (허용하면) 암호화 없는 연결을 함께 받는다.
 * onUpgrade(req, socket, head): WebSocket 으로 바꾸자는 요청. req.socket.encrypted 가 true 면 암호화 연결
 * → net.Server (listen 은 부르는 쪽이 한다)
 */
export function createDualServer({ tls = null, allowPlain = true, onUpgrade }) {
  // WebSocket 이 아닌 보통 요청에는 쓸 것이 없다
  const refuse = (_req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("WebSocket 으로만 붙을 수 있어요\n");
  };
  const plain = allowPlain ? http.createServer(refuse) : null;
  const secure = tls ? https.createServer({ key: tls.key, cert: tls.cert }, refuse) : null;
  for (const s of [plain, secure]) {
    if (!s) continue;
    s.on("upgrade", onUpgrade);
    s.on("clientError", (_e, socket) => socket.destroy());
    s.on("tlsClientError", (_e, socket) => socket.destroy());
  }
  return net.createServer((socket) => {
    socket.on("error", () => { /* 붙다 끊긴 연결 */ });
    socket.once("readable", () => {
      const first = socket.read(1);
      if (!first) return void socket.destroy();
      socket.unshift(first);
      // TLS 는 0x16(handshake)으로 시작한다. 보통 글(HTTP)은 영문자로 시작
      const target = first[0] === 0x16 ? secure : plain;
      if (!target) return void socket.destroy();
      target.emit("connection", socket);
    });
  });
}
