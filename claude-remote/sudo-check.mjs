/**
 * 비밀번호가 필요한 sudo 명령인지 판정(Claude Code 훅 pi-remote-hook.mjs 가 씀).
 * 판정 함수는 pi 확장과 같이 쓰는 sudo-rules.mjs 에 있다(설치본은 같은 폴더, 저장소에서는 pi-extension/lib/).
 * 여기서는 이 맥의 비밀번호 없는 sudo 규칙을 읽어(5분 기억) 그 함수에 넘긴다.
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = [join(HERE, "sudo-rules.mjs"), join(HERE, "../pi-extension/lib/sudo-rules.mjs")].find((p) => existsSync(p));
const { stripFileHeredocs, nopasswdRules, sudoCalls, needsSudoPassword } = await import(RULES);
export { stripFileHeredocs, nopasswdRules, sudoCalls, needsSudoPassword };

const CACHE = `${process.env.HOME}/.cache/pi-remote/sudo-rules.json`;
/** 이 맥에서 비밀번호 없이 되는 sudo 규칙. 5분 기억(훅은 부를 때마다 새로 뜨므로 파일에 둠) */
function loadRules() {
  try {
    const c = JSON.parse(readFileSync(CACHE, "utf8"));
    if (Date.now() - c.at < 300_000 && Array.isArray(c.rules)) return c.rules;
  } catch {
    /* 없거나 깨졌으면 새로 읽음 */
  }
  let out = "";
  try {
    out = execFileSync("sudo", ["-n", "-l"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    out = String(e?.stdout ?? "");
  }
  const rules = nopasswdRules(out);
  try {
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ at: Date.now(), rules }), { mode: 0o600 });
  } catch {
    /* 기억하지 못해도 판정은 됨 */
  }
  return rules;
}

/** 지금 이 맥에서 이 명령이 sudo 비밀번호를 물을지. 알 수 없으면 묻는다고 본다 */
export function sudoNeedsPassword(cmd) {
  if (!sudoCalls(cmd).length) return false;
  try {
    const which = (c) => {
      try {
        return execFileSync("/usr/bin/which", [c], { encoding: "utf8", timeout: 1000 }).trim();
      } catch {
        return c;
      }
    };
    return needsSudoPassword(cmd, loadRules(), which);
  } catch {
    return true;
  }
}
