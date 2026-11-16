// 잡지 못한 오류 기록: 브리지가 왜 죽었는지를 재부팅해도 남는 곳에 적는다
// (launchd 의 출력 기록은 /tmp 라 재부팅하면 사라지고 시각도 없다. 점검 명령이 이 기록을 보여 준다)
// - 던져진 오류: 적고 끝낸다(launchd 가 다시 띄움. 알 수 없는 상태로 계속 돌지 않게)
// - 처리되지 않은 거절: 한 요청의 실패인 경우가 대부분이라 적기만 하고 계속 돈다
// 한 건을 한 줄로 적고 최근 200건만 둔다
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CRASH_LOG = process.env.PI_REMOTE_CRASH_LOG || `${process.env.HOME}/.cache/pi-remote/crash.log`;
const KEEP = 200;

export function recordCrash(kind, err, file = CRASH_LOG) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const old = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    const text = String(err?.stack ?? err).split("\n").map((s) => s.trim()).filter(Boolean).join(" | ");
    writeFileSync(file, [...old.slice(-(KEEP - 1)), `${new Date().toISOString()} ${kind} ${text}`].join("\n") + "\n");
  } catch {
    /* 적지 못해도 부른 쪽 동작은 그대로 */
  }
}

/** 이 프로세스의 잡지 못한 오류를 기록하게 한다(name 은 화면 기록의 머리말) */
export function installCrashLog(name = "pi-remote", file = CRASH_LOG) {
  process.on("uncaughtException", (err) => {
    recordCrash("죽음", err, file);
    console.error(`[${name}] 잡지 못한 오류로 끝냄:`, err);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    recordCrash("거절", err, file);
    console.error(`[${name}] 처리되지 않은 거절(계속 동작):`, err);
  });
}
