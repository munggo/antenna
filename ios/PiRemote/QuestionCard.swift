import SwiftUI
import UIKit

/// pi 가 고르게 묻는 질문의 선택지
struct QuestionOption: Codable, Equatable, Hashable {
    let label: String
    let description: String?
}

/// pi 가 사용자에게 고르게 묻는 질문(ask-user 확장이 보냄)
/// kind 가 있으면 pi 확인 창(다른 확장·pi 가 띄운 select·confirm·input)을 피드가 중계한 것
struct QuestionItem: Codable, Identifiable, Equatable {
    let id: String
    let question: String
    let options: [QuestionOption]
    let multiSelect: Bool?
    let since: Double?
    var kind: String? = nil
    var placeholder: String? = nil
    /// 여러 질문을 한 번에(ask_user questions)
    var items: [QuestionSub]? = nil

    var multi: Bool { multiSelect ?? false }
    var isMulti: Bool { !(items ?? []).isEmpty }
    /// pi 확인 창이면 취소할 수 있음
    var isPrompt: Bool { kind != nil }
    /// 입력창에 쓴 글을 답으로 받는지(고르기 질문의 '기타', 글 입력 창). 여러 질문은 카드 안 칸에 씀
    var allowsOther: Bool { (kind == nil && !isMulti) || kind == "input" }
}

/// 여러 질문 중 하나
struct QuestionSub: Codable, Equatable {
    let question: String
    let options: [QuestionOption]
    let multiSelect: Bool?
}

/// 여러 질문 카드: 한 번에 질문 하나(맥 번호 상자와 같은 흐름)
/// - 하나 고르기: 누르면 바로 다음 질문, 마지막 질문이면 바로 보냄
/// - 여러 개 고르기·'기타' 입력: 고른 뒤 [다음](키보드 리턴도)으로 넘김
/// - [이전]으로 앞 질문에 돌아가 답을 바꿀 수 있음(고른 답은 남아 있음)
struct MultiQuestionCard: View {
    let item: QuestionItem
    let compact: Bool
    /// 질문별 답: [["answers": [String], "other": String]]
    let submit: ([[String: Any]]) -> Void
    @State private var picks: [Set<Int>] = []
    @State private var others: [String] = []
    @State private var step = 0
    @State private var forward = true   // 넘기는 방향(화면 전환 방향)
    @State private var sent = false
    @State private var contentHeight: CGFloat = 0
    /// 카드 안 '기타' 칸에 쓰는 중인 질문 번호(키보드가 올라와 있음)
    @FocusState private var otherFocus: Int?

    private var subs: [QuestionSub] { item.items ?? [] }
    private var cap: CGFloat {
        let screen = UIScreen.main.bounds.height
        return (compact || otherFocus != nil) ? min(220, screen * 0.25) : screen * 0.55
    }
    private var isLast: Bool { step >= subs.count - 1 }
    private func answered(_ i: Int) -> Bool {
        i < picks.count && (!picks[i].isEmpty || !others[i].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "questionmark.bubble.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.accent)
                Text("질문 \(min(step, max(subs.count - 1, 0)) + 1)/\(subs.count)")
                    .font(.system(size: Typo.row, weight: .semibold))
                    .foregroundColor(Theme.text)
                    .accessibilityIdentifier("questionStep")
                Spacer(minLength: 0)
                // 진행 점: 지금 질문은 길게, 답한 질문은 주황
                HStack(spacing: 5) {
                    ForEach(subs.indices, id: \.self) { i in
                        Capsule()
                            .fill(i == step || answered(i) ? Theme.accent : Theme.muted.opacity(0.35))
                            .frame(width: i == step ? 16 : 6, height: 6)
                    }
                }
            }
            if subs.indices.contains(step) {
                ScrollViewReader { proxy in
                    ScrollView {
                        block(step, subs[step])
                            .id(step)
                            .transition(.asymmetric(insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                                                    removal: .opacity))
                            .background(GeometryReader { g in
                                Color.clear.preference(key: MultiHeightKey.self, value: g.size.height)
                            })
                    }
                    // 자리가 모자라면(키보드) 스크롤 칸이 줄어들어 아래 버튼이 키보드에 가리지 않게
                    .cardScrollHeight(min(max(contentHeight, 60), cap))
                    .onPreferenceChange(MultiHeightKey.self) { contentHeight = $0 }
                    .onChange(of: otherFocus) { f in
                        guard let f else { return }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("mq-other-\(f)", anchor: .bottom) }
                        }
                    }
                }
                .clipped()
                .accessibilityIdentifier("questionScroll")
            }
            HStack(spacing: 10) {
                if step > 0 {
                    Button { go(step - 1) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left").font(.system(size: 13, weight: .semibold))
                            Text("이전").font(.system(size: Typo.row, weight: .medium))
                        }
                        .foregroundColor(Theme.text)
                        .padding(.horizontal, 16)
                        .frame(height: 40)
                        .background(Capsule().fill(Theme.bgElevated))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("questionPrev")
                }
                Spacer(minLength: 0)
                Button { next() } label: {
                    HStack(spacing: 4) {
                        Text(isLast ? "보내기" : "다음").font(.system(size: Typo.row, weight: .semibold))
                        if !isLast { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)) }
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .background(Capsule().fill(Theme.accent.opacity(answered(step) ? 1 : 0.4)))
                }
                .buttonStyle(.plain)
                .disabled(!answered(step) || sent)
                .accessibilityIdentifier(isLast ? "questionSubmit" : "questionNext")
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceHigh))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.accent.opacity(0.55)))
        .onAppear {
            if picks.count != subs.count {
                picks = Array(repeating: [], count: subs.count)
                others = Array(repeating: "", count: subs.count)
                step = 0
            }
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("questionCard")
    }

    private func go(_ i: Int) {
        guard subs.indices.contains(i) else { return }
        otherFocus = nil
        forward = i > step
        withAnimation(.easeInOut(duration: 0.22)) { step = i }
    }

    /// 다음 질문으로, 마지막이면 보냄(답 안 한 질문이 남아 있으면 그 질문으로)
    private func next() {
        guard answered(step), !sent else { return }
        if !isLast { go(step + 1); return }
        if let miss = subs.indices.first(where: { !answered($0) }) { go(miss); return }
        sent = true
        otherFocus = nil
        submit(subs.indices.map { i in
            ["answers": picks[i].sorted().compactMap { subs[i].options.indices.contains($0) ? subs[i].options[$0].label : nil },
             "other": others[i].trimmingCharacters(in: .whitespacesAndNewlines)] as [String: Any]
        })
    }

    private func block(_ i: Int, _ sub: QuestionSub) -> some View {
        let multi = sub.multiSelect ?? false
        return VStack(alignment: .leading, spacing: 6) {
            Text(MarkdownParser.inline(sub.question))
                .font(.system(size: Typo.row, weight: .semibold))
                .foregroundColor(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("mq-\(i)-question")
            if multi {
                Text("여러 개 고를 수 있어요")
                    .font(.system(size: Typo.caption + 1))
                    .foregroundColor(Theme.muted)
            }
            ForEach(Array(sub.options.enumerated()), id: \.offset) { j, o in
                let on = i < picks.count && picks[i].contains(j)
                Button {
                    guard i < picks.count, !sent else { return }
                    if multi {
                        if on { picks[i].remove(j) } else { picks[i].insert(j) }
                        UISelectionFeedbackGenerator().selectionChanged()
                    } else {
                        // 하나 고르기: 고른 것을 잠깐 보여 준 뒤 다음 질문(마지막이면 보냄)
                        picks[i] = [j]
                        UISelectionFeedbackGenerator().selectionChanged()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { if step == i { next() } }
                    }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: multi ? (on ? "checkmark.square.fill" : "square") : (on ? "largecircle.fill.circle" : "circle"))
                            .font(.system(size: 17))
                            .foregroundColor(on ? Theme.accent : Theme.muted)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(MarkdownParser.inline(o.label))
                                .font(.system(size: Typo.row, weight: .medium))
                                .foregroundColor(Theme.text)
                            if let d = o.description, !d.isEmpty {
                                Text(MarkdownParser.inline(d))
                                    .font(.system(size: Typo.caption + 1))
                                    .foregroundColor(Theme.muted)
                            }
                        }
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bgElevated))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Theme.accent : Theme.border.opacity(0.6)))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("mq-\(i)-\(j)")
            }
            // 기타: 한 줄로 쓰고 리턴이면 다음(마지막이면 보냄)
            TextField("기타(직접 입력)", text: Binding(
                get: { i < others.count ? others[i] : "" },
                set: { if i < others.count { others[i] = $0 } }
            ))
                .font(.system(size: Typo.row - 1))
                .submitLabel(isLast ? .send : .next)
                .onSubmit { next() }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border.opacity(0.6)))
                .focused($otherFocus, equals: i)
                .id("mq-other-\(i)")
                .accessibilityIdentifier("mq-\(i)-other")
        }
    }
}

extension View {
    /// 카드 안 스크롤 칸: 자리가 넉넉하면 이 높이, 모자라면(키보드가 올라옴) 56pt 까지 줄어든다.
    /// 고정 높이였을 때는 카드가 화면을 넘쳐 아래 버튼이 키보드 뒤로 숨었다
    func cardScrollHeight(_ h: CGFloat) -> some View {
        frame(minHeight: min(h, 56), maxHeight: h)
    }
}

private struct MultiHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// 입력창 위 질문 카드(Claude 앱 방식)
/// - 하나 고르기: 선택지를 누르면 바로 답
/// - 여러 개 고르기: 체크한 뒤 [보내기]
/// - 기타: 입력창에 직접 써서 보내면 그 글이 답
/// 질문·선택지가 길면 카드 안에서 스크롤한다(키보드가 올라오면 더 낮게).
struct QuestionCard: View {
    let item: QuestionItem
    /// 체크한 선택지 번호(여러 개 고르기)
    @Binding var picked: Set<Int>
    /// 키보드가 올라와 있으면 카드를 낮게(입력창이 가려지지 않게)
    let compact: Bool
    let answer: ([String]) -> Void
    let other: () -> Void
    /// pi 확인 창 취소
    var cancel: () -> Void = {}
    @State private var contentHeight: CGFloat = 0

    /// 체크한 것을 선택지 순서대로
    private var ordered: [String] { picked.sorted().compactMap { item.options.indices.contains($0) ? item.options[$0].label : nil } }
    /// 카드 안 스크롤 영역의 최대 높이
    private var cap: CGFloat {
        let screen = UIScreen.main.bounds.height
        return compact ? min(170, screen * 0.2) : screen * 0.5
    }
    private var overflow: Bool { contentHeight > cap + 1 }

    /// 질문 첫 줄은 제목처럼(길면 보통 굵기), 나머지는 본문
    private var questionParts: (title: String, rest: String) {
        let parts = item.question.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        let title = parts.first.map(String.init) ?? ""
        let rest = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines) : ""
        return (title, rest)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    header
                    if item.kind == "confirm" {
                        confirmRow
                    } else {
                        VStack(spacing: 6) {
                            ForEach(Array(item.options.enumerated()), id: \.offset) { i, o in
                                optionRow(i, o)
                            }
                            if item.allowsOther { otherRow }
                        }
                    }
                }
                .padding(.bottom, overflow ? 16 : 0)   // 끝까지 내리면 마지막 줄이 흐림에 가리지 않게
                .background(GeometryReader { g in
                    Color.clear.preference(key: ContentHeightKey.self, value: g.size.height)
                })
            }
            .accessibilityIdentifier("questionScroll")
            .cardScrollHeight(min(max(contentHeight, 44), cap))
            .onPreferenceChange(ContentHeightKey.self) { contentHeight = $0 }
            .bounceOnlyWhenScrollable()
            // 아래에 더 있음을 알리는 흐림
            .overlay(alignment: .bottom) {
                if overflow {
                    LinearGradient(colors: [Theme.surfaceHigh.opacity(0), Theme.surfaceHigh],
                                   startPoint: .top, endPoint: .bottom)
                        .frame(height: 22)
                        .allowsHitTesting(false)
                }
            }

            if item.multi {
                Button { answer(ordered) } label: {
                    Text(picked.isEmpty ? "골라 주세요" : "보내기(\(picked.count)개)")
                        .font(.system(size: Typo.row, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(Capsule().fill(Theme.accent.opacity(picked.isEmpty ? 0.4 : 1)))
                }
                .buttonStyle(.plain)
                .disabled(picked.isEmpty)
                .accessibilityIdentifier("questionSubmit")
            }
            if item.isPrompt { cancelRow }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceHigh))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.accent.opacity(0.55)))
        .onAppear { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("questionCard")
    }

    private var header: some View {
        let q = questionParts
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "questionmark.bubble.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.accent)
                    .padding(.top, 2)
                Text(MarkdownParser.inline(q.title))
                    .font(.system(size: Typo.row, weight: q.title.count > 100 ? .regular : .semibold))
                    .foregroundColor(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            if !q.rest.isEmpty {
                Text(MarkdownParser.inline(q.rest))
                    .font(.system(size: Typo.row - 1))
                    .lineSpacing(3)
                    .foregroundColor(Theme.text.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if item.multi {
                Text("여러 개 고를 수 있어요")
                    .font(.system(size: Typo.caption + 1))
                    .foregroundColor(Theme.muted)
            }
            if item.kind == "input" {
                Text("아래 입력창에 써서 보내 주세요")
                    .font(.system(size: Typo.caption + 1))
                    .foregroundColor(Theme.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("questionText")
    }

    private func optionRow(_ i: Int, _ o: QuestionOption) -> some View {
        let on = picked.contains(i)
        return Button {
            if item.multi {
                if on { picked.remove(i) } else { picked.insert(i) }
                UISelectionFeedbackGenerator().selectionChanged()
            } else {
                answer([o.label])
            }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                if item.multi {
                    Image(systemName: on ? "checkmark.square.fill" : "square")
                        .font(.system(size: 18))
                        .foregroundColor(on ? Theme.accent : Theme.muted)
                } else {
                    Text("\(i + 1)")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundColor(Theme.muted)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Theme.surface))
                }
                // 긴 선택지도 자르지 않고 전부 보여 줌
                VStack(alignment: .leading, spacing: 3) {
                    Text(MarkdownParser.inline(o.label))
                        .font(.system(size: Typo.row, weight: .medium))
                        .lineSpacing(2)
                        .foregroundColor(Theme.text)
                    if let d = o.description, !d.isEmpty {
                        Text(MarkdownParser.inline(d))
                            .font(.system(size: Typo.caption + 1))
                            .lineSpacing(2)
                            .foregroundColor(Theme.muted)
                    }
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bgElevated))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(on ? Theme.accent : Theme.border.opacity(0.6)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("questionOption-\(i)")
    }

    /// 기타: 입력창으로 가서 직접 쓰기
    private var otherRow: some View {
        Button(action: other) {
            HStack(spacing: 10) {
                Image(systemName: "pencil")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.muted)
                    .frame(width: 22, height: 22)
                Text(item.kind == "input" ? "입력해서 답하기" : "기타(직접 입력)")
                    .font(.system(size: Typo.row))
                    .foregroundColor(Theme.muted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border.opacity(0.6)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("questionOther")
    }
}

extension QuestionCard {
    /// 예/아니오 창: 버튼 두 개(아니오 · 예)
    fileprivate var confirmRow: some View {
        HStack(spacing: 8) {
            ForEach(Array(item.options.enumerated()).reversed(), id: \.offset) { i, o in
                let yes = i == 0
                Button { answer([o.label]) } label: {
                    Text(o.label)
                        .font(.system(size: Typo.row, weight: .semibold))
                        .foregroundColor(yes ? .white : Theme.text)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(Capsule().fill(yes ? Theme.accent : Theme.bgElevated))
                        .overlay(Capsule().stroke(yes ? Color.clear : Theme.border.opacity(0.6)))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("questionOption-\(i)")
            }
        }
    }

    /// pi 확인 창 취소(맥에서 Esc 를 누른 것과 같음)
    fileprivate var cancelRow: some View {
        Button(action: cancel) {
            Text("취소")
                .font(.system(size: Typo.row - 1))
                .foregroundColor(Theme.muted)
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("questionCancel")
    }
}

private struct ContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private extension View {
    /// 내용이 넘칠 때만 튕기기(iOS 16.4 부터)
    @ViewBuilder func bounceOnlyWhenScrollable() -> some View {
        if #available(iOS 16.4, *) { scrollBounceBehavior(.basedOnSize) } else { self }
    }
}
