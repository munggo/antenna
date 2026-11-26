#!/usr/bin/env node
/**
 * pi-remote: Claude Code 훅 → 이 tmux 탭의 피드(claude-feed.mjs)에 이벤트를 넘김. 피드가 없으면 띄움.
 * - 탭 번호(TMUX_PANE)가 없으면 세션 파일에 적힌 칸으로 넘기고, 그것도 없으면(tmux 밖 iTerm2 일반 탭 등) 아무것도 안 함
 * - 아무것도 출력하지 않음(일부 훅의 출력은 대화에 들어감), 항상 0 으로 끝냄(Claude Code 를 막지 않음)
 * - 예외: '/bgtab <할 일>'(명령 파일 ~/.claude/commands/bgtab.md)은 여기서 새 탭을 열고 그 글은 AI 에 보내지 않음(막음 + 안내)
 * - 예외: 비밀번호가 필요한 sudo 명령은 새 탭(🔐sudo)에서 사용자가 확인하고 실행하게 명령을 바꿔 줌(sudo-run.mjs). pi 의 send-guard 와 같은 방식
 * 작성: 서문교
 */
import { createConnection } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 이 훅을 부른 Claude Code 의 tmux 칸. 탭 번호(TMUX_PANE)가 없으면 입력을 읽은 뒤 세션 파일로 찾는다(아래 paneFromSession)
let pane = /^%\d+$/.test(process.env.TMUX_PANE ?? "") ? process.env.TMUX_PANE : null;
const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].find((p) => existsSync(p)) ?? "tmux";

const FEED = join(dirname(fileURLToPath(import.meta.url)), "claude-feed.mjs");
const SUDO_RUN = join(dirname(fileURLToPath(import.meta.url)), "sudo-run.mjs");
// 폰·Claude Code 에 보일 글의 언어(PI_REMOTE_LANG). 훅은 도구마다 불리므로 글이 필요한 갈래에서만 불러온다
const langMod = async () => {
  const f = ["lang.mjs", "../pi-extension/lib/lang.mjs"].map((p) => join(dirname(fileURLToPath(import.meta.url)), p)).find((p) => existsSync(p));
  return f ? import(f) : { tr: (ko) => ko };
};
const feedFile = (ext) => `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.${ext}`;
// 연결부에 넘기지 못하고 끝난 훅의 기록(원인 찾기용). 11-14: 한 탭에서 끝 훅이 21번 중 17번 연결부에 닿지 않았는데 까닭을 몰랐다
const miss = (event, why) => {
  try {
    const f = feedFile("hook-miss.log");
    if (existsSync(f) && statSync(f).size > 64 * 1024) unlinkSync(f);
    appendFileSync(f, `${new Date().toLocaleTimeString("en-GB")} ${event} ${why}\n`);
  } catch {
    /* 기록 실패는 무시 */
  }
};
/** 탭 번호 없이 불린 훅: 같은 대화를 돌리는 살아 있는 Claude Code 의 세션 파일(~/.claude/sessions/<pid>.json)에 적힌 칸('antenna:@182.%184' → '%184') */
const paneFromSession = (id) => {
  if (!id) return null;
  const dir = `${process.env.HOME}/.claude/sessions`;
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (s.sessionId !== id) continue;
      process.kill(Number(s.pid), 0);   // 끝난 프로세스의 파일이면 여기서 넘어감
      const p = String(s.tmux ?? "").split(".").pop();
      if (/^%\d+$/.test(p)) return p;
    } catch {
      /* 깨졌거나 끝난 프로세스 */
    }
  }
  return null;
};
/** 이 칸에서 지금 도는 프로그램이 Claude Code 인지(pi 탭 안에서 실행한 'claude -p' 같은 것은 무시 → pi 피드와 안 엉킴). 아니면 그 이름 */
const notClaude = () => {
  try {
    const cmd = execFileSync(TMUX, ["display", "-p", "-t", pane, "#{pane_current_command}"], { encoding: "utf8", timeout: 2000 }).trim();
    return /^(\S*\/)?claude(\.exe)?$|^\d+\.\d+\.\d+$/i.test(cmd) ? null : `앞자리 '${cmd}' 라 넘기지 않음`;
  } catch (e) {
    return `칸을 읽지 못함(${e?.code ?? e?.signal ?? "오류"})`;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 연결부에 한 줄을 넘긴다. 보내고 바로 닫지 않고 연결부가 무엇이든 한 줄 답할 때까지(새 판은 '받았음', 옛 판은 대화 전체) 최대 1.5초 기다린다.
 *  바쁜 연결부가 연결을 늦게 받으면 닫힌 소켓에 쓰다 오류가 나 이 줄까지 버렸다(11-14). 연결이 열려 있으면 그런 일이 없다 */
const send = (line) =>
  new Promise((res) => {
    const c = createConnection(feedFile("sock"));
    const t = setTimeout(() => { c.destroy(); res(false); }, 2000);   // 연결부가 잠깐 바빠도 새로 띄우지 않게(둘이 같이 돌면 상태가 엉킴)
    let wait = null;
    let finished = false;
    const done = (answered) => {
      if (finished) return;
      finished = true;
      clearTimeout(wait);
      if (!answered) miss(String(JSON.parse(line)?.event?.hook_event_name ?? "?"), "넘겼지만 연결부가 1.5초 안에 답하지 않음");
      c.end(() => res(true));
      setTimeout(() => { c.destroy(); res(true); }, 300).unref();
    };
    c.on("error", () => { clearTimeout(t); clearTimeout(wait); res(false); });
    c.on("connect", () => {
      clearTimeout(t);
      c.write(line);
      wait = setTimeout(() => done(false), 1500);
      let got = "";
      c.setEncoding("utf8");
      c.on("data", (d) => {
        got += d;
        if (got.includes("\n")) setTimeout(() => done(true), 30);   // 첫 줄을 받으면 그 연결부는 이 연결을 받아 읽는 중
      });
    });
  });

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  try {
    const ev = JSON.parse(input);
    if (!pane) {
      pane = paneFromSession(ev.session_id);
      if (!pane) return process.exit(0);   // tmux 밖(iTerm2 일반 탭 등)
      miss(ev.hook_event_name, `탭 번호 없이 불림 → 세션 파일로 칸 ${pane} 을 찾아 넘김`);
    }
    const skip = notClaude();
    if (skip) {
      miss(ev.hook_event_name, skip);
      return process.exit(0);
    }
    // 백그라운드 탭: '/bgtab <할 일>' → 같은 폴더에 새 탭을 열어 Claude Code 에 맡김. 이 글은 AI 에 보내지 않음
    const bg = ev.hook_event_name === "UserPromptSubmit" ? String(ev.prompt ?? "").match(/^\/bgtab(?:\s+([\s\S]*))?$/) : null;
    if (bg) {
      let reason;
      const { tr } = await langMod();
      try {
        const { launchBackground } = await import("./bg-launch.mjs");
        const r = launchBackground({ agent: "claude", cwd: ev.cwd || process.cwd(), task: bg[1] ?? "", originPane: pane, by: "user" });
        reason = tr(`백그라운드 탭 ${r.window}(${r.name})에서 시작했어요. 끝나면 결과를 여기로 알려 드려요`, `Started in background tab ${r.window} (${r.name}). The result comes back here when it's done`);
      } catch (e) {
        reason = tr(`백그라운드 탭을 열지 못했어요: ${e?.message ?? e}`, `Couldn't open a background tab: ${e?.message ?? e}`);
      }
      process.stdout.write(JSON.stringify({ decision: "block", reason }));
      return process.exit(0);
    }
    // 비밀번호가 필요한 sudo: 명령 실행에는 비밀번호를 넣을 터미널이 없어, 새 탭(🔐sudo)에서 사용자가 확인하고 실행하게 명령을 바꿈.
    // 탭에서 설명을 보고 Enter 를 눌러야 실행되므로(q 로 취소) Claude Code 의 승인 창은 따로 띄우지 않음
    if (ev.hook_event_name === "PreToolUse" && ev.tool_name === "Bash" && /\bsudo\b/.test(String(ev.tool_input?.command ?? ""))) {
      try {
        const { sudoNeedsPassword } = await import("./sudo-check.mjs");
        const cmd = String(ev.tool_input.command);
        if (sudoNeedsPassword(cmd)) {
          const { tr } = await langMod();
          const job = Buffer.from(JSON.stringify({ cmd, explain: String(ev.tool_input.description ?? "") })).toString("base64");
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              permissionDecisionReason: tr("관리자 권한 명령: 새 탭(🔐sudo)에서 사용자가 확인하고 실행해요", "Admin command: you confirm and run it in a new tab (🔐sudo)"),
              updatedInput: { ...ev.tool_input, command: `"${process.execPath}" "${SUDO_RUN}" ${job}`, timeout: 600_000 },
            },
          }));
        }
      } catch {
        /* 판정을 못 하면 원래 흐름대로 */
      }
    }
    const line = `${JSON.stringify({ cmd: "hook", once: true, event: ev })}\n`;   // once: 보내고 닫는 연결(연결부가 대화를 보내지 않고 '받았음'만 답함)
    if (await send(line)) return process.exit(0);
    if (ev.hook_event_name === "SessionEnd") return process.exit(0);
    // 피드가 없으면 띄우고(토큰은 넘기지 않음) 소켓이 생기면 보냄
    miss(ev.hook_event_name, existsSync(feedFile("sock")) ? "연결부에 붙지 못해 새로 띄움" : "연결부가 없어 띄움");
    const env = { ...process.env };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.PI_CLAUDE_ACCOUNT;   // 계정 표시도 넘기지 않음(연결부가 띄우는 다른 프로그램이 이 탭 계정을 물려받지 않게)
    delete env.CLAUDE_CONFIG_DIR;   // 직접 로그인으로 켠 추가 계정의 설정 폴더도(11-25)
    spawn(process.execPath, [FEED, pane], { detached: true, stdio: "ignore", env }).unref();
    let sent = false;
    for (let i = 0; i < 25 && !sent; i++) {
      await sleep(100);
      sent = await send(line);
    }
    if (!sent) miss(ev.hook_event_name, "새로 띄운 연결부에도 넘기지 못함");
  } catch (e) {
    /* 훅 실패는 Claude Code 에 영향 없게 */
    miss("?", `훅 처리 중 오류(${String(e?.message ?? e).slice(0, 80)})`);
  }
  process.exit(0);
});
