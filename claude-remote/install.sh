#!/bin/sh
# Claude Code 를 pi-remote 앱에 잇기: 피드·훅 파일을 ~/.claude/pi-remote/ 에 두고, Claude Code 설정에 훅을 더한다.
# - 기존 훅(iTerm2 탭 색 등)은 그대로, 여러 번 실행해도 한 번만 들어감. 고치기 전 설정 백업
# - 빼기: sh install.sh --remove
# 작성: 서문교
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/pi-remote"
SETTINGS="$HOME/.claude/settings.json"
# 훅·연결부를 돌릴 node: 밖에서 정해 주면(PI_REMOTE_NODE, sh install.sh 가 넘김) 그것, 아니면 PATH 의 node
NODE="${PI_REMOTE_NODE:-$(command -v node || true)}"
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "node 를 찾지 못했어요" >&2; exit 1; }
# Claude Code 를 깔고 아직 설정 파일이 없는 맥: 빈 설정을 만들어 훅을 넣는다
if [ ! -f "$SETTINGS" ]; then
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
fi

if [ "${1:-}" != "--remove" ]; then
  mkdir -p "$DEST"
  cp "$HERE/claude-feed.mjs" "$HERE/pi-remote-hook.mjs" "$HERE/claude-account.mjs" "$HERE/artifact-relay.mjs" "$HERE/bg-launch.mjs" "$HERE/sudo-check.mjs" "$HERE/sudo-run.mjs" "$HERE/claude-as.sh" \
    "$HERE/password-run.mjs" "$HERE/password-tab.sh" "$HERE/secret-clip.js" "$HERE/login-dir.mjs" "$DEST/"
  # 계정을 바꿔 다시 켤 때 연결부가 셸에 치는 실행 파일(정한 계정으로 claude 를 켬)
  chmod +x "$DEST/claude-as.sh"
  # 관리자 권한(sudo) 탭 화면과 판정 함수는 pi 확장과 같은 것을 씀
  cp "$HERE/../pi-extension/sudo-tab.sh" "$HERE/../pi-extension/lib/sudo-rules.mjs" "$DEST/"
  # 셸 함수 claude() 가 켤 때 부르는 계정 고르기(노드 경로를 박아 둠: 셸의 node 는 nvm 을 늦게 불러와 0.8초 걸림)
  printf '#!/bin/sh\nexec "%s" "%s/claude-account.mjs" "$@"\n' "$NODE" "$DEST" > "$DEST/claude-account"
  chmod +x "$DEST/claude-account"
  # 추가 계정을 직접 로그인으로 쓰는 설정 폴더 도구(claude-as.sh 가 켤 때마다 바로가기를 맞추려고 부른다. 같은 까닭으로 노드 경로를 박아 둠)
  printf '#!/bin/sh\nexec "%s" "%s/login-dir.mjs" "$@"\n' "$NODE" "$DEST" > "$DEST/login-dir"
  chmod +x "$DEST/login-dir"
  # 백그라운드 탭 명령: '/bgtab <할 일>' 은 훅(pi-remote-hook.mjs)이 가로채 새 탭을 엶. 이 파일은 명령 이름·설명용
  # (훅이 없으면 아래 글이 AI 에 가서 열지 못했다고만 알림)
  mkdir -p "$HOME/.claude/commands"
  cat > "$HOME/.claude/commands/bgtab.md" <<'MDEOF'
---
description: 새 tmux 탭에서 백그라운드로 실행(끝나면 폰 알림, 이 탭에 결과 요약)
argument-hint: <할 일>
---
The /bgtab hook (pi-remote) did not run, so no background tab was opened. Tell the user in one short Korean sentence that the background tab could not be started, and do nothing else.
MDEOF
  echo "설치: $DEST/{claude-feed.mjs,pi-remote-hook.mjs,claude-account.mjs,artifact-relay.mjs,bg-launch.mjs,sudo-check.mjs,sudo-run.mjs,claude-as.sh,password-run.mjs,password-tab.sh,secret-clip.js,sudo-tab.sh}, ~/.claude/commands/bgtab.md"
else
  rm -f "$HOME/.claude/commands/bgtab.md"
fi
cp "$SETTINGS" "$SETTINGS.bak-pi-remote" && chmod 600 "$SETTINGS.bak-pi-remote"

/usr/bin/python3 - "$SETTINGS" "$NODE" "$DEST/pi-remote-hook.mjs" "${1:-}" "$DEST/artifact-relay.mjs" <<'PYEOF'
import json, sys
path, node, hook, mode, relay = sys.argv[1:6]
s = json.load(open(path))
hooks = s.setdefault("hooks", {})
cmd = f'"{node}" "{hook}"'
EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification", "Stop"]
changed = 0
for ev in EVENTS:
    groups = hooks.setdefault(ev, [])
    # 우리 훅(pi-remote-hook.mjs)은 먼저 모두 뺌 → 설치면 다시 하나만 넣음(노드 경로가 바뀌어도 하나만)
    for g in groups:
        before = len(g.get("hooks", []))
        g["hooks"] = [h for h in g.get("hooks", []) if "pi-remote-hook.mjs" not in h.get("command", "")]
        changed += before - len(g["hooks"])
    groups[:] = [g for g in groups if g.get("hooks")]
    if mode != "--remove":
        groups.append({"matcher": "", "hooks": [{"type": "command", "command": cmd, "timeout": 5}]})
        changed += 1
    if not groups:
        del hooks[ev]
# 아티팩트는 폴더 기준 계정에(artifact-relay.mjs): 지금 계정이 폴더 계정과 다르면 폴더 계정으로 대신 실행. 대신 실행이 몇 초~수십 초라 시간을 넉넉히
pre = hooks.setdefault("PreToolUse", [])
for g in pre:
    g["hooks"] = [h for h in g.get("hooks", []) if "artifact-relay.mjs" not in h.get("command", "")]
pre[:] = [g for g in pre if g.get("hooks")]
if mode != "--remove":
    pre.append({"matcher": "Artifact|ArtifactComments|ArtifactData", "hooks": [{"type": "command", "command": f'"{node}" "{relay}"', "timeout": 300}]})
if not pre:
    del hooks["PreToolUse"]
json.dump(s, open(path, "w"), ensure_ascii=False, indent=2)
open(path, "a").write("\n")
print(("뺌" if mode == "--remove" else "훅 설정") + f": {', '.join(EVENTS)}")
PYEOF
