#!/bin/bash
# pi 가 맡긴 관리자 권한(sudo) 명령을 사용자가 확인하고 실행하는 tmux 탭(send-guard 가 연다).
# 인자: 작업 폴더(cmd: 명령, cwd: 실행 폴더, explain: 무엇을 하는지 설명). 결과: out(출력), code(종료 코드) 또는 cancelled
# 화면에는 코드 대신 설명만(사용자 결정). v 를 누르면 명령을 보여 준다
D="$1"
cd "$(cat "$D/cwd" 2>/dev/null)" 2>/dev/null || cd ~
# 지금 단계를 창 옵션(@sudo_stage)에 적는다: confirm(실행할지 확인) → running(실행 중, 비밀번호를 물을 수 있음) → done.
# 브리지가 탭 목록에 실어 보내면 폰 앱이 단계에 맞는 화면을 보여 준다(확인 단계엔 버튼, 실행 중엔 가려진 비밀번호 칸)
TMUX_BIN=/opt/homebrew/bin/tmux; [ -x "$TMUX_BIN" ] || TMUX_BIN=/usr/local/bin/tmux; [ -x "$TMUX_BIN" ] || TMUX_BIN=tmux
stage() { [ -n "${TMUX_PANE:-}" ] && "$TMUX_BIN" set-option -w -t "$TMUX_PANE" @sudo_stage "$1" 2>/dev/null; return 0; }
cancel() { stty echo 2>/dev/null; stage done; : > "$D/cancelled"; printf '\n  취소했어요. 탭을 닫아요.\n'; sleep 1; exit 0; }
trap cancel INT

stage confirm
printf '\n  \033[1;33m🔐 관리자 권한(sudo)이 필요해요\033[0m\n\n'
sed 's/^/  /' "$D/explain" 2>/dev/null
while :; do
  printf '\n  \033[1mEnter\033[0m 실행   \033[1mv\033[0m 명령 보기   \033[1mq\033[0m 취소\n'
  printf '  비밀번호는 실행을 시작한 뒤에 물어요(Touch ID도 돼요). 여기서 누른 글자는 화면에 보이지 않아요.\n'
  # 누른 글자를 화면에 찍지 않는다: 여기에 비밀번호를 미리 쳐도 화면(맥·폰·tmux 기록)에 드러나지 않게
  IFS= read -rs ans
  case "$ans" in
    q|Q) cancel ;;
    v|V) printf '\n'; sed 's/^/    /' "$D/cmd" ;;
    *) break ;;
  esac
done
unset ans
# 미리 눌러 둔 글자가 뒤따르는 비밀번호 칸으로 흘러 들어가지 않게 비운다
/usr/bin/perl -MPOSIX -e 'tcflush(0, TCIFLUSH)' 2>/dev/null

stage running
printf '\n  실행 중이에요(멈추려면 Ctrl+C).\n\n'
# 실행하는 동안에도 누른 글자를 화면에 찍지 않는다: 비밀번호를 묻기 전이나 물은 뒤에 쳐도 드러나지 않게(sudo 는 원래 가려서 받음)
stty -echo 2>/dev/null
# 명령은 터미널 입력을 받지 않는다(AI 가 명령을 실행할 때와 같은 조건): 입력을 기다리며 멈춰 탭이 닫히지 않는 일을 막는다.
# sudo 의 비밀번호·Touch ID 는 터미널을 직접 열어 받으므로 그대로 된다
bash -c "$(cat "$D/cmd")" < /dev/null 2>&1 | tee "$D/out"
code=${PIPESTATUS[0]}
stty echo 2>/dev/null
stage done
echo "$code" > "$D/code.tmp" && mv "$D/code.tmp" "$D/code"
printf '\n  끝났어요(종료 코드 %s). 3초 뒤 이 탭을 닫아요.\n' "$code"
sleep 3
