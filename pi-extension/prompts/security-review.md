---
description: 보안 리뷰(커밋 안 한 변경, 없으면 지금 브랜치 vs main, PR 번호를 주면 그 PR) → 고칠 것 고르기
argument-hint: "[PR 번호] [중점]"
---
Run a security review. Arguments (may be empty): `$ARGUMENTS`

1. Decide the scope yourself with quick read-only git commands, in this order:
   - If the first argument is a PR number (`123` or `#123`): that GitHub PR (`gh pr view <n>`, `gh pr diff <n>`). Any other arguments are the review focus.
   - Else, if `git status --porcelain` shows changes: the uncommitted changes (staged, unstaged, and new untracked files).
   - Else: the current branch against the default branch (`origin/HEAD`, or `main`/`master`), i.e. `git diff <base>...HEAD`.
   - If there is nothing to review, say so in one sentence and stop.
   - If this is not a git repository, say so in one sentence and stop.
2. Delegate the review to the `subagent` tool with agent `reviewer` (one call). In the task, give the exact repository path, the scope, and the exact commands that show the changes (for untracked files: list them and tell it to read them). Tell the reviewer this is a security review, not a general review:
   - Look only at security problems newly introduced or changed by this change; trace how untrusted input reaches the changed code before judging it.
   - Categories: injection (SQL, shell/command, template, path traversal, XXE, unsafe deserialization, eval), authentication and authorization bypass or privilege escalation, secrets or tokens written in code or logs, weak or misused cryptography and certificate checks, sensitive data exposure (PII, tokens, internal errors) through logs, APIs or responses, SSRF and unsafe redirects, XSS, and unsafe file or permission handling.
   - Report only findings it is at least 80% confident are exploitable in practice. Skip denial of service, rate limiting, purely theoretical issues, and style. Something exploitable only from the local network can still be high severity.
   - For each finding: severity (high / medium / low), `file:line`, how it can be exploited (concrete input or scenario), and a concrete fix.
   - Extra focus from the user, if any: the non-PR arguments above.
3. Report to the user in Korean: one line on the scope, then the findings as a numbered list sorted by severity (`[상] file:line — 공격 방법 → 고칠 방법`). If there are no findings, say "보안 문제를 찾지 못했어요" with the scope and stop.
4. Then call `ask_user` once with `multiSelect: true`: one option per finding (short label like `1. [상] file:line 요약`) plus a last option `고치지 않음`. Fix only the findings the user picks, keep changes minimal, run the relevant tests if any exist, and report what changed. If the user picks `고치지 않음` or nothing, do not change anything. Do not commit.
