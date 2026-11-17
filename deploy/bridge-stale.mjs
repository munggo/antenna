#!/usr/bin/env node
/**
 * 돌고 있는 브리지가 옛 코드인지: 브리지가 뜬 뒤에 브리지 코드가 바뀌었으면(새 판을 받았거나 고쳤으면) 다시 시작해야 새 코드로 돈다.
 * 브리지는 한 번 뜨면 코드를 다시 읽지 않는다. 점검(deploy/doctor.mjs)과 설치(install.sh)가 같은 판정을 쓴다.
 *   node deploy/bridge-stale.mjs <브리지 프로세스 번호>   옛 코드면 바뀐 파일 이름을 찍고 끝 코드 0, 아니면(또는 알 수 없으면) 끝 코드 1
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** 브리지가 읽어 들이는 코드 파일: server/*.mjs 와, 백그라운드 탭을 여는 실행기(claude-remote/bg-launch.mjs) */
export function bridgeCodeFiles(repo = REPO) {
  const server = join(repo, "server");
  return [...readdirSync(server).filter((f) => f.endsWith(".mjs")).map((f) => join(server, f)), join(repo, "claude-remote", "bg-launch.mjs")];
}

/** 프로세스가 뜬 시각(ms). 모르면 0 */
export function startedAt(pid) {
  try {
    return Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim()) || 0;
  } catch {
    return 0;
  }
}

/** 그 시각(ms)에 뜬 브리지보다 새로 바뀐 코드 파일 가운데 가장 최근 것의 경로. 없으면(지금 코드로 돎) null. 시각을 모르면 null */
export function staleSince(started, files = bridgeCodeFiles()) {
  if (!started) return null;
  let newest = null;
  for (const f of files) {
    let t = 0;
    try {
      t = statSync(f).mtimeMs;
    } catch {
      continue;   // 없는 파일은 건너뜀
    }
    if (!newest || t > newest.t) newest = { f, t };
  }
  return newest && newest.t > started + 1000 ? newest.f : null;
}

/** 이 파일을 명령으로 직접 돌렸는지(다른 이름으로 이어진 경로로 불러도 같은 파일이면 맞음) */
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  const file = staleSince(startedAt(Number(process.argv[2]) || 0));
  if (file) console.log(file.split("/").pop());
  process.exit(file ? 0 : 1);
}
