#!/usr/bin/env node
/**
 * 올린 빌드를 TestFlight 외부 테스터 그룹(기본 '팀원')에 낸다: 애플 처리가 끝나기를 기다렸다가 '테스트할 내용'을 넣고,
 * 그룹에 넣고, 베타 심사에 낸다. 외부 그룹에는 올린 빌드가 저절로 들어가지 않는다(내부 그룹 '개발'은 저절로).
 * 그룹과 앱의 베타 정보(연락처·설명 등)는 처음 한 번 만들어 둔 것을 쓴다(11-17 에 만듦. 없으면 멈춤).
 * 팀원·애플 심사로 나가는 일이므로, 부르기 전에 받는 곳과 '테스트할 내용' 글을 사용자에게 확인받는다.
 * 쓰기: node deploy/testflight-group.mjs <빌드 번호> <테스트할 내용 파일> [그룹 이름]
 *       --dry-run  무엇을 할지만 보여 줌(아무것도 바꾸지 않음)
 * 키: ~/.appstoreconnect/config 의 ASC_KEY_ID·ASC_ISSUER_ID·ASC_KEY_PATH (testflight-setup.mjs 와 같은 키)
 * 작성: 서문교
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const DRY = process.argv.includes("--dry-run");
const [BUILD, NOTES_FILE, GROUP = "팀원"] = args;
if (!BUILD || !NOTES_FILE) {
  console.error("쓰기: node deploy/testflight-group.mjs <빌드 번호> <테스트할 내용 파일> [그룹 이름] [--dry-run]");
  process.exit(2);
}
const NOTES = readFileSync(NOTES_FILE, "utf8").trim();
const BUNDLE = "com.munggo.piremote";
const HOME = process.env.HOME;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conf = Object.fromEntries(readFileSync(`${HOME}/.appstoreconnect/config`, "utf8").split("\n")
  .map((l) => l.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*?)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const keyId = conf.ASC_KEY_ID;
const keyPath = (conf.ASC_KEY_PATH || `${HOME}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`).replace(/^~/, HOME);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: keyId, typ: "JWT" });
  const body = b64({ iss: conf.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(readFileSync(keyPath)), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}
async function api(path, method = "GET", body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = {};
  try {
    json = await r.json();
  } catch {
    /* 본문 없음 */
  }
  if (r.status >= 400) throw new Error(`${method} ${path.split("?")[0]} → ${r.status} ${(json.errors ?? []).map((e) => e.detail).join(" / ")}`);
  return json;
}
const change = async (what, fn) => {
  if (DRY) return console.log(`(하지 않음) ${what}`);
  await fn();
  console.log(what);
};

const app = (await api(`/v1/apps?filter[bundleId]=${BUNDLE}&fields[apps]=bundleId`)).data.find((a) => a.attributes.bundleId === BUNDLE);
if (!app) throw new Error(`App Store Connect 에 앱(${BUNDLE})이 없어요`);
const group = (await api(`/v1/apps/${app.id}/betaGroups?fields[betaGroups]=name,isInternalGroup&limit=50`)).data
  .find((g) => g.attributes.name === GROUP && !g.attributes.isInternalGroup);
if (!group) throw new Error(`외부 테스터 그룹 '${GROUP}' 이 없어요(App Store Connect 의 TestFlight 에서 만들어 둘 것)`);

// 애플 처리가 끝나기를 기다림(보통 5~15분, 길게는 40분까지)
let build;
for (let i = 0; ; i++) {
  build = (await api(`/v1/builds?filter[app]=${app.id}&filter[version]=${BUILD}&fields[builds]=version,processingState,expired,usesNonExemptEncryption&limit=5`)).data[0];
  const state = build?.attributes.processingState ?? "아직 안 보임";
  if (state === "VALID") break;
  if (state === "FAILED" || state === "INVALID") throw new Error(`빌드 ${BUILD} 처리 실패(${state})`);
  if (i >= 80) throw new Error(`빌드 ${BUILD} 가 40분이 지나도 처리 중(${state})`);
  if (i % 4 === 0) console.log(`애플 처리 기다리는 중(${state})…`);
  await sleep(30_000);
}
console.log(`빌드 ${BUILD}: 처리 끝`);

// '테스트할 내용': 앱의 베타 설명과 같은 언어로(이미 있으면 고침)
const appLocale = (await api(`/v1/apps/${app.id}/betaAppLocalizations?fields[betaAppLocalizations]=locale&limit=10`)).data[0]?.attributes.locale ?? "ko";
const locs = (await api(`/v1/builds/${build.id}/betaBuildLocalizations?fields[betaBuildLocalizations]=locale,whatsNew&limit=10`)).data;
const loc = locs.find((l) => l.attributes.locale === appLocale);
await change(`'테스트할 내용'(${appLocale}) 넣음`, () => loc
  ? api(`/v1/betaBuildLocalizations/${loc.id}`, "PATCH", { data: { type: "betaBuildLocalizations", id: loc.id, attributes: { whatsNew: NOTES } } })
  : api("/v1/betaBuildLocalizations", "POST", { data: { type: "betaBuildLocalizations", attributes: { locale: appLocale, whatsNew: NOTES },
    relationships: { build: { data: { type: "builds", id: build.id } } } } }));

// 그룹에 넣기(이미 있으면 그대로)
const inGroup = (await api(`/v1/betaGroups/${group.id}/relationships/builds?limit=200`)).data.some((b) => b.id === build.id);
if (inGroup) console.log(`이미 그룹 '${GROUP}' 에 있음`);
else await change(`그룹 '${GROUP}' 에 넣음`, () => api(`/v1/betaGroups/${group.id}/relationships/builds`, "POST", { data: [{ type: "builds", id: build.id }] }));

// 베타 심사에 내기(이미 냈으면 그 상태만)
let review = null;
try {
  review = (await api(`/v1/builds/${build.id}/betaAppReviewSubmission`)).data;
} catch {
  /* 아직 안 냄 */
}
if (review) console.log(`이미 심사에 냄: ${review.attributes?.betaReviewState ?? "?"}`);
else {
  await change("베타 심사에 냄", async () => {
    review = (await api("/v1/betaAppReviewSubmissions", "POST", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: build.id } } } } })).data;
  });
  if (review) console.log(`심사 상태: ${review.attributes?.betaReviewState ?? "?"}`);
}
const testers = (await api(`/v1/betaGroups/${group.id}/betaTesters?limit=200&fields[betaTesters]=email`)).data.length;
console.log(`그룹 '${GROUP}' 테스터 ${testers}명`);
