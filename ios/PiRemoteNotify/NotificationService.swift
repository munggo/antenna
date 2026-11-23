import UserNotifications

/// 알림 중계로 온 알림의 본문을 풀어 바꾼다(Notification Service Extension).
/// 중계 서버가 보낸 알림은 보이는 문구가 고정('새 알림')이고, 실제 제목·부제·내용·종류·탭은 암호문(e)으로만 온다.
/// 앱의 개인 키(PushCrypto, 함께 보는 키체인)로 풀어 글을 바꾸고, 종류·탭 번호를 알림 정보에 넣는다(앱이 그 탭으로 열 때 씀).
/// 풀지 못하면(키가 없음·다른 폰) 고정 문구 그대로 보인다
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else { return contentHandler(request.content) }
        best = content
        if let e = content.userInfo["e"] as? [String: Any], let k = e["k"] as? String, let b = e["b"] as? String,
           let m = PushCrypto.open(k: k, b: b) {
            if let t = m["t"] as? String, !t.isEmpty { content.title = t }
            if let s = m["s"] as? String, !s.isEmpty { content.subtitle = s }
            if let body = m["b"] as? String { content.body = body }
            var info = content.userInfo
            info.removeValue(forKey: "e")
            if let kind = m["k"] as? String { info["kind"] = kind }
            if let w = m["w"] as? Int { info["window"] = w }
            content.userInfo = info
        }
        contentHandler(content)
        handler = nil
    }

    /// 시간이 다 됨(풀기는 바로 끝나서 거의 오지 않음): 지금까지 만든 것을 그대로
    override func serviceExtensionTimeWillExpire() {
        if let handler, let best { handler(best) }
        handler = nil
    }
}
