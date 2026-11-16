// 작업 표시(Live Activity) 시험: node server/test/live-activity.test.mjs (Apple 로 보내지 않음)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(`${tmpdir()}/live-`);
writeFileSync(`${dir}/key.p8`, "가짜 키");
Object.assign(process.env, {
  PI_REMOTE_PUSH_FILE: `${dir}/push.json`, PI_REMOTE_APNS_KEY: `${dir}/key.p8`,
  PI_REMOTE_APNS_KEY_ID: "TEST", PI_REMOTE_APNS_TEAM: "TEAM", PI_REMOTE_APNS_TOPIC: "com.munggo.piremote",
});
const m = await import("../push.mjs");
let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };
const sent = [];
let reply = { status: 200 };
m.setLiveSenderForTest(async (t, payload, opts) => { sent.push({ token: t.token, payload, opts }); return reply; });
const hex = (c) => c.repeat(64);

// 1. 내용
const st = { status: "working", detail: "⏳ 시험", startedAt: 1000, endedAt: null };
const p1 = m.livePayload("start", { window: 2, tabName: "PI", state: st, now: 2000 });
ok(p1.aps.event === "start" && p1.aps["attributes-type"] === "PiWorkAttributes" && p1.aps.attributes.window === 2 && p1.aps.attributes.tabName === "PI",
  "시작: 속성 이름·창 번호·탭 이름");
ok(p1.aps.alert?.title === "PI" && !p1.aps.sound && p1.aps["stale-date"] === 2000 + 3600 && p1.aps["content-state"].detail === "⏳ 시험",
  "시작: 알림 글(소리 없음)·1시간 뒤 오래됨·상태");
const p3 = m.livePayload("end", { window: 2, tabName: "PI", state: { ...st, status: "done", endedAt: 2100 }, now: 2100 });
ok(p3.aps["dismissal-date"] === 2100 + 300 && !p3.aps.attributes && !p3.aps.alert, "끝: 5분 뒤 사라짐, 속성·알림 없음");

// 2. 흐름: 시작용 토큰 등록 → 시작 → 갱신용 토큰 → 갱신 → 끝
ok(m.registerLiveStart(hex("a"), "sandbox") && !m.registerLiveStart("xyz", "sandbox"), "시작용 토큰 등록(잘못된 값은 거절)");
await m.liveActivity({ event: "update", window: 2, detail: "앞선 갱신" });
ok(sent.length === 0, "띄우기 전 갱신은 보내지 않음");
await m.liveActivity({ event: "start", window: 2, tabName: "PI", detail: "🤔 생각 중…", startedAt: 1000 });
ok(sent.length === 1 && sent[0].token === hex("a") && sent[0].opts.pushType === "liveactivity" && sent[0].opts.topic === "com.munggo.piremote.push-type.liveactivity" && sent[0].opts.priority === "10",
  "시작: 시작용 토큰으로, liveactivity 종류·주제, 우선순위 10");
await m.liveActivity({ event: "update", window: 2, detail: "⏳ 실행" });
ok(sent.length === 1, "갱신용 토큰이 오기 전 갱신은 건너뜀");
ok(m.registerActivity(2, hex("b"), "sandbox"), "갱신용 토큰 등록");
await m.liveActivity({ event: "update", window: 2, detail: "⏳ 실행" });
ok(sent.length === 2 && sent[1].token === hex("b") && sent[1].opts.priority === "5" && sent[1].payload.aps.event === "update", "갱신: 그 표시의 토큰으로, 우선순위 5");
await m.liveActivity({ event: "start", window: 2, tabName: "PI", detail: "다시 시작" });
ok(sent.length === 3 && sent[2].token === hex("b") && sent[2].payload.aps.event === "update", "이미 떠 있는 탭에 다시 시작이 오면 갱신으로");
await m.liveActivity({ event: "end", window: 2, status: "done", detail: "끝" });
ok(sent.length === 4 && sent[3].payload.aps.event === "end" && sent[3].payload.aps["content-state"].endedAt > 0, "끝: 끝난 시각 담아 보냄");
await m.liveActivity({ event: "update", window: 2, detail: "끝난 뒤" });
ok(sent.length === 4, "끝난 뒤 갱신은 보내지 않음(토큰 지움)");

// 3. 만료된 시작용 토큰은 정리
reply = { status: 410, reason: "ExpiredToken" };
await m.liveActivity({ event: "start", window: 5, tabName: "Home", detail: "x" });
const saved = JSON.parse(readFileSync(`${dir}/push.json`, "utf8"));
ok(saved.live.start.length === 0, "만료된 시작용 토큰은 지움");
ok(await m.liveActivity({ event: "start", window: "x" }).then((r) => r.length === 0), "창 번호가 잘못되면 무시");

rmSync(dir, { recursive: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
