// 화면에서 모델·생각 깊이 읽기, 맥 입력창이 비었는지 시험: node server/test/status-line.test.mjs
import { editorEmpty, parseStatusLine } from "../status-line.mjs";
let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };
const RULE = "─".repeat(110);
const is = (r, model, thinking, last) => !!r && r.model === model && r.thinking === thinking && r.last === last;

// pi: 맨 아래 줄이 상태 줄
ok(is(parseStatusLine(`대화\n${RULE}\n\n${RULE}\n/private/tmp Haiku 4.5 (off) · 개인 14K/1000K 1.4% 주 93% ▁▁`), "Haiku 4.5", "off", true), "pi 화면: 맨 아래 줄에서 읽음");
ok(is(parseStatusLine(`${RULE}\n쓰던 글\n${RULE}\n~/works/x [main] Opus 5.5 (xhigh) · 회사 141K/1000K`), "Opus 5.5", "xhigh", true), "pi 화면: 브랜치가 있어도, 입력창에 글이 있어도");
// Claude Code: 가로줄 아래 상태 줄 + 그 아래 모드 줄(실제 화면에서 옮김)
ok(is(parseStatusLine(`❯ \n${RULE}\n  ~/works/personal/antenna [main] Fable 5.2 (max) · 개인 806K/1000K 80.6% 주 61% ▁▁▁▁▂█▇\n  ⏵⏵ auto mode on (shift+tab to cycle)`), "Fable 5.2", "max", false), "Claude Code 화면: 세션에서 바꾼 max 를 그대로 읽음");
ok(is(parseStatusLine(`❯ \n${RULE}\n  ~/works/personal/home-app Opus 5.5 (medium) · 개인 주 61% ▁▁▁▁▂█▇\n  ⏵⏵ auto mode on (shift+tab to cycle)`), "Opus 5.5", "medium", false), "Claude Code 화면: 브랜치 없는 폴더, 모델별 medium");
ok(is(parseStatusLine(`❯ Press up to edit queued messages\n${RULE}\n  ~/works/personal/game [feat/new-chapter] Fable 5.2 (max) · 개인 📎 16 515K/1000K 51.5% 주 61% ▁▁\n  ⏵⏵ auto mode on · 1 shell · ⧉ 16`), "Fable 5.2", "max", false), "Claude Code 화면: 뒤에서 도는 작업 표시가 있어도");
ok(is(parseStatusLine(`❯ \n${RULE}\n  /private/tmp/cctest Haiku 5.5 (high) · 개인\n  ⏸ manual mode on · ? for shortcuts`), "Haiku 5.5", "high", false), "Claude Code 화면: 다른 권한 모드");
// 잘못 읽지 않기
ok(parseStatusLine(`앞 대화 줄 Opus 5.5 (max) 라고 씀\n❯ 이건 입력창에 쓴 글 (max)\n${RULE}\n  ~/x Fable 5.2 (low) · 개인\n  ⏵⏵ auto mode on`)?.thinking === "low", "입력창·대화에 같은 모양의 글이 있어도 가로줄 아래 상태 줄만");
ok(parseStatusLine(` Bash command\n touch /tmp/x (max)\n Do you want to proceed?\n ❯ 1. Yes\n   2. No`) === null, "승인 창처럼 상태 줄이 가려지면 없음(창 옵션에 적어 둔 값을 씀)");
ok(parseStatusLine(`❯ \n${RULE}\n  ~/works/company/very-long-folder [PROJ-7060-sms-auth-hardening] Fable 5.2 (ma\n  ⏵⏵ auto mode on`) === null, "좁은 화면에서 잘린 상태 줄은 읽지 않음");
ok(parseStatusLine(`❯ \n${RULE}\n  ~/x Fable 5.2 · 개인\n  ⏵⏵ auto mode on`) === null, "생각 깊이가 없는 상태 줄은 없음");
ok(parseStatusLine("") === null && parseStatusLine(null) === null && parseStatusLine(`${RULE}`) === null, "빈 화면·가로줄뿐인 화면");

// 맥 입력창이 비었는지(폰에서 보낸 /명령을 붙여 넣어도 되는지). Claude Code 는 비어 있어도 '❯'와 흐린 안내 문구가 있음
const box = (inside) => `대화\n${RULE}\n${inside}\n${RULE}\n  ~/x [main] Fable 5.2 (max) · 개인\n  ⏵⏵ auto mode on (shift+tab to cycle)`;
ok(editorEmpty(box("")) === true, "pi: 빈 입력창");
ok(editorEmpty(box("쓰던 글")) === false, "pi: 쓰던 글이 있음");
ok(editorEmpty(box("❯ ")) === true, "Claude Code: '❯'만 있는 빈 입력창");
ok(editorEmpty(box('❯ Try "refactor <filepath>"')) === true, "Claude Code: 흐린 안내 문구만 있는 빈 입력창");
ok(editorEmpty(box("❯ 쓰던 글")) === false, "Claude Code: 쓰던 글이 있음");
ok(editorEmpty(box("❯ 첫 줄\n  둘째 줄")) === false, "Claude Code: 여러 줄로 쓰는 중");
ok(editorEmpty(box('❯ Try "x" 뒤에 더 씀')) === false, "안내 문구 모양 뒤에 글이 더 있으면 쓰던 글");
ok(editorEmpty(`대화\n${RULE}\n  Export conversation\n  ❯ 1. Copy to clipboard\n\n  Esc to cancel`) === false, "선택 창이 떠 있음(가로줄 하나)");
ok(editorEmpty("") === false && editorEmpty(null) === false, "빈 화면");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
