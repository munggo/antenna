// 훅 없이 묻는 Claude Code 창(피드백 초안 종료 안내·목록·검토, /export 같은 명령 창) 판정과 폰 카드 만들기 시험.
// 화면은 실제 Claude Code 2.1.325 에서 캡처한 모양(11-15). 실행: node claude-remote/test/screen-dialog-cases.mjs
const { screenDialog, parseGuide, dialogCard } = await import(new URL("../claude-feed.mjs", import.meta.url).pathname);

const TOP = "▔".repeat(120), LINE = "─".repeat(120);
const blank = (n) => "\n".repeat(n);
const nudge = `${blank(20)}${TOP}\n  You have 1 unsent feedback draft\n  Enter to review & send · Esc to discard and exit\n`;
const list = (focus = 0, age = "1m") => {
  const rows = [`시험 초안(화면 질문 시험)                     bug · ${age} · /tmp/demo · transcript expired (report only)`,
    "다른 대화의 초안 하나…                        bug · 2d · ~/works/demo · transcript available"];
  return `${blank(4)}${TOP}\n   Feedback drafts\n\n     This session\n${rows.map((r, i) => (i === focus ? `   ❯ ${r}` : `     ${r}`))[0]}\n     Other sessions\n` +
    `${rows.map((r, i) => (i === focus ? `   ❯ ${r}` : `     ${r}`))[1]}\n\n   Drafts live only on this machine and are never sent without you. Unsent drafts expire after 30 days.\n\n` +
    "   Enter to review · d to discard · Esc to close\n";
};
const review = `${blank(4)}${TOP}\n   Feedback drafts\n\n     Type: bug\n     Title:\n       시험 초안\n     Area:\n     Failure mode: other\n     Task: other\n     Details:\n       │ - 시험\n` +
  "     Send transcript: expired (report only)\n\n     Environment info (darwin arm64, v2.1.325) is always attached.\n\n   ❯ Send feedback\n\n" +
  "   We may use these reports to debug related issues and improve Claude Code.\n\n   ↑/↓ to move · Enter to send · d to discard · Esc to later\n";
const exportDlg = ` ▐▛███▜▌   Claude Code v2.1.325\n\n❯ /export\n\n${LINE}\n  Export conversation\n  Select export method\n\n` +
  "  ❯ 1. Copy to clipboard  Copy the conversation to your system clipboard\n    2. Save to file       Save the conversation to a file in the current directory\n\n  Esc to cancel\n";
const approval = `● 파일을 만들겠습니다.\n\n${LINE}\n Bash command\n\n   touch /tmp/x\n   Create file\n\n Do you want to proceed?\n ❯ 1. Yes\n` +
  "   2. Yes, and don't ask again for touch commands in /tmp\n   3. No\n\n Esc to cancel · Tab to amend · ctrl+e to explain\n";
const idle = ` ▐▛███▜▌   Claude Code v2.1.325\n\n${LINE}\n❯ Try "refactor <filepath>"\n${LINE}\n  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents · 1 feedback draft\n`;
const busy = `✶ Whisking… (56s · ↓ 2.1k tokens)\n\n${LINE}\n❯ \n${LINE}\n  ~/works/demo [main] Fable 5.2 (max)\n  ⏸ manual mode on · esc to interrupt\n`;
const hintUnderInput = `● 끝났습니다.\n\n${LINE}\n❯ \n${LINE}\n  ⏵⏵ auto mode on (shift+tab to cycle)\n  Teach auto mode about your environment?\n  Enter to continue · Esc to dismiss\n`;
const hintRightUnder = `● 끝났습니다.\n\n${LINE}\n❯ \n${LINE}\n  Teach auto mode about your environment?\n  Enter to continue · Esc to dismiss\n`;
const hintMultiline = `● 끝났습니다.\n\n${LINE}\n❯ 첫 줄을 쓰고\n  둘째 줄도 쓰는 중\n${LINE}\n  ⏵⏵ auto mode on (shift+tab to cycle)\n  Teach auto mode about your environment?\n  Enter to continue · Esc to dismiss\n`;
const shell = " /tmp/demo  claude --model haiku\n\nResume this session with:\nclaude --resume 0b7d2c4e-0000-4000-8000-000000000000\n /tmp/demo  \n";
const prose = `● 정리했습니다.\n\n${LINE}\n  마지막 문단입니다.\n  Back to work\n`;
const tallNoBorder = "     Type: bug\n     Title:\n       긴 초안\n   ❯ Send feedback\n\n   ↑/↓ to move · Enter to send · d to discard · Esc to later\n";
const oddNumbers = `${TOP}\n  Release notes\n  3. Fixed a bug\n  7. Faster start\n  Esc to close\n`;
// 폰으로 볼 때(창 폭 50칸) 실제 캡처 모양: 키 안내가 두 줄로 접히고, ▔ 테두리는 다른 알림 글에 덮여 ▔ 하나만 남기도 함
const FOCUS50 = " tmux focus-events off · add 'set -g focus-even… ▔";
const nudge50 = `${blank(30)}${FOCUS50}\n  You have 1 unsent feedback draft\n  Enter to review & send · Esc to discard and\n  exit\n`;
const list50 = `❯ /export\n  ⎿  Export cancelled\n${blank(6)}${FOCUS50}\n   Feedback drafts\n\n     This session\n   ❯ 시험 초안(화면 질…    bug · 1m\n     Other sessions\n` +
  "     다른 대화의 초안…       bug · 2d\n\n   Drafts live only on this machine and are\n   never sent without you. Unsent drafts expire\n   after 30 days.\n\n" +
  "   Enter to review · d to discard · Esc to\n   close\n";
const review50 = `${blank(3)}${"▔".repeat(31)} ● high · /effort ▔\n   Feedback drafts\n\n     Type: bug\n     Title:\n       시험 초안\n     Details:\n       │ - 시험\n\n` +
  "   ❯ Send feedback\n\n   We may use these reports to debug related\n   issues and improve Claude Code.\n\n   ↑/↓ to move · Enter to send · d to discard ·\n   Esc to later\n";
const export50 = `${blank(5)}${"▔".repeat(31)} ● high · /effort ▔\n   Export conversation\n   Select export method\n\n   ❯ 1. Copy to clipboard  Copy the\n` +
  "                           conversation to your\n                           system clipboard\n     2. Save to file       Save the\n" +
  "                           conversation to a\n                           file in the current\n                           directory\n\n   Esc to cancel\n";
// 테두리 없이 그려진 종료 안내(11-15 실제 시험 화면): 지난 입력 줄('❯ /exit')이나 빈 줄 둘에서 끊음
const nudgeNoBorder = " /tmp/demo  claude --model haiku\n ▐▛███▛█   Claude Code v2.1.325\n\n❯ /export\n  ⎿  Export cancelled\n\n❯ /exit\n\n" +
  "  You have 1 unsent feedback draft\n  Enter to review & send · Esc to discard and\n  exit\n";
const nudgeBlankAbove = `  지난 답의 둘째 줄입니다.\n${blank(8)}  You have 2 unsent feedback drafts\n  Enter to review & send · Esc to discard and exit\n`;
const approvalCol0 = `${LINE}\n Bash command\n\n   touch /tmp/x\n\n Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n Esc to cancel\n`;
const approval50 =`${"─".repeat(50)}\n Bash command\n\n   touch /tmp/x\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again for touch\n      commands in /tmp\n   3. No\n\n` +
  " Esc to cancel · Tab to amend · ctrl+e to\n explain\n";

let bad = 0, total = 0;
const ok = (c, name) => { total++; if (!c) { bad++; console.log(`틀림: ${name}`); } };

// 1) 창인지 아닌지
for (const [scr, want, name] of [
  [nudge, "You have 1 unsent feedback draft", "피드백 초안 종료 안내(사용자 보고 화면)"],
  [list(), "Feedback drafts", "피드백 초안 목록"],
  [review, "Feedback drafts", "피드백 초안 검토"],
  [exportDlg, "Export conversation", "/export 창(입력창 자리에 뜬 창)"],
  [approval, "Bash command", "승인 창도 창으로 봄(작업 중이면 연결부가 승인 카드에 맡김)"],
  [idle, null, "쉬는 화면(입력창·모드 줄)"],
  [busy, null, "일하는 화면(진행 줄·esc to interrupt)"],
  [hintUnderInput, null, "입력창 밑 안내(모드 줄이 끼어 있음)"],
  [hintRightUnder, null, "입력창 바로 밑 안내(테두리 위가 입력 줄)"],
  [hintMultiline, null, "여러 줄로 쓰는 입력창 밑 안내(테두리 위가 입력 줄이 아니어도 모드 줄이 끼어 있음)"],
  [shell, null, "셸 화면(Claude Code 꺼짐)"],
  [prose, null, "맨 아래가 키 안내가 아닌 글('Back to work')"],
  [tallNoBorder, "Type: bug", "테두리가 화면 밖으로 밀린 긴 창(화면 맨 위까지)"],
  ["", null, "빈 화면"],
  [nudge50, "You have 1 unsent feedback draft", "50칸: 종료 안내(테두리가 다른 글에 덮임, 키 안내 접힘)"],
  [list50, "Feedback drafts", "50칸: 초안 목록"],
  [review50, "Feedback drafts", "50칸: 초안 검토"],
  [export50, "Export conversation", "50칸: /export 창"],
  [approval50, "Bash command", "50칸: 승인 창"],
  [nudgeNoBorder, "You have 1 unsent feedback draft", "테두리 없는 종료 안내(지난 입력 줄에서 끊음)"],
  [nudgeBlankAbove, "You have 2 unsent feedback drafts", "테두리 없는 종료 안내(빈 줄 둘에서 끊음)"],
  [approvalCol0, "Bash command", "맨 앞 칸의 '❯ 1.'은 지난 입력 줄이 아님"],
]) ok((screenDialog(scr)?.title ?? null) === want, `${name} → ${screenDialog(scr)?.title ?? "없음"}`);

// 2) 키 안내 줄 읽기
ok(JSON.stringify(parseGuide("Enter to review & send · Esc to discard and exit")) === JSON.stringify([{ key: "Enter", action: "review & send" }, { key: "Esc", action: "discard and exit" }]), "키 안내 두 조각");
ok(parseGuide("⏵⏵ auto mode on (shift+tab to cycle)") === null, "모드 줄의 괄호 안내는 키 안내 줄이 아님");
ok(parseGuide("⏸ manual mode on · esc to interrupt") === null, "모드 줄 끝의 esc to interrupt 는 키 안내 줄이 아님");
ok(parseGuide("I want to go home") === null, "보통 문장");
ok(parseGuide("ctrl+e to explain")?.[0].key === "ctrl+e", "ctrl 키");

// 3) 창 내용: 고른 줄·번호 항목·서명
const L = screenDialog(list());
ok(L?.focus === "시험 초안(화면 질문 시험)", `목록에서 고른 줄(${L?.focus})`);
ok(screenDialog(list(0, "2m"))?.sig === L?.sig, "목록 줄 끝 시간(1m→2m)만 바뀌면 같은 창");
ok(screenDialog(list(1))?.sig !== L?.sig, "고른 줄이 바뀌면 다른 창");
const E = screenDialog(exportDlg);
ok(E?.items.length === 2 && E.items[0].label === "Copy to clipboard" && E.items[1].desc.startsWith("Save the conversation"), "번호 항목 둘(이름·설명)");
ok(screenDialog(oddNumbers)?.items.length === 0, "1부터 차례가 아닌 번호는 선택지로 보지 않음");
ok(screenDialog(approval)?.items.length === 3, "승인 창 번호 항목 셋");

// 4) 폰 카드: 선택지와 누를 키
const keyOf = (c, label) => JSON.stringify(c.press.get(label));
const cn = dialogCard(screenDialog(nudge));
ok(JSON.stringify(cn.options.map((o) => o.label)) === JSON.stringify(["검토하고 보내기 (Enter)", "초안 버리고 종료 (Esc)"]), `종료 안내 선택지(${cn.options.map((o) => o.label).join(", ")})`);
ok(keyOf(cn, "검토하고 보내기 (Enter)") === '{"key":"Enter"}' && keyOf(cn, "초안 버리고 종료 (Esc)") === '{"key":"Escape"}', "종료 안내 키(Enter·Escape)");
ok(cn.question.split("\n")[0] === "맥 화면: 보내지 않은 피드백 초안이 1개 있어요" && cn.question.includes("You have 1 unsent feedback draft"), "종료 안내 카드 제목(한글)과 원문");
ok(cn.options[0].description === "Enter to review & send", "선택지 설명에 원문 키 안내");
const cl = dialogCard(L);
ok(JSON.stringify(cl.options.map((o) => o.label)) === JSON.stringify(["검토 (Enter)", "버리기 (d)", "닫기 (Esc)"]), `목록 선택지(${cl.options.map((o) => o.label).join(", ")})`);
ok(keyOf(cl, "버리기 (d)") === '{"text":"d"}', "글자 키는 글자 그대로");
ok(cl.question.includes("❯ 시험 초안(화면 질문 시험)"), "카드 글에 고른 줄 표시");
const cr = dialogCard(screenDialog(review));
ok(JSON.stringify(cr.options.map((o) => o.label)) === JSON.stringify(["위로 (↑)", "아래로 (↓)", "보내기 (Enter)", "버리기 (d)", "나중에 (Esc)"]), `검토 선택지(${cr.options.map((o) => o.label).join(", ")})`);
ok(keyOf(cr, "위로 (↑)") === '{"key":"Up"}' && keyOf(cr, "아래로 (↓)") === '{"key":"Down"}', "화살표 키");
const ce = dialogCard(E);
ok(JSON.stringify(ce.options.map((o) => o.label)) === JSON.stringify(["1. Copy to clipboard", "2. Save to file", "취소 (Esc)"]), `/export 선택지(${ce.options.map((o) => o.label).join(", ")})`);
ok(keyOf(ce, "2. Save to file") === '{"text":"2"}' && ce.question.split("\n")[0] === "맥 화면: 대화 내보내기", "번호는 숫자 키, 제목 한글");
const ca = dialogCard(screenDialog(approval));
ok(keyOf(ca, "explain (ctrl+e)") === '{"key":"C-e"}' && ca.options.some((o) => o.label === "amend (Tab)" && o.description === ""), "사전에 없는 동작은 원문, ctrl 키는 C-");

// 5) 50칸(폰으로 볼 때): 접힌 키 안내·번호 항목도 다 읽음
const labelsOf = (scr) => dialogCard(screenDialog(scr)).options.map((o) => o.label).join(", ");
ok(labelsOf(nudge50) === "검토하고 보내기 (Enter), 초안 버리고 종료 (Esc)", `50칸 종료 안내 선택지(${labelsOf(nudge50)})`);
ok(labelsOf(list50) === "검토 (Enter), 버리기 (d), 닫기 (Esc)" && screenDialog(list50).focus === "시험 초안(화면 질…", `50칸 목록 선택지·고른 줄(${labelsOf(list50)})`);
ok(labelsOf(review50) === "위로 (↑), 아래로 (↓), 보내기 (Enter), 버리기 (d), 나중에 (Esc)", `50칸 검토: 접힌 뒷줄만이 아니라 앞줄 키까지(${labelsOf(review50)})`);
const E50 = screenDialog(export50);
ok(E50.items[0].desc === "Copy the conversation to your system clipboard" && E50.items[1].desc === "Save the conversation to a file in the current directory", `50칸 번호 항목 설명을 이어 붙임(${E50.items.map((i) => i.desc).join(" / ")})`);
const A50 = screenDialog(approval50);
ok(A50.items[1]?.label === "Yes, and don't ask again for touch commands in /tmp" && A50.items.length === 3, `50칸 접힌 번호 항목 이름을 이어 붙임(${A50.items[1]?.label})`);
ok(labelsOf(approval50).endsWith("취소 (Esc), amend (Tab), explain (ctrl+e)"), `50칸 승인 창 키 안내 셋(${labelsOf(approval50)})`);
ok(screenDialog(list50).sig === screenDialog(list50.replace("bug · 1m", "bug · 2m")).sig, "50칸 목록 줄 끝 시간이 바뀌어도 같은 창");
ok(dialogCard(screenDialog(nudgeNoBorder)).question.split("\n")[0] === "맥 화면: 보내지 않은 피드백 초안이 1개 있어요" && screenDialog(nudgeNoBorder).lines.length === 1, "테두리 없는 종료 안내 카드: 창 글은 안내 한 줄뿐");
ok(dialogCard(screenDialog(nudgeBlankAbove)).title === "보내지 않은 피드백 초안이 2개 있어요", "초안이 여럿(drafts)이어도 한글 제목");
ok(screenDialog(approvalCol0).items.length === 2, "맨 앞 칸 '❯ 1.' 번호 항목도 선택지");

// 번호 없는 고르기 창(11-24 사용자 보고: 아티팩트 지우기 확인 '❯ No / Yes' 가 폰 카드에 No·Yes 없이 Esc·Tab 만 나옴)
const del = (focusYes = false, pad = "") => `● Artifact(delete "시험" · https://claude.ai/artifact/abc)\n  ⎿  Waiting…\n\n${LINE}\n${pad}Permanently delete "시험"?\n\n` +
  `${pad}${focusYes ? "  No" : "❯ No"}\n${pad}${focusYes ? "❯ Yes" : "  Yes"}\n\n${pad}Esc to cancel · Tab to amend\n`;
const D1 = screenDialog(del());
ok(D1?.title === 'Permanently delete "시험"?' && D1.items.map((i) => i.label).join("|") === "No|Yes" && D1.cursor === 0, `번호 없는 선택지 No·Yes 를 읽음(${D1?.items.map((i) => i.label).join("|")}, 지금 줄 ${D1?.cursor})`);
const C1 = dialogCard(D1);
ok(labelsOf(del()) === "아니요 (No), 예 (Yes), 취소 (Esc), amend (Tab)", `카드 선택지: 아니요·예 다음에 키 안내(${labelsOf(del())})`);
ok(JSON.stringify(C1.press.get("아니요 (No)")) === '[{"key":"Enter"}]' && JSON.stringify(C1.press.get("예 (Yes)")) === '[{"key":"Down"},{"key":"Enter"}]', "누를 키: 지금 줄은 Enter, 아래 줄은 ↓ 다음 Enter");
ok(/맥에서 지금 고른 줄/.test(C1.options[0].description) && !/맥에서 지금 고른 줄/.test(C1.options[1].description), "지금 맥에서 고른 줄을 설명에 표시");
const D2 = screenDialog(del(true, " "));
ok(D2?.cursor === 1 && JSON.stringify(dialogCard(D2).press.get("아니요 (No)")) === '[{"key":"Up"},{"key":"Enter"}]', "맥에서 Yes 로 옮겨 둔 창(한 칸 들여 씀): No 는 ↑ 다음 Enter");
ok(D1.sig !== D2.sig, "고른 줄이 다르면 다른 창(옮긴 뒤 옛 카드의 키를 누르지 않게)");
ok(screenDialog(list()).items.length === 0 && screenDialog(review).items.length === 0, "Enter 동작이 따로 있는 창(초안 목록·검토)은 예전처럼 키 안내로만");
// Claude Code 2.1.331 의 /export: 번호 없이 '❯ Copy to clipboard', 키 안내 '↑/↓ to navigate · Enter to select · Esc to cancel'(11-24 캡처)
const export331 = (down = false) => ` ▐▛███▛█   Claude Code v2.1.331\n\n❯ /export\n\n${LINE}\n  Export conversation\n\n` +
  `  ${down ? "  " : "❯ "}Copy to clipboard  Copy the conversation to your system clipboard\n  ${down ? "❯ " : "  "}Save to file       Save the conversation to a file in the current directory\n` +
  "  ↑/↓ to navigate · Enter to select · Esc to cancel\n";
const X = screenDialog(export331());
ok(X?.items.map((i) => i.label).join("|") === "Copy to clipboard|Save to file" && X.items[1].desc === "Save the conversation to a file in the current directory" && X.cursor === 0, `2.1.331 /export: 번호 없는 선택지(${X?.items.map((i) => i.label).join("|")})`);
ok(labelsOf(export331()) === "Copy to clipboard, Save to file, 취소 (Esc)", `2.1.331 /export 카드: 옮기기·고르기 안내는 빼고 선택지와 취소(${labelsOf(export331())})`);
ok(JSON.stringify(dialogCard(screenDialog(export331(true))).press.get("Copy to clipboard")) === '[{"key":"Up"},{"key":"Enter"}]', "아래 줄로 옮겨 둔 창에서 위 선택지: ↑ 다음 Enter");
const export331n = `${blank(3)}${"▔".repeat(40)}\n   Export conversation\n   ❯ Copy to clipboard  Copy the\n                        conversation to your\n                        system clipboard\n` +
  "     Save to file       Save the\n                        conversation to a\n                        file\n   ↑/↓ to navigate · Enter to\n   select · Esc to cancel\n";
const XN = screenDialog(export331n);
ok(XN?.items.length === 2 && XN.items[0].desc === "Copy the conversation to your system clipboard" && XN.items[1].label === "Save to file", `50칸 접힌 설명도 한 선택지로(${XN?.items.map((i) => `${i.label}: ${i.desc}`).join(" / ")})`);

console.log(`전체 ${total}개 중 틀림 ${bad}개`);
process.exit(bad ? 1 : 0);
