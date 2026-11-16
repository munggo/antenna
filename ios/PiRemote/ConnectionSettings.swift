import Foundation
import Combine
import UIKit

/// 짝짓기 링크(맥 'antenna-pair' 의 QR)에서 읽은 값
struct PairLink: Equatable {
    /// 예전 방식: 모든 폰이 같이 쓰던 토큰이 그대로 들어 있음
    let token: String?
    /// 지금 방식: 한 번 쓰는 짝짓기 코드(5분). 맥에 내고 이 폰만의 토큰을 받는다
    let code: String?
    /// 맥 인증서의 지문. 있으면 그 지문의 맥과만 암호화 연결을 맺는다
    let fingerprint: String?
    /// 맥 주소(같은 Wi-Fi 밖에서 붙을 주소. 맥 설정에 적어 두지 않았으면 비어 있음)
    let hosts: [String]
    let port: String?
}

/// 접속 설정. 주소는 사용자 입력 없이 자동(같은 Wi-Fi 에서는 Bonjour 자동발견, 그 밖에서는 짝짓기 QR 로 받은 맥 주소).
/// 사용자는 맥 화면의 짝짓기 QR 을 한 번 찍으면 된다(토큰·주소·포트가 함께 들어 있음).
final class ConnectionSettings: ObservableObject {
    @Published var token: String { didSet { if !reloading { KeychainHelper.save(token, account: "token") } } }
    /// QR 로 새 토큰을 받은 시각(받으면 화면이 새 토큰으로 다시 연결)
    @Published var pairedAt: Date?
    /// 앱 밖에서 열린 링크가 이미 짝지은 폰의 맥 주소를 다른 주소로 바꾸려 함 → 사용자에게 물은 뒤 저장(PairConfirm)
    @Published var pendingPair: PairLink?

    /// 짝짓는 중(코드를 맥에 내고 토큰을 기다림)
    @Published var pairing = false
    /// 짝짓기 결과를 알리는 글(화면이 한 번 보여 줌)
    @Published var pairNotice: String?
    /// 같은 망에서 찾은 맥 주소(화면이 넣어 줌). 짝지을 때 QR 에 주소가 없으면 이 주소로 코드를 낸다
    var discovered: [String] = []
    private var pairingClient: PairingClient?

    /// 짝짓기 링크 읽기. 형식이 맞지 않으면 nil.
    /// 지금 방식 piremote://pair?code=…&fp=…&host=…&port=… / 예전 방식 piremote://pair?token=…&host=…&port=…
    static func parsePairURL(_ url: URL) -> PairLink? {
        guard url.scheme == "piremote", url.host == "pair",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        let secret: (String) -> String? = { name in
            guard let v = items.first(where: { $0.name == name })?.value,
                  v.range(of: "^[0-9a-fA-F]{32,128}$", options: .regularExpression) != nil else { return nil }
            return v
        }
        let t = secret("token"), code = secret("code")
        guard t != nil || code != nil else { return nil }
        var fp: String?
        if let f = items.first(where: { $0.name == "fp" })?.value, f.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil { fp = f.lowercased() }
        // 주소는 여러 개일 수 있다(VPN 주소·이름 등). 주소에 쓸 수 없는 글자가 든 것은 버림
        var hosts = [String]()
        for h in items.filter({ $0.name == "host" }).compactMap(\.value)
        where h.range(of: "^[A-Za-z0-9.:-]{1,253}$", options: .regularExpression) != nil && !hosts.contains(h) {
            hosts.append(h)
        }
        var port: String?
        if let p = items.first(where: { $0.name == "port" })?.value, let n = Int(p), (1...65535).contains(n) { port = p }
        // 코드가 있으면 지금 방식으로(토큰이 함께 있어도 코드가 먼저)
        return PairLink(token: code == nil ? t : nil, code: code, fingerprint: fp, hosts: hosts, port: port)
    }

    /// 맥 'antenna-pair' QR 링크: 맞으면 토큰과 맥 주소·포트를 저장하고 true(카메라 앱·앱 안 찍기 공용).
    /// confirmHostChange: 앱 밖에서 열린 링크(카메라 앱·다른 앱의 링크)일 때 켠다. 이미 짝지은 폰의 맥 주소를 다른 주소로 바꾸는
    /// 링크면 바로 저장하지 않고 pendingPair 에 두어 사용자에게 묻는다(링크 하나로 엉뚱한 곳에 붙는 일을 막음)
    @discardableResult
    func applyPairURL(_ url: URL, confirmHostChange: Bool = false) -> Bool {
        guard let link = Self.parsePairURL(url) else { return false }
        if confirmHostChange, !token.isEmpty, !link.hosts.isEmpty, Set(link.hosts) != Set(hosts) {
            pendingPair = link
            return true
        }
        apply(link)
        return true
    }

    func apply(_ link: PairLink) {
        pendingPair = nil
        if let code = link.code {
            pair(code: code, link: link, waited: 0)
            return
        }
        // 예전 방식: 링크의 토큰을 그대로 저장. 그런 QR 에는 지문이 없으니 그 맥의 방식대로 암호화 없이 붙는다
        save(link, token: link.token ?? "")
    }

    /// 짝짓기가 끝난 연결 정보를 저장하고 다시 연결하게 한다
    private func save(_ link: PairLink, token newToken: String) {
        // 링크에 주소가 없으면(맥 설정에 주소를 적어 두지 않음) 쓰던 주소를 그대로 둔다
        if !link.hosts.isEmpty { hosts = link.hosts }
        if let p = link.port { port = p }
        fingerprint = link.fingerprint ?? ""
        token = newToken
        pairedAt = Date()
    }

    /// 지금 방식 짝짓기: 코드를 맥에 내고 이 폰만의 토큰을 받는다.
    /// 받기 전에는 쓰던 연결 정보를 건드리지 않는다(실패해도 지금 연결이 그대로)
    private func pair(code: String, link: PairLink, waited: Int) {
        guard !pairing || waited > 0 else { return }
        pairing = true
        var seen = Set<String>()
        let candidates = (link.hosts + discovered + (link.hosts.isEmpty ? hosts : [])).filter { seen.insert($0).inserted }
        // 링크로 앱이 막 켜졌으면 같은 망의 맥을 아직 못 찾았을 수 있다: 주소가 하나도 없으면 잠깐(6초까지) 기다려 본다
        if candidates.isEmpty, waited < 12 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.pair(code: code, link: link, waited: waited + 1) }
            return
        }
        let client = PairingClient()
        pairingClient = client
        client.exchange(code: code, hosts: candidates, port: Int(link.port ?? port) ?? 8787, fingerprint: link.fingerprint ?? "",
                        name: UIDevice.current.name) { [weak self] result in
            guard let self else { return }
            self.pairing = false
            self.pairingClient = nil
            switch result {
            case .success(let newToken):
                self.save(link, token: newToken)
            case .failure(.expired):
                self.pairNotice = "QR 이 만료됐어요. 맥에서 다시 띄워 주세요"
            case .failure(.invalid):
                self.pairNotice = "이미 쓴 QR 이에요. 맥에서 다시 띄워 주세요"
            case .failure(.unreachable):
                self.pairNotice = "맥에 닿지 못했어요. 같은 Wi-Fi 인지, VPN 이 켜져 있는지 확인해 주세요"
            }
        }
    }

    @Published var port: String { didSet { UserDefaults.standard.set(port, forKey: "port") } }
    /// 맥 인증서의 지문(짝짓기 QR 로 받음). 있으면 그 지문의 맥과만 암호화 연결을 맺고, 비어 있으면 예전 방식(암호화 없음)
    @Published var fingerprint: String { didSet { UserDefaults.standard.set(fingerprint, forKey: "fingerprint") } }

    /// 짝짓기 QR 로 받은 맥 주소들(VPN 주소 등). 같은 Wi-Fi 밖에서는 이 주소로 붙는다
    @Published var hosts: [String] { didSet { UserDefaults.standard.set(hosts, forKey: Self.hostsKey) } }
    private static let hostsKey = "hosts"
    /// 주소가 QR 에 없던 때의 설치판이 쓰던 주소. 그 설치판에서 올라온 폰만 한 번 넘겨받는다(loadHosts).
    /// 값은 빌드 설정 LEGACY_HOST(git 에 올리지 않는 Local.xcconfig)에서 온다. 비어 있으면(새로 빌드하는 사람) 넘겨받지 않는다.
    /// 그런 폰이 모두 새 QR 을 찍은 뒤에는 이 값과 넘겨받는 부분을 지워도 된다
    private static let legacyHost = (Bundle.main.object(forInfoDictionaryKey: "LegacyHost") as? String ?? "").trimmingCharacters(in: .whitespaces)

    /// 저장된 맥 주소. 저장된 적이 없으면(이 판을 처음 켬) 한 번 정해 저장한다:
    /// 이미 토큰이 있으면 주소 없이 짝지은 예전 설치판 → 그때 쓰던 주소를 넘겨받아, 새 판을 받은 뒤에도 밖에서 끊기지 않게.
    /// 토큰이 없으면 처음 설치 → 주소 없음(짝지을 때 QR 에서 받음)
    private static func loadHosts(token: KeychainHelper.ReadResult) -> [String] {
        if let kept = UserDefaults.standard.stringArray(forKey: hostsKey) { return kept }
        let first: [String]
        switch token {
        case .locked: return []   // 폰이 잠겨 아직 알 수 없음: 저장하지 않고, 잠금이 풀리면 다시 정함(reloadTokenIfLocked)
        case .value(let t) where !t.isEmpty: first = legacyHost.isEmpty ? [] : [legacyHost]
        default: first = []
        }
        UserDefaults.standard.set(first, forKey: hostsKey)
        return first
    }

    /// 잠금이 풀린 뒤 다시 읽는 중(다시 저장하지 않음)
    private var reloading = false
    private var unlockObservers: [NSObjectProtocol] = []

    init() {
        let saved = KeychainHelper.read(account: "token")
        if case .value(let t) = saved { self.token = t } else { self.token = "" }
        self.port = UserDefaults.standard.string(forKey: "port") ?? "8787"
        self.fingerprint = UserDefaults.standard.string(forKey: "fingerprint") ?? ""
        self.hosts = Self.loadHosts(token: saved)
        #if DEBUG
        // 시뮬레이터 시험용: 실행 환경변수로 토큰·포트·주소 주입(폰에는 이 환경변수가 없어 영향 없음)
        let env = ProcessInfo.processInfo.environment
        // 첫 실행 화면 시험: 저장된 토큰과 맥 주소를 지우고 처음 설치한 것처럼 시작
        if env["PI_REMOTE_FORGET_TOKEN"] == "1" {
            KeychainHelper.save("", account: "token")
            self.token = ""
            UserDefaults.standard.set([String](), forKey: Self.hostsKey)
            self.hosts = []
            self.fingerprint = ""
        }
        if let t = env["PI_REMOTE_TOKEN"], !t.isEmpty { self.token = t }
        if let p = env["PI_REMOTE_PORT"], Int(p) != nil { self.port = p }
        if let h = env["PI_REMOTE_HOSTS"] { self.hosts = h.split(separator: ",").map(String.init) }
        #endif
        // 잠긴 폰에서 백그라운드로 깨어나 토큰을 못 읽었으면, 잠금이 풀릴 때(또는 앱을 열 때) 다시 읽음.
        // 예전에는 빈 토큰으로 남아 앱을 열면 토큰 입력 창이 떴음
        if saved == .locked {
            for name in [UIApplication.protectedDataDidBecomeAvailableNotification, UIApplication.didBecomeActiveNotification] {
                unlockObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    self?.reloadTokenIfLocked()
                })
            }
        }
    }

    private func reloadTokenIfLocked() {
        guard token.isEmpty, case .value(let t) = KeychainHelper.read(account: "token") else { return }
        hosts = Self.loadHosts(token: .value(t))
        reloading = true
        token = t
        reloading = false
        unlockObservers.forEach(NotificationCenter.default.removeObserver)
        unlockObservers = []
    }

    /// 시도할 연결들: Bonjour로 발견한 주소(extra) + 짝짓기 때 받은 맥 주소.
    func candidateRequests(cols: Int, rows: Int, extra: [String] = []) -> [URLRequest] {
        var seen = Set<String>()
        let all = (extra + hosts).filter { seen.insert($0).inserted }
        return all.compactMap { host in
            request(host: host, path: "/", query: [URLQueryItem(name: "cols", value: String(cols)), URLQueryItem(name: "rows", value: String(rows))])
        }
    }

    /// 이 맥으로 가는 요청. 지문이 있으면 암호화 연결(wss)이고, 토큰은 주소가 아니라 머리말(Authorization)에 싣는다
    func request(host: String, path: String, query: [URLQueryItem] = []) -> URLRequest? {
        var comps = URLComponents()
        comps.scheme = fingerprint.isEmpty ? "ws" : "wss"
        comps.host = host
        comps.port = Int(port)
        comps.path = path
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return req
    }

    var isValid: Bool { !token.isEmpty && Int(port) != nil }
}
