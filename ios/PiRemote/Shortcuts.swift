import AppIntents
import Foundation

/// 단축어 앱·Siri·자동화에서 쓰는 동작: 맥의 AI 에게 새 탭에서 일을 시킨다.
/// 폰의 사건(시간·도착·충전·NFC 등)에 단축어 자동화를 걸어 두면, 폰을 만지지 않아도 맥에서 일이 시작되고 끝나면 알림이 온다.
/// 앱 화면을 열지 않고 뒤에서 돈다: 저장된 연결 정보로 맥 브리지에 잠깐 붙어 할 일을 보내고 답을 받는다(TaskSender).
/// 맥은 새 백그라운드 탭을 열어 그 도구를 할 일과 함께 켠다(앱의 '백그라운드로 보내기'와 같은 탭. 서랍에는 '단축어로 시킴')
struct StartTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "맥의 AI 에게 일 시키기"
    static var description = IntentDescription("맥에서 새 탭을 열어 Claude Code 나 pi 에게 일을 시킵니다. 끝나면 폰으로 알려 줍니다.")
    static var openAppWhenRun = false

    @Parameter(title: "할 일", inputOptions: String.IntentInputOptions(multiline: true))
    var task: String

    @Parameter(title: "누구에게", default: .claude)
    var agent: TaskAgent

    @Parameter(title: "폴더", description: "맥의 폴더 경로(예: ~/works/my-project). 비우면 홈 폴더에서 시작합니다.")
    var folder: String?

    static var parameterSummary: some ParameterSummary {
        Summary("\(\.$agent)에게 \(\.$task) 시키기") {
            \.$folder
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let started = try await TaskSender.start(text: task, agent: agent.rawValue, folder: folder)
        return .result(value: started.name, dialog: "맥에서 시작했어요: \(started.name)")
    }
}

/// 일을 맡길 도구(맥 브리지에 그대로 보내는 이름)
enum TaskAgent: String, AppEnum {
    case claude
    case pi

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "AI 도구"
    static var caseDisplayRepresentations: [TaskAgent: DisplayRepresentation] = [.claude: "Claude Code", .pi: "pi"]
}

/// 앱을 깔면 단축어 앱과 Spotlight 에 바로 보이는 동작. 문구에는 앱 이름이 꼭 들어가야 한다
struct AntennaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartTaskIntent(),
                    phrases: ["\(.applicationName)에 일 시키기", "\(.applicationName)로 일 시키기"],
                    shortTitle: "일 시키기",
                    systemImageName: "antenna.radiowaves.left.and.right")
    }
}

/// 맥 브리지에 할 일을 보내 새 탭에서 시작하게 한다(단축어 동작이 씀).
enum TaskSender {
    struct Started: Equatable {
        let window: Int
        let name: String
    }

    /// 단축어 앱이 그대로 보여 주는 글
    enum Failure: Error, Equatable, CustomLocalizedStringResourceConvertible {
        /// 짝지은 적이 없거나 맥 주소를 모름
        case notPaired
        /// 폰을 켠 뒤 한 번도 잠금을 풀지 않아 연결 토큰을 읽을 수 없음
        case locked
        /// 어느 주소로도 맥에 닿지 못함
        case unreachable
        /// 맥이 이 폰의 연결을 끊었음(짝짓기 명령의 끊기)
        case revoked
        /// 붙기는 했는데 답이 없음: 이 동작을 모르는 예전 브리지
        case oldBridge
        /// 맥이 거절함(없는 폴더 등). 글은 맥이 보낸 것
        case rejected(String)

        var localizedStringResource: LocalizedStringResource {
            switch self {
            case .notPaired: return "먼저 Antenna 를 열어 맥과 연결해 주세요"
            case .locked: return "폰을 켠 뒤 잠금을 한 번 풀어야 맥에 연결할 수 있어요"
            case .unreachable: return "맥에 닿지 못했어요. 같은 Wi-Fi 인지, VPN 이 켜져 있는지 확인해 주세요"
            case .revoked: return "맥이 이 폰의 연결을 끊었어요. Antenna 를 열어 다시 연결해 주세요"
            case .oldBridge: return "맥의 Antenna 가 이 동작을 모르는 예전 판이에요. 맥에서 새 판으로 올려 주세요"
            case .rejected(let why): return "\(why)"
            }
        }
    }

    static func start(text: String, agent: String, folder: String?) async throws -> Started {
        if KeychainHelper.read(account: "token") == .locked { throw Failure.locked }
        let settings = ConnectionSettings()
        // 마지막으로 붙었던 주소부터, 그다음 짝짓기 때 받은 맥 주소(작업 표시 토큰 등록과 같은 순서)
        var hosts = [String]()
        for h in [UserDefaults.standard.string(forKey: "pi-remote.lastHost")].compactMap({ $0 }) + settings.hosts where !hosts.contains(h) {
            hosts.append(h)
        }
        guard settings.isValid, !hosts.isEmpty else { throw Failure.notPaired }
        // 요청 번호: 주소 후보마다 같은 요청을 보내므로, 맥이 같은 번호는 한 번만 실행한다(탭이 둘 열리지 않게)
        var body: [String: Any] = ["type": "task-start", "id": UUID().uuidString, "text": text, "agent": agent]
        if let f = folder?.trimmingCharacters(in: .whitespacesAndNewlines), !f.isEmpty { body["cwd"] = f }
        let reply = try await BridgeAsk().ask(body, settings: settings, hosts: hosts, answers: ["task-started", "task-failed"])
        if reply["type"] as? String == "task-started" {
            return Started(window: reply["window"] as? Int ?? -1, name: reply["name"] as? String ?? "bg")
        }
        throw Failure.rejected(reply["message"] as? String ?? String(localized: "맥이 일을 시작하지 못했어요"))
    }
}

#if DEBUG
/// 화면 시험용: 실행 환경 변수 PI_REMOTE_TEST_TASK(할 일 글)가 있으면 앱이 뜬 뒤 단축어 동작을 그대로 한 번 실행한다.
/// 단축어 앱을 거치지 않고 동작의 매개변수·맥에 보내기·답 받기를 본다(폴더는 PI_REMOTE_TEST_TASK_FOLDER). 폰에는 이 변수가 없어 영향 없음
enum ShortcutSelfTest {
    static func runIfAsked() {
        let env = ProcessInfo.processInfo.environment
        guard let text = env["PI_REMOTE_TEST_TASK"], !text.isEmpty else { return }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            let intent = StartTaskIntent()
            intent.task = text
            intent.agent = env["PI_REMOTE_TEST_TASK_AGENT"] == "pi" ? .pi : .claude
            intent.folder = env["PI_REMOTE_TEST_TASK_FOLDER"]
            do {
                let result = try await intent.perform()
                NSLog("[shortcut] 시험 실행: %@", String(describing: result.value))
            } catch {
                NSLog("[shortcut] 시험 실행 실패: %@", String(describing: error))
            }
        }
    }
}
#endif

/// 브리지의 짧은 접속 경로('/push', tmux 를 붙이지 않음)에 요청 하나를 보내고 그 답을 받는다.
/// 맥 주소 후보마다 동시에 묻고 먼저 온 답을 쓴다(어느 길이 닿는지 미리 알 수 없음: 집 Wi-Fi 주소·VPN 주소).
/// 터미널 연결과 같은 방식: 지문이 있으면 그 지문의 맥과만 암호화 연결, 토큰은 머리말로
final class BridgeAsk {
    private let lock = NSLock()
    private var finished = false
    private var pending = 0
    /// 한 곳이라도 요청을 보내는 데 성공함(그런데 답이 없으면 이 요청을 모르는 예전 브리지)
    private var sent = false
    private var revoked = false
    private var tasks: [URLSessionWebSocketTask] = []
    private var session: URLSession?

    func ask(_ body: [String: Any], settings: ConnectionSettings, hosts: [String], answers: Set<String>,
             timeout: TimeInterval = 12) async throws -> [String: Any] {
        guard let data = try? JSONSerialization.data(withJSONObject: body), let text = String(data: data, encoding: .utf8) else {
            throw TaskSender.Failure.rejected(String(localized: "보낼 글을 만들지 못했어요"))
        }
        return try await withCheckedThrowingContinuation { continuation in
            let cfg = URLSessionConfiguration.ephemeral
            cfg.timeoutIntervalForRequest = 8
            let session = URLSession(configuration: cfg,
                                     delegate: settings.fingerprint.isEmpty ? nil : PinnedDelegate(fingerprint: settings.fingerprint),
                                     delegateQueue: nil)
            self.session = session
            // 끝은 한 번만(답·모두 실패·시간 초과가 겹쳐 올 수 있음)
            let finish: (Result<[String: Any], Error>) -> Void = { [self] result in
                lock.lock()
                let first = !finished
                finished = true
                let open = tasks
                lock.unlock()
                guard first else { return }
                open.forEach { $0.cancel(with: .normalClosure, reason: nil) }
                session.invalidateAndCancel()
                continuation.resume(with: result)
            }
            let giveUp: () -> Void = { [self] in
                lock.lock()
                let why: TaskSender.Failure = revoked ? .revoked : sent ? .oldBridge : .unreachable
                lock.unlock()
                finish(.failure(why))
            }
            // 후보 하나가 답 없이 끝남: 모두 끝났으면 실패로 마무리
            let oneDone: (URLSessionWebSocketTask) -> Void = { [self] task in
                lock.lock()
                // 브리지가 인증에 실패한 연결을 닫는 번호: 4001(모르는 토큰)·4003(끊긴 기기)
                if [4001, 4003].contains(task.closeCode.rawValue) { revoked = true }
                pending -= 1
                let last = pending == 0
                lock.unlock()
                if last { giveUp() }
            }
            for host in hosts {
                guard let request = settings.request(host: host, path: "/push") else { continue }
                let task = session.webSocketTask(with: request)
                lock.lock()
                pending += 1
                tasks.append(task)
                lock.unlock()
                task.resume()
                task.send(.string(text)) { [self] error in
                    guard error == nil else { return }
                    lock.lock()
                    sent = true
                    lock.unlock()
                }
                Self.receive(on: task, answers: answers, got: { finish(.success($0)) }, closed: { oneDone(task) })
            }
            lock.lock()
            let none = pending == 0
            lock.unlock()
            if none { finish(.failure(TaskSender.Failure.unreachable)) }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { giveUp() }
        }
    }

    /// 바라는 종류의 답이 올 때까지 받는다. 연결이 닫히면 closed
    private static func receive(on task: URLSessionWebSocketTask, answers: Set<String>,
                                got: @escaping ([String: Any]) -> Void, closed: @escaping () -> Void) {
        task.receive { result in
            guard case .success(let message) = result else {
                closed()
                return
            }
            if case .string(let s) = message, let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any],
               let type = obj["type"] as? String, answers.contains(type) {
                got(obj)
            } else {
                receive(on: task, answers: answers, got: got, closed: closed)
            }
        }
    }
}
