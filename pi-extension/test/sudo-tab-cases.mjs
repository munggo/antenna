// 비밀번호가 필요한 sudo 판정 시험
const { nopasswdRules, sudoCalls, needsSudoPassword } = await import(process.env.GUARD_PATH);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const list = `User me may run the following commands on Mac:
    (ALL) ALL
    (ALL) NOPASSWD: /usr/bin/killall openvpn, /usr/local/bin/pi-remote-vpn-guard.sh
    (ALL) NOPASSWD: /usr/sbin/tcpdump, /sbin/pfctl
    (ALL) NOPASSWD: /bin/launchctl kickstart -k system/com.example.vpn, /bin/launchctl print system/*`;
const rules = nopasswdRules(list);
ok(rules.length === 6 && rules[0].path === "/usr/bin/killall" && rules[0].args === "openvpn" && rules[2].args === null, "sudo -l 출력 → 규칙 6개(ALL 줄은 뺌)");
const which = (c) => ({ killall: "/usr/bin/killall", pfctl: "/sbin/pfctl", launchctl: "/bin/launchctl", rm: "/bin/rm", tcpdump: "/usr/sbin/tcpdump", true: "/usr/bin/true" })[c] ?? c;
const need = (c) => needsSudoPassword(c, rules, which);
ok(JSON.stringify(sudoCalls("sudo -u root -E pfctl -s rules")) === '[{"cmd":"pfctl","args":"-s rules"}]', "sudo 옵션(값 받는 -u 포함) 건너뜀");
ok(sudoCalls("ls; echo sudo is fun").length === 0 && sudoCalls("cat > a <<'E'\nsudo rm -rf /\nE").length === 0, "sudo 가 명령 자리가 아니거나 파일에 적기만 하면 없음");
ok(!need("sudo killall openvpn") && !need("sudo pfctl -s rules") && !need("sudo /usr/sbin/tcpdump -i en0"), "허용된 명령(인자 일치·아무 인자)은 비밀번호 없음");
ok(need("sudo killall Finder"), "허용된 명령이라도 인자가 다르면 비밀번호");
ok(!need("sudo launchctl kickstart -k system/com.example.vpn") && need("sudo launchctl kickstart -k system/com.evil"), "launchctl: 정한 데몬만");
ok(!need("sudo launchctl print system/com.example.x") && need("sudo launchctl print system/a b"), "* 는 공백 없는 글자만");
ok(need("sudo rm -rf /tmp/x") && need("sudo -n true"), "목록에 없는 명령은 비밀번호");
ok(need("sudo pfctl -s rules && sudo rm x") && !need("echo hi"), "여러 sudo 중 하나라도 필요하면 비밀번호, sudo 없으면 아님");

// 글 속의 'sudo …' 는 명령이 아니다(필요 없는 비밀번호 확인 창이 뜨면 안 됨)
const n = (c) => sudoCalls(c).length;
const doc = "## 설치\n```bash\nsudo sh deploy/install-mac.sh\n```\n중지:\nsudo launchctl bootout system/x";
ok(n(`python3 - <<'EOF'\ns = '''${doc}'''\nopen("a.md", "w").write(s)\nEOF`) === 0, "파이썬에 넘기는 글 묶음 속의 sudo 줄은 명령이 아님");
ok(n(`node <<EOF\nconsole.log("x")\nsudo rm x\nEOF`) === 0 && n(`cat <<'EOF'\nsudo rm x\nEOF`) === 0 && n(`tee a.txt <<EOF\nsudo rm x\nEOF`) === 0, "노드 입력·화면에 내기·파일에 적기의 글 묶음도 명령이 아님");
ok(n(`git commit -m "문서: 설치 안내\n\nsudo sh deploy/install-mac.sh 로 설치"`) === 0, "여러 줄 커밋 글 속의 sudo 줄은 명령이 아님");
ok(n(`echo 'sudo rm x'`) === 0 && n(`printf '%s\\n' "a\nsudo rm x\nb" >> notes.md`) === 0 && n(`echo "use bash; sudo x"`) === 0, "따옴표 안의 글은 명령이 아님(글에 bash 가 들어 있어도)");
ok(n(`python3 -c 'import os\nprint("sudo rm x")'`) === 0 && n(`grep -n "^sudo " a.md; ls`) === 0, "다른 프로그램에 넘기는 따옴표 글·찾는 글도 아님");
// 셸이 받아 실행하는 글은 그대로 본다
ok(n(`bash <<'E'\nsudo rm x\nE`) === 1 && n(`cat <<'E' | sh\nsudo rm x\nE`) === 1 && n(`ssh host <<E\nsudo reboot\nE`) === 1, "셸에 넘기는 글 묶음 속의 sudo 는 명령");
ok(n(`bash -c 'cd /x && sudo make install'`) === 1 && n(`ssh host "sudo reboot"`) === 1 && n(`/bin/zsh -lc "ls; sudo rm x"`) === 1, "sh -c·ssh 에 넘기는 따옴표 글 속의 sudo 는 명령");
ok(n(`echo "$(sudo cat /etc/x)"`) === 1 && n("echo \"`sudo cat /etc/x`\"") === 1 && n(`echo '$(sudo cat /etc/x)'`) === 0, "큰따옴표 안의 명령 치환은 실행됨(작은따옴표 안은 글)");
ok(n(`echo "a"; sudo rm x`) === 1 && n(`echo don't\nsudo rm x`) === 1 && n(`cat > a <<'E' && sudo rm x\n글\nE`) === 1, "따옴표·글 묶음 뒤의 진짜 sudo 는 놓치지 않음(닫히지 않은 따옴표 포함)");
ok(JSON.stringify(sudoCalls(`sudo \\\n  rm -rf "/tmp/a b"`)) === '[{"cmd":"rm","args":"-rf \\"/tmp/a b\\""}]', "줄을 이어 쓴 sudo, 인자의 따옴표는 그대로");
ok(n(`x=1 <<< "sudo rm x"; echo $((1 << 3))`) === 0 && n(`cat <<EOF\nsudo rm x`) === 1, "글 한 줄 넘기기(<<<)·자리 옮김 연산은 글 묶음이 아님, 끝 표시가 없는 글 묶음은 그대로 검사");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
