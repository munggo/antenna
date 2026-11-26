// 답 속 맥의 그림 경로를 폰에서 눌렀을 때 브리지가 그 그림을 주는지 시험(사용자 요청 11-25, 브리지의 thumb 요청 · macImage).
// 가짜 홈으로 브리지를 따로 띄우고(쓰는 브리지·tmux 세션은 건드리지 않음) 시험이 만든 그림 파일을 요청한다.
//  1) 큰 그림은 크기마다 줄여서(작게 360 · 미리보기 1024 · 전체 2048), 작은 그림은 늘리지 않고, 투명한 그림은 PNG 로
//  2) 한글·띄어쓰기 경로, 홈(~/) 경로, JPEG
//  3) 그림이 아닌 것은 주지 않음: 이름만 .png 인 글 파일, .png 바로가기가 가리키는 글 파일, 폴더, 없는 파일, 상대 경로, 그림이 아닌 확장자
//  4) 폰에서 올린 사진(사진 폴더의 img-숫자)은 전처럼, 다른 폴더의 같은 꼴 이름은 맥의 일반 그림으로
//  5) 파일이 바뀌면(같은 경로에 다시 만듦) 새 그림을 줌
// 실행: node server/test/mac-image.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");
const S = "macimgtest", PORT = 8786, ROOT = `/tmp/antenna-macimg-${process.pid}`, HOME = `${ROOT}/home`, TOKEN = "e".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tm = (...a) => { try { return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

/** 한 색으로 채운 PNG(alpha 면 한 칸 걸러 투명) */
function png(w, h, alpha = false, color = [200, 30, 30]) {
  const bpp = alpha ? 4 : 3;
  const row = Buffer.alloc(1 + w * bpp);
  for (let x = 0; x < w; x++) {
    row.set(color, 1 + x * bpp);
    if (alpha) row[1 + x * bpp + 3] = x % 2 ? 0 : 255;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
/** 받은 그림의 형식과 크기(sips 로 읽음) */
function look(b64) {
  const f = `${ROOT}/got`;
  const data = Buffer.from(b64, "base64");
  writeFileSync(f, data);
  const info = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", f], { encoding: "utf8" });
  const kind = data.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) ? "png" : data[0] === 0xff && data[1] === 0xd8 ? "jpeg" : "?";
  return `${kind} ${info.match(/pixelWidth:\s*(\d+)/)?.[1]}x${info.match(/pixelHeight:\s*(\d+)/)?.[1]}`;
}

const PICS = `${ROOT}/그림 폴더`;
mkdirSync(PICS, { recursive: true });
mkdirSync(`${HOME}/.cache/pi-remote`, { recursive: true });
const BIG = `${PICS}/한티 마스터 01.png`;
writeFileSync(BIG, png(3000, 1500));
writeFileSync(`${PICS}/small.png`, png(300, 200));
writeFileSync(`${PICS}/clear.png`, png(100, 80, true));
execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", `${PICS}/small.png`, "--out", `${PICS}/photo.JPG`], { stdio: "ignore" });
writeFileSync(`${HOME}/home-pic.png`, png(120, 90));
writeFileSync(`${PICS}/secret.png`, "password=hunter2\n");
writeFileSync(`${PICS}/notes.txt`, "password=hunter2\n");
symlinkSync(`${PICS}/notes.txt`, `${PICS}/link.png`);
mkdirSync(`${PICS}/dir.png`);
// 폰에서 올린 사진(사진 폴더)과, 다른 폴더의 같은 꼴 이름
writeFileSync(`${HOME}/.cache/pi-remote/img-123.png`, png(500, 400));
writeFileSync(`${PICS}/img-5.png`, png(60, 40));

tm("kill-session", "-t", `=${S}`);
tm("new-session", "-d", "-s", S, "-x", "100", "-y", "30", "-c", "/tmp");
const bridge = spawn(process.execPath, ["bridge.mjs"], {
  cwd: SERVER,
  env: { PATH: process.env.PATH, LANG: "ko_KR.UTF-8", HOME, PI_BIN: `${ROOT}/no-such/pi`, PI_PKG: `${ROOT}/no-such/pi-pkg`, PI_REMOTE_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: String(PORT),
    PI_TMUX_SESSION: S, PI_REMOTE_PUSH_DRYRUN: "1", PI_REMOTE_PUSH_FILE: `${ROOT}/push.json`, PI_REMOTE_TABS_FILE: `${ROOT}/tabs.json`,
    PI_REMOTE_USAGE_DIR: `${ROOT}/usage`, PI_ACCOUNTS_CACHE: `${ROOT}/accounts.json`, PI_REMOTE_CRASH_LOG: `${ROOT}/crash.log` },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
let exited = null;
bridge.stdout.on("data", (d) => (log += d));
bridge.stderr.on("data", (d) => (log += d));
bridge.on("exit", (code) => (exited = code));
try {
  for (let i = 0; i < 40 && !/브리지 시작/.test(log) && exited === null; i++) await sleep(250);
  if (!/브리지 시작/.test(log) || exited !== null) throw new Error(`브리지가 뜨지 않음(끝 코드 ${exited})\n${log.slice(-400)}`);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${TOKEN}&cols=100&rows=30`);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const replies = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try { const m = JSON.parse(data.toString()); if (m.type === "thumb") replies.push(m); } catch { /* 줄 단위가 아닌 글 */ }
  });
  /** 그림을 요청하고 답을 돌려줌 */
  const ask = async (path, size) => {
    const n = replies.length;
    ws.send(JSON.stringify({ type: "thumb", path, size }));
    for (let t = 0; t < 20000 && replies.length === n; t += 50) await sleep(50);
    return replies[n] ?? { error: "(답 없음)" };
  };

  // 1) 큰 그림은 줄여서, 작은 그림은 그대로, 투명하면 PNG
  for (const [size, want] of [["small", "jpeg 360x180"], ["large", "jpeg 1024x512"], ["full", "jpeg 2048x1024"]]) {
    const r = await ask(BIG, size);
    ok(r.path === BIG && r.size === size && r.data && look(r.data) === want, `큰 그림(3000x1500, 한글·띄어쓰기 경로) ${size} → ${r.data ? look(r.data) : r.error}`);
  }
  let r = await ask(`${PICS}/small.png`, "full");
  ok(r.data && look(r.data) === "jpeg 300x200", `작은 그림은 늘리지 않음 → ${r.data ? look(r.data) : r.error}`);
  r = await ask(`${PICS}/clear.png`, "full");
  ok(r.data && look(r.data) === "png 100x80", `투명한 그림은 PNG 로(배경이 검게 되지 않게) → ${r.data ? look(r.data) : r.error}`);

  // 2) JPEG(대문자 확장자), 홈 경로
  r = await ask(`${PICS}/photo.JPG`, "full");
  ok(r.data && look(r.data) === "jpeg 300x200", `JPEG → ${r.data ? look(r.data) : r.error}`);
  r = await ask("~/home-pic.png", "full");
  ok(r.data && look(r.data) === "jpeg 120x90", `홈(~/) 경로 → ${r.data ? look(r.data) : r.error}`);

  // 3) 그림이 아닌 것은 주지 않음
  for (const [path, name] of [[`${PICS}/secret.png`, "이름만 .png 인 글 파일"], [`${PICS}/link.png`, ".png 바로가기가 가리키는 글 파일"],
    [`${PICS}/dir.png`, "폴더"], [`${PICS}/없는 그림.png`, "없는 파일"], ["그림 폴더/small.png", "상대 경로"], [`${PICS}/notes.txt`, "그림이 아닌 확장자"]]) {
    r = await ask(path, "full");
    ok(!r.data && typeof r.error === "string" && r.error.length > 0, `주지 않음(${name}) → ${r.error}`);
  }
  ok(!replies.some((m) => m.data && Buffer.from(m.data, "base64").includes("hunter2")), "글 파일의 내용이 한 번도 나가지 않음");

  // 4) 폰에서 올린 사진은 전처럼(사진 폴더에서 찾음), 다른 폴더의 같은 꼴 이름은 그 파일 그대로
  r = await ask(`${HOME}/.cache/pi-remote/img-123.png`, "small");
  ok(r.data && look(r.data) === "jpeg 360x288", `폰에서 올린 사진의 썸네일은 전처럼 → ${r.data ? look(r.data) : r.error}`);
  r = await ask(`${PICS}/img-5.png`, "full");
  ok(r.data && look(r.data) === "jpeg 60x40", `다른 폴더의 img-숫자 이름은 그 파일 → ${r.data ? look(r.data) : r.error}`);

  // 5) 같은 경로에 다시 만들면 새 그림
  await sleep(1100);   // 수정 시각이 달라지게
  writeFileSync(BIG, png(800, 600, false, [20, 200, 20]));
  r = await ask(BIG, "full");
  ok(r.data && look(r.data) === "jpeg 800x600", `파일이 바뀌면 새 그림 → ${r.data ? look(r.data) : r.error}`);
  ok(exited === null, "브리지가 계속 살아 있음");
  ws.close();
} catch (e) {
  ok(false, `시험 중 오류: ${e.message}`);
} finally {
  bridge.kill("SIGTERM");
  await sleep(500);
  tm("kill-session", "-t", `=${S}`);
  rmSync(ROOT, { recursive: true, force: true });
}
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
