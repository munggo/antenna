import SwiftUI
import UIKit

/// 터미널 화면. Claude 앱 배치를 따른다.
/// 상단: 서랍 버튼(☰ + 탭마다 상태 점) + 제목/연결 상태, 오른쪽 캡슐(작업 중 표시 + 더보기 메뉴)
/// 왼쪽 서랍: 탭 목록(상태와 함께)·새 탭·지난 대화·연결 설정
/// 가운데: 터미널(출력 전용) + 맨 아래로 버튼
/// 하단: 작성창(InputBar)
struct TerminalScreen: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject private var artifacts = ArtifactCenter.shared
    let onClose: () -> Void
    /// 보기 방식(chat | terminal). 채팅이 가능할 때만 chat 이 적용된다.
    @AppStorage("pi-remote.viewMode") private var viewMode = "chat"
    @State private var showUsage = false
    @State private var showMemory = false
    @State private var renameTarget: TmuxWindow?   // 이름 바꿀 창
    @State private var renameText = ""
    @State private var closeTarget: TmuxWindow?    // 닫을 창(확인 대기)
    @State private var confirmCloseFinished = false   // 서랍의 '끝난 것 모두 닫기'(확인 대기)
    @State private var confirmNewChat = false
    @State private var confirmRotate = false
    @State private var drawerOpen = false
    /// 작업 목록을 연 탭(서랍의 '백그라운드 작업 N ›')
    @State private var jobsTab: TmuxWindow?
    @Environment(\.scenePhase) private var scenePhase

    private var showChat: Bool { session.chatAvailable && viewMode == "chat" }

    var body: some View {
        // 화면 폭을 고정: 대화 안에 화면보다 넓은 것이 생겨도 전체가 옆으로 밀리지 않게(보내기 버튼이 밖으로 나가던 버그 방지)
        GeometryReader { geo in
            content.frame(width: geo.size.width)
                .overlay(alignment: .leading) { drawerLayer(width: geo.size.width) }
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    private var content: some View {
        VStack(spacing: 0) {
            header
            ZStack {
                // 터미널은 항상 배치해 크기·내용을 유지하고, 채팅일 때는 가린다
                terminalLayer
                    .opacity(showChat ? 0 : 1)
                    .allowsHitTesting(!showChat)
                if showChat {
                    ChatView(store: session.chat, session: session, thumbs: session.thumbs, meta: session.chat.meta)
                }
            }
            // 왼쪽 끝에서 오른쪽으로 밀면 서랍 열기(누르기·위아래 스크롤은 그대로)
            .simultaneousGesture(DragGesture(minimumDistance: 15).onEnded { v in
                if v.startLocation.x < 28, v.translation.width > 50, abs(v.translation.height) < 60 { setDrawer(true) }
            })
            InputBar(session: session, chat: session.chat, meta: session.chat.meta)
                // 자리가 모자라면(키보드) 위 채팅이 먼저 줄고, 입력창 위 카드는 그 안에서 스크롤 칸만 줄어든다
                .layoutPriority(1)
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $showUsage) { UsageSheet(session: session) }
        .sheet(isPresented: $session.showSessions) { SessionsSheet(session: session) }
        .sheet(item: $jobsTab) { w in JobsSheet(session: session, meta: session.chat.meta, store: session.chat, tab: w) }
        .alert("창 이름 바꾸기", isPresented: Binding(get: { renameTarget != nil },
                                                set: { if !$0 { renameTarget = nil } })) {
            TextField("이름", text: $renameText)
            Button("취소", role: .cancel) { renameTarget = nil }
            Button("바꾸기") {
                let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if let w = renameTarget, !name.isEmpty { session.renameWindow(w.index, to: name) }
                renameTarget = nil
            }
        }
        .confirmationDialog(closeTarget.map { "'\($0.name.isEmpty ? "창 \($0.index)" : $0.name)' 창을 닫을까요?" } ?? "",
                            isPresented: Binding(get: { closeTarget != nil },
                                                 set: { if !$0 { closeTarget = nil } }),
                            titleVisibility: .visible) {
            Button("창 닫기", role: .destructive) {
                if let w = closeTarget { session.closeWindow(w.index) }
                closeTarget = nil
            }
            Button("취소", role: .cancel) { closeTarget = nil }
        } message: {
            Text(session.windows.count <= 1 ? "마지막 창은 닫을 수 없어요." : "이 창에서 실행 중인 작업도 함께 종료돼요.")
        }
        .confirmationDialog("끝난 백그라운드 탭 \(session.windows.filter(\.finishedBackground).count)개를 닫을까요?",
                            isPresented: $confirmCloseFinished, titleVisibility: .visible) {
            Button("모두 닫기", role: .destructive) { session.closeFinishedBackground() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("결과는 시킨 탭에 이미 보냈어요. 그 탭들에서 켜 둔 pi·Claude Code 도 함께 꺼져요.")
        }
        .confirmationDialog("연결 토큰을 새로 바꿀까요?", isPresented: $confirmRotate, titleVisibility: .visible) {
            Button("새로 바꾸기") { session.rotateToken() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("맥이 새 토큰을 만들어 이 폰에 저장하고 다시 연결해요. 예전 토큰은 더 이상 쓸 수 없어요.")
        }
        .confirmationDialog("새 대화를 시작할까요?", isPresented: $confirmNewChat, titleVisibility: .visible) {
            Button("새 대화 시작") { session.newConversation() }
            Button("취소", role: .cancel) {}
        } message: {
            // 이 탭에서 도는 것의 이름으로(Claude Code 탭에서는 /clear 로 바뀌어 들어가고, 둘 다 /resume 으로 다시 엶)
            let agent = session.chat.meta.agentName == "Claude" ? "Claude Code" : "pi"
            Text("지금 대화는 \(agent) 기록에 남아요. 맥 \(agent) 에서 /resume 으로 다시 열 수 있어요.")
        }
        .sheet(isPresented: $showMemory) { MemorySheet(session: session, meta: session.chat.meta) }
        // 아티팩트: 목록(📎)과 전체 화면 보기. 내용은 맥 피드에 요청
        .sheet(isPresented: $artifacts.showList, onDismiss: {
            if let r = ArtifactCenter.shared.pendingOpen {
                ArtifactCenter.shared.pendingOpen = nil
                ArtifactCenter.shared.open = r
            }
        }) { ArtifactListSheet(refs: session.chat.artifacts) }
        .fullScreenCover(item: $artifacts.open) { ArtifactViewer(ref: $0) }
        .onAppear { ArtifactCenter.shared.request = { [weak session] in session?.requestArtifact($0, offset: $1) } }
        .saveSupport(host: "main")
        .onChange(of: scenePhase) { phase in
            // 다른 앱에 갔다 오면 연결부터 확인(끊겼으면 바로 다시 연결), 나갈 때는 대화를 저장
            if phase == .active { session.checkAlive() }
            if phase == .background { session.chat.saveCache() }
            session.setTerminalVisible(phase == .active && !showChat)
        }
        // 터미널 보기를 앞에서 볼 때만 맥 tmux 창을 폰 크기로(채팅·백그라운드에선 맥 크기 그대로)
        .onChange(of: showChat) { chat in session.setTerminalVisible(scenePhase == .active && !chat) }
        .onChange(of: session.status) { st in
            if st == .connected { session.setTerminalVisible(scenePhase == .active && !showChat) }
        }
        .onAppear {
            #if DEBUG
            // 시뮬레이터 시험용: 앱이 켜지자마자 알림을 누른 것처럼(PI_REMOTE_TEST=notif:<탭 번호>)
            if let action = ProcessInfo.processInfo.environment["PI_REMOTE_TEST"], action.hasPrefix("notif:"),
               let n = Int(action.dropFirst(6)) {
                PushManager.shared.pendingWindow = n
            }
            // 시뮬레이터 시험용: 실행 환경변수로 사용량 화면 자동 열기
            // 시뮬레이터 시험용: 실행 환경변수로 화면 자동 열기(usage | rename | close)
            if let action = ProcessInfo.processInfo.environment["PI_REMOTE_TEST"] {
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    switch action {
                    case "usage": showUsage = true
                    case "rename": if let w = activeWindow { startRename(w) }
                    case "close": closeTarget = activeWindow
                    case "attach-wide-send":
                        let wide = TestImages.make(width: 3200, height: 800)
                        if let full = ImageShrink.jpeg(from: wide), let preview = ImageShrink.jpeg(from: wide, maxPixel: 300) {
                            session.addAttachment(full: full, preview: preview)
                            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { session.sendMessage("가로 사진 시험: 1만 답해", mode: "steer") }
                        }
                    case "attach-wide":
                        let wide = TestImages.make(width: 3200, height: 800)
                        if let full = ImageShrink.jpeg(from: wide), let preview = ImageShrink.jpeg(from: wide, maxPixel: 300) {
                            session.addAttachment(full: full, preview: preview)
                        }
                    case "attach":
                        // 연결된 뒤에 올림(4초 안에 연결이 안 되면 올리기 요청이 버려져 시험이 실패하던 것)
                        func attachWhenConnected(_ tries: Int) {
                            guard session.status == .connected || tries <= 0 else {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { attachWhenConnected(tries - 1) }
                                return
                            }
                            if let full = ImageShrink.jpeg(from: TestImages.make()),
                               let preview = ImageShrink.jpeg(from: TestImages.make(), maxPixel: 300) {
                                session.addAttachment(full: full, preview: preview)
                            }
                        }
                        attachWhenConnected(30)
                    default: break
                    }
                }
            }
            // 시뮬레이터 시험용: 입력창을 자동으로 눌러 키보드 올리기
            if let s = ProcessInfo.processInfo.environment["PI_REMOTE_FOCUS_AT"], let t = Double(s) {
                DispatchQueue.main.asyncAfter(deadline: .now() + t) { session.inputFocused = true }
            }
            #endif
        }
    }

    private var terminalLayer: some View {
            ZStack(alignment: .bottom) {
                TerminalContainerView(session: session, hidden: showChat, connected: session.status == .connected)
                    .background(Theme.terminalBg)
                if session.scrolledUp {
                    Button { session.scrollToBottom() } label: {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.text)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Theme.surfaceHigh))
                            .overlay(Circle().stroke(Theme.border))
                            .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
                    }
                    .padding(.bottom, 12)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .animation(.easeOut(duration: 0.15), value: session.scrolledUp)
    }

    // MARK: - 상단바

    private var header: some View {
        HStack(spacing: 12) {
            TabDrawerButton(windows: session.windows) { setDrawer(true) }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .onTapGesture(count: 2) { if let w = activeWindow { startRename(w) } }
                    .font(.system(size: Typo.title, weight: .medium))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle().fill(statusColor).frame(width: 6, height: 6)
                    Text(statusText)
                        .font(.system(size: Typo.subtitle))
                        .foregroundColor(Theme.muted)
                        .lineLimit(1)
                    // 맥북 배터리: 연결돼 있을 때만(끊긴 동안의 값은 낡았을 수 있음). 충전기를 꽂았으면 번개, 낮으면 빨갛게
                    if session.status == .connected, let b = session.macBattery {
                        Text("·")
                            .font(.system(size: Typo.subtitle))
                            .foregroundColor(Theme.muted)
                        MacBatteryLabel(battery: b)
                    }
                }
            }

            Spacer()

            HStack(spacing: 14) {
                // 컨텍스트 사용량(작은 고리 + %): 입력창 아래에서 옮겨 옴. 누르면 컨텍스트 화면(압축)
                if showChat { ContextTopButton(session: session, meta: session.chat.meta) }
                if session.isWorking {
                    ProgressView()
                        .tint(Theme.accent)
                        .scaleEffect(0.85)
                }
                if showChat { ArtifactsButton(chat: session.chat) }
                if session.chatAvailable {
                    Button {
                        viewMode = showChat ? "terminal" : "chat"
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Image(systemName: showChat ? "terminal" : "text.bubble")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(Theme.text)
                            .frame(width: 24, height: 40)
                    }
                    .accessibilityIdentifier("viewToggle")
                    .accessibilityValue(showChat ? "chat" : "terminal")
                }
                Menu {
                    Button { showUsage = true } label: {
                        Label("사용량", systemImage: "chart.bar")
                    }
                    Button { showMemory = true } label: {
                        Label("메모리", systemImage: "brain")
                    }
                    .accessibilityIdentifier("menuMemory")
                    Button { afterMenuCloses { confirmRotate = true } } label: {
                        Label("연결 토큰 바꾸기", systemImage: "key")
                    }
                    .accessibilityIdentifier("menuRotateToken")
                    .disabled(session.status != .connected)
                    Button { afterMenuCloses { confirmNewChat = true } } label: {
                        Label("새 대화", systemImage: "square.and.pencil")
                    }
                    .disabled(!session.chatAvailable || session.isWorking)
                    Button { session.showSessions = true } label: {
                        Label("지난 대화", systemImage: "clock.arrow.circlepath")
                    }
                    Menu {
                        // 질문·승인·확인 창은 항상 알림, 작업이 끝났을 때는 선택
                        Toggle("\(session.pushDoneMinSec >= 3600 ? "\(session.pushDoneMinSec / 3600)시간" : "\(max(1, session.pushDoneMinSec / 60))분") 넘게 걸린 작업이 끝나면 알림",
                               isOn: Binding(get: { session.pushDone }, set: { session.setPushDone($0) }))
                        Button { session.sendTestPush() } label: {
                            Label("시험 알림 보내기", systemImage: "bell.badge")
                        }
                    } label: {
                        Label(session.pushOnMac ? "알림" : "알림(맥 설정 없음)", systemImage: "bell")
                    }
                    Button { session.newWindow() } label: {
                        Label("새 창 열기", systemImage: "plus.square.on.square")
                    }
                    if let w = activeWindow {
                        Button { afterMenuCloses { startRename(w) } } label: {
                            Label("창 이름 바꾸기", systemImage: "pencil")
                        }
                        Button(role: .destructive) { afterMenuCloses { closeTarget = w } } label: {
                            Label("창 닫기", systemImage: "xmark.square")
                        }
                        .disabled(session.windows.count <= 1)
                    }
                    Button(role: .destructive) { session.interrupt() } label: {
                        Label("실행 중지", systemImage: "stop.circle")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 24, height: 40)
                }
                .accessibilityIdentifier("moreMenu")
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(Capsule().fill(Theme.surfaceHigh))
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 8)
        .background(Theme.bg)
    }

    private var activeWindow: TmuxWindow? { session.windows.first(where: { $0.active }) }

    // MARK: - 왼쪽 서랍

    private func setDrawer(_ open: Bool) {
        guard drawerOpen != open else { return }
        if open {
            session.inputFocused = false   // 키보드는 내리고 연다
            session.requestUsage(force: false)   // 서랍 아래 사용량 카드(브리지가 1분 캐시)
        }
        withAnimation(.easeOut(duration: 0.22)) { drawerOpen = open }
    }

    @ViewBuilder
    private func drawerLayer(width: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            if drawerOpen {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { setDrawer(false) }
                    .accessibilityIdentifier("drawerScrim")
                    .transition(.opacity)
                TabDrawer(session: session,
                          onSelect: { i in
                              session.selectWindow(i)
                              setDrawer(false)
                          },
                          onJobs: { w in
                              // 그 탭으로 가서 작업 목록을 엶(목록은 그 탭의 Claude Code 연결부가 답함)
                              if !w.active { session.selectWindow(w.index) }
                              setDrawer(false)
                              jobsTab = w
                          },
                          onRename: { w in afterMenuCloses { startRename(w) } },
                          onCloseWindow: { w in afterMenuCloses { closeTarget = w } },
                          onCloseFinished: { confirmCloseFinished = true },
                          onPastSessions: {
                              setDrawer(false)
                              session.showSessions = true
                          },
                          onSettings: {
                              setDrawer(false)
                              onClose()
                          },
                          onUsage: {
                              setDrawer(false)
                              showUsage = true
                          })
                    .frame(width: min(320, width * 0.82))
                    .gesture(DragGesture(minimumDistance: 15).onEnded { v in
                        if v.translation.width < -50 { setDrawer(false) }
                    })
                    .transition(.move(edge: .leading))
            }
        }
    }

    /// 길게 누르기 메뉴가 닫히는 중에 확인창을 띄우면 iOS 가 가끔 무시한다 → 메뉴가 닫힌 뒤에 띄움
    private func afterMenuCloses(_ action: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: action)
    }

    private func startRename(_ w: TmuxWindow) {
        renameText = w.name
        renameTarget = w
    }

    /// 제목: 현재 tmux 창 이름(없으면 pi)
    private var title: String {
        let name = session.windows.first(where: { $0.active })?.name ?? ""
        return name.isEmpty ? "pi" : name
    }

    private var statusColor: Color {
        switch session.status {
        case .connected: return session.isWorking ? Theme.accent : Theme.green
        case .connecting: return Theme.accent
        case .failed: return Theme.red
        default: return Theme.muted
        }
    }

    private var statusText: String {
        switch session.status {
        case .connected: return session.isWorking ? "작업 중" : "연결됨"
        case .connecting: return "연결 중"
        case .closed: return "종료됨"
        case .idle: return "대기"
        case .failed(let m): return "실패: \(m)"
        }
    }
}

/// 시뮬레이터 시험용 사진
enum TestImages {
    #if DEBUG
    static func make(width: CGFloat = 1600, height: CGFloat = 1000) -> Data {
        let r = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
        return r.jpegData(withCompressionQuality: 0.9) { ctx in
            UIColor(red: 0.85, green: 0.47, blue: 0.34, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
            UIColor.white.setFill()
            let d = min(width, height) / 2
            ctx.cgContext.fillEllipse(in: CGRect(x: (width - d) / 2, y: (height - d) / 2, width: d, height: d))
        }
    }
    #endif
}

/// 화면 위 '연결됨' 옆의 맥북 배터리: 그림 + 잔량(사용자 요청 11-16).
/// 충전기를 꽂았으면 번개, 충전기 없이 낮으면(기준은 맥이 정함) 빨갛게. 배터리가 없는 맥에서는 값이 오지 않아 보이지 않는다
struct MacBatteryLabel: View {
    let battery: MacBattery

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: Self.icon(battery))
                .font(.system(size: Typo.subtitle - 2))
            Text("\(battery.percent)%")
                .font(.system(size: Typo.subtitle))
                .lineLimit(1)
        }
        .foregroundColor(battery.low ? Theme.red : Theme.muted)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("macBattery")
        .accessibilityLabel(Self.spoken(battery))
    }

    /// 충전기를 꽂았으면 번개, 아니면 잔량에 가까운 배터리 그림
    static func icon(_ b: MacBattery) -> String {
        if b.plugged { return "bolt.fill" }
        switch b.percent {
        case ..<13: return "battery.0"
        case ..<38: return "battery.25"
        case ..<63: return "battery.50"
        case ..<88: return "battery.75"
        default: return "battery.100"
        }
    }

    /// "맥 배터리 94%" · "맥 배터리 94%, 충전기 연결됨" · "맥 배터리 18%, 낮음"(VoiceOver·시험용)
    static func spoken(_ b: MacBattery) -> String {
        "맥 배터리 \(b.percent)%" + (b.plugged ? ", 충전기 연결됨" : b.low ? ", 낮음" : "")
    }
}

/// 위쪽 📎 버튼: 이 대화에 아티팩트가 있으면 개수와 함께
private struct ArtifactsButton: View {
    @ObservedObject var chat: ChatStore

    var body: some View {
        let n = chat.artifacts.count
        if n > 0 {
            Button { ArtifactCenter.shared.showList = true } label: {
                HStack(spacing: 2) {
                    Image(systemName: "paperclip").font(.system(size: 15, weight: .medium))
                    Text("\(n)").font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(Theme.text)
                .frame(height: 40)
            }
            .accessibilityIdentifier("artifactsButton")
            .accessibilityValue("\(n)")
        }
    }
}

/// 위쪽 오른쪽 컨텍스트 사용량(고리 + %). 누르면 컨텍스트 화면
private struct ContextTopButton: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var meta: ChatMeta
    @State private var show = false

    var body: some View {
        if let c = meta.context {
            Button { show = true } label: { ContextGauge(info: c).fixedSize().padding(.horizontal, -4) }
                .buttonStyle(.plain)
                .accessibilityLabel("컨텍스트 \(c.percentText)")
                .accessibilityIdentifier("contextGauge")
                .sheet(isPresented: $show) { ContextSheet(meta: meta, session: session) }
        }
    }
}
