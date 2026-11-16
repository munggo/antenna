#!/bin/sh
# 로그인하면 iTerm2 를 열고 tmux 세션(antenna)에 붙는다(사용자 결정 11-12)
# - 브리지가 세션을 만들거나 되살릴 때까지 최대 3분 기다림
# - 이미 맥 터미널에서 붙어 있으면(폰이 붙인 화면 말고) 아무것도 안 함
# - iTerm2 창에서 antenna-attach-term.sh 를 바로 실행해 붙음(떼면 평소 셸로). 창에 글자를 쳐 넣으면
#   oh-my-zsh 업데이트 질문에 먹혀 붙지 못한 적이 있어 바꿈
# 쓰기: sh antenna-attach.sh [세션] [--exit-after(시험: 떼면 셸도 닫아 창이 닫힘)]   작성: 서문교
S="${1:-${PI_TMUX_SESSION:-antenna}}"
AFTER=""; [ "${2:-}" = "--exit-after" ] && AFTER=" --exit-after"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMUX_BIN=/opt/homebrew/bin/tmux; [ -x "$TMUX_BIN" ] || TMUX_BIN=/usr/local/bin/tmux
i=0
while [ $i -lt 180 ] && ! "$TMUX_BIN" has-session -t "=$S" 2>/dev/null; do sleep 1; i=$((i + 1)); done
"$TMUX_BIN" has-session -t "=$S" 2>/dev/null || { echo "$(date '+%F %T') 세션 '$S' 이 없어 그만둠"; exit 0; }
# 맥 화면이 이미 붙어 있으면 그만(브리지가 붙인 폰 화면은 ignore-size 표시가 있음)
if "$TMUX_BIN" list-clients -t "=$S" -F '#{client_flags}' 2>/dev/null | grep -qv 'ignore-size'; then
  echo "$(date '+%F %T') 이미 맥에서 붙어 있음"; exit 0
fi
/usr/bin/osascript <<OSA
tell application "iTerm2"
  activate
  create window with default profile command "/bin/sh $HERE/antenna-attach-term.sh $S$AFTER"
end tell
OSA
echo "$(date '+%F %T') iTerm2 를 열고 '$S' 에 붙음(끝 코드 $?)"
