---
description: 코드 리뷰(커밋 안 한 변경, 없으면 지금 브랜치 vs main, PR 번호를 주면 그 PR) → 고칠 것 고르기
argument-hint: "[PR 번호] [중점]"
---
Run a code review. Arguments (may be empty): `$ARGUMENTS`

1. Decide the scope yourself with quick read-only git commands, in this order:
   - If the first argument is a PR number (`123` or `#123`): that GitHub PR (`gh pr view <n>`, `gh pr diff <n>`). Any other arguments are the review focus.
   - Else, if `git status --porcelain` shows changes: the uncommitted changes (staged, unstaged, and new untracked files).
   - Else: the current branch against the default branch (`origin/HEAD`, or `main`/`master`), i.e. `git diff <base>...HEAD`.
   - If there is nothing to review, say so in one sentence and stop.
   - If this is not a git repository, say so in one sentence and stop.
2. Delegate the review to the `subagent` tool with agent `reviewer` (one call). In the task, give the exact repository path, the scope, and the exact commands that show the changes (for untracked files: list them and tell it to read them). Tell the reviewer:
   - Review only what this change adds or modifies; read surrounding code when needed to judge it.
   - Report real problems only: bugs and wrong behavior, broken edge cases, missing error handling that matters, security issues, data loss, race conditions, clear performance traps, and missing or wrong tests for changed behavior. No style or formatting nitpicks, no speculative suggestions.
   - For each finding: severity (high / medium / low), `file:line`, what is wrong and why (with the concrete failing case), and a concrete fix. Only include findings it is at least 80% confident about.
   - Extra focus from the user, if any: the non-PR arguments above.
3. Report to the user in Korean: one line on the scope, then the findings as a numbered list sorted by severity (`[상] file:line — 문제 → 고칠 방법`). If there are no findings, say so and stop.
4. Then call `ask_user` once with `multiSelect: true`: one option per finding (short label like `1. [상] file:line 요약`) plus a last option `고치지 않음`. Fix only the findings the user picks, keep changes minimal, run the relevant tests if any exist, and report what changed. If the user picks `고치지 않음` or nothing, do not change anything. Do not commit.
