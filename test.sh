#!/bin/sh
# Antenna 시험 묶음: 고친 뒤 한 번에 돌려 확인한다.
#   sh test.sh           빠른 시험 전부: 판정 시험과, 시험용 tmux 세션·시험 브리지만 쓰는 시험(2분쯤)
#   sh test.sh <글>      이름에 그 글이 든 시험만(예: sh test.sh usage)
#   sh test.sh --app     빠른 시험 뒤에 앱 화면 시험도(시뮬레이터, 빌드 포함 7~8분 더. test/app.sh)
#   sh test.sh --list    무엇이 도는지만
# 모델을 부르지 않고, 쓰는 tmux 세션(antenna)과 쓰는 브리지는 건드리지 않는다.
# 묶음에 넣지 않은 것(각 파일 머리말의 방법대로 따로 돌림): 실제 pi·Claude Code 를 띄우는 *-e2e 시험, 그것들이 필요한 앱 화면 시험
# 작성: 서문교
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 2

LIST=""
FILTER=""
APP=""
case "${1:-}" in
  --list) LIST=1 ;;
  --app) APP=1 ;;
  --*) echo "모르는 옵션: $1" >&2; exit 2 ;;
  *) FILTER="${1:-}" ;;
esac

# node 22.6 이상이 필요하다(pi 확장 시험이 .ts 를 바로 읽음). PATH 의 node 가 낮으면 nvm 에 깔린 것 가운데 찾는다
ver_ok() { "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1)' 2>/dev/null; }
NODE=$(command -v node 2>/dev/null || true)
if [ -z "$NODE" ] || ! ver_ok "$NODE"; then
  NODE=""
  for n in $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r); do
    if ver_ok "$n"; then NODE=$n; break; fi
  done
fi
[ -n "$NODE" ] || { echo "node 22.6 이상을 찾지 못했어요" >&2; exit 2; }
PATH="$(dirname "$NODE"):$PATH"
export PATH
[ -d server/node_modules ] || { echo "브리지에 필요한 모듈이 없어요: (cd server && npm install)" >&2; exit 2; }

OUT=$(mktemp -d "${TMPDIR:-/tmp}/antenna-test.XXXXXX")
PASS=0
FAILED=""
SKIPPED=""

# run <이름> <무엇을 보는지> <명령…>
run() {
  name=$1
  desc=$2
  shift 2
  case "$name" in *"$FILTER"*) ;; *) return 0 ;; esac
  if [ -n "$LIST" ]; then
    printf '  %-18s %s\n' "$name" "$desc"
    return 0
  fi
  start=$(date +%s)
  if "$@" > "$OUT/$name.log" 2>&1; then
    PASS=$((PASS + 1))
    # 확인한 가짓수: '통과' 줄 수. 그런 줄이 없는 시험은 마지막 줄(그 시험의 요약)을 보여 준다
    n=$(grep -c '^통과' "$OUT/$name.log")
    [ "$n" -gt 0 ] && n="확인 ${n}가지" || n=$(tail -1 "$OUT/$name.log")
    printf '통과  %-18s %s (%s초, %s)\n' "$name" "$desc" "$(($(date +%s) - start))" "$n"
  else
    FAILED="$FAILED $name"
    printf '실패  %-18s %s (%s초)\n' "$name" "$desc" "$(($(date +%s) - start))"
    grep -E '^실패|Error' "$OUT/$name.log" | head -8 | sed 's/^/        /'
  fi
}
# skip <이름> <까닭>
skip() {
  case "$1" in *"$FILTER"*) ;; *) return 0 ;; esac
  if [ -n "$LIST" ]; then
    printf '  %-18s (건너뜀: %s)\n' "$1" "$2"
    return 0
  fi
  SKIPPED="$SKIPPED $1"
  printf '건너뜀 %-17s %s\n' "$1" "$2"
}

# 관리자 권한 창 시험은 시험 세션(창 0 은 셸)이 있어야 한다: 만들어 주고 끝나면 지운다
sudo_tab() {
  S=antennatest
  tmux kill-session -t "$S" 2>/dev/null
  tmux new-session -d -s "$S" -x 120 -y 40 -c /tmp || return 1
  PI_REMOTE_BRIDGE_LOG="$OUT/no-bridge.log" "$NODE" claude-remote/test/sudo-run-e2e.mjs "$S"
  rc=$?
  tmux kill-session -t "$S" 2>/dev/null
  return $rc
}

[ -n "$LIST" ] && echo "빠른 시험 묶음(모델을 부르지 않음):"

# ── 판정 시험(다른 프로그램이 필요 없음) ──
run usage "사용량 기록·공유 값" "$NODE" server/test/usage-history.test.mjs
run status-line "맥 화면 상태 줄에서 모델·생각 깊이 읽기, 입력창이 비었는지" "$NODE" server/test/status-line.test.mjs
run live-activity "작업 표시(잠금 화면)" "$NODE" server/test/live-activity.test.mjs
run battery "맥북 배터리 읽기(잔량·충전기·낮음)" "$NODE" server/test/battery.test.mjs
run advertise "브리지가 죽지 않는지(자동 발견 오류·죽음 기록)" "$NODE" server/test/advertise.test.mjs
run devices "기기별 토큰·짝짓기 코드(만들기·한 번 쓰기·끊기)" "$NODE" server/test/devices.test.mjs
run tls "연결 암호화(인증서·지문, 포트 하나에서 가려 받기)" "$NODE" server/test/tls.test.mjs
run convert "Claude Code 대화 기록 → 폰 메시지" "$NODE" claude-remote/test/convert-cases.mjs
run account "개인·회사 계정 고르기" "$NODE" claude-remote/test/account-cases.mjs
run screen-busy "Claude Code 화면이 일하는 중인지·뒤에서 도는 일" "$NODE" claude-remote/test/screen-busy-cases.mjs
run screen-dialog "훅 없이 묻는 Claude Code 창(피드백 초안·명령 창) → 폰 카드" "$NODE" claude-remote/test/screen-dialog-cases.mjs
run bg-line "백그라운드 일의 모델·생각 깊이(맥 화면 한 줄·하위 에이전트 깊이)" "$NODE" claude-remote/test/bg-line-cases.mjs
run windows "탭 목록: 백그라운드 탭·뒤에서 도는 일·끝난 것 고르기" "$NODE" server/test/windows.test.mjs
run switch "계정 전환 때 다시 켤 옵션" "$NODE" claude-remote/test/switch-cases.mjs
run vpn-guard "VPN 지킴이(선택 기능): 설정 읽기·터널 지키기" "$NODE" test/vpn-guard.test.mjs
run qr "짝짓기 QR: 그리기·짝짓기 명령·다시 읽기" "$NODE" test/qr.test.mjs
if command -v python3 >/dev/null 2>&1; then
  run reload-screen "업데이트 뒤 자동 다시 켜기: 끄면 안 되는 것(셸·초안·하위 에이전트 목록)이 화면에 보이는지" python3 test/claude-reload.test.py
else
  skip reload-screen "python3 가 없음"
fi
# 앱의 글 꾸밈 해석은 화면 프레임워크를 쓰지 않는 파일이라, 맥에서 바로 컴파일해 돌린다(swift 가 있을 때)
inline_markdown() {
  xcrun swiftc -parse-as-library ios/PiRemote/InlineMarkdown.swift ios/test/inline-markdown.swift -o "$OUT/inline-markdown" && "$OUT/inline-markdown"
}
if xcrun -f swiftc >/dev/null 2>&1; then
  run inline-markdown "앱의 글 꾸밈: 물결표 하나짜리(7~12개월)는 취소선이 아님, 코드·링크는 그대로" inline_markdown
else
  skip inline-markdown "swift(Xcode 명령줄 도구)가 없음"
fi
# 이 저장소에만 있는 내 시험이 있으면 함께 돌린다(test.local.sh 안에서 run 으로 더함)
if [ -f test.local.sh ]; then
  . ./test.local.sh
fi
if [ -d "$(dirname "$NODE")/../lib/node_modules/@earendil-works/pi-coding-agent" ]; then
  run pi-extension "pi 확장 판정(승인·질문·계획 모드·관리자 명령 등)" sh pi-extension/test/run.sh
else
  skip pi-extension "pi 가 이 node 에 깔려 있지 않음"
fi

# ── 시험용 tmux 세션·시험 브리지를 띄우는 시험(끝나면 지움) ──
if command -v tmux >/dev/null 2>&1; then
  run sudo-tab "관리자 권한 창(열기·실행·취소·가리기·단계)" sudo_tab
  run rev-handover "연결부가 새 판으로 스스로 바뀌는지" "$NODE" claude-remote/test/rev-handover-e2e.mjs
  run stuck-screen "'작업 중' 바로잡기·훅 유실 막기·대화 기록으로 켜기·질문 카드" "$NODE" claude-remote/test/stuck-screen.test.mjs
  run bg-jobs "뒤에서 도는 작업 목록·종료(셸은 바로, 에이전트는 Claude 에게 부탁)" "$NODE" claude-remote/test/bg-jobs.test.mjs
  run notify-hold "맥을 쓰는 중이면 폰 알림을 미루는지" "$NODE" server/test/notify-hold-e2e.mjs
  run no-pi "pi 가 없는 맥에서도 브리지가 되는지" "$NODE" server/test/no-pi.test.mjs
  run reach "재부팅 알림: 밖에서 붙을 주소가 올라와 있는지" "$NODE" server/test/reach.test.mjs
  run pairing "짝짓기·기기 토큰으로 붙기·바꾸기·끊기, 예전 토큰에서 옮기기" "$NODE" server/test/pairing.test.mjs
  run accounts-alert "개인·회사 계정이 섞이면 어느 쪽인지 가려 폰에 알림" "$NODE" server/test/accounts-alert.test.mjs
  run bg-drawer "서랍의 백그라운드 칸: 실행기·탭 목록·끝난 것 모두 닫기" "$NODE" server/test/bg-drawer.test.mjs
  run tasks "단축어로 시킨 일: 새 백그라운드 탭에서 시작·같은 요청은 한 번만·없는 폴더와 토큰 없는 접속은 거절" "$NODE" server/test/tasks.test.mjs
  run battery-bridge "맥북 배터리를 앱에 보내고, 낮으면 폰에 한 번 알림" "$NODE" server/test/battery-bridge.test.mjs
  run install "설치 명령: 새 맥(가짜 홈)에서 설치·브리지·점검·짝짓기" "$NODE" test/install.test.mjs
else
  skip sudo-tab "tmux 가 없음"
  skip rev-handover "tmux 가 없음"
  skip stuck-screen "tmux 가 없음"
  skip bg-jobs "tmux 가 없음"
  skip notify-hold "tmux 가 없음"
  skip no-pi "tmux 가 없음"
  run reach "재부팅 알림: 밖에서 붙을 주소가 올라와 있는지(판정만)" "$NODE" server/test/reach.test.mjs
  skip pairing "tmux 가 없음"
  skip accounts-alert "tmux 가 없음"
  skip bg-drawer "tmux 가 없음"
  run tasks "단축어로 시킨 일: 요청 판정(판정만)" "$NODE" server/test/tasks.test.mjs
  skip battery-bridge "tmux 가 없음"
  skip install "tmux 가 없음"
fi

if [ -n "$LIST" ]; then
  echo "앱 화면 시험(--app 을 주면 이어서 돎):"
  echo "  app                첫 화면 QR 연결 · 맥 주소와 확인 창 · 관리자 권한 창 · 짝짓기 · 백그라운드 서랍 · 맥북 배터리 · 대화 글(시뮬레이터)"
  exit 0
fi
if [ -n "$APP" ]; then
  export NODE
  run app "앱 화면: 첫 화면 QR 연결·맥 주소와 확인 창·관리자 권한 창·짝짓기·백그라운드 서랍·맥북 배터리·대화 글" sh test/app.sh
fi
echo
if [ -z "$FAILED" ]; then
  echo "모두 통과: ${PASS}개${SKIPPED:+ (건너뜀:$SKIPPED)}"
  rm -rf "$OUT"
  exit 0
fi
echo "실패:$FAILED / 통과 ${PASS}개${SKIPPED:+ (건너뜀:$SKIPPED)}"
echo "기록: $OUT"
exit 1
