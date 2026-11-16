import SwiftUI
import UIKit

/// 탭(tmux 창)의 pi 상태 색·글자. 맥 tmux 탭의 점 색과 같은 뜻.
enum TabStatus {
    static func color(_ s: String) -> Color {
        switch s {
        case "working": return Theme.accent        // 작업 중: 주황
        case "asking": return Theme.purple         // 답을 기다림: 보라
        case "yourturn": return Theme.green        // 끝남(아직 안 봄): 초록
        default: return Theme.muted.opacity(0.45)  // 쉬는 중
        }
    }

    static func label(_ s: String) -> String {
        switch s {
        case "working": return "작업 중"
        case "asking": return "답을 기다려요"
        case "yourturn": return "끝났어요"
        default: return ""
        }
    }
}

/// 서랍 '백그라운드' 칸의 글: 이름은 앞의 'bg ' 를 뗀 할 일, 그 아래 "작업 중 · 12분 · 메인 작업에서 시킴" 처럼
enum BackgroundText {
    /// 걸린 시간: "40초", "12분", "1시간 5분", "2일"
    static func duration(_ sec: Int) -> String {
        let s = max(0, sec)
        if s < 60 { return "\(s)초" }
        if s < 3600 { return "\(s / 60)분" }
        if s < 86400 {
            let m = s % 3600 / 60
            return m == 0 ? "\(s / 3600)시간" : "\(s / 3600)시간 \(m)분"
        }
        return "\(s / 86400)일"
    }

    static func title(_ w: TmuxWindow) -> String {
        let n = w.name.hasPrefix("bg ") ? String(w.name.dropFirst(3)) : w.name
        return n.isEmpty ? "창 \(w.index)" : n
    }

    /// 뒤에서 도는 일(맥 연결부가 적은 "셸 1개 · 에이전트 2개")을 "백그라운드 작업 3" 처럼 종류를 따지지 않고 합한 수로. 없으면 ""
    static func jobs(_ s: String) -> String {
        if s.isEmpty { return "" }
        let n = s.split(separator: "·").compactMap { Int($0.filter(\.isNumber)) }.reduce(0, +)
        return n > 0 ? "백그라운드 작업 \(n)" : "백그라운드 작업"
    }

    /// 생각 깊이 → 짧은 한글(맥 화면의 '백그라운드: …' 줄과 같은 낱말, claude-remote/bg-launch.mjs thinkingKo). 모르는 값은 ""
    static func thinking(_ level: String) -> String {
        switch level {
        case "off": return "생각 끔"
        case "minimal": return "최소"
        case "low": return "낮음"
        case "medium": return "보통"
        case "high": return "높음"
        case "xhigh": return "매우 높음"
        case "max": return "최대"
        default: return ""
        }
    }

    /// 백그라운드 탭이 쓰는 모델·생각 깊이: "Opus 5.5 · 높음". 모델을 모르면 ""
    static func model(_ w: TmuxWindow) -> String {
        guard !w.model.isEmpty else { return "" }
        return [InputBar.modelName(w.model), thinking(w.thinking)].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// 상태(걸린 시간·끝난 때) · 시킨 쪽. now: 1970년부터 초. 뒤에서 도는 일은 줄 아래 따로 누르는 '백그라운드 작업 N ›'
    static func line(_ w: TmuxWindow, now: Int) -> String {
        guard let b = w.bg else { return "" }
        var parts: [String] = []
        switch w.status {
        case "working": parts.append(b.started > 0 ? "작업 중 · \(duration(now - b.started))" : "작업 중")
        case "asking": parts.append("답을 기다려요")
        default:
            if b.done > 0 { parts.append(now - b.done < 60 ? "끝남 · 방금" : "끝남 · \(duration(now - b.done)) 전") }
            else if w.status == "yourturn" { parts.append("끝났어요") }
            else { parts.append("쉬는 중") }
        }
        let from = b.fromName.isEmpty ? (b.from.map { "창 \($0)" } ?? "") : b.fromName
        switch b.by {
        case "ai": parts.append(from.isEmpty ? "AI가 시킴" : "\(from)의 AI가 시킴")
        case "phone": parts.append("폰에서 시킴")
        default: if !from.isEmpty { parts.append("\(from)에서 시킴") }
        }
        return parts.joined(separator: " · ")
    }
}

/// 왼쪽 위 서랍 버튼(☰). 다른 탭에 있는 상태마다 색 점을 오른쪽 위에 살짝 겹쳐 보인다(최대 3개).
/// 가장 급한 상태(답을 기다림 보라 > 끝남 초록 > 작업 중 주황)가 모서리 맨 위.
/// 지금 보는 탭은 화면에 이미 보이므로 빼고, 자세한 건 서랍에서 본다.
/// 백그라운드 탭은 답을 기다릴 때만 넣는다(일하는 동안 주황 점이 늘 켜져 있지 않게. 끝나면 폰 알림과 시킨 탭의 결과 요약으로 알려 줌)
struct TabDrawerButton: View {
    let windows: [TmuxWindow]
    let action: () -> Void

    private var others: [TmuxWindow] { windows.filter { !$0.active && ($0.bg == nil || $0.status == "asking") } }

    /// 알림 점에 쓸 상태들(급한 순서). 없으면 점 없음
    private var badges: [String] {
        ["asking", "yourturn", "working"].filter { s in others.contains { $0.status == s } }
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Theme.text)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Theme.surfaceHigh))
                .overlay(alignment: .topTrailing) {
                    if !badges.isEmpty {
                        // 왼쪽부터 덜 급한 순서, 오른쪽(모서리)일수록 위에 겹침
                        HStack(spacing: -5) {
                            ForEach(Array(badges.reversed().enumerated()), id: \.element) { i, s in
                                Circle()
                                    .fill(TabStatus.color(s))
                                    .frame(width: 11, height: 11)
                                    .overlay(Circle().stroke(Theme.bg, lineWidth: 2))
                                    .zIndex(Double(i))
                            }
                        }
                        .offset(x: 1, y: -1)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("drawerButton")
        .accessibilityLabel(summary)
        .accessibilityValue("\(windows.count)")
    }

    /// "탭 목록, 다른 탭: 답을 기다림 1, 작업 중 1"(VoiceOver·시험용)
    private var summary: String {
        let parts = [("asking", "답을 기다림"), ("yourturn", "끝남"), ("working", "작업 중")].compactMap { key, name -> String? in
            let n = others.filter { $0.status == key }.count
            return n > 0 ? "\(name) \(n)" : nil
        }
        return parts.isEmpty ? "탭 목록" : "탭 목록, 다른 탭: " + parts.joined(separator: ", ")
    }
}

/// 왼쪽 서랍(Claude 앱 방식): 탭을 세로로 이름·상태와 함께. 맨 위 새 탭, 아래 지난 대화·연결 설정.
/// - 탭을 누르면 그 탭으로, 길게 누르면 이름 바꾸기·닫기
/// - 백그라운드 탭(/bgtab·AI·폰이 맡긴 일)은 아래 '백그라운드' 칸에 따로: 할 일·상태·걸린 시간·시킨 탭, 끝난 것 모두 닫기
/// - 탭 안에서 뒤에서 도는 일(Claude Code 의 셸·에이전트 등)이 있으면 그 줄 아래 합한 수로 "백그라운드 작업 3 ›".
///   누르면 그 탭으로 가서 작업 목록(이름·걸린 시간·셸의 최근 출력, 종료)을 연다
struct TabDrawer: View {
    @ObservedObject var session: TerminalSession
    let onSelect: (Int) -> Void
    let onJobs: (TmuxWindow) -> Void
    let onRename: (TmuxWindow) -> Void
    let onCloseWindow: (TmuxWindow) -> Void
    let onCloseFinished: () -> Void
    let onPastSessions: () -> Void
    let onSettings: () -> Void
    let onUsage: () -> Void

    private var mainTabs: [TmuxWindow] { session.windows.filter { $0.bg == nil } }
    private var bgTabs: [TmuxWindow] { session.windows.filter { $0.bg != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("탭")
                    .font(.system(size: Typo.title, weight: .semibold))
                    .foregroundColor(Theme.text)
                Spacer()
                Button {
                    session.newWindow()
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Theme.surfaceHigh))
                }
                .accessibilityIdentifier("drawerNewTab")
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 10)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(mainTabs) { w in row(w) }
                    if !bgTabs.isEmpty { backgroundSection }
                }
                .padding(.horizontal, 8)
            }

            UsageMiniCard(usage: session.usage, onOpen: onUsage)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            Rectangle().fill(Theme.border).frame(height: 1)
            VStack(spacing: 2) {
                menuRow("지난 대화", icon: "clock.arrow.circlepath", id: "drawerPast", action: onPastSessions)
                menuRow("연결 설정", icon: "gearshape", id: "drawerSettings", action: onSettings)
            }
            .padding(8)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.bg.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("drawer")
    }

    /// 아래 '백그라운드' 칸: 머리(개수·끝난 것 모두 닫기)와 줄들. 걸린 시간은 서랍이 열려 있는 동안 30초마다 다시 셈
    private var backgroundSection: some View {
        let finished = bgTabs.filter(\.finishedBackground).count
        return VStack(spacing: 2) {
            HStack(spacing: 8) {
                Text("백그라운드 \(bgTabs.count)")
                    .font(.system(size: Typo.caption + 1, weight: .semibold))
                    .foregroundColor(Theme.muted)
                    .accessibilityIdentifier("drawerBgTitle")
                Spacer(minLength: 0)
                if finished > 0 {
                    Button(action: onCloseFinished) {
                        Text("끝난 것 모두 닫기")
                            .font(.system(size: Typo.caption + 1, weight: .medium))
                            .foregroundColor(Theme.text)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(Theme.surfaceHigh))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("bgCloseFinished")
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 14)
            .padding(.bottom, 4)
            TimelineView(.periodic(from: .now, by: 30)) { ctx in
                let now = Int(ctx.date.timeIntervalSince1970)
                VStack(spacing: 2) {
                    ForEach(bgTabs) { w in row(w, now: now) }
                }
            }
        }
    }

    /// 탭 한 줄: 상태 그림, 이름, 그 아래 글(보통 탭: 상태, 백그라운드 탭: BackgroundText.line과 그 아래 모델·생각 깊이).
    /// 뒤에서 도는 일이 있으면 그 아래 따로 누르는 '백그라운드 작업 N ›'(줄 단추 안에 단추를 겹치지 않게 둘로 나눔)
    private func row(_ w: TmuxWindow, now: Int = 0) -> some View {
        let isBg = w.bg != nil
        let title = isBg ? BackgroundText.title(w) : (w.name.isEmpty ? "창 \(w.index)" : w.name)
        let sub = isBg ? BackgroundText.line(w, now: now) : TabStatus.label(w.status)
        let model = isBg ? BackgroundText.model(w) : ""
        let jobs = BackgroundText.jobs(w.jobs)
        let subColor: Color = {
            if w.status == "working" || w.status == "asking" { return TabStatus.color(w.status) }
            if isBg { return Theme.muted }   // 끝남·쉬는 중인 백그라운드 줄은 흐린 글
            return TabStatus.color(w.status)   // 끝났어요는 초록
        }()
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                onSelect(w.index)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                HStack(spacing: 12) {
                    statusIcon(w).frame(width: 22, height: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.system(size: Typo.row, weight: w.active ? .semibold : .regular))
                            .foregroundColor(Theme.text)
                            .lineLimit(1)
                        if !sub.isEmpty {
                            Text(sub)
                                .font(.system(size: Typo.caption + 1))
                                .foregroundColor(subColor)
                                .lineLimit(2)
                        }
                        if !model.isEmpty {
                            Text(model)
                                .font(.system(size: Typo.caption + 1))
                                .foregroundColor(Theme.muted)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, jobs.isEmpty ? 10 : 2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("tab-\(w.index)")
            .accessibilityValue(w.active ? "선택됨" : "")
            if !jobs.isEmpty {
                Button {
                    onJobs(w)
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    HStack(spacing: 4) {
                        Text(jobs)
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                    }
                    .font(.system(size: Typo.caption + 1))
                    .foregroundColor(Theme.accent)
                    .padding(.leading, 12 + 22 + 12)   // 상태 그림 칸만큼 들여 이름과 줄을 맞춤
                    .padding(.trailing, 12)
                    .padding(.top, 2)
                    .padding(.bottom, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("tab-jobs-\(w.index)")
            }
        }
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(w.active ? Theme.surfaceHigh : .clear))
        .opacity(w.finishedBackground && !w.active ? 0.6 : 1)   // 끝난 백그라운드 탭은 흐리게
        .contextMenu {
            Button { onRename(w) } label: { Label("이름 바꾸기", systemImage: "pencil") }
            Button(role: .destructive) { onCloseWindow(w) } label: {
                Label("창 닫기", systemImage: "xmark.square")
            }
        }
    }

    @ViewBuilder
    private func statusIcon(_ w: TmuxWindow) -> some View {
        switch w.status {
        case "working":
            ProgressView().tint(Theme.accent).scaleEffect(0.75)
        case "asking":
            Image(systemName: "questionmark.circle.fill")
                .font(.system(size: 17))
                .foregroundColor(Theme.purple)
        default:
            if (w.bg?.done ?? 0) > 0 {
                // 끝난 백그라운드 탭(결과는 시킨 탭에 보냄)
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 16))
                    .foregroundColor(Theme.green)
            } else if w.status == "yourturn" {
                Circle().fill(Theme.green).frame(width: 9, height: 9)
            } else {
                Circle().stroke(Theme.muted.opacity(0.5), lineWidth: 1.5).frame(width: 9, height: 9)
            }
        }
    }

    private func menuRow(_ title: String, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .foregroundColor(Theme.muted)
                    .frame(width: 22)
                Text(title)
                    .font(.system(size: Typo.row))
                    .foregroundColor(Theme.text)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}
