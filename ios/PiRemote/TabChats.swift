import Foundation

/// 탭마다 저장해 둔 대화(11-25 사용자 요청: 탭을 바꾸면 바로 보이게, 다른 탭도 미리 받아 두기).
/// 열쇠는 맥이 탭 목록에 주는 칸 번호(%12 처럼, 탭 순서가 바뀌어도 같음). 칸 번호는 맥의 tmux 가 다시 켜지면 다른 탭에 다시 쓰일 수 있어
/// 저장할 때의 탭 이름이 지금 이름과 같을 때만 보여 준다.
/// pool: 맥이 준 메시지를 지문으로 찾는 곳(맥이 '폰에 있는 것'을 빼고 보낸 대화를 이어 붙일 때). 이 앱이 켜져 있는 동안 받은 것을 모두 둔다
final class TabChats {
    struct Saved: Codable {
        var name: String
        var messages: [ChatMessage]
        /// 메시지 id → 맥이 준 지문(맥이 준 그대로인 것만. 그 뒤 바뀐 메시지는 빠짐)
        var hashes: [String: String]
        var truncated: Int
        var agent: String?
        /// 미리 받을 때 온 안내(그 탭을 열 때 한 번 보임)
        var notice: String?
    }

    private var saved: [String: Saved] = [:]
    private var pools: [String: [String: ChatMessage]] = [:]
    private var loaded = Set<String>()
    private let dir: URL?

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        dir = base?.appendingPathComponent("chat-tabs", isDirectory: true)
        if let dir { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        // 예전 판의 한 탭짜리 저장(chat-cache.json)은 이제 쓰지 않음
        if let old = base?.appendingPathComponent("chat-cache.json") { try? FileManager.default.removeItem(at: old) }
        // 칸 번호는 새 탭마다 늘어나 닫힌 탭의 저장이 쌓인다 → 14일 넘게 쓰지 않은 것은 지움
        if let dir, let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) {
            let cut = Date().addingTimeInterval(-14 * 86400)
            for f in files where ((try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast) < cut {
                try? FileManager.default.removeItem(at: f)
            }
        }
    }

    private func file(_ key: String) -> URL? {
        let safe = key.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
        return safe.isEmpty ? nil : dir?.appendingPathComponent("tab-\(safe).json")
    }

    /// 저장해 둔 그 탭의 대화(처음이면 기기에서 읽음)
    func get(_ key: String) -> Saved? {
        if !loaded.contains(key) {
            loaded.insert(key)
            if let url = file(key), let data = try? Data(contentsOf: url), let s = try? JSONDecoder().decode(Saved.self, from: data) {
                saved[key] = s
                addPool(key, s.messages, s.hashes)
            }
        }
        return saved[key]
    }

    /// 그 탭에서 지문으로 찾을 수 있는 메시지
    func pool(_ key: String) -> [String: ChatMessage] {
        _ = get(key)
        return pools[key] ?? [:]
    }

    /// 맥에 알릴 '가진 지문'
    func have(_ key: String) -> [String] {
        let p = pool(key)
        let current = (saved[key]?.messages ?? []).compactMap { saved[key]?.hashes[$0.id] }
        return ChatDelta.haveList(pool: p, current: current)
    }

    func addPool(_ key: String, _ messages: [ChatMessage], _ hashes: [String: String]) {
        var p = pools[key] ?? [:]
        for m in messages { if let h = hashes[m.id] { p[h] = m } }
        pools[key] = p
    }

    /// 그 탭의 대화를 저장(기기에는 뒤에서 씀)
    func put(_ key: String, _ s: Saved) {
        _ = get(key)
        saved[key] = s
        addPool(key, s.messages, s.hashes)
        guard let url = file(key) else { return }
        DispatchQueue.global(qos: .utility).async {
            if let data = try? JSONEncoder().encode(s) { try? data.write(to: url, options: .atomic) }
        }
    }

    /// 안내를 한 번 꺼냄(그 탭을 열 때)
    func takeNotice(_ key: String) -> String? {
        guard var s = get(key), let n = s.notice, !n.isEmpty else { return nil }
        s.notice = nil
        put(key, s)
        return n
    }

    /// 마지막으로 본 탭(앱을 다시 열면 그 탭의 대화를 바로 보여 줌)
    static var lastKey: String? {
        get { UserDefaults.standard.string(forKey: "pi-remote.lastTabKey") }
        set { UserDefaults.standard.set(newValue, forKey: "pi-remote.lastTabKey") }
    }
}
