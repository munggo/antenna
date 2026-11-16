#!/bin/sh
# iTerm2 창 안에서 바로 실행: tmux 세션에 붙고, 떼면 평소 셸로
# (창에 글자를 쳐 넣지 않음 → oh-my-zsh 업데이트 질문 같은 셸 시작 과정에 막히지 않음)
# 쓰기: sh antenna-attach-term.sh [세션] [--exit-after(시험: 떼면 창 닫힘)]   작성: 서문교
S="${1:-antenna}"
TMUX_BIN=/opt/homebrew/bin/tmux; [ -x "$TMUX_BIN" ] || TMUX_BIN=/usr/local/bin/tmux
"$TMUX_BIN" -u attach -t "$S"
[ "${2:-}" = "--exit-after" ] && exit 0
exec "${SHELL:-/bin/zsh}" -l
