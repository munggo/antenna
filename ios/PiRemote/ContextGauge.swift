import SwiftUI

/// 컨텍스트 사용량(맥의 pi 확장·Claude Code 연결부가 보내줌). 자동 압축은 "사용량 > 기억 용량 - reserve"일 때 시작.
struct ContextInfo: Codable, Equatable {
    let tokens: Int?        // 모르면 nil(압축 직후, 다음 답변 전)
    let window: Int         // 모델 기억 용량(토큰)
    let percent: Double?    // 기억 용량 대비 사용률(0~100)
    let auto: Bool          // 자동 압축 켜짐
    let reserve: Int        // 자동 압축 여유분(토큰)

    /// 자동 압축이 시작되는 사용률(0~100). 꺼져 있으면 100
    var autoAt: Double {
        guard auto, window > 0 else { return 100 }
        return max(0, Double(window - reserve)) / Double(window) * 100
    }

    /// 자동 압축 지점까지 얼마나 찼는지(0~1). 색을 정할 때 쓴다
    var nearness: Double {
        guard let p = percent, autoAt > 0 else { return 0 }
        return p / autoAt
    }

    /// 게이지 색: 자동 압축 지점의 70% 전까지 회색, 90% 전까지 주황(클레이), 그 뒤 빨강
    var color: Color {
        if nearness >= 0.9 { return Theme.red }
        if nearness >= 0.7 { return Theme.accent }
        return Theme.muted
    }

    var percentText: String {
        guard let p = percent else { return "–" }
        return "\(Int(p.rounded()))%"
    }

    /// 8.2K / 84K / 1M / 1.5M
    static func tokens(_ n: Int) -> String {
        if n >= 1_000_000 {
            let v = Double(n) / 1_000_000
            return v == v.rounded() ? "\(Int(v))M" : String(format: "%.1fM", v)
        }
        if n >= 10_000 { return "\(Int((Double(n) / 1000).rounded()))K" }
        if n >= 1000 { return String(format: "%.1fK", Double(n) / 1000) }
        return "\(n)"
    }
}

/// 둥근 사용량 표시(작게: 입력창 칩 / 크게: 사용량 창). 크게 그릴 땐 자동 압축 지점에 눈금을 그린다.
struct ContextRing: View {
    let info: ContextInfo
    var size: CGFloat = 16
    var lineWidth: CGFloat = 2.5
    var showTick = false

    var body: some View {
        let frac = min(1, max(0, (info.percent ?? 0) / 100))
        ZStack {
            Circle().stroke(Theme.muted.opacity(0.25), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: frac)
                .stroke(info.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if showTick, info.auto {
                // 자동 압축 지점 눈금
                Capsule()
                    .fill(Theme.text.opacity(0.55))
                    .frame(width: 2, height: lineWidth + 6)
                    .offset(y: -size / 2)
                    .rotationEffect(.degrees(info.autoAt / 100 * 360))
            }
        }
        .frame(width: size, height: size)
    }
}

/// 입력창 칩 줄의 작은 게이지: ◔ 42%
struct ContextGauge: View {
    let info: ContextInfo

    var body: some View {
        HStack(spacing: 5) {
            ContextRing(info: info)
            Text(info.percentText)
                .font(.system(size: Typo.caption, weight: .medium).monospacedDigit())
                .foregroundColor(info.nearness >= 0.7 ? info.color : Theme.muted)
        }
        .padding(.horizontal, 8)
        .frame(height: 32)
        .contentShape(Rectangle())
    }
}

/// 게이지를 누르면 뜨는 사용량 창: 큰 원 · 사용 중 토큰 · 자동 압축 지점 · 지금 압축하기
struct ContextSheet: View {
    @ObservedObject var meta: ChatMeta
    @ObservedObject var session: TerminalSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let c = meta.context {
                    ZStack {
                        ContextRing(info: c, size: 112, lineWidth: 10, showTick: true)
                        Text(c.percentText)
                            .font(.system(size: 26, weight: .semibold).monospacedDigit())
                            .foregroundColor(Theme.text)
                    }
                    .padding(.top, 8)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("contextRing")

                    VStack(spacing: 10) {
                        row(String(localized: "사용 중"), c.tokens.map { String(localized: "\(ContextInfo.tokens($0)) / \(ContextInfo.tokens(c.window)) 토큰") }
                            ?? String(localized: "압축 직후라 다음 답변 뒤에 다시 계산돼요"))
                        row(String(localized: "자동 압축"), c.auto
                            ? String(localized: "\(Int(c.autoAt.rounded()))%(\(ContextInfo.tokens(max(0, c.window - c.reserve))))에서 시작")
                            : String(localized: "꺼져 있음"))
                    }

                    Text("대화가 길어져 자동 압축 지점에 닿으면 \(meta.agentName == "Claude" ? "Claude Code" : "pi")가 앞부분을 요약해 공간을 비워요. 요약된 앞부분의 자세한 내용은 잊을 수 있어요.")
                        .font(.system(size: Typo.caption + 1))
                        .foregroundColor(Theme.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    Button {
                        session.compactNow()
                        dismiss()
                    } label: {
                        Text(session.isWorking ? "작업이 끝나면 압축할 수 있어요" : "지금 압축하기")
                            .font(.system(size: Typo.row, weight: .medium))
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceHigh))
                            .foregroundColor(session.isWorking || c.tokens == nil ? Theme.muted : Theme.text)
                    }
                    .buttonStyle(.plain)
                    .disabled(session.isWorking || c.tokens == nil)
                    .accessibilityIdentifier("compactNow")
                } else {
                    Text("사용량을 아직 받지 못했어요")
                        .font(.system(size: Typo.row))
                        .foregroundColor(Theme.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .frame(maxWidth: .infinity)
            .background(Theme.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    CloseCircle(id: "contextClose") { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    Text("컨텍스트")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.text)
                }
            }
        }
        .tint(Theme.text)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .modifier(SheetStyle())
        .accessibilityIdentifier("contextSheet")
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundColor(Theme.muted)
            Spacer(minLength: 12)
            Text(value).foregroundColor(Theme.text).multilineTextAlignment(.trailing)
        }
        .font(.system(size: Typo.row))
    }
}
