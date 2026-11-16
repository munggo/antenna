// 기기별 토큰·짝짓기 코드 시험(server/devices.mjs). 임시 폴더만 쓴다. 실행: node server/test/devices.test.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeviceStore, looksLikeSecret, PAIR_TTL_MS, sameHex } from "../devices.mjs";

const D = mkdtempSync(join(tmpdir(), "antenna-devices-"));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const mode = (f) => (statSync(f).mode & 0o777).toString(8);
const s = createDeviceStore(D);
const T0 = 1_000_000;

try {
  // ── 짝짓기 코드 ──
  ok(!s.pairingOpen(T0) && s.redeem("a".repeat(32), "폰", T0).error === "invalid", "코드를 만든 적이 없으면 짝지을 수 없음");
  const p = s.startPairing(T0);
  ok(/^[0-9a-f]{32}$/.test(p.code) && p.expiresAt === T0 + PAIR_TTL_MS && s.pairingOpen(T0), "코드는 16진수 32자, 5분 동안");
  ok(mode(s.files.pairing) === "600" && !readFileSync(s.files.pairing, "utf8").includes(p.code), "코드 파일은 나만 읽을 수 있고, 코드 원문은 적지 않음(해시만)");
  ok(s.redeem("b".repeat(32), "폰", T0).error === "invalid" && s.pairingOpen(T0), "틀린 코드는 받지 않고, 진짜 코드는 그대로 살아 있음");
  ok(s.redeem("짧음", "폰", T0).error === "invalid" && s.redeem(undefined, "폰", T0).error === "invalid" && s.redeem({ $ne: 1 }, "폰", T0).error === "invalid", "모양이 다른 값(짧은 글·빈 값·객체)은 받지 않음");
  const a = s.redeem(p.code, "내 iPhone", T0 + 1000);
  ok(/^[0-9a-f]{64}$/.test(a.token ?? "") && /^d[0-9a-f]{8}$/.test(a.id ?? ""), "맞는 코드 → 그 기기만의 토큰(16진수 64자)");
  ok(!existsSync(s.files.pairing) && s.redeem(p.code, "다른 폰", T0 + 2000).error === "invalid", "코드는 한 번 쓰면 없어짐");
  ok(mode(s.files.devices) === "600" && !readFileSync(s.files.devices, "utf8").includes(a.token), "기기 파일은 나만 읽을 수 있고, 토큰 원문은 적지 않음(해시만)");
  const late = s.startPairing(T0);
  ok(s.redeem(late.code, "늦은 폰", T0 + PAIR_TTL_MS).error === "expired" && !existsSync(s.files.pairing) && s.list().length === 1, "5분이 지난 코드는 못 쓰고 지워짐");
  const p1 = s.startPairing(T0), p2 = s.startPairing(T0);
  ok(s.redeem(p1.code, "폰", T0).error === "invalid" && Boolean(s.redeem(p2.code.toUpperCase(), "아이패드", T0).token), "새 코드를 만들면 앞 코드는 못 씀. 대문자로 적어도 같은 코드");

  // ── 토큰 확인 ──
  const b = s.redeem(s.startPairing(T0).code, "둘째 폰", T0);
  ok(s.verify(a.token)?.name === "내 iPhone" && s.verify(b.token)?.id === b.id && s.verify(a.token.toUpperCase())?.id === a.id, "토큰으로 그 기기를 알아봄");
  ok(s.verify("f".repeat(64)) === null && s.verify("") === null && s.verify(null) === null && s.verify(a.token.slice(0, 63)) === null && s.verify(`${a.token}0`) === null, "틀린 토큰·빈 값·한 글자 모자라거나 남는 토큰은 아님");
  ok(s.list().length === 3 && s.list().every((d) => !("hash" in d) && d.id && d.name), "기기 목록에는 토큰 해시를 내보내지 않음");

  // ── 토큰 바꾸기·끊기 ──
  const r = s.rotate(a.id);
  ok(r.token !== a.token && s.verify(a.token) === null && s.verify(r.token)?.id === a.id && s.verify(b.token)?.id === b.id, "토큰을 바꾸면 그 기기의 옛 토큰만 못 씀(다른 기기는 그대로)");
  ok(s.rotate("d00000000") === null, "없는 기기의 토큰은 바꾸지 않음");
  ok(s.revoke(b.id).length === 1 && s.verify(b.token) === null && s.verify(r.token)?.id === a.id, "번호로 끊으면 그 기기만 못 붙음");
  ok(s.revoke("아이패드").length === 1 && s.list().length === 1 && s.revoke("없는 이름").length === 0, "이름으로도 끊을 수 있고, 없는 이름은 아무것도 끊지 않음");

  // ── 이름·깨진 파일 ──
  const odd = s.add("  줄\n바꿈\u0000 과 아주 긴 이름 " + "가".repeat(100), T0);
  const oddName = s.verify(odd.token).name;
  ok(!/[\u0000-\u001f]/.test(oddName) && [...oddName].length <= 60 && s.verify(s.add("", T0).token).name === "이름 없는 기기", "기기 이름: 줄바꿈·제어 글자를 걷어 내고 60자까지, 비면 기본 이름");
  writeFileSync(s.files.devices, "{깨짐");
  ok(s.list().length === 0 && s.verify(r.token) === null, "기기 파일이 깨져 있으면 아무도 믿지 않음(오류로 죽지 않음)");
  writeFileSync(s.files.devices, JSON.stringify({ devices: [null, { id: 1 }, { id: "dx", hash: "zz" }, "글"] }));
  ok(s.verify("a".repeat(64)) === null && s.list().length === 1, "모양이 이상한 항목은 건너뜀");
  ok(sameHex("ab", "ab") && !sameHex("ab", "ac") && !sameHex("ab", "abcd") && !sameHex("zz", "zz") && !sameHex(1, 1), "값 견주기: 같은 길이의 16진수만");
  ok(looksLikeSecret("a".repeat(32)) && looksLikeSecret("A".repeat(128)) && !looksLikeSecret("a".repeat(31)) && !looksLikeSecret("a".repeat(129)) && !looksLikeSecret("g".repeat(32)), "토큰·코드 모양: 16진수 32~128자");
} catch (e) {
  ok(false, `시험 중 오류: ${e.stack ?? e.message}`);
} finally {
  rmSync(D, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
