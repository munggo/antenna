import ActivityKit
import Foundation

/// 맥 pi 작업 표시(잠금 화면·다이내믹 아일랜드). 앱과 위젯 확장이 함께 쓴다.
/// 브리지가 Apple 푸시로 시작·갱신·끝을 보낸다(content-state·attributes 키 이름이 브리지와 같아야 함).
@available(iOS 16.1, *)
struct PiWorkAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String      // working | asking | done | error | stopped
        var detail: String      // 지금 하는 일 한 줄
        var startedAt: Double   // 작업 시작(유닉스 초)
        var endedAt: Double?    // 끝난 시각(끝났을 때만)
    }

    var window: Int             // tmux 창 번호(누르면 그 탭으로)
    var tabName: String         // 탭 이름
}
