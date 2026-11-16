import Charts
import SwiftUI

/// 하루 사용량(주간 한도 대비 %p, 맥 브리지가 계산)
struct DailyUsage: Codable, Equatable, Identifiable {
    let date: String   // yyyy-MM-dd
    let used: Double
    var id: String { date }
    var day: Date { UsageFormat.dayFormatter.date(from: date) ?? Date() }
}

/// 주간 사용률 기록 한 점
struct UsagePoint: Identifiable, Equatable {
    let time: Date
    let week: Double
    var id: Date { time }
}

enum UsageFormat {
    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static let weekday = ["일", "월", "화", "수", "목", "금", "토"]

    static func weekdayName(_ d: Date) -> String { weekday[Calendar.current.component(.weekday, from: d) - 1] }

    /// '11/16(월) 16:00 초기화'
    static func reset(_ iso: String?) -> String? {
        guard let iso, let d = UsageSheet.parseDate(iso) else { return nil }
        let c = Calendar.current.dateComponents([.month, .day, .hour, .minute], from: d)
        return String(format: "%d/%d(%@) %02d:%02d 초기화", c.month ?? 0, c.day ?? 0, weekdayName(d), c.hour ?? 0, c.minute ?? 0)
    }
}

/// 그래프 계열 하나(계정)
struct UsageSeries: Identifiable {
    let label: String
    let color: Color
    let points: [UsagePoint]
    var id: String { label }
}

/// 하루 사용량 막대 하나(계정별)
struct DailyBar: Identifiable {
    let date: String
    let used: Double
    let label: String
    let color: Color
    var id: String { "\(label)-\(date)" }
    var day: Date { UsageFormat.dayFormatter.date(from: date) ?? Date() }
}

extension UsageInfo {
    /// 모든 모델 주간 한도(없으면 첫 주간 한도)
    var weekLimit: Limit? { limits?.first { $0.key == "week" } ?? limits?.first { !$0.session } }
    /// 최근 7일 주간 % 기록
    var weekPoints: [UsagePoint] { Self.points(history) }
    static func points(_ history: [[Double?]]?) -> [UsagePoint] {
        let since = Date().addingTimeInterval(-7 * 86400)
        return (history ?? []).compactMap { row in
            guard row.count >= 3, let t = row[0], let w = row[2] else { return nil }
            let time = Date(timeIntervalSince1970: t / 1000)
            return time >= since ? UsagePoint(time: time, week: w) : nil
        }
    }
    /// 계정별 주간 선(계정 정보가 없으면 한 선)
    var chartSeries: [UsageSeries] {
        if let a = accounts, !a.isEmpty { return a.map { UsageSeries(label: $0.label, color: $0.color, points: $0.weekPoints) } }
        return [UsageSeries(label: "주간", color: Theme.accent, points: weekPoints)]
    }
    /// 계정별 하루 사용량 막대
    var dailyBars: [DailyBar] {
        if let a = accounts, !a.isEmpty {
            return a.flatMap { acc in (acc.daily ?? []).map { DailyBar(date: $0.date, used: $0.used, label: acc.label, color: acc.color) } }
        }
        return (daily ?? []).map { DailyBar(date: $0.date, used: $0.used, label: "", color: Theme.accent) }
    }
}

/// 사용량 화면: 7일 동안 주간 사용률(계정별 선, 한 계정이면 면도)
struct WeeklyUsageChart: View {
    let series: [UsageSeries]

    var body: some View {
        Chart {
            ForEach(series) { s in
                ForEach(s.points) { p in
                    if series.count == 1 {
                        AreaMark(x: .value("시각", p.time), y: .value("주간", p.week))
                            .foregroundStyle(LinearGradient(colors: [s.color.opacity(0.35), s.color.opacity(0.03)], startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.stepEnd)
                    }
                    LineMark(x: .value("시각", p.time), y: .value("주간", p.week), series: .value("계정", s.label))
                        .foregroundStyle(s.color)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                        .interpolationMethod(.stepEnd)
                    if s.points.count < 3 {
                        PointMark(x: .value("시각", p.time), y: .value("주간", p.week)).foregroundStyle(s.color).symbolSize(18)
                    }
                }
            }
        }
        .chartXScale(domain: Date().addingTimeInterval(-7 * 86400)...Date())
        .chartYScale(domain: 0...100)
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { v in
                AxisGridLine().foregroundStyle(Theme.border)
                AxisValueLabel { Text("\(v.as(Int.self) ?? 0)%").font(.system(size: 10)).foregroundColor(Theme.muted) }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day)) { v in
                AxisGridLine().foregroundStyle(Theme.border.opacity(0.5))
                AxisValueLabel {
                    if let d = v.as(Date.self) { Text(UsageFormat.weekdayName(d)).font(.system(size: 10)).foregroundColor(Theme.muted) }
                }
            }
        }
        .frame(height: 170)
        .accessibilityIdentifier("weeklyChart")
    }
}

/// 범례: ● 개인 ● 회사
struct ChartLegend: View {
    let series: [UsageSeries]
    var body: some View {
        HStack(spacing: 14) {
            ForEach(series) { s in
                HStack(spacing: 5) {
                    Circle().fill(s.color).frame(width: 8, height: 8)
                    Text(s.label).font(.system(size: Typo.caption + 1)).foregroundColor(Theme.muted)
                }
            }
        }
    }
}

/// 날짜별 하루 사용량 막대(계정이 여럿이면 나란히). compact 면 서랍 카드용(축 없이 작게)
struct DailyUsageChart: View {
    let bars: [DailyBar]
    var compact = false

    var body: some View {
        let multi = Set(bars.map(\.label)).count > 1
        Chart(bars) { d in
            BarMark(x: .value("날짜", d.date), y: .value("사용", d.used))
                .foregroundStyle(Calendar.current.isDateInToday(d.day) ? d.color : d.color.opacity(0.55))
                .cornerRadius(compact ? 1.5 : 3)
                .position(by: .value("계정", multi ? d.label : "하나"))
        }
        .chartXAxis {
            if compact {
                AxisMarks { _ in }
            } else {
                AxisMarks { v in
                    AxisValueLabel {
                        if let s = v.as(String.self), let d = UsageFormat.dayFormatter.date(from: s) {
                            Text(UsageFormat.weekdayName(d)).font(.system(size: 11)).foregroundColor(Theme.muted)
                        }
                    }
                }
            }
        }
        .chartYAxis {
            if compact {
                AxisMarks { _ in }
            } else {
                AxisMarks(position: .leading) { v in
                    AxisGridLine().foregroundStyle(Theme.border)
                    AxisValueLabel { Text("\(v.as(Double.self).map { String(format: "%.0f", $0) } ?? "")").font(.system(size: 10)).foregroundColor(Theme.muted) }
                }
            }
        }
        .frame(height: compact ? 28 : 120)
        .accessibilityIdentifier(compact ? "dailyMiniChart" : "dailyChart")
    }
}

/// 주간 사용률 원형 고리(가운데 %). 90% 넘으면 빨강
struct UsageRing: View {
    let percent: Double?
    let color: Color
    var size: CGFloat = 58

    var body: some View {
        let p = min(max((percent ?? 0) / 100, 0), 1)
        let tint = (percent ?? 0) >= 90 ? Theme.red : color
        ZStack {
            Circle().stroke(Theme.muted.opacity(0.22), lineWidth: 6)
            Circle()
                .trim(from: 0, to: p)
                .stroke(tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(percent.map { "\(Int($0.rounded()))%" } ?? "–")
                .font(.system(size: size * 0.26, weight: .semibold, design: .rounded))
                .foregroundColor(Theme.text)
                .minimumScaleFactor(0.7)
        }
        .frame(width: size, height: size)
        .accessibilityIdentifier("usageRing")
    }
}

/// 서랍 아래 작은 카드: 계정별 이번 주 사용률 원형 고리 · 초기화 시각(회사는 'N시간 전 기준'). 누르면 사용량 화면
struct UsageMiniCard: View {
    let usage: UsageInfo?
    let onOpen: () -> Void

    private struct Cell: Identifiable {
        let label: String; let color: Color; let percent: Double?; let note: String?
        var id: String { label }
    }
    private var cells: [Cell] {
        if let a = usage?.accounts, !a.isEmpty {
            return a.map { Cell(label: $0.label, color: $0.color, percent: $0.weekLimit?.percent,
                                note: $0.staleText ?? UsageFormat.reset($0.weekLimit?.resetsAt)) }
        }
        return [Cell(label: "이번 주", color: Theme.accent, percent: usage?.weekLimit?.percent, note: UsageFormat.reset(usage?.weekLimit?.resetsAt))]
    }

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 10) {
                Text("이번 주 사용량").font(.system(size: Typo.caption)).foregroundColor(Theme.muted)
                HStack(alignment: .top, spacing: 0) {
                    ForEach(cells) { c in
                        VStack(spacing: 6) {
                            UsageRing(percent: c.percent, color: c.color)
                            HStack(spacing: 4) {
                                Circle().fill(c.color).frame(width: 6, height: 6)
                                Text(c.label).font(.system(size: Typo.caption + 1, weight: .medium)).foregroundColor(Theme.text)
                            }
                            if let n = c.note {
                                Text(n.replacingOccurrences(of: " 초기화", with: "\n초기화"))
                                    .font(.system(size: Typo.caption - 1))
                                    .foregroundColor(Theme.muted)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surfaceHigh.opacity(0.6)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("usageMiniCard")
    }
}
