#!/usr/bin/env bash
# 맥 브리지 서버 실행 래퍼.
# 토큰 등 설정은 git 에 올리지 않는 env 파일에서 읽는다.
set -euo pipefail
cd "$(dirname "$0")"

# 설정 파일: 기본 ~/.config/pi-remote/env  (PI_REMOTE_ENV 로 변경 가능)
ENV_FILE="${PI_REMOTE_ENV:-$HOME/.config/pi-remote/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

export PI_TMUX_SESSION="${PI_TMUX_SESSION:-antenna}"   # 브리지·설명서의 기본값과 같게
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8787}"

# 브리지를 돌릴 node: 설정의 PI_REMOTE_NODE(sh install.sh 가 적어 둠) → PATH 의 node → Homebrew 자리.
# 자동 실행(launchd)에서는 PATH 가 빈약해 node 를 못 찾으므로 설정에 적어 둔 경로가 있어야 한다.
NODE_BIN="${PI_REMOTE_NODE:-}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  [ -z "$NODE_BIN" ] || echo "PI_REMOTE_NODE 가 가리키는 node 가 없어요($NODE_BIN). 다른 node 를 찾아봅니다" >&2
  NODE_BIN="$(command -v node || true)"
  if [ -z "$NODE_BIN" ]; then
    for c in /opt/homebrew/bin/node /usr/local/bin/node; do
      if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
    done
  fi
fi
[ -n "$NODE_BIN" ] || { echo "node 를 찾지 못했어요. $ENV_FILE 에 PI_REMOTE_NODE=<node 경로> 를 적어 주세요(sh install.sh 가 적어 줍니다)" >&2; exit 1; }

exec "$NODE_BIN" bridge.mjs
