/**
 * 맥이 폰에 보내는 글의 언어(ko | en). 브리지·Claude Code 연결부·pi 확장이 함께 쓴다
 * (설치본은 ~/.claude/pi-remote/lang.mjs 와 ~/.pi/agent/extensions/lib/lang.mjs, 저장소에서는 이 파일).
 * 정하는 차례: 환경 변수 PI_REMOTE_LANG → 설정 파일(~/.config/pi-remote/env, PI_REMOTE_ENV 로 바꿀 수 있음)의 PI_REMOTE_LANG
 *   → macOS 첫 언어(defaults read -g AppleLanguages)가 ko 로 시작하면 ko, 아니면 en. 읽지 못하면 ko(예전과 같게).
 * 맥의 기록·주석·터미널 안내는 한국어 그대로다. 폰에 보이는 글만 tr("한국어", "English") 로 고른다.
 * 작성: 서문교
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pick = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s.startsWith("ko") ? "ko" : s.startsWith("en") ? "en" : "";
};

function fromEnvFile() {
  try {
    const file = process.env.PI_REMOTE_ENV || `${process.env.HOME}/.config/pi-remote/env`;
    const m = readFileSync(file, "utf8").match(/^[ \t]*(?:export[ \t]+)?PI_REMOTE_LANG[ \t]*=[ \t]*["']?([A-Za-z_-]+)/m);
    return m ? pick(m[1]) : "";
  } catch {
    return "";
  }
}

/** macOS 첫 언어로 고른 값(ko | en). install.sh 가 설정 파일에 처음 적을 때도 쓴다 */
export function macLang() {
  try {
    const out = execFileSync("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    const first = out.match(/[A-Za-z][A-Za-z_-]*/);
    return first && first[0].toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "ko";
  }
}

export const LANG = pick(process.env.PI_REMOTE_LANG) || fromEnvFile() || macLang();

/** 폰에 보낼 글: 한국어와 영어 가운데 지금 언어의 것 */
export const tr = (ko, en) => (LANG === "en" ? en : ko);

// 직접 실행하면 고른 언어를 찍는다(install.sh 가 설정 파일에 적을 값을 물을 때)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(process.argv[2] === "--mac" ? macLang() : LANG);
}
