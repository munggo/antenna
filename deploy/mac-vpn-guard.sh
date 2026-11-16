#!/bin/sh
# 맥을 OpenVPN 에 "항상" 연결해 둔다(선택 기능). 터널이 죽으면 정리한 뒤 다시 띄운다.
# 맥이 어디에 있든(집·회사·이동 중) VPN 에 붙어 있어야 폰이 밖에서 맥의 VPN 주소로 닿는다.
# (같은 Wi-Fi 에서는 자동 발견으로 바로 붙으므로 VPN 이 없어도 된다.
#  Tailscale·WireGuard 앱처럼 스스로 다시 붙는 VPN 을 쓰면 이 지킴이는 필요 없다.)
# launchd 가 30초마다 부른다. root 로 돈다. 어떤 경우에도 exit 0.
#
# 이 파일은 틀이다: __자리__ 는 설치할 때 ~/.config/pi-remote/env 의 값으로 채워진다(root 로 돌아 $HOME 을 못 씀).
#   sudo sh deploy/install-vpn-guard.sh
# 작성: 서문교

OVPN="__OPENVPN__"            # openvpn 실행 파일
CFG="__VPN_CONFIG__"          # OpenVPN 설정 파일(PI_REMOTE_VPN_CONFIG)
VPN_GW="__VPN_GATEWAY__"      # 터널 건너편 주소(PI_REMOTE_VPN_GATEWAY). 비어 있으면 핑 없이 프로세스가 도는지만 본다
PIDF="${PI_REMOTE_VPN_PIDFILE:-/var/run/pi-remote-vpn.pid}"
LOG="${PI_REMOTE_VPN_LOG:-/tmp/pi-remote-vpn.log}"

# 이 설정 파일을 쓰는 openvpn 프로세스만 보고 정리한다(다른 VPN 은 건드리지 않음) → 중복 실행 방지
PATTERN="$(basename "$CFG")"
running() { pgrep -f "$PATTERN" >/dev/null 2>&1; }
tunnel_ok() { running && { [ -z "$VPN_GW" ] || ping -c1 -t3 "$VPN_GW" >/dev/null 2>&1; }; }
# 중복까지 이 설정의 openvpn 을 모두 끝냄
stop_vpn() { pkill -f "$PATTERN" 2>/dev/null; rm -f "$PIDF"; sleep 1; }
# 항상 깨끗이 정리한 뒤 하나만 띄움
start_vpn() { stop_vpn; "$OVPN" --config "$CFG" --daemon --writepid "$PIDF" --log "$LOG"; }

# 터널이 안 통하면(죽었거나 아직 안 붙음) 정리하고 다시 띄움
if ! tunnel_ok; then
  start_vpn
fi
exit 0
