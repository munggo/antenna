import Foundation

// 맥 pi 확장(pi-remote-feed)이 보내는 대화 데이터. 브리지가 {"type":"chat","d":<이벤트>} 로 감싸 전달한다.

/// 파일 도구가 바꾼 줄 수(+늘어난 줄, -줄어든 줄)
struct ChangeStats: Codable, Equatable {
    let added: Int
    let removed: Int
}

/// 단계 하나의 상세(탭했을 때 맥에서 받아 옴)
struct ToolDetail: Decodable, Equatable {
    struct EditPair: Decodable, Equatable {
        let old: String
        let new: String
    }
    let key: String
    let kind: String?           // bash | edit | write | read | thinking | other
    let command: String?
    let path: String?
    let edits: [EditPair]?
    let content: String?
    let output: String?
    let isError: Bool?
    let done: Bool?
    let text: String?           // 생각 내용
    let title: String?
    let args: String?
    let error: String?
}

struct ChatBlock: Codable, Equatable {
    let type: String        // text | thinking | tool
    let text: String?
    let id: String?         // tool 호출 id
    let name: String?       // tool 이름
    let summary: String?    // tool 인자 한 줄 요약
    let desc: String?       // tool 이 무엇을 하는지 한 줄 설명(폰 진행 표시용)
    let stats: ChangeStats? // 파일 도구가 바꾼 줄 수
    let ref: String?        // 생각 블록 위치("메시지시각:블록번호", 상세 요청용)
    let image: Bool?        // 사진 파일을 읽은 단계(대화에 그 사진을 보여줌)
    let update: Bool?       // 도구를 부르기 전의 짧은 진행 설명(Claude Code 가 줄여서 준 글). 대화에는 보이고 '답변 복사'에는 넣지 않음
}

struct ChatMessage: Codable, Identifiable, Equatable {
    let id: String
    let role: String        // user | assistant | toolResult | bash | summary
    // user
    let text: String?
    let images: Int?
    // assistant
    let blocks: [ChatBlock]?
    let stop: String?       // pending(스트리밍 중) | stop | toolUse | error | aborted ...
    let error: String?
    // toolResult
    let toolCallId: String?
    let isError: Bool?
    let output: String?
    let answer: String?     // 고르는 질문(ask_user)의 답
    var artifact: ArtifactRef? = nil   // show_artifact 로 등록한 결과물
    // bash (! 명령)
    let command: String?
    let exitCode: Int?
}

/// 작업 중에 받아 둔(끼워넣기 대기) 메시지. pi 가 대화에 넣으면 목록에서 빠진다.
struct QueueItem: Codable, Identifiable, Equatable {
    let id: String
    let text: String
    let kind: String        // steer: 다음 단계에서 전달 / followUp: 작업이 끝나면 전달
}

/// 뒤에서 도는 작업(Claude Code 의 백그라운드 셸·하위 에이전트·감시). 서랍의 '백그라운드 작업 N'을 누르면 보이는 목록
struct BgJob: Codable, Identifiable, Equatable {
    let id: String
    let kind: String        // shell | agent | monitor
    let title: String
    let startedAt: Double   // 시작한 때(ms)
    let tail: String?       // 셸의 최근 출력 몇 줄
    let agentType: String?  // 에이전트: 종류(Explore·general-purpose·fork 등)
    let model: String?      // 에이전트: 실제로 쓰는 모델(짧은 이름, 예: "Haiku 5.5")
    let thinking: String?   // 에이전트: 생각 깊이(high 등). 확실할 때만 맥이 보내고, 모르면 ""
}

struct ChatEvent: Decodable {
    let t: String           // snapshot | upsert | tool | working | queue | unavailable
    let v: Int?             // t == snapshot: 맥 확장이 주고받는 형식의 판(없으면 1)
    let messages: [ChatMessage]?
    let truncated: Int?
    let working: Bool?
    let message: ChatMessage?
    let id: String?
    let state: String?
    let value: Bool?
    let items: [QueueItem]?     // t == queue
    let queue: [QueueItem]?     // t == snapshot
    let text: String?           // t == notice
    let commands: [SlashCommand]?  // t == commands(확장·스킬·프롬프트 명령)
    let detail: ToolDetail?        // t == detail(단계 상세)
    let context: ContextInfo?      // t == context / snapshot(컨텍스트 사용량)
    let compacting: Bool?          // t == snapshot(압축 중인지)
    let since: Double?             // t == snapshot / working / compacting: 맥에서 시작한 시각(ms)
    let compactSince: Double?      // t == snapshot: 압축을 시작한 시각(ms)
    let item: ApprovalItem?        // t == approval: 승인 요청
    let approvals: [ApprovalItem]? // t == snapshot: 기다리는 승인들
    let summary: String?           // t == approval-update: 주의 한 문장(Opus)
    let headline: String?          // t == approval-update: 무엇을 하는 명령인지 한 문장(Opus)
    let risk: String?              // t == approval-update: 위험도(상·중·하, Opus 판단)
    let summarizing: Bool?         // t == approval-update: 요약 중
    let question: QuestionItem?    // t == question: 고르는 질문
    let questions: [QuestionItem]? // t == snapshot: 답을 기다리는 질문들
    let todos: [TodoItem]?         // t == snapshot·todos: 할 일 목록
    let memory: [MemoryFile]?      // t == memory: 지침 파일 목록
    let planMode: Bool?            // t == snapshot: 계획 모드
    let permMode: String?          // t == snapshot: 권한 모드(auto·ask·plan)
    let mode: String?              // t == permmode: 권한 모드
    let agent: String?             // t == snapshot: 이 탭의 에이전트(claude 면 Claude Code, 없으면 pi)
    let modelChoices: [ModelChoice]?   // t == snapshot: 이 탭에서 고를 수 있는 모델(Claude Code 탭: 맥의 /model 화면과 같은 목록)
    let on: Bool?                  // t == planmode
    let files: [FileSuggestion]?   // t == files: '@' 파일 찾기 결과
    let query: String?             // t == files: 찾은 글자
    let data: String?              // t == toolimage(읽은 사진, base64 JPEG)
    let error: String?             // t == toolimage·artifact(실패 이유)
    let path: String?              // t == artifact(맥 파일 경로)
    let name: String?              // t == artifact(파일 이름)
    let size: Int?                 // t == artifact(파일 전체 크기, 나눠 받기)
    let offset: Int?               // t == artifact(이 조각의 시작 위치. 없으면 예전 피드 — 통째로)
    let done: Bool?                // t == artifact(마지막 조각)
    let mtime: Double?             // t == artifact(맥 파일 수정 시각: 받는 중에 바뀌었는지)
    let notice: String?         // t == snapshot(재시작 직후 안내)
    let jobs: [BgJob]?          // t == bg-jobs: 뒤에서 도는 작업 목록
    let window: Int?            // t == bg-jobs: 어느 탭(창 번호)의 목록인지
    // t == snapshot, 탭마다 대화를 저장하는 맥 브리지(11-25, ChatDelta·TabChats)
    let key: String?            // 이 대화의 탭(칸 번호)
    let hashes: [String]?       // 메시지마다 내용 지문(전체, 순서대로)
    let delta: Bool?            // 폰에 있는 것은 빼고 보냄
    let fresh: [Int]?           // delta 일 때 보낸 메시지의 자리(hashes 의 몇 번째인지)
}

struct ChatEnvelope: Decodable {
    let d: ChatEvent
}

/// 다른 탭을 미리 받은 결과(맥 브리지의 {type:"chat-bg"}). d: 그 탭의 처음 대화 · unavailable: 대화 피드가 없는 탭 · error: 못 받음
struct ChatBackground: Decodable {
    let key: String
    let d: ChatEvent?
    let unavailable: Bool?
    let error: String?
}

/// 보내자마자 화면에 먼저 띄우는 내 메시지. pi 가 실제로 대화에 넣으면 사라지고 진짜 말풍선으로 바뀐다.
struct PendingMessage: Identifiable, Equatable {
    let id: String
    let text: String
    let mode: String?   // 작업 중에 보낸 방식(steer/followUp/interrupt). 쉬는 중에 보냈으면 nil
    let window: Int?    // 보낸 탭(tmux 창 번호). 그 탭을 볼 때만 보인다
}

/// 입력창이 쓰는 값(명령 목록·컨텍스트 사용량). 대화 내용과 따로 둬서
/// 답변이 흘러나오는 동안 입력창(작성 중인 글)이 계속 다시 그려지지 않게 한다.
/// 모델 메뉴의 한 줄. id 는 '/model <id>' 로 보내는 값, name 은 보이는 이름(현재 모델 이름이 이것으로 시작하면 체크)
struct ModelChoice: Codable, Identifiable, Equatable {
    let id: String
    let name: String
}

final class ChatMeta: ObservableObject {
    /// 이 앱이 쓰는 기능(사용량 게이지·단계 상세·지난 대화 기록)이 들어간 맥 확장의 판
    static let neededVersion = 3
    @Published var commands: [SlashCommand] = []
    @Published var context: ContextInfo?
    /// 이 탭의 에이전트 이름(입력창 안내 등): "pi" | "Claude"
    @Published var agentName = "pi"
    /// 맥이 알려 준 모델 선택지(Claude Code 탭). 비어 있으면 pi 가 아는 모델 목록을 씀
    @Published var modelChoices: [ModelChoice] = []
    /// 맥 pi 가 예전 확장으로 돌고 있음 → 입력창 위에 '다시 불러오기' 띠
    @Published var outdated = false
    /// 승인을 기다리는 보내기·위험 동작 → 입력창 위 승인 카드
    @Published var approvals: [ApprovalItem] = []
    /// 답을 기다리는 고르는 질문 → 입력창 위 질문 카드
    @Published var questions: [QuestionItem] = []
    /// 할 일 목록(pi 의 todo_write). 입력창 위 접히는 칸
    @Published var todos: [TodoItem] = []
    /// 계획 모드(읽기만 하며 계획을 세움)
    @Published var planMode = false
    /// 권한 모드: auto(자동) | ask(매번 묻기) | plan(계획)
    @Published var permMode = "auto"
    /// 되감은 뒤 입력창에 넣을 글
    @Published var prefill: String?
    /// 메모리(지침 파일) 목록과 저장 결과
    @Published var memoryFiles: [MemoryFile]?
    @Published var memorySaved: MemorySaved?
    /// 입력창 '@' 파일 찾기: 결과와 그 결과의 찾은 글자, 찾는 중인지
    @Published var files: [FileSuggestion] = []
    @Published var filesQuery: String?
    @Published var filesLoading = false
    @Published var filesError: String?
    /// 마지막으로 요청한 글자(늦게 온 옛 결과는 버림)
    var requestedFilesQuery: String?
    /// 뒤에서 도는 작업 목록(nil: 아직 받지 못함)과 그 목록의 탭(창 번호), 가져오지 못한 까닭
    @Published var bgJobs: [BgJob]?
    @Published var bgJobsWindow: Int?
    @Published var bgJobsError: String?
}

/// 폰이 들고 있는 대화. 피드 이벤트를 차례로 적용한다(메인 스레드에서만 호출).
final class ChatStore: ObservableObject {
    /// 화면 항목(말풍선·답변·도구 묶음). 내용이 바뀔 때만 다시 계산한다(작업 중 버벅임 방지).
    @Published private(set) var items: [ChatItem] = []
    /// 대화 속 사진(내가 보낸 사진 + 답변 속 그림)을 순서대로. 전체화면에서 좌우로 넘길 때 쓴다.
    private(set) var imagePaths: [String] = []
    @Published private(set) var pending: [PendingMessage] = []
    /// 지금 보고 있는 탭(tmux 창 번호). 대기 말풍선은 보낸 탭에서만 보인다
    @Published private(set) var window: Int?
    /// 지금 탭에서 보낸 대기 말풍선
    var visiblePending: [PendingMessage] { pending.filter { $0.window == window } }
    /// pi 가 실제로 받아 둔 끼워넣기 대기열(맥에서 친 것 포함)
    @Published private(set) var queue: [QueueItem] = []
    /// 단계 상세(키: 도구 id 또는 생각 위치)
    @Published private(set) var details: [String: ToolDetail] = [:]
    /// 입력창용 값(명령 목록·컨텍스트 사용량)
    let meta = ChatMeta()
    /// 대화를 압축하는 중(자동·수동). 하단에 '대화를 압축하는 중' 표시
    @Published private(set) var compacting = false
    @Published private(set) var compactingSince: Date?
    /// 화면 위에 잠깐 띄우는 안내(업데이트·다시 불러오기 등)
    @Published private(set) var notice: String?
    private var noticeSeq = 0
    private var pendingSeq = 0
    @Published private(set) var messages: [ChatMessage] = []
    /// 이 대화의 아티팩트(같은 파일은 마지막 등록만, 등록 순서)
    var artifacts: [ArtifactRef] {
        var out: [ArtifactRef] = []
        for m in messages where m.role == "toolResult" {
            if let a = m.artifact { out.removeAll { $0.path == a.path }; out.append(a) }
        }
        return out
    }
    @Published private(set) var truncated = 0
    @Published private(set) var toolStates: [String: String] = [:]
    /// 내용이 바뀔 때마다 증가 → 채팅 화면이 맨 아래를 따라가는 신호
    @Published private(set) var version = 0
    /// 대화 전체를 새로 받을 때마다 증가 → 채팅 화면을 맨 아래로 다시 맞춤
    @Published private(set) var snapshotCount = 0

    private(set) var available = false
    private(set) var working = false
    /// 이번 작업이 시작된 시각("7초 · 생각 중" 경과 시간용)
    @Published private(set) var workingSince: Date?
    /// 사용 가능 여부·작업 중 여부가 바뀌면 알림(세션이 상단바·입력창 상태로 반영)
    var onStateChange: ((_ available: Bool, _ working: Bool) -> Void)?
    /// 도구가 읽은 사진을 받았을 때(세션이 썸네일 저장소에 넣는다)
    var onToolImage: ((_ id: String, _ data: Data?, _ error: String?) -> Void)?

    // MARK: - 탭마다 저장해 둔 대화(11-25 사용자 요청: 탭을 바꾸면 바로 보이게. TabChats·ChatDelta)

    let tabs = TabChats()
    /// 지금 화면의 대화가 어느 탭(칸 번호) 것인지. 예전 맥(칸 번호를 주지 않음)이면 nil
    private(set) var currentKey: String?
    /// 지금 대화의 메시지 id → 맥이 준 지문(그 뒤 바뀐 메시지는 빠짐)
    private var msgHash: [String: String] = [:]
    /// 저장해 둔 대화를 보여 주며 맥의 최신 대화를 기다리는 중
    @Published private(set) var refreshing = false
    /// 사용자가 고른 탭과 그 시각. 그 사이 늦게 온 다른 탭의 대화는 화면에 보이지 않고 저장만 한다
    private var tapKey: String?
    private var tapAt: Date?
    /// 칸 번호 → 탭 이름(저장할 때 함께 적어, 칸 번호가 다른 탭에 다시 쓰였을 때 엉뚱한 대화를 보이지 않게)
    private var tabNames: [String: String] = [:]
    /// 저장해 둔 것으로 대화를 잇지 못함 → 맥에 그 탭을 통째로 다시 청함
    var onResync: ((String) -> Void)?
    /// 화면에 그리기 시작하는 항목 자리. 긴 대화는 최근 것부터 그리고, 맨 위 '이전 대화 더 보기'로 더 그린다
    /// (탭을 바꿀 때마다 300개를 한꺼번에 그리느라 느렸음)
    @Published private(set) var firstShown = 0
    private var resetShown = false
    /// 대화를 새로 보일 때 처음 그리는 항목 수와 '더 보기'로 더 그리는 수
    static let firstDraw = 40
    static let moreDraw = 60

    /// 다른 탭으로 감: 지금 대화를 저장하고, 그 탭의 저장해 둔 대화를 바로 보여 준 뒤 맥의 최신 대화를 기다린다.
    /// byTap: 사용자가 앱에서 고름(그렇지 않으면 맥에서 바꿨거나 앱을 막 열어 탭 목록을 받은 것)
    func showTab(key: String, name: String, working: Bool, byTap: Bool) {
        if byTap {
            tapKey = key
            tapAt = Date()
        }
        tabNames[key] = name
        guard key != currentKey else { return }
        stash()
        currentKey = key
        TabChats.lastKey = key
        // 다른 탭의 질문·승인 카드와 대기열은 치운다(새 탭의 것은 곧 받음)
        if !meta.approvals.isEmpty { meta.approvals = [] }
        if !meta.questions.isEmpty { meta.questions = [] }
        queue = []
        toolStates = [:]
        if let s = tabs.get(key), s.name == name {
            messages = s.messages
            msgHash = s.hashes
            truncated = s.truncated
            meta.agentName = s.agent == "claude" ? "Claude" : "pi"
            if let n = tabs.takeNotice(key) { showNotice(n) }
            setState(available: true, working: working)
        } else {
            messages = []
            msgHash = [:]
            truncated = 0
            setState(available: available, working: working)
        }
        refreshing = true
        resetShown = true
        snapshotCount &+= 1
        rebuild()
    }

    /// 맥의 탭 목록에서 지금 탭이 바뀜(맥에서 바꿨거나 앱을 막 열었음) → 그 탭의 저장해 둔 대화로.
    /// 앱에서 방금 고른 탭으로 아직 바뀌기 전(3초 안)의 목록은 따르지 않는다
    func followTab(key: String, name: String, working: Bool) {
        tabNames[key] = name
        if let t = tapAt, Date().timeIntervalSince(t) < 3, tapKey != key { return }
        if key != currentKey { showTab(key: key, name: name, working: working, byTap: false) }
    }

    /// 지금 탭의 대화를 저장(다른 탭으로 갈 때·대화를 새로 받을 때·앱이 뒤로 갈 때)
    private func stash() {
        guard let key = currentKey, available, !messages.isEmpty else { return }
        let ids = Set(messages.map(\.id))
        tabs.put(key, .init(name: tabNames[key] ?? tabs.get(key)?.name ?? "", messages: messages, hashes: msgHash.filter { ids.contains($0.key) },
                            truncated: truncated, agent: meta.agentName == "Claude" ? "claude" : nil, notice: nil))
    }

    /// 맥이 준 처음 대화를 메시지 목록으로(폰에 있는 것을 빼고 보냈으면 저장해 둔 것과 이어 붙임). 잇지 못하면 nil
    private func assemble(_ key: String, _ e: ChatEvent) -> [ChatMessage]? {
        guard let hashes = e.hashes else { return e.messages ?? [] }
        return ChatDelta.assemble(hashes: hashes, fresh: e.delta == true ? (e.fresh ?? []) : nil, sent: e.messages ?? [], pool: tabs.pool(key))
    }

    private static func hashMap(_ list: [ChatMessage], _ hashes: [String]?) -> [String: String] {
        guard let hashes, hashes.count == list.count else { return [:] }
        return Dictionary(zip(list.map(\.id), hashes), uniquingKeysWith: { _, b in b })
    }

    /// 다른 탭의 대화를 받아 저장만 한다(미리 받기·늦게 온 것). 잇지 못하면 false(통째로 다시 받아야 함)
    @discardableResult
    func storeBackground(_ key: String, _ e: ChatEvent) -> Bool {
        guard e.t == "snapshot", let list = assemble(key, e) else { return false }
        let hashes = Self.hashMap(list, e.hashes)
        if key == currentKey {
            tabs.addPool(key, list, hashes)   // 지금 보는 탭이면 화면은 맥의 대화 피드가 맞춘다(다음에 이어 붙일 때만 씀)
            return true
        }
        let old = tabs.get(key)
        let note = (e.notice ?? "").isEmpty ? old?.notice : e.notice
        tabs.put(key, .init(name: tabNames[key] ?? old?.name ?? "", messages: list, hashes: hashes,
                            truncated: e.truncated ?? 0, agent: e.agent, notice: note))
        return true
    }

    /// '이전 대화 더 보기'
    func showMore() {
        firstShown = max(0, firstShown - Self.moreDraw)
    }

    func apply(_ e: ChatEvent) {
        switch e.t {
        case "snapshot":
            if let key = e.key, e.hashes != nil {
                if key != currentKey {
                    // 사용자가 다른 탭을 고른 사이 늦게 온 대화: 화면에 보이지 않고 저장만
                    if let t = tapAt, Date().timeIntervalSince(t) < 5, let want = tapKey, want != key {
                        storeBackground(key, e)
                        return
                    }
                    stash()
                    currentKey = key
                    TabChats.lastKey = key
                }
                guard let list = assemble(key, e) else {
                    onResync?(key)   // 저장해 둔 것에 없는 메시지가 있음 → 통째로 다시(그동안 지금 화면은 그대로)
                    return
                }
                messages = list
                msgHash = Self.hashMap(list, e.hashes)
                tabs.addPool(key, list, msgHash)
                if key == tapKey {
                    tapKey = nil
                    tapAt = nil
                }
            } else {
                messages = e.messages ?? []
                msgHash = [:]
            }
            refreshing = false
            resetShown = true
            meta.agentName = e.agent == "claude" ? "Claude" : "pi"
            meta.modelChoices = e.modelChoices ?? []
            truncated = e.truncated ?? 0
            toolStates = [:]
            queue = e.queue ?? []
            if let n = e.notice, !n.isEmpty { showNotice(n) }
            meta.context = e.context
            let pendingApprovals = e.approvals ?? []
            if meta.approvals != pendingApprovals { meta.approvals = pendingApprovals }
            let pendingQuestions = e.questions ?? []
            if meta.questions != pendingQuestions { meta.questions = pendingQuestions }
            if let p = e.planMode, meta.planMode != p { meta.planMode = p }
            let pm = e.permMode ?? ((e.planMode ?? false) ? "plan" : "auto")
            if meta.permMode != pm { meta.permMode = pm }
            let todoList = e.todos ?? []
            if meta.todos != todoList { meta.todos = todoList }
            let old = (e.v ?? 1) < ChatMeta.neededVersion
            if meta.outdated != old { meta.outdated = old }
            setCompacting(e.compacting ?? false, since: e.compactSince)
            for m in messages.suffix(30) where m.role == "user" { matchPending(m.text ?? "") }
            for q in queue { matchPending(q.text) }
            snapshotCount &+= 1
            setState(available: true, working: e.working ?? false, since: e.since)
            // 다른 탭에 가 있는 동안 이 탭 작업이 끝났으면 남은 대기 말풍선 정리
            if !(e.working ?? false) { clearLeftoverPending(after: 2) }
            saveCache()
        case "upsert":
            guard let m = e.message else { return }
            msgHash[m.id] = nil   // 맥이 준 지문과 내용이 달라짐
            if let i = messages.lastIndex(where: { $0.id == m.id }) {
                messages[i] = m
            } else {
                messages.append(m)
            }
            if m.role == "user" { matchPending(m.text ?? "") }
            if !available { setState(available: true, working: working) }
        case "tool":
            if let id = e.id, let s = e.state { toolStates[id] = s }
        case "notice":
            if let n = e.text, !n.isEmpty { showNotice(n) }
        case "commands":
            meta.commands = e.commands ?? []
            return
        case "approval":
            if let a = e.item, !meta.approvals.contains(where: { $0.id == a.id }) { meta.approvals.append(a) }
            return
        case "approval-update":
            if let id = e.id, let i = meta.approvals.firstIndex(where: { $0.id == id }) {
                meta.approvals[i].summary = e.summary
                meta.approvals[i].headline = e.headline
                if let r = e.risk, !r.isEmpty { meta.approvals[i].risk = r }
                meta.approvals[i].summarizing = e.summarizing
            }
        case "approval-done":
            if let id = e.id { meta.approvals.removeAll { $0.id == id } }
            return
        case "question":
            if let q = e.question, !meta.questions.contains(where: { $0.id == q.id }) { meta.questions.append(q) }
            return
        case "bg-jobs":
            meta.bgJobs = e.jobs ?? []
            meta.bgJobsWindow = e.window
            meta.bgJobsError = e.error
            return
        case "files":
            guard let q = e.query, q == meta.requestedFilesQuery else { return }
            meta.files = e.files ?? []
            meta.filesQuery = q
            meta.filesError = e.error
            meta.filesLoading = false
            return
        case "planmode":
            meta.planMode = e.on ?? false
            return
        case "permmode":
            meta.permMode = e.mode ?? "auto"
            return
        case "rewound":
            meta.prefill = e.text ?? ""
            return
        case "memory":
            meta.memoryFiles = e.memory ?? []
            return
        case "memory-saved":
            meta.memorySaved = MemorySaved(path: e.path ?? "", error: e.error, at: Date())
            return
        case "todos":
            let list = e.todos ?? []
            if meta.todos != list { meta.todos = list }
            return
        case "question-done":
            if let id = e.id { meta.questions.removeAll { $0.id == id } }
            return
        case "context":
            if meta.context != e.context { meta.context = e.context }
            return
        case "compacting":
            setCompacting(e.value ?? false, since: e.since)
            return
        case "detail":
            if let d = e.detail { details[d.key] = d }
            return
        case "toolimage":
            if let id = e.id { onToolImage?(id, e.data.flatMap { Data(base64Encoded: $0) }, e.error) }
            return
        case "artifact":
            if let p = e.path {
                ArtifactCenter.shared.receive(path: p, name: e.name, data: e.data.flatMap { Data(base64Encoded: $0) }, error: e.error,
                                              size: e.size, offset: e.offset, done: e.done, mtime: e.mtime)
            }
            return
        case "queue":
            // pi 가 받아 둔 게 확인되면 앱이 먼저 띄운 말풍선은 대기열 표시로 넘긴다
            queue = e.items ?? []
            for q in queue { matchPending(q.text) }
        case "working":
            let w = e.value ?? false
            setState(available: available, working: w, since: e.since)
            if !w { clearLeftoverPending(after: 2) }
        case "unavailable":
            refreshing = false
            setState(available: false, working: false)
            meta.context = nil   // pi 가 없는 창이면 게이지도 숨김
            meta.outdated = false
            meta.approvals = []
            meta.questions = []
            setCompacting(false)
        default:
            return
        }
        rebuild()
    }

    /// 이 도구의 결과가 이미 왔는지(안 왔고 작업 중이면 아직 실행 중)
    func hasResult(_ callId: String) -> Bool {
        messages.contains { $0.role == "toolResult" && $0.toolCallId == callId }
    }

    /// 이 생각 단계가 지금 쓰이는 중인지(작업 중인 마지막 답의 마지막 블록)
    func isLiveThinking(_ stepId: String) -> Bool {
        guard working, let last = messages.last, last.role == "assistant", last.stop == "pending",
              let blocks = last.blocks, blocks.last?.type == "thinking" else { return false }
        return stepId == "think-\(last.id)-\(blocks.count - 1)"
    }

    private func setCompacting(_ v: Bool, since: Double? = nil) {
        if v {
            if let s = since { compactingSince = Date(timeIntervalSince1970: s / 1000) }   // 맥에서 시작한 시각
            else if !compacting { compactingSince = Date() }
        } else {
            compactingSince = nil
        }
        if compacting != v { compacting = v }
    }

    func showNotice(_ text: String) {
        noticeSeq += 1
        let seq = noticeSeq
        notice = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            if self?.noticeSeq == seq { self?.notice = nil }
        }
    }

    // MARK: - 보내자마자 띄우는 메시지

    /// 보낸 즉시 화면에 내 말풍선을 띄운다. 작업 중이면 "전송 대기"로 표시.
    func addPending(_ text: String, mode: String?) {
        pendingSeq += 1
        let p = PendingMessage(id: "pending-\(pendingSeq)", text: text, mode: mode, window: window)
        pending.append(p)
        if mode == nil {
            // 쉬는 중에 보낸 건 곧 대화에 들어온다. 10초 넘게 안 들어오면 정리.
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self, self.pending.contains(p) else { return }
                self.pending.removeAll { $0.id == p.id }
                self.rebuild()
            }
        }
        rebuild()
    }

    /// pi 가 대화에 넣은 내 메시지와 같은 글이면 대기 말풍선을 지운다(사진 경로 등이 앞에 붙을 수 있어 포함 여부로 비교)
    private func matchPending(_ userText: String) {
        let t = userText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let i = pending.firstIndex(where: { $0.window == window && t.contains($0.text.trimmingCharacters(in: .whitespacesAndNewlines)) }) {
            pending.remove(at: i)
        }
    }

    /// 작업이 끝났는데도 안 들어온 대기 메시지는 정리(중지로 pi 입력창에 되돌아간 경우 등)
    private func clearLeftoverPending(after seconds: Double) {
        let w = window
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            // 그 사이 다른 탭으로 옮겼으면 그 탭 것은 건드리지 않음
            guard let self, !self.working, self.window == w, self.pending.contains(where: { $0.window == w }) else { return }
            self.pending.removeAll { $0.window == w }
            self.rebuild()
        }
    }

    /// 지금 보는 탭이 바뀌면(앱·맥 어느 쪽에서 바꿔도) 대기 말풍선을 그 탭 것만 보이게
    func setWindow(_ w: Int?) {
        guard w != window else { return }
        window = w
        rebuild()
    }

    private func rebuild() {
        items = ChatItemBuilder.build(self)
        if resetShown {
            resetShown = false
            firstShown = max(0, items.count - Self.firstDraw)
        }
        imagePaths = Self.collectImages(messages)
        version &+= 1
    }

    /// 사진 보기에서 좌우로 넘길 목록(대화 순서): 내가 보낸 사진, 답 속 사진, pi 가 읽은 사진(toolimg-<id>)
    private static func collectImages(_ messages: [ChatMessage]) -> [String] {
        // 끝난(오류 아닌) 도구 단계만: 채팅에 사진이 보이는 단계와 같게
        let done = Set(messages.compactMap { $0.role == "toolResult" && $0.isError != true ? $0.toolCallId : nil })
        var out: [String] = []
        for m in messages {
            if m.role == "user" {
                out += ImageTokens.split(m.text ?? "").paths
            } else if m.role == "assistant" {
                for b in m.blocks ?? [] {
                    if b.type == "text" {
                        for block in MarkdownParser.parse(b.text ?? "") {
                            if case .image(let p) = block { out.append(p) }
                        }
                    } else if b.type == "tool", b.image == true, let id = b.id, done.contains(id) {
                        out.append("toolimg-\(id)")
                    }
                }
            }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    /// 연결이 끊겨도 채팅 화면은 그대로 둔다(터미널로 바꾸지 않음). 작업 중 표시만 끈다.
    /// 터미널로 바꾸는 건 브리지가 "이 창엔 pi 가 없다(unavailable)"고 알릴 때뿐이다.
    func markDisconnected() {
        setState(available: available, working: false)
    }

    // MARK: - 기기 저장(앱을 다시 열면 마지막으로 본 탭의 대화를 바로 보여주기)

    /// 마지막으로 본 탭의 저장해 둔 대화를 불러온다. 있으면 채팅 화면을 바로 보여줄 수 있게 사용 가능 상태로 둔다.
    func loadCache() {
        guard let key = TabChats.lastKey, let s = tabs.get(key) else { return }
        currentKey = key
        tabNames[key] = s.name
        messages = s.messages
        msgHash = s.hashes
        truncated = s.truncated
        meta.agentName = s.agent == "claude" ? "Claude" : "pi"
        available = true
        refreshing = true
        resetShown = true
        snapshotCount &+= 1
        rebuild()
    }

    /// 지금 대화를 저장(사용 가능할 때만). 백그라운드로 갈 때·대화 전체를 받을 때 호출.
    func saveCache() {
        stash()
    }

    /// since: 맥 pi 가 이번 작업을 시작한 시각(ms). 있으면 그 시각부터 센다(앱을 늦게 열어도 실제 경과 시간).
    /// 없으면(예전 확장) 작업 중 신호를 처음 받은 때부터.
    private func setState(available a: Bool, working w: Bool, since: Double? = nil) {
        if w {
            if let s = since { workingSince = Date(timeIntervalSince1970: s / 1000) }
            else if !working { workingSince = Date() }
        } else {
            workingSince = nil
        }
        let changed = a != available || w != working
        available = a
        working = w
        if changed { onStateChange?(a, w) }
    }
}
