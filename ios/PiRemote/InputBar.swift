import SwiftUI
import UIKit
import PhotosUI

/// 하단 작성창(Claude 앱 배치).
/// 맨 위: 붙인 사진 썸네일(올리는 중/완료/실패, x 로 빼기)
/// 가운데: 여러 줄 입력
/// 아랫줄: + (사진) · 생각 깊이 · 모델 · 전송(↑)/정지(■). 작업 중엔 생각·모델 대신 실행 시점 칩.
struct InputBar: View {
    @ObservedObject var session: TerminalSession
    /// 알림 띄우기에만 씀(구독하지 않음: 답변이 흘러나오는 동안 입력창이 다시 그려지지 않게)
    let chat: ChatStore
    /// 명령 목록·컨텍스트 사용량
    @ObservedObject var meta: ChatMeta
    /// 채팅/터미널 보기(선택 화면이 필요한 명령을 실행하면 터미널로 바꿈)
    @AppStorage("pi-remote.viewMode") private var viewMode = "chat"
    /// 쓰던 글은 기기에 저장(앱이 꺼졌다 켜져도 남음)
    @AppStorage("pi-remote.draft") private var text = ""
    /// 관리자 권한 확인 창(🔐 탭)에 넣는 글: 비밀번호일 수 있어 기기에 저장하지 않고, 가려서 보이고, 보내면 바로 지운다
    @State private var secret = ""
    /// 작업 중에 보낼 때 실행 시점: auto(자동, 기본) | steer(바로 반영) | followUp(끝나고 실행) | interrupt(멈추고 실행)
    /// 자동: 생각·답을 쓰는 중이면 멈추고 바로 넣고, 명령 실행 중이면 그 명령이 끝나는 즉시 넣는다
    @AppStorage("pi-remote.sendMode2") private var sendMode = "auto"
    /// '@' 파일 찾기를 잠깐 쉬었다 보내기(글자마다 맥에 묻지 않게)
    @State private var fileSearch: DispatchWorkItem?
    /// 질문 카드에서 체크한 선택지(여러 개 고르기)
    @State private var picked: Set<Int> = []
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotos = false
    /// 확인 창을 띄운 계정 고르기(auto | personal | personal2 | work). nil 이면 창 없음
    @State private var accountAsk: String? = nil
    /// 클립보드에 새로 복사된 사진이 있으면 "복사한 사진 붙이기" 제안(같은 클립보드는 한 번만)
    @State private var clipHasNewImage = false
    /// 클립보드에 사진이 있기만 하면 true(+ 메뉴에 '복사한 사진 붙여넣기' 표시)
    @State private var clipHasImage = false
    @AppStorage("pi-remote.clipSeen") private var clipSeen = 0
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 10) {
                if let q = slashQuery {
                    let list = SlashCommand.suggestions(q, ext: meta.commands)
                    if !list.isEmpty { SlashPanel(commands: list) { pick($0) } }
                }
                if atQuery != nil {
                    FilePanel(files: meta.files,
                              loading: meta.filesLoading || meta.filesQuery != atQuery,
                              error: meta.filesError) { pickFile($0) }
                }
                if !meta.todos.isEmpty, session.isWorking || meta.todos.contains(where: { $0.status != "completed" }) {
                    TodoPanel(todos: meta.todos)
                }
                // 승인이 여러 개면 하나씩(답하면 다음 것이 뜸)
                if let a = meta.approvals.first {
                    ApprovalCard(item: a, waiting: meta.approvals.count) { session.answerApproval(a.id, $0) }
                        .id(a.id)
                }
                if let q = meta.questions.first, q.isMulti {
                    MultiQuestionCard(item: q, compact: focused) { session.answerQuestions(q.id, items: $0) }
                        .id(q.id)
                } else if let q = meta.questions.first {
                    QuestionCard(item: q, picked: $picked, compact: focused,
                                 answer: { session.answerQuestion(q.id, answers: $0) },
                                 other: { focused = true },
                                 cancel: { session.answerQuestion(q.id, answers: [], cancel: true) })
                }
                if meta.outdated { reloadBanner }
                if clipHasNewImage { clipboardChip }
                if !session.attachments.isEmpty { attachmentStrip }
                if let stage = session.secretStage {
                    // 관리자 권한 확인 창(🔐 탭): 단계에 맞는 화면. 확인 단계에는 글을 넣을 칸이 없다(여기에 비밀번호를 치는 일이 없게)
                    if stage == "confirm" {
                        secretConfirmCard
                    } else if stage == "done" {
                        Text("끝났어요. 이 탭은 곧 닫혀요.")
                            .font(.system(size: Typo.body)).foregroundColor(Theme.muted)
                            .padding(.horizontal, 6).padding(.vertical, 8)
                    } else {
                        secretField
                        secretButtons(knowsStage: stage != "unknown")
                    }
                } else {
                    TextField("", text: $text, prompt: placeholder, axis: .vertical)
                        .lineLimit(1...8)
                        .focused($focused)
                        .font(.system(size: Typo.body))
                        .foregroundColor(Theme.text)
                        .tint(Theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.top, 4)
                        .accessibilityIdentifier("composerInput")

                    HStack(spacing: 8) {
                        photoButton
                        // 가운데 칩(생각·모델·계획): 글자가 잘리지 않게 넘치면 옆으로 밀어 보기
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                if session.isWorking {
                                    // 질문에 답하는 중에는 보내기 방식이 의미 없음(쓴 글이 곧 답)
                                    if meta.questions.isEmpty { modeMenu }
                                } else {
                                    thinkingMenu
                                    modelMenu
                                }
                                accountChip   // Claude Code 탭의 계정(일하는 중에도: 끝나면 바꾸기)
                                modeChip   // 권한 모드(pi 는 /mode, Claude Code 는 피드가 Shift+Tab 으로 맞춤)
                            }
                        }
                        actionButton
                    }
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Theme.border))
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
        }
        .padding(.top, 6)
        .background(Theme.bg)
        .onChange(of: focused) { session.inputFocused = $0 }
        // 원래 형식 그대로 받음: 기본값(.automatic)은 HEIC 를 JPEG 로 바꿔 줘서 받는 데 오래 걸렸다(11-15 시험: 2.7MB HEIC 가
        // 4MB JPEG 로 바뀌어 옴). 줄이는 쪽(ImageShrink)은 어떤 형식이든 읽음
        .confirmationDialog(accountAskTitle, isPresented: Binding(get: { accountAsk != nil }, set: { if !$0 { accountAsk = nil } }),
                            titleVisibility: .visible) {
            Button(accountAsk == "auto" ? "자동으로 되돌리기" : "바꾸기") {
                if let k = accountAsk { session.setAccount(k) }
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                accountAsk = nil
            }
            .accessibilityIdentifier("accountConfirm")
            Button("취소", role: .cancel) { accountAsk = nil }
        } message: {
            Text(accountAskMessage)
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 8, matching: .images, preferredItemEncoding: .current)
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            let picked = items
            photoItems = []
            Task { await upload(picked) }
        }
        .onAppear(perform: checkClipboard)
        .onReceive(NotificationCenter.default.publisher(for: UIPasteboard.changedNotification)) { _ in checkClipboard() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in checkClipboard() }
        #if DEBUG
        .onChange(of: text) { if $0.isEmpty { NSLog("[perf] 입력창 비워짐(화면 반영)") } }
        #endif
        .onChange(of: session.inputFocused) { if focused != $0 { focused = $0 } }
        .onChange(of: meta.questions.first?.id) { _ in picked = [] }
        // 되감은 뒤: 그 메시지 글을 입력창에(고쳐서 다시 보내기)
        .onChange(of: meta.prefill) { v in
            guard let v else { return }
            text = v
            focused = true
            meta.prefill = nil
        }
        .onChange(of: atQuery) { q in
            fileSearch?.cancel()
            guard let q else { return }
            let work = DispatchWorkItem { session.requestFiles(q) }
            fileSearch = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
        }
    }

    /// 관리자 권한 확인 창(🔐 탭)의 입력: 가려진 칸. 화면에 글자가 보이지 않고, 쓰던 글 저장·자동 고침·낱말 추천에도 남지 않는다
    private var secretField: some View {
        SecureField("", text: $secret, prompt: Text(session.status != .connected ? "연결 중…"
                                                    : session.isPasswordTab ? "눌러서 키보드 위 '암호'에서 고르기"
                                                    : "비밀번호를 물으면 여기에(가려서 보내요)").foregroundColor(Theme.muted))
            // 로그인 비밀번호 받기 탭: 비밀번호 칸이라고 알려 키보드 위에 아이폰 '암호'(Face ID) 단추가 뜨게 한다
            .textContentType(session.isPasswordTab ? .password : nil)
            .focused($focused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.send)
            .onSubmit(sendSecret)
            .font(.system(size: Typo.body))
            .foregroundColor(Theme.text)
            .tint(Theme.accent)
            .padding(.horizontal, 6)
            .padding(.top, 4)
            .accessibilityIdentifier("secretInput")
            .onChange(of: session.isSecretTab) { if !$0 { secret = "" } }
            .onDisappear { secret = "" }
    }

    /// 🔐 탭 확인 단계: 실행할지 묻는 버튼들(맥 화면의 Enter·v·q 와 같은 동작). 무엇을 하는 명령인지는 위 터미널 화면에 적혀 있다
    private var secretConfirmCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("관리자 권한 명령을 실행할까요?")
                .font(.system(size: Typo.body, weight: .semibold)).foregroundColor(Theme.text)
            Text("무엇을 하는지는 위 화면에 적혀 있어요. 비밀번호는 실행을 누른 뒤에 물어요.")
                .font(.system(size: 12)).foregroundColor(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                secretChip("취소", id: "secretCancel") { session.sendSecret("q") }
                secretChip("명령 보기", id: "secretShow") { session.sendSecret("v") }
                Spacer(minLength: 0)
                Button {
                    session.sendSecret("")   // Enter = 실행
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                } label: {
                    Text("실행")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20).padding(.vertical, 8)
                        .background(Capsule().fill(Theme.accent.opacity(session.status == .connected ? 1 : 0.4)))
                }
                .disabled(session.status != .connected)
                .accessibilityIdentifier("secretRun")
            }
        }
        .padding(.horizontal, 6).padding(.top, 4)
    }

    private func secretChip(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.text)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Theme.surfaceHigh))
        }
        .disabled(session.status != .connected)
        .accessibilityIdentifier(id)
    }

    /// 🔐 탭 실행 중의 버튼 줄: 멈추기(Ctrl+C) · 비밀번호 보내기.
    /// 단계를 모르는 예전 맥 쪽(knowsStage false)이면 확인 단계일 수도 있으므로, 비워서 보내면 Enter(실행)가 되게 둔다
    private func secretButtons(knowsStage: Bool) -> some View {
        HStack(spacing: 8) {
            secretChip(knowsStage ? "멈추기" : "취소", id: "secretStop") {
                session.sendBytes([0x03])   // Ctrl+C: 어느 단계에서든 멈추고 취소
                secret = ""
            }
            Text(!secret.isEmpty ? "가려서 보내고 바로 지워요" : knowsStage ? "비밀번호를 물을 때만 넣어 주세요" : "비워서 보내면 Enter(실행)")
                .font(.system(size: 12)).foregroundColor(Theme.muted)
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            let canSend = session.status == .connected && !(knowsStage && secret.isEmpty)
            Button(action: sendSecret) {
                Image(systemName: secret.isEmpty && !knowsStage ? "return" : "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Theme.accent.opacity(canSend ? 1 : 0.4)))
            }
            .disabled(!canSend)
            .accessibilityIdentifier("secretSend")
        }
    }

    private func sendSecret() {
        guard session.status == .connected else { return }
        // 단계를 아는데 빈 글이면 보내지 않는다(빈 비밀번호가 들어가 한 번 틀린 것으로 세어짐)
        if secret.isEmpty, session.secretStage != "unknown" { return }
        session.sendSecret(secret)
        secret = ""
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private var placeholder: Text {
        Text(session.status != .connected ? "연결 중… 연결되면 보낼 수 있어요"
             : meta.questions.first?.kind == "input" ? (meta.questions.first?.placeholder.flatMap { $0.isEmpty ? nil : $0 } ?? "여기에 써서 답하기")
             : meta.questions.first?.allowsOther == true ? "직접 입력해 답하기"
             : session.isWorking ? Self.modePlaceholder(sendMode) : "\(meta.agentName)에게 메시지 보내기")
            .foregroundColor(Theme.muted)
    }

    static func modeTitle(_ m: String) -> String {
        switch m {
        case "auto": return "자동"
        case "followUp": return "끝나고 실행"
        case "interrupt": return "멈추고 실행"
        default: return "바로 반영"
        }
    }

    static func modeIcon(_ m: String) -> String {
        switch m {
        case "auto": return "bolt"
        case "followUp": return "clock"
        case "interrupt": return "stop.circle"
        default: return "arrow.turn.down.right"
        }
    }

    static func modePlaceholder(_ m: String) -> String {
        switch m {
        case "auto": return "보내면 바로 전달돼요"
        case "followUp": return "보내면 지금 작업이 끝난 뒤 실행돼요"
        case "interrupt": return "보내면 지금 작업을 멈추고 실행돼요"
        default: return "보내면 다음 단계에서 바로 반영돼요"
        }
    }

    // MARK: - 붙인 사진

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(session.attachments) { a in
                    AttachmentChip(attachment: a) { session.removeAttachment(a.id) }
                }
            }
            .padding(.top, 6)
            .padding(.horizontal, 4)
        }
    }

    // MARK: - 작업 중 실행 시점

    private var modeMenu: some View {
        Menu {
            Section("작업 중에 보낼 때") {
                ForEach(["auto", "steer", "followUp", "interrupt"], id: \.self) { m in
                    Button { sendMode = m } label: {
                        if m == sendMode {
                            Label(Self.modeTitle(m), systemImage: "checkmark")
                        } else {
                            Label(Self.modeTitle(m), systemImage: Self.modeIcon(m))
                        }
                    }
                }
            }
        } label: {
            chip(icon: Self.modeIcon(sendMode), text: Self.modeTitle(sendMode), chevron: true)
        }
        .accessibilityIdentifier("sendModeMenu")
    }

    // MARK: - 아랫줄 버튼들

    /// + : 사진 보관함 / 복사한 사진 붙여넣기
    private var photoButton: some View {
        Menu {
            Button { startFileMention() } label: {
                Label("맥 파일 첨부", systemImage: "doc.badge.plus")
            }
            Button { showPhotos = true } label: {
                Label("사진 보관함", systemImage: "photo.on.rectangle")
            }
            if clipHasImage {
                Button { pasteImages() } label: {
                    Label("복사한 사진 붙여넣기", systemImage: "doc.on.clipboard")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 17, weight: .medium))
                .foregroundColor(Theme.text)
                .frame(width: 34, height: 34)
                .background(Circle().stroke(Theme.border, lineWidth: 1))
        }
        .accessibilityIdentifier("plusMenu")
    }

    /// 캡처해서 복사한 뒤 돌아오면 뜨는 제안 칩
    private var clipboardChip: some View {
        HStack(spacing: 8) {
            Button { pasteImages() } label: {
                Label("복사한 사진 붙이기", systemImage: "doc.on.clipboard")
                    .font(.system(size: Typo.caption + 1, weight: .medium))
                    .foregroundColor(Theme.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Theme.surfaceHigh))
            }
            .accessibilityIdentifier("clipboardChip")
            Button {
                clipSeen = UIPasteboard.general.changeCount
                clipHasNewImage = false
            } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.muted)
            }
            Spacer()
        }
        .padding(.top, 2)
    }

    /// 클립보드에 '새로 복사된' 사진이 있는지(내용을 읽지 않고 종류만 확인하므로 허용 확인창이 안 뜸)
    private func checkClipboard() {
        let pb = UIPasteboard.general
        clipHasImage = pb.hasImages
        clipHasNewImage = pb.hasImages && pb.changeCount != clipSeen
    }

    /// 클립보드 사진을 입력창에 붙인다(여러 장 가능). 처음엔 iOS 가 붙여넣기 허용을 물을 수 있음.
    private func pasteImages() {
        let pb = UIPasteboard.general
        clipSeen = pb.changeCount
        clipHasNewImage = false
        let datas: [Data] = (pb.images ?? []).compactMap { $0.jpegData(compressionQuality: 0.95) }
        guard !datas.isEmpty else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return
        }
        Task {
            for data in datas {
                let made = await Task.detached(priority: .userInitiated) { () -> (Data, Data)? in
                    guard let full = ImageShrink.jpeg(from: data),
                          let preview = ImageShrink.jpeg(from: data, maxPixel: 300, quality: 0.8) else { return nil }
                    return (full, preview)
                }.value
                if let (full, preview) = made { session.addAttachment(full: full, preview: preview) }
            }
        }
    }

    /// 생각 깊이: 누르면 단계 목록에서 바로 선택
    private var thinkingMenu: some View {
        Menu {
            Section("생각 깊이") {
                ForEach(thinkingLevels, id: \.self) { level in
                    Button {
                        session.setThinking(level)
                    } label: {
                        if level == session.piThinking {
                            Label(thinkingLabel(level), systemImage: "checkmark")
                        } else {
                            Text(thinkingLabel(level))
                        }
                    }
                }
            }
        } label: {
            chip(icon: "brain", text: session.piThinking.isEmpty ? "생각" : session.piThinking)
        }
        .accessibilityIdentifier("thinkingMenu")
    }

    /// 고를 수 있는 생각 깊이. Claude Code 에는 off·minimal 이 없다(고르면 low 로 바뀌어 맥 화면과 달라졌음)
    private var thinkingLevels: [String] {
        meta.agentName == "Claude" ? TerminalSession.thinkingLevels.filter { $0 != "off" && $0 != "minimal" } : TerminalSession.thinkingLevels
    }

    /// 모델: 누르면 바로 모델 목록(자동 계정 claude/… 하나로. 개인·회사 계정은 폴더별로 자동, 한도면 서로 대체)
    /// 같은 모델의 날짜 붙은 이름은 뺌. 다른 회사(OpenAI 등)에 로그인돼 있으면 그 모델만 묶음으로
    private var modelMenu: some View {
        Menu {
            Section(session.piModel.isEmpty ? "모델" : "현재: \(session.piModel)") {
                // Claude Code 탭: 맥의 /model 화면과 같은 선택지(맥이 알려 준 목록). 지금 모델의 계열에 체크
                ForEach(meta.modelChoices) { c in
                    Button { session.setModel(c.id) } label: {
                        if session.piModel.lowercased().hasPrefix(c.name.lowercased()) { Label(session.piModel, systemImage: "checkmark") } else { Text(c.name) }
                    }
                }
                ForEach(meta.modelChoices.isEmpty ? mainModels : [], id: \.self) { id in
                    let name = Self.modelName(id)
                    Button { session.setModel(id) } label: {
                        if name == session.piModel { Label(name, systemImage: "checkmark") } else { Text(name) }
                    }
                }
            }
            ForEach(meta.modelChoices.isEmpty ? otherProviders : [], id: \.self) { provider in
                Menu(providerLabel(provider)) {
                    ForEach(session.models.filter { $0.hasPrefix(provider + "/") }, id: \.self) { id in
                        Button(String(id.dropFirst(provider.count + 1))) { session.setModel(id) }
                    }
                }
            }
        } label: {
            chip(icon: nil, text: session.piModel.isEmpty ? "모델" : session.piModel)
        }
        .accessibilityIdentifier("modelMenu")
        .disabled(session.models.isEmpty && meta.modelChoices.isEmpty)
    }

    /// 한 목록에 보일 Claude 모델: 자동 계정(claude/…)이 있으면 그것만, 없으면 anthropic/…. 날짜 붙은 이름은 뺌
    private var mainModels: [String] {
        let auto = session.models.filter { $0.hasPrefix("claude/") }
        let list = (auto.isEmpty ? session.models.filter { $0.hasPrefix("anthropic/") } : auto)
            .filter { $0.range(of: #"-\d{8}$"#, options: .regularExpression) == nil }
        let rank = ["opus": 0, "sonnet": 1, "fable": 2, "haiku": 3]
        func key(_ id: String) -> (Int, [Int]) {
            let parts = (id.split(separator: "/").last ?? "").split(separator: "-")
            let fam = parts.first { rank[String($0)] != nil }.map(String.init) ?? ""
            return (rank[fam] ?? 9, parts.compactMap { Int($0) })
        }
        return list.sorted { a, b in
            let (ra, va) = key(a), (rb, vb) = key(b)
            return ra != rb ? ra < rb : va.lexicographicallyPrecedes(vb) == false && va != vb
        }
    }
    /// Claude 묶음(자동·개인·회사) 말고 로그인된 다른 회사
    private var otherProviders: [String] {
        providers.filter { !["claude", "anthropic", "anthropic-work", "anthropic-personal2"].contains($0) }
    }
    /// 'claude/claude-opus-5-5' → 'Opus 5.5'(맥 하단 줄·칩과 같은 이름)
    static func modelName(_ id: String) -> String {
        let parts = (id.split(separator: "/").last ?? "").split(separator: "-").map(String.init).filter { $0 != "claude" }
        guard let fam = parts.first else { return id }
        let ver = parts.dropFirst().filter { Int($0) != nil }.joined(separator: ".")
        return ver.isEmpty ? fam.capitalized : "\(fam.capitalized) \(ver)"
    }

    /// 전송(↑) 또는 정지(■). 보낼 게 있으면 전송(사진이 올라가는 중이면 기다림), 비어 있고 작업 중이면 정지.
    private var actionButton: some View {
        Group {
            if canSend {
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Theme.accent))
                }
                .accessibilityIdentifier("sendButton")
                // 길게 누르면: 새 탭에서 백그라운드로(끝나면 폰 알림, 이 탭에 결과 요약)
                .contextMenu {
                    Button { sendBackground() } label: {
                        Label("백그라운드로 보내기(새 탭)", systemImage: "rectangle.stack.badge.plus")
                    }
                    .accessibilityIdentifier("menuBackground")
                }
            } else if session.isWorking && !hasText && session.attachments.isEmpty {
                Button {
                    session.interrupt()
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Theme.bg)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Theme.text))
                }
                .accessibilityIdentifier("stopButton")
            } else {
                // 비활성: Claude 처럼 흐린 클레이 원 + 흰 화살표(사진이 올라가는 중이면 진행 표시)
                ZStack {
                    Circle().fill(Theme.accent.opacity(0.4))
                    if uploading {
                        ProgressView().tint(.white).scaleEffect(0.7)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white.opacity(0.9))
                    }
                }
                .frame(width: 34, height: 34)
                .accessibilityIdentifier("sendButtonDisabled")
            }
        }
    }

    /// 권한 모드 고르기(이름, 설명). pi 와 Claude Code 가 고를 수 있는 모드가 다름
    private var modeOptions: [(String, String, String)] {
        meta.agentName == "Claude"
            ? [("auto", "자동", "Claude 가 판단해 위험한 일만 물어요"), ("manual", "매번 묻기", "파일 수정·명령마다 물어요"),
               ("acceptEdits", "수정 허용", "파일 수정은 묻지 않고, 명령은 물어요"), ("plan", "계획", "읽기만 하며 계획을 세워요")]
            : [("auto", "자동", "보내기·위험한 일만 물어요"), ("ask", "매번 묻기", "파일 수정·명령도 실행 전에 물어요"), ("plan", "계획", "읽기만 하며 계획을 세워요")]
    }

    /// 권한 모드 칩(Claude Code 의 Shift+Tab 처럼): 자동이 평소, 다른 모드면 강조
    private var modeChip: some View {
        let m = meta.permMode
        let (icon, label): (String, String) = switch m {
        case "ask", "manual": ("hand.raised", "묻기")
        case "acceptEdits": ("pencil", "수정 허용")
        case "plan": ("list.bullet.clipboard", "계획")
        case "bypass": ("exclamationmark.shield", "모두 허용")
        default: ("bolt", "자동")
        }
        let on = m != "auto"
        return Menu {
            Section("권한 모드") {
                ForEach(modeOptions, id: \.0) { key, name, desc in
                    Button {
                        session.setPermMode(key)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        if key == m { Label("\(name) — \(desc)", systemImage: "checkmark") } else { Text("\(name) — \(desc)") }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                Text(label).font(.system(size: Typo.caption + 2, weight: on ? .semibold : .regular))
            }
            .foregroundColor(on ? .white : Theme.muted)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(Capsule().fill(on ? Theme.accent : Color.clear))
            .overlay(Capsule().stroke(on ? Color.clear : Theme.border))
        }
        .fixedSize()            // 칩 줄이 좁아도 글자가 줄어들지 않게(긴 모델 칩이 먼저 줄어듦)
        .layoutPriority(1)
        .accessibilityIdentifier("modeChip")
        .accessibilityValue(m)
    }

    /// 지금 보는 탭의 계정(Claude Code 탭이고 맥 연결부가 알려 준 때만)
    private var tabAccount: TabAccount? {
        meta.agentName == "Claude" ? session.windows.first(where: { $0.active })?.account : nil
    }

    /// 계정 칩(사용자 결정 11-18: Claude Code 탭마다 자동·개인·회사 고르기). 바꾸면 맥이 인수인계 문서를 받고 그 계정으로 새로 켬.
    /// 일하는 중이면 끝난 뒤에 바꾸고, 그동안 칩에 '개인→회사'처럼 보임
    @ViewBuilder private var accountChip: some View {
        if let a = tabAccount {
            let moving = !a.next.isEmpty && a.next != a.now
            Menu {
                Section("이 탭의 계정 · 지금 \(TabAccount.name(a.now))") {
                    // 추가 개인(personal2): 메인 개인이 한도에 가까울 때 쓰는 둘째 개인 계정(사용자 결정 11-25)
                    ForEach([("auto", "자동 — 폴더 기준"), ("personal", "개인"), ("personal2", "추가 개인"), ("work", "회사")], id: \.0) { key, title in
                        let picked = (key == "auto" ? "" : key) == a.pin
                        Button {
                            pickAccount(key, current: a)
                        } label: {
                            if picked { Label(title, systemImage: "checkmark") } else { Text(title) }
                        }
                        .accessibilityIdentifier("account-\(key)")
                    }
                }
                Text("바꾸면 지금 대화에 인수인계 문서를 쓰게 한 뒤 새로 켜요. 일하는 중이면 끝난 뒤에 바꿔요. 한도가 95%를 넘으면 그대로 쓸지 바꿀지 물어봐요")
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: moving ? (a.phase == "switch" ? "arrow.triangle.2.circlepath" : "clock") : "person.crop.circle")
                        .font(.system(size: 12, weight: .medium))
                    Text(moving ? "\(TabAccount.name(a.now))→\(TabAccount.name(a.next))" : TabAccount.name(a.now))
                        .font(.system(size: Typo.chip, weight: .medium)).lineLimit(1)
                    if !a.pin.isEmpty && !moving {
                        Image(systemName: "pin.fill").font(.system(size: 9, weight: .semibold))
                    }
                }
                .foregroundColor(moving ? .white : Theme.muted)
                .padding(.horizontal, 9)
                .frame(height: 34)
                .background(Capsule().fill(moving ? Theme.accent : Color.clear))
                .overlay(Capsule().stroke(moving ? Color.clear : Theme.border, lineWidth: 1))
            }
            .fixedSize()
            .disabled(a.phase == "switch")   // 바꾸는 중에는 고를 수 없음(맥도 받지 않음)
            .accessibilityIdentifier("accountChip")
            .accessibilityValue("\(a.now)|\(a.pin)|\(a.next)|\(a.phase)")
        }
    }

    /// 계정을 고름: 다시 켜질 수 있으면(지금과 다른 계정·자동으로 되돌림) 확인 창, 아니면 바로 보냄
    private func pickAccount(_ key: String, current a: TabAccount) {
        let pin = key == "auto" ? "" : key
        guard pin != a.pin else { return }
        if (pin.isEmpty || pin != a.now) {
            accountAsk = key
        } else {
            session.setAccount(key)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private var accountAskTitle: String {
        guard let k = accountAsk else { return "" }
        return k == "auto" ? "계정을 자동으로 되돌릴까요?" : "\(TabAccount.name(k)) 계정으로 바꿀까요?"
    }

    private var accountAskMessage: String {
        guard let k = accountAsk else { return "" }
        let how = "지금 대화에 인수인계 문서를 쓰게 한 뒤 대화를 비우고 새로 켜요. 일하는 중이면 끝난 뒤에 바꿔요."
        return k == "auto" ? "폴더·한도 기준 계정이 지금과 다르면 \(how)" : how
    }

    private func chip(icon: String?, text: String, chevron: Bool = false) -> some View {
        HStack(spacing: 5) {
            if let icon {
                Image(systemName: icon).font(.system(size: 12, weight: .medium))
            }
            Text(text).font(.system(size: Typo.chip, weight: .medium)).lineLimit(1)
            if chevron {
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
            }
        }
        .foregroundColor(Theme.muted)
        .padding(.horizontal, 9)
        .frame(height: 34)
        .background(Capsule().stroke(Theme.border, lineWidth: 1))
    }

    private var providers: [String] {
        var seen: [String] = []
        for id in session.models {
            let p = String(id.split(separator: "/").first ?? "")
            if !p.isEmpty, !seen.contains(p) { seen.append(p) }
        }
        // 자동 계정(폴더별 개인·회사)을 맨 위에
        let first = ["claude", "anthropic", "anthropic-work"]
        return seen.sorted { (first.firstIndex(of: $0) ?? 99, $0) < (first.firstIndex(of: $1) ?? 99, $1) }
    }

    private func providerLabel(_ p: String) -> String {
        switch p {
        case "claude": return "Claude 자동 계정"
        case "anthropic": return "Anthropic 개인 계정"
        case "anthropic-work": return "Anthropic 회사 계정"
        case "openai": return "OpenAI"
        default: return p
        }
    }

    private func thinkingLabel(_ level: String) -> String {
        switch level {
        case "off": return "끄기"
        case "minimal": return "최소 (minimal)"
        case "low": return "낮음 (low)"
        case "medium": return "보통 (medium)"
        case "high": return "높음 (high)"
        case "xhigh": return "매우 높음 (xhigh)"
        case "max": return "최대 (max)"
        default: return level
        }
    }

    // MARK: - 전송

    /// 맥 pi 가 예전 확장으로 돌 때: 새 기능(사용량 게이지 등)을 쓰려면 다시 불러와야 함
    private var reloadBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(Theme.accent)
            Text("맥 pi가 예전 확장으로 돌고 있어 새 기능이 안 보여요")
                .font(.system(size: Typo.caption + 1))
                .foregroundColor(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button {
                session.reloadPi()
            } label: {
                Text(session.isWorking ? "작업 끝나면" : "다시 불러오기")
                    .font(.system(size: Typo.caption + 1, weight: .semibold))
                    .foregroundColor(session.isWorking ? Theme.muted : Theme.text)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(Capsule().fill(Theme.surface))
            }
            .buttonStyle(.plain)
            .disabled(session.isWorking)   // pi 가 작업 중이면 /reload 를 거절함
            .accessibilityIdentifier("reloadPi")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceHigh))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reloadBanner")
    }

    // MARK: - 명령(/)

    /// 입력창이 `/` 로 시작하고 아직 띄어쓰기 전이면 명령을 고르는 중
    /// 끝 단어가 '@…'이면 그 뒤 글자(맥 파일 찾기). 끝이 빈칸·줄바꿈이면 끝난 것으로 봄
    private var atQuery: String? {
        guard let last = text.last, !last.isWhitespace else { return nil }
        let token = text.split(whereSeparator: { $0.isWhitespace }).last.map(String.init) ?? ""
        guard token.hasPrefix("@") else { return nil }
        return String(token.dropFirst())
    }

    /// 파일 고르기: 끝의 '@…'를 '@경로 '로(폴더는 빈칸 없이 넣어 그 안을 이어서 찾음, 맥 pi 와 같음)
    private func pickFile(_ f: FileSuggestion) {
        guard let q = atQuery else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        text = String(text.dropLast(q.count + 1)) + f.value + (f.isDir ? "" : " ")
    }

    /// + 메뉴 '맥 파일 첨부': 입력창 끝에 '@'를 넣고 목록을 띄움
    private func startFileMention() {
        if !text.isEmpty, !(text.last?.isWhitespace ?? true) { text += " " }
        text += "@"
        focused = true
    }

    private var slashQuery: String? {
        guard text.hasPrefix("/"), !text.contains(" "), !text.contains("\n") else { return nil }
        return String(text.dropFirst())
    }

    /// 제안에서 고르기: 뒤에 입력이 필요하면 입력창에 채우고, 아니면 바로 실행
    private func pick(_ c: SlashCommand) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if c.needsArg {
            text = "/\(c.name) "
            return
        }
        text = ""
        runCommand("/\(c.name)")
    }

    /// 명령 실행. pi 가 맥 화면에 선택창·출력을 띄우는 명령이면 폰도 터미널 보기로 바꿔 바로 조작하게 한다.
    private func runCommand(_ line: String) {
        let name = String(line.dropFirst().split(separator: " ").first ?? "")
        if name == "reload" && session.isWorking {
            // pi 는 작업 중 /reload 를 경고만 하고 버린다(맥 화면에만 보임) → 폰에서 먼저 알림
            chat.showNotice("작업이 끝난 뒤에 다시 불러올 수 있어요")
            return
        }
        if name == "resume" {
            session.showSessions = true   // 맥의 선택 창 대신 폰의 '지난 대화' 화면
            return
        }
        session.sendMessage(line, mode: sendMode)
        if SlashCommand.builtins.first(where: { $0.name == name })?.terminal == true {
            viewMode = "terminal"
            chat.showNotice("맥 화면의 선택 창을 터미널 보기로 열었어요")
        }
    }

    private var hasText: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var uploading: Bool { session.attachments.contains { $0.state == .uploading || $0.state == .preparing } }
    private var hasReadyImage: Bool { session.attachments.contains { $0.path != nil } }

    /// 보낼 수 있을 때: 연결돼 있고, 사진이 다 올라갔고, 글이나 사진이 있을 때.
    /// (연결이 끊긴 동안엔 보내도 전달되지 않으므로 막고 글은 그대로 둠)
    private var canSend: Bool {
        session.status == .connected && !uploading && (hasText || hasReadyImage)
    }

    /// 백그라운드로 보내기: 지금 탭과 같은 것(pi | Claude Code)을 같은 폴더의 새 탭에서 이 글로 켬
    private func sendBackground() {
        guard canSend else { return }
        let sent = text
        session.sendBackground(sent.trimmingCharacters(in: .whitespacesAndNewlines))
        text = ""
        for delay in [0.02, 0.12] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if !text.isEmpty, sent.hasSuffix(text) { text = "" }
            }
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    private func send() {
        guard canSend else { return }
        #if DEBUG
        NSLog("[perf] 보내기 누름")
        #endif
        let sent = text
        let body = sent.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.hasPrefix("/") {
            runCommand(body)   // 직접 친 명령도 선택 화면이 필요하면 터미널로
        } else if let q = meta.questions.first, q.allowsOther, !body.isEmpty {
            // 질문 카드가 떠 있으면 입력한 글이 그 질문의 답(기타). 여러 개 고르기면 체크한 것과 함께
            let chosen = picked.sorted().compactMap { q.options.indices.contains($0) ? q.options[$0].label : nil }
            session.answerQuestion(q.id, answers: q.multi ? chosen : [], other: body)
        } else {
            session.sendMessage(body, mode: sendMode)
        }
        text = ""
        // 한글 조합 중이던 마지막 글자가 비운 뒤에 다시 들어오는 경우가 있어, 잠시 뒤 그 찌꺼기만 지운다.
        // (예전처럼 키보드를 내렸다 올리지 않으므로 입력창이 출렁이지 않음)
        for delay in [0.02, 0.12] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if !text.isEmpty, sent.hasSuffix(text) { text = "" }
            }
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    /// 고른 사진들을 입력창에 붙이고 바로 맥에 미리 올린다. 고르자마자 사진 수만큼 '받는 중' 칸부터 띄우고,
    /// 여러 장은 세 장씩 함께 준비한다(11-15 사용자 보고 '고른 뒤 썸네일이 뜨기까지 시간이 걸림': 한 장씩 원본을 받아
    /// 두 번 푼 뒤에야 칸이 떠서, 시뮬레이터에서도 첫 칸 0.8초·둘째 칸 1.1초. 한꺼번에 하면 큰 원본이 메모리에 몰림)
    private func upload(_ items: [PhotosPickerItem]) async {
        let s = session
        let jobs = items.map { (item: $0, id: s.reserveAttachment()) }
        let t0 = Date()
        #if DEBUG
        NSLog("[perf] 사진 고름 %d장(칸 표시)", items.count)
        #endif
        await withTaskGroup(of: Void.self) { group in
            for (n, job) in jobs.enumerated() {
                if n >= 3 { _ = await group.next() }   // 세 장이 준비 중이면 하나 끝나기를 기다림
                group.addTask { await Self.prepare(job.item, id: job.id, session: s, since: t0, n: n + 1) }
            }
        }
    }

    /// 사진 한 장: 받기 → 파일에 들어 있는 미리보기로 칸 채우기 → 긴 변 2048px JPEG 로 줄이기(ProRAW/HEIC 호환) →
    /// 그것으로 선명한 썸네일 → 맥에 올리기. 받고 줄이는 일은 화면(메인) 밖에서, 칸 고치기만 메인에서
    nonisolated private static func prepare(_ item: PhotosPickerItem, id: String, session: TerminalSession, since t0: Date, n: Int) async {
        let fail = {
            await MainActor.run {
                session.failAttachment(id)
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return await fail() }
        #if DEBUG
        NSLog("[perf] 사진 %d 받음 %dKB %@ %.0fms", n, data.count / 1024, ImageShrink.kind(data), Date().timeIntervalSince(t0) * 1000)
        #endif
        if let quick = ImageShrink.embeddedPreview(from: data) {
            await MainActor.run { session.setAttachmentPreview(id, quick) }
            #if DEBUG
            NSLog("[perf] 사진 %d 그림(들어 있는 미리보기) %.0fms", n, Date().timeIntervalSince(t0) * 1000)
            #endif
        } else {
            #if DEBUG
            NSLog("[perf] 사진 %d 들어 있는 미리보기 없음", n)
            #endif
        }
        guard let full = ImageShrink.jpeg(from: data) else { return await fail() }
        let preview = ImageShrink.jpeg(from: full, maxPixel: 300, quality: 0.8)
        await MainActor.run {
            if let preview { session.setAttachmentPreview(id, preview) }   // 올리기 전에: 저장되면 이 그림이 말풍선 썸네일이 됨
            session.uploadAttachment(id, full: full)
        }
        #if DEBUG
        NSLog("[perf] 사진 %d 줄여 올리기 시작 %.0fms", n, Date().timeIntervalSince(t0) * 1000)
        #endif
    }
}

/// 입력창 위 사진 하나: 받는 중·올리는 중(진행 표시, 그림이 오기 전엔 빈 칸) / 완료 / 실패(느낌표), 오른쪽 위 x 로 빼기
struct AttachmentChip: View {
    let attachment: Attachment
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let data = attachment.preview, let img = UIImage(data: data) {
                    Image(uiImage: img).resizable().scaledToFill()
                } else {
                    Theme.surfaceHigh
                }
            }
            .frame(width: 58, height: 58)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                switch attachment.state {
                case .preparing, .uploading:
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.black.opacity(0.35))
                        ProgressView().tint(.white)
                    }
                case .failed:
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.black.opacity(0.45))
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.yellow)
                    }
                case .ready:
                    EmptyView()
                }
            }
            .accessibilityElement()
            .accessibilityIdentifier("attachmentThumb")
            .accessibilityLabel(attachment.preview == nil ? "사진 받는 중" : "사진")
            .accessibilityValue(stateName)

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Color.black.opacity(0.65))
            }
            .offset(x: 7, y: -7)
            .accessibilityIdentifier("attachmentRemove")
        }
        .padding(.top, 4)
        .padding(.trailing, 4)
    }

    private var stateName: String {
        switch attachment.state {
        case .preparing: return "preparing"
        case .uploading: return "uploading"
        case .ready: return "ready"
        case .failed: return "failed"
        }
    }
}
