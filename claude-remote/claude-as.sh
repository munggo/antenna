#!/bin/sh
# 정한 계정으로 Claude Code 를 켠다: claude-as.sh work|personal [claude 옵션...]
# pi-remote 연결부가 계정을 바꿔 다시 켤 때 셸 함수 claude() 대신 쓴다. 셸 함수는 셸이 켜질 때 읽히므로
# 함수를 고치기 전에 켠 셸에는 예전 정의가 남아, 그 함수로 다시 켜면 계정이 바뀌지 않았다(11-15)
# 회사(work) 토큰은 키체인 항목(PI_WORK_KEYCHAIN, 기본 pi-anthropic-work)에서 읽어 이 claude 에만 넘긴다. 값은 출력하지 않는다
# 작성: 서문교
acct="${1:-}"
[ "$#" -gt 0 ] && shift
case "$acct" in
  work)
    item="${PI_WORK_KEYCHAIN:-pi-anthropic-work}"
    CLAUDE_CODE_OAUTH_TOKEN="$(/usr/bin/security find-generic-password -ws "$item" 2>/dev/null)" || CLAUDE_CODE_OAUTH_TOKEN=""
    if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
      echo "회사 계정 토큰을 키체인 항목 '$item' 에서 읽지 못해 켜지 않았어요" >&2
      exit 1
    fi
    export CLAUDE_CODE_OAUTH_TOKEN
    exec claude "$@"
    ;;
  personal)
    unset CLAUDE_CODE_OAUTH_TOKEN
    exec claude "$@"
    ;;
  *)
    echo "쓰는 법: claude-as.sh work|personal [claude 옵션...]" >&2
    exit 2
    ;;
esac
