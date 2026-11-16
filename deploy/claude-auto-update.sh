#!/bin/sh
# 매일 새벽 Claude Code 업데이트. launchd(com.munggo.claude-auto-update)가 05:00에 실행한다(pi 와 같은 시각).
# 업데이트 뒤 claude-reload.py 가 옛 버전으로 도는 세션 중 10분 넘게 쉬고 입력창이 비고 뒤에서 도는 작업이 없는 것만
# 같은 대화로 다시 켠다. 기다릴 세션이 있으면 오전 9시까지 10분마다 다시 본다.
# (낮에 Claude Code 가 스스로 받은 업데이트는 com.munggo.claude-reload 가 30분마다 같은 스크립트로 처리)
# 시험할 때: CLAUDE_RELOAD_ARGS=--dry-run sh deploy/claude-auto-update.sh
DIR="$HOME/.cache/claude-auto-update"
LOG="$DIR/update.log"
STATE="$DIR/update.json"
mkdir -p "$DIR"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ver() { claude --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }
OLD=$(ver)
echo "=== $(date '+%F %T') 업데이트 시작 (지금 $OLD)" >> "$LOG"
claude update </dev/null >> "$LOG" 2>&1
RC=$?
NEW=$(ver)
echo "=== $(date '+%F %T') 끝 (종료코드 $RC, $OLD → $NEW)" >> "$LOG"
printf '{"checkedAt":"%s","from":"%s","to":"%s","exitCode":%s}\n' "$(date -u +%FT%TZ)" "$OLD" "$NEW" "$RC" > "$STATE"
# shellcheck disable=SC2086  # 시험용 인자는 나눠서 넘김
/usr/bin/python3 "$(dirname "$0")/claude-reload.py" $CLAUDE_RELOAD_ARGS >> "$LOG" 2>&1
# 기록이 너무 커지지 않게 최근 400줄만
tail -n 400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
