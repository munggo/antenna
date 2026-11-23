#!/bin/sh
# 알림 중계(relay/index.mjs)를 AWS 에 올린다: Lambda 함수 + 함수 주소(누구나 부를 수 있음) + Parameter Store 의 Apple 푸시 키(암호화 값).
# 여러 번 돌려도 같은 결과(없으면 만들고, 있으면 코드·설정만 바꿈). 끝에 함수 주소를 찍는다(브리지의 PI_REMOTE_PUSH_RELAY 기본값).
# 쓰기:
#   sh relay/deploy.sh                                              코드만 다시 올림
#   sh relay/deploy.sh --key <AuthKey_XXXX.p8> --key-id <키 번호> --team <팀 번호>   푸시 키를 올리거나 바꿈(중계 전용 키)
# 계정: AWS 프로필 RELAY_AWS_PROFILE(기본 personal), 지역 RELAY_AWS_REGION(기본 ap-northeast-2 서울)
# 남용 막기: 함수 동시 실행을 5개로 묶는다(알림 모양은 함수가 만들어 보낼 수 있는 것은 정해져 있음. relay/index.mjs 머리말)
# 작성: 서문교
set -e
PROFILE="${RELAY_AWS_PROFILE:-personal}"
REGION="${RELAY_AWS_REGION:-ap-northeast-2}"
FN=antenna-push-relay
ROLE=antenna-push-relay-role
PARAM=/antenna/push-relay/apns-key
TOPIC="${RELAY_APNS_TOPIC:-com.munggo.piremote}"
KEY="" KEY_ID="" TEAM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --key-id) KEY_ID="$2"; shift 2 ;;
    --team) TEAM="$2"; shift 2 ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done
a() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
ACCOUNT=$(a sts get-caller-identity --query Account --output text)
echo "계정 $ACCOUNT · 지역 $REGION"

# 1) 푸시 키(.p8)를 암호화 값으로(기본 aws/ssm 키, 무료). 내용은 명령줄에 싣지 않고 파일로 넘김
if [ -n "$KEY" ]; then
  [ -f "$KEY" ] && [ -n "$KEY_ID" ] && [ -n "$TEAM" ] || { echo "--key 파일·--key-id·--team 을 함께 주세요" >&2; exit 2; }
  a ssm put-parameter --name "$PARAM" --type SecureString --overwrite --value "file://$KEY" >/dev/null
  echo "푸시 키 올림: $PARAM (키 번호 $KEY_ID)"
fi

# 2) 실행 역할: 기록 남기기 + 그 키 하나 읽기
if ! a iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  a iam create-role --role-name "$ROLE" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  a iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "실행 역할 만듦: $ROLE"
fi
a iam put-role-policy --role-name "$ROLE" --policy-name read-apns-key --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameter\",\"Resource\":\"arn:aws:ssm:$REGION:$ACCOUNT:parameter$PARAM\"}]}"

# 3) 함수 코드
ZIP=$(mktemp -d)/relay.zip
(cd "$(dirname "$0")" && zip -q "$ZIP" index.mjs)
env_json() {
  # 키 번호·팀은 주면 바꾸고, 안 주면 지금 값을 그대로
  cur=$(a lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables' --output json 2>/dev/null || echo '{}')
  node -e 'const c=JSON.parse(process.argv[1]||"{}")||{};const [id,team,topic,param]=process.argv.slice(2);
    console.log(JSON.stringify({Variables:{APNS_KEY_ID:id||c.APNS_KEY_ID||"",APNS_TEAM:team||c.APNS_TEAM||"",APNS_TOPIC:topic,APNS_KEY_PARAM:param}}))' \
    "$cur" "$KEY_ID" "$TEAM" "$TOPIC" "$PARAM"
}
if a lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  a lambda update-function-code --function-name "$FN" --zip-file "fileb://$ZIP" >/dev/null
  a lambda wait function-updated-v2 --function-name "$FN"
  a lambda update-function-configuration --function-name "$FN" --environment "$(env_json)" >/dev/null
  a lambda wait function-updated-v2 --function-name "$FN"
  echo "함수 코드·설정 바꿈: $FN"
else
  ENV=$(env_json)
  # 막 만든 역할은 몇 초 뒤에야 쓸 수 있어 몇 번 다시 해 봄
  for i in 1 2 3 4 5 6; do
    if a lambda create-function --function-name "$FN" --runtime nodejs22.x --architectures arm64 --handler index.handler \
      --role "arn:aws:iam::$ACCOUNT:role/$ROLE" --zip-file "fileb://$ZIP" --timeout 15 --memory-size 128 \
      --environment "$ENV" >/dev/null 2>&1; then break; fi
    [ "$i" = 6 ] && { echo "함수를 만들지 못했어요" >&2; exit 1; }
    sleep 10
  done
  a lambda wait function-active-v2 --function-name "$FN"
  echo "함수 만듦: $FN"
fi
rm -rf "$(dirname "$ZIP")"
a lambda put-function-concurrency --function-name "$FN" --reserved-concurrent-executions 5 >/dev/null

# 4) 함수 주소(인증 없음: 브리지가 부름)
if ! URL=$(a lambda get-function-url-config --function-name "$FN" --query FunctionUrl --output text 2>/dev/null); then
  URL=$(a lambda create-function-url-config --function-name "$FN" --auth-type NONE --query FunctionUrl --output text)
  a lambda add-permission --function-name "$FN" --statement-id public-url --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null
  # 2025-10 부터 새 함수 주소는 이 권한(함수 주소로 부를 때만)도 있어야 부를 수 있다(없으면 403)
  if ! a lambda add-permission --function-name "$FN" --statement-id public-url-invoke --action lambda:InvokeFunction \
    --principal '*' --invoked-via-function-url >/dev/null 2>&1; then
    echo "주의: AWS 명령 도구가 옛 버전이라 'InvokeFunction(함수 주소로 부를 때만)' 권한을 넣지 못했어요." >&2
    echo "      도구를 새 버전으로 올린 뒤 위 add-permission 줄만 다시 하세요(안 하면 함수 주소가 403)" >&2
  fi
  echo "함수 주소 만듦"
fi
echo "중계 주소: $URL"
