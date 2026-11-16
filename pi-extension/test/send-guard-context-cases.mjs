// send-guard 승인 카드 정보 시험: 작업 맥락, 실행되는 스크립트 찾기
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const { contextOf, scriptsIn, classifyCommand: cc, classifyMcp: cm, splitSummary, readableInput, looksLikeCode, riskOf, needsCondense, approvalBox } = await import(process.env.GUARD_PATH);
let fail = 0;
const ok = (c, name) => { console.log(`${c ? "통과" : "실패"}: ${name}`); if (!c) fail++; };

// 1. 맥락
const msg = (role, text) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });
const tool = { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }] } };
const br = [msg("user", "옛 요청"), msg("assistant", "옛 답"), msg("user", "VPN 가드를 다시 설치해 줘"), msg("assistant", "가드 스크립트를 관리자 권한으로 다시 설치할게요."), tool];
const c1 = contextOf(br, "# VPN 가드 재설치\nsudo sh deploy/x.sh");
ok(c1.task === "VPN 가드를 다시 설치해 줘", "작업: 이번 차례의 사용자 요청");
ok(c1.intent === "가드 스크립트를 관리자 권한으로 다시 설치할게요.", "pi 설명: 명령 직전 pi 의 말(글 없는 도구 호출은 건너뜀)");
ok(c1.note === "VPN 가드 재설치", "명령 설명: 첫 줄 # 주석");
const c2 = contextOf([msg("user", "x".repeat(1000))], "ls");
ok(c2.task.length === 401 && c2.task.endsWith("…") && c2.note === "" && c2.intent === "", "긴 요청은 자름, 주석·설명 없으면 빈 값");
ok(contextOf([], "").task === "", "기록이 없어도 오류 없음");

// 2. 스크립트 찾기
const d = mkdtempSync(`${tmpdir()}/sg-`);
mkdirSync(`${d}/deploy`); mkdirSync(`${d}/sub`);
writeFileSync(`${d}/deploy/install.sh`, "#!/bin/sh\n# 설치\nrm -rf /tmp/x\n");
writeFileSync(`${d}/fix.py`, "print('hi')\n");
writeFileSync(`${d}/sub/run.sh`, "echo sub\n");
writeFileSync(`${d}/m.sql`, "delete from t;\n");
writeFileSync(`${d}/big.sh`, Array.from({ length: 600 }, (_, i) => `echo ${i}`).join("\n") + "\n");
writeFileSync(`${d}/bin.dat`, Buffer.from([0, 1, 2, 0]));
const names = (cmd) => scriptsIn(cmd, d, "/nohome").map((s) => s.path.replace(d, "D"));
ok(names("sudo sh deploy/install.sh").join() === "D/deploy/install.sh", "sudo sh 상대 경로");
ok(names("sudo -E env A=1 bash ./deploy/install.sh --yes").join() === "D/deploy/install.sh", "sudo 옵션·env·변수 건너뛰기");
ok(names("cd sub && ./run.sh").join() === "D/sub/run.sh", "cd 뒤 직접 실행");
ok(names(`~/.pi/agent/vendor/skills-venv/bin/python ${d}/fix.py`).join() === "D/fix.py", "가상 환경 파이썬 + 절대 경로");
ok(names("psql $DB -f m.sql").join() === "D/m.sql", "psql -f 파일");
ok(names("python3 -c 'print(1)'").length === 0 && names("bash -c 'rm -rf x'").length === 0, "-c 로 넘긴 코드는 스크립트 없음");
ok(names("sudo rm -rf /tmp/x").length === 0 && names("sh missing.sh").length === 0, "스크립트 없음·없는 파일");
ok(names("sudo /bin/launchctl list").length === 0 && names("cat bin.dat; ./bin.dat").length === 0, "시스템 실행 파일·이진 파일 제외");
const big = scriptsIn("bash big.sh", d)[0];
ok(big.lines === 600 && big.truncated && big.content.split("\n").length === 400, "긴 스크립트: 전체 줄 수, 앞 400줄만");
ok(names("sh deploy/install.sh; sh deploy/install.sh && bash fix.py; bash sub/run.sh; bash big.sh").length === 3, "같은 파일은 한 번, 최대 3개");

// 3. heredoc: 파일에 적기만 하면 본문은 판정에서 뺌
const k = (c) => cc(c)?.kind ?? "-";
ok(k("cat > a.mjs <<'EOF'\nrmSync(d); rm -rf /tmp/x ~/y\nEOF") === "-", "cat > 파일 <<EOF 본문의 rm -rf 는 무시");
ok(k("cat <<EOF > notes.md\nsudo reboot\nEOF\necho ok") === "-", "cat <<EOF > 파일 순서도");
ok(k("tee -a log.txt <<'X'\ngit push --force\nX") === "-", "tee 파일 <<X");
ok(k("cat <<'EOF' | bash\nrm -rf ~/work\nEOF") === "danger", "본문을 bash 로 넘기면 검사");
ok(k("bash <<'EOF'\nrm -rf ~/work\nEOF") === "danger" && k("python3 - <<'EOF'\nimport os\nEOF\nsudo ls") === "danger", "bash <<EOF·heredoc 뒤 명령은 검사");
ok(k("sudo tee /etc/hosts <<EOF\n1.2.3.4 x\nEOF") === "danger", "sudo tee 는 명령 줄에서 걸림");
ok(k("cat > a.sh <<'EOF'\nrm -rf ~/x\n") === "danger", "끝 표시가 없으면 그대로 검사");
ok(k("cat <<'EOF' | curl -X POST https://hooks.slack.com/services/x -d @-\nhi\nEOF") === "send", "본문을 curl 로 보내면 전송으로 검사");


// 4. GitHub: 커밋·푸시·PR 올리기는 묻지 않고, 셀프머지는 승인
const g = (c) => { const h = cc(c); return h ? `${h.kind}:${h.label}` : "-"; };
ok(g("git commit -m x && git push") === "-" && g('gh pr create --title "x" --body "y"') === "-", "커밋·푸시·PR 올리기는 묻지 않음");
ok(g("gh api -X POST repos/o/r/pulls -f title=x -f head=b -f base=main") === "-", "API 로 PR 올리기도 묻지 않음");
ok(g("gh pr merge 12 --squash --delete-branch") === "danger:PR 병합(셀프머지)", "gh pr merge → 셀프머지 승인");
ok(g("gh api -X PUT repos/o/r/pulls/12/merge") === "danger:PR 병합(셀프머지)" && g("gh api graphql -f query='mutation { mergePullRequest(input:{}) { clientMutationId } }'") === "danger:PR 병합(셀프머지)", "API 병합도 승인");
ok(g('gh pr comment 12 --body "LGTM"').startsWith("send") && g('gh issue create -t x -b y').startsWith("send") && g("gh pr review 3 --approve").startsWith("send") && g("gh pr edit 3 --body x").startsWith("send"), "댓글·이슈·리뷰·PR 수정은 그대로 승인");
ok(g("git push --force origin main").startsWith("danger") && g("gh api -X POST repos/o/r/issues/3/comments -f body=x").startsWith("send"), "강제 푸시·API 댓글은 승인");
ok(cm("mcp__github__create_pull_request", {}) === null && cm("mcp__github__merge_pull_request", {})?.kind === "danger" && cm("mcp__github__add_issue_comment", {})?.kind === "send", "GitHub MCP: PR 올리기 허용, 병합·댓글 승인");

// 5. 한 줄 요약 나누기
const s1 = splitSummary("VPN 감시 데몬을 다시 설치하는 스크립트\n관리자 권한으로 데몬 파일을 바꿔요. 되돌리려면 옛 파일이 필요해요.");
ok(s1.headline === "VPN 감시 데몬을 다시 설치하는 스크립트" && s1.summary.startsWith("관리자 권한으로"), "첫 줄 = 한 줄 요약, 나머지 = 설명");
ok(splitSummary("**한 줄 설명:** 로그를 정리해요.\n\n설명").headline === "로그를 정리해요.", "꾸밈(**, '한 줄 설명:') 빼고 문장은 그대로");
const long = "가".repeat(130);
ok(splitSummary(long).headline === "" && splitSummary(long).summary === long, "첫 줄이 너무 길면 한 줄 요약 없이 설명으로");
ok(splitSummary("").headline === "" && splitSummary("").summary === "", "빈 요약");


// 6. 승인 카드: 코드·JSON 대신 읽기 쉬운 내용
const rd = readableInput({ channel_id: "C123", text: "배포 공지입니다\n오늘 6시", blocks: [{ type: "section" }], unfurl_links: false });
ok(rd === "받는 곳: C123\n내용: 배포 공지입니다\n오늘 6시\n그 밖의 항목 2개(원본 보기)", "MCP 입력 → 받는 곳·내용, 나머지는 개수만");
ok(readableInput({ issueKey: "PROJ-1", body: "확인했어요", to: "a@b.c", cc: ["x@y.z", "q@w.e"] }).includes("받는 곳(cc): x@y.z, q@w.e"), "같은 무리 두 번째는 키 이름을 붙임");
ok(readableInput({ query: "select 1" }) === "" && readableInput(null) === "" && readableInput([1]) === "", "읽을 항목이 없으면 빈 값");
ok(looksLikeCode('{"a":1,"b":[2,3]}') && looksLikeCode("[1,2]") && looksLikeCode("```js\nx\n```"), "JSON·코드 블록은 코드");
ok(looksLikeCode("const a = 1;\nfunction f() {\n  return a;\n}"), "프로그램 코드는 코드");
ok(!looksLikeCode("안녕하세요, 배포 공지입니다.\n- 오늘 6시\n- 30분 걸려요") && !looksLikeCode("{확인 부탁드려요}") && !looksLikeCode(""), "보통 글(목록 포함)·JSON 아닌 중괄호는 코드 아님");


// 7. 위험도
const H = (label, kind = "danger") => ({ kind, label });
ok(riskOf(H("운영 DB 쓰기")) === "상" && riskOf(H("DB 삭제(DROP·TRUNCATE)")) === "상" && riskOf(H("강제 푸시·원격 브랜치 삭제")) === "상" && riskOf(H("폴더째 지우기 · 스크립트 x.sh 안")) === "상", "되돌리기 어려운 것은 상");
ok(riskOf(H("관리자 권한(sudo)")) === "중" && riskOf(H("PR 병합(셀프머지)")) === "중" && riskOf(H("Slack 메시지 보내기", "send")) === "중", "sudo·셀프머지·보내기는 중");
ok(riskOf(H("Slack 메시지 보내기", "send"), true) === "하", "글자로만 추정한 보내기는 하");
const sr = splitSummary("위험도: 하\nVPN 감시 데몬의 상태만 확인해요.");
ok(sr.risk === "하" && sr.headline === "VPN 감시 데몬의 상태만 확인해요." && sr.summary === "", "Haiku 위험도 줄 → 위험도, 다음 줄 = 한 문장 설명");
const sr2 = splitSummary("**위험도: 상**\n운영 DB 의 주문 표를 비워요.\n지운 자료는 되돌릴 수 없어요.");
ok(sr2.risk === "상" && sr2.headline === "운영 DB 의 주문 표를 비워요." && sr2.summary === "지운 자료는 되돌릴 수 없어요.", "꾸밈 붙은 위험도 줄 + 주의 한 문장");
ok(splitSummary("설명만 있어요.").risk === undefined, "위험도 줄이 없으면 걸린 이유로 정한 값 그대로");


// 8. 보낼 글 요약 판정, TUI 승인 상자
ok(needsCondense("### 문제\n내용") && needsCondense("- 하나\n- 둘") && needsCondense("<p>안녕</p>") && needsCondense("`code` 포함") && needsCondense("가\n나\n다\n라"), "마크다운·HTML·코드·4줄 이상은 요약");
ok(!needsCondense("오늘 6시에 배포해요. 확인 부탁드려요.") && !needsCondense("안녕하세요\n내일 봬요"), "짧은 보통 글은 그대로");
const { visibleWidth } = await import(new URL("node_modules/@earendil-works/pi-tui/dist/index.js", `file://${process.env.GUARD_PATH.replace(/[^/]+$/, "")}`).href);
const view = { risk: "중", reason: "관리자 권한(sudo)", purpose: "오래된 로그 정리", to: "", content: "", scripts: ["cleanup.sh"], sentence: "", caution: "", summarizing: true };
const b1 = approvalBox(view, 0, 80);
ok(b1.every((l) => visibleWidth(l) <= 80) && b1[0].includes("● 승인이 필요합니다 (중)") && b1.some((l) => l.includes("❯ 1. 거부")) && b1.some((l) => l.includes("설명을 쓰는 중")), "상자: 폭 안·제목·위험도·기본 거부·설명 쓰는 중");
const b2 = approvalBox({ ...view, sentence: "관리자 권한으로 7일 넘은 로그를 지우고 데모 서비스를 다시 시작해요. ".repeat(2), caution: "지운 로그는 되돌릴 수 없어요.", summarizing: false, risk: "상" }, 1, 60);
ok(b2.every((l) => visibleWidth(l) <= 60) && b2[0].includes("● 승인이 필요합니다 (상)") && b2.some((l) => l.includes("❯ 2. 허용")) && !b2.some((l) => l.includes("설명을 쓰는 중")) && b2.some((l) => l.includes("관리자 권한(sudo) · 오래된 로그 정리")), "상자: 긴 한글 문장 줄바꿈·고른 줄·걸린 이유 · 하려는 일");
console.log(approvalBox({ ...view, sentence: "관리자 권한으로 시험용 로그 폴더에서 7일 넘은 로그를 지우고 데모 서비스를 다시 시작해요.", caution: "지운 로그는 되돌릴 수 없어요.", summarizing: false }, 0, 78).join("\n"));


// 9. Jira 조회는 묻지 않음, 비밀값 파일은 스크립트로 읽지 않음
const jira = `# 오늘 내가 갱신한 JIRA 목록(REST 조회)\nset -a; . ~/.config/jira/credentials; set +a\ncurl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" -G "$BASE/rest/api/3/search/jql" --data-urlencode 'jql=issuekey in updatedBy("x")' --data-urlencode 'maxResults=50' | python3 -c "import json"`;
ok(cc(jira) === null, "Jira 조회(curl -G --data-urlencode)는 묻지 않음");
ok(cc(`curl -s -u a:b -X POST https://x.atlassian.net/rest/api/3/issue -d '{}'`)?.kind === "send" && cc(`curl -s -u a:b https://x.atlassian.net/rest/api/3/issue/X-1/comment --data '{"body":"x"}'`)?.kind === "send", "Jira 쓰기(POST·--data)는 그대로 승인");
const sd = mkdtempSync(`${tmpdir()}/sec-`);
writeFileSync(`${sd}/credentials`, "JIRA_API_TOKEN=secret\n"); writeFileSync(`${sd}/.env`, "KEY=1\n"); writeFileSync(`${sd}/setup.sh`, "echo hi\n"); writeFileSync(`${sd}/api_token.txt`, "x\n");
const sn = (cmd) => scriptsIn(cmd, sd).map((x) => x.path.split("/").pop());
ok(sn(". ./credentials; source .env; cat api_token.txt").length === 0, "credentials·.env·토큰 파일은 읽지 않음");
ok(sn("source setup.sh").join() === "setup.sh" && sn("bash ./credentials").length === 0, "source 는 셸 스크립트만, 비밀값 이름 파일은 실행해도 읽지 않음");
rmSync(sd, { recursive: true });

rmSync(d, { recursive: true });

// --- 사용자 결정(2026-11-12): Jira 상태 바꾸기·임시 폴더 안 삭제는 묻지 않음 ---
{
  const k = (cmd) => cc(cmd)?.kind ?? "-";
  // 임시 폴더 삭제
  ok(k("rm -rf /tmp/cctest") === "-" && k("rm -rf /private/tmp/a /tmp/b") === "-" && k("rm -rf /var/folders/xy/T/pi-x") === "-", "임시 폴더 안 삭제는 통과");
  ok(k("rm -rf $TMPDIR/pi-x") === "-" && k("rm -rf ~/.cache/pi-remote/thumbs") === "-", "$TMPDIR·캐시 폴더 안도 통과");
  ok(k("rm -rf /tmp/../Users/me/works") === "danger", "'..'로 임시 폴더 밖으로 나가면 승인");
  ok(k("rm -rf $TMPDIR/../x") === "danger", "$TMPDIR/.. 도 승인");
  ok(k("rm -rf /tmp") === "danger" && k("rm -rf /tmp/") === "danger", "임시 폴더 자체를 지우면 승인");
  ok(k("rm -rf /tmp/a ~/works/x") === "danger", "대상 중 하나라도 밖이면 승인");
  ok(k("cd /tmp/work && rm -rf build dist") === "-", "임시 폴더로 cd 한 뒤 상대 경로 삭제는 통과");
  ok(k("cd ~/works/personal/antenna && rm -rf build") === "danger", "일반 폴더로 cd 한 뒤 삭제는 승인");
  ok(k("cd /tmp/work && rm -rf ../../Users/me/x") === "danger", "cd 뒤라도 .. 로 나가면 승인");
  ok(k("rm -rf build") === "danger", "어디인지 모르는 상대 경로는 승인");
  // Jira 상태 바꾸기
  ok(cm("mcp__jira__jira_transition_issue", { issueKey: "PROJ-1", transitionName: "Done" }) === null, "Jira 상태 바꾸기(MCP, 댓글 없음)는 통과");
  ok(cm("mcp__jira__jira_transition_issue", { issueKey: "PROJ-1", transitionName: "Done", comment: "완료했어요" })?.kind === "send", "상태 바꾸면서 댓글 달면 승인");
  ok(cm("mcp__jira__jira_add_comment", { issueKey: "PROJ-1", body: "x" })?.kind === "send" && cm("mcp__jira__jira_update_issue", { issueKey: "PROJ-1" })?.kind === "send", "댓글·이슈 고치기는 그대로 승인");
  ok(cm("mcp__jira__jira_get_transitions", { issueKey: "PROJ-1" }) === null, "상태 목록 보기는 통과");
  ok(k(`curl -s -X POST -H 'Content-Type: application/json' https://example.atlassian.net/rest/api/3/issue/PROJ-12/transitions -d '{"transition":{"id":"31"}}'`) === "-", "명령으로 상태 바꾸기(전환만)는 통과");
  ok(k(`curl -s -X POST https://example.atlassian.net/rest/api/3/issue/PROJ-12/transitions -d '{"transition":{"id":"31"},"update":{"comment":[{"add":{"body":"x"}}]}}'`) === "send", "명령으로 상태 바꾸며 댓글 달면 승인");
  ok(k(`curl -s -X POST https://example.atlassian.net/rest/api/3/issue/PROJ-12/comment -d '{"body":"x"}'`) === "send", "명령으로 댓글은 승인");
  ok(k(`curl -s -X POST https://example.atlassian.net/rest/api/3/issue/PROJ-12/transitions -d '{"transition":{"id":"31"}}' && curl -X PUT https://example.atlassian.net/rest/api/3/issue/PROJ-12 -d '{"fields":{}}'`) === "send", "전환과 다른 쓰기가 섞이면 승인");
  ok(k("acli jira workitem transition --key PROJ-1 --status Done") === "-", "acli 상태 바꾸기는 통과");
  ok(k("acli jira workitem comment create --key PROJ-1 --body x") === "send", "acli 댓글은 승인");
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
