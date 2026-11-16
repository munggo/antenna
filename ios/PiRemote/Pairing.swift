import Foundation
import CryptoKit

/// 맥의 인증서를 지문으로 확인한다(지문 고정).
/// 브리지는 맥마다 만든 자체 인증서를 쓰므로 인증 기관으로는 확인할 수 없다. 대신 짝짓기 QR 로 받은 지문과 같은 인증서일 때만 믿는다.
/// 같은 망의 다른 기기가 맥인 척하면 지문이 달라 연결하지 않는다.
enum TLSPin {
    /// 서버가 내민 인증서(맨 앞)의 지문: DER 의 SHA-256, 16진수 소문자 64자
    static func fingerprint(of trust: SecTrust) -> String? {
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else { return nil }
        let der = SecCertificateCopyData(leaf) as Data
        return SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    }

    /// 암호화 연결의 서버 확인 요청에 답한다: 기대한 지문과 같으면 받아들이고, 아니면 끊는다
    static func answer(_ challenge: URLAuthenticationChallenge, expected: String,
                       completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        if !expected.isEmpty, fingerprint(of: trust) == expected.lowercased() {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

/// 정해진 지문의 맥만 믿는 연결용 대리자(짝짓기 교환, 작업 표시 토큰 등록처럼 잠깐 붙는 연결에 씀)
final class PinnedDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    private let expected: String
    init(fingerprint: String) { expected = fingerprint }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        TLSPin.answer(challenge, expected: expected, completionHandler: completionHandler)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        TLSPin.answer(challenge, expected: expected, completionHandler: completionHandler)
    }
}

/// 짝짓기: QR 의 한 번 쓰는 코드를 맥에 내고 이 폰만의 연결 토큰을 받는다.
/// 맥 주소 후보마다 동시에 물어, 토큰을 준 답 하나를 쓴다(코드는 한 번만 쓸 수 있어 나머지는 거절되는데, 그건 무시).
final class PairingClient {
    enum Failure: Error {
        /// 코드가 틀렸거나 이미 썼음
        case invalid
        /// 5분이 지남
        case expired
        /// 어느 주소에서도 답이 없음
        case unreachable
    }

    private var session: URLSession?
    private var tasks: [URLSessionWebSocketTask] = []
    private var finished = false
    private var pending = 0
    private var rejected: Failure?

    /// hosts: 맥 주소 후보. fingerprint: 맥 인증서 지문(비어 있으면 암호화 없이: 인증서를 만들지 못한 맥).
    /// 끝나면 main 큐에서 한 번 부른다
    func exchange(code: String, hosts: [String], port: Int, fingerprint: String, name: String,
                  completion: @escaping (Result<String, Failure>) -> Void) {
        guard !hosts.isEmpty else {
            completion(.failure(.unreachable))
            return
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 8
        let session = URLSession(configuration: cfg, delegate: fingerprint.isEmpty ? nil : PinnedDelegate(fingerprint: fingerprint), delegateQueue: .main)
        self.session = session
        let ask = try? JSONSerialization.data(withJSONObject: ["type": "pair", "code": code, "name": name])
        let finish: (Result<String, Failure>) -> Void = { [weak self] result in
            guard let self, !self.finished else { return }
            self.finished = true
            self.tasks.forEach { $0.cancel(with: .normalClosure, reason: nil) }
            self.session?.invalidateAndCancel()
            completion(result)
        }
        // 후보 하나가 끝남(거절·실패): 모두 끝났으면 실패로 마무리
        let oneDone: (Failure?) -> Void = { [weak self] why in
            guard let self, !self.finished else { return }
            if let why { self.rejected = why }
            self.pending -= 1
            if self.pending == 0 { finish(.failure(self.rejected ?? .unreachable)) }
        }
        for host in hosts {
            var c = URLComponents()
            c.scheme = fingerprint.isEmpty ? "ws" : "wss"
            c.host = host
            c.port = port
            c.path = "/pair"
            guard let url = c.url, let ask, let text = String(data: ask, encoding: .utf8) else { continue }
            pending += 1
            let task = session.webSocketTask(with: url)
            tasks.append(task)
            task.resume()
            // 이 후보의 끝은 한 번만 센다(보내기 실패와 받기 실패가 함께 올 수 있음). main 큐에서만 건드림
            var settled = false
            let settle: (Failure?) -> Void = { why in
                guard !settled else { return }
                settled = true
                oneDone(why)
            }
            task.send(.string(text)) { error in
                if error != nil { DispatchQueue.main.async { settle(nil) } }
            }
            task.receive { result in
                DispatchQueue.main.async {
                    guard case .success(.string(let s)) = result,
                          let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else {
                        settle(nil)
                        return
                    }
                    if obj["type"] as? String == "paired", let token = obj["token"] as? String,
                       token.range(of: "^[0-9a-fA-F]{32,128}$", options: .regularExpression) != nil {
                        finish(.success(token))
                    } else {
                        settle(obj["reason"] as? String == "expired" ? .expired : .invalid)
                    }
                }
            }
        }
        if pending == 0 { finish(.failure(.unreachable)) }
        // 어디서도 답이 없으면 12초 뒤 그만둠
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { finish(.failure(self.rejected ?? .unreachable)) }
    }
}
