// 계정 전환 때 다시 켤 옵션(relaunchArgs)·입력창 빈칸(inputEmpty)·인수인계 글 시험. 실행: node claude-remote/test/switch-cases.mjs
const { relaunchArgs: r, inputEmpty, inputLine, restoredPrompt, handoffAsk, handoffDoc, handoffResume, handoffWithPending } = await import(new URL("../claude-feed.mjs", import.meta.url).pathname);
let fail = 0, total = 0;
const eq = (got, want, n) => { total++; if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`틀림: ${n}\n  결과 ${JSON.stringify(got)}\n  기대 ${JSON.stringify(want)}`); } };
eq(r("claude", "auto"), ["--permission-mode", "auto"], "옵션 없음 → 지금 모드만");
eq(r("claude", null), [], "모드를 모르면 넣지 않음");
eq(r("claude --dangerously-skip-permissions", "bypass"), ["--dangerously-skip-permissions", "--permission-mode", "bypassPermissions"], "모두 허용 모드");
eq(r("claude --model haiku --permission-mode manual --setting-sources project,local --settings /tmp/cctest-hooks.json", "plan"),
  ["--model", "haiku", "--setting-sources", "project,local", "--settings", "/tmp/cctest-hooks.json", "--permission-mode", "plan"], "시험 옵션 유지, 권한 모드는 지금 것으로");
eq(r("claude --resume 11111111-2222-3333-4444-555555555555 --model opus", "auto"), ["--model", "opus", "--permission-mode", "auto"], "--resume 값과 함께 뺌");
eq(r("claude -r --model opus", "auto"), ["--model", "opus", "--permission-mode", "auto"], "-r 값 없이");
eq(r("claude -c", "manual"), ["--permission-mode", "manual"], "--continue 뺌");
eq(r("claude fix the bug please", "auto"), ["--permission-mode", "auto"], "처음 넘긴 프롬프트 글은 뺌");
eq(r("claude --add-dir /a /b --model opus hello", "auto"), ["--add-dir", "/a", "/b", "--model", "opus", "--permission-mode", "auto"], "여러 값 옵션");
eq(r("claude --model=opus --effort=high", "auto"), ["--model=opus", "--effort=high", "--permission-mode", "auto"], "이름=값 형태");
eq(r("claude -w feature --model opus", "auto"), ["--model", "opus", "--permission-mode", "auto"], "새 작업 폴더 옵션은 뺌");
eq(r("claude --weird-new-flag", "auto"), null, "모르는 옵션 → 다시 켜지 않음");
eq(r("claude --weird=1", "auto"), null, "모르는 옵션(=값) → 다시 켜지 않음");
eq(r("claude --settings {\"a\":1}", "auto"), null, "중괄호·따옴표 → 다시 켜지 않음");
eq(r("claude --model", "auto"), null, "값이 빠진 옵션 → 다시 켜지 않음");
eq(r("claude mcp list", "auto"), null, "하위 명령 → 다시 켜지 않음");
eq(r("/Users/me/.local/bin/claude --model opus", "auto"), ["--model", "opus", "--permission-mode", "auto"], "전체 경로로 켠 경우");

const box = (input, extra = "") => `⏺ 이전 답\n\n${extra}──────────\n${input}\n──────────\n  ⏸ manual mode on · ? for shortcuts`;
eq(inputEmpty(box("❯ ")), true, "빈 입력창");
eq(inputEmpty(box("❯")), true, "빈 입력창(공백 없음)");
eq(inputEmpty(box('❯ Try "create a util logging.py that..."')), true, "안내 문구만");
eq(inputEmpty(box("❯ draft words")), false, "쓰던 글");
eq(inputEmpty(box("❯ first line\n  second line")), false, "여러 줄로 쓰는 중");
eq(inputEmpty(box("❯ ", "❯ 이전에 보낸 내 메시지\n\n")), true, "대화 속 내 메시지(❯)는 무시하고 입력창만");
eq(inputEmpty("화면에 입력창이 없음"), false, "입력창이 안 보이면 빈 것으로 보지 않음");

// 인수인계(사용자 결정 11-18): 문서는 줄 맨 앞 '# 인수인계' 부터. 한도 오류 글 등은 문서가 아님
eq(handoffDoc("# 인수인계\n- 할 일\n"), "# 인수인계\n- 할 일\n", "문서 그대로");
eq(handoffDoc("알겠습니다. 아래가 문서입니다.\n\n# 인수인계 (11-18)\n본문  \n\n"), "# 인수인계 (11-18)\n본문\n", "앞말은 떼고 끝 빈칸 정리");
eq(handoffDoc("API Error: 429 rate_limit_error"), null, "한도 오류 글 → 문서 아님");
eq(handoffDoc("본문에 # 인수인계 라는 말이 섞임"), null, "줄 맨 앞이 아니면 문서 아님");
eq(handoffDoc(""), null, "빈 답");
eq(handoffDoc(undefined), null, "답 없음");
const ask = handoffAsk("개인 계정 사용 한도가 95%를 넘어");
eq([ask.startsWith("[계정 전환] 개인 계정 사용 한도가 95%를 넘어 곧 이 대화를 비우고"), ask.includes("'# 인수인계'"), ask.includes("도구는 쓰지 말고")], [true, true, true], "요청 글: 까닭·제목·도구 금지");
const withDoc = handoffResume({ reason: "개인 계정 사용 한도가 95%를 넘어", docPath: "/w/.work/handoff/20261118-230000.md", transcript: "/t.jsonl" });
eq([withDoc.includes("인수인계 문서 /w/.work/handoff/20261118-230000.md 를 먼저 읽으세요"), withDoc.includes("/t.jsonl"), withDoc.includes("\n")], [true, false, false], "이어 가기: 문서 경로(띄어 씀), 한 줄");
const noDoc = handoffResume({ reason: "기본 계정(개인)의 한도가 풀려", docPath: null, transcript: "/t.jsonl" });
eq([noDoc.includes("남기지 못했습니다"), noDoc.includes("앞 대화 기록 파일 /t.jsonl (한 줄에 JSON 하나)"), noDoc.includes("\n")], [true, true, false], "문서를 못 받음 → 앞 대화 기록, 한 줄");

// 답이 나오기 전에 Esc 로 멈추면 방금 보낸 글이 입력창에 되돌아옴(11-18 실제 Claude Code 로 확인)
eq(inputLine(box("❯ Write a story")), "Write a story", "입력창 첫 줄");
eq(inputLine(box("❯ ")), "", "빈 입력창 → 빈 글");
eq(inputLine("입력창 없음"), null, "입력창이 안 보이면 null");
eq(restoredPrompt("Write a 1500-word short story about a", "Write a 1500-word short story about a lighthouse keeper named Ilsu. Do not use any tools."), true, "되돌아온 글(화면에서 줄이 접혀 앞부분만 보임)");
eq(restoredPrompt("[Pasted text #2 +7 lines]", "[계정 전환] …\n넣을 것: …"), true, "붙여 넣은 글 자리표시");
eq(restoredPrompt("첫 줄  둘째", "첫 줄\n둘째 줄"), true, "줄바꿈·빈칸은 하나로 보고 견줌");
eq(restoredPrompt("draft words", "Write a story"), false, "다른 글(맥에서 쓰는 중) → 되돌아온 글 아님");
eq(restoredPrompt("", "Write a story"), false, "빈 입력창");
eq(restoredPrompt("Write", ""), false, "마지막 사람 글 없음");
const askP = handoffAsk("개인 계정 사용 한도가 95%를 넘어", "Write a story");
eq([askP.includes("'다음에 할 일' 맨 앞에 이 요청을 넣으세요:\nWrite a story"), handoffAsk("x").includes("방금 보낸 요청")], [true, false], "요청 글: 답하지 못한 사용자 글을 넣음(없으면 그 말이 없음)");
eq(handoffWithPending("# 인수인계\n본문\n", "Write a story\n"), "# 인수인계\n본문\n\n## 멈추느라 답하지 못한 사용자 요청(연결부가 덧붙임)\n\nWrite a story\n", "문서 끝에 답하지 못한 글 덧붙임");
eq(handoffWithPending("# 인수인계\n본문\n", ""), "# 인수인계\n본문\n", "없으면 그대로");
// 떠나는 계정이 한도에 걸려 인수인계를 쓸 수 없는지(11-21: 그 창을 몰라 10분을 기다림)
const { limitStopped } = await import(new URL("../claude-feed.mjs", import.meta.url).pathname);
const LIMIT_SCREEN = "  ⎿  You've hit your Fable limit · resets Nov 23 at 4pm (Asia/Seoul)\n─────\n What do you want to do?\n\n ❯ 1. Stop and wait for limit to reset\n   2. Wait here, then continue automatically at Nov 23 at 4pm\n   3. Switch to usage credits · at least 40% off one purchase · 6 days left\n\n Enter to confirm · Esc to cancel";
eq(limitStopped(LIMIT_SCREEN, null), true, "한도 창이 뜬 화면");
eq(limitStopped("❯ \n────\n  ⏵⏵ auto mode on", "You've hit your Fable limit · resets Nov 23 at 4pm (Asia/Seoul)"), true, "창 없이 한도 오류 답만");
eq(limitStopped("❯ \n────\n  ⏵⏵ auto mode on", "Claude usage limit reached. Your limit will reset at 5pm"), true, "예전 문구의 한도 오류");
eq(limitStopped(" Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel", null), false, "다른 확인 창은 아님");
eq(limitStopped("❯ \n────", "API Error: 500 Internal server error"), false, "다른 API 오류는 아님");
eq(limitStopped("⏺ # 인수인계\n지금까지 한 일…", null), false, "보통 답");
console.log(`전체 ${total}개 중 틀림 ${fail}개`);
process.exit(fail ? 1 : 0);
