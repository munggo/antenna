#!/bin/bash
# Antenna 폰 짝짓기: 맥 화면에 QR → 폰 카메라로 찍으면 Antenna 가 열려 이 맥과 짝짓는다.
# QR 에는 한 번 쓰는 짝짓기 코드(5분 동안), 이 맥의 인증서 지문, 포트(PORT), 맥 주소(PI_REMOTE_HOSTS: 폰이 같은 Wi-Fi 밖에서 붙을 주소. 쉼표로 여러 개)가 들어간다.
# 폰은 그 지문의 맥과만 암호화 연결을 맺는다(같은 망의 다른 기기가 엿보거나 맥인 척할 수 없음).
# 폰은 그 코드를 브리지에 내고 그 폰만의 연결 토큰을 받는다 → QR 사진이 새어도 5분 뒤에는 쓸모가 없고, 폰마다 따로 끊을 수 있다.
# PI_REMOTE_HOSTS 가 없으면 주소 없이 만든다(같은 Wi-Fi 에서는 자동으로 찾고, 폰이 전에 받은 주소가 있으면 그대로 씀).
# 쓰기: antenna-pair                       새 짝짓기 QR
#       antenna-pair --list                짝지은 기기 보기
#       antenna-pair --revoke <번호|이름>   그 기기 끊기(붙어 있던 연결도 1분 안에 닫힘)
#       antenna-pair --legacy              예전 앱용 QR(설정의 공유 토큰 PI_REMOTE_TOKEN 이 남아 있을 때만. 코드를 모르는 예전 앱에)
# 짝지어지면(또는 Enter, 5분) 화면과 tmux 기록에서 QR 을 지운다.
# 작성: 서문교
set -e
# 모르는 옵션이면 QR 을 띄우지 않는다(띄우면 화면과 tmux 기록을 지우므로)
case "${1:-}" in
  "" | --list | --revoke | --legacy) ;;
  *) echo "쓰기: sh deploy/pair.sh [--list | --revoke <번호|이름> | --legacy]" >&2; exit 2 ;;
esac
ENV_FILE="${PI_REMOTE_ENV:-$HOME/.config/pi-remote/env}"
[ -f "$ENV_FILE" ] || { echo "설정 파일이 없어요: $ENV_FILE (맥 쪽 설치: sh install.sh)" >&2; exit 1; }
conf() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d ' "'; }
# 이 파일이 있는 곳(antenna-pair 같은 바로가기로 불러도 진짜 자리를 찾음)
SELF="$0"
while [ -L "$SELF" ]; do
  T=$(readlink "$SELF")
  case "$T" in /*) SELF="$T" ;; *) SELF="$(dirname "$SELF")/$T" ;; esac
done
HERE="$(cd "$(dirname "$SELF")" && pwd)"
# node: 브리지가 쓰는 것(설정의 PI_REMOTE_NODE) → PATH 의 node
NODE=$(conf PI_REMOTE_NODE)
[ -n "$NODE" ] && [ -x "$NODE" ] || NODE=$(command -v node || true)
[ -n "$NODE" ] || { echo "node 를 찾지 못했어요" >&2; exit 1; }
export PI_REMOTE_ENV="$ENV_FILE"

case "${1:-}" in
  --list)
    exec "$NODE" "$HERE/devices-cli.mjs" list
    ;;
  --revoke)
    [ -n "${2:-}" ] || { echo "끊을 기기의 번호나 이름을 적어 주세요(목록: sh deploy/pair.sh --list)" >&2; exit 2; }
    exec "$NODE" "$HERE/devices-cli.mjs" revoke "$2"
    ;;
esac
[ -d "$HERE/../server/node_modules/qrcode-terminal" ] || { echo "QR 을 그리는 모듈이 없어요: (cd server && npm install)" >&2; exit 1; }

PORT=$(conf PORT | grep -E '^[0-9]+$' || echo 8787)
if [ "${1:-}" = "--legacy" ]; then
  TOKEN=$(conf PI_REMOTE_TOKEN)
  [ -n "$TOKEN" ] || { echo "설정 파일에 예전 공유 토큰(PI_REMOTE_TOKEN)이 없어요. 새 앱은 옵션 없이: sh deploy/pair.sh" >&2; exit 1; }
  URL="piremote://pair?token=$TOKEN&port=$PORT"
else
  CODE=$("$NODE" "$HERE/devices-cli.mjs" start)
  [ -n "$CODE" ] || { echo "짝짓기 코드를 만들지 못했어요" >&2; exit 1; }
  URL="piremote://pair?code=$CODE&port=$PORT"
  # 이 맥의 인증서 지문: 폰은 이 지문의 맥과만 암호화 연결을 맺는다
  FP=$("$NODE" "$HERE/devices-cli.mjs" fingerprint)
  if [ -n "$FP" ]; then URL="$URL&fp=$FP"; else echo "주의: 인증서를 만들지 못해 암호화 없이 짝지어요(/usr/bin/openssl 확인)" >&2; fi
fi
for h in $(conf PI_REMOTE_HOSTS | tr ',' ' '); do
  case "$h" in *[!A-Za-z0-9.:-]*) echo "맥 주소에 쓸 수 없는 글자가 있어 뺐어요: $h" >&2 ;; *) URL="$URL&host=$h" ;; esac
done
/usr/bin/nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 || echo "주의: 브리지가 돌고 있지 않아요(포트 $PORT). 켜야 폰이 붙어요: sh install.sh 또는 server/run.sh" >&2

DEVICES="$(dirname "$ENV_FILE")/devices.json"
stamp() { stat -f %m "$DEVICES" 2>/dev/null || echo 0; }
BEFORE=$(stamp)
clear
echo "Antenna 짝짓기 QR — 폰 카메라로 찍어 주세요"
PAIR_URL="$URL" "$NODE" "$HERE/qr.mjs"
if [ "${1:-}" = "--legacy" ]; then
  echo "찍으면 Antenna 가 열리며 연결 정보를 저장해요. 다 찍었으면 Enter (5분 뒤엔 저절로 지워요)"
else
  echo "찍으면 Antenna 가 열려 이 맥과 짝지어요(이 QR 은 5분 동안, 한 번만 쓸 수 있어요). 그만두려면 Enter"
fi
# 짝지어지거나(기기 목록이 바뀜) Enter 를 누르거나 5분이 지나면 지운다
PAIRED=""
i=0
while [ $i -lt 300 ]; do
  RC=0
  read -r -t 1 _ || RC=$?
  [ "$RC" -gt 128 ] || break                                  # 시간이 다 된 것이 아니면(Enter·입력 없음) 그만
  if [ "$(stamp)" != "$BEFORE" ]; then PAIRED=1; break; fi
  i=$((i + 1))
done
clear
[ -n "${TMUX:-}" ] && tmux clear-history 2>/dev/null || true
if [ -n "$PAIRED" ]; then
  echo "짝지었어요. QR 을 지웠어요. (짝지은 기기: sh deploy/pair.sh --list)"
else
  echo "QR 을 지웠어요."
fi
