import SwiftUI
import UIKit

// 단계 창(Claude 앱처럼 아래에서 올라옴)
// - 단계 줄을 누르면: 단계 목록(아이콘·한 줄 설명·+/− 줄 수, 세로 선으로 이어짐)
// - 단계를 누르면: 전체 명령·출력 / 바뀐 줄(diff) / 생각 내용 — 맥에 요청해 받아 온다
// - 실행 중인 단계·쓰는 중인 생각은 창이 열려 있는 동안 2초마다 새로 받는다

/// 단계 창 열기 요청(채팅 화면이 이 값으로 창을 띄운다)
final class StepsPresenter: ObservableObject {
    struct Request: Identifiable {
        let id = UUID()
        let groupId: String?        // 대화 속 단계 묶음(작업 중이면 단계가 늘어나므로 최신 것을 다시 찾음)
        let steps: [ToolCallInfo]   // 연 순간의 단계(묶음을 못 찾을 때 대신)
    }
    @Published var request: Request?

    func open(groupId: String?, steps: [ToolCallInfo]) {
        guard !steps.isEmpty else { return }
        request = Request(groupId: groupId, steps: steps)
    }
}

/// 단계 줄이 창을 열 수 있게 넘겨주는 값(객체 참조라 바뀌지 않음 → 대화 항목을 다시 그리지 않음)
private struct StepsPresenterKey: EnvironmentKey {
    static let defaultValue: StepsPresenter? = nil
}

extension EnvironmentValues {
    var stepsPresenter: StepsPresenter? {
        get { self[StepsPresenterKey.self] }
        set { self[StepsPresenterKey.self] = newValue }
    }
}

// MARK: - 창

struct StepsSheet: View {
    let request: StepsPresenter.Request
    @ObservedObject var store: ChatStore
    let session: TerminalSession
    @Environment(\.dismiss) private var dismiss

    /// 최신 단계 목록(작업 중이면 늘어남)
    private var steps: [ToolCallInfo] {
        if let gid = request.groupId {
            for item in store.items {
                if case .tools(let id, let calls) = item, id == gid { return calls }
            }
        }
        return request.steps
    }

    var body: some View {
        // 단계가 하나뿐이면 목록 없이 바로 상세(연 순간 기준으로 정해 화면이 바뀌지 않게)
        let direct = request.steps.count == 1
        NavigationStack {
            Group {
                if direct {
                    StepDetailView(step: steps.first { $0.id == request.steps[0].id } ?? request.steps[0],
                                   store: store, session: session)
                } else {
                    list
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    CloseCircle { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    Text(direct ? StepText.title(request.steps[0]) : StepText.groupTitle(steps))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .lineLimit(1)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(Theme.text)   // 뒤로 버튼을 파란색 대신 본문 색으로
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .modifier(SheetStyle())
    }

    private var list: some View {
        let steps = self.steps
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                    NavigationLink(value: step.id) {
                        StepRow(step: step, isLast: i == steps.count - 1)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("stepRow-\(i)")
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(Theme.bg)
        .accessibilityIdentifier("stepsList")
        .navigationDestination(for: String.self) { id in
            if let s = self.steps.first(where: { $0.id == id }) {
                // 들어간 화면의 dismiss 는 '뒤로'라서, 창 전체를 닫는 함수를 따로 넘긴다
                StepDetailView(step: s, store: store, session: session, onClose: { dismiss() })
            }
        }
    }
}

/// 동그란 X 닫기 버튼
struct CloseCircle: View {
    var id = "stepsClose"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.text)
                .frame(width: 32, height: 32)
                .background(Circle().fill(Theme.surfaceHigh))
        }
        .accessibilityLabel("닫기")
        .accessibilityIdentifier(id)
    }
}

/// 시트 모서리·배경(iOS 16.4 부터)
struct SheetStyle: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) {
            content
                .presentationCornerRadius(28)
                .presentationBackground(Theme.bg)
        } else {
            content
        }
    }
}

/// 목록의 단계 한 줄: 아이콘(아래로 세로 선) · 동사 · +/− · › / 아래에 설명
struct StepRow: View {
    let step: ToolCallInfo
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 6) {
                StepIcon(step: step, size: 17)
                    .foregroundColor(Theme.muted)
                    .frame(width: 26, height: 26)
                if !isLast {
                    Rectangle().fill(Theme.border).frame(width: 1.5).frame(maxHeight: .infinity)
                }
            }
            .frame(width: 26)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(StepText.verb(step))
                        .font(.system(size: Typo.body, weight: .medium))
                        .foregroundColor(Theme.text)
                    if step.state == "running" || step.state == "pending" {
                        ProgressView().scaleEffect(0.7).tint(Theme.muted)
                    }
                    if step.state == "error" {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.muted)
                    }
                    Spacer(minLength: 4)
                    if let st = step.stats { StatsBadge(stats: st) }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.muted)
                }
                .frame(minHeight: 26)
                let sub = StepText.subject(step)
                if !sub.isEmpty {
                    Text(sub)
                        .font(.system(size: Typo.row))
                        .foregroundColor(Theme.muted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(.bottom, isLast ? 4 : 22)
        }
        .contentShape(Rectangle())
    }
}

// MARK: - 단계 상세

struct StepDetailView: View {
    let step: ToolCallInfo
    @ObservedObject var store: ChatStore
    let session: TerminalSession
    /// 목록에서 들어온 화면이면 오른쪽 위에 창 닫기(X)
    var onClose: (() -> Void)? = nil

    private var detail: ToolDetail? { store.details[step.id] }

    /// 아직 진행 중(실행 중인 도구 / 쓰는 중인 생각) → 2초마다 새로 받음
    private var live: Bool {
        step.thinking ? store.isLiveThinking(step.id) : (store.working && !store.hasResult(step.id))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .background(Theme.bg)
        .navigationTitle(StepText.title(step))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .confirmationAction) {
                    CloseCircle(action: onClose)
                }
            }
        }
        .task(id: live) {
            if live {
                while !Task.isCancelled {
                    fetch()
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                }
            } else {
                fetch()   // 처음 열 때, 그리고 진행이 끝난 직후 마지막 내용으로 한 번
            }
        }
        .accessibilityIdentifier("stepDetail")
    }

    private func fetch() {
        session.requestDetail(key: step.id, kind: step.thinking ? "thinking" : "tool", id: step.id, ref: step.ref ?? "")
    }

    @ViewBuilder
    private var content: some View {
        if !step.thinking, let err = detail?.error {
            Label(err, systemImage: "exclamationmark.circle")
                .font(.system(size: Typo.caption + 1))
                .foregroundColor(Theme.muted)
        }
        if step.thinking {
            thinkingContent
        } else {
            // 질문은 아래 '질문' 칸에 전체가 나오므로 제목 줄은 생략
            if !step.desc.isEmpty, !StepText.isFile(step), step.name != "ask_user" {
                Text(step.desc)
                    .font(.system(size: Typo.body, weight: .semibold))
                    .foregroundColor(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            switch step.name {
            case "bash": bashContent
            case "edit": editContent
            case "write": writeContent
            case "read": readContent
            case "ask_user": askContent
            default: otherContent
            }
        }
    }

    // 생각
    @ViewBuilder
    private var thinkingContent: some View {
        if let t = detail?.text {
            if live {
                Label("생각하는 중 — 2초마다 새로 받아요", systemImage: "ellipsis")
                    .font(.system(size: Typo.caption))
                    .foregroundColor(Theme.muted)
            }
            MarkdownView(text: t.isEmpty ? "(아직 내용이 없어요)" : t)
                .accessibilityIdentifier("thinkingText")
        } else if detail?.error == nil {
            loading
        } else {
            Label(detail?.error ?? "", systemImage: "exclamationmark.circle")
                .font(.system(size: Typo.caption + 1))
                .foregroundColor(Theme.muted)
        }
    }

    // 명령
    @ViewBuilder
    private var bashContent: some View {
        section("명령", text: detail?.command ?? step.summary)
        outputSection
    }

    // 수정: 바뀐 부분마다 diff
    @ViewBuilder
    private var editContent: some View {
        pathRow
        if let edits = detail?.edits {
            ForEach(Array(edits.enumerated()), id: \.offset) { i, e in
                VStack(alignment: .leading, spacing: 6) {
                    if edits.count > 1 {
                        Text("바뀐 곳 \(i + 1)")
                            .font(.system(size: Typo.caption, weight: .medium))
                            .foregroundColor(Theme.muted)
                    }
                    DiffView(old: e.old, new: e.new)
                }
            }
        } else if detail == nil {
            loading
        }
        if detail?.isError == true, let out = detail?.output, !out.isEmpty {
            section("오류", text: out, tint: Theme.red)
        }
    }

    // 작성: 전체 내용
    @ViewBuilder
    private var writeContent: some View {
        pathRow
        if let c = detail?.content {
            section("내용", text: c)
        } else if detail == nil {
            loading
        }
        if detail?.isError == true, let out = detail?.output, !out.isEmpty {
            section("오류", text: out, tint: Theme.red)
        }
    }

    // 읽기: 사진이면 사진, 아니면 읽은 내용
    @ViewBuilder
    private var readContent: some View {
        pathRow
        if step.image {
            ToolImageInline(path: "toolimg-\(step.id)", tappable: false)
        } else {
            outputSection
        }
    }

    // 고르는 질문: 질문·선택지 전체와 고른 답(일반 글꼴)
    @ViewBuilder
    private var askContent: some View {
        section("질문", text: detail?.args ?? step.desc, mono: false)
        if let a = step.answer {
            section("답", text: a, mono: false, id: "stepOutput")
        } else {
            outputSection
        }
    }

    @ViewBuilder
    private var otherContent: some View {
        section("입력", text: detail?.args ?? step.summary)
        outputSection
    }

    @ViewBuilder
    private var outputSection: some View {
        let out = detail?.output ?? step.output ?? ""
        let isErr = detail?.isError ?? (step.state == "error")
        if !out.isEmpty {
            section(isErr ? "오류" : "결과", text: out, tint: isErr ? Theme.red : nil, id: "stepOutput")
        } else if live {
            Label("실행 중", systemImage: "hourglass")
                .font(.system(size: Typo.caption + 1))
                .foregroundColor(Theme.muted)
        } else if detail == nil {
            loading
        } else {
            Text("출력 없음")
                .font(.system(size: Typo.caption + 1))
                .foregroundColor(Theme.muted)
        }
    }

    private var pathRow: some View {
        HStack(spacing: 8) {
            Text(detail?.path ?? step.summary)
                .font(.system(size: Typo.code, design: .monospaced))
                .foregroundColor(Theme.text.opacity(0.9))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let st = step.stats { StatsBadge(stats: st) }
        }
    }

    private var loading: some View {
        HStack(spacing: 8) {
            ProgressView().scaleEffect(0.8)
            Text("맥에서 불러오는 중…")
        }
        .font(.system(size: Typo.caption + 1))
        .foregroundColor(Theme.muted)
    }

    /// 제목 + 복사 버튼 + 고정폭 글 상자
    private func section(_ title: String, text: String, tint: Color? = nil, mono: Bool = true, id: String = "stepSection") -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.system(size: Typo.caption, weight: .medium))
                    .foregroundColor(Theme.muted)
                Spacer()
                CopyButton(text: text, label: "\(title) 복사")
            }
            Text(text.isEmpty ? " " : text)
                .font(mono ? .system(size: Typo.codeSmall + 0.5, design: .monospaced) : .system(size: Typo.row - 1))
                .lineSpacing(mono ? 0 : 3)
                .foregroundColor(tint ?? Theme.text.opacity(0.9))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bgElevated))
                .accessibilityIdentifier(id)
        }
    }
}

// MARK: - 줄 단위 비교(diff)

struct DiffView: View {
    let old: String
    let new: String

    enum Line: Hashable {
        case same(String), del(String), add(String)
    }

    var body: some View {
        let lines = Self.diff(old, new)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                row(l)
            }
        }
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bgElevated))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .textSelection(.enabled)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("diffView")
    }

    private func row(_ l: Line) -> some View {
        let (mark, text, fg, bg, axId): (String, String, Color, Color, String) = {
            switch l {
            case .same(let t): return (" ", t, Theme.muted, .clear, "diffSame")
            case .del(let t): return ("−", t, Theme.red, Theme.red.opacity(0.12), "diffDel")
            case .add(let t): return ("+", t, Theme.green, Theme.green.opacity(0.14), "diffAdd")
            }
        }()
        return HStack(alignment: .top, spacing: 6) {
            Text(mark).frame(width: 12)
            Text(text.isEmpty ? " " : text)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: Typo.codeSmall + 0.5, design: .monospaced))
        .foregroundColor(fg)
        .padding(.horizontal, 10)
        .padding(.vertical, 1)
        .background(bg)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(axId)
    }

    /// 가장 긴 공통 줄을 기준으로 지운 줄·더한 줄을 나눈다. 너무 크면 통째로(지움 → 더함).
    static func diff(_ a: String, _ b: String) -> [Line] {
        let x = a.components(separatedBy: "\n")
        let y = b.components(separatedBy: "\n")
        let n = x.count, m = y.count
        if n * m > 250_000 { return x.map { .del($0) } + y.map { .add($0) } }
        var dp = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        if n > 0, m > 0 {
            for i in stride(from: n - 1, through: 0, by: -1) {
                for j in stride(from: m - 1, through: 0, by: -1) {
                    dp[i][j] = x[i] == y[j] ? dp[i + 1][j + 1] + 1 : max(dp[i + 1][j], dp[i][j + 1])
                }
            }
        }
        var out: [Line] = []
        var i = 0, j = 0
        while i < n, j < m {
            if x[i] == y[j] { out.append(.same(x[i])); i += 1; j += 1 }
            else if dp[i + 1][j] >= dp[i][j + 1] { out.append(.del(x[i])); i += 1 }
            else { out.append(.add(y[j])); j += 1 }
        }
        while i < n { out.append(.del(x[i])); i += 1 }
        while j < m { out.append(.add(y[j])); j += 1 }
        return out
    }
}

// MARK: - 작은 부품

/// "+73 −0" (초록·빨강 반쪽 알약)
struct StatsBadge: View {
    let stats: ChangeStats

    var body: some View {
        HStack(spacing: 0) {
            Text("+\(stats.added)")
                .foregroundColor(Theme.green)
                .padding(.horizontal, 7)
                .background(Theme.green.opacity(0.16))
            Text("−\(stats.removed)")
                .foregroundColor(Theme.red)
                .padding(.horizontal, 7)
                .background(Theme.red.opacity(0.14))
        }
        .font(.system(size: Typo.caption, weight: .medium).monospacedDigit())
        .padding(.vertical, 0)
        .frame(height: 22)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("statsBadge")
    }
}

/// 단계 아이콘(명령은 Claude 앱처럼 ">_")
struct StepIcon: View {
    let step: ToolCallInfo
    var size: CGFloat = Typo.row - 1

    var body: some View {
        if step.thinking {
            Image(systemName: "lightbulb").font(.system(size: size, weight: .regular))
        } else if step.name == "bash" {
            Text(">_").font(.system(size: size - 1, weight: .semibold, design: .monospaced))
        } else {
            Image(systemName: StepText.symbol(step.name)).font(.system(size: size, weight: .regular))
        }
    }
}

/// 단계 문구
enum StepText {
    static func symbol(_ name: String) -> String {
        switch name {
        case "read": return "eye"
        case "edit": return "pencil.line"
        case "write": return "doc.badge.plus"
        case "grep", "find": return "magnifyingglass"
        case "ls": return "folder"
        case "subagent": return "person.2"
        case "ask_user": return "questionmark.bubble"
        case "show_artifact": return "doc.richtext"
        case "todo_write": return "checklist"
        default: return "wrench.and.screwdriver"
        }
    }

    /// 끝난 단계의 동사
    static func verb(_ s: ToolCallInfo) -> String {
        if s.thinking { return "생각함" }
        switch s.name {
        case "bash": return "실행됨"
        case "read": return "읽음"
        case "edit": return "수정됨"
        case "write": return "작성됨"
        case "grep": return "검색함"
        case "find": return "찾음"
        case "ls": return "확인함"
        case "subagent": return "맡김"
        case "ask_user": return "물어봄"
        case "show_artifact": return "아티팩트"
        case "todo_write": return "할 일 정리"
        default: return s.name
        }
    }

    /// 진행 중인 단계의 동사
    static func runningVerb(_ s: ToolCallInfo) -> String {
        switch s.name {
        case "read": return "읽는 중"
        case "edit": return "수정 중"
        case "write": return "작성 중"
        case "grep", "find": return "검색 중"
        case "subagent": return "맡긴 일 진행 중"
        case "ask_user": return "답을 기다리는 중"
        case "show_artifact": return "아티팩트 준비 중"
        case "todo_write": return "할 일 정리 중"
        default: return "실행 중"
        }
    }

    static func isFile(_ s: ToolCallInfo) -> Bool { ["read", "edit", "write"].contains(s.name) }

    /// 동사 뒤에 붙는 말: 파일이면 파일 이름, 아니면 한 줄 설명(없으면 요약)
    static func subject(_ s: ToolCallInfo) -> String {
        if isFile(s), !s.summary.isEmpty { return (s.summary as NSString).lastPathComponent }
        if s.name == "ask_user" { return s.answer.map { "\(s.desc) → \($0)" } ?? s.desc }
        if !s.desc.isEmpty { return s.desc }
        return s.summary.components(separatedBy: "\n").first ?? ""
    }

    /// 상세 화면 제목
    static func title(_ s: ToolCallInfo) -> String {
        if s.thinking { return "생각" }
        let sub = isFile(s) ? subject(s) : ""
        return sub.isEmpty ? verb(s) : "\(verb(s)) \(sub)"
    }

    /// 단계 목록 창 제목
    static func groupTitle(_ steps: [ToolCallInfo]) -> String {
        let tools = steps.filter { !$0.thinking }
        if tools.isEmpty { return "생각" }
        if tools.count == 1 { return title(tools[0]) }
        return groupLabel(tools)
    }

    /// "파일 2개 수정함, 명령어 5개 실행함" (처음 나온 순서대로, 파일은 같은 파일을 한 번만 셈)
    static func groupLabel(_ tools: [ToolCallInfo]) -> String {
        var order: [String] = []
        var counts: [String: Int] = [:]
        var files: [String: Set<String>] = [:]
        for t in tools {
            let k: String
            switch t.name {
            case "bash", "read", "edit", "write", "ls", "subagent": k = t.name
            case "grep", "find": k = "search"
            case "ask_user": k = "ask"
            default: k = "other"
            }
            if counts[k] == nil { order.append(k) }
            counts[k, default: 0] += 1
            files[k, default: []].insert(t.summary.isEmpty ? t.id : t.summary)
        }
        return order.map { k -> String in
            let n = counts[k] ?? 0
            let f = files[k]?.count ?? n
            switch k {
            case "bash": return "명령어 \(n)개 실행함"
            case "read": return "파일 \(f)개 읽음"
            case "edit": return "파일 \(f)개 수정함"
            case "write": return "파일 \(f)개 작성함"
            case "search": return "\(n)번 검색함"
            case "ls": return "폴더 \(f)개 확인함"
            case "subagent": return "하위 작업 \(n)개 맡김"
            case "ask": return "\(n)번 물어봄"
            default: return "도구 \(n)개 사용함"
            }
        }.joined(separator: ", ")
    }

    /// 파일 도구들의 늘어난·줄어든 줄 합계(파일 도구가 없으면 nil)
    static func totalStats(_ tools: [ToolCallInfo]) -> ChangeStats? {
        let list = tools.compactMap(\.stats)
        if list.isEmpty { return nil }
        return ChangeStats(added: list.map(\.added).reduce(0, +), removed: list.map(\.removed).reduce(0, +))
    }
}
