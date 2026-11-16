import { createRequire } from "node:module"; import { execFileSync } from "node:child_process"; import { readFileSync, existsSync } from "node:fs";
const require = createRequire(new URL("../../server/package.json", import.meta.url)); const WebSocket = require("ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" });
const paste = (t) => { tm("send-keys", "-t", "pitest:1", "-l", `\x1b[200~${t}\x1b[201~`); tm("send-keys", "-t", "pitest:1", "Enter"); };
const ws = new WebSocket(`ws://127.0.0.1:8799/?token=${process.env.PI_REMOTE_TOKEN}&cols=120&rows=40`); const ev = [];
ws.on("message", (d, bin) => { if (bin) return; const s = d.toString(); if (s.startsWith('{"type":"chat"')) try { ev.push(JSON.parse(s).d); } catch {} });
await new Promise((r) => ws.on("open", r)); ws.send(JSON.stringify({ type: "select-window", index: 1 }));
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 250) { const v = fn(); if (v) return v; await sleep(250); } return null; };
const after = (n, fn) => ev.slice(n).find(fn);
let fail = 0; const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
await waitFor(() => ev.find((e) => e.t === "snapshot"), 8000);
const idle = () => waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 60000);

// 메모리
let n = ev.length; ws.send(JSON.stringify({ type: "memory-list" }));
const mem = (await waitFor(() => after(n, (e) => e.t === "memory"), 8000))?.memory ?? [];
console.log("  목록:", mem.map((f) => `${f.label}${f.exists ? "" : "(없음)"}`).join(" / "));
ok(mem.some((f) => f.label === "공통 지침" && f.exists && f.content.includes("최우선 규칙")) && mem.some((f) => f.path.endsWith("/tmp/AGENTS.md") && !f.exists), "목록: 공통 지침(내용 포함) + 작업 폴더 AGENTS.md(새로 만들기)");
const proj = mem.find((f) => f.path.endsWith("/tmp/AGENTS.md"));
n = ev.length; ws.send(JSON.stringify({ type: "memory-save", path: proj.path, content: "# 시험 메모리\n- 시험용 줄\n" }));
const sv = await waitFor(() => after(n, (e) => e.t === "memory-saved"), 8000);
ok(sv && !sv.error && readFileSync(proj.path, "utf8").includes("시험용 줄"), "저장: 시험 파일에 써짐");
ok(!!(await waitFor(() => after(n, (e) => e.t === "notice" && /다시 불러와/.test(e.text)), 8000)), "저장 뒤 '다시 불러와 적용' 알림");
await sleep(6000);
n = ev.length; ws.send(JSON.stringify({ type: "memory-save", path: "/etc/hosts", content: "x" }));
const bad = await waitFor(() => after(n, (e) => e.t === "memory-saved"), 8000);
ok(bad?.error && /저장할 수 있는 지침 파일이 아니에요/.test(bad.error), "목록에 없는 파일(/etc/hosts)은 거절");

// 되감기
paste("/new"); await sleep(3000);
paste("Reply with exactly: one"); await sleep(1500); await idle(); await sleep(1000);
paste("Reply with exactly: two"); await sleep(1500); await idle(); await sleep(1500);
n = ev.length; ws.send(JSON.stringify({ type: "select-window", index: 1 }));
const snap = await waitFor(() => after(n, (e) => e.t === "snapshot"), 8000);
const users = (snap?.messages ?? []).filter((m) => m.role === "user");
console.log("  되감기 전 내 메시지:", users.map((u) => u.text).join(" / "));
const second = users.find((u) => u.text === "Reply with exactly: two");
n = ev.length; ws.send(JSON.stringify({ type: "rewind", id: second?.id, text: second?.text }));
const rw = await waitFor(() => after(n, (e) => e.t === "rewound"), 8000);
ok(rw?.text === "Reply with exactly: two", "되감기: 그 메시지 글이 폰 입력창으로");
const snap2 = await waitFor(() => after(n, (e) => e.t === "snapshot"), 10000);
const users2 = (snap2?.messages ?? []).filter((m) => m.role === "user").map((u) => u.text);
ok(users2.includes("Reply with exactly: one") && !users2.includes("Reply with exactly: two"), `되감기: 대화가 그 메시지 직전으로(${users2.join(" / ")})`);
await sleep(1000);
const editor = tm("capture-pane", "-p", "-t", "pitest:1").split("\n").filter((l) => l.trim()).slice(-3).join(" | ");
ok(!/Reply with exactly: two/.test(editor), "맥 입력창은 비어 있음(글은 폰으로)");
paste("Reply with exactly: three after sleeping: use bash to run sleep 8 first"); await sleep(4000);
n = ev.length; ws.send(JSON.stringify({ type: "rewind", id: "x", text: "Reply with exactly: one" }));
ok(!!(await waitFor(() => after(n, (e) => e.t === "notice" && /작업이 끝난 뒤에 되감을 수/.test(e.text)), 8000)), "작업 중에는 되감기 거절");
await idle();

// 맥 /memory
paste("/memory"); await sleep(2500);
ok(/어느 지침 파일을 고칠까요/.test(tm("capture-pane", "-p", "-t", "pitest:1")), "맥 /memory: 파일 고르기 창");
tm("send-keys", "-t", "pitest:1", "Escape");
ws.close(); console.log(fail ? `실패 ${fail}개` : "모두 통과"); process.exit(fail ? 1 : 0);
