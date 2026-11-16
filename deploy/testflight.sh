#!/bin/sh
# TestFlight 로 올리기: 폰이 맥과 같은 Wi-Fi 에 없어도(밖에서도) 폰의 TestFlight 앱으로 받을 수 있다.
# (deploy/install-ios.sh 는 애플 도구가 같은 네트워크에서만 폰을 찾아서, VPN 너머의 폰에는 설치하지 못함)
# 배포용으로 묶어(archive) App Store Connect 에 올린다. 빌드 번호는 올릴 때마다 시각(연월일시분)으로 매긴다.
# 처음 한 번: App Store Connect 에 앱(com.munggo.piremote)을 만들고, node deploy/testflight-setup.mjs 로 배포용 프로필을 설치한다.
# 서명: 이 계정의 API 키로는 자동 배포 서명(클라우드 관리 인증서)이 안 돼서 수동 프로필로 한다(키체인의 'Apple Distribution' + 아래 프로필 이름).
# 쓰기: sh deploy/testflight.sh            묶어서 올림
#       sh deploy/testflight.sh --no-upload  올리지 않고 묶기·서명까지만 확인(/tmp/piremote-tf/export 에 ipa)
# 개인 값은 저장소 밖 설정 파일에서 읽는다(install-ios.sh 와 같음. 같은 이름의 환경 변수를 주면 그것이 먼저):
#   ~/.appstoreconnect/config   ASC_KEY_ID(키 번호) · ASC_ISSUER_ID(발급자 ID). 키 파일: ~/.appstoreconnect/private_keys/AuthKey_<키 번호>.p8
#   ios/Local.xcconfig          DEVELOPMENT_TEAM(서명 팀 번호). 내보낼 때도 묶을 때 쓴 팀을 그대로 쓴다
set -e
conf() { grep -E "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'; }
ASC="$HOME/.appstoreconnect/config"
KEY_ID="${ASC_KEY_ID:-$(conf "$ASC" ASC_KEY_ID)}"
ISS="${ASC_ISSUER_ID:-$(conf "$ASC" ASC_ISSUER_ID)}"
[ -n "$KEY_ID" ] && [ -n "$ISS" ] || { echo "App Store Connect 키 정보가 없어요: $ASC 에 ASC_KEY_ID 와 ASC_ISSUER_ID 를 넣어 주세요" >&2; exit 1; }
KEY="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
DEST=upload
[ "${1:-}" = "--no-upload" ] && DEST=export
BUILD="${BUILD:-$(date +%y%m%d%H%M)}"
OUT=/tmp/piremote-tf
AUTH="-allowProvisioningUpdates -authenticationKeyPath $KEY -authenticationKeyID $KEY_ID -authenticationKeyIssuerID $ISS"
cd "$(dirname "$0")/../ios"
mkdir -p "$OUT"
rm -rf "$OUT/PiRemote.xcarchive" "$OUT/export"
xcodegen generate >/dev/null
echo "묶는 중(빌드 번호 $BUILD)…"
# shellcheck disable=SC2086  # 인증 인자는 나눠서 넘김
xcodebuild -project PiRemote.xcodeproj -scheme PiRemote -configuration Release -destination "generic/platform=iOS" \
  -archivePath "$OUT/PiRemote.xcarchive" -derivedDataPath "$OUT/dd" CURRENT_PROJECT_VERSION="$BUILD" $AUTH archive > "$OUT/archive.log" 2>&1 ||
  { grep -E "error:|ARCHIVE FAILED" "$OUT/archive.log" | sort -u | head -20; echo "묶기 실패: $OUT/archive.log"; exit 1; }
cat > "$OUT/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.munggo.piremote</key><string>Antenna AppStore</string>
    <key>com.munggo.piremote.widgets</key><string>Antenna Widget AppStore</string>
  </dict>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST
[ "$DEST" = upload ] && echo "올리는 중…" || echo "서명해 내보내는 중(올리지 않음)…"
# shellcheck disable=SC2086
xcodebuild -exportArchive -archivePath "$OUT/PiRemote.xcarchive" -exportOptionsPlist "$OUT/export.plist" -exportPath "$OUT/export" $AUTH > "$OUT/export.log" 2>&1 ||
  { grep -E "error:|Error|EXPORT FAILED|No suitable application records" "$OUT/export.log" | sort -u | head -20; echo "실패: $OUT/export.log (프로필이 없다고 나오면 node deploy/testflight-setup.mjs)"; exit 1; }
if [ "$DEST" = upload ]; then
  echo "올렸어요(빌드 번호 $BUILD). 애플 쪽 처리가 끝나면(보통 5~15분) 폰의 TestFlight 에 뜹니다."
else
  ls "$OUT/export"/*.ipa && echo "묶기·서명 확인 끝(빌드 번호 $BUILD, 올리지 않음)"
fi
