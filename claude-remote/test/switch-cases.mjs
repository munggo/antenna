// 계정 전환 때 다시 켤 옵션(relaunchArgs)·입력창 빈칸(inputEmpty) 판정 시험. 실행: node claude-remote/test/switch-cases.mjs
const { relaunchArgs: r, inputEmpty } = await import(new URL("../claude-feed.mjs", import.meta.url).pathname);
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
console.log(`전체 ${total}개 중 틀림 ${fail}개`);
process.exit(fail ? 1 : 0);
