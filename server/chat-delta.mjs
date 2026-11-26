/**
 * 폰에 이미 있는 메시지는 다시 보내지 않기(11-25 사용자 요청: 탭을 바꿀 때마다 긴 대화 약 240KB 를 통째로 다시 받아 느렸음).
 * 브리지는 연결부가 준 처음 대화(snapshot)의 메시지마다 내용 지문을 붙여 폰에 보낸다(hashes: 메시지 순서대로).
 * 폰은 탭마다 그 지문과 메시지를 저장해 두고, 탭을 고르거나 미리 받을 때 가진 지문 목록(have)을 보낸다.
 * 브리지는 그 목록에 있는 메시지를 빼고 보낸다(delta: true, fresh: 보낸 메시지가 hashes 의 몇 번째인지). 폰은 hashes 순서대로
 * fresh 자리에는 받은 것을, 나머지 자리에는 저장해 둔 것을 넣는다.
 * 브리지가 앱 메시지를 알아듣는지는 탭 목록의 칸 번호(key)로 안다(예전 브리지는 모르는 메시지를 터미널에 글자로 넣음).
 * 지문이 내용에서 나오므로 같은 지문이면 내용이 같다(어느 탭에서 저장한 것이든). 폰에서 못 찾는 지문이 있으면 폰이 다시 통째로 달라고 한다.
 * 작성: 서문교
 */
import { createHash } from "node:crypto";

/** 메시지 하나의 지문(내용이 같으면 같음). 60비트라 한 대화 안에서 겹칠 일은 없다 */
export const hashMessage = (m) => createHash("sha1").update(JSON.stringify(m)).digest("base64url").slice(0, 10);

/** 폰이 보낸 지문 목록을 믿을 만한 모양으로만 받는다(글자 수·개수 제한). 아니면 null */
export function parseHave(v) {
  if (!Array.isArray(v) || v.length > 2000) return null;
  const out = new Set();
  for (const h of v) if (typeof h === "string" && /^[A-Za-z0-9_-]{10}$/.test(h)) out.add(h);
  return out;
}

/**
 * 연결부가 준 처음 대화 한 줄 → 폰에 보낼 처음 대화.
 * have: 폰이 가진 지문(Set) 또는 없음(통째로). key: 이 대화의 탭(칸 번호). notice 는 그대로 둔다
 * 돌려주는 것: { json: 보낼 글, hashes: 이 대화의 지문 전체 } — 해석하지 못하면 null(그대로 보냄)
 */
export function snapshotForApp(line, have, key) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o?.t !== "snapshot" || !Array.isArray(o.messages)) return null;
  const hashes = o.messages.map(hashMessage);
  const out = { ...o, key, hashes };
  if (have) {
    out.fresh = [];
    hashes.forEach((h, i) => { if (!have.has(h)) out.fresh.push(i); });
    out.messages = out.fresh.map((i) => o.messages[i]);
    out.delta = true;
  }
  return { json: JSON.stringify(out), hashes };
}
