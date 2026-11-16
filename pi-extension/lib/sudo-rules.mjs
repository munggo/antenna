/**
 * 비밀번호가 필요한 sudo 명령인지 판정하는 함수들. pi 확장(send-guard.ts)과 Claude Code 훅(claude-remote/sudo-check.mjs)이 같이 쓴다.
 * 순수 함수만 둔다(이 맥의 sudo 규칙을 읽는 일은 쓰는 쪽이 한다). 시험: pi-extension/test/sudo-tab-cases.mjs
 * 설치: pi 는 ~/.pi/agent/extensions/lib/ 에(pi-extension/install.sh), Claude Code 는 ~/.claude/pi-remote/ 에(claude-remote/install.sh)
 * 작성: 서문교
 */

/** 파일에 적기만 하는 heredoc(cat·tee … <<EOF)의 본문은 실행되는 명령이 아니므로 뺀다 */
export function stripFileHeredocs(raw) {
  const out = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    const m = /\b(cat|tee)\b.*<<(-?)\s*(['"]?)([A-Za-z_][\w]*)\3/.exec(l);
    if (!m) continue;
    const rest = l.replace(/<<-?\s*['"]?[A-Za-z_][\w]*['"]?/, "");
    const toFile = m[1] === "tee" ? !/\|/.test(rest.split(/\btee\b/)[1] ?? "") : /(^|[^<])>>?\s*\S/.test(rest);
    const piped = /\|\s*(sudo\s+)?(sh|bash|zsh|dash|python[0-9.]*|node|deno|bun|ruby|perl|php|psql|mysql|sqlite3|osascript|curl|wget|nc|ssh|xargs|eval|source)\b/.test(rest);
    if (!toFile || piped) continue;
    const end = m[4];
    let j = i + 1;
    while (j < lines.length && (m[2] ? lines[j].trim() : lines[j]) !== end) j++;
    if (j >= lines.length) continue;   // 끝 표시가 없으면 그대로 검사
    out.push(lines[j]);
    i = j;
  }
  return out.join("\n");
}

/** `sudo -n -l` 출력에서 비밀번호 없이 되는 명령들(ALL 전체 허용 줄은 비밀번호가 필요하므로 뺌) */
export function nopasswdRules(listOut) {
  const rules = [];
  for (const line of listOut.split("\n")) {
    const m = /NOPASSWD:\s*(.+)$/.exec(line);
    if (!m) continue;
    for (const item of m[1].split(/,\s*/)) {
      const t = item.trim();
      if (!t || t === "ALL") continue;
      const sp = t.indexOf(" ");
      rules.push(sp < 0 ? { path: t, args: null } : { path: t.slice(0, sp), args: t.slice(sp + 1).trim() });   // args null: 인자 아무거나
    }
  }
  return rules;
}

/** 받은 글(따옴표 안의 글, heredoc 본문)을 셸 명령으로 실행하는 프로그램 */
const RUNS_SHELL = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "ssh", "eval", "source", ".", "su", "xargs", "watch", "parallel"]);
const runsShell = (text) => text.split(/[\s;|&()]+/).some((w) => RUNS_SHELL.has(w.split("/").pop()));

/**
 * heredoc 본문 가운데 셸이 명령으로 실행하지 않는 것(파일에 적기, 파이썬 같은 다른 프로그램의 입력, 화면에 내기)을 뺀다.
 * 본문은 글일 뿐인데 그 안의 'sudo …' 줄을 관리자 명령으로 보면, 필요 없는 비밀번호 확인 창이 뜬다.
 * 셸이 받아 실행하는 본문(bash <<EOF, ssh 호스트 <<EOF, cat <<EOF | sh)은 그대로 둔다
 */
function dropInertHeredocs(raw) {
  const out = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    const m = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(l);   // <<< (글 한 줄 넘기기)는 heredoc 이 아님
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && (m[1] ? lines[j].trim() : lines[j]) !== m[3]) j++;
    if (j >= lines.length) continue;                                  // 끝 표시가 없으면 그대로 검사
    if (runsShell(l.slice(0, m.index) + " " + l.slice(m.index + m[0].length))) continue;   // 셸이 실행하는 본문
    i = j;
  }
  return out.join("\n");
}

/**
 * 따옴표 밖의 구분자(&& || ; 줄바꿈 | ()에서만 나눈 조각들. 따옴표 안의 줄바꿈·구분자는 명령을 나누지 않는다
 * (커밋 글이나 echo 글 속의 'sudo …' 줄은 명령이 아님). plain 은 따옴표 안의 글을 뺀 조각, quoted 는 따옴표 안의 글
 */
function splitOutsideQuotes(s) {
  const segs = [];
  let text = "";
  let plain = "";
  let quoted = [];
  const flush = () => {
    segs.push({ text, plain, quoted });
    text = "";
    plain = "";
    quoted = [];
  };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "\\") {
      text += s.slice(i, i + 2);
      plain += s.slice(i, i + 2);
      i += 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += c === '"' && s[j] === "\\" ? 2 : 1;
      if (j >= s.length) {   // 닫히지 않은 따옴표는 글자로 본다(뒤의 명령을 놓치지 않게)
        text += c;
        plain += c;
        i++;
      } else {
        text += s.slice(i, j + 1);
        plain += " _ ";
        quoted.push({ double: c === '"', body: s.slice(i + 1, j) });
        i = j + 1;
      }
    } else if (c === ";" || c === "\n" || c === "|" || c === "(" || (c === "&" && s[i + 1] === "&")) {
      flush();
      i += c === "&" ? 2 : 1;
    } else {
      text += c;
      plain += c;
      i++;
    }
  }
  flush();
  return segs;
}

/** 명령 속 sudo 호출들: 실행할 명령과 인자(sudo 옵션은 건너뜀) */
export function sudoCalls(cmd) {
  const out = [];
  for (const { text, plain, quoted } of splitOutsideQuotes(dropInertHeredocs(cmd).replace(/\\\n/g, " "))) {
    const w = text.trim().split(/\s+/);
    const i = w.indexOf("sudo");
    if (i >= 0 && !w.slice(0, i).some((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && !/^(env|time|nohup|exec|command)$/.test(x))) {
      let j = i + 1;
      while (j < w.length && w[j].startsWith("-")) j += /^-[ugpCDhrt]$/.test(w[j]) ? 2 : 1;   // 값을 받는 옵션은 값까지
      if (j < w.length) out.push({ cmd: w[j], args: w.slice(j + 1).join(" ") });
    }
    // 따옴표 안의 글도 실행되는 경우: 셸에 넘기는 글(sh -c '…', ssh 호스트 '…')과 큰따옴표 안의 명령 치환
    const shell = runsShell(plain);
    for (const q of quoted) {
      if (shell) out.push(...sudoCalls(q.body));
      else if (q.double) for (const m of q.body.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) out.push(...sudoCalls(m[1] ?? m[2]));
    }
  }
  return out;
}

/** sudo 호출 중 하나라도 비밀번호 없이 허용되지 않으면 true */
export function needsSudoPassword(cmd, rules, which) {
  const calls = sudoCalls(cmd);
  if (!calls.length) return false;
  return calls.some(({ cmd: c, args }) => {
    const path = c.includes("/") ? c : which(c);
    return !rules.some((r) => {
      if (r.path !== path) return false;
      if (r.args === null) return true;
      const re = new RegExp(`^${r.args.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^ ]*")}$`);
      return re.test(args);
    });
  });
}
