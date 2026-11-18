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

# 모듈 폴더(node_modules)가 지워졌으면 잠금 파일대로 다시 설치한다(11-18 용량 정리로 지워진 일. 도는 동안에는 브리지가 스스로 본다: deps.mjs).
# 설치에 실패했는데 node-pty 가 아예 없으면 브리지가 뜨지 못하므로 1분 쉬고 끝낸다 → launchd 가 다시 켜며 다시 시도(네트워크를 계속 두드리지 않게)
if ! "$NODE_BIN" --input-type=module -e 'import { missingDeps } from "./deps.mjs"; process.exit(missingDeps(".").length ? 1 : 0)' 2>/dev/null; then
  echo "[pi-remote] 모듈 폴더에 없는 것이 있어 다시 설치합니다(켜기 전)" >&2
  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  [ -x "$NPM_BIN" ] || NPM_BIN=npm
  if PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci --no-audit --no-fund >&2; then
    echo "[pi-remote] 모듈 다시 설치 끝" >&2
  else
    echo "[pi-remote] 모듈 다시 설치 실패" >&2
    if [ ! -f node_modules/node-pty/package.json ]; then sleep "${PI_REMOTE_DEPS_RETRY_SEC:-60}"; exit 1; fi
  fi
fi

exec "$NODE_BIN" bridge.mjs
