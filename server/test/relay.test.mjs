// 알림 중계 시험(Apple 로 보내지 않음): node server/test/relay.test.mjs
// 1) 본문 잠그기·풀기  2) 중계 함수가 알림 모양을 직접 만드는지(받은 글은 싣지 않음)·틀린 요청 거절
// 3) 자기 키가 없는 브리지가 실제 HTTP 로 중계에 보내고, 중계가 만든 알림을 폰 개인 키로 풀면 원래 글이 나오는지
//    작업 표시는 상태·시각·탭 번호만, 없어진 기기는 지움
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isPushKey, openWith, sealFor, testKeyPair } from "../push-seal.mjs";
import { buildPush, handler, setSenderForTest } from "../../relay/index.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const hex = (c) => c.repeat(64);

// 1) 잠그기·풀기
const phone = testKeyPair();
ok(isPushKey(phone.pk) && !isPushKey("abc") && !isPushKey(Buffer.alloc(31).toString("base64")), "공개 키 모양(base64 32바이트)");
const box = sealFor(phone.pk, { t: "승인 필요", b: "rm -rf 를 실행할까요?", w: 3 });
ok(JSON.stringify(openWith(phone.privateKey, box)) === JSON.stringify({ t: "승인 필요", b: "rm -rf 를 실행할까요?", w: 3 }), "폰 개인 키로 풀면 원래 글");
ok(!box.b.includes(Buffer.from("승인").toString("base64")) && sealFor(phone.pk, { t: "x" }).k !== sealFor(phone.pk, { t: "x" }).k, "암호문에 글이 드러나지 않고, 알림마다 일회용 키가 다름");
let other = false;
try { openWith(testKeyPair().privateKey, box); } catch { other = true; }
ok(other, "다른 폰의 키로는 풀리지 않음");
let tampered = false;
try { const b = Buffer.from(box.b, "base64"); b[20] ^= 1; openWith(phone.privateKey, { k: box.k, b: b.toString("base64") }); } catch { tampered = true; }
ok(tampered, "암호문을 건드리면 풀리지 않음");

// 2) 중계 함수의 알림 모양
const topic = "com.munggo.piremote";
const now = 1_800_000_000;
const a = buildPush({ v: 1, type: "alert", token: hex("a"), env: "production", urgent: true, window: 3, e: box, title: "가짜 제목", aps: { alert: "가짜" } }, { topic, now });
ok(a.payload.aps.alert.title === "Antenna" && a.payload.aps.alert.body === "새 알림" && a.payload.aps["mutable-content"] === 1 && a.payload.e.b === box.b,
  "알림: 보이는 문구는 고정, 암호문만 실어 폰이 풂");
ok(!JSON.stringify(a.payload).includes("가짜") && a.payload.aps["interruption-level"] === "time-sensitive" && a.payload.aps["thread-id"] === "pi-3",
  "알림: 요청에 섞인 다른 글·Apple 설정은 싣지 않음, 급한 것은 시간 민감");
ok(a.headers["apns-topic"] === topic && a.headers["apns-push-type"] === "alert" && a.env === "production", "알림: 주제·종류·서버");
const plain = buildPush({ v: 1, type: "alert", token: hex("a"), env: "sandbox" }, { topic, now });
ok(!plain.payload.e && !plain.payload.aps["mutable-content"] && plain.payload.aps["interruption-level"] === "active", "공개 키가 없는 예전 앱: 고정 문구만");
const l = buildPush({ v: 1, type: "live", token: hex("b"), env: "sandbox", event: "start", window: 4, tabName: "회사 일", detail: "비밀 파일 읽는 중", state: { status: "working", startedAt: now - 60, detail: "비밀" } }, { topic, now });
ok(l.payload.aps.attributes.tabName === "탭 4" && l.payload.aps["content-state"].detail === "" && !JSON.stringify(l.payload).includes("비밀") && !JSON.stringify(l.payload).includes("회사"),
  "작업 표시: 탭 이름은 '탭 N', 하는 일은 비움(받아도 싣지 않음)");
ok(l.headers["apns-topic"] === `${topic}.push-type.liveactivity` && l.headers["apns-priority"] === "10" && l.payload.aps["stale-date"] === now + 3600, "작업 표시 시작: 주제·우선순위·오래됨 시각");
const le = buildPush({ v: 1, type: "live", token: hex("b"), env: "sandbox", event: "end", window: 4, state: { status: "done", startedAt: now - 60, endedAt: now } }, { topic, now });
ok(le.payload.aps["dismissal-date"] === now + 300 && le.payload.aps["content-state"].endedAt === now && !le.payload.aps.attributes, "작업 표시 끝: 5분 뒤 사라짐");
const bads = [
  [{ v: 1, type: "alert", token: "zz", env: "sandbox" }, "token"],
  [{ v: 1, type: "alert", token: hex("a"), env: "dev" }, "env"],
  [{ v: 2, type: "alert", token: hex("a"), env: "sandbox" }, "v"],
  [{ v: 1, type: "alert", token: hex("a"), env: "sandbox", e: { k: "짧음", b: "x" } }, "e"],
  [{ v: 1, type: "alert", token: hex("a"), env: "sandbox", e: { k: box.k, b: "A".repeat(3004) } }, "e"],
  [{ v: 1, type: "live", token: hex("a"), env: "sandbox", event: "start", window: 1, state: { status: "hacked", startedAt: now } }, "state"],
  [{ v: 1, type: "live", token: hex("a"), env: "sandbox", event: "boom", window: 1, state: { status: "working", startedAt: now } }, "event"],
  [{ v: 1, type: "mail", token: hex("a"), env: "sandbox" }, "type"],
];
ok(bads.every(([r, e]) => buildPush(r, { topic, now }).error === e), "틀린 요청은 거절(기기 주소·서버·판·암호문 크기·상태·종류)");

// 중계 함수 주소(Lambda) 모양
setSenderForTest(async () => ({ status: 200, reason: "" }));
process.env.APNS_TOPIC = topic;
const ev = (body, method = "POST") => ({ requestContext: { http: { method } }, body, isBase64Encoded: false });
ok((await handler(ev("{}", "GET"))).statusCode === 405 && (await handler(ev("x".repeat(9000)))).statusCode === 413 && (await handler(ev("{"))).statusCode === 400,
  "함수 주소: POST 만, 8KB 까지, JSON 만");
ok(JSON.parse((await handler(ev(JSON.stringify({ v: 1, type: "alert", token: "x", env: "sandbox" })))).body).error === "token", "함수 주소: 틀린 요청은 400 과 까닭");
ok((await handler({ ...ev(Buffer.from(JSON.stringify({ v: 1, type: "alert", token: hex("c"), env: "sandbox" })).toString("base64")), isBase64Encoded: true })).statusCode === 200, "함수 주소: base64 로 온 본문도 받음");

// 3) 자기 키가 없는 브리지 → 실제 HTTP → 중계 함수 → (가로챈) Apple
const got = [];
let appleReply = { status: 200, reason: "" };
setSenderForTest(async (p) => { got.push(p); return appleReply; });
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    const r = await handler({ requestContext: { http: { method: req.method } }, body, isBase64Encoded: false });
    res.writeHead(r.statusCode, r.headers).end(r.body);
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(`${tmpdir()}/relay-`);
for (const k of ["PI_REMOTE_APNS_KEY", "PI_REMOTE_APNS_KEY_ID", "PI_REMOTE_APNS_TEAM", "PI_REMOTE_PUSH_DRYRUN"]) delete process.env[k];
Object.assign(process.env, { PI_REMOTE_PUSH_FILE: `${dir}/push.json`, PI_REMOTE_PUSH_RELAY: `http://127.0.0.1:${srv.address().port}/` });
const m = await import("../push.mjs");
ok(m.pushMode === "relay" && m.pushEnabled, "자기 키가 없고 중계 주소가 있으면 중계로");
ok(m.registerToken(hex("d"), "production", phone.pk) && m.registerToken(hex("e"), "sandbox"), "기기 등록(새 앱은 공개 키와 함께, 예전 앱은 없이)");
const r1 = await m.notify({ title: "승인 필요", subtitle: "hellomyfriends", body: "git push 를 할까요?", kind: "approval", window: 7 });
const toD = got.find((p) => p.token === hex("d"));
const toE = got.find((p) => p.token === hex("e"));
const opened = toD?.payload.e ? openWith(phone.privateKey, toD.payload.e) : null;
ok(r1.length === 2 && r1.every((x) => x.status === 200), "두 기기 모두 중계로 보냄");
ok(opened?.t === "승인 필요" && opened.s === "hellomyfriends" && opened.b === "git push 를 할까요?" && opened.k === "approval" && opened.w === 7,
  "중계가 만든 알림을 폰 개인 키로 풀면 원래 제목·부제·내용·종류·탭");
ok(!JSON.stringify(toD).includes("hellomyfriends") && !JSON.stringify(toD).includes("git push") && toD.payload.aps["interruption-level"] === "time-sensitive",
  "중계·Apple 이 받는 알림에는 글이 없음(승인은 시간 민감)");
ok(toE && !toE.payload.e && toE.payload.aps.alert.body === "새 알림", "예전 앱(공개 키 없음)은 고정 문구");
got.length = 0;
await m.notify({ title: "긴 글", body: "가".repeat(3000), kind: "error", window: 1 });
const longOpen = openWith(phone.privateKey, got.find((p) => p.token === hex("d")).payload.e);
ok(got.length === 2 && longOpen.b.endsWith("…") && Buffer.byteLength(longOpen.b) <= 1504, "긴 내용은 잘라서 중계 크기 제한 안에");
// 작업 표시
got.length = 0;
m.registerLiveStart(hex("f"), "sandbox");
await m.liveActivity({ event: "start", window: 5, tabName: "비밀 탭", status: "working", detail: "회사 코드 읽는 중", startedAt: Math.floor(Date.now() / 1000) - 40 });
const ls = got[0];
ok(ls && ls.token === hex("f") && ls.payload.aps.attributes.tabName === "탭 5" && ls.payload.aps["content-state"].detail === "" && !JSON.stringify(ls).includes("비밀") && !JSON.stringify(ls).includes("회사"),
  "작업 표시 시작: 탭 이름·하는 일은 중계로 보내지 않음");
m.registerActivity(5, hex("1"), "sandbox");
await m.liveActivity({ event: "end", window: 5, status: "done", detail: "끝", startedAt: Math.floor(Date.now() / 1000) - 40 });
ok(got[1]?.token === hex("1") && got[1].payload.aps.event === "end" && got[1].payload.aps["content-state"].status === "done", "작업 표시 끝: 그 표시의 토큰으로 상태만");
// 없어진 기기
appleReply = { status: 410, reason: "Unregistered" };
got.length = 0;
await m.notify({ title: "x", body: "y", kind: "error", window: 1 });
appleReply = { status: 200, reason: "" };
got.length = 0;
await m.notify({ title: "x", body: "y", kind: "error", window: 1 });
ok(got.length === 0, "Apple 이 '없는 기기'라고 하면 그 기기를 지움");
// 중계가 꺼져 있거나 안 닿음
srv.close();
m.registerToken(hex("d"), "production", phone.pk);
const down = await m.notify({ title: "x", body: "y", kind: "error", window: 1 });
ok(down.length === 1 && down[0].status === 0 && /^relay /.test(down[0].reason), `중계에 닿지 않으면 실패로 남김(${down[0]?.reason})`);

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
