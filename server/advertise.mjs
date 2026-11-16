// 같은 Wi-Fi 에서 폰이 주소 없이 맥을 찾게 하는 자동 발견(Bonjour) 광고: _piremote._tcp
//
// 이 모듈(bonjour-service)은 오류를 받을 곳을 주지 않으면 송신 실패를 그대로 던진다. 그래서 네트워크가 잠깐 끊긴 순간
// (Wi-Fi 전환·VPN 다시 붙기·잠자기에서 깸)의 실패 하나로 브리지 전체가 죽었다(2026-11: 기록에 4번, 모두
// 'send EADDRNOTAVAIL/EHOSTUNREACH 224.0.0.251:5353'). 여기서는 오류를 기록만 하고 계속 돈다.
// 네트워크가 돌아오면 아래 모듈(multicast-dns)이 5초마다 스스로 새 네트워크에 다시 붙으므로 따로 다시 올릴 필요는 없다.
import { hostname } from "node:os";
import { Bonjour } from "bonjour-service";

/** 광고를 올린다. 돌려주는 stop() 으로 내린다. name 은 시험에서만 바꾼다 */
export function advertise({ port, session, name = `pi-remote (${hostname()})`, log = console }) {
  let last = 0;
  let skipped = 0;
  // 같은 오류가 이어질 수 있어 1분에 한 번만 적는다
  const onError = (err) => {
    const now = Date.now();
    if (now - last < 60_000) {
      skipped++;
      return;
    }
    log.warn(`[pi-remote] 자동 발견(Bonjour) 오류(브리지는 계속 동작): ${err?.message ?? err}${skipped ? ` · 그 사이 ${skipped}번 더` : ""}`);
    last = now;
    skipped = 0;
  };
  const bonjour = new Bonjour({}, onError);   // 질의에 답하다 난 송신 실패
  try {
    bonjour.server?.mdns?.on("error", onError);   // 소켓 자체의 오류(포트를 못 여는 경우 등). 받을 곳이 없으면 던져진다
  } catch {
    /* 모듈 안쪽 모양이 바뀌어도 광고는 계속 */
  }
  const service = bonjour.publish({ name, type: "piremote", port, txt: { session } });   // → _piremote._tcp
  service.on("up", () => log.log(`[pi-remote] Bonjour 광고 시작: _piremote._tcp 포트 ${port}`));
  service.on("error", onError);   // 이름이 겹칠 때 등
  return {
    bonjour,
    service,
    stop() {
      try {
        bonjour.unpublishAll(() => bonjour.destroy());
      } catch {
        /* 이미 내려감 */
      }
    },
  };
}
