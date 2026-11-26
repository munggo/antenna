#!/bin/sh
# 정한 계정으로 Claude Code 를 켠다: claude-as.sh work|personal|personal2 [claude 옵션...]
# pi-remote 연결부가 계정을 바꿔 다시 켤 때 셸 함수 claude() 대신 쓴다. 셸 함수는 셸이 켜질 때 읽히므로
# 함수를 고치기 전에 켠 셸에는 예전 정의가 남아, 그 함수로 다시 켜면 계정이 바뀌지 않았다(11-15)
# 회사(work)·추가 개인(personal2)을 켜는 길은 둘이다.
#   ① 직접 로그인해 둔 설정 폴더가 있으면(PI_WORK_CONFIG_DIR 기본 ~/.claude-work, PI_PERSONAL2_CONFIG_DIR 기본 ~/.claude-personal2 에
#      표식 .pi-login-ready. login-dir.mjs 가 만들고 표식을 둔다) 그 폴더로 켠다(CLAUDE_CONFIG_DIR). 크롬 연결·원격 제어는
#      claude.ai 로그인으로 켠 세션에서만 되고, 장기 토큰으로 켜면 계정이 같아도 꺼진다(11-25)
#   ② 없으면 열쇠고리 항목(PI_WORK_KEYCHAIN 기본 pi-anthropic-work, PI_PERSONAL2_KEYCHAIN 기본 pi-anthropic-personal2)의
#      장기 토큰을 이 claude 에만 넘긴다. 값은 출력하지 않는다.
# 어느 계정으로 켰는지 PI_CLAUDE_ACCOUNT 로 남긴다(토큰·설정 폴더만으로는 회사·추가 개인을 가릴 수 없어서. 연결부·상태 줄·아티팩트 훅이 봄)
# 개인(personal)은 Claude Code 기본 로그인(메인 개인 계정)
# 작성: 서문교
acct="${1:-}"
[ "$#" -gt 0 ] && shift
case "$acct" in
  work|personal2)
    if [ "$acct" = work ]; then
      item="${PI_WORK_KEYCHAIN:-pi-anthropic-work}"; label="회사"; dir="${PI_WORK_CONFIG_DIR:-$HOME/.claude-work}"
    else
      item="${PI_PERSONAL2_KEYCHAIN:-pi-anthropic-personal2}"; label="추가 개인"; dir="${PI_PERSONAL2_CONFIG_DIR:-$HOME/.claude-personal2}"
    fi
    PI_CLAUDE_ACCOUNT="$acct"
    if [ -f "$dir/.pi-login-ready" ]; then
      # ① 직접 로그인. 켜기 전에 바로가기를 다시 맞춘다(~/.claude 에 새로 생긴 것, 풀린 것). 못 맞춰도 켠다
      here="$(cd "$(dirname "$0")" && pwd)"
      [ -x "$here/login-dir" ] && "$here/login-dir" "$acct" sync >/dev/null || true
      unset CLAUDE_CODE_OAUTH_TOKEN
      CLAUDE_CONFIG_DIR="$dir"
      export CLAUDE_CONFIG_DIR PI_CLAUDE_ACCOUNT
      exec claude "$@"
    fi
    # ② 장기 토큰
    unset CLAUDE_CONFIG_DIR
    CLAUDE_CODE_OAUTH_TOKEN="$(/usr/bin/security find-generic-password -ws "$item" 2>/dev/null)" || CLAUDE_CODE_OAUTH_TOKEN=""
    if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
      echo "$label 계정 토큰을 열쇠고리 항목 '$item' 에서 읽지 못해 켜지 않았어요" >&2
      exit 1
    fi
    export CLAUDE_CODE_OAUTH_TOKEN PI_CLAUDE_ACCOUNT
    exec claude "$@"
    ;;
  personal)
    # 다른 계정 탭 안에서 불려도 메인 로그인으로 켜지게 그 계정의 토큰·표시·설정 폴더를 모두 뺀다
    unset CLAUDE_CODE_OAUTH_TOKEN PI_CLAUDE_ACCOUNT CLAUDE_CONFIG_DIR
    exec claude "$@"
    ;;
  *)
    echo "쓰는 법: claude-as.sh work|personal|personal2 [claude 옵션...]" >&2
    exit 2
    ;;
esac
