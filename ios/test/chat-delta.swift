// 맥이 '폰에 없는 메시지만' 보낸 처음 대화를 이어 붙이는 계산(ios/PiRemote/ChatDelta.swift) 시험. 시뮬레이터 없이 맥에서 바로 돌린다:
//   sh test.sh chat-delta
// 보는 것: 받은 것과 저장해 둔 것을 지문 순서대로 끼우는지, 맞지 않으면(못 찾는 지문·받은 수가 틀림) 통째로 다시 받게 nil 인지
// 작성: 서문교
import Foundation

@main
struct ChatDeltaTest {
    static func main() {
        var passed = 0, failed = 0
        func same(_ name: String, _ got: String, _ want: String) {
            if got == want { passed += 1; print("통과: \(name)") } else { failed += 1; print("실패: \(name) → \(got) (바람: \(want))") }
        }
        func show(_ r: [String]?) -> String { r.map { $0.joined(separator: ",") } ?? "nil" }
        let pool = ["h1": "가", "h2": "나", "h3": "다"]

        same("통째로 받음(자리 없음): 받은 것이 곧 전체", show(ChatDelta.assemble(hashes: ["h1", "h2"], fresh: nil, sent: ["A", "B"], pool: [:])), "A,B")
        same("통째로인데 지문 수와 메시지 수가 다르면 nil", show(ChatDelta.assemble(hashes: ["h1", "h2"], fresh: nil, sent: ["A"], pool: [:])), "nil")
        same("다 가졌음: 저장해 둔 것만으로", show(ChatDelta.assemble(hashes: ["h1", "h2", "h3"], fresh: [], sent: [String](), pool: pool)), "가,나,다")
        same("끝에 새것 둘", show(ChatDelta.assemble(hashes: ["h1", "h2", "n1", "n2"], fresh: [2, 3], sent: ["새1", "새2"], pool: pool)), "가,나,새1,새2")
        same("가운데가 바뀜(쓰던 답이 끝남)", show(ChatDelta.assemble(hashes: ["h1", "x2", "h3"], fresh: [1], sent: ["바뀐 나"], pool: pool)), "가,바뀐 나,다")
        same("앞이 잘려 나감(오래된 것이 300개 밖으로)", show(ChatDelta.assemble(hashes: ["h3", "n1"], fresh: [1], sent: ["새"], pool: pool)), "다,새")
        same("저장해 둔 것에 없는 지문이면 nil", show(ChatDelta.assemble(hashes: ["h1", "zz"], fresh: [], sent: [String](), pool: pool)), "nil")
        same("자리 수와 받은 수가 다르면 nil", show(ChatDelta.assemble(hashes: ["h1", "n1"], fresh: [1], sent: ["새", "더"], pool: pool)), "nil")
        same("자리가 지문 밖이면 nil", show(ChatDelta.assemble(hashes: ["h1"], fresh: [5], sent: ["새"], pool: pool)), "nil")
        same("저장해 둔 것에 같은 지문이 있어도 맥이 보낸 자리는 받은 것으로",
             show(ChatDelta.assemble(hashes: ["h1", "h2"], fresh: [1], sent: ["받은 나"], pool: pool)), "가,받은 나")
        same("빈 대화", show(ChatDelta.assemble(hashes: [], fresh: [], sent: [String](), pool: pool)), "")

        same("가진 지문 목록: 많지 않으면 모두", ChatDelta.haveList(pool: pool, current: []).sorted().joined(separator: ","), "h1,h2,h3")
        same("가진 지문 목록: 너무 많으면 지금 대화의 끝부분만",
             ChatDelta.haveList(pool: pool, current: ["h1", "h2", "h3"], limit: 2).joined(separator: ","), "h2,h3")

        print(failed == 0 ? "모두 통과: \(passed)가지" : "실패 \(failed)가지 / 통과 \(passed)가지")
        exit(failed == 0 ? 0 : 1)
    }
}
