#!/bin/sh
# pi 를 Antenna 앱에 잇기: 확장을 ~/.pi/agent/extensions/ 에 둔다. 돌고 있는 pi 는 /reload 하거나 다시 켜야 적용된다.
#   sh pi-extension/install.sh                     폰 화면에 필요한 것(아래 '기본')
#   sh pi-extension/install.sh --with web,subagent 기본 + 고른 선택 확장
#   sh pi-extension/install.sh --all               기본 + 선택 확장 전부
#   sh pi-extension/install.sh --list              무엇이 있는지만 보여 줌
# 기본: 대화 피드(pi-remote-feed) · 보내기·위험 동작 승인(send-guard) · 고르는 질문(ask-user) · 할 일 목록(todos) ·
#       계획 모드(plan-mode) · 아티팩트(artifacts) · 백그라운드 탭(bgtab)
# 선택: compact-tools(맥 화면에서 도구 실행을 한 줄로) · web(웹 검색·가져오기 도구) · subagent(하위 에이전트와 역할·명령 틀) ·
#       claude-accounts(Claude 구독 계정 둘을 폴더별로 나눠 씀. 회사 폴더는 ~/.config/pi-remote/work-dirs)
# 같은 내용이면 건드리지 않는다. 내용이 다른 파일은 ~/.cache/pi-remote/backup/<시각>/ 에 남기고 덮어쓴다.
# 작성: 서문교
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HOME/.pi/agent"
EXT="$AGENT/extensions"
BASE="pi-remote-feed.ts send-guard.ts ask-user.ts todos.ts plan-mode.ts artifacts.ts bgtab.ts sudo-tab.sh lib/choice-box.ts lib/readonly.ts lib/sudo-rules.mjs lib/lang.mjs"
OPTIONAL="compact-tools web subagent claude-accounts"

WITH=""
case "${1:-}" in
  "") ;;
  --list)
    echo "기본: $BASE"
    echo "선택: $OPTIONAL"
    exit 0
    ;;
  --all) WITH="$OPTIONAL" ;;
  --with)
    [ -n "${2:-}" ] || { echo "--with 뒤에 선택 확장 이름을 쉼표로 적어 주세요($OPTIONAL)" >&2; exit 1; }
    WITH=$(echo "$2" | tr ',' ' ')
    ;;
  *) echo "모르는 옵션: $1" >&2; exit 1 ;;
esac
for w in $WITH; do
  case " $OPTIONAL " in *" $w "*) ;; *) echo "그런 선택 확장이 없어요: $w (있는 것: $OPTIONAL)" >&2; exit 1 ;; esac
done

BK="$HOME/.cache/pi-remote/backup/$(date +%Y%m%d-%H%M%S)"
NEW=0
SAME=0
# put <저장소 안 원본> <설치할 곳>
put() {
  if [ -f "$2" ] && cmp -s "$1" "$2"; then
    SAME=$((SAME + 1))
    return 0
  fi
  if [ -f "$2" ]; then
    mkdir -p "$BK$(dirname "$2")"
    /bin/cp -p "$2" "$BK$2"
  fi
  mkdir -p "$(dirname "$2")"
  /bin/cp -f "$1" "$2"
  NEW=$((NEW + 1))
  echo "설치: $2"
}

for f in $BASE; do put "$HERE/$f" "$EXT/$f"; done
chmod +x "$EXT/sudo-tab.sh"
# 백그라운드 탭을 여는 실행기(Claude Code 연결부와 같은 파일). Claude Code 쪽 설치본이 없는 맥에서 bgtab 이 이것을 씀
put "$HERE/../claude-remote/bg-launch.mjs" "$EXT/lib/bg-launch.mjs"
for w in $WITH; do
  case "$w" in
    subagent)
      for f in index.ts agents.ts; do put "$HERE/subagent/$f" "$EXT/subagent/$f"; done
      for f in "$HERE"/subagent/agents/*.md; do put "$f" "$AGENT/agents/$(basename "$f")"; done
      for f in "$HERE"/prompts/*.md; do put "$f" "$AGENT/prompts/$(basename "$f")"; done
      ;;
    *) put "$HERE/$w.ts" "$EXT/$w.ts" ;;
  esac
done

[ -d "$BK" ] && echo "덮어쓴 원래 파일: $BK"
if [ "$NEW" -gt 0 ]; then
  echo "pi 확장 ${NEW}개를 설치했어요(그대로 둔 것 ${SAME}개). 돌고 있는 pi 는 /reload 하거나 다시 켜면 적용돼요."
else
  echo "pi 확장이 이미 모두 같은 내용이에요(${SAME}개)."
fi
