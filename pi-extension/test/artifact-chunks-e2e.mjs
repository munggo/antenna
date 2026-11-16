// 큰 파일 나눠 받기 실제 시험: pitest 의 pi 에 아티팩트를 등록하고, 시험 브리지(8799)로 조각을 받아 원본과 비교
import { createRequire } from "node:module"; import { execFileSync } from "node:child_process"; import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const require = createRequire(new URL("../../server/package.json", import.meta.url)); const WebSocket = require("ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const tm = (...a) => execFileSync("tmux", a, { encoding: "utf8" });
const paste = (t) => { tm("send-keys", "-t", "pitest:1", "-l", `\x1b[200~${t}\x1b[201~`); tm("send-keys", "-t", "pitest:1", "Enter"); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const ws = new WebSocket(`ws://127.0.0.1:8799/?token=${process.env.PI_REMOTE_TOKEN}&cols=120&rows=40`); const ev = [];
ws.on("message", (d, bin) => { if (bin) return; const s = d.toString(); if (s.startsWith('{"type":"chat"')) try { ev.push(JSON.parse(s).d); } catch {} });
await new Promise((r) => ws.on("open", r)); ws.send(JSON.stringify({ type: "select-window", index: 1 }));
const waitFor = async (fn, ms) => { for (let t = 0; t < ms; t += 100) { const v = fn(); if (v) return v; await sleep(100); } return null; };
let fail = 0; const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
await waitFor(() => ev.find((e) => e.t === "snapshot"), 8000);

const files = ["/tmp/arttest/big.mp4", "/tmp/arttest/empty.txt", "/tmp/arttest/exact.bin", "/tmp/arttest/plus1.bin", "/tmp/arttest/tone.m4a", "/tmp/arttest/chart.pdf"];
if (process.argv[2] !== "skip-register") {
  ev.length = 0;
  paste(`Call the show_artifact tool once for each of these files, one call per file, with the file name as the title: ${files.join(", ")}. Then reply with one word: ok`);
  await waitFor(() => ev.some((e) => e.t === "working" && e.value === false), 180000); await sleep(1500);
  const arts = ev.filter((e) => e.t === "upsert" && e.message?.role === "toolResult" && e.message.artifact).map((e) => e.message.artifact);
  console.log("  받은 아티팩트:", arts.map((a) => `${a.title}(${a.kind})`).join(", "));
  ok(files.every((f) => arts.some((a) => a.path === f)), "여섯 파일이 모두 등록됨");
  ok(arts.find((a) => a.path.endsWith("big.mp4"))?.kind === "video" && arts.find((a) => a.path.endsWith("tone.m4a"))?.kind === "audio", "종류: 동영상·소리");
}

const one = async (path, offset) => {
  const n = ev.length;
  ws.send(JSON.stringify({ type: "artifact", path, ...(offset === undefined ? {} : { offset }) }));
  return waitFor(() => ev.slice(n).find((e) => e.t === "artifact" && e.path === path), 15000);
};
// 앱처럼 처음부터 끝까지 조각으로 받기
const fetchAll = async (path) => {
  const parts = []; let off = 0, n = 0, first;
  for (;;) {
    const r = await one(path, off);
    if (!r || r.error) return { error: r?.error ?? "응답 없음" };
    first ??= r; n++;
    if (r.offset !== off || r.mtime !== first.mtime) return { error: "위치·수정 시각이 어긋남" };
    const b = Buffer.from(r.data, "base64"); parts.push(b); off += b.length;
    if (r.done) break;
    if (n > 1000) return { error: "끝나지 않음" };
  }
  return { buf: Buffer.concat(parts), chunks: n, size: first.size };
};

const t0 = Date.now();
const big = await fetchAll("/tmp/arttest/big.mp4");
const secs = (Date.now() - t0) / 1000;
ok(big.buf && sha(big.buf) === sha(readFileSync("/tmp/arttest/big.mp4")), `25MB 넘는 동영상(${(statSync("/tmp/arttest/big.mp4").size / 1048576).toFixed(1)}MB)을 조각 ${big.chunks}개로 받아 원본과 같음(${secs.toFixed(1)}초)`);
const empty = await fetchAll("/tmp/arttest/empty.txt");
ok(empty.buf && empty.buf.length === 0 && empty.chunks === 1, "빈 파일: 조각 1개(빈 내용)로 끝남");
const exact = await fetchAll("/tmp/arttest/exact.bin");
ok(exact.buf && exact.chunks === 2 && sha(exact.buf) === sha(readFileSync("/tmp/arttest/exact.bin")), "조각 크기에 딱 맞는 4MB: 조각 2개, 원본과 같음");
const plus = await fetchAll("/tmp/arttest/plus1.bin");
ok(plus.buf && plus.chunks === 2 && sha(plus.buf) === sha(readFileSync("/tmp/arttest/plus1.bin")), "조각보다 1바이트 큰 파일: 조각 2개, 원본과 같음");
const pdf = await fetchAll("/tmp/arttest/chart.pdf");
ok(pdf.buf && sha(pdf.buf) === sha(readFileSync("/tmp/arttest/chart.pdf")), "작은 PDF: 원본과 같음");

const bad1 = await one("/tmp/arttest/plus1.bin", 2097154);
ok(bad1 && !bad1.data && /잘못된 위치/.test(bad1.error), "파일 크기보다 뒤에서 받으려 하면 거절");
const bad2 = await one("/tmp/arttest/plus1.bin", -5);
// 음수 위치: 브리지가 잘못된 위치를 빼고 넘겨 예전 방식(통째로, 25MB 한도)으로 처리됨
ok(bad2 && bad2.offset === undefined, "음수 위치는 조각 요청으로 다루지 않음(예전 방식으로)");
const leg = await one("/tmp/arttest/chart.pdf");
ok(leg && leg.data && leg.offset === undefined && Buffer.from(leg.data, "base64").length === statSync("/tmp/arttest/chart.pdf").size, "예전 앱 요청(위치 없음): 작은 파일은 통째로");
const legBig = await one("/tmp/arttest/big.mp4");
ok(legBig && !legBig.data && /너무 커요/.test(legBig.error), "예전 앱 요청: 25MB 넘으면 지금처럼 안내");
const unreg = await one("/etc/hosts", 0);
ok(unreg && !unreg.data && /등록된 아티팩트가 아니에요/.test(unreg.error), "등록 안 된 파일은 조각 요청도 거절");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
