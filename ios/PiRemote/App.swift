import SwiftUI

@main
struct PiRemoteApp: App {
    @StateObject private var settings = ConnectionSettings()
    /// 폰 알림(기기 주소 받기·알림 누름 처리)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        // 시험용: 시작할 때 '작업 중 보내기 방식'을 기본(바로 반영)으로 되돌림
        if ProcessInfo.processInfo.environment["PI_REMOTE_RESET_SENDMODE"] == "1" {
            UserDefaults.standard.removeObject(forKey: "pi-remote.sendMode2")
            UserDefaults.standard.set("chat", forKey: "pi-remote.viewMode")
        }
        // 시험용: 화면(메인 스레드)이 0.15초 넘게 멈추면 기록
        if ProcessInfo.processInfo.environment["PI_REMOTE_PERF"] == "1" {
            var last = Date()
            Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
                let gap = Date().timeIntervalSince(last)
                if gap > 0.15 { NSLog("[perf] 화면 멈춤 %.0fms", gap * 1000) }
                last = Date()
            }
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                // 작업 표시(잠금 화면·다이내믹 아일랜드)를 누르면 그 탭으로: piremote://tab/<창 번호>
                .onOpenURL { url in
                    if url.scheme == "piremote", url.host == "tab", let n = Int(url.lastPathComponent) {
                        PushManager.shared.pendingWindow = n
                    }
                    // 맥 'antenna-pair' 의 QR: piremote://pair?token=<토큰>&host=<맥 주소>&port=<포트> → 저장하고 다시 연결.
                    // 앱 밖에서 열린 링크라, 이미 짝지은 폰의 맥 주소를 바꾸는 것이면 먼저 묻는다
                    settings.applyPairURL(url, confirmHostChange: true)
                }
        }
    }
}
