import SwiftUI

/// 브리지가 보내는 Claude 요금제 사용량 ({"type":"usage", ...})
struct UsageInfo: Decodable, Equatable {
    struct Limit: Decodable, Equatable {
        let key: String?          // session | week | week:<모델>
        let label: String
        let percent: Double
        let resetsAt: String?
        let session: Bool
        let severity: String
    }
    struct Extra: Decodable, Equatable {
        let enabled: Bool
        let used: Double?
        let limit: Double?
        let currency: String?
        let decimals: Int?
        let percent: Double?
    }
    let plan: String?
    let limits: [Limit]?
    let extra: Extra?
    let fetchedAt: String?
    let error: String?
    /// 최근 8일 기록 [시각(ms), 세션%, 주간%](맥 브리지가 10분마다 기록, 20분 간격으로 줄임)
    let history: [[Double?]]?
    /// 최근 7일 하루 사용량
    let daily: [DailyUsage]?
    /// 계정별(개인·회사). 없으면 예전처럼 한 계정
    let accounts: [AccountUsage]?
}

/// 계정 하나의 사용량(개인: 사용량 API, 회사: 회사 계정을 쓸 때 응답에 실려 온 값)
struct AccountUsage: Decodable, Equatable, Identifiable {
    let key: String
    let label: String
    let plan: String?
    let limits: [UsageInfo.Limit]?
    let history: [[Double?]]?
    let daily: [DailyUsage]?
    let updatedAt: Double?   // 회사: 마지막으로 갱신된 시각(ms)
    var id: String { key }
    var color: Color { key == "work" ? Theme.teal : Theme.accent }
    var weekLimit: UsageInfo.Limit? { limits?.first { $0.key == "week" || $0.key == "work:7d" } ?? limits?.first { !$0.session } }
    /// 모델별 주간 한도(예: Fable) 가운데 가장 많이 쓴 것. 없으면 nil
    var modelWeekLimit: UsageInfo.Limit? { UsageInfo.modelWeek(limits, outer: weekLimit) }
    var weekPoints: [UsagePoint] { UsageInfo.points(history) }
    /// '3시간 전 기준'(회사, 10분 넘었을 때)
    var staleText: String? {
        guard let t = updatedAt else { return nil }
        let m = Int(Date().timeIntervalSince1970 - t / 1000) / 60
        if m < 10 { return nil }
        return m < 120 ? "\(m)분 전 기준" : m < 48 * 60 ? "\(m / 60)시간 전 기준" : "\(m / 1440)일 전 기준"
    }
}

/// 사용량 화면(Claude 앱 사용량 화면처럼 막대로 표시). … 메뉴 → 사용량.
struct UsageSheet: View {
    @ObservedObject var session: TerminalSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if let u = session.usage {
                        if let err = u.error {
                            Label(err, systemImage: "exclamationmark.triangle")
                                .font(.system(size: 15))
                                .foregroundColor(Theme.red)
                        } else {
                            if let plan = u.plan, !plan.isEmpty, (u.accounts ?? []).isEmpty {
                                Text(plan)
                                    .font(.system(size: 15))
                                    .foregroundColor(Theme.muted)
                            }
                            if let accts = u.accounts, !accts.isEmpty {
                                ForEach(accts) { a in accountSection(a) }
                            } else {
                                limitsSection(u)
                            }
                            graphSection(u)
                            extraSection(u.extra)
                            if let at = u.fetchedAt.flatMap(Self.parseDate) {
                                Text("\(Self.relative(at)) 업데이트")
                                    .font(.system(size: Typo.caption))
                                    .foregroundColor(Theme.muted)
                            }
                        }
                    } else {
                        HStack(spacing: 10) {
                            ProgressView().tint(Theme.muted)
                            Text("불러오는 중…").foregroundColor(Theme.muted)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Theme.bg)
            .navigationTitle("사용량")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { session.requestUsage(force: true) } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(session.usageLoading)
                    .accessibilityIdentifier("usageRefresh")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("닫기") { dismiss() }
                }
            }
            .tint(Theme.text)
        }
        .presentationDetents([.medium, .large])
        .modifier(SheetBackground())
        .onAppear { session.requestUsage(force: false) }
    }

    @ViewBuilder
    private func limitsSection(_ u: UsageInfo) -> some View {
        let limits = u.limits ?? []
        VStack(alignment: .leading, spacing: 22) {
            Text("요금제 사용 한도")
                .font(.system(size: Typo.body, weight: .semibold))
                .foregroundColor(Theme.text)
            if limits.isEmpty {
                Text("표시할 한도가 없어요")
                    .font(.system(size: 15))
                    .foregroundColor(Theme.muted)
            }
            ForEach(Array(limits.enumerated()), id: \.offset) { _, l in
                UsageBar(title: l.label,
                         percent: l.percent,
                         caption: Self.resetText(l),
                         alert: l.severity != "normal" || l.percent >= 90,
                         color: l.weekModel == nil ? Theme.accent : UsageInfo.modelColor)
            }
        }
    }

    /// 계정 카드: '개인 · Claude Max 20x' / '회사 · 3시간 전 기준' + 한도 막대
    @ViewBuilder
    private func accountSection(_ a: AccountUsage) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 8) {
                Circle().fill(a.color).frame(width: 9, height: 9)
                Text(a.label).font(.system(size: Typo.body, weight: .semibold)).foregroundColor(Theme.text)
                if let p = a.plan, !p.isEmpty { Text(p).font(.system(size: 15)).foregroundColor(Theme.muted) }
                Spacer(minLength: 0)
                if let s = a.staleText { Text(s).font(.system(size: Typo.caption)).foregroundColor(Theme.muted) }
            }
            let limits = a.limits ?? []
            if limits.isEmpty {
                Text(a.key == "work" ? "회사 계정을 쓰면 사용량이 보여요" : "표시할 한도가 없어요")
                    .font(.system(size: 15)).foregroundColor(Theme.muted)
            }
            ForEach(Array(limits.enumerated()), id: \.offset) { _, l in
                // 모델별 주간 한도(예: Fable)는 서랍 고리의 안쪽 고리와 같은 색으로
                UsageBar(title: l.label, percent: l.percent, caption: Self.resetText(l), alert: l.severity != "normal" || l.percent >= 90,
                         color: l.weekModel == nil ? a.color : UsageInfo.modelColor)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceHigh.opacity(0.45)))
        .accessibilityIdentifier("usageAccount-\(a.key)")
    }

    /// 주간 사용 추이(7일)·하루 사용량
    @ViewBuilder
    private func graphSection(_ u: UsageInfo) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("주간 사용 추이")
                .font(.system(size: Typo.body, weight: .semibold))
                .foregroundColor(Theme.text)
            let series = u.chartSeries
            if series.contains(where: { $0.points.count >= 2 }) {
                WeeklyUsageChart(series: series)
                if series.count > 1 { ChartLegend(series: series) }
            } else {
                Text("기록을 모으는 중이에요. 맥이 10분마다 사용량을 기록해요.")
                    .font(.system(size: 15))
                    .foregroundColor(Theme.muted)
            }
            if u.dailyBars.contains(where: { $0.used > 0 }) || !(u.daily ?? []).isEmpty {
                HStack {
                    Text("하루 사용량")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(Theme.text)
                    Spacer()
                    Text("주간 한도 대비 %p")
                        .font(.system(size: Typo.caption))
                        .foregroundColor(Theme.muted)
                }
                .padding(.top, 6)
                DailyUsageChart(bars: u.dailyBars)
            }
        }
    }

    @ViewBuilder
    private func extraSection(_ e: UsageInfo.Extra?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("추가 사용량")
                .font(.system(size: Typo.body, weight: .semibold))
                .foregroundColor(Theme.text)
            if let e, e.enabled {
                UsageBar(title: Self.money(e),
                         percent: e.percent ?? 0,
                         caption: "이번 달",
                         alert: (e.percent ?? 0) >= 90)
            } else {
                Text("꺼져 있어요")
                    .font(.system(size: 15))
                    .foregroundColor(Theme.muted)
            }
        }
    }

    // MARK: - 표시 형식

    static func parseDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// 세션: "3시간 12분 후 초기화" / 주간: "11월 16일 (일) 오후 3:59 초기화"
    static func resetText(_ l: UsageInfo.Limit) -> String {
        guard let s = l.resetsAt, let d = parseDate(s) else { return "" }
        let mins = max(0, Int(d.timeIntervalSinceNow / 60))
        if l.session || mins < 24 * 60 {
            let h = mins / 60, m = mins % 60
            return h > 0 ? "\(h)시간 \(m)분 후 초기화" : "\(m)분 후 초기화"
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일 (E) a h:mm"
        return "\(f.string(from: d)) 초기화"
    }

    /// "방금" / "N분 전" / "N시간 전" (맥·폰 시계가 조금 어긋나 미래로 나와도 "방금")
    static func relative(_ d: Date) -> String {
        let mins = Int(Date().timeIntervalSince(d) / 60)
        if mins < 1 { return "방금" }
        if mins < 60 { return "\(mins)분 전" }
        return "\(mins / 60)시간 전"
    }

    /// 추가 사용량 금액(센트 단위 정수일 수 있어 decimals 로 나눔)
    static func money(_ e: UsageInfo.Extra) -> String {
        let div = pow(10, Double(e.decimals ?? 0))
        let cur = e.currency ?? ""
        func fmt(_ v: Double?) -> String {
            guard let v else { return "-" }
            return String(format: "%.2f", v / div)
        }
        return "\(fmt(e.used)) / \(fmt(e.limit)) \(cur)".trimmingCharacters(in: .whitespaces)
    }
}

/// 한 줄 사용량 막대: 제목 · 퍼센트 / 막대 / 초기화 안내
struct UsageBar: View {
    let title: String
    let percent: Double
    let caption: String
    let alert: Bool
    var color: Color = Theme.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.system(size: Typo.row))
                    .foregroundColor(Theme.text)
                Spacer()
                Text("\(Int(percent.rounded()))% 사용")
                    .font(.system(size: Typo.row - 1))
                    .foregroundColor(alert ? Theme.red : Theme.muted)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surfaceHigh)
                    Capsule()
                        .fill(alert ? Theme.red : color)
                        .frame(width: max(0, min(1, percent / 100)) * g.size.width)
                }
            }
            .frame(height: 8)
            if !caption.isEmpty {
                Text(caption)
                    .font(.system(size: Typo.caption))
                    .foregroundColor(Theme.muted)
            }
        }
    }
}

/// 시트 바탕색(iOS 16.4 이상에서만 지정 가능)
private struct SheetBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) { content.presentationBackground(Theme.bg) } else { content }
    }
}
