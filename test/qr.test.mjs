// 짝짓기 QR 시험: 그린 QR 이 올바른지(크기·모서리 무늬·색), 그리고 맥의 바코드 인식으로 다시 읽어 원래 글이 나오는지
// 다시 읽기는 swift(Xcode 명령줄 도구)가 있을 때만 한다. 실행: node test/qr.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { qrMatrix, renderQr } from "../deploy/qr.mjs";
import { createDeviceStore } from "../server/devices.mjs";
import { fingerprintOf } from "../server/tls.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };
const TOKEN = "0123456789abcdef".repeat(4);
const URLS = [
  `piremote://pair?token=${TOKEN}&port=8787`,
  `piremote://pair?token=${TOKEN}&port=8787&host=10.20.0.2`,
  `piremote://pair?token=${"f".repeat(128)}&port=18787&host=100.101.102.103&host=mac.tailnet-name.ts.net&host=fd7a:115c:a1e0::1`,
];

/** 터미널에 찍을 글 → 점 행렬(색 지정을 걷어 내고 반 블록 글자를 위아래 두 점으로) */
const parse = (text) => {
  const rows = [];
  for (const line of text.split("\n")) {
    const cells = [...line.replace(/\x1b\[[0-9;]*m/g, "")];
    rows.push(cells.map((ch) => ch === "█" || ch === "▀"), cells.map((ch) => ch === "█" || ch === "▄"));
  }
  return rows;
};
// 모서리의 위치 찾기 무늬(7×7): 검은 테두리, 흰 띠, 가운데 검은 3×3
const finder = (m, r0, c0) => {
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const edge = r === 0 || r === 6 || c === 0 || c === 6, core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    if (m[r0 + r][c0 + c] !== (edge || core)) return false;
  }
  return true;
};

const matrices = URLS.map(qrMatrix);
for (const [i, url] of URLS.entries()) {
  const m = matrices[i], n = m.length;
  const out = renderQr(m);
  const lines = out.split("\n");
  const back = parse(out);
  ok((n - 17) % 4 === 0 && n >= 21 && m.every((row) => row.length === n), `글 ${i + 1}(${url.length}자): 정사각형 QR(${n}×${n})`);
  ok(finder(m, 0, 0) && finder(m, 0, n - 7) && finder(m, n - 7, 0), `글 ${i + 1}: 세 모서리에 위치 찾기 무늬`);
  ok(lines.length === Math.ceil((n + 4) / 2) && lines.every((l) => [...l.replace(/\x1b\[[0-9;]*m/g, "")].length === n + 4), `글 ${i + 1}: 둘레 2칸을 넣은 크기(${lines.length}줄 × ${n + 4}칸)`);
  ok(lines.every((l) => l.startsWith("\x1b[38;5;16;48;5;231m") && l.endsWith("\x1b[0m")), `글 ${i + 1}: 줄마다 검은 글자·흰 바탕을 정하고 끝에서 되돌림`);
  ok(m.every((row, r) => row.every((v, c) => back[r + 2][c + 2] === v)) && back.slice(0, 2).every((row) => row.every((v) => !v)) && back.every((row) => !row[0] && !row[1] && !row[n + 2] && !row[n + 3]),
    `글 ${i + 1}: 찍은 글을 점으로 되돌리면 같은 무늬(둘레는 흰색)`);
}
ok(JSON.stringify(qrMatrix(URLS[1])) === JSON.stringify(qrMatrix(URLS[1])) && JSON.stringify(matrices[0]) !== JSON.stringify(matrices[1]), "같은 글은 같은 무늬, 다른 글은 다른 무늬");

// 명령으로: 글은 환경 변수로만 받는다
const QR = join(HERE, "../deploy/qr.mjs");
let r = spawnSync(process.execPath, [QR], { encoding: "utf8", env: { PATH: process.env.PATH, PAIR_URL: URLS[1] } });
ok(r.status === 0 && r.stdout === `${renderQr(matrices[1])}\n`, "명령으로 부르면 같은 QR 을 찍음");
r = spawnSync(process.execPath, [QR], { encoding: "utf8", env: { PATH: process.env.PATH } });
ok(r.status === 1 && r.stdout === "" && r.stderr.includes("PAIR_URL"), "글이 없으면 아무것도 찍지 않고 오류");

// 짝짓기 명령(deploy/pair.sh): 시험용 설정 파일로 돌려, 찍힌 QR 이 그 설정의 토큰·포트·맥 주소를 담는지
// (화면 지우기·tmux 기록 지우기가 쓰는 탭에 닿지 않게 TMUX 는 넘기지 않는다. 입력이 없어 QR 을 찍고 바로 끝남)
const dir = mkdtempSync(join(tmpdir(), "antenna-qr-"));
const ENVF = join(dir, "env");
const pairOut = (envText, args = [], link = false) => {
  writeFileSync(ENVF, envText);
  let cmd = join(HERE, "../deploy/pair.sh");
  if (link) { cmd = join(dir, "antenna-pair"); try { symlinkSync(join(HERE, "../deploy/pair.sh"), cmd); } catch { /* 이미 있음 */ } }
  return spawnSync("/bin/bash", [cmd, ...args], { encoding: "utf8", input: "", env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env.HOME, TERM: "xterm", PI_REMOTE_ENV: ENVF } });
};
/** 명령 출력에서 QR 줄(색을 정한 줄)만 뽑아 점 행렬로 */
const qrOf = (stdout) => {
  const lines = stdout.split("\n").filter((l) => l.includes("\x1b[38;5;16;48;5;231m")).map((l) => l.slice(l.indexOf("\x1b[38;5;16;48;5;231m")));
  const dots = parse(lines.join("\n"));
  return dots.slice(0, dots[0]?.length ?? 0);
};
const inner = (out) => JSON.stringify(qrOf(out).slice(2, -2).map((row) => row.slice(2, -2)));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const store = createDeviceStore(dir);   // 짝짓기 명령과 같은 설정 폴더

// 새 방식: 한 번 쓰는 코드를 만들어 QR 에 담는다(코드는 매번 다르므로, 맥에 남은 해시와 맞는지로 확인)
const pc = pairOut("# 시험\nPORT=9911\nPI_REMOTE_HOSTS=10.20.30.40,mac.example.net,bad;host\n");
const pairing = existsSync(store.files.pairing) ? JSON.parse(readFileSync(store.files.pairing, "utf8")) : {};
ok(pc.status === 0 && qrOf(pc.stdout).length >= 25 && /^[0-9a-f]{64}$/.test(pairing.hash ?? "") && pairing.expiresAt > Date.now(), `짝짓기 명령: 코드를 만들어 QR 을 찍음(공유 토큰이 없어도)${pc.status === 0 ? "" : ` (끝 코드 ${pc.status}: ${pc.stderr.slice(-200)})`}`);
ok(pc.stderr.includes("bad;host") && !/[0-9a-f]{32}/.test(pc.stdout.replace(/\x1b\[[0-9;]*m/g, "")), "짝짓기 명령: 이상한 맥 주소는 빼고 알림, 코드를 글자로 찍지 않음");
// 예전 방식(--legacy): 설정의 공유 토큰을 그대로 담는다
const LEGACY_URL = `piremote://pair?token=${TOKEN}&port=9911&host=10.20.30.40&host=mac.example.net`;
const p1 = pairOut(`# 시험\nPI_REMOTE_TOKEN=${TOKEN}\nPORT=9911\nPI_REMOTE_HOSTS=10.20.30.40,mac.example.net\n`, ["--legacy"]);
ok(p1.status === 0 && inner(p1.stdout) === JSON.stringify(qrMatrix(LEGACY_URL)) && !p1.stdout.includes(TOKEN), "짝짓기 명령 --legacy: 예전 앱용으로 공유 토큰·포트·맥 주소를 담음(토큰은 글자로 찍지 않음)");
const p2 = pairOut(`PI_REMOTE_TOKEN=${TOKEN}\n`, ["--legacy"], true);
ok(p2.status === 0 && inner(p2.stdout) === JSON.stringify(qrMatrix(`piremote://pair?token=${TOKEN}&port=8787`)), "짝짓기 명령: 바로가기로 불러도 되고, 포트·주소를 안 적으면 기본 포트·주소 없음");
const p3 = pairOut("PORT=8787\n", ["--legacy"]);
ok(p3.status === 1 && p3.stderr.includes("PI_REMOTE_TOKEN") && p3.stdout === "", "짝짓기 명령 --legacy: 공유 토큰이 없으면 그만둠");
// 기기 보기·끊기
let pl = pairOut("PORT=8787\n", ["--list"]);
ok(pl.status === 0 && pl.stdout.includes("등록된 기기가 없어요"), "짝짓기 명령 --list: 기기가 없으면 없다고");
const dev = store.redeem(store.startPairing().code, "시험 iPhone");
pl = pairOut("PORT=8787\n", ["--list"]);
ok(pl.status === 0 && pl.stdout.includes(dev.id) && pl.stdout.includes("시험 iPhone") && !pl.stdout.includes(dev.token), "짝짓기 명령 --list: 짝지은 기기의 번호·이름(토큰은 보이지 않음)");
pl = pairOut("PORT=8787\n", ["--revoke", dev.id]);
ok(pl.status === 0 && pl.stdout.includes("끊었어요") && store.verify(dev.token) === null, "짝짓기 명령 --revoke: 그 기기를 끊음");
ok(pairOut("PORT=8787\n", ["--revoke", "없는-기기"]).status === 1 && pairOut("PORT=8787\n", ["--revoke"]).status === 2, "짝짓기 명령 --revoke: 없는 기기·이름을 안 주면 오류");
const p4 = pairOut(`PI_REMOTE_TOKEN=${TOKEN}\n`, ["--help"]);
ok(p4.status === 2 && p4.stdout === "" && p4.stderr.includes("--list"), "짝짓기 명령: 모르는 옵션이면 QR 을 띄우지 않고(화면을 지우지 않고) 쓰는 법만");

// 맥의 바코드 인식으로 다시 읽기: 점 행렬을 그림(PNG, 점 하나 8픽셀)으로 만들어 읽힌 글이 원래 글과 같은지
let swift = null;
try { swift = execFileSync("/usr/bin/xcrun", ["-f", "swift"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* 명령줄 도구 없음 */ }
if (!swift) console.log("건너뜀: swift 가 없어 다시 읽기는 하지 않음");
else {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  /** 점 행렬(둘레 포함) → 흑백 PNG */
  const png = (dots, scale = 8) => {
    const size = dots.length * scale;
    const raw = Buffer.alloc((size + 1) * size);
    for (let y = 0; y < size; y++) {
      raw[y * (size + 1)] = 0;   // 줄 필터 없음
      for (let x = 0; x < size; x++) raw[y * (size + 1) + 1 + x] = dots[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255;
    }
    const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 0;   // 8비트 회색
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };
  // 화면에 찍힌 그대로(찍은 글을 점으로 되돌린 것)를 그림으로 만든다 → 그리기까지 함께 확인
  const files = URLS.map((_, i) => { const f = join(dir, `qr${i}.png`); writeFileSync(f, png(parse(renderQr(matrices[i])).slice(0, matrices[i].length + 4))); return f; });
  const legacyFile = join(dir, "legacy.png"), codeFile = join(dir, "code.png");
  writeFileSync(legacyFile, png(qrOf(p1.stdout)));
  writeFileSync(codeFile, png(qrOf(pc.stdout)));
  const read = spawnSync(swift, [join(HERE, "qr-decode.swift"), ...files, legacyFile, codeFile], { encoding: "utf8", timeout: 120000 });
  const got = read.stdout.split("\n");
  if (read.status !== 0) ok(false, `바코드 인식을 돌리지 못함: ${read.stderr.slice(-300)}`);
  else {
    for (const [i, url] of URLS.entries()) ok(got[i] === url, `글 ${i + 1}: 맥의 바코드 인식으로 읽으면 원래 글이 나옴${got[i] === url ? "" : ` → '${got[i]}'`}`);
    ok(got[URLS.length] === LEGACY_URL, `--legacy 로 찍은 QR 을 읽으면 예전 방식의 링크가 나옴${got[URLS.length] === LEGACY_URL ? "" : ` → '${got[URLS.length]}'`}`);
    const m = /^piremote:\/\/pair\?code=([0-9a-f]{32})&port=9911&fp=([0-9a-f]{64})&host=10\.20\.30\.40&host=mac\.example\.net$/.exec(got[URLS.length + 1] ?? "");
    ok(Boolean(m) && sha(m[1]) === pairing.hash, "짝짓기 명령이 찍은 QR 을 읽으면 코드·포트·맥 주소가 든 링크가 나오고, 그 코드가 맥에 남은 해시와 맞음");
    ok(Boolean(m) && m[2] === fingerprintOf(readFileSync(join(dir, "tls/cert.pem"), "utf8")), "그 링크의 지문이 이 맥 인증서의 지문과 같음(폰이 이 맥만 믿게)");
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
