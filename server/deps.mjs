// 브리지가 쓰는 모듈 폴더(server/node_modules)를 지킨다.
// 11-18 맥 용량 정리에서 다른 탭이 이 폴더를 '다시 만들 수 있는 폴더'로 보고 지웠다. 브리지는 이미 올려 둔 모듈로 계속 돌았지만,
// 폰이 붙을 때마다 tmux 를 띄우는 node-pty 의 보조 실행 파일(spawn-helper)이 없어 실패했고 앱은 '연결 중'에 멈췄다.
// - missingDeps(dir): package.json 의 모듈 가운데 없는 것(+ 실행할 수 없는 보조 실행 파일). 다 있으면 빈 배열
// - createDepsGuard(...).check(이유): 없는 것이 있으면 잠금 파일대로 다시 설치한다. 한 번에 하나만, 실패하면 RETRY_MS 동안 다시 하지 않음.
//   도는 브리지는 이미 올려 둔 모듈을 그대로 쓰므로 다시 시작할 필요 없이 보조 실행 파일만 제자리에 오면 된다
// 켜기 전 점검은 run.sh 가 한다(모듈이 아예 없으면 브리지가 뜨지도 못하므로). 작성: 서문교
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";

export const RETRY_MS = 5 * 60_000;

/** 없는 모듈 이름 목록(보조 실행 파일이 없거나 실행할 수 없으면 'node-pty/spawn-helper') */
export function missingDeps(dir) {
  let deps;
  try {
    deps = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies ?? {};
  } catch {
    return ["package.json"];
  }
  const out = Object.keys(deps).filter((name) => !existsSync(join(dir, "node_modules", name, "package.json")));
  if ("node-pty" in deps && !out.includes("node-pty") && !ptyHelperOk(dir)) out.push("node-pty/spawn-helper");
  return out;
}

/** node-pty 가 맥에서 프로그램을 띄울 때 거치는 spawn-helper 가 실행할 수 있는 채로 있는지(미리 빌드된 것·직접 빌드한 것 가운데 하나) */
function ptyHelperOk(dir) {
  if (process.platform !== "darwin") return true;
  const base = join(dir, "node_modules", "node-pty");
  return [join(base, "prebuilds", `${process.platform}-${process.arch}`), join(base, "build", "Release")].some((d) => {
    if (!existsSync(join(d, "pty.node"))) return false;
    try {
      accessSync(join(d, "spawn-helper"), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** 잠금 파일대로 다시 설치(npm ci). 이 node 옆의 npm 을 쓴다(launchd 의 PATH 에는 nvm 의 node 가 없음).
 * 브리지가 이름을 바꾼 복사본('Antenna 연결부')으로 돌면 run.sh 가 원래 node 폴더를 PI_REMOTE_NODE_DIR 로 알려 준다 */
export function npmCi(dir) {
  const bin = process.env.PI_REMOTE_NODE_DIR || dirname(process.execPath);
  const npm = existsSync(join(bin, "npm")) ? join(bin, "npm") : "npm";
  return new Promise((resolve, reject) => {
    execFile(npm, ["ci", "--no-audit", "--no-fund"], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      timeout: 5 * 60_000,
      maxBuffer: 4 << 20,
    }, (err, _out, stderr) => {
      if (!err) return resolve();
      const tail = String(stderr || err.message).trim().split("\n").slice(-3).join(" / ");
      reject(new Error(tail || err.message));
    });
  });
}

/**
 * @param {{dir: string, install?: (dir: string) => Promise<void>, log?: (s: string) => void, warn?: (s: string) => void, now?: () => number}} o
 */
export function createDepsGuard({ dir, install = npmCi, log = console.log, warn = console.error, now = Date.now }) {
  let running = null;
  let failedAt = 0;
  /** 없는 것이 있으면 다시 설치를 시작하고 그 약속(끝나면 true/false)을, 고칠 것이 없거나 실패 뒤 쉬는 중이면 null 을 돌려준다 */
  function check(why) {
    if (running) return running;
    const miss = missingDeps(dir);
    if (!miss.length) return null;
    if (failedAt && now() - failedAt < RETRY_MS) return null;
    log(`[pi-remote] 모듈 폴더에 없는 것이 있어 다시 설치합니다(${why}: ${miss.join(", ")})`);
    const job = (async () => {
      try {
        await install(dir);
        const left = missingDeps(dir);
        if (left.length) throw new Error(`설치한 뒤에도 없음: ${left.join(", ")}`);
        failedAt = 0;
        log("[pi-remote] 모듈 다시 설치 끝");
        return true;
      } catch (e) {
        failedAt = now();
        warn(`[pi-remote] 모듈 다시 설치 실패(${RETRY_MS / 60_000}분 뒤 다시): ${e.message}`);
        return false;
      }
    })();
    running = job;
    // 설치가 곧바로 던져도(기다리기 전에 끝나도) 표시가 풀리도록 붙인 뒤에 푼다
    job.finally(() => { if (running === job) running = null; });
    return job;
  }
  return { check };
}
