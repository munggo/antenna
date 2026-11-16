#!/usr/bin/env node
/**
 * TestFlight 올리기 준비: 배포용 프로필을 만들어 이 맥에 설치한다.
 * 처음 한 번, 그리고 프로필이 만료·무효가 됐거나 새 맥으로 옮겼을 때 다시 돌린다(여러 번 돌려도 같은 결과).
 * - 이 계정의 API 키로는 '클라우드 관리 배포 인증서'(자동 서명)를 쓸 수 없어서, 다른 앱들처럼 수동 프로필로 서명한다:
 *   키체인의 배포 인증서('Apple Distribution') + App Store 프로필
 * - 하는 일: 위젯 식별자가 없으면 등록 → 앱·위젯용 App Store 프로필을 만들거나(이미 있으면 그대로) 받아서 설치
 *   → 내부 테스트 그룹(올린 빌드가 처리되면 자동으로 폰의 TestFlight 에 뜸)을 만들고 계정 사용자를 테스터로 넣음
 * - App Store Connect 의 앱 자체는 API 로 만들 수 없다(웹에서 '신규 앱': 번들 ID com.munggo.piremote). 앱이 없으면 그룹 단계는 건너뜀
 * - 프로필 이름은 deploy/testflight.sh 가 그대로 쓴다(아래 TARGETS 와 맞춰야 함)
 * 키: ~/.appstoreconnect/config 의 ASC_KEY_ID·ASC_ISSUER_ID·ASC_KEY_PATH (deploy/install-ios.sh 와 같은 키)
 * 쓰기: node deploy/testflight-setup.mjs
 * 작성: 서문교
 */
import { createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TARGETS = [
  { identifier: "com.munggo.piremote", profile: "Antenna AppStore", label: "Antenna" },
  { identifier: "com.munggo.piremote.widgets", profile: "Antenna Widget AppStore", label: "Antenna Widgets" },
];
const GROUP = "개발";   // 내부 테스트 그룹 이름
const HOME = process.env.HOME;
const PROFILE_DIR = `${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles`;

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
    /* 본문 없음(삭제 등) */
  }
  if (r.status >= 400) throw new Error(`${method} ${path.split("?")[0]} → ${r.status} ${(json.errors ?? []).map((e) => e.detail).join(" / ")}`);
  return json;
}
const alive = (iso) => new Date(iso).getTime() > Date.now() + 7 * 86_400_000;   // 일주일 넘게 남은 것만

// 배포 인증서: 키체인에 있는 것과 같은 계정의 것(만료가 가장 늦은 것)
const certs = (await api("/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&fields[certificates]=name,expirationDate,certificateType&limit=50")).data
  .filter((c) => alive(c.attributes.expirationDate)).sort((a, b) => b.attributes.expirationDate.localeCompare(a.attributes.expirationDate));
if (!certs.length) throw new Error("쓸 수 있는 배포 인증서가 계정에 없어요");
const cert = certs[0];
console.log(`배포 인증서: ${cert.attributes.name} (만료 ${cert.attributes.expirationDate.slice(0, 10)})`);

mkdirSync(PROFILE_DIR, { recursive: true });
for (const t of TARGETS) {
  // 식별자(없으면 등록)
  let bundle = (await api(`/v1/bundleIds?filter[identifier]=${t.identifier}&fields[bundleIds]=identifier&limit=50`)).data.find((b) => b.attributes.identifier === t.identifier);
  if (!bundle) {
    bundle = (await api("/v1/bundleIds", "POST", { data: { type: "bundleIds", attributes: { identifier: t.identifier, name: t.label, platform: "IOS" } } })).data;
    console.log(`식별자 등록: ${t.identifier}`);
  }
  // 프로필: 같은 이름으로 살아 있는 것이 있으면 그대로, 무효·만료면 지우고 새로
  const found = (await api(`/v1/profiles?filter[name]=${encodeURIComponent(t.profile)}&fields[profiles]=name,profileState,expirationDate,profileContent,uuid&limit=50`)).data.filter((p) => p.attributes.name === t.profile);
  let profile = found.find((p) => p.attributes.profileState === "ACTIVE" && alive(p.attributes.expirationDate));
  for (const p of found) {
    if (p === profile) continue;
    await api(`/v1/profiles/${p.id}`, "DELETE");
    console.log(`쓸 수 없는 프로필 지움: ${t.profile} (${p.attributes.profileState})`);
  }
  if (!profile) {
    profile = (await api("/v1/profiles", "POST", { data: { type: "profiles", attributes: { name: t.profile, profileType: "IOS_APP_STORE" },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } }, certificates: { data: [{ type: "certificates", id: cert.id }] } } } })).data;
    console.log(`프로필 만듦: ${t.profile}`);
  }
  const file = `${PROFILE_DIR}/${profile.attributes.uuid}.mobileprovision`;
  writeFileSync(file, Buffer.from(profile.attributes.profileContent, "base64"));
  console.log(`프로필 설치: ${t.profile} (${t.identifier}, 만료 ${profile.attributes.expirationDate.slice(0, 10)})`);
}

// 내부 테스트 그룹: 올린 빌드가 처리되면 자동으로 테스터 폰의 TestFlight 에 뜬다(계정 사용자만 넣음)
const app = (await api(`/v1/apps?filter[bundleId]=${TARGETS[0].identifier}&fields[apps]=bundleId`)).data.find((a) => a.attributes.bundleId === TARGETS[0].identifier);
if (!app) {
  console.log(`App Store Connect 에 앱이 아직 없어요. 웹에서 '신규 앱'(번들 ID ${TARGETS[0].identifier})을 만든 뒤 다시 돌리면 내부 테스트 그룹을 만들어요`);
} else {
  let group = (await api(`/v1/apps/${app.id}/betaGroups?fields[betaGroups]=name,isInternalGroup&limit=50`)).data.find((g) => g.attributes.isInternalGroup);
  if (!group) {
    group = (await api("/v1/betaGroups", "POST", { data: { type: "betaGroups", attributes: { name: GROUP, isInternalGroup: true, hasAccessToAllBuilds: true },
      relationships: { app: { data: { type: "apps", id: app.id } } } } })).data;
    console.log(`내부 테스트 그룹 만듦: ${GROUP}(올린 빌드 자동 배포)`);
  }
  const inGroup = new Set((await api(`/v1/betaGroups/${group.id}/betaTesters?fields[betaTesters]=email&limit=200`)).data.map((t) => String(t.attributes.email ?? "").toLowerCase()));
  let added = 0;
  for (const u of (await api("/v1/users?fields[users]=username,firstName,lastName&limit=200")).data) {
    const email = String(u.attributes.username ?? "").toLowerCase();
    if (!email || inGroup.has(email)) continue;
    // 테스터 만들기 요청에 그룹을 함께 넣는다. 다른 앱에서 이미 테스터인 사람도 이 방식이어야 들어감
    // (있는 테스터를 그룹에 잇는 요청은 내부 그룹에서 409 'Tester(s) cannot be assigned' 로 거절됨)
    await api("/v1/betaTesters", "POST", { data: { type: "betaTesters", attributes: { email: u.attributes.username, firstName: u.attributes.firstName, lastName: u.attributes.lastName },
      relationships: { betaGroups: { data: [{ type: "betaGroups", id: group.id }] } } } });
    added++;
  }
  console.log(`내부 테스터 ${inGroup.size + added}명(새로 넣음 ${added}명)`);
  // 새 앱은 처음 한 번 초대를 받아들여야 TestFlight 앱에 나타난다(그 뒤 빌드는 저절로 뜸)
  if (added) console.log("처음에는 초대를 받아들여야 해요: 빌드 처리가 끝나면 Apple ID 메일 주소로 오는 초대 메일에서 'TestFlight에서 보기'를 폰으로 누르세요");
}
console.log("준비 끝. 이제 sh deploy/testflight.sh 로 올릴 수 있어요");
