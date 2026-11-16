import SwiftUI

/// 뒤에서 도는 작업 목록(서랍의 '백그라운드 작업 N ›'을 누르면): 작업마다 종류·이름·걸린 시간·셸의 최근 출력과 종료.
/// 에이전트는 그 아래 줄에 종류·모델·생각 깊이(맥이 확실히 아는 것만, 11-16).
/// 셸은 맥에서 바로 종료하고, 에이전트·감시는 Claude 에게 종료해 달라고 보낸다(맥 연결부가 처리, 사용자 결정 11-14. 표현은 '종료', 11-15).
/// 열려 있는 동안 2초마다 새로 받는다. 탭을 막 바꿨을 때 들어온 다른 탭의 목록은 쓰지 않는다(창 번호로 가림)
struct JobsSheet: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var meta: ChatMeta
    @ObservedObject var store: ChatStore
    let tab: TmuxWindow
    @Environment(\.dismiss) private var dismiss
    @State private var confirm: BgJob?
    private let tick = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        CloseCircle(id: "jobsClose") { dismiss() }
                    }
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 0) {
                            Text("백그라운드 작업")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(Theme.text)
                            Text(BackgroundText.title(tab))
                                .font(.system(size: Typo.caption))
                                .foregroundColor(Theme.muted)
                        }
                    }
                }
                .confirmationDialog(confirm.map { Self.confirmTitle($0) } ?? "",
                                    isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                                    titleVisibility: .visible, presenting: confirm) { j in
                    Button(j.kind == "shell" ? "셸 종료" : "종료해 달라고 보내기", role: .destructive) { session.killBgJob(j.id) }
                    Button("취소", role: .cancel) {}
                } message: { j in
                    Text(j.kind == "shell"
                         ? "맥에서 바로 종료해요. Claude Code 는 이 셸이 끝났다는 알림을 받아요."
                         : "Claude 에게 이 작업을 종료해 달라고 보내요. 일하는 중이면 다음 단계에서 종료해요.")
                }
                .overlay(alignment: .bottom) {
                    if let n = store.notice {
                        Text(n)
                            .font(.system(size: Typo.caption + 1))
                            .foregroundColor(Theme.text)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(Theme.surfaceHigh))
                            .padding(.bottom, 20)
                            .accessibilityIdentifier("jobsNotice")
                    }
                }
        }
        .tint(Theme.text)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .modifier(SheetStyle())
        .onAppear {
            meta.bgJobs = nil
            meta.bgJobsError = nil
            session.requestBgJobs()
        }
        .onReceive(tick) { _ in session.requestBgJobs() }
    }

    /// 이 탭의 목록(다른 탭의 목록이면 아직 못 받은 것으로)
    private var mine: [BgJob]? { meta.bgJobsWindow == tab.index ? meta.bgJobs : nil }

    @ViewBuilder
    private var content: some View {
        if let err = meta.bgJobsError {
            VStack(spacing: 12) {
                Text(err).font(.system(size: Typo.row)).foregroundColor(Theme.muted)
                Button("다시 시도") { meta.bgJobsError = nil; session.requestBgJobs() }
            }
        } else if let list = mine {
            if list.isEmpty {
                Text("뒤에서 도는 작업이 없어요")
                    .font(.system(size: Typo.row))
                    .foregroundColor(Theme.muted)
                    .accessibilityIdentifier("jobsEmpty")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(list) { j in
                            row(j)
                            Rectangle().fill(Theme.border).frame(height: 0.5).padding(.leading, 52)
                        }
                    }
                    .padding(.bottom, 60)
                }
                .accessibilityIdentifier("jobsList")
            }
        } else if session.status != .connected {
            Text("맥에 연결되면 목록을 불러와요")
                .font(.system(size: Typo.row))
                .foregroundColor(Theme.muted)
        } else {
            ProgressView().tint(Theme.muted)
        }
    }

    private func row(_ j: BgJob) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: Self.icon(j.kind))
                    .font(.system(size: 15))
                    .foregroundColor(Theme.accent)
                    .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text(j.title)
                        .font(.system(size: Typo.row))
                        .foregroundColor(Theme.text)
                        .lineLimit(2)
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(Self.subline(j, now: ctx.date))
                            .font(.system(size: Typo.caption + 1))
                            .foregroundColor(Theme.muted)
                    }
                    if !Self.agentLine(j).isEmpty {
                        Text(Self.agentLine(j))
                            .font(.system(size: Typo.caption + 1))
                            .foregroundColor(Theme.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Button { confirm = j } label: {
                    Text("종료")
                        .font(.system(size: Typo.caption + 1, weight: .medium))
                        .foregroundColor(Theme.red)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Theme.surfaceHigh))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("jobKill-\(j.id)")
            }
            if let t = j.tail, !t.isEmpty {
                Text(t)
                    .font(.system(size: Typo.codeSmall - 1, design: .monospaced))
                    .foregroundColor(Theme.muted)
                    .lineLimit(4)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.bgElevated))
                    .padding(.leading, 32)
                    .accessibilityIdentifier("jobTail-\(j.id)")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("job-\(j.id)")
    }

    /// "셸 · 12분째"
    static func subline(_ j: BgJob, now: Date) -> String {
        "\(kindName(j.kind)) · \(BackgroundText.duration(Int(now.timeIntervalSince1970 - j.startedAt / 1000)))째"
    }

    /// 에이전트의 종류·모델·생각 깊이: "Explore · Haiku 5.5 · 높음"(모르는 값은 뺌). 에이전트가 아니거나 다 모르면 ""
    static func agentLine(_ j: BgJob) -> String {
        guard j.kind == "agent" else { return "" }
        return [j.agentType ?? "", j.model ?? "", BackgroundText.thinking(j.thinking ?? "")].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func kindName(_ k: String) -> String {
        switch k {
        case "shell": return "셸"
        case "agent": return "에이전트"
        case "monitor": return "감시"
        default: return "작업"
        }
    }

    static func icon(_ k: String) -> String {
        switch k {
        case "shell": return "terminal"
        case "agent": return "person.2"
        case "monitor": return "eye"
        default: return "gearshape"
        }
    }

    static func confirmTitle(_ j: BgJob) -> String {
        let name = j.title.count > 30 ? String(j.title.prefix(30)) + "…" : j.title
        return "'\(name)' \(kindObject(j.kind)) 종료할까요?"
    }

    /// 종류 + 받침에 맞는 목적격 조사: "셸을", "에이전트를", "감시를", "작업을"
    static func kindObject(_ k: String) -> String {
        switch k {
        case "shell": return "셸을"
        case "agent": return "에이전트를"
        case "monitor": return "감시를"
        default: return "작업을"
        }
    }
}
