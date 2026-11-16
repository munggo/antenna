/**
 * 읽기 전용 명령 판정(계획 모드·권한 모드 '매번 묻기'가 같이 씀)
 * 작성: 서문교
 */
// 읽기 명령(조각의 첫 단어)
const SAFE_HEADS = new Set([
  "cat", "head", "tail", "less", "more", "grep", "egrep", "rg", "fd", "find", "ls", "tree", "pwd", "echo", "printf", "wc", "sort",
  "uniq", "diff", "file", "stat", "du", "df", "which", "whereis", "type", "env", "printenv", "uname", "whoami", "id", "date", "cal",
  "uptime", "ps", "jq", "awk", "bat", "eza", "basename", "dirname", "realpath", "readlink", "cut", "tr", "column", "nl", "md5",
  "shasum", "cd", "true", "test", "[", "command", "sw_vers", "xcrun", "defaults", "plutil", "lsof", "otool", "strings", "hexdump", "xxd",
]);
const SAFE_SUB: RegExp[] = [
  /^git\s+(status|log|diff|show|branch(\s+(-a|-r|-v|--list|--show-current))*\s*$|remote(\s+-v)?\s*$|config\s+--get|ls-|rev-parse|blame|describe|shortlog|reflog\s*$|tag\s*$|tag\s+-l)/,
  /^(npm|pnpm|yarn)\s+(list|ls|view|info|why|outdated|audit)\b/,
  /^(node|python3?|ruby|go|cargo|swift|java)\s+(--version|-v|-V)\s*$/,
  /^sed\s+-n\b/,
  /^curl\s+(?!.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|-F\s|--form|-T\s|--upload))/i,
  /^gh\s+(pr|issue|run|repo|release)\s+(view|list|status|diff|checks)\b/,
  /^defaults\s+read\b/,
  /^xcodebuild\s+-(list|showsdks|version)\b/,
  /^tmux\s+(list-|display|show-|capture-pane)/,
  /^security\s+find-/,
];
// 어디에 있든 막는 것(파일에 쓰기·지우기·설치·권한 등)
const DESTRUCTIVE: RegExp[] = [
  /\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|chgrp|ln|truncate|dd|shred|install)\b/, /\btee\b/,
  /\bsudo\b/, /\b(kill|pkill|killall|reboot|shutdown|launchctl)\b/,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|clean|init|clone|am|apply)\b/,
  /\b(npm|pnpm|yarn|pip3?|brew|apt(-get)?|cargo|go)\s+(install|uninstall|add|remove|update|upgrade|ci|publish|link|get)\b/,
  /\bsed\s+(-i|--in-place)/, /\b(vim?|nano|emacs|code|subl|open)\b/,
];

/** 계획 모드에서 실행해도 되는 bash 명령인지(주석 줄은 빼고, 조각마다 읽기 명령이어야 함) */
export function isReadOnlyCommand(command: string): boolean {
  const body = String(command ?? "")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
    .replace(/\d?>\s*\/dev\/null/g, "")   // 출력 버리기는 괜찮음
    .replace(/2>&1/g, "");
  if (!body.trim()) return true;
  if (/(^|[^<>&])>{1,2}(?!&)/.test(body)) return false;   // 파일로 쓰기
  if (DESTRUCTIVE.some((re) => re.test(body))) return false;
  for (const seg of body.split(/&&|\|\||[;\n|]/)) {
    const t = seg.trim().replace(/^(\w+=\S*\s+)+/, "").replace(/^(time|command)\s+/, "");
    if (!t) continue;
    const head = t.split(/\s+/)[0].replace(/^.*\//, "");
    if (SAFE_HEADS.has(head) || SAFE_SUB.some((re) => re.test(t))) continue;
    return false;
  }
  return true;
}
