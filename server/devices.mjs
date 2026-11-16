// 기기별 연결 토큰과, 한 번 쓰는 짝짓기 코드.
// - 짝짓기: 맥의 짝짓기 명령(deploy/pair.sh)이 코드를 만들어 QR 에 담는다(5분 동안, 한 번만 쓸 수 있음).
//   폰이 그 코드를 브리지에 내면 그 폰만의 토큰을 받는다. QR 사진이 새어도 5분 뒤에는 쓸모가 없다
// - 토큰은 맥에 해시(SHA-256)로만 남긴다. 토큰이 256비트 무작위 값이라 해시 하나로 충분하다(파일이 새도 토큰은 알 수 없음)
// - 기기마다 따로 끊을 수 있다(revoke). 짝짓기 명령과 브리지는 서로 다른 프로세스라 파일로 주고받는다:
//   devices.json(등록된 기기), pairing.json(지금 유효한 코드 하나). 둘 다 나만 읽을 수 있게(600)
// 토큰·코드 원문은 어디에도 기록하지 않는다(로그 포함).
// 작성: 서문교
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PAIR_TTL_MS = 5 * 60 * 1000;
const HEX = /^[0-9a-f]+$/;
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
/** 두 16진수 글이 같은지(걸린 시간으로 값을 짐작할 수 없게) */
export function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !HEX.test(a) || !HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
/** 토큰·코드로 쓸 수 있는 모양인지(16진수 32~128자) */
export const looksLikeSecret = (s) => typeof s === "string" && /^[0-9a-fA-F]{32,128}$/.test(s);

/** 기기 저장소. dir: 설정 폴더(기본 ~/.config/pi-remote) */
export function createDeviceStore(dir = `${process.env.HOME}/.config/pi-remote`) {
  const DEVICES = join(dir, "devices.json");
  const PAIRING = join(dir, "pairing.json");
  const read = (file, fallback) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  };
  // 임시 파일에 쓰고 바꿔치기: 쓰다 만 파일이 남지 않게
  const write = (file, data) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const devices = () => (read(DEVICES, {}).devices ?? []).filter((d) => d && typeof d.id === "string" && typeof d.hash === "string");
  const cleanName = (name) => String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60) || "이름 없는 기기";

  return {
    files: { devices: DEVICES, pairing: PAIRING },

    /** 짝짓기 시작: 새 코드를 만들어 돌려준다(앞서 만든 코드는 못 쓰게 됨) */
    startPairing(now = Date.now()) {
      const code = randomBytes(16).toString("hex");
      write(PAIRING, { hash: sha(code), expiresAt: now + PAIR_TTL_MS });
      return { code, expiresAt: now + PAIR_TTL_MS };
    },

    /** 지금 유효한 짝짓기 코드가 있는지(값은 알 수 없음) */
    pairingOpen(now = Date.now()) {
      const p = read(PAIRING, null);
      return Boolean(p && typeof p.hash === "string" && Number(p.expiresAt) > now);
    },

    /**
     * 코드를 내고 기기 토큰 받기 → { id, token } 또는 { error: "invalid" | "expired" }
     * 맞는 코드는 쓰는 순간 없어진다(한 번만). 기한이 지난 코드도 지운다
     */
    redeem(code, name, now = Date.now()) {
      const p = read(PAIRING, null);
      if (!p || typeof p.hash !== "string") return { error: "invalid" };
      if (!(Number(p.expiresAt) > now)) {
        rmSync(PAIRING, { force: true });
        return { error: "expired" };
      }
      if (!looksLikeSecret(code) || !sameHex(sha(String(code).toLowerCase()), p.hash)) return { error: "invalid" };
      rmSync(PAIRING, { force: true });
      return this.add(name, now);
    },

    /** 기기를 등록하고 그 기기의 토큰을 돌려준다(짝짓기 코드 없이 부르는 것은 이미 인증된 연결을 옮길 때만) */
    add(name, now = Date.now()) {
      const token = randomBytes(32).toString("hex");
      const id = `d${randomBytes(4).toString("hex")}`;
      write(DEVICES, { devices: [...devices(), { id, name: cleanName(name), hash: sha(token), createdAt: now }] });
      return { id, token };
    },

    /** 이 토큰의 기기 → { id, name, createdAt } 또는 null */
    verify(token) {
      if (!looksLikeSecret(token)) return null;
      const h = sha(String(token).toLowerCase());
      let found = null;
      // 끝까지 돌며 견준다(일찍 멈추면 몇 번째 기기인지에 따라 시간이 달라짐)
      for (const d of devices()) if (sameHex(h, d.hash)) found = d;
      return found ? { id: found.id, name: found.name, createdAt: found.createdAt } : null;
    },

    /** 그 기기의 토큰만 새로 → { token } 또는 null(없는 기기) */
    rotate(id) {
      const list = devices();
      const d = list.find((x) => x.id === id);
      if (!d) return null;
      const token = randomBytes(32).toString("hex");
      d.hash = sha(token);
      write(DEVICES, { devices: list });
      return { token };
    },

    /** 등록된 기기(토큰 해시는 빼고) */
    list() {
      return devices().map(({ id, name, createdAt }) => ({ id, name, createdAt }));
    },

    /** 기기 끊기: 번호(id)가 같거나 이름이 같은 것 → 끊은 기기들 */
    revoke(idOrName) {
      const list = devices();
      const gone = list.filter((d) => d.id === idOrName || d.name === idOrName);
      if (gone.length) write(DEVICES, { devices: list.filter((d) => !gone.includes(d)) });
      return gone.map(({ id, name }) => ({ id, name }));
    },
  };
}
