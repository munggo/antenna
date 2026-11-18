// 사용량 조회에 쓰는 로그인(토큰)을 얻는다. 만료가 가까우면 pi 가 요청을 보낼 때 쓰는 함수로 갱신한다.
//
// 왜: Fable 같은 모델별 한도는 사용량 조회(/api/oauth/usage)로만 알 수 있고, 그 조회는 정식 로그인(프로필 권한)이 있어야 한다.
//  - 개인 계정: pi 의 로그인(~/.pi/agent/auth.json)을 읽어 썼는데, 갱신은 pi 가 요청을 보낼 때만 일어난다. pi 를 며칠 쓰지 않으면
//    만료돼 조회가 끊겼다(2026-11-14 ~ 11-18: 3일 넘게). 그래서 브리지가 조회 전에 스스로 갱신한다.
//  - 회사 계정: Claude Code·pi 가 쓰는 회사 토큰은 `claude setup-token` 의 장기 토큰이라 추론 권한뿐이다(조회 불가).
//    조회 전용으로 정식 로그인을 하나 더 받아 둔다(deploy/usage-login.mjs → ~/.config/pi-remote/usage-auth.json).
//
// 갱신은 pi-ai 의 refreshStoredOAuthCredential 을 그대로 부른다: 로그인 파일을 잠근 채 다시 확인하고 갱신·저장하므로
// pi 와 브리지가 동시에 해도 한 번만 일어난다(갱신하면 예전 갱신 토큰은 못 쓰게 되므로 따로 구현하면 pi 의 로그인이 깨질 수 있다).
// pi 가 깔려 있지 않거나 그 함수를 찾지 못하면 갱신 없이 전처럼 읽기만 한다. 토큰 값은 어디에도 찍지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PI_AUTH_FILE = `${process.env.HOME}/.pi/agent/auth.json`;
/** 조회 전용 로그인을 두는 파일(본인만 읽기). 설정 폴더는 브리지의 설정 파일(PI_REMOTE_ENV) 옆 */
export const USAGE_AUTH_FILE = process.env.PI_REMOTE_USAGE_AUTH_FILE
  || join(process.env.PI_REMOTE_ENV ? dirname(process.env.PI_REMOTE_ENV) : `${process.env.HOME}/.config/pi-remote`, "usage-auth.json");
/** 만료까지 이만큼 남지 않았으면 갱신한다(pi 와 같은 5분) */
export const REFRESH_MARGIN_MS = 5 * 60_000;

/** pi 패키지 안에서 pi-ai 가 놓이는 자리(안쪽에 따로 깔리거나, 바깥으로 올려 깔리거나) */
const piAiDirs = (piPkg) => [join(piPkg, "node_modules/@earendil-works/pi-ai"), join(piPkg, "../pi-ai")];

const piAuthCache = new Map();   // pi 패키지 경로 → 불러온 것(또는 null)
/**
 * pi 의 로그인 저장소와 갱신 함수를 불러온다. → { AuthStorage, refreshStoredOAuthCredential, anthropicOAuth } | null
 * (패키지가 내보내는 이름이 아니라 안쪽 파일이라 pi 가 바뀌면 못 찾을 수 있다. 그때는 null: 갱신 없이 읽기만)
 */
export async function loadPiAuth(piPkg) {
  if (!piPkg) return null;
  if (piAuthCache.has(piPkg)) return piAuthCache.get(piPkg);
  let found = null;
  try {
    const ai = piAiDirs(piPkg).find((d) => existsSync(join(d, "dist/auth/resolve.js")));
    if (ai && existsSync(join(piPkg, "dist/core/auth-storage.js"))) {
      const [storage, resolve, oauth] = await Promise.all([
        import(join(piPkg, "dist/core/auth-storage.js")),
        import(join(ai, "dist/auth/resolve.js")),
        import(join(ai, "dist/auth/oauth/anthropic.js")),
      ]);
      if (storage.AuthStorage?.create && typeof resolve.refreshStoredOAuthCredential === "function" && typeof oauth.anthropicOAuth?.refresh === "function") {
        found = { AuthStorage: storage.AuthStorage, refreshStoredOAuthCredential: resolve.refreshStoredOAuthCredential, anthropicOAuth: oauth.anthropicOAuth };
      }
    }
  } catch {
    found = null;
  }
  piAuthCache.set(piPkg, found);
  return found;
}

/** 로그인 파일에서 그 계정 항목만 읽는다(없거나 깨졌으면 undefined) */
export function readCredential(file, provider) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))[provider];
  } catch {
    return undefined;
  }
}

/**
 * 사용량 조회에 쓸 토큰. 만료가 가까우면(REFRESH_MARGIN_MS) 갱신한다.
 * → { token, refreshed } | { error: "none" | "expired" | "refresh-failed", detail? }
 *   none: 그 계정의 정식 로그인이 없음 · expired: 만료됐는데 갱신할 수단이 없음(pi 를 못 불러옴) · refresh-failed: 갱신 실패
 * pi: loadPiAuth 의 결과(없으면 갱신하지 않음). 시험에서는 가짜를 넣는다
 */
export async function usageToken({ file, provider, pi, now = Date.now, marginMs = REFRESH_MARGIN_MS, timeoutMs = 25_000 }) {
  const stored = readCredential(file, provider);
  if (!stored || stored.type !== "oauth" || !stored.access) return { error: "none" };
  const expiresSoon = (c) => typeof c.expires === "number" && now() + marginMs >= c.expires;
  if (!expiresSoon(stored)) return { token: stored.access, refreshed: false };
  if (!pi) return stored.expires > now() ? { token: stored.access, refreshed: false } : { error: "expired" };
  try {
    const post = await pi.refreshStoredOAuthCredential(pi.AuthStorage.create(file), provider, pi.anthropicOAuth, expiresSoon, AbortSignal.timeout(timeoutMs));
    if (post?.access && !expiresSoon(post)) return { token: post.access, refreshed: post.access !== stored.access };
    return { error: "refresh-failed", detail: post ? "갱신했는데도 곧 만료되는 토큰" : "로그인이 없어짐" };
  } catch (e) {
    // 오류 글에 토큰이 섞이지 않게 종류만 남긴다(pi-ai 는 실패한 응답 본문을 오류 글에 넣는다)
    const cause = e?.cause instanceof Error ? e.cause : e;
    const kind = /invalid_grant|401|403/.test(String(cause?.message ?? "")) ? "로그인이 더는 유효하지 않음(다시 로그인 필요)" : String(e?.message ?? e).split(/[.;]/)[0].slice(0, 80);
    // 갱신은 실패했어도 아직 만료 전이면 그 토큰으로 조회는 된다
    if (stored.expires > now()) return { token: stored.access, refreshed: false, detail: kind };
    return { error: "refresh-failed", detail: kind };
  }
}
