import SwiftUI

struct ContentView: View {
    @EnvironmentObject var settings: ConnectionSettings
    @StateObject private var session = TerminalSession()
    @StateObject private var browser = BonjourBrowser()
    @State private var showTerminal = false
    @State private var didAutoConnect = false
    @State private var showScanner = false

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer()
                header
                form
                connectButton
                statusLine
                Spacer()
                Spacer()
            }
            .padding(.horizontal, 28)
        }
        .fullScreenCover(isPresented: $showTerminal) {
            TerminalScreen(session: session) {
                session.disconnect()
                showTerminal = false
            }
            .modifier(PairConfirm(settings: settings, active: true))
        }
        .modifier(PairConfirm(settings: settings, active: !showTerminal))
        .onAppear {
            // 설정화면 포그라운드에서 먼저 권한 요청(로컬 네트워크 팝업)
            browser.known = settings.hosts
            browser.start()
            // 토큰이 저장돼 있으면 켜자마자 연결 시작(어디서나: 짝짓기 때 받은 맥 주소로 먼저 시도하고,
            // 같은 Wi-Fi 에서 맥을 찾으면 그 주소도 함께 시도). 예전엔 Wi-Fi 에서 맥을 찾았을 때만 자동 연결돼
            // LTE·회사에선 매번 '연결'을 눌러야 했음.
            if !didAutoConnect, settings.isValid {
                didAutoConnect = true
                session.connect(using: settings)
                showTerminal = true
            }
        }
        .onReceive(settings.$token) { t in
            // 잠금이 풀린 뒤 토큰을 다시 읽었으면 그때 자동 연결
            if !t.isEmpty, !didAutoConnect, Int(settings.port) != nil {
                didAutoConnect = true
                session.connect(using: settings)
                showTerminal = true
            }
        }
        .onReceive(settings.$pairedAt) { d in
            // QR 로 새 토큰을 받으면 그 토큰으로 다시 연결
            guard d != nil else { return }
            didAutoConnect = true
            session.disconnect()
            session.connect(using: settings)
            showTerminal = true
            SaveCenter.shared.say("연결 정보를 저장했어요")
        }
        .onReceive(settings.$pairNotice) { text in
            // 짝짓지 못했을 때(만료·이미 쓴 QR·맥에 닿지 못함) 까닭을 알림
            guard let text else { return }
            SaveCenter.shared.say(text)
            settings.pairNotice = nil
        }
        .onReceive(settings.$hosts) { browser.known = $0 }
        .onReceive(browser.$hosts) { hosts in
            settings.discovered = hosts   // 짝지을 때 QR 에 주소가 없으면 같은 망에서 찾은 맥으로
            session.setDiscovered(hosts)
            // 권한 허용 후 맥이 발견되고 토큰이 있으면 그때 자동 연결
            if !hosts.isEmpty, !didAutoConnect, !settings.token.isEmpty {
                didAutoConnect = true
                session.connect(using: settings)
                showTerminal = true
            }
        }
    }

    /// 앱 아이콘과 같은 모양: 탭 상태 색의 점 세 개(작업 중·답을 기다림·끝남)와 두 겹 고리.
    /// 크기 비율은 아이콘 그대로(점 지름 1, 고리 1.31·1.63, 점 사이 1.6)
    private var logo: some View {
        let d: CGFloat = 22
        let colors = [Theme.accent, Theme.purple, Theme.green]
        return HStack(spacing: 0) {
            ForEach(0..<colors.count, id: \.self) { i in
                ZStack {
                    Circle().stroke(colors[i].opacity(0.30), lineWidth: 1.2).frame(width: d * 1.63, height: d * 1.63)
                    Circle().stroke(colors[i].opacity(0.72), lineWidth: 1.6).frame(width: d * 1.31, height: d * 1.31)
                    Circle().fill(colors[i]).frame(width: d, height: d)
                }
                .frame(width: d * 1.6, height: d * 1.63)
            }
        }
        .accessibilityIdentifier("appLogo")
    }

    private var header: some View {
        VStack(spacing: 10) {
            logo
                .padding(.bottom, 6)
            Text("Antenna")
                .font(.system(size: 32, weight: .regular, design: .serif))
                .foregroundColor(Theme.text)
            Text("맥의 pi·Claude Code를 어디서나 이어서")
                .font(.system(size: 15))
                .foregroundColor(Theme.muted)
        }
        .padding(.bottom, 10)
    }

    private var form: some View {
        VStack(spacing: 14) {
            secureField(title: "토큰", text: $settings.token)
            // 맥에서 antenna-pair 로 띄운 QR 을 앱 안에서 찍기
            Button { showScanner = true } label: {
                Label("QR 코드 찍기", systemImage: "qrcode.viewfinder")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Theme.accent.opacity(0.7)))
            }
            .foregroundColor(Theme.accent)
            .accessibilityIdentifier("scanQR")
            .sheet(isPresented: $showScanner) { QRScanSheet { settings.applyPairURL($0) } }
            Text(settings.pairing ? "맥과 짝짓는 중…" : "맥에서 antenna-pair 를 실행해 QR을 찍으면 돼요(맥 주소도 함께 저장). 토큰만 넣으면 같은 Wi-Fi에서만 맥을 찾아요.")
                .multilineTextAlignment(.center)
                .font(.system(size: 12)).foregroundColor(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func field(title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundColor(Theme.muted)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundColor(Theme.text)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
        }
    }

    private func secureField(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundColor(Theme.muted)
            SecureField("", text: text, prompt: Text("공유 토큰").foregroundColor(Theme.muted))
                .foregroundColor(Theme.text)
                .tint(Theme.accent)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.border))
        }
    }

    private var connectButton: some View {
        Button {
            session.connect(using: settings)
            showTerminal = true
        } label: {
            Text("연결")
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(15)
                .background(Capsule().fill(settings.isValid ? Theme.accent : Theme.surfaceHigh))
                .foregroundColor(settings.isValid ? .white : Theme.muted)
        }
        .disabled(!settings.isValid)
    }

    private var statusLine: some View {
        Group {
            switch session.status {
            case .failed(let msg):
                Text("실패: \(msg)").foregroundColor(Theme.red)
            case .connecting:
                Text("연결 중…").foregroundColor(Theme.muted)
            case .connected:
                Text("연결됨").foregroundColor(Theme.green)
            default:
                EmptyView()
            }
        }
        .font(.footnote)
    }
}

/// 앱 밖에서 열린 짝짓기 링크가 이미 짝지은 폰의 맥 주소를 다른 주소로 바꾸려 할 때 묻는 창.
/// 연결 화면과 터미널 화면(그 위에 덮여 뜸) 양쪽에 달고, 지금 맨 위에 있는 쪽만 띄운다(active)
struct PairConfirm: ViewModifier {
    @ObservedObject var settings: ConnectionSettings
    let active: Bool

    func body(content: Content) -> some View {
        content.alert("연결할 맥 주소를 바꿀까요?",
                      isPresented: Binding(get: { active && settings.pendingPair != nil },
                                           set: { if !$0 { settings.pendingPair = nil } }),
                      presenting: settings.pendingPair) { link in
            Button("바꾸기") { settings.apply(link) }
            Button("취소", role: .cancel) {}
        } message: { link in
            Text("새 주소: \(link.hosts.joined(separator: ", "))\n지금 주소: \(settings.hosts.isEmpty ? "없음" : settings.hosts.joined(separator: ", "))\n내 맥 화면의 QR을 찍은 것이 맞을 때만 바꾸세요.")
        }
    }
}
