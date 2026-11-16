#!/usr/bin/env node
/**
 * 짝짓기 명령(deploy/pair.sh)이 부르는 도우미: 짝짓기 코드 만들기, 등록된 기기 보기·끊기.
 *   node deploy/devices-cli.mjs start            새 짝짓기 코드를 만들어 한 줄로 냄(5분, 한 번만 쓸 수 있음)
 *   node deploy/devices-cli.mjs fingerprint      이 맥의 인증서 지문(폰이 이 맥만 믿게 QR 에 담음)
 *   node deploy/devices-cli.mjs list             등록된 기기
 *   node deploy/devices-cli.mjs revoke <번호|이름>  그 기기 끊기(붙어 있던 연결도 1분 안에 닫힘)
 * 설정 폴더는 브리지와 같은 곳(설정 파일 PI_REMOTE_ENV 가 있는 폴더, 기본 ~/.config/pi-remote)
 * 작성: 서문교
 */
import { dirname, join } from "node:path";
import { createDeviceStore } from "../server/devices.mjs";
import { ensureCert } from "../server/tls.mjs";

const CONFIG_DIR = dirname(process.env.PI_REMOTE_ENV || `${process.env.HOME}/.config/pi-remote/env`);
const store = createDeviceStore(CONFIG_DIR);
const [cmd, arg] = process.argv.slice(2);
const when = (ms) => new Date(ms).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

if (cmd === "start") {
  process.stdout.write(`${store.startPairing().code}\n`);
} else if (cmd === "fingerprint") {
  // 이 맥의 인증서 지문(없으면 인증서를 만든다. 브리지가 쓰는 것과 같은 파일). 만들지 못하면 빈 줄
  process.stdout.write(`${ensureCert(join(CONFIG_DIR, "tls"))?.fingerprint ?? ""}\n`);
} else if (cmd === "list") {
  const list = store.list();
  if (!list.length) console.log("등록된 기기가 없어요.");
  for (const d of list) console.log(`${d.id}  ${d.name}  (짝지은 때 ${when(d.createdAt)})`);
} else if (cmd === "revoke" && arg) {
  const gone = store.revoke(arg);
  if (!gone.length) {
    console.error(`그런 기기가 없어요: ${arg}`);
    process.exit(1);
  }
  for (const d of gone) console.log(`끊었어요: ${d.id} ${d.name}`);
} else {
  console.error("쓰기: node deploy/devices-cli.mjs start | fingerprint | list | revoke <번호|이름>");
  process.exit(2);
}
