import ActivityKit
import Foundation
import UIKit

/// 맥 pi 작업 표시(Live Activity) 토큰을 맥 브리지에 등록하고, 남은 표시를 정리한다.
/// - 시작용 토큰(iOS 17.2+): 브리지가 앱이 꺼져 있어도 작업이 길어지면 표시를 띄움
/// - 갱신용 토큰(표시마다): 브리지가 하는 일·끝을 갱신. 푸시로 띄운 표시는 iOS 가 앱을 백그라운드로 잠깐 깨워 줌
enum LiveActivities {
    private static var observed = Set<String>()

    /// 앱이 켜질 때(백그라운드로 깨어날 때 포함) 한 번
    static func start() {
        guard #available(iOS 16.1, *) else { return }
        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<PiWorkAttributes>.pushToStartTokenUpdates {
                    BridgeMessenger.send(["type": "live-register", "token": hex(data), "env": PushManager.env])
                }
            }
        }
        Task {
            for await activity in Activity<PiWorkAttributes>.activityUpdates { observe(activity) }
        }
        for a in Activity<PiWorkAttributes>.activities { observe(a) }
        #if DEBUG
        // 시뮬레이터 시험용: 작업 표시 모양 확인(PI_REMOTE_TEST=live)
        if ProcessInfo.processInfo.environment["PI_REMOTE_TEST"] == "live", #available(iOS 16.2, *) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                let st = PiWorkAttributes.ContentState(status: "working", detail: "⏳ 전체 화면 시험(test8 제외)",
                                                       startedAt: Date().timeIntervalSince1970 - 754, endedAt: nil)
                do {
                    let a = try Activity.request(attributes: PiWorkAttributes(window: 1, tabName: "Haiku"),
                                                 content: ActivityContent(state: st, staleDate: nil))
                    NSLog("[live] 시험 표시 시작: %@ (켜짐=%d)", a.id, ActivityAuthorizationInfo().areActivitiesEnabled ? 1 : 0)
                } catch {
                    NSLog("[live] 시험 표시 실패: %@", String(describing: error))
                }
            }
        }
        #endif
    }

    @available(iOS 16.1, *)
    private static func observe(_ activity: Activity<PiWorkAttributes>) {
        guard observed.insert(activity.id).inserted else { return }
        Task {
            for await data in activity.pushTokenUpdates {
                BridgeMessenger.send(["type": "activity-token", "window": activity.attributes.window,
                                      "token": hex(data), "env": PushManager.env])
            }
        }
    }

    /// 앱을 보고 있을 때: 작업 중·답을 기다림이 아닌 탭의 '진행 중' 표시는 끝냄(브리지가 끝 신호를 못 보냈을 때 정리)
    static func reconcile(windows: [TmuxWindow]) {
        guard #available(iOS 16.2, *), !windows.isEmpty else { return }
        for a in Activity<PiWorkAttributes>.activities where a.content.state.endedAt == nil {
            let st = windows.first { $0.index == a.attributes.window }?.status ?? ""
            guard st != "working", st != "asking" else { continue }
            var s = a.content.state
            s.status = st == "yourturn" ? "done" : "stopped"
            s.endedAt = Date().timeIntervalSince1970
            Task { await a.end(ActivityContent(state: s, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(300))) }
        }
    }

    private static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
}

/// 브리지에 짧은 등록 메시지를 보낸다. tmux 를 붙이지 않는 '/push' 경로로 잠깐 접속(앱이 백그라운드로 깨어났을 때도)
enum BridgeMessenger {
    static func send(_ obj: [String: Any]) {
        let settings = ConnectionSettings()
        guard settings.isValid, let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else { return }
        var hosts = [String]()
        // 마지막으로 붙었던 주소부터, 그다음 짝짓기 때 받은 맥 주소
        for h in [UserDefaults.standard.string(forKey: "pi-remote.lastHost")].compactMap({ $0 }) + settings.hosts where !hosts.contains(h) {
            hosts.append(h)
        }
        // 백그라운드로 깨어났을 때 보낼 시간을 조금 확보
        var bg = UIBackgroundTaskIdentifier.invalid
        DispatchQueue.main.async {
            bg = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(bg) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) { UIApplication.shared.endBackgroundTask(bg) }
        }
        // 터미널 연결과 같은 방식으로: 지문이 있으면 그 지문의 맥과만 암호화 연결, 토큰은 머리말로
        let session = settings.fingerprint.isEmpty ? URLSession.shared
            : URLSession(configuration: .ephemeral, delegate: PinnedDelegate(fingerprint: settings.fingerprint), delegateQueue: nil)
        for host in hosts {
            guard let request = settings.request(host: host, path: "/push") else { continue }
            let task = session.webSocketTask(with: request)
            task.resume()
            task.send(.string(text)) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { task.cancel(with: .normalClosure, reason: nil) }
            }
        }
        // 따로 만든 연결 묶음은 보낸 것들이 끝나면 정리(함께 쓰는 기본 묶음은 그대로)
        if session !== URLSession.shared { session.finishTasksAndInvalidate() }
    }
}
