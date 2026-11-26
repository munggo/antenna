#!/bin/sh
# 안드로이드 앱 시험 환경: 시험용 tmux 세션·시험 브리지·가짜 대화 피드를 켜고 끈다. 쓰는 세션(antenna)·쓰는 브리지는 건드리지 않는다.
#   sh android/test/env.sh up      켜고, 에뮬레이터에서 열 짝짓기 링크를 한 줄로 낸다(맥 주소는 에뮬레이터에서 본 이 맥 10.0.2.2)
#   sh android/test/env.sh code    새 짝짓기 링크 하나 더(한 번 쓰면 끝나므로)
#   sh android/test/env.sh down    모두 치움
# 시험 브리지는 이 맥 안에서만 닿는 127.0.0.1 에 연다(에뮬레이터의 10.0.2.2 가 이 맥의 127.0.0.1). 설정·기록은 임시 폴더, 알림은 기록만.
# 가짜 피드가 받은 앱의 요청은 $D/signals/cmds 에 한 줄씩 남는다.
# 작성: 서문교
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
S=antennadroid                 # 시험 세션(창 0 은 가짜 Claude Code 탭, 창 1 은 셸)
B=antennadroid-bridge
PORT="${ANTENNA_DROID_PORT:-8797}"
D="${TMPDIR:-/tmp}/antenna-droid-test"

NODE="${NODE:-}"
if [ -z "$NODE" ]; then
  for n in "$(command -v node 2>/dev/null)" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r); do
    [ -n "$n" ] && "$n" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null && { NODE=$n; break; }
  done
fi
[ -n "$NODE" ] || { echo "node 22 이상을 찾지 못했어요" >&2; exit 2; }

link() {
  CODE=$(PI_REMOTE_ENV="$D/conf/env" "$NODE" "$REPO/deploy/devices-cli.mjs" start)
  FP=$(PI_REMOTE_ENV="$D/conf/env" "$NODE" "$REPO/deploy/devices-cli.mjs" fingerprint)
  echo "piremote://pair?code=$CODE&fp=$FP&host=10.0.2.2&port=$PORT"
}

down() {
  [ -f "$D/feed.pid" ] && kill "$(cat "$D/feed.pid")" 2>/dev/null
  tmux kill-session -t "=$B" 2>/dev/null
  tmux kill-session -t "=$S" 2>/dev/null
  rm -f "$HOME/.cache/pi-remote/notify-$S.sock"
  rm -rf "$D"
}

case "${1:-}" in
  up)
    down
    nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 && { echo "포트 $PORT 를 이미 쓰고 있어요(ANTENNA_DROID_PORT 로 바꿀 수 있음)" >&2; exit 2; }
    mkdir -p "$D/conf" "$D/signals" "$D/sessions" "$D/usage"
    : > "$D/conf/env"
    # 사용량은 Anthropic 에 묻지 않고 파일에서 읽는다(아이폰 화면 시험과 같은 방식): 개인 43%·Fable 74%, 회사 6%, 그래프용 지난 6일 기록
    "$NODE" -e 'const fs = require("fs"); const now = Date.now(); const reset = new Date(now + 5 * 86400e3).toISOString();
const lim = (percent, model) => ({ kind: model ? "weekly_scoped" : "weekly_all", group: "weekly", percent, severity: "normal", resets_at: reset, scope: model ? { model: { display_name: model } } : null });
fs.writeFileSync(process.argv[1], JSON.stringify({ limits: [lim(43), lim(74, "Fable")] }));
fs.writeFileSync(process.argv[2], JSON.stringify({ "anthropic-work": { "7d": { util: 0.06, reset: Math.floor(now / 1000) + 3 * 86400, at: now } } }));
const lines = []; for (let i = 6 * 72; i >= 0; i--) { const t = now - i * 20 * 60e3; lines.push(JSON.stringify({ t, s: null, w: Math.round(43 - i / 10), sr: null, wr: reset })); }
fs.writeFileSync(process.argv[3], lines.join("\n") + "\n");' "$D/usage.json" "$D/accounts.json" "$D/usage/usage-history.jsonl"
    tmux new-session -d -s "$S" -x 100 -y 40 -c /tmp || exit 1
    tmux rename-window -t "$S:0" "메인 작업"
    tmux new-window -d -t "$S:" -n "셸" -c /tmp
    tmux send-keys -t "$S:1" "echo 안드로이드 시험 셸" Enter
    # 서랍의 '백그라운드 작업 2'(메인 작업 탭에서 셸·에이전트가 도는 것처럼)와 관리자 권한 확인 창(🔐sudo, 실행할지 묻는 단계)
    tmux set-option -w -t "$S:0" @ai_jobs "셸 1개 · 에이전트 1개"
    N=$(tmux new-window -d -P -F '#{window_index}' -t "$S:" -n '🔐sudo' "cat > $D/signals/secret; sleep 600")
    tmux set-option -w -t "$S:$N" @sudo_stage confirm
    tmux select-window -t "$S:0"
    PANE=$(tmux display -p -t "$S:0" '#{pane_id}')
    "$NODE" "$REPO/android/test/fake-feed.mjs" "$PANE" "$D/signals" > "$D/feed.log" 2>&1 &
    echo $! > "$D/feed.pid"
    tmux new-session -d -s "$B" -c "$REPO/server" "env PI_REMOTE_ENV=$D/conf/env HOST=127.0.0.1 PORT=$PORT PI_TMUX_SESSION=$S PI_REMOTE_SESSION_DIR=$D/sessions PI_REMOTE_PUSH_FILE=$D/push.json PI_REMOTE_PUSH_DRYRUN=1 PI_REMOTE_TABS_FILE=$D/tabs.json PI_REMOTE_USAGE_DIR=$D/usage PI_REMOTE_FAKE_USAGE_FILE=$D/usage.json PI_ACCOUNTS_CACHE=$D/accounts.json PI_REMOTE_CRASH_LOG=$D/crash.log PI_BG_CLAUDE_CMD=true PI_BG_PI_CMD=true PI_NEW_TAB_PREFIX='echo started:' $NODE bridge.mjs > $D/bridge.log 2>&1"
    i=0
    while [ $i -lt 40 ] && ! nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; do sleep 0.5; i=$((i + 1)); done
    nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 || { echo "시험 브리지가 뜨지 않았어요:" >&2; tail -5 "$D/bridge.log" >&2; exit 1; }
    link
    ;;
  code) link ;;
  down) down ;;
  *) echo "쓰기: sh android/test/env.sh up | code | down" >&2; exit 2 ;;
esac
