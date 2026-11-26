#!/usr/bin/env node
/**
 * Antenna 점검: 맥 쪽이 제대로 깔려 돌고 있는지 한 번에 본다.
 *   node deploy/doctor.mjs         점검만(아무것도 바꾸지 않음)
 *   node deploy/doctor.mjs --fix   안전하게 고칠 수 있는 것은 고침: 지워진 브리지 모듈 다시 설치, 설치본을 저장소와 맞춤, 코드가 바뀐 뒤 다시 시작하지 않은 브리지 다시 시작,
 *                                  쉬는 탭의 옛 연결부 다시 띄우기(작업 중·답을 기다리는 탭은 건드리지 않음)
 * 보는 것: 필요한 프로그램 · 설정 파일 · 브리지(등록·실행·포트·죽은 기록·지금 코드인지) · 자동 실행 등록 ·
 *          Claude Code 연결(훅·설치본·탭마다 도는 연결부의 판) · pi 확장 설치본
 * 비밀값(토큰·키)은 읽어서 있는지만 보고 화면에 내지 않는다. 문제가 있으면 끝 코드 1
 * 작성: 서문교
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeviceStore } from "../server/devices.mjs";
import { missingDeps } from "../server/deps.mjs";
import { staleSince, startedAt } from "./bridge-stale.mjs";
import { accountsMixed, MIXED_TEXT, mixedDirection } from "../server/usage-history.mjs";

const FIX = process.argv.includes("--fix");
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.HOME ?? "";
const ENV_FILE = process.env.PI_REMOTE_ENV || `${HOME}/.config/pi-remote/env`;
const BRIDGE_LABEL = process.env.PI_REMOTE_AGENT_LABEL || "com.munggo.pi-remote";   // 시험: 없는 이름을 주면 '등록하지 않은 맥'으로 봄
const CACHE = `${HOME}/.cache/pi-remote`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, opt = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"], ...opt }).trim();
  } catch (e) {
    return opt.orOutput ? `${e.stdout ?? ""}`.trim() : null;
  }
};
const same = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
const short = (p) => p.replace(HOME, "~");

let problems = 0;
let fixed = 0;
const head = (t) => console.log(`\n${t}`);
const good = (t) => console.log(`  ✓ ${t}`);
const note = (t) => console.log(`  · ${t}`);
const bad = (t, how) => {
  problems++;
  console.log(`  ✗ ${t}${how ? `\n      → ${how}` : ""}`);
};
const did = (t) => {
  fixed++;
  console.log(`      고침: ${t}`);
};

// 설정 파일의 값(아래 여러 곳에서 씀. 파일이 없으면 빈 값)
const env = {};
if (existsSync(ENV_FILE)) {
  for (const l of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

// ── 필요한 프로그램 ──
head("필요한 프로그램");
const tmuxBin = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? sh("/bin/sh", ["-c", "command -v tmux"]);
const tmux = (...a) => (tmuxBin ? sh(tmuxBin, a) : null);
if (tmuxBin) good(`${sh(tmuxBin, ["-V"]) ?? "tmux"} (${tmuxBin})`);
else bad("tmux 가 없어요", "brew install tmux");
// 브리지가 쓰는 node: server/run.sh 와 같은 규칙(설정의 PI_REMOTE_NODE → PATH → Homebrew 자리)
const pinned = (env.PI_REMOTE_NODE ?? "").replace(/^~(?=\/)/, HOME).replace(/^\$HOME(?=\/)/, HOME);
if (pinned && !existsSync(pinned)) bad(`설정의 PI_REMOTE_NODE 가 가리키는 node 가 없어요(${short(pinned)})`, "sh install.sh (지금 node 로 다시 적어 줌)");
const bridgeNode = (pinned && existsSync(pinned) ? pinned : null) ?? sh("/bin/sh", ["-c", "command -v node"])
  ?? ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find((p) => existsSync(p)) ?? process.execPath;
good(`node ${sh(bridgeNode, ["-v"]) ?? "?"} (브리지가 쓰는 것: ${short(bridgeNode)})`);
if (!pinned && existsSync(ENV_FILE)) note("설정에 PI_REMOTE_NODE 가 없음: 자동 실행에서는 PATH 로 node 를 찾지 못할 수 있어요(sh install.sh 가 적어 줌)");
// 모듈 폴더: 통째로 없거나, node-pty 의 보조 실행 파일만 지워져도(11-18 용량 정리) 폰이 붙을 때 tmux 를 띄우지 못한다.
// 도는 브리지는 1분 안에 스스로 다시 설치하고(server/deps.mjs), 켤 때는 server/run.sh 가 설치한다
const missing = missingDeps(join(REPO, "server"));
if (missing.length) {
  bad(`브리지에 필요한 모듈이 없어요(${missing.join(", ")})`, "(cd server && npm ci). 도는 브리지는 1분 안에 스스로 다시 설치해요");
  if (FIX) {
    const npm = join(dirname(bridgeNode), "npm");
    const out = sh(existsSync(npm) ? npm : "npm", ["ci", "--no-audit", "--no-fund"],
      { cwd: join(REPO, "server"), timeout: 300_000, env: { ...process.env, PATH: `${dirname(bridgeNode)}:${process.env.PATH ?? ""}` } });
    if (out !== null && !missingDeps(join(REPO, "server")).length) did("모듈을 잠금 파일대로 다시 설치함");
    else note("다시 설치하지 못했어요(네트워크를 확인한 뒤 다시)");
  }
} else if (sh(bridgeNode, ["-e", "require('node-pty'); require('ws'); require('bonjour-service'); require('qrcode-terminal')"], { cwd: join(REPO, "server") }) === null) {
  bad("브리지 모듈이 이 node 에서 읽히지 않아요(모듈이 더해졌거나 node 를 바꾼 뒤 다시 깔지 않았을 때)", "(cd server && npm install)");
} else good("브리지 모듈이 읽힘(node-pty·ws·bonjour-service·qrcode-terminal)");

// ── 설정 파일 ──
head(`설정 파일 ${short(ENV_FILE)}`);
if (!existsSync(ENV_FILE)) bad("설정 파일이 없어요", "sh install.sh");
else {
  const mode = (statSync(ENV_FILE).mode & 0o777).toString(8);
  if (mode === "600") good("나만 읽을 수 있음(권한 600)");
  else bad(`다른 사용자도 읽을 수 있어요(권한 ${mode})`, `chmod 600 ${short(ENV_FILE)}`);
  // 폰의 토큰은 기기마다 따로(짝짓기로 받음). 예전 방식의 공유 토큰이 남아 있으면 알려 준다
  const paired = createDeviceStore(dirname(ENV_FILE)).list();
  if (paired.length) good(`짝지은 기기 ${paired.length}대(보기·끊기: sh deploy/pair.sh --list)`);
  if (env.PI_REMOTE_TOKEN) note("예전 방식의 공유 토큰(PI_REMOTE_TOKEN)이 켜져 있음: 아직 다시 짝짓지 않은 폰이 이것으로 붙어요. 모든 폰을 새로 짝지었으면 그 줄을 지우고 브리지를 다시 시작(또는 폰 앱 메뉴의 '연결 토큰 바꾸기')");
  else if (!paired.length) note("아직 짝지은 폰이 없음: sh deploy/pair.sh 로 QR 을 띄워 폰으로 찍기");
  // 연결 암호화: 인증서는 브리지가 처음 뜰 때 만든다
  if (!existsSync(join(dirname(ENV_FILE), "tls/cert.pem"))) note("아직 인증서가 없음(브리지가 처음 뜰 때 만들어요)");
  else if (env.PI_REMOTE_TLS_ONLY === "1") good("암호화 연결만 받음");
  else note("암호화 없는 연결도 받는 중(예전 앱용). 모든 폰이 새 앱으로 짝지었으면 설정에 PI_REMOTE_TLS_ONLY=1 을 적고 브리지를 다시 시작");
  const hosts = String(env.PI_REMOTE_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (!hosts.length) note("맥 주소(PI_REMOTE_HOSTS)가 없음: 폰은 같은 Wi-Fi 에서만 맥을 찾아요. 밖에서 쓰려면 VPN·Tailscale 주소를 적고 QR 을 다시 찍기");
  else {
    const mine = new Set(Object.values(networkInterfaces()).flat().map((i) => i?.address));
    for (const h of hosts) {
      if (!/^[0-9.]+$|:/.test(h)) note(`맥 주소 ${h}(이름이라 이 맥의 주소인지는 확인하지 않음)`);
      else if (mine.has(h)) good(`맥 주소 ${h} 가 이 맥에 올라와 있음`);
      else bad(`맥 주소 ${h} 가 지금 이 맥에 없어요(VPN 이 내려갔거나 주소가 바뀜). 폰이 밖에서 붙지 못해요`, "VPN 을 다시 붙이거나 PI_REMOTE_HOSTS 를 고친 뒤 QR 다시 찍기");
    }
  }
  const apns = ["PI_REMOTE_APNS_KEY", "PI_REMOTE_APNS_KEY_ID", "PI_REMOTE_APNS_TEAM", "PI_REMOTE_APNS_TOPIC"];
  const have = apns.filter((k) => env[k]);
  if (!have.length) note("폰 알림 설정이 없음(알림 없이도 동작)");
  else if (have.length < apns.length) bad(`폰 알림 설정이 일부만 있어요(없는 것: ${apns.filter((k) => !env[k]).join(", ")})`, "docs/setup.ko.md 의 '알림'");
  else if (!existsSync(env.PI_REMOTE_APNS_KEY.replace(/^~/, HOME))) bad("폰 알림 키 파일이 없어요(PI_REMOTE_APNS_KEY 가 가리키는 파일)");
  else good("폰 알림 설정 있음");
}
const SESSION = env.PI_TMUX_SESSION || "antenna";   // 브리지(server/bridge.mjs)의 기본값과 같게
const PORT = Number(env.PORT || 8787);

// ── 브리지 ──
head("브리지");
const uid = sh("id", ["-u"]);
const lc = sh("launchctl", ["print", `gui/${uid}/${BRIDGE_LABEL}`]);
const bridgePid = Number(lc?.match(/^\s*pid = (\d+)/m)?.[1] ?? 0);
const open = await new Promise((res) => {
  const c = createConnection({ host: "127.0.0.1", port: PORT });
  const done = (v) => { c.destroy(); res(v); };
  c.on("connect", () => done(true));
  c.on("error", () => done(false));
  setTimeout(() => done(false), 2000);
});
if (!lc && open) note("자동 실행에 등록하지 않고 직접 실행 중(로그인하면 저절로 켜지게 하려면 sh deploy/install-agents.sh)");
else if (!lc) bad("자동 실행에 등록돼 있지 않아요", "sh deploy/install-agents.sh");
else if (!bridgePid) bad("등록은 돼 있지만 돌고 있지 않아요", `launchctl kickstart gui/${uid}/${BRIDGE_LABEL} · 기록: /tmp/pi-remote.err`);
else good(`돌고 있음(프로세스 ${bridgePid})`);
if (open) good(`포트 ${PORT} 열림`);
else bad(`포트 ${PORT} 가 열려 있지 않아요`);
// 새 판을 받거나 고친 뒤 다시 시작했는지: 브리지가 뜬 시각과 브리지 코드가 마지막으로 바뀐 시각(bridge-stale.mjs. install.sh 도 같은 판정으로 다시 시작함)
if (bridgePid) {
  const changed = staleSince(startedAt(bridgePid));
  if (changed) {
    bad(`브리지가 옛 코드로 돌고 있어요(${changed.split("/").pop()} 가 바뀐 뒤 다시 시작하지 않음)`, `launchctl kickstart -k gui/${uid}/${BRIDGE_LABEL} (또는 sh install.sh 를 다시)`);
    if (FIX) {
      sh("launchctl", ["kickstart", "-k", `gui/${uid}/${BRIDGE_LABEL}`]);
      await sleep(3000);
      did("브리지를 다시 시작함(폰 연결이 잠깐 끊겼다 다시 붙음)");
    }
  } else good("지금 코드로 돌고 있음");
}
const crashFile = `${CACHE}/crash.log`;
if (existsSync(crashFile)) {
  const lines = readFileSync(crashFile, "utf8").split("\n").filter(Boolean);
  const recent = lines.filter((l) => Date.now() - Date.parse(l.slice(0, 24)) < 86400_000);
  const died = recent.filter((l) => l.slice(25).startsWith("죽음"));
  if (died.length) bad(`최근 하루 동안 ${died.length}번 죽었다 다시 떴어요. 마지막: ${died.at(-1).slice(0, 160)}`, `기록: ${short(crashFile)}`);
  else if (recent.length) note(`최근 하루 동안 처리되지 않은 오류 ${recent.length}건(브리지는 계속 돎). 기록: ${short(crashFile)}`);
  else good("최근 하루 동안 죽은 기록 없음");
} else good("죽은 기록 없음");
if (tmuxBin) {
  if (tmux("has-session", "-t", `=${SESSION}`) !== null) good(`tmux 세션 '${SESSION}' 있음(창 ${tmux("list-windows", "-t", `=${SESSION}`)?.split("\n").length ?? 0}개)`);
  else bad(`tmux 세션 '${SESSION}' 이 없어요`, "브리지를 다시 시작하면 만들어요");
}

// ── 자동 실행 등록 ──
head("자동 실행 등록");
// 브리지와, 이미 설치해 둔 선택 기능만 본다(선택 기능을 쓰지 않는 것은 문제가 아님)
for (const l of (sh("sh", [join(REPO, "deploy/install-agents.sh"), "--check"], { orOutput: true }) ?? "").split("\n").filter(Boolean)) {
  if (l.includes("이미 같은 내용")) good(l.replace(": 이미 같은 내용으로 설치돼 있음(그대로 둠)", ""));
  else if (l.startsWith("pi-remote: 설치돼 있지 않아요")) note("브리지를 자동 실행에 등록하지 않음(위 '브리지' 참고)");
  else bad(l, `sh deploy/install-agents.sh ${l.split(":")[0]}`);
}

// ── Claude Code 연결 ──
head("Claude Code 연결");
const CC = `${HOME}/.claude/pi-remote`;
const settingsFile = `${HOME}/.claude/settings.json`;
if (!existsSync(`${HOME}/.claude`)) note("Claude Code 를 쓰지 않음(~/.claude 없음)");
else {
  const EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"];
  let hooks = {};
  try {
    hooks = JSON.parse(readFileSync(settingsFile, "utf8")).hooks ?? {};
  } catch {
    /* 아래에서 없는 것으로 봄 */
  }
  const missing = EVENTS.filter((e) => !JSON.stringify(hooks[e] ?? "").includes("pi-remote-hook.mjs"));
  // [저장소 안 파일, 설치된 이름]
  const pairs = [
    ...["claude-feed.mjs", "pi-remote-hook.mjs", "claude-account.mjs", "bg-launch.mjs", "sudo-check.mjs", "sudo-run.mjs"].map((f) => [`claude-remote/${f}`, f]),
    ["pi-extension/sudo-tab.sh", "sudo-tab.sh"], ["pi-extension/lib/sudo-rules.mjs", "sudo-rules.mjs"],
  ];
  const stale = pairs.filter(([src, name]) => !same(join(REPO, src), join(CC, name))).map(([, name]) => name);
  if (missing.length) bad(`훅이 걸려 있지 않아요(${missing.join(", ")})`, "sh claude-remote/install.sh");
  else good("훅 8가지가 걸려 있음");
  if (stale.length) bad(`설치본이 저장소와 달라요: ${stale.join(", ")}`, "sh claude-remote/install.sh");
  else good("설치본이 저장소와 같음");
  // 개인·회사 계정을 나눠 쓰는 맥: 개인 탭이 회사 계정으로 도는지(이 맥의 기본 로그인이 회사 계정으로 바뀐 경우)
  if (accountsMixed()) {
    const t = MIXED_TEXT[mixedDirection() ?? "unknown"];
    bad(`${t.title}(개인·회사 주간 사용률과 초기화 시각이 같음)`, t.body);
  }
  if (FIX && (missing.length || stale.length)) {
    sh("sh", [join(REPO, "claude-remote/install.sh")]);
    did("연결부·훅을 다시 설치함(쉬는 탭의 연결부는 30초쯤 뒤 스스로 새 판으로 바뀜)");
  }

  // 탭마다 도는 연결부의 판. 옛 연결부(판을 적지 않는 판)는 스스로 바뀌지 못하므로 쉬는 탭이면 다시 띄운다
  const installed = (() => {
    const h = createHash("sha1");
    for (const f of ["claude-feed.mjs", "claude-account.mjs", "bg-launch.mjs"]) if (existsSync(join(CC, f))) h.update(`${f}\n`).update(readFileSync(join(CC, f)));
    return h.digest("hex").slice(0, 8);
  })();
  const feeds = (sh("pgrep", ["-fl", "claude-feed\\.mjs %[0-9]+$"]) ?? "").split("\n").filter(Boolean)
    .map((l) => ({ pid: Number(l.split(" ")[0]), pane: l.match(/(%\d+)$/)?.[1] })).filter((f) => f.pane);
  // 칸 → Claude Code 세션 상태(~/.claude/sessions/<pid>.json)
  const sessions = {};
  try {
    for (const f of readdirSync(`${HOME}/.claude/sessions`).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(`${HOME}/.claude/sessions/${f}`, "utf8"));
      const pane = String(d.tmux ?? "").split(".").pop();
      if (pane?.startsWith("%")) sessions[pane] = d;
    }
  } catch {
    /* 세션 기록 없음 */
  }
  let old = 0;
  for (const f of feeds) {
    const revFile = `${CACHE}/feed/${f.pane.replace(/\W/g, "")}.rev`;
    const rev = existsSync(revFile) ? readFileSync(revFile, "utf8").trim() : "";
    if (rev === installed) continue;
    old++;
    const s = sessions[f.pane];
    const where = `${f.pane}${s?.cwd ? ` ${String(s.cwd).split("/").pop()}` : ""}`;
    const idle = s?.status === "idle";
    if (rev) note(`칸 ${where}: 연결부가 앞 판(${rev})으로 도는 중 — 쉬는 틈에 스스로 새 판으로 바뀜`);
    else if (!FIX || !idle) note(`칸 ${where}: 스스로 바뀌지 못하는 옛 연결부${idle ? "(쉬는 중: --fix 로 다시 띄울 수 있음)" : `(${s?.status ?? "상태 모름"}: 쉬게 되면 --fix 로 다시 띄우기)`}`);
    else {
      try {
        process.kill(f.pid, "SIGTERM");
      } catch {
        /* 이미 끝남 */
      }
      await sleep(700);
      const sock = `${CACHE}/feed/${f.pane.replace(/\W/g, "")}.sock`;
      if (existsSync(sock)) rmSync(sock);
      const e = { ...process.env };
      delete e.CLAUDE_CODE_OAUTH_TOKEN;
      delete e.PI_CLAUDE_ACCOUNT;
      spawn(bridgeNode, [join(CC, "claude-feed.mjs"), f.pane], { detached: true, stdio: "ignore", env: e }).unref();
      for (let i = 0; i < 30 && !existsSync(sock); i++) await sleep(100);
      if (existsSync(sock)) did(`칸 ${where}: 옛 연결부를 새 판으로 다시 띄움`);
      else bad(`칸 ${where}: 연결부를 다시 띄우지 못했어요`);
    }
  }
  if (!feeds.length) note("도는 연결부 없음(Claude Code 탭이 없거나 아직 한 번도 쓰지 않음)");
  else if (!old) good(`연결부 ${feeds.length}개가 모두 설치본과 같은 판(${installed})`);
  else note(`연결부 ${feeds.length}개 가운데 ${feeds.length - old}개가 설치본과 같은 판(${installed})`);
}

// ── pi 확장 ──
head("pi 확장");
const EXT = `${HOME}/.pi/agent/extensions`;
if (!existsSync(EXT)) note("pi 를 쓰지 않음(~/.pi/agent/extensions 없음)");
else {
  // 설치된 것 가운데 저장소에도 있는 파일만 견줌(어떤 확장을 쓸지는 사람마다 다름)
  const list = (d) => (existsSync(d) ? readdirSync(d).filter((f) => /\.(ts|mjs|sh)$/.test(f)) : []);
  // 저장소 안 원본 자리: 대부분 pi-extension/ 아래 같은 이름. 백그라운드 탭 실행기만 Claude Code 연결부와 같은 파일
  const origin = (f) => join(REPO, f === "lib/bg-launch.mjs" ? "claude-remote/bg-launch.mjs" : `pi-extension/${f}`);
  const files = [...list(EXT).map((f) => f), ...list(join(EXT, "lib")).map((f) => `lib/${f}`)].filter((f) => existsSync(origin(f)));
  const stale = files.filter((f) => !same(origin(f), join(EXT, f)));
  if (!files.length) note("이 저장소의 확장이 깔려 있지 않음");
  else if (!stale.length) good(`설치본 ${files.length}개가 저장소와 같음`);
  else {
    bad(`설치본이 저장소와 달라요: ${stale.join(", ")}`, "node deploy/doctor.mjs --fix 로 맞춘 뒤 pi 에서 /reload");
    if (FIX) {
      for (const f of stale) execFileSync("/bin/cp", ["-f", origin(f), join(EXT, f)]);
      did(`확장 ${stale.length}개를 저장소 것으로 맞춤(돌고 있는 pi 는 /reload 해야 적용)`);
    }
  }
}

console.log(`\n${problems ? `문제 ${problems}가지${fixed ? `(이번에 고친 것 ${fixed}가지: 다시 점검해 보세요)` : FIX ? "" : " — 화살표(→)대로 하거나 --fix 로 고칠 수 있는 것은 고쳐요"}` : "문제 없음"}`);
process.exit(problems && !fixed ? 1 : 0);
