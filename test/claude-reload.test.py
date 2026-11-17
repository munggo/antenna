#!/usr/bin/env python3
"""업데이트 뒤 자동 다시 켜기(deploy/claude-reload.py)의 화면 판정 시험: 그냥 끄면 안 되는 것이 화면에 보이는지.

Claude Code 를 띄우지 않고 판정 함수(screen_background)만 본다. 화면 모양은 2026-11-17 에 실제 화면에서 본 것이고 글은 지어낸 것.
실행: python3 test/claude-reload.test.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("claude_reload", os.path.join(HERE, "..", "deploy", "claude-reload.py"))
reload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reload)

RULE = "─" * 60
STATUS = "  ~/works/game [main] Opus 5.5 (xhigh) · 개인 186K/1000K 18.7% 주 6% ▂▂▂▅█▂▂"


def screen(mode, *below, above="⏺ 답"):
    """입력창·상태 줄·모드 줄과 그 아래에 붙는 줄들 → 빈 줄을 뺀 줄 목록(스크립트가 화면을 읽는 모양)"""
    text = "\n".join([above, RULE, "❯ ", RULE, STATUS, f"  {mode}", "", *below])
    return [l for l in text.splitlines() if l.strip()]


def agent(kind, what, took):
    return f"  ◯ {kind}  {what}{' ' * 40}{took} · ↓ 53.1k tokens"


FIVE = [agent("general-purpose", f"자료 {i} 찾는 중", "7m 30s") for i in range(1, 6)]
CASES = [
    (screen("⏵⏵ auto mode on · 1 shell · ↓ to manage"), "1 shell", "모드 줄의 뒤에서 도는 셸"),
    (screen("⏸ manual mode on · 1 feedback draft"), "1 feedback draft", "보내지 않은 피드백 초안"),
    (screen("⏵⏵ auto mode on (shift+tab to cycle)"), None, "아무것도 없음"),
    (screen("⏵⏵ auto mode on (shift+tab to cycle) · ⧉ 14"), None, "숫자만 있는 다른 표시(⧉)는 아님"),
    (screen("⏵⏵ auto mode on · /tasks to see subagents"), None, "하위 에이전트가 끝난 뒤 남는 안내 글은 아님"),
    # 하위 에이전트 목록: 고치기 전에는 맨 아래 두 줄이 목록 줄이라 아무것도 없는 것으로 보고 껐다
    (screen("⏵⏵ auto mode on (shift+tab to cycle) · ⧉ today", "  ⏺ main", *FIVE, "  ↓ 3 more", above="✻ Waiting for 8 background agents to finish"),
     "8 agents", "쉬면서 하위 에이전트 여덟을 기다림(목록 다섯 줄 + 아래로 접힌 셋)"),
    (screen("⏵⏵ auto mode on · 1 shell · 2 feedback drafts", "  ⏺ main", agent("general-purpose", "화면 살피는 중", "4s"), agent("Explore", "파일 찾는 중", "3s")),
     "1 shell", "목록이 붙어 있어도 모드 줄의 셸을 찾음"),
    (screen("⏵⏵ auto mode on", "  ⏺ main", agent("general-purpose", "화면 살피는 중", "4s")), "1 agent", "하위 에이전트 하나"),
    (screen("⏵⏵ auto mode on", "  ◯ main", "  ⏺ Explore  파일 찾는 중      12s · ↓ 9.1k tokens"), "1 agent", "목록에서 하위 에이전트를 고른 모양(기호가 바뀜)"),
    (screen("⏵⏵ auto mode on · /tasks to see subagents", "  ⏺ main"), None, "마지막 하위 에이전트가 막 끝나 이 대화만 남은 목록"),
    (screen("⏵⏵ auto mode on", "  ↑ 2 more", agent("general-purpose", "자료 찾는 중", "1m 2s"), "  ↓ 1 more"), "2 agents", "위로 접힌 것은 세지 않고 아래로 접힌 것만 더함"),
    # 목록이 아닌 것
    (["⏺ 첫째 답", "⏺ 둘째 답"], None, "모드 줄 없이 '⏺' 줄로 끝나는 화면은 목록이 아님"),
    (screen("⏵⏵ auto mode on", "  Teach auto mode about your environment?", "  ❯ 1. Yes", "    2. Not now", "  Enter to confirm · Esc to cancel"), None,
     "모드 줄 아래 안내 창은 목록이 아님"),
    ([], None, "빈 화면"),
]

bad = 0
for lines, want, name in CASES:
    got = reload.screen_background(lines)
    if got != want:
        bad += 1
        print(f"틀림: {name} → {got!r} (바라는 값 {want!r})")
print(f"전체 {len(CASES)}개 중 틀림 {bad}개")
sys.exit(1 if bad else 0)
