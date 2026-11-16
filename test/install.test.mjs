// 설치 명령 시험(sh install.sh): 아무것도 없는 새 맥을 흉내 낸 가짜 홈에서 처음부터 끝까지 돌려 본다.
// - 가짜 홈(설정·Claude Code·pi 가 없음), 따로 띄운 tmux(소켓 폴더를 바꿈 → 내 tmux 설정 없이 기본 설정), 시험 세션·시험 포트
// - 자동 실행 등록은 하지 않는다(--no-agent: 등록은 이 맥의 실제 로그인 항목이라 시험에서 건드리지 않음). 브리지는 직접 켠다
// - 쓰는 브리지·쓰는 tmux 세션·내 설정은 건드리지 않는다. 실행: node test/install.test.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(REPO, "server/package.json"))("ws");
const { createDeviceStore } = await import(join(REPO, "server/devices.mjs"));
const ROOT = `/tmp/antenna-install-${process.pid}`;
const S = "installtest", PORT = 8793;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const realTmux = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find(existsSync) ?? execFileSync("/bin/sh", ["-c", "command -v tmux"], { encoding: "utf8" }).trim();
const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();

/** 새 맥 하나: 가짜 홈과, node·tmux 만 있는 실행 폴더 */
const mac = (name) => {
  const dir = `${ROOT}/${name}`, home = `${dir}/home`, bin = `${dir}/bin`;
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(`${dir}/tmux`, { recursive: true });
  symlinkSync(process.execPath, `${bin}/node`);
  symlinkSync(realTmux, `${bin}/tmux`);
  const env = { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMUX_TMPDIR: `${dir}/tmux`, LANG: "ko_KR.UTF-8", SHELL: "/bin/zsh",
    PI_REMOTE_AGENT_LABEL: "com.example.antenna-test-not-installed" };
  const envFile = `${home}/.config/pi-remote/env`;
  return {
    dir, home, bin, env, envFile,
    install: (...args) => spawnSync("/bin/sh", [join(REPO, "install.sh"), ...args], { encoding: "utf8", env, timeout: 120000 }),
    conf: () => Object.fromEntries(readFileSync(envFile, "utf8").split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])),
    mode: () => (statSync(envFile).mode & 0o777).toString(8),
    tmux: (...a) => { try { return execFileSync(realTmux, ["-S", `${dir}/tmux/tmux-${uid}/default`, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } },
  };
};
const HOOK_EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"];

rmSync(ROOT, { recursive: true, force: true });
let bridge = null;
const m = mac("plain");
try {
  // ── 1. 아무것도 없는 맥(Claude Code·pi 없음) ──
  let r = m.install("--no-agent");
  ok(r.status === 0 && r.stdout.includes("설치가 끝났어요"), `처음 설치가 끝까지 감${r.status === 0 ? "" : ` (끝 코드 ${r.status})\n${(r.stdout + r.stderr).slice(-600)}`}`);
  const c1 = existsSync(m.envFile) ? m.conf() : {};
  ok(c1.PI_TMUX_SESSION === "antenna" && c1.PORT === "8787" && c1.PI_REMOTE_NODE === `${m.bin}/node` && c1.PI_REMOTE_TLS_ONLY === "1" && !("PI_REMOTE_HOSTS" in c1) && !("PI_REMOTE_TOKEN" in c1),
    `설정 파일을 만듦(세션 antenna, 포트 8787, 브리지용 node, 암호화 연결만. 맥 주소는 비워 두고, 공유 토큰은 만들지 않음)`);
  ok(m.mode() === "600", `설정 파일은 나만 읽을 수 있음(권한 ${m.mode()})`);
  ok(r.stdout.includes("Claude Code 가 없어 건너뜀") && r.stdout.includes("pi 가 없어 건너뜀") && !existsSync(`${m.home}/.claude`) && !existsSync(`${m.home}/.pi`), "Claude Code·pi 가 없으면 그 폴더를 만들지 않고 건너뜀");
  ok(r.stdout.includes("이미 깔려 있음") && r.stdout.includes("자동 실행에 등록하지 않았어요") && !existsSync(`${m.home}/Library/LaunchAgents`), "모듈이 이미 있으면 다시 깔지 않고, --no-agent 면 자동 실행에 등록하지 않음");
  ok(r.stdout.includes("같은 Wi-Fi 에서만") && r.stdout.includes("--host"), "맥 주소가 없으면 밖에서 쓰는 법을 알려 줌");
  ok(r.stdout.includes("sh deploy/pair.sh") && r.stdout.includes("tmux attach -t antenna"), "끝에 다음 할 일(QR·tmux)을 알려 줌");

  // ── 2. 다시 돌려도 그대로 ──
  const before = readFileSync(m.envFile, "utf8");
  r = m.install("--no-agent");
  ok(r.status === 0 && readFileSync(m.envFile, "utf8") === before && r.stdout.includes("이미 있음"), "다시 돌려도 설정 파일이 그대로");

  // ── 3. 맥 주소 적기·바꾸기 ──
  r = m.install("--no-agent", "--host", "100.64.1.2,mac.example.net");
  let c = m.conf();
  ok(r.status === 0 && c.PI_REMOTE_HOSTS === "100.64.1.2,mac.example.net" && c.PI_REMOTE_NODE === c1.PI_REMOTE_NODE && m.mode() === "600", "--host 로 맥 주소를 적음(다른 값·권한은 그대로)");
  r = m.install("--no-agent", "--host", "100.64.9.9");
  c = m.conf();
  const text = readFileSync(m.envFile, "utf8");
  ok(c.PI_REMOTE_HOSTS === "100.64.9.9" && (text.match(/^PI_REMOTE_HOSTS=/gm) ?? []).length === 1 && c.PORT === "8787" && c.PI_REMOTE_NODE === c1.PI_REMOTE_NODE && text.startsWith("# Antenna") && m.mode() === "600",
    "맥 주소를 바꾸면 그 줄만 바뀜(다른 줄·주석·권한 그대로)");
  for (const [args, what] of [[["--host", "1.2.3.4;rm -rf x"], "위험한 글자가 든 주소"], [["--host"], "주소 없는 --host"], [["--oops"], "모르는 옵션"]]) {
    const b = readFileSync(m.envFile, "utf8");
    r = m.install("--no-agent", ...args);
    ok(r.status === 1 && readFileSync(m.envFile, "utf8") === b, `${what}: 그만두고 설정을 건드리지 않음`);
  }
  chmodSync(m.envFile, 0o644);
  r = m.install("--no-agent");
  ok(r.status === 0 && m.mode() === "600" && r.stdout.includes("600"), "설정 파일을 남이 읽을 수 있게 돼 있으면 600 으로 되돌림");
  // 브리지용 node 가 없어진 경우(판을 바꿔 깔았을 때): 지금 node 로 다시 적음
  writeFileSync(m.envFile, readFileSync(m.envFile, "utf8").replace(/^PI_REMOTE_NODE=.*$/m, "PI_REMOTE_NODE=/no/such/node"));
  r = m.install("--no-agent");
  ok(r.status === 0 && m.conf().PI_REMOTE_NODE === `${m.bin}/node`, "설정의 node 가 없어졌으면 지금 node 로 다시 적음");

  // ── 4. 설치한 그대로 브리지를 켜 봄(기본 tmux 설정) ──
  // 시험 세션·시험 포트로만 바꾼다(쓰는 브리지의 포트·쓰는 세션 이름과 겹치지 않게)
  writeFileSync(m.envFile, readFileSync(m.envFile, "utf8").replace(/^PI_TMUX_SESSION=.*$/m, `PI_TMUX_SESSION=${S}`).replace(/^PORT=.*$/m, `PORT=${PORT}`).replace(/^HOST=.*$/m, "HOST=127.0.0.1")
    .replace(/^PI_REMOTE_HOSTS=.*$/m, "PI_REMOTE_HOSTS=127.0.0.1"));   // 맥 주소는 어느 맥에나 있는 주소로(점검이 '이 맥에 올라와 있음'으로 보게)
  bridge = spawn("/bin/bash", [join(REPO, "server/run.sh")], {
    env: { ...m.env, PI_BIN: `${m.dir}/no-such/pi`, PI_PKG: `${m.dir}/no-such/pi-pkg`, PI_REMOTE_PUSH_DRYRUN: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  let exited = null;
  bridge.stdout.on("data", (d) => (log += d));
  bridge.stderr.on("data", (d) => (log += d));
  bridge.on("exit", (code) => (exited = code));
  for (let i = 0; i < 60 && !/브리지 시작/.test(log) && exited === null; i++) await sleep(250);
  ok(/브리지 시작/.test(log) && exited === null, `설치한 설정·node 로 브리지가 뜸${exited !== null ? ` (끝 코드 ${exited})\n${log.slice(-400)}` : ""}`);
  ok(m.tmux("has-session", "-t", `=${S}`) !== null, "브리지가 tmux 세션을 스스로 만듦(따로 띄운 tmux 에)");
  // 짝짓기: 짝짓기 명령이 QR 을 찍고(코드가 맥에 등록됨), 폰이 그 코드를 내면 폰만의 토큰을 받는다
  const p = spawnSync("/bin/bash", [join(REPO, "deploy/pair.sh")], { encoding: "utf8", input: "", env: { ...m.env, TERM: "xterm" } });
  ok(p.status === 0 && p.stdout.includes("\x1b[38;5;16;48;5;231m") && existsSync(`${m.home}/.config/pi-remote/pairing.json`), "설치 뒤 짝짓기 명령이 QR 을 찍고 짝짓기 코드를 등록함");
  // QR 을 읽을 수 없으니(화면 글), 같은 설정 폴더에서 코드를 새로 만들어 폰처럼 낸다
  const code = createDeviceStore(`${m.home}/.config/pi-remote`).startPairing().code;
  // 이 맥의 인증서만 믿는다(폰이 QR 로 받은 지문의 맥만 믿는 것과 같은 뜻)
  const trust = { ca: readFileSync(`${m.home}/.config/pi-remote/tls/cert.pem`, "utf8"), checkServerIdentity: () => undefined };
  const paired = await new Promise((res) => {
    const pw = new WebSocket(`wss://127.0.0.1:${PORT}/pair`, trust);
    pw.on("open", () => pw.send(JSON.stringify({ type: "pair", code, name: "시험 폰" })));
    pw.on("message", (d) => { try { res(JSON.parse(String(d))); } catch { res({}); } });
    pw.on("error", () => res({}));
    setTimeout(() => res({}), 6000);
  });
  const TOKEN = paired.token ?? "";
  ok(paired.type === "paired" && /^[0-9a-f]{64}$/.test(TOKEN), "폰이 코드를 내고 이 폰만의 토큰을 받음");
  const plainTry = await new Promise((res) => {
    const pw = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=80&rows=24`);
    pw.on("open", () => res("붙음"));
    pw.on("error", () => res("못 붙음"));
    setTimeout(() => res("답 없음"), 3000);
  });
  ok(plainTry === "못 붙음", "새 설치는 암호화 연결만 받음(암호화 없이는 토큰이 맞아도 못 붙음)");
  const ws = new WebSocket(`wss://127.0.0.1:${PORT}/?cols=100&rows=30`, { ...trust, headers: { Authorization: `Bearer ${TOKEN}` } });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const got = {};
  let screen = "";
  ws.on("message", (data, isBinary) => {
    if (isBinary) { screen += data.toString("utf8"); return; }
    try { const j = JSON.parse(data.toString()); got[j.type] = j; } catch { /* 줄 단위가 아닌 글 */ }
  });
  const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 200) { if (fn()) return true; await sleep(200); } return false; };
  ok(await waitFor(() => got.windows?.windows?.length >= 1, 6000), `폰처럼 붙으면 탭 목록이 옴(${got.windows?.windows?.length ?? 0}개)`);
  await sleep(1500);
  ws.send(Buffer.from("echo install-$((40+2))-ok\r"));
  ok(await waitFor(() => screen.includes("install-42-ok"), 8000), "터미널 입출력이 오감(내 tmux 설정 없이 기본 설정에서)");
  ws.send(JSON.stringify({ type: "new-window" }));
  ok(await waitFor(() => got.windows?.windows?.length >= 2, 6000), "새 탭을 열 수 있음");
  const bad = new WebSocket(`wss://127.0.0.1:${PORT}/?token=${"0".repeat(64)}&cols=80&rows=24`, trust);
  const refused = await new Promise((res) => { bad.on("open", () => setTimeout(() => res(bad.readyState !== 1), 800)); bad.on("error", () => res(true)); bad.on("close", () => res(true)); });
  ok(refused, "틀린 토큰으로는 붙지 못함");
  ws.close();

  // 점검 명령: 직접 켠 브리지를 문제로 보지 않음(자동 실행 등록은 없는 이름으로 봄)
  const d = spawnSync(process.execPath, [join(REPO, "deploy/doctor.mjs")], { encoding: "utf8", env: m.env, timeout: 60000 });
  ok(d.stdout.includes("직접 실행 중") && d.stdout.includes(`포트 ${PORT} 열림`) && d.stdout.includes(`tmux 세션 '${S}' 있음`) && d.stdout.includes("짝지은 기기 1대") && d.stdout.includes("암호화 연결만 받음"), "점검: 직접 켠 브리지·포트·세션·짝지은 기기·암호화를 확인");
  ok(d.status === 0 && d.stdout.includes("문제 없음"), `점검: 새로 설치한 맥에서 문제 없음${d.status === 0 ? "" : `\n${d.stdout.split("\n").filter((l) => l.includes("✗")).join("\n")}`}`);
  ok(!d.stdout.includes(TOKEN) && !readFileSync(`${m.home}/.config/pi-remote/devices.json`, "utf8").includes(TOKEN), "점검 화면에도 맥의 기기 파일에도 토큰 원문이 없음");
  bridge.kill("SIGTERM");
  await sleep(600);
  bridge = null;

  // ── 5. Claude Code 를 쓰는 맥 ──
  const cc = mac("claude");
  mkdirSync(`${cc.home}/.claude`, { recursive: true });
  const mine = { model: "opus", hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo mine" }] }] } };
  writeFileSync(`${cc.home}/.claude/settings.json`, JSON.stringify(mine));
  r = cc.install("--no-agent");
  let s = {};
  try { s = JSON.parse(readFileSync(`${cc.home}/.claude/settings.json`, "utf8")); } catch { /* 아래에서 실패로 봄 */ }
  const ours = (ev) => (s.hooks?.[ev] ?? []).flatMap((g) => g.hooks ?? []).filter((h) => String(h.command).includes("pi-remote-hook.mjs"));
  ok(r.status === 0 && HOOK_EVENTS.every((e) => ours(e).length === 1), "Claude Code 가 있으면 훅 8가지를 하나씩 검");
  ok(s.model === "opus" && JSON.stringify(s.hooks?.Stop ?? "").includes("echo mine"), "원래 있던 설정·훅은 그대로");
  ok(ours("Stop")[0]?.command === `"${cc.bin}/node" "${cc.home}/.claude/pi-remote/pi-remote-hook.mjs"`, "훅은 설치할 때 고른 node 로 돎");
  ok(["claude-feed.mjs", "pi-remote-hook.mjs", "claude-account.mjs", "bg-launch.mjs", "sudo-check.mjs", "sudo-run.mjs", "sudo-tab.sh", "sudo-rules.mjs", "claude-account"].every((f) => existsSync(`${cc.home}/.claude/pi-remote/${f}`)) && existsSync(`${cc.home}/.claude/commands/bgtab.md`),
    "연결부·훅 파일과 백그라운드 탭 명령을 설치함");
  r = cc.install("--no-agent");
  try { s = JSON.parse(readFileSync(`${cc.home}/.claude/settings.json`, "utf8")); } catch { s = {}; }
  ok(r.status === 0 && HOOK_EVENTS.every((e) => ours(e).length === 1), "다시 돌려도 훅이 겹쳐 들어가지 않음");
  // 설정 파일이 아직 없는 맥(Claude Code 를 깔기만 함)
  const fresh = mac("claude-fresh");
  mkdirSync(`${fresh.home}/.claude`, { recursive: true });
  r = fresh.install("--no-agent");
  try { s = JSON.parse(readFileSync(`${fresh.home}/.claude/settings.json`, "utf8")); } catch { s = {}; }
  ok(r.status === 0 && HOOK_EVENTS.every((e) => ours(e).length === 1), "Claude Code 설정 파일이 없으면 만들어서 훅을 검");

  // ── 6. pi 를 쓰는 맥 ──
  const pm = mac("pi");
  const EXT = `${pm.home}/.pi/agent/extensions`;
  mkdirSync(EXT, { recursive: true });
  writeFileSync(`${EXT}/my-own.ts`, "// 내 확장\n");
  writeFileSync(`${EXT}/todos.ts`, "// 예전 판\n");
  r = pm.install("--no-agent");
  const BASE = ["pi-remote-feed.ts", "send-guard.ts", "ask-user.ts", "todos.ts", "plan-mode.ts", "artifacts.ts", "bgtab.ts", "sudo-tab.sh", "lib/choice-box.ts", "lib/readonly.ts", "lib/sudo-rules.mjs"];
  const sameAs = (f, src = `pi-extension/${f}`) => existsSync(`${EXT}/${f}`) && readFileSync(`${EXT}/${f}`).equals(readFileSync(join(REPO, src)));
  ok(r.status === 0 && BASE.every((f) => sameAs(f)) && sameAs("lib/bg-launch.mjs", "claude-remote/bg-launch.mjs"), "pi 가 있으면 폰 화면에 필요한 확장을 저장소와 같은 내용으로 설치");
  ok((statSync(`${EXT}/sudo-tab.sh`).mode & 0o111) !== 0, "관리자 권한 창 스크립트는 실행할 수 있게");
  ok(!existsSync(`${EXT}/web.ts`) && !existsSync(`${EXT}/claude-accounts.ts`) && !existsSync(`${EXT}/compact-tools.ts`) && !existsSync(`${EXT}/subagent`), "선택 확장은 기본으로 깔지 않음");
  ok(readFileSync(`${EXT}/my-own.ts`, "utf8") === "// 내 확장\n", "내가 둔 다른 확장은 건드리지 않음");
  const bk = `${pm.home}/.cache/pi-remote/backup`;
  const kept = existsSync(bk) ? readdirSync(bk).map((t) => `${bk}/${t}${EXT}/todos.ts`).filter(existsSync) : [];
  ok(kept.length === 1 && readFileSync(kept[0], "utf8") === "// 예전 판\n", "내용이 다르던 파일은 덮어쓰기 전에 따로 남김");
  const ext = (...a) => spawnSync("/bin/sh", [join(REPO, "pi-extension/install.sh"), ...a], { encoding: "utf8", env: pm.env });
  r = ext();
  ok(r.status === 0 && r.stdout.includes("이미 모두 같은 내용"), "다시 돌리면 아무것도 바꾸지 않음");
  r = ext("--with", "web,subagent");
  ok(r.status === 0 && sameAs("web.ts") && sameAs("subagent/index.ts") && sameAs("subagent/agents.ts") && existsSync(`${pm.home}/.pi/agent/agents/planner.md`) && existsSync(`${pm.home}/.pi/agent/prompts/review.md`) && !existsSync(`${EXT}/claude-accounts.ts`),
    "--with 로 고른 선택 확장만 더 깖(하위 에이전트는 역할·명령 틀까지)");
  r = ext("--all");
  ok(r.status === 0 && sameAs("claude-accounts.ts") && sameAs("compact-tools.ts"), "--all 은 선택 확장을 모두 깖");
  r = ext("--with", "nope");
  ok(r.status === 1 && r.stderr.includes("nope"), "없는 선택 확장 이름은 받지 않음");
  r = ext("--list");
  ok(r.status === 0 && r.stdout.includes("pi-remote-feed.ts") && r.stdout.includes("claude-accounts"), "--list 는 무엇이 있는지만 보여 줌");
  // 점검 명령이 pi 확장 설치본을 저장소와 견줌(백그라운드 탭 실행기까지)
  writeFileSync(`${EXT}/lib/bg-launch.mjs`, "// 예전 판\n");
  const d2 = spawnSync(process.execPath, [join(REPO, "deploy/doctor.mjs")], { encoding: "utf8", env: pm.env, timeout: 60000 });
  ok(d2.stdout.includes("설치본이 저장소와 달라요: lib/bg-launch.mjs"), "점검: 설치본이 저장소와 다르면 알려 줌");
} catch (e) {
  ok(false, `시험 중 오류: ${e.stack ?? e.message}`);
} finally {
  bridge?.kill("SIGTERM");
  await sleep(400);
  m.tmux("kill-server");
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
