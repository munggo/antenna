#!/bin/sh
# 맥의 자동 실행(launchd) 등록: deploy/com.munggo.<이름>.plist 의 자리표시자(__ANTENNA_DIR__ 저장소 경로, __HOME__ 홈)를
# 이 맥의 값으로 채워 ~/Library/LaunchAgents/ 에 두고 등록한다. 사용자 권한으로 돈다(sudo 불필요).
# 이미 같은 내용으로 설치돼 있으면 건드리지 않는다(돌고 있는 브리지가 괜히 다시 뜨지 않게).
# 쓰기: sh deploy/install-agents.sh                          브리지만(꼭 필요한 것)
#       sh deploy/install-agents.sh pi-remote claude-reload  고른 것만
#       sh deploy/install-agents.sh --all                    선택 기능까지 전부
#       sh deploy/install-agents.sh --check [이름…]          설치하지 않고, 설치된 것과 같은지만 봄(다르면 끝 코드 1).
#                                                            이름을 안 주면 브리지와, 이미 설치해 둔 선택 기능을 봄
# 이름: pi-remote(브리지)
#   선택 기능 — antenna-attach(로그인하면 iTerm2 를 열어 tmux 세션에 붙음) · pi-auto-update(매일 새벽 pi 업데이트) ·
#       claude-auto-update(매일 새벽 Claude Code 업데이트) · claude-reload(옛 버전으로 쉬는 Claude Code 세션 다시 켜기)
# VPN 지킴이는 root 로 도는 것이라 따로: sudo sh deploy/install-vpn-guard.sh
# 작성: 서문교
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
DEST="$HOME/Library/LaunchAgents"
OPTIONAL="antenna-attach pi-auto-update claude-auto-update claude-reload"
CHECK=""
[ "${1:-}" = "--check" ] && { CHECK=1; shift; }
if [ "${1:-}" = "--all" ]; then
  # shellcheck disable=SC2086  # 이름 목록을 나눠서 넘김
  set -- pi-remote $OPTIONAL
elif [ $# -eq 0 ]; then
  set -- pi-remote
  # 점검만 할 때는 이미 설치해 둔 선택 기능도 함께 본다
  if [ -n "$CHECK" ]; then
    for name in $OPTIONAL; do
      if [ -f "$DEST/com.munggo.$name.plist" ]; then set -- "$@" "$name"; fi
    done
  fi
fi
# 경로를 sed 와 XML 에 그대로 넣으므로, 거기서 뜻이 달라지는 글자가 있으면 그만둔다
case "$REPO$HOME" in *[\|\&\\\<\>\"]*) echo "경로에 쓸 수 없는 글자(| & \\ < > \")가 있어요: $REPO" >&2; exit 1 ;; esac
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
norm() { plutil -convert xml1 -o - "$1" 2>/dev/null; }   # 주석·들여쓰기를 뺀 내용만(비교용)
RC=0
for name in "$@"; do
  label="com.munggo.$name"
  src="$HERE/$label.plist"
  out="$DEST/$label.plist"
  new="$TMP/$label.plist"
  [ -f "$src" ] || { echo "$name: 그런 등록 파일이 없어요($src)" >&2; RC=1; continue; }
  sed -e "s|__ANTENNA_DIR__|$REPO|g" -e "s|__HOME__|$HOME|g" "$src" > "$new"
  plutil -lint "$new" >/dev/null || { echo "$name: 만든 등록 파일이 올바르지 않아요" >&2; RC=1; continue; }
  if [ -f "$out" ] && [ "$(norm "$out")" = "$(norm "$new")" ]; then
    echo "$name: 이미 같은 내용으로 설치돼 있음(그대로 둠)"
    continue
  fi
  if [ -n "$CHECK" ]; then
    if [ -f "$out" ]; then echo "$name: 설치된 것과 달라요"; else echo "$name: 설치돼 있지 않아요"; fi
    RC=1
    continue
  fi
  mkdir -p "$DEST"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  /bin/cp -f "$new" "$out"
  # 내린 직후에는 잠깐 등록이 거절될 수 있어 몇 번 다시 해 본다
  i=0
  until launchctl bootstrap "gui/$(id -u)" "$out" 2>/dev/null; do
    i=$((i + 1))
    [ $i -lt 5 ] || { echo "$name: 등록하지 못했어요(launchctl bootstrap gui/$(id -u) $out)" >&2; RC=1; break; }
    sleep 1
  done
  [ $i -lt 5 ] && echo "$name: 설치·등록함"
done
exit $RC
