// pi 확장의 백그라운드 모델 표시 실제 시험(모델을 부르지 않음, 20초쯤):
// 1) 켜면 이 탭의 모델·생각 깊이를 탭 옵션(@ai_model·@ai_thinking)에 적음(앱 서랍·시킨 탭이 읽음)
// 2) 이 탭이 맡긴 백그라운드 탭(아직 일함)이 위젯 한 줄로 보임: 이름·모델·깊이  3) 결과를 보내고 쉬면 사라짐
// 4) 끄면 탭 옵션을 지움
// 시험 tmux 세션(pibgtest)과 임시 설정 폴더(PI_CODING_AGENT_DIR)만 쓰고, 확장은 이 저장소 것만 붙인다(--no-extensions -e). 끝나면 지운다.
// 실행: node pi-extension/test/bg-model-e2e.mjs (PATH 에 pi 가 있어야 함)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = "pibgtest", T = `/tmp/antenna-pibg-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const waitFor = async (fn, ms, step = 300) => { for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); } return fn(); };

mkdirSync(`${T}/agent`, { recursive: true });
tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "120", "-y", "30", "-c", "/tmp");
const pane = tm("display", "-p", "-t", `${S}:`, "#{pane_id}");
const cmd = `PATH=${dirname(process.execPath)}:$PATH PI_CODING_AGENT_DIR=${T}/agent PI_BG_LAUNCH=${REPO}/claude-remote/bg-launch.mjs PI_REMOTE_JOBS_TICK_MS=500 ` +
  `pi --no-extensions -e ${REPO}/pi-extension/pi-remote-feed.ts --no-session --model anthropic/claude-opus-5-5 --thinking high`;
tm("send-keys", "-t", pane, "-l", cmd);
tm("send-keys", "-t", pane, "Enter");
const opt = (k) => tm("show-options", "-w", "-v", "-t", pane, k) ?? "";
const scr = () => tm("capture-pane", "-p", "-t", pane) ?? "";
try {
  const model = await waitFor(() => opt("@ai_model"), 25000);
  ok(model === "Opus 5.5" && opt("@ai_thinking") === "high", `1) 켜면 탭 옵션에 모델·깊이(${model}, ${opt("@ai_thinking")})`);
  const bg = tm("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", `${S}:`, "-n", "bg 문서 정리");
  for (const [k, v] of [["@bg_from", pane], ["@bg_by", "ai"], ["@ai_model", "Haiku 5.5"], ["@ai_thinking", "low"]]) tm("set-option", "-w", "-t", bg, k, v);
  ok(await waitFor(() => /백그라운드: 문서 정리 Haiku 5\.5 낮음/.test(scr()), 8000), "2) 맡긴 백그라운드 탭이 위젯으로 보임(이름·모델·깊이)");
  tm("set-option", "-w", "-t", bg, "@bg_done", String(Math.floor(Date.now() / 1000)));
  ok(await waitFor(() => !/백그라운드: 문서 정리/.test(scr()), 8000), "3) 결과를 보내고 쉬면 위젯이 사라짐");
  for (const k of ["C-c", "C-c", "C-d"]) {
    tm("send-keys", "-t", pane, k);
    await sleep(400);
  }
  ok(await waitFor(() => !opt("@ai_model"), 10000), `4) 끄면 탭 옵션을 지움(${opt("@ai_model") || "비었음"})`);
} finally {
  if (fail) console.log(`화면:\n${scr().split("\n").filter((l) => l.trim()).slice(-12).join("\n")}`);
  tm("kill-session", "-t", `=${S}`);
  rmSync(T, { recursive: true, force: true });
  const sock = `${process.env.HOME}/.cache/pi-remote/feed/${pane.replace(/\W/g, "")}.sock`;
  if (existsSync(sock)) rmSync(sock, { force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
