#!/bin/sh
# 폰에 pi-remote 앱 빌드·설치.
# Xcode 에 계정을 넣지 않고 App Store Connect API 키로 자동 서명한다(푸시 권한이 든 프로필이 필요해서).
# 개인 값은 저장소 밖 설정 파일에서 읽는다(같은 이름의 환경 변수를 주면 그것이 먼저):
#   ~/.appstoreconnect/config   ASC_KEY_ID(키 번호) · ASC_ISSUER_ID(발급자 ID). 키 파일: ~/.appstoreconnect/private_keys/AuthKey_<키 번호>.p8
#   ~/.config/pi-remote/env     PI_REMOTE_DEVICE(설치할 폰의 기기 번호. xcrun devicectl list devices 로 확인)
#   ios/Local.xcconfig          DEVELOPMENT_TEAM(서명 팀 번호. ios/Local.xcconfig.example 을 복사해 만듦)
set -e
conf() { grep -E "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'; }
ASC="$HOME/.appstoreconnect/config"
KEY_ID="${ASC_KEY_ID:-$(conf "$ASC" ASC_KEY_ID)}"
ISS="${ASC_ISSUER_ID:-$(conf "$ASC" ASC_ISSUER_ID)}"
DEVICE="${PI_REMOTE_DEVICE:-$(conf "${PI_REMOTE_ENV:-$HOME/.config/pi-remote/env}" PI_REMOTE_DEVICE)}"
[ -n "$KEY_ID" ] && [ -n "$ISS" ] || { echo "App Store Connect 키 정보가 없어요: $ASC 에 ASC_KEY_ID 와 ASC_ISSUER_ID 를 넣어 주세요" >&2; exit 1; }
[ -n "$DEVICE" ] || { echo "설치할 폰을 몰라요: ~/.config/pi-remote/env 에 PI_REMOTE_DEVICE=<기기 번호> 를 넣어 주세요(xcrun devicectl list devices 로 확인)" >&2; exit 1; }
KEY="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
cd "$(dirname "$0")/../ios"
xcodegen generate >/dev/null
xcodebuild -project PiRemote.xcodeproj -scheme PiRemote -destination "generic/platform=iOS" \
  -allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISS" \
  -derivedDataPath /tmp/piremote-dev build 2>&1 | grep -E "error:|BUILD SUCCEEDED|BUILD FAILED" | sort -u
xcrun devicectl device install app --device "$DEVICE" /tmp/piremote-dev/Build/Products/Debug-iphoneos/PiRemote.app 2>&1 | grep -iE "installed|error" | tail -2
