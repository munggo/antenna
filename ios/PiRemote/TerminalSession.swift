import Combine
import Foundation
import Network
import SwiftTerm
import UIKit

/// tmux 창 하나. 상단 탭바에서 쓴다.
struct TmuxWindow: Identifiable, Equatable {
    let index: Int
    let name: String
    let active: Bool
    /// pi 상태(맥 tmux 탭 확장이 기록): working | asking(답을 기다림) | yourturn(끝남, 아직 안 봄) | ""
    var status: String = ""
    /// 관리자 권한 확인 창(🔐sudo)의 단계(맥의 창 스크립트가 기록): confirm(실행할지 확인) | running(실행 중) | done | ""(모름·그 창이 아님)
    var sudo: String = ""
    /// 백그라운드 탭(맥 /bgtab·AI·폰이 맡긴 일을 하는 탭)의 정보. 보통 탭이면 nil
    var bg: BackgroundInfo? = nil
    /// 이 탭 안에서 뒤에서 도는 일(Claude Code 의 셸·에이전트). 예: "셸 1개". 없으면 ""
    var jobs: String = ""
    /// 이 탭의 모델(예: "Opus 5.5")과 생각 깊이(high 등). 모르면 "". 서랍의 백그라운드 탭 줄에 보임
    var model: String = ""
    var thinking: String = ""
    /// Claude Code 탭의 계정(맥 연결부가 적음, 11-18). Claude Code 탭이 아니거나 모르면 nil
    var account: TabAccount? = nil
    /// 탭 칸 번호(%12 처럼). 폰이 탭마다 대화를 저장하는 열쇠(11-25). 예전 맥은 주지 않음("")
    var key: String = ""
    var id: Int { index }

    /// '끝난 것 모두 닫기'로 닫을 탭: 결과를 보냈고, 다시 일하거나 묻지 않으며, 뒤에서 도는 일도 없음(맥 브리지 server/windows.mjs 와 같은 규칙)
    var finishedBackground: Bool {
        (bg?.done ?? 0) > 0 && status != "working" && status != "asking" && jobs.isEmpty
    }
}

/// 새 탭에서 켤 수 있는 도구(사용자 결정 11-18: 열 때마다 고름). 이름은 맥 브리지(server/bridge.mjs 의 NEW_TAB_TOOLS)와 같다.
/// Codex·Gemini CLI 는 맥 쪽 연결 프로그램이 없어 채팅 화면 없이 터미널 화면으로 쓴다
enum TabTool: String, Identifiable {
    case claude, pi, codex, gemini
    var id: String { rawValue }
    var title: String {
        switch self {
        case .claude: return "Claude Code"
        case .pi: return "pi"
        case .codex: return "Codex"
        case .gemini: return "Gemini CLI"
        }
    }
}

/// 맥북의 배터리·충전 상태(맥 브리지가 1분마다 읽어 탭 목록 메시지에 얹어 보냄, server/battery.mjs). 배터리가 없는 맥이면 오지 않는다
struct MacBattery: Equatable {
    let percent: Int
    /// 충전기를 꽂았는지
    let plugged: Bool
    /// 충전기 없이 기준(맥이 정함, 20%) 아래
    let low: Bool
}

/// 백그라운드 탭 정보(맥 브리지가 탭 옵션에서 읽어 탭 목록과 함께 보냄)
/// Claude Code 탭의 계정(사용자 결정 11-18: 탭마다 고르기 · 일하는 중이면 끝나면 바꾸기. 11-24: 한도 95% 면 자동으로 넘기지 않고 카드로 물음).
/// 값은 work | personal | personal2(추가 개인, 11-25). 맥 브리지 server/windows.mjs 의 account 와 같은 모양
struct TabAccount: Equatable {
    /// 지금 이 탭의 Claude Code 가 쓰는 계정
    let now: String
    /// 앱에서 고른 계정(빈 값이면 자동: 폴더 기본·한도 기준)
    let pin: String
    /// 바꿀 계정(빈 값이면 바꿀 일 없음)
    let next: String
    /// wait: 하던 일이 끝나기를 기다림 | switch: 인수인계 문서를 받고 다시 켜는 중 | ""
    let phase: String

    static func name(_ a: String) -> String { a == "work" ? String(localized: "회사") : a == "personal2" ? String(localized: "추가 개인") : String(localized: "개인") }
}

struct BackgroundInfo: Equatable {
    /// 시킨 쪽: user(맥에서 /bgtab) | ai(AI 가 맡김) | phone(폰에서 '백그라운드로 보내기') | shortcut(단축어 동작)
    let by: String
    /// 시작·끝(결과를 보낸 때) 시각(1970년부터 초). 아직 안 끝났으면 done 은 0
    let started: Int
    let done: Int
    /// 시킨 탭 번호·이름(그 탭이 닫혔거나 모르면 nil·"")
    let from: Int?
    let fromName: String
}

/// 출력 전용 터미널: 탭해도 키보드가 뜨지 않도록 firstResponder 를 거부한다.
/// (입력은 하단 입력바만 담당)
final class OutputOnlyTerminalView: TerminalView {
    override var canBecomeFirstResponder: Bool { false }

    /// 채팅 화면 뒤에 숨어 있는 동안에는 커서를 깜빡이지 않게 한다(false).
    /// 깜빡임은 끝없이 도는 애니메이션이라 보이지 않는데도 계속 돌았다(화면 자동 시험이 동작마다 멈추던 원인).
    /// 다시 보이면 맥 쪽이 정한 모양으로 되돌린다.
    var cursorBlinks = true {
        didSet {
            guard cursorBlinks != oldValue else { return }
            let term = getTerminal()
            let want = hostStyle ?? term.options.cursorStyle
            hostStyle = want
            applying = true
            term.setCursorStyle(cursorBlinks ? want : want.steady)
            applying = false
        }
    }
    /// 맥 쪽 프로그램이 정한 커서 모양(깜빡임 포함)
    private var hostStyle: CursorStyle?
    /// 이 뷰가 스스로 모양을 바꾸는 중(맥 쪽 요청과 구분)
    private var applying = false

    override func cursorStyleChanged(source: Terminal, newStyle: CursorStyle) {
        if applying { return super.cursorStyleChanged(source: source, newStyle: newStyle) }
        hostStyle = newStyle
        if cursorBlinks || newStyle == newStyle.steady { return super.cursorStyleChanged(source: source, newStyle: newStyle) }
        // 숨어 있는 동안 맥 쪽이 깜빡이는 모양을 정하면 기억만 하고, 같은 모양의 깜빡이지 않는 것으로 둔다
        applying = true
        source.setCursorStyle(newStyle.steady)
        applying = false
    }
}

private extension CursorStyle {
    /// 같은 모양의 깜빡이지 않는 것
    var steady: CursorStyle {
        switch self {
        case .blinkBlock: return .steadyBlock
        case .blinkUnderline: return .steadyUnderline
        case .blinkBar: return .steadyBar
        default: return self
        }
    }
}

/// SwiftTerm 터미널 뷰와 WebSocket 연결을 소유하고 양쪽을 중계한다.
/// - 집/밖 후보 주소를 동시에 시도해 먼저 열리는 쪽을 사용(나머지는 취소).
/// - 연결이 끊기면 자동으로 후보들을 다시 시도(재연결).
final class TerminalSession: NSObject, ObservableObject {
    enum Status: Equatable {
        case idle, connecting, connected, closed
        case failed(String)
    }

    @Published var status: Status = .idle
    @Published var activeHost: String?
    @Published var windows: [TmuxWindow] = []   // 상단 탭바용 tmux 창 목록
    @Published var macBattery: MacBattery?      // 맥북 배터리(화면 위 '연결됨' 옆). 배터리 없는 맥·예전 브리지면 nil
    @Published var inputFocused: Bool = false    // 입력바 키보드 포커스(터미널 탭으로 내림)
    @Published var scrolledUp: Bool = false      // 위로 스크롤 중(→ 맨아래로 버튼 표시)
    @Published var attachments: [Attachment] = [] // 입력창에 붙인 사진(미리 올리는 중/완료/실패)
    /// 말풍선·답변 속 사진 썸네일
    let thumbs = ThumbStore()
    @Published var models: [String] = []         // 선택 가능한 모델(provider/id)
    @Published var piModel: String = ""          // 현재 모델 표시명(예: Opus)
    @Published var piThinking: String = ""       // 현재 생각 깊이(예: xhigh)
    @Published var piWorking: Bool = false       // pi 가 작업 중인지(화면 읽기 기준, 채팅 불가 시 사용)
    /// 지난 대화 목록(nil = 아직 못 받음)과 창 표시 여부(… 메뉴·/resume 에서 엶)
    @Published var pastSessions: [PastSession]?
    @Published var pastSessionsError: String?
    @Published var showSessions = false
    /// 폰 알림: 맥에 알림 설정이 있는지, '작업이 끝났을 때도 알림' 켜짐 여부
    @Published var pushOnMac = false
    @Published var pushDone = true
    /// 이보다 오래 걸린 작업이 끝났을 때만 알림(초, 맥 브리지 설정)
    @Published var pushDoneMinSec = 3600
    private var pushSubs = Set<AnyCancellable>()
    /// 새 탭에서 고를 수 있는 도구(맥 브리지가 탭 목록과 함께 알려 줌). 비어 있으면 예전 브리지라 고르지 않고 연다
    @Published var newTabTools: [TabTool] = []
    @Published var chatAvailable = false         // 대화 피드(채팅 화면) 사용 가능 여부
    @Published var chatWorking = false           // 대화 피드 기준 작업 중 여부

    /// Claude 요금제 사용량(… 메뉴 → 사용량)
    @Published var usage: UsageInfo?
    @Published var usageLoading = false

    /// 채팅 화면용 대화 내용
    let chat = ChatStore()

    /// 작업 중 여부: 대화 피드가 있으면 그걸(정확), 없으면 화면 읽기 값
    var isWorking: Bool { chatAvailable ? chatWorking : piWorking }

    static let thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

    let terminalView: TerminalView

    private var urlSession: URLSession!
    private var candidates: [URLSessionWebSocketTask] = []
    private var active: URLSessionWebSocketTask?
    private var settings: ConnectionSettings?
    private var discovered: [String] = []
    private var shouldReconnect = false
    private var failCount = 0                     // 연속 실패 횟수(재연결 간격을 점점 늘림)
    private var retryWork: DispatchWorkItem?
    private let pathMonitor = NWPathMonitor()     // 네트워크가 바뀌면(Wi-Fi↔LTE, VPN) 바로 재연결
    private var reconnecting = false

    override init() {
        terminalView = OutputOnlyTerminalView(frame: .zero)
        super.init()
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async { self?.retryNow() }
        }
        pathMonitor.start(queue: DispatchQueue(label: "pi-remote.path"))
        thumbs.fetch = { [weak self] path, size in
            if path.hasPrefix("toolimg-") {
                // 도구가 읽은 사진: 맥 파일이 아니라 대화 기록에서 꺼내 온다(원본 요청은 큰 그림으로 대신)
                if size == .large { self?.sendControl(["type": "toolimage", "id": String(path.dropFirst(8))]) }
                return
            }
            self?.sendControl(["type": "thumb", "path": path, "size": size.rawValue])
        }
        // 저장된 대화가 있으면 바로 채팅 화면으로 시작(터미널이 잠깐 보이는 것 방지)
        chat.loadCache()
        chatAvailable = chat.available
        chat.onResync = { [weak self] key in
            guard let self, self.bridgeKnowsTabs else { return }
            self.sendControl(["type": "chat-resync", "key": key])
        }
        chat.onToolImage = { [weak self] id, data, error in
            guard let self else { return }
            let path = "toolimg-\(id)"
            if let data {
                self.thumbs.store(path, .large, data: data)
            } else if (error ?? "").contains("찾지 못") || (error ?? "").contains("not found") {   // 맥 글이 영어(PI_REMOTE_LANG=en)면 'not found'
                self.thumbs.markMissing(path)
            } else {
                self.thumbs.forget(path, .large)   // 연결 문제 → 다음에 다시 요청
            }
        }
        // 알림: 기기 주소가 생기면 등록, 알림을 누르면 그 탭으로
        PushManager.shared.$token
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.registerPush() }
            .store(in: &pushSubs)
        PushManager.shared.$pendingWindow
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.openPendingWindow() }
            .store(in: &pushSubs)
        chat.onStateChange = { [weak self] available, working in
            guard let self else { return }
            if self.chatAvailable != available { self.chatAvailable = available }
            if self.chatWorking != working { self.chatWorking = working }
        }
        terminalView.terminalDelegate = self
        // 폰에선 마우스 리포팅을 꺼서 드래그가 tmux 선택이 아니라 스크롤이 되게 한다.
        // (맥 iTerm 의 tmux mouse 설정은 그대로 유지됨)
        terminalView.allowMouseReporting = false
        terminalView.installColors(Theme.terminalColors())
        terminalView.nativeBackgroundColor = Theme.uiBg
        terminalView.nativeForegroundColor = Theme.uiText
        terminalView.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 8   // 안 닿는 후보는 8초 안에 실패시켜 빠르게 전환
        urlSession = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }

    /// 연결 토큰 새로 바꾸기(브리지가 만들어 이 폰에만 보냄)
    func rotateToken() { sendControl(["type": "rotate-token"]) }

    func connect(using settings: ConnectionSettings) {
        self.settings = settings
        pinnedFingerprint = settings.fingerprint
        shouldReconnect = true
        openCandidates()
    }

    /// 지금 연결이 믿는 맥 인증서 지문(연결 대리자가 다른 큐에서 읽으므로 연결을 열 때 옮겨 둠). 비어 있으면 암호화 없는 예전 방식
    private var pinnedFingerprint = ""

    /// Bonjour 로 발견된 host 목록 갱신. 아직 연결 전이면 새 후보를 포함해 재시도.
    func setDiscovered(_ hosts: [String]) {
        discovered = hosts
        if active == nil, shouldReconnect { openCandidates() }
    }

    func disconnect() {
        shouldReconnect = false
        active?.cancel(with: .goingAway, reason: nil)
        cancelCandidates()
        active = nil
        setStatus(.closed)
        DispatchQueue.main.async { self.activeHost = nil; self.windows = []; self.chat.markDisconnected() }
    }

    /// 특수키 바 등에서 임의 바이트를 서버로 전송.
    func sendBytes(_ bytes: [UInt8]) {
        active?.send(.data(Data(bytes))) { _ in }
    }

    /// 지금 보는 탭이 관리자 권한 확인 창(맥이 여는 🔐sudo 탭)이면 그 단계, 아니면 nil.
    /// confirm: 실행할지 확인(버튼) · running: 실행 중(비밀번호를 물으면 가려진 칸에 넣음) · done: 끝남
    /// unknown: 단계를 알려 주지 않는 예전 맥 쪽(창 스크립트·브리지) → 가려진 칸 하나로 모두 처리
    var secretStage: String? {
        guard let w = windows.first(where: { $0.active }), w.name.hasPrefix("🔐") else { return nil }
        return w.sudo.isEmpty ? "unknown" : w.sudo
    }
    var isSecretTab: Bool { secretStage != nil }
    /// 지금 보는 탭이 로그인 비밀번호 받기 창(🔐암호, 맥의 password-run.mjs 가 엶)인지. 가려진 칸에 아이폰 '암호' 자동 채우기를 띄운다
    var isPasswordTab: Bool { windows.first(where: { $0.active })?.name.hasPrefix("🔐암호") ?? false }

    /// 관리자 권한 확인 창에 넣는 입력: 글자 그대로와 Enter 만 보낸다(말풍선·기록 없음). 빈 글이면 Enter 만
    func sendSecret(_ text: String) {
        sendBytes(Array(text.utf8) + [0x0d])
    }

    /// 입력바에서 작성한 긴 텍스트를 한 번에 전송.
    /// bracketed paste 로 감싸 멀티라인이 중간에 전송되지 않게 하고, 마지막에 Enter.
    func sendText(_ text: String, submit: Bool = true) {
        guard !text.isEmpty else { return }
        var bytes = Array("\u{1b}[200~".utf8)
        bytes.append(contentsOf: Array(text.utf8))
        bytes.append(contentsOf: Array("\u{1b}[201~".utf8))
        if submit { bytes.append(0x0d) }   // Enter
        sendBytes(bytes)
        DispatchQueue.main.async { self.scrolledUp = false }  // 전송하면 최신으로
        // 채팅 화면이면 보낸 즉시 내 말풍선을 띄운다(명령 / 와 셸 ! 은 대화 메시지가 아니므로 제외)
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if submit, chatAvailable, !t.hasPrefix("/"), !t.hasPrefix("!") {
            chat.addPending(t, mode: isWorking ? "steer" : nil)
        }
    }

    /// 상단 탭 터치 → tmux 창 전환 요청.
    /// 탭마다 대화를 저장하는 맥이면 그 탭의 저장해 둔 대화를 바로 보여 주고, 가진 지문을 함께 보내 없는 것만 받는다(11-25)
    func selectWindow(_ index: Int) {
        var msg: [String: Any] = ["type": "select-window", "index": index]
        if bridgeKnowsTabs, let w = windows.first(where: { $0.index == index }), !w.key.isEmpty, !w.active {
            msg["key"] = w.key
            msg["have"] = chat.tabs.have(w.key)
            chat.showTab(key: w.key, name: w.name, working: w.status == "working", byTap: true)
        }
        sendControl(msg)
    }

    // MARK: - 탭마다 저장해 둔 대화·바뀐 탭 미리 받기(11-25 사용자 결정: 상태가 바뀐 탭과 앱을 열 때 모든 탭의 새 메시지만)

    /// 이 연결의 맥이 탭 칸 번호를 주는지 = 새 메시지(chat-have·chat-prefetch·chat-resync)를 알아듣는지.
    /// 예전 맥 브리지는 모르는 메시지를 터미널에 글자로 넣으므로 이때만 보낸다
    private var bridgeKnowsTabs = false
    /// 이 연결에서 지금 탭의 가진 지문을 알렸는지(맥은 이것을 받아야 대화 피드에 붙음)
    private var announced = false
    /// 칸 번호 → 지난 탭 상태(바뀌면 그 탭을 미리 받음)
    private var lastTabStatus: [String: String] = [:]
    private var prefetchQueue: [String] = []
    private var prefetching: String?
    /// 이 연결에서 모든 탭을 한 번 미리 받기 시작했는지
    private var prefetchedAll = false
    /// 대화 피드가 없는 탭(셸 등). 상태가 생기면(AI 를 켬) 다시 본다
    private var noChatTabs = Set<String>()

    /// 연결이 새로 열림: 이 연결의 상태를 처음으로
    private func resetTabSync() {
        bridgeKnowsTabs = false
        announced = false
        lastTabStatus = [:]
        prefetchQueue = []
        prefetching = nil
        prefetchedAll = false
    }

    private func tabsUpdated(_ wins: [TmuxWindow]) {
        bridgeKnowsTabs = wins.contains { !$0.key.isEmpty }
        guard bridgeKnowsTabs else { return }
        let current = wins.first(where: \.active)
        if let a = current, !a.key.isEmpty {
            chat.followTab(key: a.key, name: a.name, working: a.status == "working")
        }
        if !announced {
            announced = true
            let key = current?.key ?? ""
            sendControl(["type": "chat-have", "key": key, "have": key.isEmpty ? [] : chat.tabs.have(key)])
        }
        for w in wins where !w.key.isEmpty {
            if !w.status.isEmpty { noChatTabs.remove(w.key) }
            if let old = lastTabStatus[w.key], old != w.status, !w.active { enqueuePrefetch(w.key) }
            lastTabStatus[w.key] = w.status
        }
        if !prefetchedAll {
            prefetchedAll = true
            // 지금 탭의 대화를 먼저 받도록 조금 뒤에
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                guard let self, self.bridgeKnowsTabs else { return }
                for w in self.windows where !w.active { self.enqueuePrefetch(w.key) }
            }
        }
    }

    private func enqueuePrefetch(_ key: String) {
        guard !key.isEmpty, !noChatTabs.contains(key), !prefetchQueue.contains(key),
              let w = windows.first(where: { $0.key == key }), !w.active, !w.name.hasPrefix("🔐") else { return }
        prefetchQueue.append(key)
        pumpPrefetch()
    }

    /// 한 번에 한 탭씩(지금 탭의 대화와 길을 다투지 않게)
    private func pumpPrefetch(full: Bool = false) {
        guard prefetching == nil, status == .connected, !prefetchQueue.isEmpty else { return }
        let key = prefetchQueue.removeFirst()
        prefetching = key
        sendControl(["type": "chat-prefetch", "key": key, "have": full ? [] : chat.tabs.have(key)])
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self, self.prefetching == key else { return }
            self.prefetching = nil   // 답이 없음 → 다음 탭으로
            self.pumpPrefetch()
        }
    }

    /// 미리 받은 결과(메인 스레드)
    private func receivedBackground(_ r: ChatBackground) {
        if prefetching == r.key { prefetching = nil }
        if r.unavailable == true {
            noChatTabs.insert(r.key)
        } else if let d = r.d, !chat.storeBackground(r.key, d) {
            // 저장해 둔 것으로 잇지 못함 → 그 탭은 통째로 한 번 더
            prefetchQueue.removeAll { $0 == r.key }
            prefetchQueue.insert(r.key, at: 0)
            pumpPrefetch(full: true)
            return
        }
        pumpPrefetch()
    }

    // MARK: - 사진 첨부

    /// 고른 사진의 칸을 먼저 만든다(고르자마자 입력창에 '받는 중' 칸이 보이게). 그림과 올리기는 뒤에 채운다
    func reserveAttachment() -> String {
        let id = UUID().uuidString
        attachments.append(Attachment(id: id, preview: nil, state: .preparing))
        return id
    }

    /// 칸의 그림: 먼저 사진 파일에 들어 있는 미리보기, 줄인 뒤에는 그것으로 만든 선명한 그림
    func setAttachmentPreview(_ id: String, _ preview: Data) {
        guard let i = attachments.firstIndex(where: { $0.id == id }) else { return }
        attachments[i].preview = preview
    }

    /// 사진을 받지 못했거나 줄이지 못함(칸은 남겨 실패로 보임: 빼고 다시 고를 수 있게)
    func failAttachment(_ id: String) {
        guard let i = attachments.firstIndex(where: { $0.id == id }) else { return }
        attachments[i].state = .failed
    }

    /// 이미 줄인 사진을 붙이고 바로 올린다(복사한 사진 붙여넣기·시험)
    func addAttachment(full: Data, preview: Data) {
        let id = reserveAttachment()
        setAttachmentPreview(id, preview)
        uploadAttachment(id, full: full)
    }

    /// 줄인 사진을 맥에 미리 올린다(보내기 전까지 pi 에는 넣지 않음). 그사이 칸을 뺐으면 올리지 않음
    func uploadAttachment(_ id: String, full: Data) {
        guard let i = attachments.firstIndex(where: { $0.id == id }) else { return }
        attachments[i].state = .uploading
        sendControl(["type": "image", "id": id, "name": "image.jpg", "data": full.base64EncodedString()])
        // 45초 안에 저장 응답이 없으면 실패로 표시(빼고 다시 고를 수 있게)
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { [weak self] in
            guard let self, let i = self.attachments.firstIndex(where: { $0.id == id }),
                  self.attachments[i].state == .uploading else { return }
            self.attachments[i].state = .failed
        }
    }

    func removeAttachment(_ id: String) { attachments.removeAll { $0.id == id } }

    /// 메시지 보내기. 붙인 사진은 "@경로"로 글 앞에 붙고 그림으로도 함께 들어간다.
    /// mode: steer(바로 반영) | followUp(끝나고 실행) | interrupt(멈추고 실행). 쉬는 중이면 바로 실행.
    /// 백그라운드로 보내기(브리지가 새 탭을 엶). 사진은 '@경로'로 글에 넣음
    func sendBackground(_ body: String) {
        let paths = attachments.compactMap(\.path)
        let text = (paths.map { "@\($0)" } + (body.isEmpty ? [] : [body])).joined(separator: " ")
        guard !text.isEmpty else { return }
        sendControl(["type": "bg-start", "text": text])
        attachments.removeAll()
    }

    func sendMessage(_ body: String, mode: String) {
        let paths = attachments.compactMap(\.path)
        let text = (paths.map { "@\($0)" } + (body.isEmpty ? [] : [body])).joined(separator: " ")
        guard !text.isEmpty else { return }
        let isCommand = body.hasPrefix("/") || body.hasPrefix("!")
        if chatAvailable, !isCommand {
            sendControl(["type": "pi-send", "text": text, "mode": mode, "images": paths])
            chat.addPending(text, mode: isWorking ? mode : nil)
        } else {
            sendText(text)   // 확장이 없거나 /명령·!셸: pi 입력창에 붙여넣고 Enter
        }
        attachments.removeAll()
        scrolledUp = false
    }

    /// 앱이 다시 앞으로 왔을 때: 연결이 살아 있는지 핑으로 확인하고, 죽었으면 바로 다시 연결.
    /// (백그라운드에서 끊긴 연결은 시간이 지나야 오류가 나므로 기다리지 않고 먼저 확인)
    func checkAlive() {
        guard shouldReconnect else { return }
        guard let t = active else { retryNow(); return }
        var answered = false
        t.sendPing { [weak self] err in
            DispatchQueue.main.async {
                answered = true
                if err != nil { self?.dropAndReconnect(t) }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            if !answered { self?.dropAndReconnect(t) }
        }
    }

    private func dropAndReconnect(_ t: URLSessionWebSocketTask) {
        guard t === active else { return }
        active = nil
        activeHost = nil
        chat.markDisconnected()
        t.cancel(with: .goingAway, reason: nil)
        scheduleReconnect()
    }

    /// Esc: 실행 중인 작업 중단
    func interrupt() { sendBytes([0x1b]) }

    /// 모델 지정(메뉴 선택). 브리지가 허용 목록을 검사한 뒤 `/model id` 입력.
    func setModel(_ id: String) { sendControl(["type": "pi-command", "text": "/model \(id)"]) }

    /// 생각 깊이 지정(메뉴 선택) → `/thinking level`.
    func setThinking(_ level: String) { sendControl(["type": "pi-command", "text": "/thinking \(level)"]) }

    /// 사용량 요청. 브리지가 1분간 저장해 두므로 자주 불러도 괜찮다(force 면 새로 조회).
    func requestUsage(force: Bool) {
        usageLoading = true
        sendControl(["type": "usage", "force": force])
    }

    /// 단계 상세 요청(도구 id 또는 생각 위치). 답은 대화 피드로 와서 chat.details 에 들어간다.
    func requestDetail(key: String, kind: String, id: String, ref: String) {
        sendControl(["type": "detail", "key": key, "kind": kind, "id": id, "ref": ref])
    }

    /// pi 새 대화 시작(/new). 지금 대화는 pi 기록에 남는다.
    func newConversation() { sendControl(["type": "pi-command", "text": "/new"]) }

    /// tmux 창 이름 바꾸기
    func renameWindow(_ index: Int, to name: String) {
        sendControl(["type": "rename-window", "index": index, "name": name])
    }

    /// tmux 창 닫기(그 창의 pi 도 종료). 마지막 창은 브리지가 막는다.
    func closeWindow(_ index: Int) {
        sendControl(["type": "close-window", "index": index])
    }

    /// 서랍의 '끝난 것 모두 닫기': 결과를 보낸 백그라운드 탭 가운데 쉬는 것만 닫는다(맥 브리지가 그때 목록으로 다시 가림)
    func closeFinishedBackground() { sendControl(["type": "close-finished-bg"]) }

    /// 새 탭을 열고 고른 도구를 켠다(보던 탭의 폴더에서).
    func newWindow(_ tool: TabTool) { sendControl(["type": "new-window", "agent": tool.rawValue]) }

    /// 고를 수 있는 도구를 알려 주지 않는 예전 맥 브리지: 고르지 않고 연다(홈 폴더에서 pi)
    func newWindow() { sendControl(["type": "new-window"]) }

    // MARK: - 폰 알림

    /// 맥 브리지에 이 폰의 알림 주소 등록(연결될 때마다). pk: 알림 중계로 보낼 때 본문을 잠글 공개 키(PushCrypto)
    func registerPush() {
        guard status == .connected, let t = PushManager.shared.token else { return }
        var msg: [String: Any] = ["type": "push-register", "token": t, "env": PushManager.env]
        if let pk = PushCrypto.publicKey() { msg["pk"] = pk }
        sendControl(msg)
    }

    /// 알림을 눌러 열었으면 그 탭으로
    /// 실제로 그 탭이 '지금 탭'이 될 때까지 붙잡아 둔다. 앱이 막 깨어나 연결이 끊긴 채면 첫 요청이 사라질 수 있어서,
    /// 다시 연결돼 창 목록을 받을 때마다 확인하고 다시 보낸다(2초 간격). 30초 안에 못 옮기거나 그 탭이 없으면 포기.
    private var pendingSince: Date?
    private var pendingSentAt: Date?
    private func openPendingWindow() {
        guard let w = PushManager.shared.pendingWindow else {
            pendingSince = nil
            pendingSentAt = nil
            return
        }
        let now = Date()
        let since = pendingSince ?? now
        pendingSince = since
        if now.timeIntervalSince(since) > 30 { finishPendingWindow(); return }
        guard status == .connected, !windows.isEmpty else { return }
        guard windows.contains(where: { $0.index == w }) else { finishPendingWindow(); return }
        UserDefaults.standard.set("chat", forKey: "pi-remote.viewMode")
        if windows.first(where: \.active)?.index == w { finishPendingWindow(); return }
        if pendingSentAt.map({ now.timeIntervalSince($0) > 2 }) ?? true {
            pendingSentAt = now
            selectWindow(w)
        }
    }

    private func finishPendingWindow() {
        pendingSince = nil
        pendingSentAt = nil
        PushManager.shared.pendingWindow = nil
    }

    /// '작업이 끝났을 때도 알림' 켜기·끄기(질문·승인은 항상 알림)
    func setPushDone(_ on: Bool) {
        pushDone = on
        sendControl(["type": "push-prefs", "done": on])
    }

    func sendTestPush() { sendControl(["type": "push-test"]) }

    /// 승인 카드의 허용·거부. 카드는 바로 내리고(답은 맥 확장이 받아 실행하거나 막음)
    func answerApproval(_ id: String, _ approved: Bool) {
        sendControl(["type": "approval", "id": id, "approved": approved])
        chat.meta.approvals.removeAll { $0.id == id }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    /// 입력창 '@' 파일 찾기(맥 pi 입력창의 '@'와 같은 결과)
    func requestFiles(_ query: String) {
        chat.meta.requestedFilesQuery = query
        chat.meta.filesLoading = true
        sendControl(["type": "files", "query": query])
    }

    /// 질문 카드의 답(고른 것·직접 쓴 말)
    /// 계획 모드 켜기·끄기(맥 pi 의 /plan on|off)
    /// 권한 모드: auto | ask | plan
    func setPermMode(_ m: String) { sendControl(["type": "pi-command", "text": "/mode \(m)"]) }
    /// 지금 보는 Claude Code 탭의 계정 고르기: work | personal | auto. 맥 연결부가 일이 끝나면 인수인계 문서를 받아 바꿔 켬
    func setAccount(_ a: String) { sendControl(["type": "set-account", "account": a]) }

    /// 내 메시지 직전으로 되감기(글은 입력창으로 돌아옴)
    func rewind(id: String, text: String) { sendControl(["type": "rewind", "id": id, "text": text]) }
    /// 메모리(지침 파일) 목록·저장
    func requestMemory() { chat.meta.memoryFiles = nil; sendControl(["type": "memory-list"]) }
    func saveMemory(path: String, content: String) { sendControl(["type": "memory-save", "path": path, "content": content]) }

    /// 뒤에서 도는 작업 목록 요청·종료(서랍의 '백그라운드 작업 N'). 셸은 맥이 바로 종료하고, 에이전트·감시는 Claude 에게 종료해 달라고 보냄
    func requestBgJobs() { sendControl(["type": "bg-jobs"]) }
    func killBgJob(_ id: String) {
        sendControl(["type": "bg-job-kill", "id": id])
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    /// 아티팩트 내용 요청(등록된 파일만 맥이 보냄)
    /// 아티팩트 한 조각 요청(offset 부터 2MB, 맥 피드가 나눠 보냄)
    func requestArtifact(_ path: String, offset: Int) { sendControl(["type": "artifact", "path": path, "offset": offset]) }

    /// 여러 질문 카드의 답(질문별)
    func answerQuestions(_ id: String, items: [[String: Any]]) {
        sendControl(["type": "question-answer", "id": id, "answers": [String](), "other": "", "items": items])
        chat.meta.questions.removeAll { $0.id == id }
    }

    func answerQuestion(_ id: String, answers: [String], other: String = "", cancel: Bool = false) {
        sendControl(["type": "question-answer", "id": id, "answers": answers, "other": other, "cancel": cancel])
        chat.meta.questions.removeAll { $0.id == id }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    /// 맥 pi 에서 확장 다시 불러오기(/reload). 작업 중이면 pi 가 거절하므로 쉬는 중에만 부른다
    func reloadPi() { sendControl(["type": "pi-command", "text": "/reload"]) }

    /// 지금 대화 압축(확장이 pi 에 직접 요청. 진행·결과는 대화 피드로)
    func compactNow() { sendControl(["type": "compact"]) }

    /// 지난 대화 목록 요청(답은 "sessions" 로 옴)
    func requestSessions() {
        pastSessionsError = nil
        sendControl(["type": "sessions"])
    }

    /// 지난 대화 열기: 열린 탭이 있으면 그 탭으로, 없으면 새 탭(이름은 대화 제목 앞부분)
    func openSession(_ s: PastSession) {
        sendControl(["type": "open-session", "path": s.path, "title": String(s.title.prefix(14))])
    }

    private func sendControl(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: data, encoding: .utf8) else { return }
        active?.send(.string(s)) { _ in }
    }

    /// 드래그 → 마우스 휠 이벤트(SGR)로 변환해 전송. tmux/pi 가 스크롤 처리.
    /// up=true 면 위로(과거 보기). col/row 는 화면 중앙 근처로 보낸다.
    func scrollLines(up: Bool, count: Int) {
        let term = terminalView.getTerminal()
        let col = max(1, (term.cols > 0 ? term.cols : 80) / 2)
        let row = max(1, (term.rows > 0 ? term.rows : 24) / 2)
        let btn = up ? 64 : 65   // SGR: 64=휠 업, 65=휠 다운
        let seq = Array("\u{1b}[<\(btn);\(col);\(row)M".utf8)
        var bytes: [UInt8] = []
        for _ in 0..<max(1, count) { bytes.append(contentsOf: seq) }
        sendBytes(bytes)
        if up { DispatchQueue.main.async { self.scrolledUp = true } }
    }

    /// 맨 아래(최신)로 — 휠 다운을 대량 보내 바닥까지 내린다.
    func scrollToBottom() {
        scrollLines(up: false, count: 120)
        DispatchQueue.main.async { self.scrolledUp = false }
    }

    /// 서버가 보낸 제어 메시지(JSON)를 처리. 소비하면 true(터미널 출력 아님).
    private func handleControl(_ s: String) -> Bool {
        guard s.first == "{",
              let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return false }
        if type == "windows" {
            let arr = obj["windows"] as? [[String: Any]] ?? []
            let wins = arr.compactMap { d -> TmuxWindow? in
                guard let idx = d["index"] as? Int else { return nil }
                let bg = (d["bg"] as? [String: Any]).map { b in
                    BackgroundInfo(by: b["by"] as? String ?? "user",
                                   started: b["started"] as? Int ?? 0,
                                   done: b["done"] as? Int ?? 0,
                                   from: b["from"] as? Int,
                                   fromName: b["fromName"] as? String ?? "")
                }
                return TmuxWindow(index: idx,
                                  name: d["name"] as? String ?? "",
                                  active: d["active"] as? Bool ?? false,
                                  status: d["status"] as? String ?? "",
                                  sudo: d["sudo"] as? String ?? "",
                                  bg: bg,
                                  jobs: d["jobs"] as? String ?? "",
                                  model: d["model"] as? String ?? "",
                                  thinking: d["thinking"] as? String ?? "",
                                  account: (d["account"] as? [String: Any]).flatMap { a -> TabAccount? in
                                      guard let now = a["now"] as? String, !now.isEmpty else { return nil }
                                      return TabAccount(now: now, pin: a["pin"] as? String ?? "", next: a["next"] as? String ?? "",
                                                        phase: a["phase"] as? String ?? "")
                                  },
                                  key: d["key"] as? String ?? "")
            }
            let battery = (obj["battery"] as? [String: Any]).flatMap { b -> MacBattery? in
                guard let percent = b["percent"] as? Int else { return nil }
                return MacBattery(percent: percent, plugged: b["plugged"] as? Bool ?? false, low: b["low"] as? Bool ?? false)
            }
            // 앱이 아는 이름만(브리지가 보낸 순서대로)
            let tools = (obj["newTabTools"] as? [String] ?? []).compactMap(TabTool.init(rawValue:))
            DispatchQueue.main.async {
                self.windows = wins
                if self.newTabTools != tools { self.newTabTools = tools }
                if self.macBattery != battery { self.macBattery = battery }
                PushManager.shared.currentWindow = wins.first(where: \.active)?.index
                self.chat.setWindow(wins.first(where: \.active)?.index)
                self.tabsUpdated(wins)
                self.openPendingWindow()
                if UIApplication.shared.applicationState == .active { LiveActivities.reconcile(windows: wins) }
            }
            return true
        }
        if type == "push-status" {
            let enabled = obj["enabled"] as? Bool ?? false
            let prefs = obj["prefs"] as? [String: Any]
            let done = prefs?["done"] as? Bool ?? true
            let minSec = prefs?["doneMinSec"] as? Int ?? 3600
            DispatchQueue.main.async {
                self.pushOnMac = enabled
                self.pushDone = done
                self.pushDoneMinSec = minSec
            }
            return true
        }
        if type == "token-rotated", let t = obj["token"] as? String, t.range(of: "^[0-9a-fA-F]{32,128}$", options: .regularExpression) != nil {
            // 브리지가 새 토큰을 만들어 줌 → 저장(키체인). 브리지가 다시 시작하면 새 토큰으로 다시 붙음
            DispatchQueue.main.async {
                self.settings?.token = t
                SaveCenter.shared.say(String(localized: "연결 토큰을 새로 바꿨어요. 곧 다시 연결돼요"))
            }
            return true
        }
        if type == "pistatus" {
            let model = obj["model"] as? String ?? ""
            let thinking = obj["thinking"] as? String ?? ""
            let working = obj["working"] as? Bool ?? false
            DispatchQueue.main.async {
                // 빈 값은 브리지가 3초 연속 비었을 때만 보낸다(pi 가 없는 창) → 그대로 반영
                self.piModel = model
                self.piThinking = thinking
                self.piWorking = working
            }
            return true
        }
        if type == "usage" {
            let info = try? JSONDecoder().decode(UsageInfo.self, from: Data(s.utf8))
            DispatchQueue.main.async {
                self.usage = info ?? UsageInfo(plan: nil, limits: nil, extra: nil, fetchedAt: nil,
                                               error: String(localized: "사용량 응답을 해석하지 못했어요"), history: nil, daily: nil, accounts: nil)
                self.usageLoading = false
            }
            return true
        }
        if type == "image-saved" {
            let id = obj["id"] as? String ?? ""
            let path = obj["path"] as? String
            DispatchQueue.main.async {
                guard let i = self.attachments.firstIndex(where: { $0.id == id }) else { return }
                if let path {
                    #if DEBUG
                    NSLog("[perf] 사진 맥에 저장됨")
                    #endif
                    self.attachments[i].state = .ready(path)
                    // 보낸 뒤 말풍선에 바로 보이도록 미리보기를 썸네일로 저장
                    if let preview = self.attachments[i].preview { self.thumbs.store(path, .small, data: preview) }
                } else {
                    self.attachments[i].state = .failed
                }
            }
            return true
        }
        if type == "thumb" {
            let path = obj["path"] as? String ?? ""
            let size = ThumbStore.Size(rawValue: obj["size"] as? String ?? "") ?? .small
            let data = (obj["data"] as? String).flatMap { Data(base64Encoded: $0) }
            let why = obj["error"] as? String
            DispatchQueue.main.async {
                if let data { self.thumbs.store(path, size, data: data) }
                // 답 속 경로를 눌러 본 맥의 그림이 없거나 그림이 아니면 까닭을 보임(그 밖에는 전처럼 다음에 다시 요청)
                else if ThumbStore.isMacFile(path) { self.thumbs.fail(path, size, why ?? String(localized: "맥에서 그림을 받지 못했어요")) }
                else { self.thumbs.forget(path, size) }
            }
            return true
        }
        if type == "sessions" {
            let items = (try? JSONSerialization.data(withJSONObject: obj["items"] ?? []))
                .flatMap { try? JSONDecoder().decode([PastSession].self, from: $0) } ?? []
            let err = obj["error"] as? String
            DispatchQueue.main.async {
                self.pastSessions = items
                self.pastSessionsError = err
            }
            return true
        }
        if type == "session-opened" {
            let err = obj["error"] as? String
            let existing = obj["existing"] as? Bool ?? false
            DispatchQueue.main.async {
                self.chat.showNotice(err ?? (existing ? String(localized: "열려 있던 탭으로 옮겼어요") : String(localized: "지난 대화를 새 탭에서 열었어요")))
            }
            return true
        }
        if type == "models" {
            let list = obj["models"] as? [String] ?? []
            DispatchQueue.main.async { self.models = list }
            return true
        }
        return false
    }

    // MARK: - 연결 관리

    private func openCandidates() {
        guard let settings else { return }
        pinnedFingerprint = settings.fingerprint
        cancelCandidates()
        active = nil
        let term = terminalView.getTerminal()
        let cols = term.cols > 0 ? term.cols : 80
        let rows = term.rows > 0 ? term.rows : 24
        let requests = settings.candidateRequests(cols: cols, rows: rows, extra: discovered)
        setStatus(.connecting)
        guard !requests.isEmpty else { return } // 발견/입력 대기(Bonjour 가 찾으면 재시도)
        for request in requests {
            let t = urlSession.webSocketTask(with: request)
            t.maximumMessageSize = 16 * 1024 * 1024   // 긴 대화 기록(수백 KB)도 한 번에 받기
            candidates.append(t)
            t.resume()
        }
    }

    private func cancelCandidates() {
        for t in candidates { t.cancel(with: .goingAway, reason: nil) }
        candidates.removeAll()
    }

    /// 다시 연결 예약. 실패가 이어지면 간격을 2→4→8→16→최대 30초로 늘려 배터리를 아낀다.
    /// (앱이 다시 앞으로 오거나 네트워크가 바뀌면 retryNow 로 바로 시도)
    private func scheduleReconnect() {
        guard shouldReconnect, !reconnecting else { return }
        reconnecting = true
        setStatus(.connecting)
        let delay = min(30.0, 2.0 * pow(2.0, Double(min(failCount, 4))))
        failCount += 1
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.reconnecting = false
            if self.shouldReconnect { self.openCandidates() }
        }
        retryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// 기다리던 재연결을 취소하고 바로 시도(연결돼 있으면 아무것도 안 함)
    private func retryNow() {
        guard shouldReconnect, active == nil else { return }
        retryWork?.cancel()
        reconnecting = false
        failCount = 0
        openCandidates()
    }

    private func receiveLoop() {
        active?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                return   // didCompleteWithError 에서 재연결 처리
            case .success(let message):
                // 대화 피드는 여기(백그라운드)서 해석해 메인 스레드 부담을 줄인다
                if case .string(let s) = message, s.hasPrefix("{\"type\":\"chat\"") {
                    if let env = try? JSONDecoder().decode(ChatEnvelope.self, from: Data(s.utf8)) {
                        DispatchQueue.main.async { self.chat.apply(env.d) }
                    }
                    self.receiveLoop()
                    return
                }
                if case .string(let s) = message, s.hasPrefix("{\"type\":\"chat-bg\"") {
                    if let r = try? JSONDecoder().decode(ChatBackground.self, from: Data(s.utf8)) {
                        DispatchQueue.main.async { self.receivedBackground(r) }
                    }
                    self.receiveLoop()
                    return
                }
                DispatchQueue.main.async {
                    switch message {
                    case .data(let d): self.terminalView.feed(byteArray: ArraySlice(d))
                    case .string(let s): if !self.handleControl(s) { self.terminalView.feed(text: s) }
                    @unknown default: break
                    }
                }
                self.receiveLoop()
            }
        }
    }

    /// 폰에서 터미널 보기를 보고 있는지(브리지가 이때만 tmux 창을 폰 크기로 맞춤)
    private var terminalVisible = false
    func setTerminalVisible(_ on: Bool) {
        terminalVisible = on
        sendControl(["type": "view", "terminal": on])
    }

    private func sendResize(cols: Int, rows: Int) {
        let json = "{\"type\":\"resize\",\"cols\":\(cols),\"rows\":\(rows)}"
        active?.send(.string(json)) { _ in }
    }

    private func setStatus(_ s: Status) {
        DispatchQueue.main.async { self.status = s }
    }
}

// MARK: - URLSessionWebSocketDelegate (먼저 열리는 후보 채택)

extension TerminalSession: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
        DispatchQueue.main.async {
            guard self.active == nil else {
                webSocketTask.cancel(with: .goingAway, reason: nil)  // 이미 승자 있음
                return
            }
            self.active = webSocketTask
            for t in self.candidates where t !== webSocketTask { t.cancel(with: .goingAway, reason: nil) }
            self.candidates.removeAll()
            self.activeHost = webSocketTask.originalRequest?.url?.host
            UserDefaults.standard.set(self.activeHost, forKey: "pi-remote.lastHost")   // 작업 표시 토큰 등록(BridgeMessenger)용
            self.status = .connected
            self.failCount = 0
            self.resetTabSync()
            let term = self.terminalView.getTerminal()
            self.sendResize(cols: term.cols > 0 ? term.cols : 80, rows: term.rows > 0 ? term.rows : 24)
            if self.terminalVisible { self.sendControl(["type": "view", "terminal": true]) }   // 다시 붙으면 다시 알림
            self.receiveLoop()
            self.registerPush()
            self.openPendingWindow()
        }
    }

    // 암호화 연결: 짝짓기 QR 로 받은 지문의 맥만 믿는다(맥의 인증서는 자체 서명이라 인증 기관으로는 확인할 수 없음)
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        TLSPin.answer(challenge, expected: pinnedFingerprint, completionHandler: completionHandler)
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        TLSPin.answer(challenge, expected: pinnedFingerprint, completionHandler: completionHandler)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async {
            if task === self.active {
                self.active = nil
                self.activeHost = nil
                self.chat.markDisconnected()
                self.scheduleReconnect()      // 연결 중이던 것이 끊김 → 재시도
            } else {
                self.candidates.removeAll { $0 === task }
                if self.active == nil, self.candidates.isEmpty {
                    self.scheduleReconnect()  // 모든 후보 실패 → 재시도
                }
            }
        }
    }
}

// MARK: - TerminalViewDelegate

extension TerminalSession: TerminalViewDelegate {
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        active?.send(.data(Data(data))) { _ in }
    }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        sendResize(cols: newCols, rows: newRows)
    }

    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func clipboardCopy(source: TerminalView, content: Data) {}
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func bell(source: TerminalView) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}
