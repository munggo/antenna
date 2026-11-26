#!/bin/sh
# README 화면 사진 찍기(시뮬레이터): 예시 대화를 띄운 시험 세션에 앱을 붙여 화면 넷을 찍어 docs/images/ 에 둔다.
# 실제 대화·계정·사용량은 쓰지 않는다: 대화는 test/demo-feed.mjs 가 주는 예시, 사용량은 정해 둔 값, 터미널은 임시 폴더의 예시 저장소.
# 쓰기: sh test/readme-shots.sh            (빌드 포함 5분쯤, 한국어 화면 → docs/images/app-*.png)
#       ANTENNA_SHOTS_LANG=en sh test/readme-shots.sh   영어 화면·영어 예시 대화 → docs/images/app-*-en.png, 영어 화면 시험(한글이 남았는지)도 함께
# 하는 일: 시험 세션(antennademo)과 시험 브리지(127.0.0.1 에만 열림)를 띄우고, 시뮬레이터에서 찍은 뒤 모두 치운다.
#          쓰는 tmux 세션(antenna)·쓰는 브리지·켜져 있는 다른 시뮬레이터는 건드리지 않는다.
# 시뮬레이터: ANTENNA_SIM=<기기 번호> 로 정하거나, 꺼져 있는 'iPhone 17 Pro'(없으면 꺼져 있는 iPhone 아무거나)를 쓴다
# 작성: 서문교
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S=antennademo                # 예시 세션
B=antennademo-bridge         # 시험 브리지를 띄우는 세션
PORT="${ANTENNA_SHOTS_PORT:-8797}"
D=/tmp/antenna-readme-shots  # 이 스크립트의 임시 폴더
OUT="$REPO/docs/images"
ID=com.munggo.piremote
SL="${ANTENNA_SHOTS_LANG:-ko}"   # 화면·예시 대화·맥 쪽 글의 언어
case "$SL" in ko) SUF="" ;; en) SUF="-en" ;; *) echo "ANTENNA_SHOTS_LANG 은 ko 나 en 이에요" >&2; exit 2 ;; esac
nm() { if [ "$SL" = en ]; then echo "$2"; else echo "$1"; fi; }   # nm <한국어> <영어>

NODE="${NODE:-}"
if [ -z "$NODE" ]; then
  for n in "$(command -v node 2>/dev/null)" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r); do
    [ -n "$n" ] && "$n" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null && { NODE=$n; break; }
  done
fi
[ -n "$NODE" ] || { echo "node 22 이상을 찾지 못했어요" >&2; exit 2; }
command -v tmux >/dev/null && command -v xcodebuild >/dev/null && command -v xcodegen >/dev/null || { echo "tmux·Xcode·xcodegen 이 필요해요" >&2; exit 2; }
nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 && { echo "포트 $PORT 를 이미 쓰고 있어요(ANTENNA_SHOTS_PORT 로 바꿀 수 있음)" >&2; exit 2; }
tmux has-session -t "=$S" 2>/dev/null && { echo "예시 세션 $S 가 이미 있어요(다른 곳에서 찍는 중인지 확인)" >&2; exit 2; }

pick_sim() {
  xcrun simctl list devices available | grep -E '^ +iPhone 17 Pro \(' | grep Shutdown | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}' | head -1
}
SIM="${ANTENNA_SIM:-$(pick_sim)}"
[ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | grep -E '^ +iPhone .*\(Shutdown\)' | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}' | head -1)
[ -n "$SIM" ] || { echo "쓸 시뮬레이터가 없어요(꺼져 있는 iPhone 시뮬레이터가 필요. ANTENNA_SIM 으로 정할 수 있음)" >&2; exit 2; }
WAS_BOOTED=$(xcrun simctl list devices | grep "$SIM" | grep -c Booted)

cleanup() {
  for f in "$D"/feed*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done
  tmux kill-session -t "=$B" 2>/dev/null
  tmux kill-session -t "=$S" 2>/dev/null
  xcrun simctl terminate "$SIM" "$ID" >/dev/null 2>&1
  xcrun simctl uninstall "$SIM" "$ID" >/dev/null 2>&1
  xcrun simctl status_bar "$SIM" clear >/dev/null 2>&1
  [ "$WAS_BOOTED" = 0 ] && xcrun simctl shutdown "$SIM" 2>/dev/null
  rm -rf "$D"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "준비: 예시 세션·시험 브리지(127.0.0.1:$PORT)·시뮬레이터($SIM)"
rm -rf "$D"
mkdir -p "$D/conf" "$D/sessions" "$D/usage" "$D/shots"
: > "$D/conf/env"
TOKEN=$(openssl rand -hex 32)

# 터미널 화면용 예시 저장소(작성자 이름·메일은 예시 값, 훅·서명은 끔)
R="$D/weather"
mkdir -p "$R"
g() { git -C "$R" -c user.name=demo -c user.email=demo@example.com -c core.hooksPath=/dev/null -c commit.gpgsign=false "$@" >/dev/null; }
g init -b main
N=0
c() { N=$((N + 1)); echo "$1" > "$R/change$N.txt"; g add -A; g commit -m "$1"; }   # 커밋마다 다른 파일(병합이 충돌하지 않게)
c "feat: 7-day forecast"
c "feat: city search"
g checkout -b fix/keyboard
c "fix: keyboard covered login"
c "test: login keyboard"
g checkout main
c "feat: feels-like in widget"
g merge --no-ff fix/keyboard -m "Merge PR #42 fix/keyboard"
c "chore: bump deps"
cat > "$D/term.sh" <<EOF
while [ ! -f "$D/shots/terminal-go" ]; do sleep 0.2; done
clear
cd "$R"
printf '\033[32mweather\033[0m \$ git log --oneline --graph\n'
git --no-pager -c color.ui=always log --oneline --graph --decorate=short
printf '\n\033[32mweather\033[0m \$ git status -sb\n'
git --no-pager -c color.ui=always status -sb
exec env -i HOME="$D" TERM="\$TERM" PATH=/usr/bin:/bin BASH_SILENCE_DEPRECATION_WARNING=1 PS1='\[\033[32m\]weather\[\033[0m\] \$ ' /bin/bash --norc --noprofile
EOF

# 탭: 0 Claude Code(승인을 기다림) · 1 pi(질문을 기다림) · 2 셸 · 3·4 백그라운드 탭(일하는 중·끝남)
NOW=$(date +%s)
tmux new-session -d -s "$S" -x 60 -y 40 -n "$(nm '날씨 앱' 'Weather app')" -c "$R" || exit 1
tmux set-option -t "$S" status off   # 상태 줄에는 이 맥의 이름·시각이 있어 이 세션에서만 끔
win() {   # 이름 [옵션 값]… → 창 번호
  n=$(tmux new-window -d -P -F '#{window_index}' -t "$S:" -n "$1" -c "$R")
  shift
  while [ $# -ge 2 ]; do tmux set-option -w -t "$S:$n" "$1" "$2"; shift 2; done
  echo "$n"
}
tmux set-option -w -t "$S:0" @pi_status asking
tmux set-option -w -t "$S:0" @ai_model 'Opus 5.5'
tmux set-option -w -t "$S:0" @ai_thinking medium
P1=$(win "$(nm '날씨 API' 'Weather API')" @pi_status asking @ai_model 'Sonnet 5.5' @ai_thinking medium)
T=$(tmux new-window -d -P -F '#{window_index}' -t "$S:" -n "$(nm '셸' 'Shell')" -c "$R" "sh $D/term.sh")
win "$(nm 'bg 위젯 시험 고치기' 'bg fix widget tests')" @bg_by phone @bg_started $((NOW - 540)) @pi_status working @ai_model 'Sonnet 5.5' @ai_thinking high >/dev/null
win "$(nm 'bg 릴리스 노트 쓰기' 'bg write release notes')" @bg_by ai @bg_started $((NOW - 3000)) @bg_done $((NOW - 1200)) @pi_status yourturn @ai_model 'Haiku 5.5' >/dev/null
[ "$P1" = 1 ] && [ "$T" = 2 ] || { echo "탭 번호가 예상과 달라요(tmux 의 base-index 설정 확인): pi=$P1 셸=$T" >&2; exit 1; }
k=0
for scene in claude pi; do
  PANE=$(tmux display -p -t "$S:$k" '#{pane_id}')
  "$NODE" "$REPO/test/demo-feed.mjs" "$PANE" "$scene" "$SL" > "$D/feed$k.log" 2>&1 &
  echo $! > "$D/feed$k.pid"
  k=$((k + 1))
done

# 사용량은 Anthropic 에 묻지 않고 정해 둔 값(5시간 22%, 이번 주 38%), 맥북 배터리도 정해 둔 값
"$NODE" -e 'const fs = require("fs"); const now = Date.now(); const lim = (group, kind, percent, ms) => ({ kind, group, percent, severity: "normal", resets_at: new Date(now + ms).toISOString(), scope: null });
fs.writeFileSync(process.argv[1], JSON.stringify({ limits: [lim("session", "five_hour", 22, 2 * 3600e3), lim("weekly", "weekly_all", 38, 4 * 86400e3)] }));
fs.writeFileSync(process.argv[2], "{}");' "$D/usage.json" "$D/accounts.json"
printf "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234567)\t86%%; charging; 0:40 remaining present: true\n" > "$D/battery"
tmux new-session -d -s "$B" -c "$REPO/server" "env PI_REMOTE_ENV=$D/conf/env PI_REMOTE_TOKEN=$TOKEN HOST=127.0.0.1 PORT=$PORT PI_TMUX_SESSION=$S PI_REMOTE_SESSION_DIR=$D/sessions PI_REMOTE_PUSH_FILE=$D/push.json PI_REMOTE_PUSH_DRYRUN=1 PI_REMOTE_FAKE_BATTERY_FILE=$D/battery PI_REMOTE_TABS_FILE=$D/tabs.json PI_REMOTE_USAGE_DIR=$D/usage PI_REMOTE_FAKE_USAGE_FILE=$D/usage.json PI_ACCOUNTS_CACHE=$D/accounts.json PI_REMOTE_CRASH_LOG=$D/crash.log PI_REMOTE_NO_KEYCHAIN=1 PI_REMOTE_LANG=$SL PI_BG_CLAUDE_CMD=true PI_BG_PI_CMD=true PI_NEW_TAB_PREFIX='echo started:' $NODE bridge.mjs > $D/bridge.log 2>&1"
i=0
while [ $i -lt 40 ] && ! nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; do sleep 0.5; i=$((i + 1)); done
nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 || { echo "시험 브리지가 뜨지 않았어요:"; tail -5 "$D/bridge.log"; exit 1; }

[ "$WAS_BOOTED" = 0 ] && xcrun simctl boot "$SIM" 2>/dev/null
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1
xcrun simctl keychain "$SIM" reset
xcrun simctl ui "$SIM" appearance "${ANTENNA_SHOTS_LOOK:-light}"
xcrun simctl status_bar "$SIM" override --time 9:41 --dataNetwork wifi --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

echo "빌드하고 찍는 중…(기록: $D/build.log 는 끝나면 지워짐, 실패하면 아래에 끝부분)"
cd "$REPO/ios" || exit 1
xcodegen generate >/dev/null 2>&1
ONLY="-only-testing:PiRemoteUITests/PiRemoteUITests/testReadmeShots"
[ "$SL" = en ] && ONLY="$ONLY -only-testing:PiRemoteUITests/PiRemoteUITests/testEnglishUI"
# shellcheck disable=SC2086  # 시험 이름들은 나눠서 넘김
TEST_RUNNER_PI_REMOTE_TOKEN=$TOKEN TEST_RUNNER_PI_REMOTE_PORT=$PORT TEST_RUNNER_PI_REMOTE_SHOTS_DIR=$D/shots TEST_RUNNER_PI_REMOTE_UI_LANG=$SL xcodebuild test -project PiRemote.xcodeproj -scheme PiRemote \
  -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath /tmp/piremote-uitest $ONLY > "$D/build.log" 2>&1
RC=$?
grep -E "Test Case .*(passed|failed)" "$D/build.log" | sed -E "s/.*PiRemoteUITests (test[A-Za-z]+)\]' (passed|failed).*/\2 \1/; s/^passed/통과/; s/^failed/실패/"
if [ $RC -ne 0 ]; then
  echo "찍지 못했거나 시험이 실패했어요:"
  grep -E -A10 "error: -\[" "$D/build.log" | grep -v "^Test Case\|IDELaunch" | head -24
  grep -E "error:" "$D/build.log" | grep -v "error: -\[" | head -6
  exit 1
fi
mkdir -p "$OUT"
for n in chat question drawer terminal; do
  [ -f "$D/shots/$n.png" ] || { echo "화면이 빠졌어요: $n" >&2; exit 1; }
  sips -Z 1200 "$D/shots/$n.png" --out "$OUT/app-$n$SUF.png" >/dev/null   # 긴 변 1200px 로 줄임(README 에는 작게 보임)
done
echo "찍었어요: $OUT/app-{chat,question,drawer,terminal}$SUF.png"
