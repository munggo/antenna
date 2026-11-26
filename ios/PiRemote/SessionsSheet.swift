import SwiftUI

/// 지난 대화 하나(브리지가 pi 공식 목록으로 보내줌)
struct PastSession: Decodable, Identifiable, Equatable {
    struct OpenTab: Decodable, Equatable {
        let here: Bool      // 폰이 보는 tmux 세션의 탭인지(아니면 다른 곳에서 열린 것)
        let index: Int
        let name: String
    }
    let path: String
    let cwd: String
    let name: String
    let first: String
    let modified: Double    // ms
    let count: Int
    let open: OpenTab?

    var id: String { path }

    /// 목록 제목: 붙인 이름 > 첫 메시지(사진 경로는 빼고)
    var title: String {
        if !name.isEmpty { return name }
        let parts = ImageTokens.split(first)
        let t = parts.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
        return parts.paths.isEmpty ? String(localized: "(내용 없음)") : String(localized: "사진")
    }

    /// 홈이 아닌 폴더에서 연 대화면 끝 두 단계(예: works/company)
    var folder: String? {
        let comps = cwd.split(separator: "/")
        if comps.count <= 2 { return nil }   // /Users/이름 = 홈
        return comps.suffix(2).joined(separator: "/")
    }

    /// "방금 / 5분 전 / 3시간 전 / 어제 오후 3:20 / 4일 전 / 11월 2일"
    static func when(_ ms: Double, now: Date = Date()) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        let s = now.timeIntervalSince(d)
        if s < 60 { return String(localized: "방금") }
        if s < 3600 { return String(localized: "\(Int(s / 60))분 전") }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return String(localized: "\(Int(s / 3600))시간 전") }
        let f = DateFormatter()
        f.locale = Locale(identifier: Bundle.main.preferredLocalizations.first == "ko" ? "ko_KR" : "en_US")   // 앱 언어에 맞춘 월·요일·오전오후
        if cal.isDateInYesterday(d) {
            f.dateFormat = String(localized: "'어제' a h:mm")
            return f.string(from: d)
        }
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: now)).day ?? 0
        if days < 7 { return String(localized: "\(days)일 전") }
        f.dateFormat = cal.isDate(d, equalTo: now, toGranularity: .year) ? String(localized: "M월 d일") : String(localized: "yyyy년 M월 d일")
        return f.string(from: d)
    }
}

/// 지난 대화 창. 고르면 이미 열린 탭이면 그 탭으로, 아니면 새 탭에서 이어간다(지금 대화는 그대로).
struct SessionsSheet: View {
    @ObservedObject var session: TerminalSession
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    /// 열린 기록은 없지만 방금까지 쓰이던 대화(다른 곳에서 열려 있을 수 있음) → 한 번 확인
    @State private var confirmTarget: PastSession?
    /// '방금까지 쓰이던 대화'로 보는 시간(분)
    static let recentMinutes = 10.0

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        CloseCircle(id: "sessionsClose") { dismiss() }
                    }
                    ToolbarItem(placement: .principal) {
                        Text("지난 대화")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.text)
                    }
                }
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "대화 검색")
                .confirmationDialog("방금까지 쓰이던 대화예요",
                                    isPresented: Binding(get: { confirmTarget != nil }, set: { if !$0 { confirmTarget = nil } }),
                                    titleVisibility: .visible, presenting: confirmTarget) { s in
                    Button("새 탭에서 열기") {
                        dismiss()
                        session.openSession(s)
                    }
                    Button("취소", role: .cancel) {}
                } message: { _ in
                    Text("맥 터미널 등 다른 곳에서 아직 열려 있다면 같은 대화를 두 곳에서 쓰게 돼요.")
                }
        }
        .tint(Theme.text)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .modifier(SheetStyle())
        .onAppear { session.requestSessions() }
        .onChange(of: session.status) { s in
            if s == .connected { session.requestSessions() }   // 연결이 늦게 붙으면 그때 불러옴
        }
    }

    @ViewBuilder
    private var content: some View {
        if let list = session.pastSessions {
            let shown = filtered(list)
            if shown.isEmpty {
                Text(query.isEmpty ? "지난 대화가 없어요" : "찾는 대화가 없어요")
                    .font(.system(size: Typo.row))
                    .foregroundColor(Theme.muted)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(shown) { s in
                            row(s)
                            Rectangle().fill(Theme.border).frame(height: 0.5).padding(.leading, 20)
                        }
                    }
                    .padding(.bottom, 24)
                }
                .accessibilityIdentifier("sessionsList")
            }
        } else if let err = session.pastSessionsError {
            VStack(spacing: 12) {
                Text(err).font(.system(size: Typo.row)).foregroundColor(Theme.muted)
                Button("다시 시도") { session.requestSessions() }
            }
        } else if session.status != .connected {
            Text("맥에 연결되면 목록을 불러와요")
                .font(.system(size: Typo.row))
                .foregroundColor(Theme.muted)
        } else {
            ProgressView().tint(Theme.muted)
        }
    }

    private func filtered(_ list: [PastSession]) -> [PastSession] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return list }
        return list.filter { s in
            [s.title, s.first, s.cwd].contains { $0.lowercased().contains(q) }
        }
    }

    private func row(_ s: PastSession) -> some View {
        let currentIndex = session.windows.first(where: \.active)?.index
        let isCurrent = s.open?.here == true && s.open?.index == currentIndex
        let elsewhere = s.open != nil && s.open?.here == false
        let meta = [PastSession.when(s.modified), String(localized: "메시지 \(s.count)개"), s.folder].compactMap { $0 }.joined(separator: " · ")
        let recent = Date().timeIntervalSince1970 * 1000 - s.modified < Self.recentMinutes * 60 * 1000
        return Button {
            if isCurrent {
                dismiss()
            } else if s.open == nil && recent {
                confirmTarget = s   // 열린 기록이 없는 pi(예전 확장·tmux 밖)가 쓰는 중일 수 있음
            } else {
                dismiss()
                session.openSession(s)
            }
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(s.title)
                    .font(.system(size: Typo.body))
                    .foregroundColor(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(meta)
                    if isCurrent {
                        tag(String(localized: "지금 대화"))
                    } else if let o = s.open, o.here {
                        tag(String(localized: "열린 탭 · \(o.name)"))
                    } else if elsewhere {
                        tag(String(localized: "다른 곳에서 열림"))
                    }
                }
                .font(.system(size: Typo.caption))
                .foregroundColor(Theme.muted)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(elsewhere)   // 같은 대화를 pi 두 개가 동시에 쓰지 않도록
        .opacity(elsewhere ? 0.5 : 1)
        .accessibilityIdentifier("pastSession")
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(.system(size: Typo.caption - 1, weight: .medium))
            .foregroundColor(Theme.text.opacity(0.8))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(Theme.surfaceHigh))
    }
}
