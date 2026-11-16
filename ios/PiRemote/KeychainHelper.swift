import Foundation
import Security

/// 토큰을 Keychain에 저장/조회한다.
/// 잠긴 폰에서 백그라운드로 깨어나도(작업 표시·알림) 읽을 수 있게 '처음 잠금 해제한 뒤부터 읽기 가능'으로 둔다.
enum KeychainHelper {
    private static let service = "com.munggo.piremote"
    private static let accessible = kSecAttrAccessibleAfterFirstUnlock

    enum ReadResult: Equatable {
        case value(String)
        case missing
        /// 폰이 잠겨 있어 지금은 읽을 수 없음(잠금이 풀리면 다시 읽기)
        case locked
    }

    private static func baseQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func save(_ value: String, account: String) {
        let query = baseQuery(account)
        SecItemDelete(query as CFDictionary)
        var attrs = query
        attrs[kSecValueData as String] = Data(value.utf8)
        attrs[kSecAttrAccessible as String] = accessible
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func read(account: String) -> ReadResult {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecInteractionNotAllowed { return .locked }
        guard status == errSecSuccess,
              let item = result as? [String: Any],
              let data = item[kSecValueData as String] as? Data,
              let str = String(data: data, encoding: .utf8)
        else { return .missing }
        // 예전 항목(잠금 해제 때만 읽기)은 새 접근 속성으로 옮김
        if (item[kSecAttrAccessible as String] as? String) != (accessible as String) {
            SecItemUpdate(baseQuery(account) as CFDictionary,
                          [kSecAttrAccessible as String: accessible] as CFDictionary)
        }
        return .value(str)
    }

    static func load(account: String) -> String? {
        if case .value(let s) = read(account: account) { return s }
        return nil
    }
}
