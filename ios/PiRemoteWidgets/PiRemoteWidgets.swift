import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PiRemoteWidgets: WidgetBundle {
    var body: some Widget {
        PiWorkLiveActivity()
    }
}

/// 상태별 색·아이콘·글자(앱의 탭 상태 색과 같은 뜻)
private enum WorkStyle {
    static func color(_ s: String) -> Color {
        switch s {
        case "asking": return Color(red: 0.69, green: 0.56, blue: 0.90)   // 보라
        case "done": return Color(red: 0.55, green: 0.75, blue: 0.48)     // 초록
        case "error": return Color(red: 0.90, green: 0.40, blue: 0.35)    // 빨강
        case "stopped": return .gray
        default: return Color(red: 0.80, green: 0.49, blue: 0.37)        // 작업 중: Claude 클레이
        }
    }

    static func icon(_ s: String) -> String {
        switch s {
        case "asking": return "questionmark.circle.fill"
        case "done": return "checkmark.circle.fill"
        case "error": return "exclamationmark.triangle.fill"
        case "stopped": return "stop.circle.fill"
        default: return "circle.dotted.circle"
        }
    }

    static func label(_ s: String) -> String {
        switch s {
        case "asking": return "답을 기다려요"
        case "done": return "끝났어요"
        case "error": return "멈췄어요"
        case "stopped": return "멈춤"
        default: return "작업 중"
        }
    }
}

/// 경과 시간: 일하는 동안은 저절로 올라가고, 끝나면 걸린 시간으로 멈춤
private struct Elapsed: View {
    let state: PiWorkAttributes.ContentState

    var body: some View {
        let start = Date(timeIntervalSince1970: state.startedAt)
        if let end = state.endedAt {
            Text(Self.duration(end - state.startedAt))
        } else {
            Text(timerInterval: start...Date.distantFuture, countsDown: false)
        }
    }

    static func duration(_ sec: Double) -> String {
        let s = max(0, Int(sec))
        return s >= 3600 ? "\(s / 3600)시간 \(s % 3600 / 60)분" : s >= 60 ? "\(s / 60)분 \(s % 60)초" : "\(s)초"
    }
}

struct PiWorkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PiWorkAttributes.self) { context in
            // 잠금 화면·알림 배너
            let s = context.state
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: WorkStyle.icon(s.status))
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(WorkStyle.color(s.status))
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(context.attributes.tabName)
                            .font(.system(size: 16, weight: .semibold))
                            .lineLimit(1)
                        Text(WorkStyle.label(s.status))
                            .font(.system(size: 14))
                            .foregroundColor(WorkStyle.color(s.status))
                        Spacer(minLength: 4)
                        Elapsed(state: s)
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 90, alignment: .trailing)
                    }
                    Text(s.detail)
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(white: 0.12))
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: "piremote://tab/\(context.attributes.window)"))
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: WorkStyle.icon(s.status)).foregroundColor(WorkStyle.color(s.status))
                        Text(context.attributes.tabName).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Elapsed(state: s)
                        .font(.system(size: 14, design: .monospaced))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 80, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("\(WorkStyle.label(s.status)) · \(s.detail)")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            } compactLeading: {
                Image(systemName: WorkStyle.icon(s.status)).foregroundColor(WorkStyle.color(s.status))
            } compactTrailing: {
                Elapsed(state: s)
                    .font(.system(size: 13, design: .monospaced))
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 48)
            } minimal: {
                Image(systemName: WorkStyle.icon(s.status)).foregroundColor(WorkStyle.color(s.status))
            }
            .widgetURL(URL(string: "piremote://tab/\(context.attributes.window)"))
        }
    }
}
