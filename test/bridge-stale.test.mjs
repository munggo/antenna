// 브리지가 옛 코드로 도는지 가리는 판정(deploy/bridge-stale.mjs) 시험: 새 판을 받은 뒤 설치 명령·점검이 브리지를 다시 시작할지 정하는 데 쓴다.
// 임시 폴더에 가짜 저장소(server/·claude-remote/)를 만들고 파일의 바뀐 시각을 정해 본다. 쓰는 브리지는 건드리지 않는다.
// 실행: node test/bridge-stale.test.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const { bridgeCodeFiles, staleSince, startedAt } = await import(join(REPO, "deploy", "bridge-stale.mjs"));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

const ROOT = `/tmp/antenna-bridge-stale-${process.pid}`;
const FAKE = `${ROOT}/repo`;
mkdirSync(`${FAKE}/server/test`, { recursive: true });
mkdirSync(`${FAKE}/claude-remote`, { recursive: true });
mkdirSync(`${FAKE}/deploy`, { recursive: true });
const T0 = Date.now() - 3600_000;   // 브리지가 뜬 때(한 시간 전)
const put = (rel, at) => { writeFileSync(`${FAKE}/${rel}`, "// 시험\n"); utimesSync(`${FAKE}/${rel}`, new Date(at), new Date(at)); };
const before = T0 - 600_000, after = T0 + 600_000;
try {
  for (const f of ["server/bridge.mjs", "server/push.mjs", "server/README.md", "server/test/x.test.mjs", "claude-remote/bg-launch.mjs", "claude-remote/claude-feed.mjs"]) put(f, before);
  const files = bridgeCodeFiles(FAKE).map((f) => f.replace(`${FAKE}/`, "")).sort();
  ok(files.join(",") === "claude-remote/bg-launch.mjs,server/bridge.mjs,server/push.mjs",
    `브리지가 읽는 코드: server 의 .mjs 와 백그라운드 탭 실행기만(시험·설명서·연결부는 아님) → ${files.join(", ")}`);
  ok(staleSince(T0, bridgeCodeFiles(FAKE)) === null, "브리지가 뜬 뒤 바뀐 코드가 없으면 지금 코드로 도는 것");
  put("server/push.mjs", after);
  ok(staleSince(T0, bridgeCodeFiles(FAKE)) === `${FAKE}/server/push.mjs`, "뜬 뒤에 server 의 코드가 바뀌었으면 옛 코드(바뀐 파일을 알려 줌)");
  put("server/push.mjs", before);
  put("claude-remote/bg-launch.mjs", after);
  ok(staleSince(T0, bridgeCodeFiles(FAKE)) === `${FAKE}/claude-remote/bg-launch.mjs`, "백그라운드 탭 실행기만 바뀌어도 옛 코드");
  put("claude-remote/bg-launch.mjs", before);
  put("server/README.md", after);
  put("server/test/x.test.mjs", after);
  put("claude-remote/claude-feed.mjs", after);
  ok(staleSince(T0, bridgeCodeFiles(FAKE)) === null, "브리지가 읽지 않는 파일(설명서·시험·연결부)이 바뀐 것은 상관없음");
  put("server/bridge.mjs", T0 + 500);
  ok(staleSince(T0, bridgeCodeFiles(FAKE)) === null, "뜬 때와 1초 안쪽 차이는 같은 때로 봄(시각을 초 단위로만 알 수 있음)");
  put("server/bridge.mjs", after);
  ok(staleSince(0, bridgeCodeFiles(FAKE)) === null, "브리지가 뜬 때를 모르면 다시 시작하라고 하지 않음");
  ok(staleSince(T0, [`${FAKE}/server/없는파일.mjs`]) === null, "없는 파일은 건너뜀");

  // 프로세스가 뜬 시각 읽기
  const mine = startedAt(process.pid);
  ok(mine > Date.now() - 600_000 && mine <= Date.now(), `이 시험 프로세스가 뜬 시각을 읽음(${Math.round((Date.now() - mine) / 1000)}초 전)`);
  ok(startedAt(999_999_999) === 0, "없는 프로세스는 0");

  // 명령으로: 설치 명령이 이렇게 부른다. 판정 파일을 가짜 저장소의 deploy/ 에 두면 그 저장소를 본다
  copyFileSync(join(REPO, "deploy", "bridge-stale.mjs"), `${FAKE}/deploy/bridge-stale.mjs`);
  const run = (pid) => spawnSync(process.execPath, [`${FAKE}/deploy/bridge-stale.mjs`, String(pid)], { encoding: "utf8" });
  put("server/bridge.mjs", Date.now());
  const stale = run(1);   // 프로세스 1 은 맥이 켜질 때 뜸: 방금 바꾼 파일보다 먼저
  ok(stale.status === 0 && stale.stdout.trim() === "bridge.mjs", `옛 코드면 바뀐 파일 이름을 찍고 끝 코드 0(${JSON.stringify(stale.stdout.trim())}, ${stale.status})`);
  for (const f of ["server/bridge.mjs", "server/push.mjs", "claude-remote/bg-launch.mjs"]) put(f, 86_400_000);   // 아주 오래전(1970-01-02)에 바뀐 코드
  const fresh = run(process.pid);
  ok(fresh.status === 1 && fresh.stdout.trim() === "", `지금 코드면 아무것도 찍지 않고 끝 코드 1(${fresh.status})`);
  const none = run(999_999_999);
  ok(none.status === 1 && none.stdout.trim() === "", "없는 프로세스 번호면 끝 코드 1(다시 시작하지 않음)");
  ok(run("").status === 1, "프로세스 번호를 주지 않아도 끝 코드 1");
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
