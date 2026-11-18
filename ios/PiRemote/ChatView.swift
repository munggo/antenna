import SwiftUI
import UIKit

/// pi 대화를 Claude 앱처럼 그리는 채팅 화면. 스크롤은 iOS 기본(손가락을 그대로 따라감 + 관성).
/// - 내 메시지: 오른쪽 말풍선
/// - 답변: 마크다운 본문
/// - 도구 호출: "명령어 N개 실행함" 한 줄로 접고, 누르면 아래에서 단계 창(명령·출력·변경 내용)
/// - 생각 내용: 다음 단계 묶음 안에 '생각함'으로. 누르면 내용을 받아 와 보여줌
struct ChatView: View {
    @ObservedObject var store: ChatStore
    @ObservedObject var session: TerminalSession
    @ObservedObject var thumbs: ThumbStore
    /// 승인 대기 여부(상태 줄 문구용)
    @ObservedObject var meta: ChatMeta

    @State private var atBottom = true          // 맨 아래 표식이 화면에 보이는지(↓ 버튼 표시용)
    @State private var follow = true            // 새 내용·키보드에 맞춰 맨 아래를 따라갈지
    @State private var userScrolling = false    // 손가락으로 스크롤 중인지
    @State private var viewportHeight: CGFloat = 0
    @StateObject private var stepsPresenter = StepsPresenter()
    @StateObject private var foldEvents = FoldEvents()

    var body: some View {
        let items = store.items
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    // LazyVStack 은 맨 아래부터 시작할 때 높이 추정이 어긋나 빈 화면이 되는 문제가 있어
                    // 미리 다 그리는 VStack 을 쓴다(받는 대화가 최대 400개라 부담이 작다).
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(items) { item in
                            ChatItemView(item: item)
                                .equatable()
                                .id(item.id)
                        }
                        // 작업 중에 보낸 메시지: pi 가 받아 둔 대기열 + 앱이 보내자마자 먼저 띄운 것
                        ForEach(store.queue) { q in
                            WaitingBubble(text: q.text, caption: WaitingBubble.caption(q.kind))
                        }
                        ForEach(store.visiblePending) { p in
                            WaitingBubble(text: p.text, caption: WaitingBubble.caption(p.mode))
                        }
                        if session.status != .connected {
                            StatusRow(label: "연결 중", since: nil, animated: false)
                        } else if store.compacting {
                            StatusRow(label: "대화를 압축하는 중", since: store.compactingSince)
                        } else if store.working {
                            StatusRow(label: !meta.approvals.isEmpty ? "승인을 기다리는 중"
                                      : !meta.questions.isEmpty ? "답을 기다리는 중" : workingLabel, since: store.workingSince,
                                      onTap: liveThinking.map { t in { stepsPresenter.open(groupId: nil, steps: [t]) } })
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 16)

                    // 맨 아래 표식: 화면 안에 보이면 "맨 아래에 있음"
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                        .background(
                            GeometryReader { g in
                                Color.clear.preference(key: BottomOffsetKey.self,
                                                       value: g.frame(in: .named("chat")).minY)
                            }
                        )
                }
            }
            .coordinateSpace(name: "chat")
            .environmentObject(session.thumbs)
            .environment(\.stepsPresenter, stepsPresenter)
            .environment(\.foldEvents, foldEvents)
            .environment(\.rewindAction) { [weak session] id, text in session?.rewind(id: id, text: text) }
            .sheet(item: $stepsPresenter.request) { r in
                StepsSheet(request: r, store: store, session: session)
                    .environmentObject(thumbs)
            }
            .fullScreenCover(item: $thumbs.viewing) { v in
                ImageViewer(paths: store.imagePaths, start: v.id).environmentObject(thumbs)
            }
            .background(
                GeometryReader { g in
                    Color.clear.onAppear { viewportHeight = g.size.height }
                        .onChange(of: g.size.height) { viewportHeight = $0 }
                }
            )
            .onPreferenceChange(BottomOffsetKey.self) { y in
                let bottom = y <= viewportHeight + 80
                if bottom != atBottom { atBottom = bottom }
                // 손가락으로 다시 맨 아래까지 내려오면 따라가기 재개
                if bottom, !userScrolling, !follow { follow = true }
            }
            // 따라가기를 멈추는 건 "사용자가 직접 스크롤할 때"뿐. 키보드·내용 변화로 위치가 바뀌는 건 무시.
            .modifier(ScrollPhaseTracker { interacting in
                userScrolling = interacting
                if interacting { follow = false } else if atBottom { follow = true }
            })
            .scrollDismissesKeyboard(.interactively)
            // 대화 영역을 탭하면 키보드와 입력창을 내린다(Claude 앱처럼)
            .simultaneousGesture(TapGesture().onEnded { dismissKeyboard() })
            .accessibilityIdentifier("chatScroll")
            .modifier(StartAtBottom())
            .onAppear { scrollToBottomSettled(proxy) }
            .onChange(of: store.snapshotCount) { _ in if follow { scrollToBottomSettled(proxy) } }
            .onChange(of: viewportHeight) { _ in
                // 키보드가 오르내려 화면 높이가 바뀌면, 따라가는 중이었다면 같은 속도로 맨 아래 유지
                if follow { withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .onChange(of: store.version) { _ in
                // 따라가는 중일 때만 새 내용을 따라간다(위를 읽는 중이면 그대로 둠)
                if follow { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: session.status) { _ in
                // "연결 중"/"연결됨" 상태 줄이 바뀔 때도 맨 아래를 보고 있었다면 따라간다
                if follow { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .onChange(of: store.compacting) { _ in
                // '대화를 압축하는 중' 줄이 생기고 사라질 때도(대화 내용 버전은 그대로라 따로 따라감)
                if follow { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .onChange(of: foldEvents.last) { e in
                guard let e else { return }
                if e.expanded {
                    // 펼쳐서 읽는 동안 새 내용이 와도 맨 아래로 끌려가지 않게
                    follow = false
                } else {
                    // 긴 것을 끝에서 접으면 그 머리가 화면 위로 사라진다 → 접힌 것이 보이는 자리로(접힌 높이가 정해진 뒤에)
                    DispatchQueue.main.async { proxy.scrollTo(e.anchor, anchor: .top) }
                }
            }
            .overlay(alignment: .top) {
                // 업데이트·다시 불러오기 같은 안내를 위에 잠깐
                if let n = store.notice {
                    Text(n)
                        .font(.system(size: Typo.caption + 1, weight: .medium))
                        .foregroundColor(Theme.text)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Theme.surfaceHigh))
                        .overlay(Capsule().stroke(Theme.border))
                        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .accessibilityIdentifier("noticeBanner")
                }
            }
            .animation(.easeOut(duration: 0.25), value: store.notice)
            .overlay(alignment: .bottom) {
                // 따라가는 중(키보드가 오르내리는 순간 포함)엔 숨기고, 사용자가 위로 올려 읽을 때만 보인다
                if !atBottom && !follow {
                    Button {
                        follow = true
                        withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
                    } label: {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.text)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Theme.surfaceHigh))
                            .overlay(Circle().stroke(Theme.border))
                            .shadow(color: .black.opacity(0.2), radius: 6, y: 2)
                    }
                    .padding(.bottom, 12)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    .accessibilityIdentifier("scrollToBottom")
                }
            }
            .animation(.easeOut(duration: 0.15), value: atBottom && follow)
        }
        .background(Theme.bg)
        #if DEBUG
        .overlay(alignment: .top) {
            if ProcessInfo.processInfo.environment["PI_REMOTE_DEBUG"] == "1" {
                Text("msgs=\(store.messages.count) items=\(items.count) atBottom=\(atBottom) vh=\(Int(viewportHeight)) ver=\(store.version)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.yellow)
                    .background(Color.black)
            }
        }
        #endif
    }

    private func dismissKeyboard() {
        session.inputFocused = false
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    /// 높이가 나중에 확정되는 항목(코드 블록 등)이 있어 몇 번 나눠 맨 아래로 맞춘다.
    private func scrollToBottomSettled(_ proxy: ScrollViewProxy) {
        for delay in [0.0, 0.08, 0.25, 0.6] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    /// 지금 쓰이는 중인 생각(하단 '생각 중' 줄을 누르면 이걸 창으로 보여줌)
    private var liveThinking: ToolCallInfo? {
        guard let last = store.messages.last, last.role == "assistant", last.stop == "pending",
              let blocks = last.blocks, let b = blocks.last, b.type == "thinking" else { return nil }
        return ToolCallInfo(id: "think-\(last.id)-\(blocks.count - 1)", name: "thinking", summary: "",
                            desc: b.desc ?? "", output: nil, state: "done", thinking: true, ref: b.ref)
    }

    /// 하단 작업 상태 문구: 답변을 쓰는 중 / 생각 중 / 도구 실행 중
    private var workingLabel: String {
        guard let last = store.messages.last else { return "작업 중" }
        if last.role == "assistant", last.stop == "pending" {
            let blocks = last.blocks ?? []
            if blocks.last?.type == "thinking" { return "생각 중" }
            if blocks.last?.type == "text" { return "답변 중" }
        }
        return "작업 중"
    }
}

/// 처음 열 때 맨 아래(최신)에서 시작. 내용이 늘어날 때 읽던 위치를 밀지 않도록 처음 위치에만 적용.
private struct StartAtBottom: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.defaultScrollAnchor(.bottom, for: .initialOffset)
        } else if #available(iOS 17.0, *) {
            content.defaultScrollAnchor(.bottom)
        } else {
            content
        }
    }
}

/// 사용자가 손가락으로 스크롤 중인지 알려준다(iOS 18 이상). 그보다 낮으면 알리지 않음.
private struct ScrollPhaseTracker: ViewModifier {
    let onChange: (Bool) -> Void
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollPhaseChange { _, phase in
                onChange(phase == .interacting || phase == .tracking)
            }
        } else {
            content
        }
    }
}

private struct BottomOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

// MARK: - 화면에 그릴 항목

/// 단계 하나(도구 호출 또는 생각)
struct ToolCallInfo: Equatable {
    let id: String
    let name: String        // 도구 이름(생각이면 "thinking")
    let summary: String
    let desc: String        // 한 줄 설명(생각이면 첫 줄 미리보기)
    let output: String?
    let state: String       // running | done | error | pending
    var stats: ChangeStats? = nil
    var image = false       // 사진 파일을 읽은 단계 → 대화에 그 사진을 보여줌
    var thinking = false
    var ref: String? = nil  // 생각 위치(상세 요청용)
    var answer: String? = nil  // 고르는 질문의 답(단계 줄 '물어봄 질문 → 답')
    var artifact: ArtifactRef? = nil  // 등록한 아티팩트(단계 줄 아래 카드)
}

enum ChatItem: Identifiable, Equatable {
    case truncated(Int)
    case user(ChatMessage)
    case text(id: String, text: String)
    case progress(id: String, text: String)   // 도구 사이의 짧은 진행 설명(Claude Code 가 줄여서 준 글)
    case tools(id: String, calls: [ToolCallInfo])
    case bash(ChatMessage)
    case summary(ChatMessage)
    case notice(id: String, text: String, isError: Bool)
    case copy(id: String, text: String)     // 답변이 끝난 자리의 복사 버튼

    var id: String {
        switch self {
        case .truncated: return "truncated"
        case .user(let m), .bash(let m), .summary(let m): return m.id
        case .text(let id, _), .progress(let id, _), .tools(let id, _), .notice(let id, _, _), .copy(let id, _): return id
        }
    }
}

enum ChatItemBuilder {
    /// 메시지 목록 → 화면 항목. 이어지는 도구 호출은 하나로 묶고, 도구 결과는 그 호출에 붙인다.
    static func build(_ store: ChatStore) -> [ChatItem] {
        var results: [String: ChatMessage] = [:]
        for m in store.messages where m.role == "toolResult" {
            if let id = m.toolCallId { results[id] = m }
        }

        var items: [ChatItem] = []
        if store.truncated > 0 { items.append(.truncated(store.truncated)) }
        var group: [ToolCallInfo] = []
        var groupId = ""
        func flush() {
            if !group.isEmpty { items.append(.tools(id: groupId, calls: group)); group = [] }
        }
        // 생각은 따로 줄을 만들지 않고 다음 도구 묶음의 단계로 넣는다(Claude 앱처럼 화면이 덜 어수선).
        // 도구로 이어지지 않은 생각(도구 없이 바로 답한 경우)만 그 자리에 '생각함' 줄로 둔다.
        var pendingThinking: [ToolCallInfo] = []
        var pendingAt = 0
        func flushThinking() {
            if !pendingThinking.isEmpty {
                items.insert(.tools(id: pendingThinking[0].id, calls: pendingThinking), at: min(pendingAt, items.count))
                pendingThinking = []
            }
        }
        // 한 번의 답변(내 메시지와 다음 내 메시지 사이)의 글을 모아, 끝난 답변 아래에 복사 버튼을 둔다
        var turnTexts: [String] = []
        var turnId = ""
        func flushTurn() {
            if !turnTexts.isEmpty { items.append(.copy(id: "copy-\(turnId)", text: turnTexts.joined(separator: "\n\n"))) }
            turnTexts = []
        }

        for m in store.messages {
            switch m.role {
            case "user":
                flush()
                flushThinking()
                flushTurn()
                items.append(.user(m))
            case "assistant":
                let blocks = m.blocks ?? []
                for (i, b) in blocks.enumerated() {
                    switch b.type {
                    case "text":
                        let t = (b.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !t.isEmpty {
                            flush()
                            if b.update == true {
                                // 도구 사이의 진행 설명: 화면에는 조금 흐리게 보이고, 답변 복사에는 넣지 않는다(답의 글만)
                                items.append(.progress(id: "\(m.id)-\(i)", text: t))
                            } else {
                                items.append(.text(id: "\(m.id)-\(i)", text: t))
                                turnTexts.append(t)
                                turnId = m.id
                            }
                        }
                    case "tool":
                        let callId = b.id ?? "\(m.id)-\(i)"
                        let result = results[callId]
                        let state: String
                        if let r = result { state = (r.isError ?? false) ? "error" : "done" }
                        else if let s = store.toolStates[callId] { state = s }
                        else { state = store.working ? "pending" : "done" }
                        if group.isEmpty {
                            group = pendingThinking   // 앞선 생각을 이 묶음의 첫 단계로
                            pendingThinking = []
                            groupId = group.first?.id ?? callId
                        }
                        group.append(ToolCallInfo(id: callId, name: b.name ?? "도구",
                                                  summary: b.summary ?? "", desc: b.desc ?? "",
                                                  output: result?.output, state: state,
                                                  stats: b.stats, image: b.image ?? false,
                                                  answer: result?.answer, artifact: result?.artifact))
                    case "thinking":
                        let step = ToolCallInfo(id: "think-\(m.id)-\(i)", name: "thinking", summary: "",
                                                desc: b.desc ?? "", output: nil, state: "done",
                                                thinking: true, ref: b.ref)
                        if !group.isEmpty {
                            group.append(step)
                        } else {
                            if pendingThinking.isEmpty { pendingAt = items.count }
                            pendingThinking.append(step)
                        }
                    default:
                        break
                    }
                }
                if m.stop == "error", let err = m.error, !err.isEmpty {
                    flush(); items.append(.notice(id: "\(m.id)-err", text: "오류: \(err)", isError: true))
                } else if m.stop == "aborted" {
                    flush(); items.append(.notice(id: "\(m.id)-abort", text: "중단됨", isError: false))
                }
            case "bash":
                flush()
                flushThinking()
                items.append(.bash(m))
            case "summary":
                flush()
                flushThinking()
                items.append(.summary(m))
            default:
                break
            }
        }
        flush()
        // 작업 중이면 마지막 생각은 아직 다음 도구 묶음에 들어갈 수 있으니 보류(하단 '생각 중' 줄이 대신 보여줌)
        if !store.working {
            flushThinking()
            flushTurn()   // 아직 답하는 중인 마지막 답변엔 복사 버튼을 두지 않음
        }
        return items
    }
}

// MARK: - 항목별 모양

struct ChatItemView: View, Equatable {
    let item: ChatItem

    var body: some View {
        switch item {
        case .truncated(let n):
            Text("이전 메시지 \(n)개는 생략했어요")
                .font(.system(size: Typo.caption))
                .foregroundColor(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
        case .user(let m):
            UserBubble(message: m)
        case .text(_, let text):
            // 아주 긴 답은 앞부분만 보이고 '더 보기'(사용자 결정 11-18)
            Foldable(guess: Fold.guessAnswer(text)) { MarkdownView(text: text, foldLongCode: true) }
        case .progress(_, let text):
            // 마지막 답과 구분되게 조금 흐리게(사용자 결정 11-17). 답 글과 도구 단계 줄(회색)의 사이쯤
            MarkdownView(text: text, foldLongCode: true)
                .opacity(0.68)
                .accessibilityIdentifier("progressNote")
        case .tools(let id, let calls):
            ToolGroupRow(id: id, calls: calls)
        case .bash(let m):
            BashRow(message: m)
        case .summary(let m):
            SummaryRow(message: m)
        case .notice(_, let text, let isError):
            Text(text)
                .font(.system(size: Typo.row - 1))
                .foregroundColor(isError ? Theme.red : Theme.muted)
                .textSelection(.enabled)
        case .copy(_, let text):
            CopyButton(text: text, label: "답변 복사")
        }
    }
}

/// 내 메시지: 사진은 말풍선 위에 썸네일로, 글은 말풍선으로(글 속 사진 경로는 감춤)
/// 되감기(내 메시지 직전으로 돌아가 글을 입력창으로). 작업 중이면 맥 쪽에서 알려 줌
private struct RewindActionKey: EnvironmentKey { static let defaultValue: ((String, String) -> Void)? = nil }
extension EnvironmentValues {
    var rewindAction: ((String, String) -> Void)? {
        get { self[RewindActionKey.self] }
        set { self[RewindActionKey.self] = newValue }
    }
}

struct UserBubble: View {
    let message: ChatMessage
    @Environment(\.rewindAction) private var rewindAction

    var body: some View {
        let parts = ImageTokens.split(message.text ?? "")
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 6) {
                if !parts.paths.isEmpty {
                    ThumbRow(paths: parts.paths)
                } else if let n = message.images, n > 0 {
                    Label("이미지 \(n)장", systemImage: "photo")
                        .font(.system(size: Typo.caption))
                        .foregroundColor(Theme.muted)
                }
                if !parts.text.isEmpty {
                    // 붙여 넣은 아주 긴 글은 말풍선 안에서 접는다(사용자 결정 11-18)
                    Foldable(guess: Fold.guessBubble(parts.text), fade: Theme.bubble) {
                        Text(parts.text)
                            .font(.system(size: Typo.body))
                            .lineSpacing(Typo.bodyLineSpacing)
                            .foregroundColor(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("userBubble")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.bubble))
                    // 길게 누르면 Claude 앱처럼: 복사 · 여기서 다시 하기
                    .contextMenu {
                        Button { UIPasteboard.general.string = parts.text } label: { Label("복사", systemImage: "doc.on.doc") }
                        if let rewindAction {
                            Button { rewindAction(message.id, message.text ?? "") } label: {
                                Label("여기서 다시 하기", systemImage: "arrow.uturn.backward")
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 복사 버튼(누르면 잠깐 체크 표시). 답변 아래·코드 블록에서 쓴다.
struct CopyButton: View {
    let text: String
    let label: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(Theme.muted)
                .frame(width: 32, height: 28, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(copied ? "복사됨" : label)
        .accessibilityIdentifier(label == "코드 복사" ? "copyCode" : "copyAnswer")
    }
}

/// 아직 대화에 들어가지 않은 내 메시지(보내자마자 표시). 작업 중이면 "다음 단계에서 전달돼요".
/// pi 가 실제로 넣으면 사라지고 보통 말풍선으로 대화 흐름에 들어간다.
struct WaitingBubble: View {
    let text: String
    let caption: String?

    /// 작업 중에 보낸 방식별 안내
    static func caption(_ mode: String?) -> String? {
        switch mode {
        case nil: return nil
        case "auto": return "곧 전달돼요"
        case "followUp": return "작업이 끝나면 실행돼요"
        case "interrupt": return "지금 작업을 멈추고 실행해요"
        default: return "다음 단계에서 전달돼요"
        }
    }

    var body: some View {
        let parts = ImageTokens.split(text)
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 4) {
                if !parts.paths.isEmpty {
                    ThumbRow(paths: parts.paths).opacity(caption == nil ? 1 : 0.75)
                }
                if !parts.text.isEmpty {
                    Text(parts.text)
                        .font(.system(size: Typo.body))
                        .lineSpacing(Typo.bodyLineSpacing)
                        .foregroundColor(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.bubble))
                        .opacity(caption == nil ? 1 : 0.75)
                }
                if let caption {
                    Label(caption, systemImage: "clock")
                        .font(.system(size: Typo.caption))
                        .foregroundColor(Theme.muted)
                }
            }
        }
        .accessibilityIdentifier("pendingBubble")
        #if DEBUG
        .onAppear { NSLog("[perf] 대기 말풍선 표시") }
        #endif
    }
}

/// 단계 줄(Claude 앱처럼). 누르면 아래에서 단계 창이 올라온다.
/// - 도구 하나: "실행됨 무엇을 하는지" / "읽음 파일이름"
/// - 여러 개: "파일 2개 수정함, 명령어 5개 실행함  +73 −0"
/// - 생각만: "생각함 첫 줄 미리보기"
/// 사진을 읽은 단계가 있으면 줄 아래에 그 사진을 보여준다.
struct ToolGroupRow: View {
    let id: String
    let calls: [ToolCallInfo]
    @Environment(\.stepsPresenter) private var presenter

    var body: some View {
        let tools = calls.filter { !$0.thinking }
        VStack(alignment: .leading, spacing: 8) {
            Button {
                presenter?.open(groupId: id, steps: calls)
            } label: {
                line(tools)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("toolGroup")

            // 여러 단계면 무엇을 했는지 한두 줄(하나면 줄에 이미 보임)
            if tools.count > 1, !isRunning(tools) {
                let d = descriptions(tools)
                if !d.isEmpty {
                    Text(d)
                        .font(.system(size: Typo.caption + 1))
                        .foregroundColor(Theme.muted.opacity(0.85))
                        .lineLimit(2)
                        .padding(.leading, 32)
                        .padding(.top, -4)
                }
            }

            ForEach(tools.filter { $0.image && $0.state == "done" }, id: \.id) { t in
                ToolImageInline(path: "toolimg-\(t.id)")
            }
            // 아티팩트 카드(Claude 앱처럼): 누르면 전체 화면
            ForEach(tools.compactMap { $0.state == "done" ? $0.artifact : nil }, id: \.path) { a in
                ArtifactCard(ref: a)
            }
        }
    }

    @ViewBuilder
    private func line(_ tools: [ToolCallInfo]) -> some View {
        HStack(alignment: .center, spacing: 10) {
            if let r = tools.first(where: { $0.state == "running" || $0.state == "pending" }) {
                ProgressView().scaleEffect(0.75).tint(Theme.muted).frame(width: 22)
                (Text(StepText.runningVerb(r)) + Text(" ") + subjectText(r))
                    .lineLimit(1)
            } else if tools.isEmpty {
                StepIcon(step: calls[0]).frame(width: 22)
                (Text("생각함") + Text(calls[0].desc.isEmpty ? "" : " \(calls[0].desc)"))
                    .lineLimit(1)
            } else if tools.count == 1 {
                StepIcon(step: tools[0]).frame(width: 22)
                (Text(StepText.verb(tools[0])) + Text(" ") + subjectText(tools[0]))
                    .lineLimit(1)
            } else {
                Image(systemName: "list.bullet")
                    .font(.system(size: Typo.row - 1, weight: .medium))
                    .frame(width: 22)
                Text(StepText.groupLabel(tools))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if tools.contains(where: { $0.state == "error" }) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: Typo.row - 2))
                    .accessibilityLabel("오류 있음")
            }
            if let st = StepText.totalStats(tools) { StatsBadge(stats: st) }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
            Spacer(minLength: 0)
        }
        .font(.system(size: Typo.row))
        .foregroundColor(Theme.muted)
        .contentShape(Rectangle())
    }

    /// 파일 이름은 진하게, 설명은 흐리게
    private func subjectText(_ t: ToolCallInfo) -> Text {
        let sub = StepText.subject(t)
        return StepText.isFile(t) ? Text(sub).foregroundColor(Theme.text) : Text(sub)
    }

    private func isRunning(_ tools: [ToolCallInfo]) -> Bool {
        tools.contains { $0.state == "running" || $0.state == "pending" }
    }

    /// 각 도구의 한 줄 설명을 이어 붙임(같은 설명은 한 번만)
    private func descriptions(_ tools: [ToolCallInfo]) -> String {
        var seen = Set<String>()
        return tools.map(\.desc).filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: " · ")
    }
}

/// 단계가 읽은 사진(대화 기록에서 받아 옴). 기록에 없으면 자리 없이 숨김.
struct ToolImageInline: View {
    @EnvironmentObject private var thumbs: ThumbStore
    let path: String
    var tappable = true

    var body: some View {
        if !thumbs.isMissing(path) {
            ThumbView(path: path, size: .large, fit: true, tappable: tappable, axId: "toolImage")
                .frame(maxWidth: .infinity, maxHeight: 360)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.border))
        }
    }
}

/// 사용자가 직접 실행한 `!` 명령
struct BashRow: View {
    let message: ChatMessage
    /// 출력 12줄의 높이
    private static let outputHeight = UIFont.monospacedSystemFont(ofSize: Typo.codeSmall, weight: .regular).lineHeight * 12

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("$ \(message.command ?? "")")
                .font(.system(size: Typo.code, design: .monospaced))
                .foregroundColor(Theme.text)
                .textSelection(.enabled)
            if let out = message.output, !out.isEmpty {
                // 12줄쯤만 보이고, 더 있으면 '더 보기'로 펼친다
                Foldable(guess: Fold.guess(Self.outputHeight, out, inset: 52, fontSize: Typo.codeSmall, perLine: 18),
                         limit: Self.outputHeight, folded: Self.outputHeight, fade: Theme.bgElevated) {
                    Text(out)
                        .font(.system(size: Typo.codeSmall, design: .monospaced))
                        .foregroundColor(Theme.muted)
                        .textSelection(.enabled)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bgElevated))
    }
}

/// 대화 압축(요약) 지점
struct SummaryRow: View {
    let message: ChatMessage
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "archivebox").font(.system(size: 12))
                    Text("이전 대화를 요약했어요")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .font(.system(size: Typo.caption + 1))
                .foregroundColor(Theme.muted)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            if expanded, let t = message.text {
                Text(t)
                    .font(.system(size: Typo.caption + 1))
                    .foregroundColor(Theme.muted)
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 4)
    }
}

/// 하단 상태 줄. Claude 앱처럼 "• • 7초 · 생각 중…" (경과 시간은 작업 시작부터, 1초마다 이 줄만 갱신)
struct StatusRow: View {
    let label: String
    let since: Date?
    /// 작업 중일 때만 점이 움직인다. "연결 중"은 움직이지 않는 점 하나(오래 끊겨 있어도 배터리를 쓰지 않게)
    var animated: Bool = true
    /// 생각 중일 때 누르면 지금 하는 생각을 창으로
    var onTap: (() -> Void)? = nil

    var body: some View {
        if let onTap {
            Button(action: onTap) { row.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("statusRow")
        } else {
            row.accessibilityIdentifier("statusRow")
        }
    }

    private var row: some View {
        HStack(spacing: 10) {
            if animated {
                PulsingDots()
            } else {
                Circle().fill(Theme.accent).frame(width: 6, height: 6)
            }
            if let since {
                TimelineView(.periodic(from: since, by: 1)) { ctx in
                    Text("\(Self.elapsed(ctx.date.timeIntervalSince(since))) · \(label)…")
                }
            } else {
                Text("\(label)…")
            }
            if onTap != nil {
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
            }
        }
        .font(.system(size: Typo.row))
        .foregroundColor(Theme.muted)
        .padding(.top, 2)
    }

    /// 59초까지 "N초", 60초부터 "1분" / "1분 5초", 1시간부터 "1시간 2분"
    static func elapsed(_ t: TimeInterval) -> String {
        let s = max(0, Int(t))
        if s < 60 { return "\(s)초" }
        if s < 3600 { return s % 60 == 0 ? "\(s / 60)분" : "\(s / 60)분 \(s % 60)초" }
        let m = (s % 3600) / 60
        return m == 0 ? "\(s / 3600)시간" : "\(s / 3600)시간 \(m)분"
    }
}

/// 차례로 깜빡이는 작은 점 3개(클레이 색).
/// 깜빡임은 시각에서 바로 계산한다. 끝없이 되풀이하는 애니메이션을 점에 걸면, 그 순간 점의 자리가 바뀌는 것(위의 글이 접히거나
/// 늘어남)까지 붙잡아 점이 옛 자리와 새 자리 사이를 계속 오르내린다(11-18: 작업 중인 탭을 열면 점들이 화면을 오르내림)
struct PulsingDots: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Theme.accent)
                        .frame(width: 5, height: 5)
                        .opacity(Self.opacity(at: t, dot: i))
                }
            }
        }
    }

    /// 0.6초 동안 진해졌다 0.6초 동안 흐려진다(0.25~1, 점마다 0.2초씩 늦게, 천천히 시작해 천천히 끝남)
    static func opacity(at t: TimeInterval, dot i: Int) -> Double {
        let turn = (t - Double(i) * 0.2) / 1.2
        let x = turn - turn.rounded(.down)             // 한 번 오가는 동안 0 → 1
        let up = x < 0.5 ? x * 2 : (1 - x) * 2          // 0 → 1 → 0
        return 0.25 + 0.75 * up * up * (3 - 2 * up)
    }
}
