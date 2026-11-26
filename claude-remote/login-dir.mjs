#!/usr/bin/env node
/**
 * 추가 계정(추가 개인·회사)을 '직접 로그인'으로 쓰는 설정 폴더 준비 (2026-11-25)
 *
 * 까닭: Claude Code 의 크롬 연결·원격 제어·claude.ai 커넥터는 claude.ai 로그인(/login)으로 켠 세션에서만 된다.
 *   장기 토큰(claude setup-token → CLAUDE_CODE_OAUTH_TOKEN)으로 켜면 계정이 같아도 꺼진다
 *   (문서 code.claude.com/docs/en/chrome#prerequisites, …/authentication#generate-a-long-lived-token).
 *   기본 로그인은 설정 폴더마다 하나라, 계정을 하나 더 로그인해 두려면 설정 폴더를 따로 둔다
 *   (문서 …/authentication#log-in-with-multiple-accounts: CLAUDE_CONFIG_DIR 마다 설정·기록·로그인이 따로, 키체인 항목도 폴더마다).
 * 하는 일: 그 계정의 설정 폴더(기본 ~/.claude-personal2, ~/.claude-work)를 만들고
 *   - 지침·설정·훅·스킬·대화 기록·실행 중 세션 표시는 ~/.claude 의 것을 바로가기(심볼릭 링크)로 함께 쓴다(LINKS).
 *     폰 연결부·상태 줄·훅이 ~/.claude/{projects,sessions,settings.json} 을 읽으므로, 이 바로가기가 있어야 그 계정 탭이
 *     지금처럼 폰에 뜨고 지침·메모도 같다. 문서에는 폴더를 함께 쓰는 방법이 없어 이 방식은 우리가 시험해 정한 것이다
 *   - 로그인과 계정에 묶인 상태만 따로 둔다: .claude.json(처음 한 번 ~/.claude.json 에서 계정에 묶인 것을 빼고 옮김),
 *     로그인 정보(키체인), 정책·원격 설정 캐시, 데몬 상태
 * 쓰는 법: node login-dir.mjs <personal2|work> <prepare|sync|ready|off|status>
 *   prepare  폴더를 만들고 바로가기를 건다(여러 번 돌려도 같음). 이어서 사람이 그 폴더로 Claude Code 를 켜 /login 한다
 *   sync     바로가기만 다시 맞춘다. claude-as.sh 가 켤 때마다 조용히 부른다(~/.claude 에 새로 생긴 것, 일반 파일로 바뀐 것)
 *   ready    로그인됐는지 보고 표식(.pi-login-ready)을 둔다. 이 표식이 있어야 claude-as.sh 가 토큰 대신 이 폴더로 켠다
 *   off      표식을 지운다(토큰으로 켜던 예전 방식으로 돌아감. 폴더와 로그인은 그대로)
 *   status   지금 상태
 * 작성: 서문교
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAccount, LABEL, LOGIN_DIR, LOGIN_MARK } from "./claude-account.mjs";

const HOME = process.env.HOME ?? "";

/** 함께 쓸 것(~/.claude 의 이름). 여기 없는 것은 그 계정 폴더에 따로 생긴다(로그인·정책·데몬·캐시처럼 계정에 묶인 것) */
export const LINKS = [
  // 지침·설정·확장
  "settings.json", "settings.local.json", "keybindings.json", "statusline.py", "mcp.json",
  "commands", "agents", "skills", "rules", "guides", "hooks", "output-styles", "plugins", "pi-remote",
  // 대화와 그 부속. 폰 연결부가 projects(대화 기록)·sessions(실행 중인 세션)를 ~/.claude 에서 읽는다. 자동 메모도 projects 안이다
  "projects", "sessions", "file-history", "history.jsonl", "todos", "tasks", "plans", "jobs", "uploads", "paste-cache", "session-env", "shell-snapshots", "state",
];
/** 맨 위의 글 문서(CLAUDE.md 와 지침이 가리키는 다른 .md)도 함께 쓴다. 백업 사본(.bak-)은 뺀다 */
export function linkNames(baseEntries) {
  const docs = baseEntries.filter((n) => n.endsWith(".md") && !n.includes(".bak"));
  return [...new Set([...docs, ...LINKS.filter((n) => baseEntries.includes(n))])].sort();
}

/** ~/.claude.json 에서 새 폴더로 옮기지 않을 것: 로그인한 계정에 묶인 것(새 로그인이 다시 채운다) */
const ACCOUNT_KEYS = new Set(["oauthAccount", "userID", "anonymousId", "customApiKeyResponses", "hasAvailableSubscription", "recommendedSubscription",
  "subscriptionNoticeCount", "penguinModeOrgEnabled", "isQualifiedForDataSharing", "hasRemoteEnvironment", "claudeAiMcpEverConnected", "replBridgePlaceholders"]);
/** 새 폴더의 .claude.json 첫 내용. 프로젝트별 설정(신뢰·허용 도구)·사용자 범위 MCP 서버·안내를 본 기록은 옮겨, 켰을 때 지금과 같게 한다.
 *  계정에 묶인 것과 캐시(모델 접근·실험 플래그 등 이름에 cache 가 든 것)는 빼서 새 로그인으로 다시 받게 한다 */
export function seedState(state) {
  const out = {};
  for (const [k, v] of Object.entries(state ?? {})) {
    if (ACCOUNT_KEYS.has(k)) continue;
    if (/cache/i.test(k) && k !== "cachedChromeExtensionInstalled") continue;
    if (/^(passes|overage)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

const kindOf = (p) => {
  try {
    const s = lstatSync(p);
    return s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : "file";
  } catch {
    return "";
  }
};

/** 바로가기를 맞춘다. 돌려주는 것: { made: [새로 건 것], moved: [일반 파일·폴더라 옆으로 치우고 건 것], kept: 수 }
 *  이미 그 자리에 일반 파일·폴더가 있으면(그 폴더로 먼저 켜서 생겼거나, 설정 파일을 새로 써서 바로가기가 풀린 경우)
 *  빈 폴더는 지우고, 내용이 있으면 '<이름>.split-<시각>' 으로 치운 뒤 건다. 합치지는 않는다 */
export function syncLinks(base, dir, now = new Date()) {
  const made = [], moved = [];
  let kept = 0;
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  for (const name of linkNames(readdirSync(base))) {
    const src = join(base, name), dst = join(dir, name);
    const kind = kindOf(dst);
    if (kind === "link") {
      if (readlinkSync(dst) === src) { kept++; continue; }
      unlinkSync(dst);
    } else if (kind === "dir") {
      if (readdirSync(dst).length === 0) rmdirSync(dst);
      else { renameSync(dst, `${dst}.split-${stamp}`); moved.push(name); }
    } else if (kind === "file") {
      renameSync(dst, `${dst}.split-${stamp}`);
      moved.push(name);
    }
    symlinkSync(src, dst);
    made.push(name);
  }
  return { made, moved, kept };
}

/** 폴더를 만들고(나만 읽게) 바로가기를 걸고, .claude.json 이 없으면 첫 내용을 둔다 */
export function prepare(account, { base = `${HOME}/.claude`, dir = LOGIN_DIR[account], stateFile = `${HOME}/.claude.json`, now = new Date() } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const links = syncLinks(base, dir, now);
  const target = join(dir, ".claude.json");
  let seeded = false;
  if (!existsSync(target)) {
    let state = {};
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      /* 없거나 깨짐: 빈 것으로 시작(첫 실행 안내가 뜬다) */
    }
    writeFileSync(target, `${JSON.stringify(seedState(state), null, 2)}\n`, { mode: 0o600 });
    chmodSync(target, 0o600);
    seeded = true;
  }
  return { dir, ...links, seeded };
}

/** 그 폴더에 로그인된 계정의 메일(없으면 "") */
export function loggedInAs(dir) {
  try {
    return String(JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"))?.oauthAccount?.emailAddress ?? "");
  } catch {
    return "";
  }
}
/** 메일을 가려 보이기: ab***@도메인 */
export const mask = (mail) => String(mail).replace(/^(.{1,2})[^@]*(@.*)$/, "$1***$2");

/** 로그인을 확인하고 표식을 둔다. 메인 계정(~/.claude.json)과 같은 계정으로 로그인됐으면 두지 않는다(다른 크롬 프로필에서 승인한 실수) */
export function markReady(account, { dir = LOGIN_DIR[account], stateFile = `${HOME}/.claude.json`, now = new Date() } = {}) {
  const mail = loggedInAs(dir);
  if (!mail) return { ok: false, why: "아직 로그인되지 않았어요. 그 폴더로 Claude Code 를 켜 /login 하세요" };
  let main = "";
  try {
    main = String(JSON.parse(readFileSync(stateFile, "utf8"))?.oauthAccount?.emailAddress ?? "");
  } catch {
    /* 메인 로그인을 못 읽으면 견주지 않음 */
  }
  if (main && main.toLowerCase() === mail.toLowerCase()) return { ok: false, why: `메인 계정과 같은 계정(${mask(mail)})으로 로그인돼 있어요. 그 폴더에서 /logout 한 뒤 ${LABEL[account]} 계정으로 다시 로그인하세요` };
  writeFileSync(join(dir, LOGIN_MARK), `${now.toISOString()}\n`, { mode: 0o600 });
  return { ok: true, mail };
}

function status(account, dir = LOGIN_DIR[account], base = `${HOME}/.claude`) {
  if (!existsSync(dir)) return `${LABEL[account]}: 설정 폴더가 없어요(${dir}). prepare 로 만들어요`;
  const names = linkNames(readdirSync(base));
  const linked = names.filter((n) => kindOf(join(dir, n)) === "link" && readlinkSync(join(dir, n)) === join(base, n)).length;
  const mail = loggedInAs(dir);
  return [`${LABEL[account]}: ${dir}`,
    `  바로가기 ${linked}/${names.length}`,
    `  로그인 ${mail ? mask(mail) : "안 됨"}`,
    `  직접 로그인으로 켜기 ${existsSync(join(dir, LOGIN_MARK)) ? "켜짐(표식 있음)" : "꺼짐(토큰으로 켬)"}`].join("\n");
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  const [account, cmd] = process.argv.slice(2);
  if (!isAccount(account) || !LOGIN_DIR[account] || !["prepare", "sync", "ready", "off", "status"].includes(cmd)) {
    process.stderr.write("쓰는 법: login-dir.mjs <personal2|work> <prepare|sync|ready|off|status>\n");
    process.exit(2);
  }
  const dir = LOGIN_DIR[account];
  if (cmd === "prepare") {
    const r = prepare(account);
    process.stdout.write(`${LABEL[account]} 설정 폴더: ${r.dir}\n바로가기 새로 ${r.made.length}개, 그대로 ${r.kept}개${r.moved.length ? `, 옆으로 치운 것 ${r.moved.join("·")}` : ""}\n${r.seeded ? ".claude.json 을 계정에 묶인 것만 빼고 옮겼어요\n" : ""}`);
  } else if (cmd === "sync") {
    if (!existsSync(dir)) process.exit(0);
    const r = syncLinks(`${HOME}/.claude`, dir);
    if (r.moved.length) process.stderr.write(`${LABEL[account]} 설정 폴더에서 바로가기가 풀려 있던 것을 옆으로 치우고 다시 걸었어요: ${r.moved.join(", ")}\n`);
  } else if (cmd === "ready") {
    const r = markReady(account);
    if (!r.ok) {
      process.stderr.write(`${r.why}\n`);
      process.exit(1);
    }
    process.stdout.write(`${LABEL[account]} 계정(${mask(r.mail)}): 이제 직접 로그인으로 켜요\n`);
  } else if (cmd === "off") {
    try {
      unlinkSync(join(dir, LOGIN_MARK));
    } catch {
      /* 이미 없음 */
    }
    process.stdout.write(`${LABEL[account]} 계정: 토큰으로 켜던 방식으로 돌아가요\n`);
  } else {
    process.stdout.write(`${status(account)}\n`);
  }
}
