#!/usr/bin/env node
/**
 * 터미널에 QR 을 그린다(짝짓기 QR: deploy/pair.sh 가 부름).
 * 글은 환경 변수 PAIR_URL 로 받는다(명령줄에 적으면 프로세스 목록에 토큰이 보임).
 * 터미널 색 테마와 상관없이 흰 바탕에 검은 무늬가 되게 색을 직접 정한다(256색). 글자 한 칸에 위아래 두 점(반 블록).
 * 실행: PAIR_URL='piremote://pair?…' node deploy/qr.mjs
 * 작성: 서문교
 */
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../server/package.json", import.meta.url));
const BORDER = 2;   // 둘레의 빈 칸(점 수)

/** 글 → QR 점 행렬(true = 검은 점). 오류 정정 수준 M */
export function qrMatrix(text) {
  const QRCode = require("qrcode-terminal/vendor/QRCode");
  const Level = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");
  const qr = new QRCode(-1, Level.M);
  qr.addData(text);
  qr.make();
  return qr.modules.map((row) => row.map(Boolean));
}

/** 점 행렬 → 터미널에 찍을 글(줄마다 색 지정·해제) */
export function renderQr(matrix, border = BORDER) {
  const n = matrix.length + border * 2;
  const at = (r, c) => Boolean(matrix[r - border]?.[c - border]);   // 둘레와 범위 밖은 흰 점
  const lines = [];
  for (let r = 0; r < n; r += 2) {
    let line = "";
    for (let c = 0; c < n; c++) {
      const top = at(r, c), bottom = r + 1 < n && at(r + 1, c);
      line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    lines.push(`\x1b[38;5;16;48;5;231m${line}\x1b[0m`);   // 글자색 검정(16), 바탕 흰색(231)
  }
  return lines.join("\n");
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  const text = process.env.PAIR_URL ?? "";
  if (!text) {
    console.error("QR 로 그릴 글이 없어요(환경 변수 PAIR_URL)");
    process.exit(1);
  }
  process.stdout.write(`${renderQr(qrMatrix(text))}\n`);
}
