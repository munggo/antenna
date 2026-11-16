#!/bin/sh
# 시험 tmux 세션(기본 pitest) 칸의 Claude Code 피드만 끄고 그 소켓을 지운다.
# 지금 쓰는 다른 창(antenna 세션 등)의 피드는 건드리지 않는다. 쓰기: sh stop-test-feeds.sh [세션]
# 작성: 서문교
S="${1:-pitest}"
for p in $(tmux list-panes -s -t "=$S" -F '#{pane_id}' 2>/dev/null); do
  # 그 칸에 Claude Code 피드가 돌고 있었을 때만 소켓을 지움(pi 칸의 소켓은 pi 확장 것이라, 지우면 그 탭 채팅이 끊김)
  pkill -f "claude-feed\.mjs ${p}\$" 2>/dev/null && rm -f "$HOME/.cache/pi-remote/feed/$(printf '%s' "$p" | tr -d '%').sock"
done
exit 0
