import SwiftUI
import UIKit

/// 긴 것을 접는 기준(사용자 결정 11-18: 화면 2장을 넘으면 반 장만 보이고 '더 보기').
/// '화면 한 장'은 대화가 보이는 높이의 어림이다: 화면 높이에서 위 머리줄과 아래 입력창을 뺀 만큼(4분의 3).
enum Fold {
    static var page: CGFloat { UIScreen.main.bounds.height * 0.75 }
    static var limit: CGFloat { page * 2 }       // 이보다 길면 접는다
    static var folded: CGFloat { page * 0.5 }    // 접힌 높이

    /// 코드 블록은 줄이 넘어가지 않아(옆으로 밀어 봄) 높이를 재지 않고 줄 수로 센다
    static let codeLineHeight = UIFont.monospacedSystemFont(ofSize: Typo.code, weight: .regular).lineHeight
    static var codeLimitLines: Int { Int(limit / codeLineHeight) }
    static var codeFoldedLines: Int { Int(folded / codeLineHeight) }

    static func lineCount(_ s: String) -> Int {
        s.utf8.reduce(1) { $1 == 10 ? $0 + 1 : $0 }
    }

    /// 앞의 n줄만(줄 수와 같은 기준으로 세려고 글자가 아니라 바이트로 줄바꿈을 찾는다)
    static func firstLines(_ s: String, _ n: Int) -> String {
        var left = n
        let bytes = s.utf8
        for i in bytes.indices where bytes[i] == 10 {
            left -= 1
            if left == 0 { return String(s[..<i]) }
        }
        return s
    }

    /// 글자 수와 줄 수로 싸게 어림한 길이(실제 높이는 그려야 안다)
    enum Guess {
        case short   // 길 리 없음 → 높이를 재지 않고 그대로 그린다
        case maybe   // 길 수도 있음 → 펼친 채 그려서 재 보고, 길면 접는다
        case long    // 거의 틀림없이 긺 → 접힌 채 그리기 시작한다(재 보고 짧으면 편다)
    }

    /// 그 글이 `limit` 보다 길게 그려질지 어림한다. 대화의 글은 거의 다 짧은데 그 수백 개에 높이를 재는 장치를 달면 대화를 여는 것이
    /// 느려지고(시뮬레이터에서 메시지 400개에 17%), 긴 글을 다 펼쳐 그린 뒤에 접으면 대화 전체를 한 번 더 배치하게 된다.
    /// - inset: 화면 폭에서 빠지는 양옆 여백  - perLine: 화면 한 줄의 높이(문단 사이 간격까지 넉넉히)
    static func guess(_ limit: CGFloat, _ text: String, inset: CGFloat, fontSize: CGFloat, perLine: CGFloat) -> Guess {
        // 한 줄에 들어가는 글자 수는 적게 잡는다: 기기의 짧은 변에서, 가장 넓은 글자(한글)보다 30% 넓다고 치고
        let width = min(UIScreen.main.bounds.width, UIScreen.main.bounds.height) - inset
        let perRow = max(1, Int(width / (fontSize * 1.3)))
        let height = CGFloat(text.utf16.count / perRow + lineCount(text)) * perLine   // 넉넉히 잡은 높이(실제의 1.5배쯤)
        // 기준의 60%만 돼도 재기 시작한다(쓰는 중인 글이 기준을 넘기 전에 미리)
        return height <= limit * 0.6 ? .short : height <= limit * 1.6 ? .maybe : .long
    }

    /// 답 글(마크다운): 블록마다 간격이 있어 한 줄을 넉넉히 친다. 그림이 들어갈 수 있는 글(사진 경로)은 글자 수로 알 수 없으니 재 본다
    static func guessAnswer(_ text: String) -> Guess {
        let g = guess(limit, text, inset: 32, fontSize: Typo.body, perLine: 48)
        return g == .short && text.contains("/.cache/pi-remote/img-") ? .maybe : g
    }

    /// 내 메시지(말풍선 안의 글 한 덩어리)
    static func guessBubble(_ text: String) -> Guess {
        guess(limit, text, inset: 108, fontSize: Typo.body, perLine: 28)
    }
}

/// 접고 펼친 것을 대화 화면에 알리는 통로(객체 참조라 바뀌지 않음 → 대화 항목을 다시 그리지 않음).
/// 대화 화면은 접으면 그 자리로 스크롤하고(접은 것이 화면 위로 사라지지 않게), 펼치면 새 내용을 따라 맨 아래로 가던 것을 멈춘다(읽는 중이라).
final class FoldEvents: ObservableObject {
    struct Event: Equatable {
        let anchor: UUID
        let expanded: Bool
        let seq: Int
    }
    @Published private(set) var last: Event?
    private var seq = 0

    func send(anchor: UUID, expanded: Bool) {
        seq += 1
        last = Event(anchor: anchor, expanded: expanded, seq: seq)
    }
}

private struct FoldEventsKey: EnvironmentKey {
    static let defaultValue: FoldEvents? = nil
}

extension EnvironmentValues {
    var foldEvents: FoldEvents? {
        get { self[FoldEventsKey.self] }
        set { self[FoldEventsKey.self] = newValue }
    }
}

/// '더 보기'·'접기' 버튼(접힌 것 아래, 펼친 것 끝에)
struct FoldToggle: View {
    let collapsed: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: collapsed ? "chevron.down" : "chevron.up").font(.system(size: 11, weight: .semibold))
                Text(collapsed ? "더 보기" : "접기").font(.system(size: Typo.caption + 1, weight: .medium))
            }
            .foregroundColor(Theme.muted)
            // 글자보다 넉넉하게 눌리도록(오른쪽과 위아래)
            .padding(.trailing, 28)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(collapsed ? "foldMore" : "foldLess")
    }
}

/// 접힌 것의 아래쪽을 바탕색으로 흐리게(더 있다는 표시)
struct FoldFade: View {
    let color: Color
    let height: CGFloat

    var body: some View {
        LinearGradient(colors: [color.opacity(0), color], startPoint: .top, endPoint: .bottom)
            .frame(height: height)
            .allowsHitTesting(false)
    }
}

/// 내용이 `limit` 보다 길면 `folded` 높이만 보이고 '더 보기'가 붙는다. 펼치면 끝에 '접기'.
/// - 스스로 접는 것은 처음 그릴 때 이미 길었던 것뿐이다: 보는 동안 자라서 길어진 것(쓰는 중인 답, 안에서 코드 블록을 펼친 답)은
///   읽던 글이 갑자기 접히지 않게 그대로 두고 '접기'만 붙인다.
/// - 펼치는 것은 '더 보기' 버튼으로만(접힌 글을 눌러서는 펼쳐지지 않는다: 키보드를 내리려고 대화를 누르다 긴 글이 펼쳐지면 안 됨).
/// - 어림(`guess`)이 짧은 글은 아무것도 달지 않고 그대로 그린다. 쓰는 중에 길어지면 그때부터 잰다.
struct Foldable<Content: View>: View {
    private let guess: Fold.Guess
    private let limit: CGFloat
    private let folded: CGFloat
    private let fade: Color
    private let content: () -> Content
    /// 높이를 재는 장치를 달았는지(한 번 달면 그대로)
    @State private var measuring: Bool

    /// - fade: 흐려지는 쪽의 바탕색(말풍선 안이면 말풍선 색)
    init(guess: Fold.Guess, limit: CGFloat = Fold.limit, folded: CGFloat = Fold.folded, fade: Color = Theme.bg,
         @ViewBuilder content: @escaping () -> Content) {
        self.guess = guess
        self.limit = limit
        self.folded = folded
        self.fade = fade
        self.content = content
        _measuring = State(initialValue: guess != .short)
    }

    var body: some View {
        Group {
            if measuring {
                FoldBody(startFolded: guess == .long, limit: limit, folded: folded, fade: fade, content: content)
            } else {
                content()
            }
        }
        .onChange(of: guess) { if $0 != .short { measuring = true } }
    }
}

/// Foldable 의 본체: 높이를 재서 접고 펼친다
private struct FoldBody<Content: View>: View {
    private let limit: CGFloat
    private let folded: CGFloat
    private let fade: Color
    private let content: () -> Content

    /// 처음 그릴 때 길었는지. 재기 전에는 어림이고 처음 잰 값으로 바로잡는다(바뀌어도 다시 그릴 일이 없어 상태로 두지 않음)
    private final class Memo {
        var startedLong: Bool
        var measured = false
        init(_ startedLong: Bool) { self.startedLong = startedLong }
    }
    @State private var memo: Memo
    @State private var long: Bool               // 지금 기준보다 긴지(재기 전에는 어림)
    @State private var choice: Bool?            // 누른 것(true: 펼침, false: 접음). nil 이면 처음 길었던 것만 접음
    @State private var anchor = UUID()
    @Environment(\.foldEvents) private var events

    /// - startFolded: 접힌 채 그리기 시작할지(거의 틀림없이 긴 글. 다 펼쳐 그린 뒤 접으면 대화 전체를 한 번 더 배치하게 됨)
    init(startFolded: Bool, limit: CGFloat, folded: CGFloat, fade: Color, content: @escaping () -> Content) {
        self.limit = limit
        self.folded = folded
        self.fade = fade
        self.content = content
        _memo = State(initialValue: Memo(startFolded))
        _long = State(initialValue: startFolded)
    }

    private var collapsed: Bool { long && !(choice ?? !memo.startedLong) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            content()
                .fixedSize(horizontal: false, vertical: true)
                .background(
                    GeometryReader { g in
                        Color.clear.onAppear { measured(g.size.height) }
                            .onChange(of: g.size.height) { measured($0) }
                    }
                )
                .frame(height: collapsed ? folded : nil, alignment: .top)
                .clipped()
                // 눌리는 범위도 보이는 높이까지만: 잘린 부분은 그려지지 않을 뿐 눌리기는 해서, 그 자리('더 보기' 옆 등)를 누르면 안 보이는 링크가 열린다.
                // 보이는 링크·버튼은 그대로 눌린다(예전처럼 접힌 동안 통째로 막으면 보이는 링크도 안 눌림. 사용자 보고 11-18)
                .contentShape(Rectangle())
                .overlay(alignment: .bottom) {
                    if collapsed { FoldFade(color: fade, height: min(64, folded * 0.25)) }
                }
            if long { FoldToggle(collapsed: collapsed, action: toggle) }
        }
        .id(anchor)
    }

    private func measured(_ h: CGFloat) {
        guard h > 0 else { return }
        let isLong = h > limit
        if !memo.measured {
            memo.measured = true
            memo.startedLong = isLong
        }
        if long != isLong { long = isLong }
    }

    private func toggle() {
        let expand = collapsed
        if expand {
            withAnimation(.easeOut(duration: 0.18)) { choice = true }
        } else {
            choice = false
        }
        events?.send(anchor: anchor, expanded: expand)
    }
}
