import CryptoKit
import Foundation
import Security

/// 알림 중계로 온 알림의 본문 풀기. 앱과 알림 확장(PiRemoteNotify)이 함께 쓴다.
/// - 앱이 X25519 키 쌍을 만들어 개인 키는 앱·확장이 함께 보는 키체인(PushKeychainGroup)에 두고, 공개 키는 맥 브리지에 준다(push-register 의 pk)
/// - 브리지(server/push-seal.mjs)가 알림마다 일회용 키로 잠근 { k, b } 를 확장이 푼다:
///   X25519 공유 비밀 → HKDF-SHA256(소금 없음, info 'antenna-push-v1') → AES-GCM(논스+암호문+태그)
/// 중계 서버와 Apple 은 본문을 읽지 못한다
enum PushCrypto {
    private static let service = "antenna.push"
    private static let account = "x25519"

    /// 앱·확장이 함께 보는 키체인 묶음(Info.plist). 서명 팀이 없는 빌드(시뮬레이터 등)는 앞부분이 비어 쓰지 않음
    static var group: String? {
        guard let g = Bundle.main.object(forInfoDictionaryKey: "PushKeychainGroup") as? String, !g.isEmpty, !g.hasPrefix(".") else { return nil }
        return g
    }

    /// 브리지에 줄 공개 키(base64 32바이트). 없으면 만들어 저장. 저장하지 못하면 nil(브리지는 고정 문구만 보냄)
    static func publicKey() -> String? {
        if let k = load() { return k.publicKey.rawRepresentation.base64EncodedString() }
        let k = Curve25519.KeyAgreement.PrivateKey()
        guard save(k) else { return nil }
        return k.publicKey.rawRepresentation.base64EncodedString()
    }

    /// 잠긴 본문 풀기(키체인의 개인 키로) → 브리지가 잠근 객체 { t, s, b, k, w }
    static func open(k: String, b: String) -> [String: Any]? {
        guard let priv = load() else { return nil }
        return open(k: k, b: b, with: priv)
    }

    static func open(k: String, b: String, with priv: Curve25519.KeyAgreement.PrivateKey) -> [String: Any]? {
        guard let kd = Data(base64Encoded: k), let bd = Data(base64Encoded: b),
              let eph = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: kd),
              let shared = try? priv.sharedSecretFromKeyAgreement(with: eph) else { return nil }
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(), sharedInfo: Data("antenna-push-v1".utf8), outputByteCount: 32)
        guard let box = try? AES.GCM.SealedBox(combined: bd), let plain = try? AES.GCM.open(box, using: key) else { return nil }
        return (try? JSONSerialization.jsonObject(with: plain)) as? [String: Any]
    }

    // MARK: - 키체인

    private static func query(_ group: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    private static func load() -> Curve25519.KeyAgreement.PrivateKey? {
        // 함께 보는 묶음에서 먼저, 없으면 앱 혼자 보는 곳(묶음에 쓰지 못했던 빌드)
        for g in [group, nil] {
            var q = query(g)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data,
               let k = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: d) { return k }
            if group == nil { break }
        }
        return nil
    }

    private static func save(_ k: Curve25519.KeyAgreement.PrivateKey) -> Bool {
        for g in [group, nil] {
            SecItemDelete(query(g) as CFDictionary)
            var q = query(g)
            q[kSecValueData as String] = k.rawRepresentation
            // 잠긴 폰에서도 알림 확장이 풀 수 있게: 처음 잠금을 푼 뒤부터, 이 기기에서만
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            if SecItemAdd(q as CFDictionary, nil) == errSecSuccess { return true }
            if group == nil { break }
        }
        return false
    }
}
