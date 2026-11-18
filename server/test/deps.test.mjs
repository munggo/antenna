// 모듈 폴더 지키기 시험(server/deps.mjs). 임시 폴더에 가짜 모듈 폴더를 만들어 쓴다(진짜 설치·네트워크 없음).
// 실행: node server/test/deps.test.mjs
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDepsGuard, missingDeps, RETRY_MS } from "../deps.mjs";

const D = mkdtempSync(join(tmpdir(), "antenna-deps-"));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const helperDir = join(D, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`);
const mac = process.platform === "darwin";

/** 가짜 설치: 모듈 셋과 node-pty 의 보조 실행 파일을 만든다 */
const fakeInstall = () => {
  for (const m of ["node-pty", "ws", "@scope/pkg"]) {
    mkdirSync(join(D, "node_modules", m), { recursive: true });
    writeFileSync(join(D, "node_modules", m, "package.json"), "{}");
  }
  mkdirSync(helperDir, { recursive: true });
  writeFileSync(join(helperDir, "pty.node"), "");
  writeFileSync(join(helperDir, "spawn-helper"), "#!/bin/sh\n");
  chmodSync(join(helperDir, "spawn-helper"), 0o755);
};

try {
  // ── 무엇이 없는지 ──
  ok(same(missingDeps(D), ["package.json"]), "package.json 이 없으면 그것부터");
  writeFileSync(join(D, "package.json"), JSON.stringify({ dependencies: { "node-pty": "1", ws: "8", "@scope/pkg": "1" } }));
  ok(same(missingDeps(D), ["node-pty", "ws", "@scope/pkg"]), "모듈 폴더가 통째로 없으면 모두(범위 붙은 이름도)");
  fakeInstall();
  ok(same(missingDeps(D), []), "다 있으면 빈 목록");
  if (mac) {
    chmodSync(join(helperDir, "spawn-helper"), 0o644);
    ok(same(missingDeps(D), ["node-pty/spawn-helper"]), "보조 실행 파일을 실행할 수 없으면 그것");
    rmSync(join(helperDir, "spawn-helper"));
    ok(same(missingDeps(D), ["node-pty/spawn-helper"]), "보조 실행 파일만 지워져도 알아챔(이번 일)");
  }
  rmSync(join(D, "node_modules", "ws"), { recursive: true });
  ok(missingDeps(D).includes("ws"), "모듈 하나만 지워져도 알아챔");

  // ── 다시 설치 ──
  const logs = [];
  let t = 1_000_000;
  let calls = 0;
  let mode = "ok";
  const install = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    if (mode === "fail") throw new Error("네트워크 없음");
    if (mode === "throw-now") throw new Error("곧바로 실패");
    if (mode === "partial") return;   // 설치는 끝났다는데 여전히 없음
    fakeInstall();
  };
  const g = createDepsGuard({ dir: D, install, log: (s) => logs.push(s), warn: (s) => logs.push(s), now: () => t });

  rmSync(join(D, "node_modules"), { recursive: true });
  const a = g.check("시험");
  const b = g.check("또");
  ok(a && a === b, "설치하는 동안 다시 불러도 같은 설치를 기다림(한 번에 하나)");
  ok(await a === true && calls === 1 && same(missingDeps(D), []), "없으면 설치하고, 끝나면 다 있음");
  ok(logs.some((l) => l.includes("시험: node-pty")) && logs.some((l) => l.includes("다시 설치 끝")), "왜·무엇이 없어 설치하는지 기록");
  ok(g.check("고칠 것 없음") === null && calls === 1, "다 있으면 아무것도 하지 않음");

  rmSync(join(D, "node_modules"), { recursive: true });
  mode = "fail";
  ok(await g.check("실패 시험") === false && logs.at(-1).includes("네트워크 없음"), "설치에 실패하면 false 와 까닭을 기록");
  t += RETRY_MS - 1;
  ok(g.check("바로 다시") === null && calls === 2, `실패 뒤 ${RETRY_MS / 60_000}분 안에는 다시 하지 않음(네트워크가 없을 때 계속 두드리지 않게)`);
  t += 2;
  mode = "partial";
  ok(await g.check("쉰 뒤") === false && calls === 3 && logs.at(-1).includes("설치한 뒤에도 없음"), "쉰 뒤에는 다시 하고, 설치 뒤에도 없으면 실패로 봄");
  t += RETRY_MS;
  mode = "ok";
  ok(await g.check("다시") === true && calls === 4, "나중에 되면 고쳐짐");

  // 설치 함수가 기다리기 전에 곧바로 던져도 '설치 중'이 풀린다
  rmSync(join(D, "node_modules"), { recursive: true });
  let syncCalls = 0;
  const g2 = createDepsGuard({ dir: D, install: () => { syncCalls++; throw new Error("즉시"); }, log: () => {}, warn: () => {}, now: () => t });
  ok(await g2.check("즉시 실패") === false, "곧바로 던지는 설치도 실패로 처리");
  t += RETRY_MS + 1;
  ok(await g2.check("쉰 뒤") === false && syncCalls === 2, "곧바로 던진 뒤에도 '설치 중'에 묶이지 않고 다시 시도함");
} finally {
  rmSync(D, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
