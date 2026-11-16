#!/bin/sh
# 앱 화면 시험(시뮬레이터): 모델이 필요 없는 것들을 환경 준비부터 정리까지 한 번에 돌린다(빌드 포함 7~8분).
#   LL 첫 화면에서 QR 링크로 연결 · PP 맥 주소와 확인 창 · QQ 관리자 권한 창(버튼 카드·가려진 입력란) ·
#   RR 한 번 쓰는 코드로 짝짓고 암호화 연결로 붙기 · SS 서랍의 백그라운드 칸(끝난 것 모두 닫기, 뒤에서 도는 작업 목록·종료) ·
#   TT 사진 보관함에서 두 장 고르기(입력창 칸·그림·맥에 올리기, 걸린 시간은 기록에 '[TT]') · B 붙인 사진을 x 로 빼기 ·
#   UU 맥북 배터리('연결됨' 옆 잔량, 충전기·낮음, 배터리 없는 맥) ·
#   VV Claude Code 탭의 대화 글(도구 앞의 진행 설명이 보이는지, 물결표 범위가 취소선이 되지 않는지, 답변 복사에는 답만)
# 쓰기: sh test/app.sh [시험 이름 일부…]   예) sh test/app.sh QQ     (sh test.sh --app 으로도 부름)
# 하는 일: 시험용 tmux 세션과 시험 브리지(이 맥 안에서만 닿는 127.0.0.1)를 띄우고, 시뮬레이터를 켜서 시험한 뒤 모두 치운다.
#          쓰는 tmux 세션(antenna)·쓰는 브리지·켜져 있는 다른 시뮬레이터는 건드리지 않는다.
# 시뮬레이터: ANTENNA_SIM=<기기 번호> 로 정하거나, 꺼져 있는 iPhone 가운데 하나를 고른다
# 작성: 서문교
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S=antennaapp                 # 시험 세션(창 0 은 셸)
B=antennaapp-bridge          # 시험 브리지를 띄우는 세션
PORT="${ANTENNA_TEST_PORT:-8799}"
W=/tmp/ptest                 # 화면 시험이 읽는 준비 파일 자리(ios/PiRemoteUITests 에 적혀 있음)
D=/tmp/antenna-app-test      # 이 스크립트의 임시 폴더
ID=com.munggo.piremote

# node 22 이상(브리지 모듈이 그 판으로 깔려 있음)
NODE="${NODE:-}"
if [ -z "$NODE" ]; then
  for n in "$(command -v node 2>/dev/null)" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r); do
    [ -n "$n" ] && "$n" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null && { NODE=$n; break; }
  done
fi
[ -n "$NODE" ] || { echo "node 22 이상을 찾지 못했어요" >&2; exit 2; }
command -v tmux >/dev/null && command -v xcodebuild >/dev/null && command -v xcodegen >/dev/null || { echo "tmux·Xcode·xcodegen 이 필요해요" >&2; exit 2; }
nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 && { echo "포트 $PORT 를 이미 쓰고 있어요(ANTENNA_TEST_PORT 로 바꿀 수 있음)" >&2; exit 2; }

SIM="${ANTENNA_SIM:-$(xcrun simctl list devices available | grep -E '^ +iPhone .*\(Shutdown\)' | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}' | head -1)}"
[ -n "$SIM" ] || { echo "쓸 시뮬레이터가 없어요(꺼져 있는 iPhone 시뮬레이터가 필요. ANTENNA_SIM 으로 정할 수 있음)" >&2; exit 2; }
WAS_BOOTED=$(xcrun simctl list devices | grep "$SIM" | grep -c Booted)

cleanup() {
  for w in $(tmux list-windows -t "=$S" -F '#{window_index} #{window_name}' 2>/dev/null | grep '🔐' | cut -d' ' -f1); do tmux kill-window -t "$S:$w" 2>/dev/null; done
  sh "$REPO/claude-remote/test/stop-test-feeds.sh" "$S"   # SS 의 가짜 Claude Code 칸에 붙인 연결부
  [ -f "$D/fake/shell.pid" ] && kill -9 -"$(cat "$D/fake/shell.pid")" 2>/dev/null   # 그 가짜가 뒤에서 돌린 셸(시험이 못 껐을 때)
  tmux kill-session -t "=$B" 2>/dev/null
  tmux kill-session -t "=$S" 2>/dev/null
  xcrun simctl terminate "$SIM" "$ID" >/dev/null 2>&1
  xcrun simctl uninstall "$SIM" "$ID" >/dev/null 2>&1   # 시험이 깐 앱은 남기지 않는다
  [ "$WAS_BOOTED" = 0 ] && xcrun simctl shutdown "$SIM" 2>/dev/null
  rm -rf "$D" "$W/secret-win" "$W/secret-win2" "$W/secret-cancel-flag" "$W/secret-got" "$W/pair-hosts-ok" "$W/pair-code-link" "$W/bg-wins" "$W/battery"
  rm -f "$HOME/.cache/pi-remote/notify-$S.sock"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "준비: 시험 세션·시험 브리지(127.0.0.1:$PORT)·시뮬레이터($SIM)"
cleanup
mkdir -p "$D/sessions" "$D/usage" "$W"
TOKEN=$(openssl rand -hex 32)
tmux new-session -d -s "$S" -x 120 -y 40 -c /tmp || exit 1
# 깜빡이지 않는 커서: 터미널 커서의 깜빡임(끝없는 애니메이션) 때문에 화면 시험이 동작마다 1분씩 기다리는 것을 막음
tmux set-option -w -t "$S:0" cursor-style block
touch "$D/locked"
# 시험 브리지: 기록·알림·사용량이 쓰는 것과 섞이지 않게 모두 임시 폴더로, 알림은 보내지 않고 기록만
# 설정 폴더도 임시로(PI_REMOTE_ENV): 짝지은 기기·인증서가 쓰는 설정(~/.config/pi-remote)과 섞이지 않게
mkdir -p "$D/conf"
: > "$D/conf/env"
# UU: 맥북 배터리는 이 파일의 글을 pmset 출력으로 읽게 한다(1초마다). 화면 시험이 글을 바꿔 가며 '연결됨' 옆 표시를 본다
printf "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234567)\t94%%; discharging; 1:00 remaining present: true\n" > "$W/battery"
tmux new-session -d -s "$B" -c "$REPO/server" "env PI_REMOTE_ENV=$D/conf/env PI_REMOTE_TOKEN=$TOKEN HOST=127.0.0.1 PORT=$PORT PI_TMUX_SESSION=$S PI_REMOTE_SESSION_DIR=$D/sessions PI_REMOTE_PUSH_FILE=$D/push.json PI_REMOTE_PUSH_DRYRUN=1 PI_REMOTE_FAKE_LOCKED_FILE=$D/locked PI_REMOTE_FAKE_BATTERY_FILE=$W/battery PI_REMOTE_BATTERY_SEC=1 PI_REMOTE_TABS_FILE=$D/tabs.json PI_REMOTE_USAGE_DIR=$D/usage PI_REMOTE_CRASH_LOG=$D/crash.log $NODE bridge.mjs > $D/bridge.log 2>&1"
i=0
while [ $i -lt 40 ] && ! nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; do sleep 0.5; i=$((i + 1)); done
nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 || { echo "시험 브리지가 뜨지 않았어요:"; tail -5 "$D/bridge.log"; exit 1; }

# 관리자 권한 창 두 개(QQ: 하나는 실행 흐름, 하나는 취소). 진짜 sudo·진짜 비밀번호는 쓰지 않는다:
# 창의 명령은 'Password:' 를 찍고 터미널에서 가려 받은 글을 파일에 적는다
for n in 1 2; do
  J="$D/sudo$n"
  mkdir -p "$J"
  printf '%s\n' "printf 'Password:'; IFS= read -rs p < /dev/tty; echo; printf '%s' \"\$p\" > $W/secret-got; echo \"받은 글자 수 \${#p}\"; sleep 2" > "$J/cmd"
  echo /tmp > "$J/cwd"
  echo "시험 $n: 가려진 입력란으로 넣은 글이 이 창에 그대로 오는지 확인해요" > "$J/explain"
  N=$(tmux new-window -d -P -F '#{window_index}' -t "$S:" -n '🔐sudo' "bash $REPO/pi-extension/sudo-tab.sh $J")
  tmux set-option -w -t "$S:$N" cursor-style block
  if [ $n = 1 ]; then echo "$N" > "$W/secret-win"; else echo "$N" > "$W/secret-win2"; echo "$J/cancelled" > "$W/secret-cancel-flag"; fi
done
# SS: 서랍의 백그라운드 칸. 시킨 탭 하나와 백그라운드 탭 셋(일하는 중·끝남·끝났지만 뒤에서 셸이 돎), 뒤에서 셸이 도는 보통 탭.
#     연결부·실행기가 적는 탭 옵션을 직접 적고, 창 번호를 '일하는중 끝남 끝났지만셸 보통탭' 순서로 /tmp/ptest/bg-wins 에 적는다
NOW=$(date +%s)
bgwin() {   # 이름 [옵션 값]… → 창 번호
  n=$(tmux new-window -d -P -F '#{window_index}' -t "$S:" -n "$1" -c /tmp)
  shift
  tmux set-option -w -t "$S:$n" cursor-style block
  while [ $# -ge 2 ]; do tmux set-option -w -t "$S:$n" "$1" "$2"; shift 2; done
  echo "$n"
}
O=$(tmux display -p -t "$S:$(bgwin '시킨탭')" '#{pane_id}')
BG1=$(bgwin 'bg 테스트 고치기' @bg_by user @bg_from "$O" @bg_started $((NOW - 720)) @pi_status working @ai_model 'Opus 5.5' @ai_thinking high)
BG2=$(bgwin 'bg 문서 정리하기' @bg_by ai @bg_from "$O" @bg_started $((NOW - 7200)) @bg_done $((NOW - 3600)))
BG3=$(bgwin 'bg 서버 띄우기' @bg_by phone @bg_from "$O" @bg_started $((NOW - 600)) @bg_done $((NOW - 120)) @ai_jobs '셸 1개')
BGJ=$(bgwin '셸도는탭' @ai_jobs '셸 1개 · 에이전트 2개' @ai_thinking high)
echo "$BG1 $BG2 $BG3 $BGJ" > "$W/bg-wins"
# 셸도는탭에는 가짜 Claude Code(이름이 버전 번호 꼴인 node)와 연결부를 붙인다. 가짜는 진짜처럼 셸 하나를 뒤에서 돌리고,
# 대화 기록에는 그 셸('긴 시험 돌리기')과 에이전트('엔진 조사')를 적는다 → 앱에서 '백그라운드 작업 3 ›'을 눌러 목록·종료를 시험
FK="$D/fake"
mkdir -p "$FK/bin"
ln -f "$NODE" "$FK/bin/9.9.9" 2>/dev/null || ln -sf "$NODE" "$FK/bin/9.9.9"
echo 'echo 진행 1; echo 진행 2; sleep 900; :' > "$FK/cmd"
BGJ_PANE=$(tmux display -p -t "$S:$BGJ" '#{pane_id}')
tmux send-keys -t "$BGJ_PANE" -l "exec $FK/bin/9.9.9 $REPO/claude-remote/test/fake-claude.mjs $FK"
tmux send-keys -t "$BGJ_PANE" Enter
"$NODE" "$REPO/claude-remote/claude-feed.mjs" "$BGJ_PANE" >/dev/null 2>&1 &
"$NODE" "$REPO/claude-remote/test/fake-claude.mjs" --feed "$FK" "$BGJ_PANE" || echo "주의: 가짜 Claude Code 칸에 연결부가 뜨지 않았어요" >&2
touch "$W/pair-hosts-ok"   # PP: 시험 브리지가 127.0.0.1 에만 열려 있다는 표시
# RR: 짝짓기 링크(한 번 쓰는 코드 + 시험 브리지 인증서의 지문). 맥의 짝짓기 명령이 QR 에 담는 것과 같은 모양
CODE=$(PI_REMOTE_ENV="$D/conf/env" "$NODE" "$REPO/deploy/devices-cli.mjs" start)
FP=$(PI_REMOTE_ENV="$D/conf/env" "$NODE" "$REPO/deploy/devices-cli.mjs" fingerprint)
# 빌드와 앞선 시험에 5분 넘게 걸릴 수 있어, 시험에서는 코드의 기한만 한 시간으로 늘린다(기한이 지나면 못 쓰는 것은 server/test/devices.test.mjs 가 봄)
"$NODE" -e 'const fs = require("fs"); const f = process.argv[1]; const p = JSON.parse(fs.readFileSync(f, "utf8")); p.expiresAt = Date.now() + 3600e3; fs.writeFileSync(f, JSON.stringify(p), { mode: 0o600 });' "$D/conf/pairing.json"
printf 'piremote://pair?code=%s&port=%s&fp=%s&host=127.0.0.1' "$CODE" "$PORT" "$FP" > "$W/pair-code-link"

[ "$WAS_BOOTED" = 0 ] && xcrun simctl boot "$SIM" 2>/dev/null
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1
xcrun simctl keychain "$SIM" reset

ONLY=""
for t in testLL_TokenScreenQR testPP_PairLinkHosts testQQ_SecretInput testRR_PairCode testSS_BackgroundDrawer testTT_PhotoPicker testUU_MacBattery testVV_UpdatesAndTildes testB_RemoveAttachment; do
  if [ $# -eq 0 ]; then ONLY="$ONLY -only-testing:PiRemoteUITests/PiRemoteUITests/$t"; continue; fi
  for want in "$@"; do case "$t" in *"$want"*) ONLY="$ONLY -only-testing:PiRemoteUITests/PiRemoteUITests/$t" ;; esac; done
done
[ -n "$ONLY" ] || { echo "그런 이름의 시험이 없어요: $*" >&2; exit 2; }

echo "빌드하고 시험하는 중…(기록: /tmp/antenna-app-test.log)"
cd "$REPO/ios" || exit 1
xcodegen generate >/dev/null 2>&1
# shellcheck disable=SC2086  # 시험 이름들은 나눠서 넘김
TEST_RUNNER_PI_REMOTE_TOKEN=$TOKEN TEST_RUNNER_PI_REMOTE_PORT=$PORT xcodebuild test -project PiRemote.xcodeproj -scheme PiRemote \
  -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath /tmp/piremote-uitest $ONLY > /tmp/antenna-app-test.log 2>&1
RC=$?
grep -E "Test Case .*(passed|failed|skipped)" /tmp/antenna-app-test.log | sed -E "s/.*Test Case '-\[PiRemoteUITests\.PiRemoteUITests (test[A-Za-z0-9_]+)\]' (passed|failed|skipped) \(([0-9.]+) seconds\).*/\2 \1 (\3초)/; s/^passed/통과 /; s/^failed/실패 /; s/^skipped/건너뜀/"
grep -E "error: -\[" /tmp/antenna-app-test.log | sed -E 's/^.*\.swift:([0-9]+): error: -\[[^]]*\] : /      \1줄: /' | sort -u | head -8
# RR 이 돌았으면 맥 쪽도 확인: 기기 하나가 등록됐고, 그 기기가 암호화 연결로 붙었는지(브리지 기록)
case "$ONLY" in *testRR_PairCode*)
  if [ $RC -eq 0 ]; then
    N=$(PI_REMOTE_ENV="$D/conf/env" "$NODE" "$REPO/deploy/devices-cli.mjs" list | grep -c '^d[0-9a-f]\{8\} ')
    if [ "$N" = 1 ] && grep -q '접속: .*암호화, 기기 d' "$D/bridge.log"; then
      echo "통과  맥 쪽: 짝지은 기기 1대, 그 기기가 암호화 연결로 붙음"
    else
      echo "실패  맥 쪽: 짝지은 기기 ${N}대, 암호화 접속 기록 $(grep -c '접속: .*암호화, 기기 d' "$D/bridge.log")번"
      grep -E '짝짓기|접속:|인증 실패' "$D/bridge.log" | tail -6 | sed -E 's/^/        /'
      RC=1
    fi
  fi ;;
esac
# SS 가 돌았으면 맥 쪽도 확인: 끝나고 쉬는 백그라운드 탭(BG2)만 실제로 닫혔는지
case "$ONLY" in *testSS_BackgroundDrawer*)
  if [ $RC -eq 0 ]; then
    left=" $(tmux list-windows -t "=$S" -F '#{window_index}' | tr '\n' ' ')"
    gone=""
    for k in $BG1 $BG3 $BGJ; do case "$left" in *" $k "*) ;; *) gone="$gone $k" ;; esac; done
    case "$left" in
      *" $BG2 "*) echo "실패  맥 쪽: 끝난 백그라운드 탭($BG2)이 남아 있음"; RC=1 ;;
      *) if [ -n "$gone" ]; then echo "실패  맥 쪽: 닫으면 안 되는 탭이 닫힘:$gone"; RC=1
         else echo "통과  맥 쪽: 끝난 백그라운드 탭만 닫힘(일하는 탭·뒤에서 셸이 도는 탭은 남음)"; fi ;;
    esac
    # 작업 목록에서 '종료'를 눌렀으니: 가짜가 띄운 셸은 실제로 종료됐고, Claude 에게는 에이전트를 종료해 달라는 글이 갔는지
    if kill -0 "$(cat "$FK/shell.pid" 2>/dev/null || echo 0)" 2>/dev/null; then echo "실패  맥 쪽: 뒤에서 도는 셸이 아직 돎"; RC=1
    else echo "통과  맥 쪽: 앱에서 종료한 뒤에서 도는 셸이 실제로 종료됨"; fi
    if grep -q "TaskStop" "$FK/typed.txt" 2>/dev/null && grep -q "aagapp" "$FK/typed.txt"; then echo "통과  맥 쪽: 에이전트는 Claude 에게 TaskStop 으로 종료해 달라는 글이 감"
    else echo "실패  맥 쪽: 에이전트를 종료해 달라는 글이 가지 않음"; RC=1; fi
  fi ;;
esac
# VV 가 돌았으면 맥 쪽도 확인: '답변 복사'로 복사한 글에는 답의 글만 있고, 도구 앞의 진행 설명은 없는지(시뮬레이터의 복사한 글을 읽음)
case "$ONLY" in *testVV_UpdatesAndTildes*)
  if [ $RC -eq 0 ]; then
    COPIED=$(xcrun simctl pbpaste "$SIM" 2>/dev/null)
    if [ "$COPIED" = "권장량은 하루 5~15분씩, 2~3회입니다." ]; then echo "통과  맥 쪽: 답변 복사에는 답의 글만(도구 앞의 진행 설명은 빠짐)"
    else echo "실패  맥 쪽: 답변 복사한 글이 다름: $COPIED"; RC=1; fi
  fi ;;
esac
if [ $RC -eq 0 ]; then echo "앱 화면 시험 통과"; else echo "앱 화면 시험 실패(끝 코드 $RC). 기록: /tmp/antenna-app-test.log"; fi
exit $RC
