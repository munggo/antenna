/**
 * 맥에 뜬 권한 창(macOS 개인정보 보호 확인 창: '…이(가) …에 접근하려고 합니다')을 폰에 알림(사용자 요청 11-19).
 * macOS 는 이 창을 프로그램이 누르지 못하게 막아 둬서 폰에서 대신 허용할 수는 없다. 창이 뜬 탭의 작업은 누를 때까지 멈춰 있으므로
 * 떠 있다는 것과 어느 탭·무슨 권한인지를 알려 맥에서 누르게 한다.
 * - 감지: 화면의 창 목록(CGWindowList)에 알림 창 프로그램(UserNotificationCenter)의 창이 있으면 떠 있는 것.
 *   창 이름은 읽지 않아 화면 기록 권한이 필요 없다(그 검사는 창을 띄우지 않는 확인만 함, 11-19 기록으로 확인)
 * - 무엇을: 직전 2분의 권한 기록(tccd, `log show`)에서 아직 정해지지 않은 요청을 찾아 권한 종류와 요청한 프로그램을 알고,
 *   그 프로그램의 부모를 거슬러 tmux 탭을 찾는다. 못 찾으면 일반 알림
 * - 맥을 쓰는 중이면 보내지 않고 기다렸다가, 창이 남은 채 맥을 안 쓰게 되면 보낸다. 한 번 뜬 창에는 한 번만 알린다
 * 작성: 서문교
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

const OWNER = "UserNotificationCenter";
const JXA = `ObjC.import("CoreGraphics");
const ws = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID))) || [];
JSON.stringify(ws.map((w) => ({ owner: w.kCGWindowOwnerName, w: Math.round(w.kCGWindowBounds.Width), h: Math.round(w.kCGWindowBounds.Height) })));`;

/** 권한 기록에서 늘 나오지만 창을 띄우지 않는 확인(osascript 가 켜질 때마다 하는 입력 감시 확인, 묻지 않는 전체 디스크 확인) */
const NOISE = new Set(["kTCCServiceListenEvent", "kTCCServiceSystemPolicyAllFiles", "kTCCServiceDeveloperTool"]);
/** osascript 가 켜질 때마다 창 없이 하는 확인(11-19 기록: 실행마다 화면 기록 확인이 남음) */
const OSA_PREFLIGHT = new Set(["kTCCServiceScreenCapture", "kTCCServicePostEvent"]);
const noise = (x) => NOISE.has(x.service) || (OSA_PREFLIGHT.has(x.service) && /\/osascript$/.test(x.binary ?? ""));

const LABELS = {
  kTCCServiceSystemPolicyDesktopFolder: "데스크탑 폴더 접근",
  kTCCServiceSystemPolicyDocumentsFolder: "문서 폴더 접근",
  kTCCServiceSystemPolicyDownloadsFolder: "다운로드 폴더 접근",
  kTCCServiceSystemPolicyNetworkVolumes: "네트워크 드라이브 접근",
  kTCCServiceSystemPolicyRemovableVolumes: "외장 저장 장치 접근",
  kTCCServiceSystemPolicyAppData: "다른 앱의 데이터 접근",
  kTCCServiceSystemPolicyAppDataDetailed: "다른 앱의 데이터 접근",
  kTCCServiceSystemPolicyAppBundles: "앱 수정·삭제",
  kTCCServiceFileProviderDomain: "iCloud Drive 같은 파일 저장소 접근",
  kTCCServicePhotos: "사진 접근",
  kTCCServicePhotosAdd: "사진 추가",
  kTCCServiceAddressBook: "연락처 접근",
  kTCCServiceCalendar: "캘린더 접근",
  kTCCServiceReminders: "미리 알림 접근",
  kTCCServiceMediaLibrary: "미디어 보관함 접근",
  kTCCServiceCamera: "카메라 사용",
  kTCCServiceMicrophone: "마이크 사용",
  kTCCServiceScreenCapture: "화면 기록",
  kTCCServiceAccessibility: "손쉬운 사용(키보드·마우스 제어)",
  kTCCServicePostEvent: "키보드·마우스 제어",
};
const APPS = {
  "com.apple.finder": "Finder",
  "com.apple.systemevents": "System Events",
  "com.apple.Safari": "Safari",
  "com.apple.Terminal": "터미널",
  "com.apple.Photos": "사진",
  "com.apple.Notes": "메모",
  "com.apple.reminders": "미리 알림",
  "com.apple.iCal": "캘린더",
  "com.apple.mail": "메일",
  "com.apple.MobileSMS": "메시지",
  "com.apple.Music": "음악",
  "com.google.Chrome": "Chrome",
  "com.googlecode.iterm2": "iTerm",
};

/** 요청 → 사람이 읽는 권한 이름 */
export function labelOf(req) {
  if (!req) return "";
  if (req.service === "kTCCServiceAppleEvents") return `${APPS[req.target] ?? req.target ?? "다른 앱"} 제어`;
  return LABELS[req.service] ?? req.service.replace(/^kTCCService/, "");
}

/** 창 목록 중 권한 창(알림 창 프로그램의, 작은 표시가 아닌 창) */
export function promptWindows(list) {
  return (Array.isArray(list) ? list : []).filter((w) => w?.owner === OWNER && w.w >= 200 && w.h >= 100);
}

const stamp = (s) => Date.parse(String(s ?? "").replace(" ", "T").replace(/(\.\d{3})\d*/, "$1").replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) || 0;

/**
 * `log show --style ndjson` 의 tccd 기록 → 아직 정해지지 않은 요청 [{ t, service, target?, pid, binary }] (오래된 것부터)
 * - 파일·사진 등: 'Handling access request to <권한>, from …Resp:{… pid=…, binary_path=…}, ReqResult(Auth Right: Unknown …'
 * - 다른 앱 제어: 'Handling access request: kTCCServiceAppleEvents:<…>:<대상 앱>, … authValue: N,' 뒤에
 *   같은 실(thread)의 'AttributionChain: responsible={… pid=…, binary_path=…}' (11-19 Finder 제어 창 기록으로 확인)
 * skip: 빼고 볼 프로그램 번호(감지에 쓴 osascript 등)
 */
export function parseRequests(text, skip = new Set()) {
  const out = [];
  const pending = new Map();
  for (const line of String(text ?? "").split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const m = String(e?.eventMessage ?? "");
    const t = stamp(e.timestamp);
    const thread = `${e.processID}:${e.threadID}`;
    let r = m.match(/^Handling access request to (kTCCService\w+), from .*?Resp:\{TCCDProcess: identifier=[^,]*, pid=(\d+),.*?binary_path=([^}]*)\}, ReqResult\(Auth Right: (\w+)/);
    if (r) {
      if (r[4] === "Unknown") out.push({ t, service: r[1], pid: Number(r[2]), binary: r[3] });
      continue;
    }
    r = m.match(/^Handling access request: (kTCCService\w+):[^:]*:([^,\s]+), .*?authValue: (\d+)/);
    if (r) {
      if (r[3] !== "0" && r[3] !== "2") pending.set(thread, { t, service: r[1], target: r[2] });   // 0 거부·2 허용은 이미 정해짐
      continue;
    }
    r = m.match(/^AttributionChain: responsible=\{TCCDProcess: identifier=[^,]*, pid=(\d+),.*?binary_path=([^}]*)\}/);
    const p = pending.get(thread);
    if (r && p) {
      pending.delete(thread);
      if (t - p.t < 2000) out.push({ ...p, pid: Number(r[1]), binary: r[2] });
    }
  }
  return out.filter((x) => !noise(x) && !skip.has(x.pid));
}

/** 알림 글: { title, body, window } */
export function promptMessage(req, tab) {
  const who = tab ? `'${tab.name}' 탭(${tab.index}번)이 ` : "";
  const what = req ? `${labelOf(req)} 권한을 기다려요` : "권한 창이 답을 기다려요";
  return {
    title: "맥에 권한 창이 떠 있어요",
    body: `${who}${what}. 맥에서 '허용'이나 '허용 안 함'을 눌러야 작업이 이어져요`,
    window: tab ? tab.index : undefined,
  };
}

/**
 * 감시: tick() 을 주기적으로 부른다.
 * listWindows() → 창 목록 | null(못 읽음), requests(since) → 요청 목록, tabOf(pid) → { index, name } | null,
 * inUse() → 맥을 쓰는 중인지, send({ title, body, window }) → 알림
 */
export function createPromptWatch({ listWindows, requests, tabOf, inUse, send, now = Date.now }) {
  let shownAt = 0;
  let shownKey = "";
  let sent = false;
  let busy = false;
  return async function tick() {
    if (busy) return;
    busy = true;
    try {
      const wins = await listWindows();
      if (!wins) return;
      const ps = promptWindows(wins);
      const key = ps.map((w) => `${w.w}x${w.h}`).join(",");
      if (!ps.length) {
        shownAt = 0;
        shownKey = "";
        sent = false;
        return;
      }
      if (!shownAt || key !== shownKey) {   // 새로 떴거나 다른 창으로 바뀜
        shownAt = now();
        shownKey = key;
        sent = false;
      }
      if (sent || inUse()) return;
      sent = true;
      let req = null;
      let tab = null;
      try {
        // 창이 뜨기 전, 최근 것부터. 탭에서 온 요청만 쓴다(그 밖의 기록은 창 없는 확인이 많아 엉뚱한 이름이 붙음, 11-19 실제 맥 시험)
        const reqs = (await requests()).filter((r) => r.t <= shownAt + 2000).reverse();
        for (const r of reqs) {
          const tb = await tabOf(r.pid);
          if (tb) {
            req = r;
            tab = tb;
            break;
          }
        }
      } catch {
        /* 무엇인지 모르면 일반 알림 */
      }
      await send(promptMessage(req, tab));
    } finally {
      busy = false;
    }
  };
}

// --- 실제 맥에서 읽기 ---

const own = new Set();   // 감지에 쓴 osascript 번호(권한 기록에서 뺌)
function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    const c = execFile(cmd, args, { encoding: "utf8", timeout, maxBuffer: 64 << 20 }, (err, out) => resolve(err ? null : out));
    if (cmd.endsWith("osascript") && c.pid) {
      own.add(c.pid);
      if (own.size > 64) own.delete(own.values().next().value);
    }
  });
}

/** 화면의 창 목록. 시험: PI_REMOTE_FAKE_WINDOWS_FILE(JSON 배열) */
export async function readWindows() {
  const fake = process.env.PI_REMOTE_FAKE_WINDOWS_FILE;
  try {
    if (fake) return JSON.parse(readFileSync(fake, "utf8"));
    const out = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", JXA], 10_000);
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

/** 직전 2분의 권한 요청. 시험: PI_REMOTE_FAKE_TCC_LOG_FILE(ndjson) */
export async function readRequests() {
  const fake = process.env.PI_REMOTE_FAKE_TCC_LOG_FILE;
  let text = null;
  try {
    text = fake
      ? readFileSync(fake, "utf8")
      : await run("/usr/bin/log", ["show", "--last", "2m", "--info", "--style", "ndjson", "--predicate",
          'process == "tccd" AND (eventMessage BEGINSWITH "Handling access request" OR eventMessage BEGINSWITH "AttributionChain: responsible=")'], 30_000);
  } catch {
    /* 못 읽음 */
  }
  return parseRequests(text, own);
}

/** 프로그램 번호 → 그 프로그램이 도는 tmux 탭. panes: [{ pid, index, name }], parents: Map(pid → 부모 pid) */
export function findTab(pid, panes, parents) {
  const byPid = new Map(panes.map((p) => [p.pid, p]));
  for (let p = pid, n = 0; p > 1 && n < 40; p = parents.get(p) ?? 0, n++) {
    const hit = byPid.get(p);
    if (hit) return { index: hit.index, name: hit.name };
  }
  return null;
}

/** 실제 tmux·ps 로 탭 찾기 */
export function tabFinder(tmuxBin, session) {
  return async (pid) => {
    const [ps, panes] = await Promise.all([
      run("/bin/ps", ["-axo", "pid=,ppid="], 5000),
      run(tmuxBin, ["list-panes", "-s", "-t", session, "-F", "#{pane_pid}\t#{window_index}\t#{window_name}"], 5000),
    ]);
    if (!ps || !panes) return null;
    const parents = new Map(ps.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)));
    const list = panes.trim().split("\n").map((l) => {
      const [p, i, ...name] = l.split("\t");
      return { pid: Number(p), index: Number(i), name: name.join("\t") };
    });
    return findTab(pid, list, parents);
  };
}
