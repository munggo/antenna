// Antenna 알림 중계: AWS Lambda 함수 주소 하나(상태 없음). 배포: sh relay/deploy.sh
// 왜: Apple 은 앱을 서명한 팀의 푸시 키로 보낸 알림만 전달한다. 팀원 맥의 브리지에는 그 키가 없어서, 브리지가 이 함수에 보내면
//     이 함수가 키로 Apple 에 넘긴다(브리지 설정에 자기 키 PI_REMOTE_APNS_* 가 있으면 지금처럼 직접 보냄).
// 알림 모양은 이 함수가 만든다(받은 글을 그대로 넘기지 않음):
// - 알림: 보이는 문구는 고정('새 알림'). 실제 제목·내용·탭은 브리지가 폰 공개 키로 잠근 암호문(e)으로만 실리고, 폰의 알림 확장이 푼다.
//   그래서 이 함수와 Apple 은 본문을 읽지 못하고, 기기 주소를 아는 사람도 남의 폰에 거짓 문구를 띄울 수 없다
// - 작업 표시(Live Activity): 알림 확장을 거치지 않아 잠글 수 없다 → 상태·시각·탭 번호만 싣는다
//   (탭 이름은 '탭 N', 진행 글은 비움. 사용자 결정 11-23 '상태만 보내기')
// 요청(POST JSON, 8KB 까지):
//   { v: 1, type: "alert", token, env, urgent, window, e: { k, b } }         e 가 없으면(예전 앱) 고정 문구만
//   { v: 1, type: "live", token, env, event: "start"|"update"|"end", window, state: { status, startedAt, endedAt } }
// 응답: { status, reason } — Apple 의 결과(410·BadDeviceToken 이면 브리지가 그 기기를 지움). 요청이 틀리면 400 { error }
// 설정(환경 변수): APNS_KEY_ID, APNS_TEAM, APNS_TOPIC(앱 번들 ID), APNS_KEY_PARAM(Parameter Store 의 암호화 값 이름, .p8 내용).
//   로컬 시험은 APNS_KEY_PEM(.p8 내용)으로 대신할 수 있음
// 남용 막기: 함수 동시 실행 수를 배포 때 제한한다(deploy.sh). 알림 모양을 서버가 만들므로 보낼 수 있는 것은 위 두 가지뿐
// 작성: 서문교
import http2 from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

const STATUS = ["working", "asking", "done", "error", "stopped"];
const LIVE_STALE_SEC = 3600;     // 브리지(server/push.mjs)와 같은 값
const LIVE_DISMISS_SEC = 300;
const MAX_BODY = 8192;

const bad = (error) => ({ error });
const isB64 = (s, max) => typeof s === "string" && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
const isTime = (t, now) => Number.isFinite(t) && t > 0 && t < now + 86_400;

/** 요청 → Apple 로 보낼 것({ env, token, headers, payload }) 또는 { error }. 시험이 직접 부른다 */
export function buildPush(req, { topic, now = Math.floor(Date.now() / 1000) }) {
  if (!req || typeof req !== "object" || req.v !== 1) return bad("v");
  const { type, token, env } = req;
  if (typeof token !== "string" || !/^[0-9a-f]{64,200}$/i.test(token)) return bad("token");
  if (env !== "sandbox" && env !== "production") return bad("env");
  const window = req.window;
  if (window !== undefined && window !== null && !(Number.isInteger(window) && window >= 0 && window < 10_000)) return bad("window");
  if (type === "alert") {
    const e = req.e;
    if (e !== undefined && !(e && isB64(e.k, 44) && Buffer.from(e.k, "base64").length === 32 && isB64(e.b, 3000))) return bad("e");
    const payload = {
      aps: {
        alert: { title: "Antenna", body: "새 알림" },
        sound: "default",
        "thread-id": `pi-${Number.isInteger(window) ? window : ""}`,
        "interruption-level": req.urgent === true ? "time-sensitive" : "active",
        ...(e ? { "mutable-content": 1 } : {}),
      },
      ...(e ? { e: { k: e.k, b: e.b } } : {}),
    };
    return { env, token, headers: { "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10" }, payload };
  }
  if (type === "live") {
    const { event, state } = req;
    if (!["start", "update", "end"].includes(event)) return bad("event");
    if (!Number.isInteger(window)) return bad("window");
    if (!state || !STATUS.includes(state.status) || !isTime(state.startedAt, now)) return bad("state");
    if (state.endedAt != null && !isTime(state.endedAt, now)) return bad("state");
    const aps = {
      timestamp: now,
      event,
      "content-state": { status: state.status, detail: "", startedAt: state.startedAt, endedAt: event === "end" ? (state.endedAt ?? now) : null },
    };
    if (event === "start") {
      aps["attributes-type"] = "PiWorkAttributes";
      aps.attributes = { window, tabName: `탭 ${window}` };
      aps.alert = { title: "Antenna", body: "작업 중" };
    }
    if (event !== "end") aps["stale-date"] = now + LIVE_STALE_SEC;
    else aps["dismissal-date"] = now + LIVE_DISMISS_SEC;
    const priority = event === "update" ? "5" : "10";
    return { env, token, headers: { "apns-topic": `${topic}.push-type.liveactivity`, "apns-push-type": "liveactivity", "apns-priority": priority }, payload: { aps } };
  }
  return bad("type");
}

// ── Apple 로 보내기 ──
let keyPem = process.env.APNS_KEY_PEM || "";
async function loadKey() {
  if (keyPem) return keyPem;
  const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");   // Lambda 런타임에 들어 있음
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: process.env.APNS_KEY_PARAM, WithDecryption: true }));
  keyPem = r.Parameter.Value;
  return keyPem;
}
let jwt = { value: "", at: 0 };
async function providerToken() {
  if (jwt.value && Date.now() - jwt.at < 40 * 60_000) return jwt.value;   // Apple: 20~60분 사이에 새로
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${b64({ alg: "ES256", kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APNS_TEAM, iat: Math.floor(Date.now() / 1000) })}`;
  const sig = sign("sha256", Buffer.from(head), { key: createPrivateKey(await loadKey()), dsaEncoding: "ieee-p1363" }).toString("base64url");
  jwt = { value: `${head}.${sig}`, at: Date.now() };
  return jwt.value;
}
const conns = {};
function conn(env) {
  const c = conns[env];
  if (c && !c.closed && !c.destroyed) return c;
  const n = http2.connect(env === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
  n.on("error", () => {});
  n.on("goaway", () => n.close());
  conns[env] = n;
  return n;
}
async function sendApns({ env, token, headers, payload }) {
  let auth;
  try {
    auth = await providerToken();
  } catch (e) {
    console.log(`푸시 키를 읽지 못함: ${e?.name ?? e}`);   // 키를 아직 올리지 않았거나 권한 없음(내용은 남기지 않음)
    return { status: 0, reason: "no-key" };
  }
  return new Promise((resolve) => {
    let req;
    try {
      req = conn(env).request({ ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${auth}`, ...headers });
    } catch (e) {
      resolve({ status: 0, reason: String(e?.message ?? e) });
      return;
    }
    let status = 0;
    let data = "";
    req.setTimeout(10_000, () => {
      req.close();
      resolve({ status: 0, reason: "timeout" });
    });
    req.on("response", (h) => (status = h[":status"]));
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      let reason = "";
      try {
        reason = JSON.parse(data).reason;
      } catch {
        /* 성공이면 본문 없음 */
      }
      resolve({ status, reason });
    });
    req.on("error", (e) => resolve({ status: 0, reason: String(e?.message ?? e) }));
    req.end(JSON.stringify(payload));
  });
}
let send = sendApns;
/** 시험용: Apple 로 보내지 않고 가로채기 */
export function setSenderForTest(fn) {
  send = fn;
}

const reply = (statusCode, obj) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });

/** Lambda 함수 주소의 요청 */
export async function handler(event) {
  if (event?.requestContext?.http?.method !== "POST") return reply(405, { error: "method" });
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : String(event.body ?? "");
  if (raw.length > MAX_BODY) return reply(413, { error: "size" });
  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    return reply(400, { error: "json" });
  }
  const p = buildPush(req, { topic: process.env.APNS_TOPIC });
  if (p.error) return reply(400, p);
  const r = await send(p);
  console.log(JSON.stringify({ type: req.type, event: req.event, env: p.env, status: r.status, reason: r.reason }));   // 기기 주소·내용은 남기지 않음
  return reply(200, r);
}
