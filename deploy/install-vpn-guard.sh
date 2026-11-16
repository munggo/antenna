#!/bin/sh
# 맥 VPN 지킴이 설치(선택 기능): 맥을 OpenVPN 에 항상 붙여 둔다 → 재부팅하거나 망이 바뀌어도 폰이 밖에서 맥의 VPN 주소로 닿는다.
# Tailscale·WireGuard 앱처럼 스스로 다시 붙는 VPN 을 쓰면 필요 없다.
# 준비: Homebrew 의 openvpn(brew install openvpn)과, ~/.config/pi-remote/env 의 값
#   PI_REMOTE_VPN_CONFIG=~/.config/pi-remote/client.ovpn   OpenVPN 클라이언트 설정 파일(필수)
#   PI_REMOTE_VPN_GATEWAY=10.8.0.1                         터널 건너편 주소(선택: 30초마다 핑으로 살아 있는지 봄. 안 적으면 프로세스만 봄)
# 쓰기: sudo sh deploy/install-vpn-guard.sh       설치·등록(root 로 도는 LaunchDaemon, 30초마다)
#       sh deploy/install-vpn-guard.sh --print    설치하지 않고, 설치될 지킴이 스크립트만 보여 줌(sudo 불필요)
# 빼기: sudo launchctl bootout system/com.munggo.pi-remote-vpn-guard 뒤에 아래 BIN·PLIST 두 파일을 지움
# 주의: 지킴이는 root 로 openvpn 을 띄운다. 설정 파일은 나만 고칠 수 있어야 한다(다른 사용자가 쓸 수 있으면 설치하지 않음).
# 작성: 서문교
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
BIN=/usr/local/bin/pi-remote-vpn-guard.sh
LABEL=com.munggo.pi-remote-vpn-guard
PLIST=/Library/LaunchDaemons/$LABEL.plist
MODE="${1:-}"
die() { echo "$*" >&2; exit 1; }
case "$MODE" in "" | --print) ;; *) die "모르는 옵션: $MODE" ;; esac

# 설정이 있는 홈: sudo 로 부른 사용자의 홈(root 의 홈이 아님)
USER_HOME=$(dscl . -read "/Users/${SUDO_USER:-$USER}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
[ -d "$USER_HOME" ] || die "사용자 홈을 찾지 못했어요(sudo 로 실행했나요?)"
ENV_FILE="${PI_REMOTE_ENV:-$USER_HOME/.config/pi-remote/env}"

# 설정 파일의 값만 읽는다(root 로 그 파일을 실행하지 않음). 같은 이름이 여러 줄이면 마지막 것
conf() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- |
    sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
CFG=$(conf PI_REMOTE_VPN_CONFIG)
GW=$(conf PI_REMOTE_VPN_GATEWAY)
case "$CFG" in
  "~/"*) CFG="$USER_HOME/${CFG#??}" ;;
  '$HOME/'*) CFG="$USER_HOME/${CFG#??????}" ;;
esac
if [ -z "$CFG" ]; then
  echo "OpenVPN 설정 파일을 알려 주세요. $ENV_FILE 에 이렇게 적습니다:" >&2
  echo "  PI_REMOTE_VPN_CONFIG=~/.config/pi-remote/client.ovpn" >&2
  echo "  PI_REMOTE_VPN_GATEWAY=10.8.0.1    # 터널 건너편 주소(선택)" >&2
  exit 1
fi
# 경로·주소를 sed 와 셸 스크립트에 그대로 넣으므로 글자를 좁게 받는다
ok_path() {
  case "$1" in /*) ;; *) return 1 ;; esac
  case "$1" in *[!A-Za-z0-9._/-]*) return 1 ;; esac
}
ok_path "$CFG" || die "설정 파일 경로에는 영문·숫자와 . _ / - 만 쓸 수 있어요(/ 로 시작): $CFG"
[ -f "$CFG" ] || die "OpenVPN 설정 파일이 없어요: $CFG"
case "$GW" in *[!0-9A-Fa-f.:]*) die "게이트웨이 주소가 숫자 주소가 아니에요: $GW" ;; esac
case "$(stat -f %Sp "$CFG")" in
  ?????w???? | ????????w?) die "설정 파일을 다른 사용자가 고칠 수 있어요(root 로 실행되는 설정입니다): chmod go-w $CFG" ;;
esac

# openvpn: Homebrew 가 두는 곳에서 찾는다. 다른 곳에 있으면 PI_REMOTE_OPENVPN=<경로> 를 앞에 붙여 실행
OVPN="${PI_REMOTE_OPENVPN:-}"
if [ -z "$OVPN" ]; then
  for c in /opt/homebrew/sbin/openvpn /usr/local/sbin/openvpn /opt/homebrew/bin/openvpn /usr/local/bin/openvpn; do
    if [ -x "$c" ]; then OVPN=$c; break; fi
  done
fi
[ -n "$OVPN" ] || die "openvpn 을 찾지 못했어요: brew install openvpn"
ok_path "$OVPN" && [ -x "$OVPN" ] || die "openvpn 실행 파일이 아니에요: $OVPN"

render() { sed -e "s|__OPENVPN__|$OVPN|g" -e "s|__VPN_CONFIG__|$CFG|g" -e "s|__VPN_GATEWAY__|$GW|g" "$HERE/mac-vpn-guard.sh"; }
if [ "$MODE" = "--print" ]; then
  render
  exit 0
fi
[ "$(id -u)" = 0 ] || die "root 로 실행해 주세요: sudo sh deploy/install-vpn-guard.sh"

echo "1) 지킴이 스크립트 설치: $BIN (설정 파일 $CFG${GW:+, 게이트웨이 $GW})"
mkdir -p "$(dirname "$BIN")"
render > "$BIN"
chmod +x "$BIN"

echo "2) LaunchDaemon plist 설치"
cp "$HERE/$LABEL.plist" "$PLIST"
chown root:wheel "$PLIST"
chmod 644 "$PLIST"

echo "3) 데몬 재등록(기존 정리 후)"
launchctl bootout system/$LABEL 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl enable system/$LABEL

echo "4) 중복 openvpn 정리 + 즉시 1회 기동"
pkill -f "$(basename "$CFG")" 2>/dev/null || true
sleep 1
launchctl kickstart -k system/$LABEL

echo ""
echo "완료. 상태:"
launchctl print system/$LABEL 2>/dev/null | grep -E "state|pid" | head -3 || true
echo "→ 이제 재부팅해도 맥이 스스로 VPN 에 붙어요. 기록: /tmp/pi-remote-vpn.log /tmp/pi-remote-vpn-guard.log"
