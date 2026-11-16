// 폰 알림(Apple 푸시). 맥 브리지가 Apple 푸시 서버(APNs)로 직접 보낸다(따로 서버 없음).
// - 폰 앱이 기기 주소(device token)를 등록하면 ~/.config/pi-remote/push.json 에 보관
// - pi 확장은 로컬 소켓(notify-<tmux세션>.sock)으로 알림을 요청
// 설정(~/.config/pi-remote/env): PI_REMOTE_APNS_KEY(.p8 경로), PI_REMOTE_APNS_KEY_ID, PI_REMOTE_APNS_TEAM, PI_REMOTE_APNS_TOPIC
import http2 from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

const KEY_PATH = process.env.PI_REMOTE_APNS_KEY || "";
const KEY_ID = process.env.PI_REMOTE_APNS_KEY_ID || "";
const TEAM = process.env.PI_REMOTE_APNS_TEAM || "";
const TOPIC = process.env.PI_REMOTE_APNS_TOPIC || "com.munggo.piremote";
const STORE = process.env.PI_REMOTE_PUSH_FILE || `${process.env.HOME}/.config/pi-remote/push.json`;

export const pushEnabled = !!(KEY_PATH && KEY_ID && TEAM && existsSync(KEY_PATH));

// done: 작업이 끝났을 때도 알림(질문·승인·확인 창은 항상), doneMinSec: 이보다 오래 걸린 작업만(기본 1시간, 사용자가 정함)
// live: 작업 표시(Live Activity) — start: 시작용 토큰들, acts: 탭(창 번호)마다 지금 떠 있는 표시의 갱신용 토큰
let store = { tokens: [], prefs: { done: true, doneMinSec: 3600 }, live: { start: [], acts: {} } };
try {
  const s = JSON.parse(readFileSync(STORE, "utf8"));
  store = { tokens: s.tokens ?? [], prefs: { ...store.prefs, ...(s.prefs ?? {}) }, live: { start: s.live?.start ?? [], acts: s.live?.acts ?? {} } };
} catch {
  /* 처음이면 빈 목록 */
}
const save = () => {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(store, null, 2));
  chmodSync(STORE, 0o600);
};

/** 폰이 보낸 기기 주소 등록(같은 주소는 갱신, 최근 5대만) */
export function registerToken(token, env) {
  if (typeof token !== "string" || !/^[0-9a-f]{64,200}$/i.test(token)) return false;
  store.tokens = store.tokens.filter((t) => t.token !== token);
  store.tokens.push({ token, env: env === "production" ? "production" : "sandbox", updatedAt: Date.now() });
  store.tokens = store.tokens.slice(-5);
  save();
  return true;
}
export function setPrefs(p) {
  if (typeof p?.done === "boolean") store.prefs.done = p.done;
  if (Number.isFinite(p?.doneMinSec) && p.doneMinSec >= 0) store.prefs.doneMinSec = p.doneMinSec;
  save();
}
export const getPrefs = () => ({ ...store.prefs });

/** 보낼 알림인지: 작업 끝은 꺼져 있거나 기준(doneMinSec)보다 짧게 걸렸으면 보내지 않는다(걸린 시간을 모르면 짧은 것으로) */
export function shouldNotify(kind, durationSec, prefs = store.prefs, background = false) {
  if (kind !== "done") return true;
  if (prefs.done === false) return false;
  if (background) return true;   // 백그라운드 탭(/bgtab) 작업은 걸린 시간과 상관없이(사용자 결정 11-12)
  return Number(durationSec) >= (prefs.doneMinSec ?? 3600);
}

// Apple 푸시 인증 토큰(ES256 JWT). 20~60분 사이에 새로 만들어야 해서 40분마다
let jwt = { value: "", at: 0 };
function providerToken() {
  if (jwt.value && Date.now() - jwt.at < 40 * 60_000) return jwt.value;
  const b64 = (x) => Buffer.from(x).toString("base64url");
  const head = b64(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
  const body = b64(JSON.stringify({ iss: TEAM, iat: Math.floor(Date.now() / 1000) }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), {
    key: createPrivateKey(readFileSync(KEY_PATH, "utf8")),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  jwt = { value: `${head}.${body}.${sig}`, at: Date.now() };
  return jwt.value;
}

const conns = {};
function conn(env) {
  const c = conns[env];
  if (c && !c.closed && !c.destroyed) return c;
  const host = env === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const n = http2.connect(host);
  n.on("error", () => {});
  n.on("goaway", () => n.close());
  n.setTimeout(10 * 60_000, () => n.close());   // 오래 놀면 닫음(다음 알림 때 다시 연결)
  conns[env] = n;
  return n;
}

function sendOne(t, payload, { collapseId, pushType = "alert", topic = TOPIC, priority = "10" } = {}) {
  return new Promise((resolve) => {
    let req;
    try {
      req = conn(t.env).request({
        ":method": "POST",
        ":path": `/3/device/${t.token}`,
        authorization: `bearer ${providerToken()}`,
        "apns-topic": topic,
        "apns-push-type": pushType,
        "apns-priority": priority,
        ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
      });
    } catch (e) {
      resolve({ status: 0, reason: String(e?.message ?? e) });
      return;
    }
    let status = 0;
    let data = "";
    req.setTimeout(15_000, () => {
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

/**
 * 등록된 모든 기기에 알림.
 * kind: approval(승인) | prompt(확인 창) | choice(고르는 질문) | question(질문) | done(작업 끝) | error(멈춤) | test
 */
export async function notify({ title, subtitle, body, kind = "done", window, durationSec, background = false }) {
  if (!shouldNotify(kind, durationSec, store.prefs, background === true)) return [];
  // 시험: Apple 로 보내지 않고 기록만(PI_REMOTE_PUSH_DRYRUN=1)
  if (process.env.PI_REMOTE_PUSH_DRYRUN === "1") {
    console.log(`[pi-remote] 알림(시험·안 보냄) ${kind} 탭 ${window} · ${title ?? ""}`);
    return [];
  }
  if (!pushEnabled || !store.tokens.length) return [];
  const urgent = kind === "approval" || kind === "prompt" || kind === "choice";
  const payload = {
    aps: {
      alert: { title: String(title ?? "pi"), ...(subtitle ? { subtitle: String(subtitle) } : {}), body: String(body ?? "") },
      sound: "default",
      "thread-id": `pi-${window ?? ""}`,
      // 승인·확인 창은 집중 모드에서도 보이게(앱에 시간 민감 알림 권한이 있을 때)
      "interruption-level": urgent ? "time-sensitive" : "active",
    },
    kind,
    window: Number.isInteger(window) ? window : null,
  };
  const results = [];
  for (const t of [...store.tokens]) {
    const r = await sendOne(t, payload);
    results.push(r);
    if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "Unregistered") {
      store.tokens = store.tokens.filter((x) => x.token !== t.token);   // 더 이상 없는 기기
      save();
    }
  }
  console.log(`[pi-remote] 알림(${kind}) ${results.map((r) => r.status || r.reason).join(",")}`);
  return results;
}

// --- 작업 표시(Live Activity: 잠금 화면·다이내믹 아일랜드, macOS 26 메뉴 막대) ---
// 피드 확장이 30초 넘게 일하면 start, 하는 일이 바뀌면 update(20초 간격), 끝나면 end 를 알림 소켓으로 보낸다.
const LIVE_TOPIC = `${TOPIC}.push-type.liveactivity`;
let liveSend = (t, payload, opts) => sendOne(t, payload, opts);
/** 알림을 보내기 전에 물어볼 곳(브리지: 맥이 안 잠겼고 10분 안에 썼으면 false 로 보류) */
let notifyGate = null;
export function setNotifyGate(fn) {
  notifyGate = fn;
}

/** 시험용: Apple 로 보내지 않고 가로채기 */
export function setLiveSenderForTest(fn) {
  liveSend = fn;
}
const LIVE_STALE_SEC = 3600;     // 갱신이 1시간 없으면 '오래됨'으로
const LIVE_DISMISS_SEC = 300;    // 끝나고 5분 뒤 사라짐(사용자가 고른 값)
const isHex = (t) => typeof t === "string" && /^[0-9a-f]{32,300}$/i.test(t);
const envOf = (e) => (e === "production" ? "production" : "sandbox");

/** 앱이 보낸 시작용 토큰(iOS 17.2+, 앱이 꺼져 있어도 띄울 수 있음) */
export function registerLiveStart(token, env) {
  if (!isHex(token)) return false;
  store.live.start = store.live.start.filter((t) => t.token !== token);
  store.live.start.push({ token, env: envOf(env), updatedAt: Date.now() });
  store.live.start = store.live.start.slice(-3);
  save();
  return true;
}

/** 앱이 보낸, 띄워진 표시의 갱신용 토큰(창 번호별) */
export function registerActivity(window, token, env) {
  if (!Number.isInteger(window) || !isHex(token)) return false;
  store.live.acts[window] = { ...(store.live.acts[window] ?? {}), token, env: envOf(env), at: Date.now() };
  save();
  return true;
}

/** Apple 푸시 내용(시험용으로 내보냄). content-state·attributes 키는 앱의 PiWorkAttributes 와 같아야 함 */
export function livePayload(event, { window, tabName, state, now = Math.floor(Date.now() / 1000) }) {
  const aps = { timestamp: now, event, "content-state": state };
  if (event === "start") {
    aps["attributes-type"] = "PiWorkAttributes";
    aps.attributes = { window, tabName };
    aps.alert = { title: tabName, body: `작업 중 · ${state.detail}` };   // 시작 때만 필요(소리 없음)
  }
  if (event !== "end") aps["stale-date"] = now + LIVE_STALE_SEC;
  else aps["dismissal-date"] = now + LIVE_DISMISS_SEC;
  return { aps };
}

/** 피드 확장이 보낸 작업 표시 신호 처리 */
export async function liveActivity({ event, window, tabName = "pi", status = "working", detail = "", startedAt }) {
  if (!pushEnabled || !Number.isInteger(window) || !["start", "update", "end"].includes(event)) return [];
  const now = Math.floor(Date.now() / 1000);
  const state = { status: String(status), detail: String(detail).slice(0, 120), startedAt: Number(startedAt) || now, endedAt: event === "end" ? now : null };
  const cur = store.live.acts[window];
  const opts = (priority) => ({ pushType: "liveactivity", topic: LIVE_TOPIC, priority });
  const results = [];
  let ev = event;
  // 이미 떠 있는 표시(토큰 있음)에 다시 시작이 오면 새로 띄우지 않고 갱신
  if (ev === "start" && cur?.token && !cur.ended) ev = "update";
  if (ev === "start") {
    store.live.acts[window] = { token: null, env: null, at: Date.now(), ended: false };
    save();
    for (const t of [...store.live.start]) {
      const r = await liveSend(t, livePayload("start", { window, tabName: String(tabName), state, now }), opts("10"));
      results.push(r);
      if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "ExpiredToken") {
        store.live.start = store.live.start.filter((x) => x.token !== t.token);
        save();
      }
    }
  } else if (cur?.token) {
    const r = await liveSend(cur, livePayload(ev, { window, tabName: String(tabName), state, now }), opts(ev === "end" ? "10" : "5"));
    results.push(r);
    if (ev === "end" || r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "ExpiredToken") {
      delete store.live.acts[window];
      save();
    }
  } else {
    if (ev === "end" && cur) {
      delete store.live.acts[window];   // 갱신용 토큰을 못 받았으면 앱을 열 때 정리됨
      save();
    }
    console.log(`[pi-remote] 작업 표시(${ev}) 창 ${window}: 갱신용 토큰 없음`);
    return [];
  }
  console.log(`[pi-remote] 작업 표시(${ev}) 창 ${window}: ${results.map((r) => r.status || r.reason).join(",") || "보낼 곳 없음"}`);
  return results;
}

/** 확장이 알림을 요청하는 로컬 소켓(이 브리지가 맡은 tmux 세션 전용, 줄 단위 JSON) */
export function startNotifySocket(sockPath) {
  try {
    mkdirSync(dirname(sockPath), { recursive: true });
    if (existsSync(sockPath)) unlinkSync(sockPath);
  } catch {
    /* 이전 소켓 정리 실패는 아래 listen 에서 드러남 */
  }
  const srv = createServer((c) => {
    let buf = "";
    c.setEncoding("utf8");
    c.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.kind === "activity") void liveActivity(m);
          else if (!notifyGate || notifyGate(m) !== false) void notify(m);
        } catch {
          /* 잘못된 줄은 무시 */
        }
      }
    });
    c.on("error", () => {});
  });
  srv.on("error", (e) => console.warn(`[pi-remote] 알림 소켓 오류: ${e.message}`));
  srv.listen(sockPath, () => {
    try {
      chmodSync(sockPath, 0o600);
    } catch {
      /* 권한 변경 실패는 무시 */
    }
  });
  return srv;
}
