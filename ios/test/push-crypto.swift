// 앱의 알림 본문 풀기(ios/Shared/PushCrypto.swift)가 브리지의 잠금(server/push-seal.mjs)과 맞는지, 맥에서 바로 컴파일해 본다.
// server/test/push-crypto.test.mjs 가 이 프로그램을 부른다(sh test.sh push-crypto):
//   gen               → 앱처럼 키 쌍을 만들어 '개인 키 공개 키'(base64)를 찍음
//   open <개인> <k> <b> → 브리지가 잠근 것을 풀어 JSON(키 이름 순)을 찍음, 못 풀면 FAIL
// 작성: 서문교
import CryptoKit
import Foundation

@main
struct PushCryptoCLI {
    static func main() {
        let a = CommandLine.arguments
        if a.count == 2, a[1] == "gen" {
            let k = Curve25519.KeyAgreement.PrivateKey()
            print(k.rawRepresentation.base64EncodedString(), k.publicKey.rawRepresentation.base64EncodedString())
            return
        }
        guard a.count == 5, a[1] == "open", let raw = Data(base64Encoded: a[2]),
              let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw) else {
            print("쓰기: gen | open <개인 키> <k> <b>")
            exit(2)
        }
        guard let m = PushCrypto.open(k: a[3], b: a[4], with: key),
              let d = try? JSONSerialization.data(withJSONObject: m, options: [.sortedKeys]) else {
            print("FAIL")
            exit(1)
        }
        print(String(data: d, encoding: .utf8)!)
    }
}
