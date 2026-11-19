// 맥 권한 창 알림 시험(server/mac-prompts.mjs). 가짜 창 목록·권한 기록으로 판정을 보고, 탭 찾기는 따로 띄운 tmux 서버에서 본다.
// 실행: node server/test/mac-prompts.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPromptWatch, findTab, labelOf, parseRequests, promptMessage, promptWindows, tabFinder } from "../mac-prompts.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// --- 창 목록 ---
const UNC = { owner: "UserNotificationCenter", w: 410, h: 369 };
ok(promptWindows([{ owner: "iTerm", w: 900, h: 600 }, UNC, { owner: "UserNotificationCenter", w: 40, h: 20 }]).length === 1, "알림 창 프로그램의 큰 창만 권한 창으로 봄");
ok(promptWindows(null).length === 0, "창 목록을 못 읽으면 없음");

// --- 권한 기록(11-19 실제 기록의 글 형태) ---
const ev = (ts, msg, thread = 1, proc = 994) => JSON.stringify({ timestamp: `2026-11-19 ${ts}.100000+0900`, processID: String(proc), threadID: String(thread), eventMessage: msg });
const file = (svc, pid, right = "Unknown (None)", bin = "/usr/bin/du") =>
  `Handling access request to ${svc}, from Sub:{/Users/x/.nvm/versions/node/v22/bin/node}Resp:{TCCDProcess: identifier=node, pid=${pid}, auid=501, euid=501, responsible_path=/Users/x/.nvm/versions/node/v22/bin/node, binary_path=${bin}}, ReqResult(Auth Right: ${right}, promptType: 1,DB Action:None)`;
const aeHead = (target, v) => `Handling access request: kTCCServiceAppleEvents:<private>:${target}, default_allow: 0, authValue: ${v},`;
const aeChain = (pid) => `AttributionChain: responsible={TCCDProcess: identifier=node, pid=${pid}, auid=501, euid=501, responsible_path=/Users/x/node, binary_path=/usr/bin/osascript}, accessing={TCCDProcess: identifier=com.apple.osascript, pid=${pid}}, requesting={TCCDProcess: identifier=com.apple.finder, pid=2896}`;
const log = [
  ev("13:30:00", file("kTCCServiceListenEvent", 11)),
  ev("13:30:01", file("kTCCServiceSystemPolicyAllFiles", 12)),
  ev("13:30:02", file("kTCCServicePhotos", 13)),
  ev("13:30:03", file("kTCCServiceSystemPolicyDesktopFolder", 14, "Allowed (User Set)")),
  "이건 JSON 이 아님",
  ev("13:33:52", aeHead("com.apple.finder", 1), 7),
  ev("13:33:52", aeChain(73571), 7),
  ev("13:34:10", aeHead("com.apple.Safari", 2), 8),
  ev("13:34:10", aeChain(80000), 8),
  ev("13:35:00", file("kTCCServiceSystemPolicyDownloadsFolder", 99)),
  ev("13:36:00", file("kTCCServiceScreenCapture", 21, "Unknown (None)", "/usr/bin/osascript")),
  ev("13:36:30", file("kTCCServiceDeveloperTool", 23)),
].join("\n");
const reqs = parseRequests(log, new Set([99]));
ok(reqs.length === 2, `정해지지 않은 요청 둘만(사진·Finder 제어): ${reqs.length}`);
ok(reqs[0]?.service === "kTCCServicePhotos" && reqs[0].pid === 13 && reqs[0].binary === "/usr/bin/du", "파일·사진 요청: 권한·프로그램 번호·실행 파일");
ok(reqs[1]?.service === "kTCCServiceAppleEvents" && reqs[1].target === "com.apple.finder" && reqs[1].pid === 73571, "다른 앱 제어 요청: 같은 실의 다음 줄에서 프로그램 번호를 짝지음");
ok(reqs[1]?.t === Date.parse("2026-11-19T13:33:52.100+09:00"), "기록 시각을 읽음");
ok(!reqs.some((r) => r.pid === 99), "감지에 쓴 프로그램은 뺌");
ok(!reqs.some((r) => r.pid === 21), "osascript 가 켜질 때 하는 화면 기록 확인은 뺌");
ok(parseRequests(ev("13:37:00", file("kTCCServiceScreenCapture", 22, "Unknown (None)", "/usr/bin/screencapture")))[0]?.pid === 22, "다른 프로그램의 화면 기록 요청은 남김");
ok(parseRequests("").length === 0 && parseRequests(null).length === 0, "빈 기록");

// --- 이름·글 ---
ok(labelOf({ service: "kTCCServiceAppleEvents", target: "com.apple.finder" }) === "Finder 제어", "다른 앱 제어 이름");
ok(labelOf({ service: "kTCCServicePhotos" }) === "사진 접근", "사진 이름");
ok(labelOf({ service: "kTCCServiceNewThing" }) === "NewThing", "모르는 권한은 이름 그대로");
const m1 = promptMessage(reqs[1], { index: 1, name: "Home" });
ok(m1.window === 1 && m1.body.startsWith("'Home' 탭(1번)이 Finder 제어 권한을 기다려요"), `탭·권한이 든 알림: ${m1.body}`);
const m2 = promptMessage(null, null);
ok(m2.window === undefined && m2.body.startsWith("권한 창이 답을 기다려요"), "모르면 일반 알림");

// --- 부모 거슬러 탭 찾기 ---
const parents = new Map([[500, 400], [400, 300], [300, 1], [600, 1]]);
ok(findTab(500, [{ pid: 300, index: 7, name: "Biz" }], parents)?.index === 7, "손자 프로그램도 탭을 찾음");
ok(findTab(600, [{ pid: 300, index: 7, name: "Biz" }], parents) === null, "탭 밖 프로그램은 없음");

// --- 감시 흐름 ---
async function flow() {
  let wins = [];
  let inUse = false;
  let reqList = [];
  let clock = 1_000_000;
  const sent = [];
  const tick = createPromptWatch({
    listWindows: async () => wins,
    requests: async () => reqList,
    tabOf: async (pid) => (pid === 13 ? { index: 1, name: "Home" } : null),
    inUse: () => inUse,
    send: async (m) => sent.push(m),
    now: () => clock,
  });
  await tick();
  ok(sent.length === 0, "창이 없으면 보내지 않음");

  wins = [UNC];
  inUse = true;
  reqList = [{ t: clock - 5000, service: "kTCCServicePhotos", pid: 13 }, { t: clock - 1000, service: "kTCCServiceCamera", pid: 50 }];
  await tick();
  ok(sent.length === 0, "맥을 쓰는 중이면 미룸");
  inUse = false;
  clock += 10_000;
  await tick();
  ok(sent.length === 1 && sent[0].window === 1 && sent[0].body.includes("사진 접근"), `맥을 안 쓰게 되면 보냄, 탭에 있는 요청을 고름: ${sent[0]?.body}`);
  await tick();
  ok(sent.length === 1, "같은 창에는 한 번만");

  wins = [];
  await tick();
  wins = [UNC];
  reqList = [{ t: clock + 60_000, service: "kTCCServicePhotos", pid: 13 }];   // 창보다 늦은 요청
  await tick();
  ok(sent.length === 2 && sent[1].window === undefined && sent[1].body.startsWith("권한 창이"), "닫혔다가 다시 뜨면 또 보냄, 창보다 늦은 요청은 쓰지 않음");

  wins = [{ ...UNC, h: 300 }];
  reqList = [{ t: clock, service: "kTCCServiceCamera", pid: 50 }];
  await tick();
  ok(sent.length === 3 && sent[2].body.startsWith("권한 창이") && sent[2].window === undefined, "다른 창으로 바뀌면 또 보냄, 탭 밖 요청의 권한 이름은 붙이지 않음");

  wins = null;
  await tick();
  wins = [{ ...UNC, h: 300 }];
  await tick();
  ok(sent.length === 3, "창 목록을 못 읽은 때는 상태를 그대로 둠");

  const sent2 = [];
  const tick2 = createPromptWatch({
    listWindows: async () => [UNC],
    requests: async () => { throw new Error("기록 못 읽음"); },
    tabOf: async () => null,
    inUse: () => false,
    send: async (m) => sent2.push(m),
  });
  await tick2();
  ok(sent2.length === 1 && sent2[0].body.startsWith("권한 창이"), "기록을 못 읽어도 일반 알림은 보냄");
}
await flow();

// --- 실제 tmux·ps 로 탭 찾기(따로 띄운 tmux 서버) ---
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p));
if (!TMUX) {
  console.log("건너뜀: tmux 가 없음");
} else {
  const D = mkdtempSync(join(tmpdir(), "antenna-prompts-"));
  const sock = `antenna-prompts-${process.pid}`;
  const wrap = join(D, "tmux");
  writeFileSync(wrap, `#!/bin/sh\nexec ${TMUX} -L ${sock} "$@"\n`);
  chmodSync(wrap, 0o755);
  try {
    execFileSync(wrap, ["-f", "/dev/null", "new-session", "-d", "-s", "t", "-n", "첫째", "sleep 60"]);
    execFileSync(wrap, ["new-window", "-t", "t", "-n", "Home", "sh -c 'sleep 60 & wait'"]);
    let child = 0;
    for (let i = 0; i < 30 && !child; i++) {
      const panes = execFileSync(wrap, ["list-panes", "-s", "-t", "t", "-F", "#{window_index} #{pane_pid}"], { encoding: "utf8" });
      const shPid = Number(panes.trim().split("\n").find((l) => l.startsWith("1 "))?.split(" ")[1]);
      child = Number(spawnSync("/usr/bin/pgrep", ["-P", String(shPid), "sleep"], { encoding: "utf8" }).stdout.trim().split("\n")[0]) || 0;
      if (!child) await new Promise((r) => setTimeout(r, 100));
    }
    const find = tabFinder(wrap, "t");
    const t1 = await find(child);
    ok(t1?.index === 1 && t1.name === "Home", `실제 tmux: 탭 안 프로그램의 자식으로 탭을 찾음(${JSON.stringify(t1)})`);
    ok((await find(process.pid)) === null, "실제 tmux: 탭 밖 프로그램(이 시험)은 없음");
  } finally {
    spawnSync(wrap, ["kill-server"]);
    rmSync(D, { recursive: true, force: true });
    rmSync(`/private/tmp/tmux-${process.getuid()}/${sock}`, { force: true });
  }
}

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
