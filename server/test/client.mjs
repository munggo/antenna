// 브리지 서버 검증용 테스트 클라이언트.
// 접속 → resize 전송 → 키 입력 전송 → 들어오는 터미널 바이트를 잠깐 출력하고 종료.
//
// 사용: PI_REMOTE_TOKEN=... PORT=8787 SESSION=bridge-test node test/client.mjs "echo hello\r"

import WebSocket from "ws";

const TOKEN = process.env.PI_REMOTE_TOKEN;
const PORT = process.env.PORT || "8787";
const HOST = process.env.HOST || "127.0.0.1";
const SEND = process.argv[2] || "echo pi-remote-ok\r";
const WAIT_MS = parseInt(process.env.WAIT_MS || "1500", 10);

if (!TOKEN) {
  console.error("PI_REMOTE_TOKEN 필요");
  process.exit(1);
}

const url = `ws://${HOST}:${PORT}/?token=${encodeURIComponent(TOKEN)}&cols=80&rows=24`;
const ws = new WebSocket(url);
let received = Buffer.alloc(0);

ws.on("open", () => {
  console.error("[test] 연결됨");
  ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));
  setTimeout(() => ws.send(Buffer.from(SEND, "utf8")), 300);
  setTimeout(() => {
    console.error(`[test] 수신 ${received.length} bytes`);
    const text = received.toString("utf8");
    console.error("[test] ---- 수신 내용(가시화) ----");
    console.error(JSON.stringify(text.slice(-400)));
    const ok = text.includes("pi-remote-ok") || received.length > 0;
    console.error(ok ? "[test] PASS: 바이트 수신 확인" : "[test] FAIL: 수신 없음");
    ws.close();
    process.exit(ok ? 0 : 1);
  }, WAIT_MS);
});

ws.on("message", (data) => {
  received = Buffer.concat([received, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
});

ws.on("close", (code) => console.error(`[test] 닫힘 code=${code}`));
ws.on("error", (err) => {
  console.error("[test] 오류:", err.message);
  process.exit(1);
});
