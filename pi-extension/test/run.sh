#!/bin/sh
# send-guard 판정 시험 실행: 임시 폴더에 확장 사본과 typebox 연결을 두고 시험 자료를 돌린다
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PKG=$(dirname "$(command -v node)")/../lib/node_modules/@earendil-works/pi-coding-agent
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/node_modules"
mkdir -p "$TMP/node_modules/@earendil-works"
ln -s "$PKG/node_modules/@earendil-works/pi-tui" "$TMP/node_modules/@earendil-works/pi-tui"
mkdir -p "$TMP/lib" && cp "$HERE/../lib/"*.ts "$HERE/../lib/"*.mjs "$TMP/lib/"
cp "$HERE/../send-guard.ts" "$TMP/send-guard.ts"
ln -s "$PKG/node_modules/typebox" "$TMP/node_modules/typebox"
GUARD_PATH="$TMP/send-guard.ts" node --experimental-strip-types --no-warnings "$HERE/send-guard-cases.mjs"
GUARD_PATH="$TMP/send-guard.ts" node --experimental-strip-types --no-warnings "$HERE/send-guard-context-cases.mjs"
GUARD_PATH="$TMP/send-guard.ts" node --experimental-strip-types --no-warnings "$HERE/sudo-tab-cases.mjs"
cp "$HERE/../ask-user.ts" "$TMP/ask-user.ts"
ASK_PATH="$TMP/ask-user.ts" node --experimental-strip-types --no-warnings "$HERE/ask-user-cases.mjs"
CHOICE_PATH="$TMP/lib/choice-box.ts" ASK_PATH="$TMP/ask-user.ts" node --experimental-strip-types --no-warnings "$HERE/choice-box-cases.mjs"
cp "$HERE/../compact-tools.ts" "$HERE/compact-tools-cases.mjs" "$TMP/"
(cd "$TMP" && CT_PATH="$TMP/compact-tools.ts" node --experimental-strip-types --no-warnings compact-tools-cases.mjs)
ln -s "$PKG/node_modules/@earendil-works/pi-ai" "$TMP/node_modules/@earendil-works/pi-ai"
cp "$HERE/../claude-accounts.ts" "$TMP/claude-accounts.ts"
ACC_PATH="$TMP/claude-accounts.ts" node --experimental-strip-types --no-warnings "$HERE/claude-accounts-cases.mjs"
ACC_PATH="$TMP/claude-accounts.ts" node --experimental-strip-types --no-warnings "$HERE/../../claude-remote/test/account-cases.mjs"
cp "$HERE/../artifacts.ts" "$TMP/artifacts.ts"
ART_PATH="$TMP/artifacts.ts" node --experimental-strip-types --no-warnings "$HERE/artifacts-cases.mjs"
cp "$HERE/../todos.ts" "$TMP/todos.ts"
TODO_PATH="$TMP/todos.ts" node --experimental-strip-types --no-warnings "$HERE/todos-cases.mjs"
cp "$HERE/../plan-mode.ts" "$TMP/plan-mode.ts"
PLAN_PATH="$TMP/plan-mode.ts" node --experimental-strip-types --no-warnings "$HERE/plan-mode-cases.mjs"
# 폰 글이 영어일 때(분류 이름·카드 항목·계획 확인 창)
PI_REMOTE_LANG=en GUARD_PATH="$TMP/send-guard.ts" PLAN_PATH="$TMP/plan-mode.ts" node --experimental-strip-types --no-warnings "$HERE/lang-en-cases.mjs"
cp "$HERE/../web.ts" "$TMP/web.ts"
WEB_PATH="$TMP/web.ts" node --experimental-strip-types --no-warnings "$HERE/web-cases.mjs"
