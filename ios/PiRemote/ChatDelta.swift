import Foundation

/// 맥이 '폰에 없는 메시지만' 보낸 처음 대화를 이어 붙이는 계산(11-25: 탭을 바꿀 때마다 긴 대화를 통째로 다시 받아 느렸음).
/// 맥 브리지(server/chat-delta.mjs)는 메시지마다 내용 지문(hashes, 순서대로)을 주고, 폰이 가진 것은 빼고 보낸다.
/// fresh 는 보낸 메시지가 hashes 의 몇 번째 자리인지. 없으면(통째로 받음) 받은 메시지가 곧 전체다.
/// 화면 프레임워크를 쓰지 않아 맥에서 바로 시험할 수 있다(ios/test/chat-delta.swift, `sh test.sh chat-delta`).
enum ChatDelta {
    /// hashes 순서대로 메시지 목록을 만든다. fresh 자리는 받은 것(sent)에서 차례로, 나머지는 저장해 둔 것(pool)에서.
    /// 받은 수가 맞지 않거나 저장해 둔 것에 없는 지문이 있으면 nil(그때는 통째로 다시 받는다)
    static func assemble<M>(hashes: [String], fresh: [Int]?, sent: [M], pool: [String: M]) -> [M]? {
        guard let fresh else { return sent.count == hashes.count ? sent : nil }
        guard fresh.count == sent.count else { return nil }
        var out: [M] = []
        out.reserveCapacity(hashes.count)
        var next = 0
        for (i, h) in hashes.enumerated() {
            if next < fresh.count, fresh[next] == i {
                out.append(sent[next])
                next += 1
            } else if let m = pool[h] {
                out.append(m)
            } else {
                return nil
            }
        }
        return next == fresh.count ? out : nil
    }

    /// 맥에 알릴 '가진 지문' 목록. 맥이 받는 수(2000개)를 넘으면 지금 대화의 것만
    static func haveList<M>(pool: [String: M], current: [String], limit: Int = 2000) -> [String] {
        if pool.count <= limit { return Array(pool.keys) }
        return Array(current.suffix(limit))
    }
}
