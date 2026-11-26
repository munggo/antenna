// 아티팩트 계정 맞춤(artifact-relay.mjs) 시험: 네트워크 없이 가짜 대신 실행 프로그램으로. 실행: node claude-remote/test/artifact-relay-cases.mjs
// 실제 두 계정으로 해 본 것(11-24): 회사 계정 Claude Code 안에서 훅이 개인 계정 목록을 받아 옴, 같은 주소에 새 버전, 대기열 뒤 다시 올림
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../artifact-relay.mjs", import.meta.url).pathname;
const T = mkdtempSync(join(tmpdir(), "relay-"));
process.env.PI_REMOTE_WORK_DIRS_FILE = join(T, "work-dirs");
writeFileSync(process.env.PI_REMOTE_WORK_DIRS_FILE, `${T}/company\n`);
const { extraDirs, parseRelay, relayPrompt } = await import(SCRIPT);
let fail = 0, total = 0;
const ok = (c, n) => { total++; console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. 대신 실행할 글
const p = relayPrompt("Artifact", { file_path: "/a/b.html", url: "https://claude.ai/artifact/X" }, [{ action: "read", url: "https://claude.ai/artifact/X" }]);
ok(/1\. Artifact \{"action":"read","url":"https:\/\/claude\.ai\/artifact\/X"\}\n2\. Artifact \{"file_path":"\/a\/b\.html","url":"https:\/\/claude\.ai\/artifact\/X"\}/.test(p), "먼저 읽기, 그다음 그 호출(입력 그대로)");

// 2. 출력 읽기
const line = (o) => JSON.stringify(o);
const use = (id, name, input) => line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id, text, isError = false) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], is_error: isError }] } });
const IN = { action: "publish", file_path: "/a/b.html" };
let r = parseRelay([use("1", "Read", { file_path: "/a/b.html" }), res("1", "..."), use("2", "Artifact", { file_path: "/a/b.html", action: "publish" }), res("2", "Published at https://claude.ai/artifact/AB1"), line({ type: "result", subtype: "success" })].join("\n"), "Artifact", IN);
ok(r.ran && r.ok && /AB1/.test(r.text), "입력이 같은 호출의 결과(키 순서가 달라도)");
r = parseRelay([use("2", "Artifact", { action: "publish", file_path: "/a/b.html", icon: "doc" }), res("2", "Published at https://claude.ai/artifact/AB2")].join("\n"), "Artifact", IN);
ok(r.ran && r.ok && /AB2/.test(r.text), "입력을 조금 바꿨어도 같은 동작이면 그 결과");
r = parseRelay([use("2", "Artifact", IN), res("2", "Error: conflict", true)].join("\n"), "Artifact", IN);
ok(r.ran && !r.ok && r.text === "Error: conflict", "도구 오류는 실행됨·실패");
r = parseRelay(["깨진 줄", line({ type: "result", subtype: "success", result: "API Error: 429 rate limit" })].join("\n"), "Artifact", IN);
ok(!r.ran && /429/.test(r.text), "호출을 못 함(한도 등) → 실행 안 됨 + 까닭");
r = parseRelay([use("9", "Artifact", { action: "list" }), res("9", "list")].join("\n"), "Artifact", IN);
ok(!r.ran, "다른 동작의 결과는 쓰지 않음");

// 3. 작업 폴더 밖 파일의 폴더(--add-dir)
const cwd = join(T, "proj"), out = join(T, "out");
mkdirSync(cwd, { recursive: true }); mkdirSync(out, { recursive: true });
ok(extraDirs({ file_path: "page.html" }, cwd).length === 0, "작업 폴더 안 파일은 더하지 않음");
ok(JSON.stringify(extraDirs({ file_path: join(out, "p.html"), files: { "a.css": join(out, "a.css") } }, cwd)) === JSON.stringify([out]), "밖 파일의 폴더(한 번만)");
ok(extraDirs({ file_path: "/없는/곳/p.html" }, cwd).length === 0, "없는 폴더는 뺌");

// 4. 훅 전체(가짜 대신 실행: 모드 파일에 따라 성공·도구 오류·실패)
const FAKE = join(T, "fake-as.mjs"), MODE = join(T, "mode"), ARGS = join(T, "args.log");
writeFileSync(FAKE, `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ARGS)}, JSON.stringify(args) + "\\n");
const mode = readFileSync(${JSON.stringify(MODE)}, "utf8").trim();
if (mode === "fail") { process.stderr.write("API Error: 429 rate limit"); process.exit(1); }
const steps = args.at(-1).split("\\n").map((l) => l.match(/^\\d+\\. (\\w+) (\\{.*\\})$/)).filter(Boolean);
const [, name, json] = steps.at(-1);
const input = JSON.parse(json);
const say = (o) => console.log(JSON.stringify(o));
say({ type: "assistant", message: { content: [{ type: "tool_use", id: "u1", name, input }] } });
const text = mode === "toolerr" ? "Error: bad input" : input.action === "list" ? "1 published artifacts: 시험" : \`Published \${input.file_path} at \${input.url ?? "https://claude.ai/artifact/NEW" + Date.now()} (Version 1)\`;
say({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: [{ type: "text", text }], is_error: mode === "toolerr" }] } });
say({ type: "result", subtype: "success", result: "DONE" });
`, { mode: 0o755 });
const STATE = join(T, "state");
const hook = (ev, env = {}) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(ev), encoding: "utf8",
  env: { ...process.env, PI_ARTIFACT_RELAY_AS: FAKE, PI_ARTIFACT_RELAY_DIR: STATE, PI_ARTIFACT_RELAY_RETRY_SEC: "1", TMUX_PANE: "", ...env } });
const reason = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; } catch { return ""; } };
writeFileSync(join(cwd, "page.html"), "<title>t</title>");
const ev = (input, sid = "s1", dir = cwd, tool = "Artifact") => ({ session_id: sid, cwd: dir, hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });

writeFileSync(MODE, "ok");
ok(hook(ev({ action: "list" }), { PI_ARTIFACT_RELAY_CURRENT: "personal" }).stdout === "", "지금 계정 = 폴더 계정(개인) → 그대로(아무것도 내지 않음)");
ok(hook(ev({ action: "list" }, "s1", join(T, "company")), { PI_ARTIFACT_RELAY_CURRENT: "work" }).stdout === "", "회사 폴더 + 회사 계정 → 그대로");
ok(hook({ ...ev({}), tool_name: "Read" }, { PI_ARTIFACT_RELAY_CURRENT: "work" }).stdout === "", "아티팩트 도구가 아니면 그대로");
ok(hook(ev({ action: "list" }), { PI_ARTIFACT_RELAY_CURRENT: "work", PI_ARTIFACT_RELAY: "1" }).stdout === "", "대신 실행하는 세션 자신이면 그대로");
ok(!existsSync(ARGS), "그대로인 경우는 대신 실행하지 않음");

let h = hook(ev({ action: "list" }), { PI_ARTIFACT_RELAY_CURRENT: "work" });
ok(JSON.parse(h.stdout).hookSpecificOutput.permissionDecision === "deny" && /회사 계정으로 돌고 있지만 이 폴더의 아티팩트는 개인 계정에/.test(reason(h)) && /성공했습니다/.test(reason(h)) && /시험/.test(reason(h)),
  "개인 폴더 + 회사 계정 → 개인 계정으로 대신 실행, 결과를 거절 까닭에");
const a1 = JSON.parse(readFileSync(ARGS, "utf8").trim().split("\n").at(-1));
ok(a1[0] === "personal" && a1.includes("--setting-sources") && a1.includes("--no-session-persistence") && a1[a1.indexOf("--tools") + 1] === "Artifact,ArtifactComments,ArtifactData,Read", `대신 실행 옵션(${a1.slice(0, 4).join(" ")} …)`);
h = hook(ev({ file_path: "page.html", title: "t" }), { PI_ARTIFACT_RELAY_CURRENT: "work" });
const url1 = (reason(h).match(/https:\/\/claude\.ai\/artifact\/NEW\d+/) ?? [])[0];
ok(!!url1 && JSON.parse(readFileSync(join(STATE, "urls.json"), "utf8"))[`s1\t${join(cwd, "page.html")}`] === url1, "올린 주소를 대화·파일별로 기억");
h = hook(ev({ file_path: "page.html", title: "t" }), { PI_ARTIFACT_RELAY_CURRENT: "work" });
const p2 = JSON.parse(readFileSync(ARGS, "utf8").trim().split("\n").at(-1)).at(-1);
ok(reason(h).includes(`같은 주소(${url1})에 새 버전`) && /1\. Artifact \{"action":"read"/.test(p2) && /2\. Artifact \{"action":"list","scope":"files"/.test(p2) && p2.includes(`"url":"${url1}"`),
  "같은 대화에서 같은 파일을 다시 올리면 그 주소로(먼저 읽기·파일 목록)");
h = hook(ev({ file_path: "page.html" }, "s2"), { PI_ARTIFACT_RELAY_CURRENT: "work" });
ok(!reason(h).includes("같은 주소"), "다른 대화면 주소를 붙이지 않음");
h = hook(ev({ action: "list" }, "s1", join(T, "company")), { PI_ARTIFACT_RELAY_CURRENT: "personal" });
const lastArgs = () => JSON.parse(readFileSync(ARGS, "utf8").trim().split("\n").at(-1));
ok(lastArgs()[0] === "work" && /개인 계정으로 돌고 있지만 이 폴더의 아티팩트는 회사 계정에/.test(reason(h)) || !reason(h), "회사 폴더 + 개인 계정 → 회사 계정으로(회사 토큰이 없는 맥이면 그대로)");

// 추가 개인 계정으로 도는 탭(11-25): 개인 폴더의 아티팩트는 메인 개인 계정에
h = hook(ev({ action: "list" }, "s1"), { PI_ARTIFACT_RELAY_CURRENT: "personal2" });
ok(lastArgs()[0] === "personal" && /추가 개인 계정으로 돌고 있지만 이 폴더의 아티팩트는 개인 계정에/.test(reason(h)), "개인 폴더 + 추가 개인 계정 → 메인 개인 계정으로 대신 실행");

writeFileSync(MODE, "toolerr");
h = hook(ev({ file_path: "page.html" }, "s3"), { PI_ARTIFACT_RELAY_CURRENT: "work" });
ok(/도구가 오류를 돌려줬습니다/.test(reason(h)) && /bad input/.test(reason(h)) && !existsSync(join(STATE, "queue")), "도구 오류 → 그 오류를 알림(대기열에 넣지 않음)");

writeFileSync(MODE, "fail");
h = hook(ev({ action: "list" }, "s3"), { PI_ARTIFACT_RELAY_CURRENT: "work" });
ok(/실행하지 못했습니다\(API Error: 429/.test(reason(h)) && !existsSync(join(STATE, "queue")), "읽기는 실행하지 못하면 알리기만");
h = hook(ev({ file_path: "page.html" }, "s4"), { PI_ARTIFACT_RELAY_CURRENT: "work" });
const qid = (reason(h).match(/번호 (\S+)\)/) ?? [])[1];
const job = qid ? JSON.parse(readFileSync(join(STATE, "queue", qid, "job.json"), "utf8")) : null;
ok(/대기열에 넣었습니다/.test(reason(h)) && job?.account === "personal" && job.input.file_path.startsWith(join(STATE, "queue", qid, "files")) && existsSync(job.input.file_path), "올리기는 실행하지 못하면 파일을 복사해 대기열에");
rmSync(join(cwd, "page.html"));   // 원본이 지워져도 사본으로 올라가야 함
await sleep(2500);
ok(existsSync(join(STATE, "queue", qid)), "뒤에서 다시 시도해도 아직 안 되면 대기열에 남음");
writeFileSync(MODE, "ok");
let done = false;
for (let i = 0; i < 30 && !done; i++) { await sleep(500); done = existsSync(join(STATE, "done", qid)); }
const noteFile = join(cwd, ".work", "artifact-relay", `${qid}.md`);
ok(done && existsSync(noteFile) && /# 아티팩트를 올림/.test(readFileSync(noteFile, "utf8")) && readFileSync(join(cwd, ".work", "artifact-relay", ".gitignore"), "utf8") === "*\n", "되면 대기열에서 빼고 작업 폴더 .work 에 주소를 적음");
const u = JSON.parse(readFileSync(join(STATE, "urls.json"), "utf8"));
ok(/^https:\/\/claude\.ai\/artifact\/NEW\d+$/.test(u[`s4\t${join(cwd, "page.html")}`] ?? ""), "대기열로 올린 것도 주소를 기억");
for (let i = 0; i < 10 && existsSync(join(STATE, "drain.pid")); i++) await sleep(500);
ok(!existsSync(join(STATE, "drain.pid")), "대기열이 비면 뒤 프로세스가 끝남");

// 5. 지금 계정 알아내기: 이 시험은 Claude Code 가 아닌 node 에서 돌므로 못 찾음(null → 그대로 실행)
const { currentAccount } = await import(SCRIPT);
ok(currentAccount() === null || ["work", "personal"].includes(currentAccount()), "부모 프로세스에서 Claude Code 를 찾거나, 없으면 null");

try { execFileSync("pkill", ["-f", `${SCRIPT} --drain`]); } catch { /* 없음 */ }
rmSync(T, { recursive: true, force: true });
console.log(`전체 ${total}개 중 틀림 ${fail}개`);
process.exit(fail ? 1 : 0);
