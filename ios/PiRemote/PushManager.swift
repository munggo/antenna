import UIKit
import UserNotifications

/// 폰 알림(Apple 푸시)
/// - 처음 켤 때 알림 권한을 묻고, 기기 주소(device token)를 받아 세션이 맥 브리지에 등록
/// - 지금 보고 있는 탭의 알림은 숨기고(이미 화면에 보임), 다른 탭에서 온 알림은 보여 준다
/// - 알림을 누르면 그 탭으로 이동
final class PushManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    /// Apple 푸시 기기 주소(16진수). 생기면 세션이 브리지에 등록
    @Published private(set) var token: String?
    /// 알림을 눌러 열어야 할 tmux 창 번호
    @Published var pendingWindow: Int?
    /// 지금 화면에 보이는 tmux 창 번호(세션이 갱신)
    var currentWindow: Int?

    #if DEBUG
    static let env = "sandbox"       // Xcode 로 설치한 앱은 개발용 푸시 서버
    #else
    static let env = "production"
    #endif

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        #if DEBUG
        // 화면 시험: 알림 권한 창이 화면을 가리지 않게 묻지 않음
        if ProcessInfo.processInfo.environment["PI_REMOTE_NO_PUSH"] == "1" { return }
        #endif
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(_ deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    /// 앱을 보고 있을 때 온 알림: 지금 보는 탭 것이면 숨기고, 다른 탭 것이면 보여 줌
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let window = notification.request.content.userInfo["window"] as? Int
        if let window, window == currentWindow {
            completionHandler([])
        } else {
            completionHandler([.banner, .list, .sound])
        }
    }

    /// 알림을 누름: 그 탭으로
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let window = response.notification.request.content.userInfo["window"] as? Int {
            DispatchQueue.main.async { self.pendingWindow = window }
        }
        completionHandler()
    }
}

/// 기기 주소를 받으려면 앱 대리자가 필요(SwiftUI 앱에 붙임)
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PushManager.shared.start()
        LiveActivities.start()   // 맥 pi 작업 표시 토큰 등록(백그라운드로 깨어났을 때도)
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[push] 기기 주소 등록 실패: \(error.localizedDescription)")
    }
}
