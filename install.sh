#!/bin/sh
# Antenna 맥 쪽 설치를 한 번에. 여러 번 돌려도 된다(이미 된 것은 그대로 두고, 빠진 것만 채움).
#   sh install.sh                  설치
#   sh install.sh --host <주소>     폰이 같은 Wi-Fi 밖에서 붙을 맥의 IP 주소(Tailscale·VPN 주소)를 설정에 적음. 쉼표로 여러 개
#   sh install.sh --no-agent       브리지를 자동 실행(로그인하면 켜짐)에 등록하지 않음 → 직접 켜기: server/run.sh
# 하는 일: 필요한 프로그램 확인 → 브리지 모듈 설치 → 설정 파일(~/.config/pi-remote/env) →
#          Claude Code 연결(쓰는 맥이면) → pi 확장(쓰는 맥이면) → 브리지 자동 실행 → 점검
# 깔지 않는 것: tmux·node 같은 프로그램(없으면 무엇을 깔지 알려 주고 그만둠), 선택 기능(README 의 '선택 기능')
# 작성: 서문교
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${PI_REMOTE_ENV:-$HOME/.config/pi-remote/env}"
HOSTS=""
AGENT=1
while [ $# -gt 0 ]; do
  case "$1" in
    --host)
      [ -n "${2:-}" ] || { echo "--host 뒤에 맥 주소를 적어 주세요(예: --host 100.64.0.1)" >&2; exit 1; }
      HOSTS=$2
      shift
      ;;
    --no-agent) AGENT="" ;;
    *) echo "모르는 옵션: $1 (쓰는 법은 이 파일 머리말)" >&2; exit 1 ;;
  esac
  shift
done
case "$HOSTS" in *[!A-Za-z0-9.:,-]*) echo "맥 주소에는 영문·숫자와 . : - 만 쓸 수 있어요(여러 개는 쉼표로, 빈칸 없이): $HOSTS" >&2; exit 1 ;; esac
step() { printf '\n▸ %s\n' "$*"; }
conf() { grep "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' "'; }
# sub <명령…>: 하위 설치 스크립트를 돌려 출력을 들여 써 보여 준다. 실패하면 설치를 그만둠. 출력은 SUB_OUT 에도 남김
sub() {
  if SUB_OUT=$("$@" 2>&1); then
    echo "$SUB_OUT" | sed 's/^/  /'
  else
    echo "$SUB_OUT" | sed 's/^/  /' >&2
    echo "  이 단계에서 실패해 설치를 그만둬요: $*" >&2
    exit 1
  fi
}

# ── 1. 필요한 프로그램 ──
step "필요한 프로그램"
[ "$(uname -s)" = Darwin ] || { echo "맥(macOS)에서만 돌아요." >&2; exit 1; }
MISSING=""
TMUX_BIN=$(command -v tmux || true)
for c in /opt/homebrew/bin/tmux /usr/local/bin/tmux; do
  if [ -z "$TMUX_BIN" ] && [ -x "$c" ]; then TMUX_BIN=$c; fi
done
if [ -n "$TMUX_BIN" ]; then echo "  tmux: $TMUX_BIN"; else MISSING="$MISSING tmux"; fi
# node 20 이상: 설정에 적어 둔 것 → PATH → Homebrew 자리 → nvm 에 깔린 것(높은 판부터)
ver_ok() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null; }
NODE=""
for c in "$(conf PI_REMOTE_NODE)" "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node \
  $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V -r); do
  if [ -z "$NODE" ] && [ -n "$c" ] && [ -x "$c" ] && ver_ok "$c"; then NODE=$c; fi
done
if [ -n "$NODE" ]; then echo "  node: $NODE ($("$NODE" -v))"; else MISSING="$MISSING node"; fi
if [ -n "$MISSING" ]; then
  echo "  없는 것:$MISSING" >&2
  echo "  Homebrew 로 깔 수 있어요: brew install$MISSING   (node 는 20 이상)" >&2
  exit 1
fi
PATH="$(dirname "$NODE"):$PATH"
export PATH

# ── 2. 브리지 모듈 ──
step "브리지 모듈(server/node_modules)"
mods_ok() { (cd "$HERE/server" && "$NODE" -e "require('node-pty'); require('ws'); require('bonjour-service'); require('qrcode-terminal')" 2>/dev/null); }
if mods_ok; then
  echo "  이미 깔려 있음"
else
  command -v npm >/dev/null 2>&1 || { echo "  npm 을 찾지 못했어요(node 와 함께 깔립니다)" >&2; exit 1; }
  # 잠금 파일대로 깔고(npm ci), 안 되면 보통 설치
  (cd "$HERE/server" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; })
  mods_ok || { echo "  모듈을 깔았지만 읽히지 않아요. 위 오류를 확인해 주세요" >&2; exit 1; }
  echo "  설치함"
fi

# ── 3. 설정 파일 ──
step "설정 파일 $ENV_FILE"
CHANGED=""
# set_conf <이름> <값>: 있으면 그 줄을 바꾸고 없으면 끝에 더함
set_conf() {
  if grep -q "^$1=" "$ENV_FILE"; then
    (umask 077 && awk -v k="$1" -v v="$2" 'index($0, k "=") == 1 { print k "=" v; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp")
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
  CHANGED=1
}
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  (
    umask 077
    {
      echo "# Antenna 브리지 설정(sh install.sh 가 만듦). 나만 읽을 수 있어야 한다(권한 600)"
      echo "# 폰의 연결 토큰은 여기 없다: 폰마다 짝짓기(sh deploy/pair.sh)로 받고, 맥에는 그 해시만 devices.json 에 남는다"
      echo "PI_TMUX_SESSION=antenna"
      echo "HOST=0.0.0.0"
      echo "PORT=8787"
      echo "# 암호화 연결만 받는다(폰은 짝짓기 QR 로 받은 지문의 이 맥만 믿음). 암호화 없이 붙는 예전 앱을 쓸 때만 이 줄을 지운다"
      echo "PI_REMOTE_TLS_ONLY=1"
      echo "# 브리지를 돌릴 node(자동 실행에서는 PATH 로 찾지 못하므로 경로를 적어 둔다)"
      echo "PI_REMOTE_NODE=$NODE"
      echo "# 폰이 같은 Wi-Fi 밖에서 붙을 맥의 IP 주소(Tailscale·VPN 주소, 쉼표로 여러 개·빈칸 없이). 바꾸면 QR 을 다시 찍는다"
      if [ -n "$HOSTS" ]; then echo "PI_REMOTE_HOSTS=$HOSTS"; else echo "# PI_REMOTE_HOSTS=100.64.0.1"; fi
    } > "$ENV_FILE"
  )
  CHANGED=1
  echo "  새로 만듦"
else
  echo "  이미 있음(그대로 둠)"
  OLD_NODE=$(conf PI_REMOTE_NODE)
  if [ -z "$OLD_NODE" ] || [ ! -x "$OLD_NODE" ]; then
    set_conf PI_REMOTE_NODE "$NODE"
    echo "  브리지를 돌릴 node 를 적었어요: $NODE"
  fi
  if [ -n "$HOSTS" ] && [ "$(conf PI_REMOTE_HOSTS)" != "$HOSTS" ]; then
    set_conf PI_REMOTE_HOSTS "$HOSTS"
    echo "  맥 주소를 적었어요: $HOSTS (폰에서 QR 을 다시 찍어야 해요)"
  fi
fi
if [ "$(stat -f %Lp "$ENV_FILE")" != 600 ]; then
  chmod 600 "$ENV_FILE"
  echo "  나만 읽을 수 있게 권한을 600 으로 바꿨어요"
fi
SESSION=$(conf PI_TMUX_SESSION)
PORT=$(conf PORT)
if [ -z "$(conf PI_REMOTE_HOSTS)" ]; then
  echo "  맥 주소(PI_REMOTE_HOSTS)가 없어요: 폰은 같은 Wi-Fi 에서만 맥을 찾아요."
  CAND=$("$NODE" -e 'const os = require("node:os"); const a = Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l ?? []).filter((i) => i.family === "IPv4" && !i.internal && (n.startsWith("utun") || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address))).map((i) => i.address)); process.stdout.write([...new Set(a)].join(" "))' 2>/dev/null || true)
  echo "  밖에서도 쓰려면 맥의 Tailscale·VPN 주소로 다시: sh install.sh --host <주소>${CAND:+   (이 맥의 VPN 주소로 보이는 것: $CAND)}"
fi

# ── 4. Claude Code 연결 ──
step "Claude Code 연결"
if command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; then
  sub env PI_REMOTE_NODE="$NODE" sh "$HERE/claude-remote/install.sh"
else
  echo "  Claude Code 가 없어 건너뜀(나중에 깔면: sh claude-remote/install.sh)"
fi

# ── 5. pi 확장 ──
step "pi 확장"
if command -v pi >/dev/null 2>&1 || [ -d "$HOME/.pi/agent" ]; then
  sub sh "$HERE/pi-extension/install.sh"
else
  echo "  pi 가 없어 건너뜀(나중에 깔면: sh pi-extension/install.sh)"
fi

# ── 6. 브리지 자동 실행 ──
step "브리지"
if [ -n "$AGENT" ]; then
  LABEL=com.munggo.pi-remote
  sub sh "$HERE/deploy/install-agents.sh" pi-remote
  case "$SUB_OUT" in
    *"그대로 둠"*)
      # 등록은 그대로인데 이번에 설정을 바꿨으면 다시 시작해야 새 설정을 읽는다
      if [ -n "$CHANGED" ]; then
        launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
        echo "  설정이 바뀌어 브리지를 다시 시작했어요"
      fi
      ;;
  esac
  i=0
  while [ $i -lt 20 ] && ! /usr/bin/nc -z 127.0.0.1 "${PORT:-8787}" >/dev/null 2>&1; do
    sleep 1
    i=$((i + 1))
  done
else
  echo "  자동 실행에 등록하지 않았어요. 직접 켜기: $HERE/server/run.sh"
fi

# ── 7. 점검 ──
step "점검(node deploy/doctor.mjs)"
RC=0
"$NODE" "$HERE/deploy/doctor.mjs" || RC=$?

echo
if [ "$RC" -ne 0 ] && [ -n "$AGENT" ]; then
  echo "설치는 했지만 점검에서 문제가 나왔어요. 위의 ✗ 줄과 화살표(→)를 확인해 주세요."
  exit 1
fi
echo "설치가 끝났어요. 다음:"
echo "  1) 폰에 Antenna 앱을 깔고, 맥에서  sh deploy/pair.sh  → 화면의 QR 을 폰 카메라로 찍기"
echo "  2) 맥 터미널에서  tmux attach -t ${SESSION:-pi}  → 그 안에서 claude 나 pi 를 켜면 폰에 같은 화면이 보여요"
echo "  다시 점검: node deploy/doctor.mjs"
