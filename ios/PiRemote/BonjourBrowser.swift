import Foundation
import Network

/// 같은 Wi-Fi 에서 맥 브리지(_piremote._tcp)를 자동 발견해 host(IP) 목록을 제공한다.
/// 사용자가 IP 를 몰라도 앱이 알아서 찾는다.
final class BonjourBrowser: ObservableObject {
    @Published var hosts: [String] = []
    @Published var debugStatus: String = "대기"
    /// 짝짓기 때 받은 맥 주소(VPN 주소 등). 따로 시도하므로 발견 목록에는 넣지 않는다
    var known: [String] = []

    private var browser: NWBrowser?
    private var resolving: [String: NWConnection] = [:]

    func start() {
        guard browser == nil else { return }
        let params = NWParameters.tcp
        let b = NWBrowser(for: .bonjour(type: "_piremote._tcp", domain: nil), using: params)
        b.stateUpdateHandler = { [weak self] state in
            NSLog("[piremote] Bonjour state: \(state)")
            DispatchQueue.main.async { self?.debugStatus = "\(state)" }
        }
        b.browseResultsChangedHandler = { [weak self] results, _ in
            NSLog("[piremote] Bonjour results: \(results.count)")
            DispatchQueue.main.async { self?.debugStatus = "검색중 · 결과 \(results.count)개" }
            for result in results {
                self?.resolve(result.endpoint)
            }
        }
        b.start(queue: .main)
        browser = b
        NSLog("[piremote] Bonjour started")
    }

    func stop() {
        browser?.cancel()
        browser = nil
        resolving.values.forEach { $0.cancel() }
        resolving.removeAll()
    }

    /// Bonjour 엔드포인트를 실제 host(IP)로 해석한다.
    private func resolve(_ endpoint: NWEndpoint) {
        let key = "\(endpoint)"
        guard resolving[key] == nil else { return }
        let conn = NWConnection(to: endpoint, using: .tcp)
        resolving[key] = conn
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                if let remote = conn.currentPath?.remoteEndpoint,
                   case let .hostPort(host, _) = remote {
                    let h = Self.hostString(host)
                    NSLog("[piremote] Bonjour resolved host: \(h)")
                    // 짝짓기 때 받은 주소(VPN 주소 등)로 풀렸으면 같은 Wi-Fi 에서 찾은 것이 아니고, 어차피 따로 시도함 → 제외
                    if !h.isEmpty, !self.known.contains(h) {
                        DispatchQueue.main.async {
                            if !self.hosts.contains(h) { self.hosts.append(h) }
                        }
                    }
                }
                conn.cancel()
                self.resolving[key] = nil
            case .failed, .cancelled:
                conn.cancel()
                self.resolving[key] = nil
            default:
                break
            }
        }
        conn.start(queue: .main)
    }

    private static func hostString(_ host: NWEndpoint.Host) -> String {
        switch host {
        case .ipv4(let addr):
            return "\(addr)".components(separatedBy: "%").first ?? "\(addr)"
        case .name(let name, _):
            return name
        case .ipv6:
            return "" // IPv6 는 건너뛰고 IPv4/이름 우선
        @unknown default:
            return ""
        }
    }
}
