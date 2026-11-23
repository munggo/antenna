// 브리지의 알림 본문 잠금(push-seal.mjs)을 앱의 풀기(ios/Shared/PushCrypto.swift, CryptoKit)가 실제로 푸는지:
//   node server/test/push-crypto.test.mjs <ios/test/push-crypto.swift 를 컴파일한 프로그램>
// 앱처럼 Swift 가 키 쌍을 만들고 → 브리지가 그 공개 키로 잠그고 → Swift 가 개인 키로 풂(sh test.sh push-crypto 가 컴파일해 부름)
import { execFileSync } from "node:child_process";
import { isPushKey, sealFor } from "../push-seal.mjs";

const BIN = process.argv[2];
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const run = (...a) => { try { return execFileSync(BIN, a, { encoding: "utf8" }).trim(); } catch (e) { return String(e.stdout ?? "").trim() || "FAIL"; } };
const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1))));
const same = (out, o) => { try { return sorted(JSON.parse(out)) === sorted(o); } catch { return false; } };

const [priv, pk] = run("gen").split(" ");
ok(isPushKey(pk), "앱이 만든 공개 키를 브리지가 받음(base64 32바이트)");
const msg = { t: "승인 필요 · hellomyfriends", s: "탭 7", b: "git push origin main 을 할까요? 😀 \"따옴표\"\n둘째 줄", k: "approval", w: 7 };
const box = sealFor(pk, msg);
ok(same(run("open", priv, box.k, box.b), msg), "브리지가 잠근 본문을 앱이 풀면 원래 글(한글·그림 문자·줄바꿈·따옴표)");
const long = { t: "x/y", b: "가".repeat(500), k: "error", w: null };
const lb = sealFor(pk, long);
ok(same(run("open", priv, lb.k, lb.b), long), "긴 본문·빗금·빈 탭 번호");
const [otherPriv] = run("gen").split(" ");
ok(run("open", otherPriv, box.k, box.b) === "FAIL", "다른 폰의 키로는 풀리지 않음");
const b = Buffer.from(box.b, "base64");
b[b.length - 1] ^= 1;
ok(run("open", priv, box.k, b.toString("base64")) === "FAIL", "건드린 암호문은 풀리지 않음");

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
