#!/bin/bash
# 폰에서 로그인 비밀번호를 받아 맥 클립보드에 잠깐 넣는 tmux 탭(password-run.mjs 가 연다).
# 인자: 작업 폴더(label: 무엇의 비밀번호인지). 결과: done(받아서 클립보드에 넣음) · cancelled(취소) · error(넣지 못함, 까닭)
# 받은 값은 화면·파일·명령 줄 인자에 남기지 않는다: 가려 받아(read -s) 셸 안의 printf 로 클립보드 도우미의 표준 입력에 바로 넘긴다
# 작성: 서문교
D="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
# 단계를 창 옵션(@sudo_stage)에 적는다(관리자 권한 탭과 같은 칸): running 이면 폰 앱이 가려진 비밀번호 칸을 보여 준다
TMUX_BIN=/opt/homebrew/bin/tmux; [ -x "$TMUX_BIN" ] || TMUX_BIN=/usr/local/bin/tmux; [ -x "$TMUX_BIN" ] || TMUX_BIN=tmux
stage() { [ -n "${TMUX_PANE:-}" ] && "$TMUX_BIN" set-option -w -t "$TMUX_PANE" @sudo_stage "$1" 2>/dev/null; return 0; }
cancel() { stty echo 2>/dev/null; stage done; : > "$D/cancelled"; printf '\n  취소했어요. 탭을 닫아요.\n'; sleep 1; exit 0; }
trap cancel INT

stage running
printf '\n  \033[1;33m🔑 로그인 비밀번호가 필요해요\033[0m\n\n'
sed 's/^/  /' "$D/label" 2>/dev/null
printf "\n  폰 앱의 가려진 칸을 누르고 키보드 위 '암호'에서 골라 보내 주세요.\n"
printf '  여기서 친 글자는 화면에 보이지 않아요. 멈추려면 Ctrl+C.\n'
while :; do
  IFS= read -rs pw
  [ -n "$pw" ] && break
done
r=$(printf '%s' "$pw" | /usr/bin/osascript -l JavaScript "$HERE/secret-clip.js" set 2>&1)
unset pw
stage done
if [ "$r" = set ]; then
  : > "$D/done"
  printf '\n  받았어요. 로그인 칸에 붙여 넣고 곧 지워요. 탭을 닫아요.\n'
else
  printf '%s' "$r" > "$D/error"
  printf '\n  클립보드에 넣지 못했어요. 탭을 닫아요.\n'
fi
sleep 1
