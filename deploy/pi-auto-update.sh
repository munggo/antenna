#!/bin/sh
# 매일 새벽 pi 업데이트(pi 본체 + 확장 패키지). launchd(com.munggo.pi-auto-update)가 실행한다.
# 업데이트 뒤 적용은 pi-remote 확장이 맡는다: pi 가 10분 이상 쉬고 맥 입력창이 비어 있을 때 같은 대화로 다시 켬.
STATE_DIR="$HOME/.cache/pi-remote"
LOG="$STATE_DIR/pi-update.log"
STATE="$STATE_DIR/pi-update.json"
mkdir -p "$STATE_DIR"

# pi 가 설치된 node(nvm) 찾기: pi 가 들어 있는 가장 최근 node 버전
PI_BIN=""
for d in $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V -r); do
  if [ -x "$d/pi" ]; then PI_BIN="$d"; break; fi
done
[ -z "$PI_BIN" ] && { echo "$(date '+%F %T') pi 를 찾지 못함" >> "$LOG"; exit 0; }
export PATH="$PI_BIN:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"

ver() { pi --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }
OLD=$(ver)
echo "=== $(date '+%F %T') 업데이트 시작 (지금 $OLD)" >> "$LOG"
pi update --all >> "$LOG" 2>&1
RC=$?
NEW=$(ver)
echo "=== $(date '+%F %T') 끝 (종료코드 $RC, $OLD → $NEW)" >> "$LOG"
printf '{"checkedAt":"%s","from":"%s","to":"%s","exitCode":%s}\n' "$(date -u +%FT%TZ)" "$OLD" "$NEW" "$RC" > "$STATE"
# anthropics/skills 최신으로(pi 설정 skills 가 이 폴더를 읽음)
SK="$HOME/.pi/agent/vendor/anthropics-skills"
[ -d "$SK/.git" ] && { git -C "$SK" pull -q --ff-only >> "$LOG" 2>&1 || echo "$(date '+%F %T') 스킬 저장소 업데이트 실패" >> "$LOG"; }
# 업데이트 뒤에 돌릴 내 스크립트가 있으면 돌린다(예: 설정 백업): ~/.config/pi-remote/after-update.sh
AFTER="$HOME/.config/pi-remote/after-update.sh"
if [ -f "$AFTER" ]; then
  sh "$AFTER" >> "$LOG" 2>&1 || echo "$(date '+%F %T') 업데이트 뒤 스크립트(after-update.sh) 실패" >> "$LOG"
fi
# 로그가 너무 커지지 않게 최근 400줄만
tail -n 400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
