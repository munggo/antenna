// 폰이 같은 Wi-Fi 밖에서 붙을 맥 주소(PI_REMOTE_HOSTS: VPN·Tailscale 주소)가 지금 이 맥에 올라와 있는지 본다.
// 재부팅 점검 알림이 "밖에서도 붙을 수 있는지"를 알려 주는 데 쓴다.
// 작성: 서문교
import { networkInterfaces } from "node:os";

/** 이 맥에 올라와 있는 주소 */
export const localAddresses = () => Object.values(networkInterfaces()).flat().map((i) => i?.address).filter(Boolean);

/** 쉼표로 적은 주소 목록 → 배열 */
export const parseHosts = (s) => String(s ?? "").split(",").map((h) => h.trim()).filter(Boolean);

/** 숫자 주소(IPv4·IPv6)인지. 이름(mac.example.com 등)은 이 맥의 주소인지 알 수 없다 */
export const isAddress = (h) => /^[0-9.]+$/.test(h) || h.includes(":");

/**
 * 밖에서 붙을 길이 살아 있는지
 * - prefix(예전 설정 PI_REMOTE_VPN_PREFIX)가 있으면: 그 글자로 시작하는 주소가 이 맥에 있는지
 * - 아니면: hosts 의 숫자 주소 가운데 하나라도 이 맥에 올라와 있는지
 * 반환: true | false | null(볼 주소가 없음: 주소를 적지 않았거나 이름만 적음 → 알림에서 말하지 않음)
 */
export function outsideReach({ hosts = [], addrs = localAddresses(), prefix = "" } = {}) {
  if (prefix) return addrs.some((a) => a.startsWith(prefix));
  const nums = hosts.filter(isAddress).map((h) => h.toLowerCase());
  if (!nums.length) return null;
  const mine = new Set(addrs.map((a) => a.toLowerCase()));
  return nums.some((h) => mine.has(h));
}

/** 재부팅 점검 알림에 붙일 글(앞에 구분점 포함). 볼 주소가 없으면 빈 글 */
export const reachText = (reach) =>
  reach === null ? "" : ` · ${reach ? "VPN 연결됨" : "VPN 연결 안 됨(밖에서는 접속이 안 될 수 있어요)"}`;
