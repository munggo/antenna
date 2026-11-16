import SwiftUI
import UIKit

/// 맥 pi 가 승인을 기다리는 동작(send-guard 확장이 보냄)
struct ApprovalItem: Codable, Identifiable, Equatable {
    let id: String
    let kind: String        // send: 사람에게 보내기 / danger: 위험 명령
    let label: String       // 무엇을 하는지(예: Slack 메시지 보내기)
    let to: String?         // 받는 곳(있으면)
    let detail: String      // 보낼 내용 또는 명령 전체
    let since: Double?      // 요청 시각(ms)
    var task: String? = nil      // 사용자가 맡긴 작업(마지막 메시지)
    var intent: String? = nil    // 명령 직전 pi 의 설명
    var note: String? = nil      // 명령 첫 줄 주석
    var purpose: String? = nil   // 하려는 일(명령 설명 → pi 설명 첫 문장)
    var guessed: Bool? = nil     // 명령 글자로 추정한 보내기(확정 아님)
    var display: String? = nil   // MCP 입력의 읽기 쉬운 항목(받는 곳·내용 등, JSON 대신)
    var codeLike: Bool? = nil    // 보낼 내용이 JSON·코드(그대로 보이지 않고 요약으로)
    var source: String? = nil    // bash | mcp | approval
    var risk: String? = nil      // 위험도 상·중·하(걸린 이유로 정하고, Opus 가 내용을 보고 바꿀 수 있음)
    var scripts: [ApprovalScript]? = nil   // 명령이 실행하는 스크립트
    var summary: String? = nil   // 주의 한 문장(Opus, 나중에 채워짐)
    var headline: String? = nil  // 무엇을 하는 명령인지 한 문장(Opus, 나중에 채워짐)
    var summarizing: Bool? = nil
}

struct ApprovalScript: Codable, Equatable, Hashable {
    let path: String
    let lines: Int
    let content: String
    let truncated: Bool
}

/// 입력창 위 승인 카드: 무엇을 · 어디로 · 내용(눌러서 펼침) · [거부] [허용]
struct ApprovalCard: View {
    let item: ApprovalItem
    /// 기다리는 승인 수(이 카드 포함). 2 이상이면 머리에 '1/N'
    var waiting: Int = 1
    let answer: (Bool) -> Void
    @State private var expanded = false
    @State private var openScripts: Set<String> = []
    @State private var contentExpanded = false
    @State private var middleHeight: CGFloat = 0

    private var isSend: Bool { item.kind == "send" }
    /// 카드에 그대로 보일 글: MCP 는 읽기 쉬운 항목, 사람에게 보낼 보통 글은 그대로. 명령·JSON·코드는 요약만
    private var contentText: String? {
        if let d = item.display, !d.isEmpty { return d }
        if isSend, item.guessed != true, item.codeLike != true { return item.detail }
        return nil
    }
    /// 원본(명령·JSON)을 접어 둔 단추가 필요한지
    private var hasHiddenRaw: Bool { contentText != item.detail }

    private var detailText: some View {
        Text(item.detail.isEmpty ? " " : item.detail)
            .font(.system(size: Typo.codeSmall + 0.5, design: .monospaced))
            .foregroundColor(Theme.text.opacity(0.9))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
    }
    private var tint: Color { isSend ? Theme.accent : Theme.red }
    private func riskColor(_ r: String) -> Color { r == "상" ? Theme.red : r == "중" ? Theme.accent : Theme.muted }

    private var middle: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 가운데: 무엇을 하는 명령인지 한 문장(Opus). 나오기 전에는 하려는 일, 아래에 걸린 이유 · 하려는 일
            let sentence = item.headline ?? ""
            let purpose = item.purpose ?? ""
            VStack(alignment: .leading, spacing: 5) {
                if !sentence.isEmpty {
                    Text(sentence)
                        .font(.system(size: Typo.row, weight: .medium))
                        .foregroundColor(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("approvalHeadline")
                    if let note = item.summary, !note.isEmpty {
                        Text(note)
                            .font(.system(size: Typo.row - 2))
                            .foregroundColor(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("approvalSummary")
                    }
                } else {
                    Text(purpose.isEmpty ? item.label : purpose)
                        .font(.system(size: Typo.row, weight: .medium))
                        .foregroundColor(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    if item.summarizing == true {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.mini)
                            Text("설명을 쓰는 중…").font(.system(size: Typo.caption + 1)).foregroundColor(Theme.muted)
                        }
                        .accessibilityIdentifier("approvalSummarizing")
                    }
                }
                // 걸린 이유 · 하려는 일(작게)
                Text([item.label + (item.guessed == true ? "(글자로 판단)" : ""), sentence.isEmpty ? "" : purpose]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: Typo.caption + 1))
                    .foregroundColor(tint.opacity(0.9))
                    .lineLimit(2)
                    .accessibilityIdentifier("approvalPurpose")
                if let to = item.to, !to.isEmpty {
                    Text("받는 곳: \(to)")
                        .font(.system(size: Typo.caption + 1))
                        .foregroundColor(Theme.muted)
                }
            }
            if let c = contentText {
                // 사람에게 보낼 글·MCP 의 읽기 쉬운 항목: 그대로(접히면 6줄, 누르면 전체)
                Text(c)
                    .font(.system(size: Typo.row - 1))
                    .lineSpacing(2)
                    .foregroundColor(Theme.text.opacity(0.92))
                    .lineLimit(contentExpanded ? nil : 6)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bgElevated))
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(.easeOut(duration: 0.18)) { contentExpanded.toggle() } }
                    .accessibilityIdentifier("approvalContent")
            }
            if hasHiddenRaw {
                // 명령·JSON·코드: 핵심(요약)만 보이고, 원본은 눌러야 펼침
                Button { withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 11, weight: .semibold))
                        Text(expanded ? (item.source == "bash" ? "명령 접기" : "원본 접기")
                             : "\(item.source == "bash" ? "명령 보기" : "원본 보기")\((item.scripts ?? []).isEmpty ? "" : " · 스크립트 \((item.scripts ?? []).count)개")")
                            .font(.system(size: Typo.caption + 1, weight: .medium))
                        Spacer(minLength: 0)
                    }
                    .foregroundColor(Theme.muted)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("approvalShowCode")
                if expanded {
                    detailText
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bgElevated))
                        .accessibilityIdentifier("approvalDetail")
                    ForEach(item.scripts ?? [], id: \.path) { sc in scriptRow(sc) }
                }
            }
        }
    }

    /// 실행하는 스크립트: 누르면 전문
    private func scriptRow(_ sc: ApprovalScript) -> some View {
        let open = openScripts.contains(sc.path)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 11, weight: .semibold))
                Text("📄 \(sc.path) · \(sc.lines)줄\(sc.truncated ? "(앞부분)" : "")")
                    .font(.system(size: Typo.caption + 1, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.head)
                Spacer(minLength: 0)
            }
            .foregroundColor(Theme.text)
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.easeOut(duration: 0.18)) {
                    if open { openScripts.remove(sc.path) } else { openScripts.insert(sc.path) }
                }
            }
            if open {
                ScrollView([.vertical, .horizontal]) {
                    Text(sc.content)
                        .font(.system(size: Typo.codeSmall, design: .monospaced))
                        .foregroundColor(Theme.text.opacity(0.9))
                        .textSelection(.enabled)
                        .padding(10)
                }
                .frame(height: 260)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.bgElevated))
            }
        }
        .accessibilityIdentifier("approvalScript")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                // 위험도 색 동그라미 + '승인이 필요합니다 (중)'(사용자 결정: 이모지 대신 동그라미, 위험도는 괄호)
                let r = item.risk ?? ""
                Circle()
                    .fill(r.isEmpty ? tint : riskColor(r))
                    .frame(width: 9, height: 9)
                (Text("승인이 필요합니다").foregroundColor(Theme.text)
                    + Text(r.isEmpty ? "" : " (\(r))").foregroundColor(riskColor(r)))
                    .font(.system(size: Typo.row, weight: .semibold))
                    .accessibilityIdentifier("approvalRisk")
                Spacer(minLength: 0)
                if waiting > 1 {
                    Text("1/\(waiting)")
                        .font(.system(size: Typo.caption + 1, weight: .semibold))
                        .foregroundColor(Theme.muted)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(Theme.bgElevated))
                        .accessibilityIdentifier("approvalQueue")
                }
            }
            // 가운데(무엇·맥락·요약·명령·스크립트): 길면 카드 안에서 스크롤(화면 절반까지)
            ScrollView {
                middle
                    .background(GeometryReader { g in
                        Color.clear.preference(key: ApprovalHeightKey.self, value: g.size.height)
                    })
            }
            .cardScrollHeight(min(max(middleHeight, 40), UIScreen.main.bounds.height * 0.45))
            .onPreferenceChange(ApprovalHeightKey.self) { middleHeight = $0 }
            .accessibilityIdentifier("approvalScroll")

            HStack(spacing: 10) {
                Button { answer(false) } label: {
                    Text("거부")
                        .font(.system(size: Typo.row, weight: .medium))
                        .foregroundColor(Theme.text)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(Capsule().fill(Theme.surface))
                        .overlay(Capsule().stroke(Theme.border))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("approvalDeny")
                Button { answer(true) } label: {
                    Text("허용")
                        .font(.system(size: Typo.row, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(Capsule().fill(tint))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("approvalAllow")
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceHigh))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(tint.opacity(0.55)))
        .onAppear { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approvalCard")
    }
}

private struct ApprovalHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
