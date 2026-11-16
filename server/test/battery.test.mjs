// 맥북 배터리 판정(server/battery.mjs): pmset 출력에서 잔량·충전기 연결·낮음을 읽는지. 다른 프로그램 없이 글로 시험한다.
// 실행: node server/test/battery.test.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOW_PERCENT, parseBattery, readBattery } from "../battery.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const is = (got, want, n) => ok(JSON.stringify(got) === JSON.stringify(want), `${n} → ${JSON.stringify(got)}`);
const out = (source, pct, state, tail = "1:00 remaining present: true") => `Now drawing from '${source}'\n -InternalBattery-0 (id=22806627)\t${pct}%; ${state}; ${tail}\n`;

is(parseBattery(out("Battery Power", 94, "discharging", "3:59 remaining present: true")), { percent: 94, plugged: false, low: false }, "배터리로 쓰는 중");
is(parseBattery(out("AC Power", 45, "charging")), { percent: 45, plugged: true, low: false }, "충전 중");
is(parseBattery(out("AC Power", 100, "charged", "0:00 remaining present: true")), { percent: 100, plugged: true, low: false }, "다 참");
is(parseBattery(out("AC Power", 80, "AC attached", "not charging present: true")), { percent: 80, plugged: true, low: false }, "꽂았지만 충전하지 않음");
is(parseBattery(out("Battery Power", 62, "discharging", "(no estimate) present: true")), { percent: 62, plugged: false, low: false }, "남은 시간을 아직 모를 때");
ok(LOW_PERCENT === 20, `낮음 기준은 20%(${LOW_PERCENT})`);
is(parseBattery(out("Battery Power", 19, "discharging")), { percent: 19, plugged: false, low: true }, "충전기 없이 19% → 낮음");
is(parseBattery(out("Battery Power", 20, "discharging")), { percent: 20, plugged: false, low: false }, "20% 는 아직 낮음이 아님(기준 미만일 때만)");
is(parseBattery(out("AC Power", 5, "charging")), { percent: 5, plugged: true, low: false }, "충전기를 꽂았으면 5% 여도 낮음이 아님");
is(parseBattery(out("Battery Power", 15, "discharging"), 10), { percent: 15, plugged: false, low: false }, "기준을 10% 로 주면 15% 는 낮음이 아님");
is(parseBattery("Now drawing from 'AC Power'\n"), null, "배터리가 없는 맥(배터리 줄 없음) → 없음");
is(parseBattery(""), null, "빈 글 → 없음");
is(parseBattery(null), null, "값 없음 → 없음");
ok(parseBattery(out("Battery Power", 94, "discharging")).percent === 94, "기기 번호(id=22806627)의 숫자를 잔량으로 읽지 않음");
is(parseBattery(" -InternalBattery-0 (id=1)\t50%; charging; 0:30 remaining present: true\n"), { percent: 50, plugged: true, low: false }, "전원 줄이 없으면 상태 글로 판단(충전 중)");
is(parseBattery(" -InternalBattery-0 (id=1)\t50%; discharging; 2:00 remaining present: true\n"), { percent: 50, plugged: false, low: false }, "전원 줄이 없으면 상태 글로 판단(쓰는 중)");
is(parseBattery(out("Battery Power", 250, "discharging")), { percent: 100, plugged: false, low: false }, "100 을 넘는 값은 100 으로");
is(parseBattery("Now drawing from 'AC Power'\n -UPS-0 (id=9)\t77%; discharging; present: true\n"), null, "맥북 배터리가 아닌 줄(무정전 전원)은 보지 않음");

// 읽기: 시험용 파일(브리지 시험·앱 화면 시험이 이 길로 값을 바꿈)
const dir = join(tmpdir(), `battery-test-${process.pid}`);
mkdirSync(dir, { recursive: true });
try {
  const f = join(dir, "batt");
  writeFileSync(f, out("Battery Power", 18, "discharging"));
  process.env.PI_REMOTE_FAKE_BATTERY_FILE = f;
  is(readBattery(), { percent: 18, plugged: false, low: true }, "시험용 파일에서 읽음");
  process.env.PI_REMOTE_FAKE_BATTERY_FILE = join(dir, "없는파일");
  is(readBattery(), null, "읽지 못하면 없음(브리지가 죽지 않음)");
} finally {
  delete process.env.PI_REMOTE_FAKE_BATTERY_FILE;
  rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
