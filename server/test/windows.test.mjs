// 탭 목록 판정(server/windows.mjs): 백그라운드 탭 정보·시킨 탭 찾기·뒤에서 도는 일·모델과 생각 깊이·'끝난 것 모두 닫기'가 고르는 탭.
// tmux 없이 list-windows 출력 모양의 글로 시험한다. 실행: node server/test/windows.test.mjs
import { finishedBackgroundIds, forApp, isFinishedBackground, parseWindows, WINDOW_FORMAT } from "../windows.mjs";

let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// WINDOW_FORMAT 의 칸 순서대로 한 줄을 만든다(형식이 바뀌어도 시험이 따라감)
const FIELDS = WINDOW_FORMAT.split(":::").map((f) => f.slice(2, -1));
const line = (o) => FIELDS.map((f) => String(o[f] ?? "")).join(":::");
const out = [
  line({ window_id: "@1", window_index: 0, window_name: "메인 작업", window_active: 1, pane_id: "%1" }),
  line({ window_id: "@2", window_index: 1, window_name: "bg 테스트 고치기", pane_id: "%2", "@pi_status": "working", "@bg_by": "user", "@bg_started": 1000, "@bg_from": "%1", "@ai_model": "Opus 5.5", "@ai_thinking": "high" }),
  line({ window_id: "@3", window_index: 2, window_name: "bg 문서 정리", pane_id: "%3", "@pi_status": "yourturn", "@bg_by": "ai", "@bg_started": 1000, "@bg_done": 2000, "@bg_from": "%1" }),
  line({ window_id: "@4", window_index: 3, window_name: "bg 예전 탭", pane_id: "%4", "@bg_by": "phone", "@bg_started": 1000, "@bg_origin": "%1" }),
  line({ window_id: "@5", window_index: 4, window_name: "bg 시킨 탭 닫힘", pane_id: "%5", "@bg_by": "user", "@bg_done": 3000, "@bg_from": "%99" }),
  line({ window_id: "@6", window_index: 5, window_name: "보통 탭", pane_id: "%6", "@ai_jobs": "셸 1개" }),
  line({ window_id: "@7", window_index: 6, window_name: "bg 끝났지만 셸", pane_id: "%7", "@bg_by": "user", "@bg_done": 3000, "@ai_jobs": "셸 1개" }),
  line({ window_id: "@8", window_index: 7, window_name: "bg 다시 물음", pane_id: "%8", "@pi_status": "asking", "@bg_by": "user", "@bg_done": 3000 }),
  line({ window_id: "@9", window_index: 8, window_name: "🔐sudo", pane_id: "%9", "@sudo_stage": "confirm" }),
].join("\n");
const w = parseWindows(`${out}\n`);
const at = (i) => w.find((x) => x.index === i);

ok(w.length === 9, `9줄 → 탭 9개(${w.length})`);
ok(at(0).name === "메인 작업" && at(0).active && at(0).bg === null && at(0).jobs === "", "보통 탭: 이름·지금 보는 탭, 백그라운드 정보 없음");
ok(at(8).sudo === "confirm" && at(8).bg === null, "관리자 권한 창 단계는 그대로");
const a = at(1).bg;
ok(a && a.by === "user" && a.started === 1000 && a.done === 0 && a.from === 0 && a.fromName === "메인 작업", `일하는 백그라운드 탭: 시킨 쪽·시작·시킨 탭(번호·이름) → ${JSON.stringify(a)}`);
ok(at(1).status === "working", "상태도 그대로");
ok(at(2).bg?.done === 2000 && at(2).bg?.by === "ai", "끝난 때·AI 가 시킴");
ok(at(3).bg?.from === 0 && at(3).bg?.fromName === "메인 작업", "@bg_from 이 없는 예전 탭은 @bg_origin 으로 시킨 탭을 찾음");
ok(at(4).bg?.from === null && at(4).bg?.fromName === "", "시킨 탭이 닫혔으면 번호 없음·이름 빈 글");
ok(at(5).jobs === "셸 1개" && at(5).bg === null, "보통 탭의 뒤에서 도는 일");
ok(at(1).model === "Opus 5.5" && at(1).thinking === "high", `탭의 모델·생각 깊이(${at(1).model}, ${at(1).thinking})`);
ok(at(0).model === "" && at(0).thinking === "", "모델·생각 깊이를 모르는 탭은 빈 글");
ok(parseWindows("").length === 0 && parseWindows(null).length === 0, "빈 출력 → 빈 목록");

const app = forApp(w);
ok(app.every((x) => !("id" in x)) && app[1].bg?.fromName === "메인 작업", "앱에 보낼 때는 창 고유 번호를 뺌");
ok(JSON.stringify(Object.keys(app[0])) === JSON.stringify(["index", "name", "active", "status", "sudo", "bg", "jobs", "model", "thinking"]), `앱에 보내는 칸: ${Object.keys(app[0]).join(", ")}`);

// 끝난 것 모두 닫기: 결과를 보냈고 쉬는 백그라운드 탭만
ok(!isFinishedBackground(at(0)), "보통 탭은 닫지 않음");
ok(!isFinishedBackground(at(1)), "일하는 중(끝나지 않음)은 닫지 않음");
ok(isFinishedBackground(at(2)), "끝나고 쉬는 탭은 닫음");
ok(!isFinishedBackground(at(3)), "끝난 때가 없는 탭(예전 탭·아직 안 끝남)은 닫지 않음");
ok(isFinishedBackground(at(4)), "시킨 탭이 닫혔어도 끝났으면 닫음");
ok(!isFinishedBackground(at(6)), "끝났어도 뒤에서 도는 일이 있으면 닫지 않음");
ok(!isFinishedBackground(at(7)), "끝난 뒤 다시 묻는 중이면 닫지 않음");
ok(!isFinishedBackground({ ...at(2), status: "working" }), "끝난 뒤 다시 일하는 중이면 닫지 않음");
ok(JSON.stringify(finishedBackgroundIds(w)) === JSON.stringify(["@3", "@5"]), `닫을 탭은 창 고유 번호로 → ${finishedBackgroundIds(w).join(", ")}`);
const onlyDone = parseWindows([out.split("\n")[2], out.split("\n")[4]].join("\n"));
ok(JSON.stringify(finishedBackgroundIds(onlyDone)) === JSON.stringify(["@5"]), "모두 끝난 백그라운드 탭뿐이면 맨 앞 하나는 남김(세션이 사라지지 않게)");

console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
