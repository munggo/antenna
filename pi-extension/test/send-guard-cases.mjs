// send-guard 판정 시험(시험 자료만 담음. 아무것도 실행하지 않음)
// 실행: sh pi-extension/test/run.sh
const { classifyCommand: c, classifyMcp: m } = await import(process.env.GUARD_PATH);
const kind = (h) => (h ? h.kind : "-");
let fail = 0, total = 0;
const check = (want, h, what) => { total++; if (kind(h) !== want) { fail++; console.log(`틀림 기대 ${want} 결과 ${kind(h)} | ${what}`); } };

// 1) bash 명령
const cmds = [
  ["send", `curl -X POST -H 'Content-type: application/json' --data '{"text":"hi"}' https://hooks.slack.com/services/T/B/X`],
  ["send", `curl -s https://slack.com/api/chat.postMessage -d channel=C1 -d text=hi`],
  ["-", `curl -s "https://slack.com/api/conversations.history?channel=C1"`],
  ["send", `curl -u me:tok -X POST https://example.atlassian.net/rest/api/3/issue/PROJ-1/comment --json '{"body":"x"}'`],
  ["-", `curl -u me:tok https://example.atlassian.net/rest/api/3/issue/PROJ-1`],
  ["send", `echo hi | mail -s test a@b.com`], ["send", `/usr/sbin/sendmail -t < msg.txt`],
  ["send", `gh pr comment 12 --body "LGTM"`], ["-", `gh pr view 12`],
  ["send", `gh api repos/o/r/issues/1/comments -f body=hi`], ["-", `gh api repos/o/r/pulls`],
  ["send", `osascript -e 'tell application "Messages" to send "hi" to buddy "x"'`],
  ["send", `curl https://api.telegram.org/bot123:ABC/sendMessage -d chat_id=1 -d text=hi`],
  ["-", `grep -rn mail src/`], ["-", `python3 send_mail.py`],
  ["danger", `rm -rf ~/works/project`], ["-", `rm -rf /tmp/pitest-sessions`], ["danger", `rm -rf /tmp/a /Users/me/x`],
  ["-", `rm -r "$TMPDIR/x"`], ["-", `rm file.txt`], ["-", `rm -f a.txt b.txt`],
  ["danger", `sudo -n launchctl print system/x`],
  ["danger", `git push --force origin main`], ["danger", `git push -f`], ["-", `git push origin main`],
  ["danger", `git push origin +main`], ["danger", `git push origin --delete old`],
  ["danger", `git reset --hard HEAD~1`], ["-", `git reset --soft HEAD~1`], ["danger", `git clean -fd`],
  ["danger", `git branch -D feature`], ["-", `git branch -d feature`],
  ["danger", `psql -c "DROP TABLE users"`], ["danger", `psql -c "DELETE FROM users;"`],
  ["danger", `psql -c "DELETE FROM users WHERE id=1;"`],
  ["danger", `aws s3 rm s3://b/k --recursive`], ["danger", `aws ec2 terminate-instances --instance-ids i-1`], ["-", `aws s3 ls`],
  ["danger", `aws ssm send-command --instance-ids i-1 --document-name AWS-RunShellScript`],
  ["danger", `kubectl delete pod x`], ["danger", `terraform apply`], ["-", `terraform plan`],
  ["danger", `npm publish`], ["-", `npm install`], ["danger", `shutdown -h now`], ["-", `echo shutdown`],
  ["-", `# 설명: rm -rf ~ 같은 건 주석이라 무시\nls -la`],
  ["-", `tmux kill-session -t pitest 2>/dev/null; kill $(lsof -ti tcp:8799 -sTCP:LISTEN) 2>/dev/null`],
  ["danger", `psql "$DB_URL" -c "UPDATE users SET a=1 WHERE id=2"`], ["-", `psql "$DB_URL" -c "SELECT count(*) FROM users"`],
  ["danger", `psql "$DB_URL" -f migrate.sql`], ["danger", `mysql -e "drop table x"`],
  ["-", `git commit -m "update users set 화면 수정"`],
];
for (const [w, cmd] of cmds) check(w, c(cmd), cmd.slice(0, 70));

// 2) MCP 도구(서버별 대표)
const tools = [
  ["send", "mcp__slack__send_message"], ["-", "mcp__slack__search_messages"], ["-", "mcp__slack__get_history"], ["-", "mcp__slack__export_messages"],
  ["-", "mcp__notion__API-retrieve-a-page"], ["-", "mcp__notion__API-post-search"], ["send", "mcp__notion__API-patch-page"], ["send", "mcp__notion__API-create-a-comment"],
  ["send", "mcp__notion_company__notion-create-view"], ["send", "mcp__notion_company__notion-update-view"], ["-", "mcp__notion_company__notion-search"],
  ["send", "mcp__atlassian__addCommentToJiraIssue"], ["-", "mcp__atlassian__getJiraIssue"], ["-", "mcp__atlassian__transitionJiraIssue"], ["-", "mcp__atlassian__searchJiraIssuesUsingJql"],
  ["-", "mcp__jira__jira_get_create_meta"], ["send", "mcp__jira__jira_add_comment"],
  ["send", "mcp__gmail__send_email"], ["send", "mcp__gmail_work__delete_email"], ["-", "mcp__gmail_work__read_email"],
  ["send", "mcp__google_sheets__update_values"], ["-", "mcp__google_sheets__get_values"], ["send", "mcp__datadog__mute_host"], ["-", "mcp__datadog__get_logs"],
  ["send", "mcp__google_calendar__createEvent"], ["-", "mcp__google_calendar__getEvents"],
  ["send", "mcp__google_calendar__create-event"], ["send", "mcp__google_calendar__create-events"], ["send", "mcp__google_calendar__update-event"],
  ["send", "mcp__google_calendar__delete-event"], ["send", "mcp__google_calendar__respond-to-event"], ["send", "mcp__google_calendar__manage-accounts"],
  ["-", "mcp__google_calendar__list-events"], ["-", "mcp__google_calendar__search-events"], ["-", "mcp__google_calendar__get-freebusy"],
  ["-", "mcp__google_calendar__get-current-time"], ["-", "mcp__google_calendar__list-colors"],
  ["-", "mcp__figma__get_design_context"], ["-", "mcp__figma__whoami"], ["send", "mcp__figma__generate_figma_design"], ["send", "mcp__figma__use_figma"],
  ["-", "mcp__blender__execute_blender_code"], ["-", "mcp__rea__set_comment"],
];
for (const [w, t] of tools) check(w, m(t), t);

// 3) DB MCP 질의의 SQL
const q = (sql, server = "postgres-company-dev") => m(`mcp__${server}__query`, { sql });
const sqls = [
  ["-", "SELECT * FROM users LIMIT 5"], ["-", "with a as (select 1) select * from a"], ["-", "select 'delete from users' as note"],
  ["-", "-- update users set x=1\nselect 1"], ["-", "EXPLAIN SELECT * FROM users"],
  ["danger", "UPDATE users SET name='x' WHERE id=1"], ["danger", "delete from orders where id = 3"], ["danger", "insert into t values (1)"],
  ["danger", "DROP TABLE t"], ["danger", "alter table t add column c int"], ["danger", "select 1; truncate t"],
  ["danger", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"], ["danger", "explain analyze update t set x = 1"], ["danger", "  (UPDATE t SET x = 1)"],
];
for (const [w, sql] of sqls) check(w, q(sql), sql.slice(0, 50));

// 권한 모드 '매번 묻기'의 일반 수정·명령은 위험도 하, 위험한 일은 그대로
{
  const { riskOf } = await import(process.env.GUARD_PATH);
  const risks = [
    ["하", "파일 수정 · bridge.mjs"], ["하", "파일 쓰기 · a.txt"], ["하", "명령 실행 · 매번 묻기"],
    ["중", "폴더 밖 파일 삭제"], ["상", "강제 푸시"], ["상", "운영 DB 쓰기"],
  ];
  for (const [w, label] of risks) {
    total++;
    const r = riskOf({ kind: "danger", label });
    if (r !== w) { fail++; console.log(`틀림 위험도 기대 ${w} 결과 ${r} | ${label}`); }
  }
}

console.log(`전체 ${total}개 중 틀림 ${fail}개`);
process.exit(fail ? 1 : 0);
