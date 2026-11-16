/**
 * 맥북의 배터리·충전 상태(앱의 '연결됨' 옆 표시와 낮을 때 알림, 사용자 요청 11-16).
 * - readBattery: `pmset -g batt` 를 읽어 { percent, plugged, low }. 배터리가 없는 맥이거나 읽지 못하면 null
 * - plugged: 충전기를 꽂았는지(충전 중·다 참·꽂았지만 충전하지 않음 모두)
 * - low: 충전기 없이 기준(LOW_PERCENT) 아래. 앱은 이 값으로 빨갛게 보이고, 브리지는 이때 폰에 한 번 알린다
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LOW_PERCENT = 20;   // 사용자 결정 11-16

/** pmset -g batt 출력 → { percent, plugged, low } | null */
export function parseBattery(out, low = LOW_PERCENT) {
  const text = String(out ?? "");
  const line = text.split("\n").find((l) => /InternalBattery/.test(l));
  const pct = line?.match(/(\d{1,3})%/);
  if (!pct) return null;
  const percent = Math.min(100, Number(pct[1]));
  const source = (text.match(/Now drawing from '([^']+)'/) ?? [])[1] ?? "";
  const state = (line.match(/%;\s*([^;]+);/) ?? [])[1]?.trim() ?? "";
  const plugged = source ? source === "AC Power" : /^(charging|charged|finishing charge|AC attached)/i.test(state);
  return { percent, plugged, low: !plugged && percent < low };
}

/** 지금 상태. 시험: PI_REMOTE_FAKE_BATTERY_FILE 이 있으면 그 파일의 글을 pmset 출력으로 본다 */
export function readBattery() {
  try {
    const fake = process.env.PI_REMOTE_FAKE_BATTERY_FILE;
    const out = fake ? readFileSync(fake, "utf8") : execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return parseBattery(out);
  } catch {
    return null;
  }
}
