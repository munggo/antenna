// 알림 본문 암호화(중계 서버로 보낼 때). 중계 서버와 Apple 은 본문을 읽지 못하고, 폰의 알림 확장만 푼다.
// 폰 앱이 X25519 키 쌍을 만들어 공개 키(32바이트, base64)를 브리지에 등록한다(push-register 의 pk).
// 알림마다: 일회용 X25519 키로 공유 비밀 → HKDF-SHA256(소금 없음, info 'antenna-push-v1') → AES-256-GCM.
// 싣는 값 { k: 일회용 공개 키(base64, 32바이트), b: 논스(12)+암호문+태그(16) (base64) } — 앱(CryptoKit)의
// Curve25519.KeyAgreement + hkdfDerivedSymmetricKey + AES.GCM.SealedBox(combined:) 와 같은 형식
import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

const INFO = Buffer.from("antenna-push-v1");

/** base64 32바이트 X25519 공개 키인지 */
export const isPushKey = (pk) => typeof pk === "string" && /^[A-Za-z0-9+/]{43}=$/.test(pk) && Buffer.from(pk, "base64").length === 32;

const pub = (raw) => createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
const rawOf = (keyObject) => Buffer.from(keyObject.export({ format: "jwk" }).x, "base64url");
const keyFrom = (shared) => Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), INFO, 32));

/** 본문(객체)을 폰 공개 키로 잠금 → { k, b } */
export function sealFor(pk, obj) {
  const eph = generateKeyPairSync("x25519");
  const key = keyFrom(diffieHellman({ privateKey: eph.privateKey, publicKey: pub(Buffer.from(pk, "base64")) }));
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return { k: rawOf(eph.publicKey).toString("base64"), b: Buffer.concat([nonce, ct, c.getAuthTag()]).toString("base64") };
}

// ── 시험용: 폰 쪽 흉내(키 만들기·풀기) ──
export function testKeyPair() {
  const kp = generateKeyPairSync("x25519");
  return { privateKey: kp.privateKey, pk: rawOf(kp.publicKey).toString("base64") };
}
/** 시험용: 개인 키(KeyObject)로 { k, b } 를 풀어 객체로 */
export function openWith(privateKey, { k, b }) {
  const key = keyFrom(diffieHellman({ privateKey, publicKey: pub(Buffer.from(k, "base64")) }));
  const box = Buffer.from(b, "base64");
  const d = createDecipheriv("aes-256-gcm", key, box.subarray(0, 12));
  d.setAuthTag(box.subarray(box.length - 16));
  return JSON.parse(Buffer.concat([d.update(box.subarray(12, box.length - 16)), d.final()]).toString("utf8"));
}
