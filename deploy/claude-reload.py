#!/usr/bin/env python3
"""업데이트 뒤, 옛 버전으로 도는 Claude 세션 가운데 쉬는 것만 같은 대화로 다시 켠다.

새벽 업데이트(claude-auto-update.sh)가 부르고, 낮에는 launchd(com.munggo.claude-reload)가 30분마다 --once 로 부른다
(Claude Code 가 낮에 스스로 받은 업데이트는 'Update installed · /restart to apply' 만 띄우고 그대로 돌기 때문).

Claude Code가 세션마다 남기는 ~/.claude/sessions/<프로세스 번호>.json 을 읽는다.
다시 켜는 조건(모두 맞아야 함):
  1. tmux 창 안에서 도는 대화형 세션
  2. 지금 설치된 버전과 다른 버전으로 도는 중
  3. 상태가 idle 이고 그 뒤로 --idle 초가 지남(기본 10분)
  4. 입력창이 비어 있음(쓰다 만 글이 있으면 건드리지 않음)
  5. 그냥 끄면 안 되는 것이 없음: 뒤에서 도는 작업(실행 중인 명령, 화면 맨 아랫줄의 '· 1 shell' 같은 표시)과
     보내지 않은 피드백 초안('· 1 feedback draft'. /exit 가 보낼지 버릴지 묻는 화면에서 멈춘다)
방법: 그 창에 /exit → 셸로 돌아오면 `cd <폴더> && claude --resume <대화 번호>` 입력.
셸의 claude 함수를 거치므로 폴더별 계정(회사·개인)도 그대로 적용된다.
"""
import argparse
import fcntl
import glob
import json
import os
import re
import shlex
import socket
import subprocess
import time
from datetime import datetime

SESSIONS = os.path.expanduser("~/.claude/sessions")
CLAUDE = os.path.expanduser("~/.local/bin/claude")
SHELLS = {"zsh", "-zsh", "bash", "-bash", "sh", "fish"}
KEEP_FLAGS = {"--model", "--permission-mode", "--add-dir"}  # 값을 받는 옵션 중 다시 켤 때 이어 줄 것
KEEP_SWITCHES = {"--dangerously-skip-permissions"}
ESC = re.compile(r"\x1b\[[0-9;]*m")
# 화면 맨 아랫줄의 표시('· 1 shell', '· 2 agents', '· 1 feedback draft' …). 이런 것이 있으면 /exit 로 그냥 끝나지 않는다:
# 뒤 작업은 끊기고, 보내지 않은 피드백 초안이 있으면 '보낼지 버릴지' 묻는 화면에서 멈춘다(2026-11-13 낮에 실제로 한 세션이 멈췄음).
# 모르는 항목도 건드리지 않는다(안전한 쪽)
BACKGROUND = re.compile(r"·\s*(\d+\s+[A-Za-z]+(?:\s+drafts?)?)")
LOCK = os.path.expanduser("~/.cache/claude-auto-update/reload.lock")


def log(msg):
    print(f"{datetime.now():%F %T} {msg}", flush=True)


def run(*args):
    return subprocess.run(args, capture_output=True, text=True)


def installed_version():
    m = re.search(r"\d+\.\d+\.\d+", run(CLAUDE, "--version").stdout)
    return m.group(0) if m else None


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def tty_of(pid):
    return "/dev/" + run("ps", "-o", "tty=", "-p", str(pid)).stdout.strip()


def pane_info(pane):
    """(패널 tty, 지금 앞에서 도는 명령) — 패널이 없으면 None"""
    r = run("tmux", "display", "-p", "-t", pane, "#{pane_tty}\t#{pane_current_command}")
    if r.returncode != 0 or "\t" not in r.stdout:
        return None
    return tuple(r.stdout.rstrip("\n").split("\t", 1))


def input_empty(pane):
    """가로줄 바로 아래 마지막 ❯ 줄이 비었거나 흐린 안내 문구뿐이면 빈 입력창"""
    lines = run("tmux", "capture-pane", "-p", "-e", "-t", pane).stdout.splitlines()
    plain = [ESC.sub("", l) for l in lines]
    for i in range(len(lines) - 1, 0, -1):
        if plain[i].startswith("❯") and plain[i - 1].strip().startswith("─"):
            rest = lines[i].split("❯", 1)[1].lstrip("\xa0 ")
            return rest.startswith("\x1b[2m") or ESC.sub("", rest).strip() == ""
    return False  # 입력창을 못 찾으면 건드리지 않음


def background_work(pid, pane):
    """그냥 끄면 안 되는 것(뒤에서 도는 작업, 보내지 않은 초안)이 있으면 무엇인지(없으면 None)"""
    # 실행 중인 명령: Claude Code 가 명령을 돌릴 때 띄우는 셸은 shell-snapshots 파일을 읽어 들인다
    for kid in run("pgrep", "-P", str(pid)).stdout.split():
        if "shell-snapshots/" in run("ps", "-o", "command=", "-p", kid).stdout:
            return "명령 실행 중"
    # 화면 표시: 하위 에이전트처럼 프로세스로 드러나지 않는 것
    lines = [ESC.sub("", l) for l in run("tmux", "capture-pane", "-p", "-t", pane).stdout.splitlines() if l.strip()]
    for line in lines[-2:]:
        m = BACKGROUND.search(line)
        if m:
            return f"화면 표시 '{m.group(1)}'"
    return None


def resume_command(pid, cwd, session_id):
    """원래 실행 옵션 중 모델·권한 관련만 이어서 같은 대화를 여는 명령"""
    args = run("ps", "-o", "command=", "-p", str(pid)).stdout.split()[1:]
    keep = []
    for i, a in enumerate(args):
        if a in KEEP_SWITCHES:
            keep.append(a)
        elif a in KEEP_FLAGS and i + 1 < len(args):
            keep += [a, args[i + 1]]
    return " ".join(["cd", shlex.quote(cwd), "&&", "claude", *map(shlex.quote, keep), "--resume", session_id])


def send(pane, text):
    run("tmux", "send-keys", "-t", pane, "-l", text)
    time.sleep(0.5)
    run("tmux", "send-keys", "-t", pane, "Enter")


def tell_phone(pane, title, body):
    """폰 알림(브리지 알림 소켓). 브리지가 없으면 그냥 넘어감"""
    r = run("tmux", "display", "-p", "-t", pane, "#{session_name}:::#{window_index}")
    if r.returncode != 0 or ":::" not in r.stdout:
        return
    session, index = r.stdout.strip().split(":::")
    path = os.path.expanduser(f"~/.cache/pi-remote/notify-{session}.sock")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2)
            s.connect(path)
            s.sendall((json.dumps({"kind": "prompt", "title": title, "body": body, "window": int(index)}, ensure_ascii=False) + "\n").encode())
    except (OSError, ValueError):
        pass


def reload(d, pane, dry):
    pid, cwd, sid = d["pid"], d["cwd"], d["sessionId"]
    cmd = resume_command(pid, cwd, sid)
    if dry:
        log(f"[미리 보기] 다시 켤 창 {pane}: {cmd}")
        return True
    send(pane, "/exit")
    for _ in range(60):  # 최대 30초 기다림
        info = pane_info(pane)
        if not alive(pid) and info and info[1] in SHELLS:
            break
        time.sleep(0.5)
    else:
        # 종료를 되묻는 화면 등에서 멈춘 것: 그 화면에 무엇을 누를지는 사람이 정해야 하므로 더 건드리지 않고 폰에 알린다
        log(f"창 {pane}: 30초 안에 셸로 돌아오지 않아 멈춤(프로세스 {pid})")
        tell_phone(pane, "Claude Code 다시 켜기가 멈췄어요", f"{os.path.basename(cwd)} 탭이 끝내기 전 확인 화면에서 기다리고 있어요")
        return False
    time.sleep(1)
    send(pane, cmd)
    log(f"창 {pane}: 다시 켬 → {cmd}")
    return True


def check(a, target):
    """한 번 둘러보고 아직 기다릴 세션 수를 돌려준다"""
    waiting = 0
    for f in sorted(glob.glob(os.path.join(SESSIONS, "*.json"))):
        try:
            with open(f) as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            continue
        pid = d.get("pid")
        pane = (d.get("tmux") or "").rpartition(".")[2]
        if not pid or not alive(pid) or d.get("kind") != "interactive" or not pane.startswith("%"):
            continue
        if a.pane and pane != a.pane:
            continue
        name = f"창 {pane}({d.get('cwd')})"
        if d.get("version") == target and not a.ignore_version:
            continue
        info = pane_info(pane)
        if not info or info[0] != tty_of(pid):
            log(f"{name}: tmux 창과 프로세스가 맞지 않아 건너뜀")
            continue
        since = time.time() - (d.get("statusUpdatedAt") or d.get("updatedAt") or 0) / 1000
        if d.get("status") != "idle" or since < a.idle:
            log(f"{name}: 기다림(상태 {d.get('status')}, {int(since // 60)}분째)")
            waiting += 1
        elif not input_empty(pane):
            log(f"{name}: 기다림(입력창에 쓰다 만 글 있음)")
            waiting += 1
        else:
            bg = background_work(pid, pane)
            if bg:
                log(f"{name}: 기다림(그냥 끄면 안 됨: {bg})")
                waiting += 1
            elif not reload(d, pane, a.dry_run):
                waiting += 1
    return waiting


def main():
    p = argparse.ArgumentParser(description="옛 버전으로 도는 쉬는 Claude 세션을 같은 대화로 다시 켠다")
    p.add_argument("--idle", type=int, default=600, help="쉰 지 이 초가 지나야 다시 켬(기본 600)")
    p.add_argument("--every", type=int, default=600, help="기다릴 세션이 있으면 이 초마다 다시 확인(기본 600)")
    p.add_argument("--until", default="09:00", help="이 시각까지만 다시 확인(기본 09:00)")
    p.add_argument("--once", action="store_true", help="한 번만 확인")
    p.add_argument("--dry-run", action="store_true", help="무엇을 할지 기록만 남김")
    p.add_argument("--quiet", action="store_true", help="시작·끝 줄을 남기지 않음(낮에 30분마다 부를 때)")
    p.add_argument("--pane", help="시험용: 이 tmux 패널(%%번호)만 다룸")
    p.add_argument("--ignore-version", action="store_true", help="시험용: 버전이 같아도 대상으로 봄")
    a = p.parse_args()

    # 한 번에 하나만: 새벽 확인이 기다리며 도는 동안 낮 확인이 같은 세션을 함께 건드리지 않게
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        if not a.quiet:
            log("다른 확인이 도는 중이라 건너뜀")
        return
    target = installed_version()
    if not target:
        log("설치된 claude 버전을 읽지 못해 멈춤")
        return
    hh, mm = map(int, a.until.split(":"))
    end = datetime.now().replace(hour=hh, minute=mm, second=0, microsecond=0)
    if not a.quiet:
        log(f"세션 확인 시작(설치된 버전 {target})")
    while True:
        waiting = check(a, target)
        if a.once or waiting == 0 or datetime.now() >= end:
            break
        time.sleep(a.every)
    if not a.quiet:
        log(f"세션 확인 끝(남은 세션 {waiting}개)")


if __name__ == "__main__":
    main()
