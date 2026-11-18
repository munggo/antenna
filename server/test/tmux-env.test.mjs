// 브리지가 띄운 tmux 서버에 브리지 전용 설정이 새지 않는지(server/tabs-restore.mjs 의 tmuxServerEnv·createSession).
// 따로 띄운 tmux 서버(-L 소켓)만 쓴다: 쓰는 tmux 서버는 건드리지 않음. 끝나면 그 서버와 소켓 파일을 지운다.
// 실행: node server/test/tmux-env.test.mjs
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, tmuxServerEnv } from "../tabs-restore.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const SOCK = `antenna-env-${process.pid}`;
const D = mkdtempSync(join(tmpdir(), "antenna-tmux-env-"));
// createSession 이 부르는 tmux 를 따로 띄운 서버로 돌리는 감싸개
const wrap = join(D, "tmux");
writeFileSync(wrap, `#!/bin/sh\nexec tmux -L ${SOCK} -f /dev/null "$@"\n`);
chmodSync(wrap, 0o755);
const tm = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const sample = { PATH: "/usr/bin:/bin", HOME: "/Users/x", LANG: "ko_KR.UTF-8", SSH_AUTH_SOCK: "/tmp/a", PI_REMOTE_TLS_ONLY: "1", PI_REMOTE_APNS_KEY: "x",
  PI_TMUX_SESSION: "antenna", HOST: "0.0.0.0", PORT: "8787", XPC_SERVICE_NAME: "com.munggo.pi-remote", XPC_FLAGS: "0x0", OSLogRateLimit: "64", PI_BIN: "/opt/pi" };
const clean = tmuxServerEnv(sample);
ok(JSON.stringify(Object.keys(clean).sort()) === JSON.stringify(["HOME", "LANG", "PATH", "PI_BIN", "SSH_AUTH_SOCK"]),
  `브리지 전용 설정(PI_REMOTE_*·PI_TMUX_SESSION·HOST·PORT·launchd 값)만 빼고 나머지는 그대로(${Object.keys(clean).join(", ")})`);

const saved = { ...process.env };
try {
  // 브리지처럼 설정 값을 가진 채로 서버를 띄운다
  Object.assign(process.env, { PI_REMOTE_TLS_ONLY: "1", PI_REMOTE_APNS_KEY: "secret-path", PI_TMUX_SESSION: "antenna", HOST: "0.0.0.0", PORT: "8787", PI_REMOTE_TEST_KEEP_OUT: "x" });
  createSession(wrap, "envtest");
  const names = tm("show-environment", "-g").split("\n").map((l) => l.replace(/^-/, "").split("=")[0]);
  const leaked = names.filter((n) => n.startsWith("PI_REMOTE_") || ["PI_TMUX_SESSION", "HOST", "PORT"].includes(n));
  ok(leaked.length === 0, `새로 띄운 tmux 서버의 전역 환경에 브리지 설정이 없음(샌 것: ${leaked.join(", ") || "없음"})`);
  ok(names.includes("PATH") && names.includes("HOME"), "PATH·HOME 같은 평범한 값은 그대로");
  // 새 탭을 열어 그 셸의 환경을 파일에 적게 함(탭이 실제로 받는 환경)
  const out = join(D, "pane-env");
  tm("new-window", "-d", "-t", "envtest:", `sh -c 'printf "%s|%s" "\${PORT-없음}" "\${PI_REMOTE_TLS_ONLY-없음}" > ${out}'`);
  let inPane = "";
  for (let i = 0; i < 40 && !inPane; i++) { execFileSync("sleep", ["0.1"]); try { inPane = execFileSync("cat", [out], { encoding: "utf8" }); } catch { /* 아직 */ } }
  ok(inPane === "없음|없음", `새 탭의 셸에도 PORT·암호화만 설정이 없음(${inPane})`);
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  let sock = "";
  try { sock = tm("display-message", "-p", "#{socket_path}"); } catch { /* 서버 없음 */ }
  try { tm("kill-server"); } catch { /* 이미 꺼짐 */ }
  if (sock.includes(SOCK)) rmSync(sock, { force: true });
  rmSync(D, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
