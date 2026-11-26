// 안드로이드 알림(구글 푸시 FCM) 시험: node server/test/fcm.test.mjs
// 구글로 보내지 않는다. 가짜 구글 인증 서버와 가짜 FCM 서버를 띄우고, 브리지의 알림 모듈이 실제 HTTP 로 보내는 것을 받아 본다.
// 1) 서비스 계정 키로 서명한 인증 요청(JWT)이 맞는지  2) 보내는 메시지 모양(데이터 메시지, 값은 모두 글, 높은 우선순위)
// 3) 접근 토큰을 다시 쓰는지  4) 없어진 기기(UNREGISTERED)는 지우는지  5) 키가 없는 쪽(아이폰 Apple 키)의 기기는 건너뛰는지
// 6) 안드로이드 토큰 모양 검사, 그 폰이 받을 길이 있는지(pushEnabledFor)
// 작성: 서문교
import { createServer } from "node:http";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const dir = mkdtempSync(join(tmpdir(), "antenna-fcm-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyFile = join(dir, "service-account.json");

// 가짜 구글: /token 은 접근 토큰, /v1/projects/<id>/messages:send 는 보내기
const seen = { tokens: [], sends: [] };
let unregistered = new Set();
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.url === "/token") {
      seen.tokens.push(Object.fromEntries(new URLSearchParams(body)));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: `access-${seen.tokens.length}`, expires_in: 3600, token_type: "Bearer" }));
      return;
    }
    seen.sends.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
    const tok = JSON.parse(body || "{}").message?.token;
    if (unregistered.has(tok)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: "projects/test-project/messages/1" }));
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

writeFileSync(keyFile, JSON.stringify({
  type: "service_account", project_id: "test-project", client_email: "antenna@example.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.googleapis.com/token",
}));

// 모듈은 불러올 때 설정을 읽으므로 먼저 정한다(Apple 키·중계는 없음)
process.env.PI_REMOTE_FCM_KEY = keyFile;
process.env.PI_REMOTE_FCM_TOKEN_URL = `${base}/token`;
process.env.PI_REMOTE_FCM_URL = base;
process.env.PI_REMOTE_PUSH_FILE = join(dir, "push.json");
process.env.PI_REMOTE_PUSH_RELAY = "";
delete process.env.PI_REMOTE_APNS_KEY;
delete process.env.PI_REMOTE_PUSH_DRYRUN;
const push = await import("../push.mjs");

ok(push.fcmEnabled && push.pushEnabled && push.pushMode === "", "키 파일이 있으면 안드로이드 알림이 켜지고, Apple 쪽은 꺼진 그대로");
ok(push.pushEnabledFor("fcm") === true && push.pushEnabledFor("apns") === false, "폰마다 받을 길이 있는지: 안드로이드 예, 아이폰 아니오");

// 6) 토큰 모양
const fcmTok = "dXy0aBcD:APA91bH" + "x".repeat(140);
ok(!push.registerToken("짧음", "", undefined, "fcm") && !push.registerToken("a b c d e f g h i j k l m n o", "", undefined, "fcm"), "안드로이드 토큰: 짧거나 빈칸이 든 것은 거절");
ok(push.registerToken(fcmTok, "", undefined, "fcm"), "안드로이드 토큰 등록");
ok(push.registerToken("ab".repeat(32), "sandbox"), "아이폰 토큰 등록(Apple 키가 없는 맥)");
const stored = JSON.parse(readFileSync(process.env.PI_REMOTE_PUSH_FILE, "utf8"));
ok(stored.tokens.some((t) => t.token === fcmTok && t.platform === "fcm") && stored.tokens.some((t) => !t.platform), "저장 파일에 안드로이드 표시와 함께 남음");

// 1)·2) 보내기
const r1 = await push.notify({ title: "승인 필요", subtitle: "메인 작업", body: "Slack 에 보낼까요?", kind: "approval", window: 3 });
ok(r1.length === 1 && r1[0].status === 200, "안드로이드 기기 하나에만 보냄(아이폰 기기는 Apple 키가 없어 건너뜀)");
const t0 = seen.tokens[0] ?? {};
const [h, p, s] = String(t0.assertion ?? "").split(".");
const claims = p ? JSON.parse(Buffer.from(p, "base64url").toString()) : {};
const head = h ? JSON.parse(Buffer.from(h, "base64url").toString()) : {};
const sigOk = s ? verify("sha256", Buffer.from(`${h}.${p}`), createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(s, "base64url")) : false;
ok(t0.grant_type === "urn:ietf:params:oauth:grant-type:jwt-bearer" && head.alg === "RS256" && sigOk, "인증 요청: JWT 를 서비스 계정 개인 키(RS256)로 서명");
ok(claims.iss === "antenna@example.com" && claims.scope === "https://www.googleapis.com/auth/firebase.messaging"
  && claims.aud === "https://oauth2.googleapis.com/token" && claims.exp - claims.iat === 3600, "인증 요청: 발급자·범위·받는 곳·1시간");
const s1 = seen.sends[0] ?? {};
const m = s1.body?.message ?? {};
ok(s1.url === "/v1/projects/test-project/messages:send" && s1.auth === "Bearer access-1", "보내기: 프로젝트 주소와 받은 접근 토큰");
ok(m.token === fcmTok && m.data?.title === "승인 필요" && m.data?.subtitle === "메인 작업" && m.data?.body === "Slack 에 보낼까요?"
  && m.data?.kind === "approval" && m.data?.window === "3", "메시지: 제목·부제·내용·종류·탭 번호");
ok(Object.values(m.data ?? {}).every((v) => typeof v === "string") && !m.notification && m.android?.priority === "HIGH" && m.android?.ttl === "3600s",
  "데이터 메시지(값은 모두 글, 알림 칸 없음), 높은 우선순위, 묻는 알림은 1시간만 살아 있음");

// 3) 접근 토큰 재사용, 끝남 알림은 하루
const r2 = await push.notify({ title: "끝났어요", body: "작업 끝", kind: "done", window: null, durationSec: 99999 });
const m2 = seen.sends[1]?.body?.message ?? {};
ok(r2[0]?.status === 200 && seen.tokens.length === 1 && seen.sends[1]?.auth === "Bearer access-1", "두 번째 알림은 받아 둔 접근 토큰을 다시 씀");
ok(m2.data?.window === "" && m2.android?.ttl === "86400s", "탭이 없는 알림은 빈 탭 번호, 끝남 알림은 하루 살아 있음");
const long = await push.notify({ title: "긴 글", body: "가".repeat(3000), kind: "question", window: 1 });
ok(long[0]?.status === 200 && Buffer.byteLength(seen.sends[2]?.body?.message?.data?.body ?? "") <= 2004, "긴 내용은 잘라서(FCM 4KB 한도 안)");

// 4) 없어진 기기
unregistered = new Set([fcmTok]);
const r3 = await push.notify({ title: "x", body: "y", kind: "approval", window: 1 });
const after = JSON.parse(readFileSync(process.env.PI_REMOTE_PUSH_FILE, "utf8"));
ok(r3[0]?.status === 404 && r3[0]?.reason === "UNREGISTERED" && !after.tokens.some((t) => t.token === fcmTok), "구글이 없는 기기라고 하면 그 토큰을 지움");
ok(after.tokens.some((t) => t.token === "ab".repeat(32)), "건너뛴 아이폰 기기는 그대로");

srv.close();
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}건` : "모두 통과");
process.exit(fail ? 1 : 0);
