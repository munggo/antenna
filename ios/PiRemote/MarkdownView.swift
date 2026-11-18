import SwiftUI

/// 어시스턴트 답변용 간단한 마크다운 표시.
/// 블록(제목·목록·코드·표·인용·구분선·문단)은 직접 나누고, 줄 안의 꾸밈(굵게·기울임·코드·링크)은
/// iOS 기본 마크다운 해석을 쓴다. 스트리밍 중 닫히지 않은 코드 블록도 코드로 보여준다.
struct MarkdownView: View {
    let text: String
    /// 긴 코드 블록을 접을지(대화 글에서만 켠다. 단계 창·문서 보기에서는 다 보여 줌)
    var foldLongCode = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(MarkdownParser.parse(text).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MDBlock) -> some View {
        switch block {
        case .paragraph(let s):
            Text(MarkdownParser.inline(s))
                .font(.system(size: Typo.body))
                .lineSpacing(Typo.bodyLineSpacing)
                .foregroundColor(Theme.text)
                .tint(Theme.accent)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

        case .heading(let level, let s):
            Text(MarkdownParser.inline(s))
                .font(.system(size: level <= 1 ? Typo.h1 : level == 2 ? Typo.h2 : Typo.h3, weight: .semibold))
                .foregroundColor(Theme.text)
                .padding(.top, 4)
                .textSelection(.enabled)

        case .listItem(let marker, let indent, let s):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker)
                    .font(.system(size: Typo.body))
                    .foregroundColor(Theme.text)
                    .frame(minWidth: 14, alignment: .trailing)
                Text(MarkdownParser.inline(s))
                    .font(.system(size: Typo.body))
                    .lineSpacing(Typo.bodyLineSpacing)
                    .foregroundColor(Theme.text)
                    .tint(Theme.accent)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(indent) * 16)

        case .code(let lang, let code):
            CodeBlockView(lang: lang, code: code, foldable: foldLongCode)

        case .table(let rows):
            TableBlockView(rows: rows)

        case .quote(let s):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5).fill(Theme.surfaceHigh).frame(width: 3)
                Text(MarkdownParser.inline(s))
                    .font(.system(size: Typo.quote))
                    .lineSpacing(5.5)
                    .foregroundColor(Theme.muted)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }

        case .rule:
            Rectangle().fill(Theme.border).frame(height: 1).padding(.vertical, 4)

        case .image(let path):
            ThumbView(path: path, size: .large, fit: true)
                .frame(maxWidth: .infinity, maxHeight: 440)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}

struct CodeBlockView: View {
    let lang: String
    let code: String
    /// 긴 코드를 접을지(MarkdownView.foldLongCode)
    let foldable: Bool
    /// 스스로 접는 것은 처음 그릴 때 이미 길었던 코드뿐이다(쓰는 중에 자라난 코드는 그대로 두고 '접기'만 붙임). 그 뒤로는 누른 대로
    @State private var folded: Bool
    @State private var anchor = UUID()
    @Environment(\.foldEvents) private var events

    init(lang: String, code: String, foldable: Bool = false) {
        self.lang = lang
        self.code = code
        self.foldable = foldable
        _folded = State(initialValue: foldable && Fold.lineCount(code) > Fold.codeLimitLines)
    }

    var body: some View {
        let long = foldable && Fold.lineCount(code) > Fold.codeLimitLines
        let collapsed = long && folded
        VStack(alignment: .leading, spacing: 0) {
            // 머리줄: 언어 이름 + 복사 버튼
            HStack {
                Text(lang)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Theme.muted)
                Spacer()
                CopyButton(text: code, label: "코드 복사")
                    .frame(width: 28)
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .padding(.top, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                // 접힌 동안에는 앞의 몇 줄만 그린다(복사는 머리줄의 버튼으로 전체)
                Text(collapsed ? Fold.firstLines(code, Fold.codeFoldedLines) : code)
                    .font(.system(size: Typo.code, design: .monospaced))
                    .foregroundColor(Theme.text)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(12)
            }
            .overlay(alignment: .bottom) {
                if collapsed { FoldFade(color: Theme.bgElevated, height: 48) }
            }
            if long {
                FoldToggle(collapsed: collapsed) {
                    folded = !collapsed
                    events?.send(anchor: anchor, expanded: collapsed)
                }
                .padding(.leading, 12)
                .padding(.bottom, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bgElevated))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border))
        .id(anchor)
    }
}

struct TableBlockView: View {
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Text(MarkdownParser.inline(cell))
                                .font(.system(size: Typo.table, weight: r == 0 ? .semibold : .regular))
                                .foregroundColor(r == 0 ? Theme.text : Theme.text.opacity(0.9))
                                .fixedSize()
                        }
                    }
                    if r == 0 {
                        Rectangle().fill(Theme.border).frame(height: 1).gridCellUnsizedAxes(.horizontal)
                    }
                }
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.bgElevated))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border))
    }
}

// MARK: - 파서

enum MDBlock {
    case paragraph(String)
    case heading(Int, String)
    case listItem(marker: String, indent: Int, text: String)
    case code(lang: String, code: String)
    case table([[String]])
    case quote(String)
    case rule
    case image(String)      // 한 줄이 사진 경로(![](…) 또는 @…)뿐일 때
}

enum MarkdownParser {
    static func parse(_ text: String) -> [MDBlock] {
        var blocks: [MDBlock] = []
        var para: [String] = []
        var table: [[String]] = []
        var quote: [String] = []
        var inCode = false
        var codeLang = ""
        var code: [String] = []

        func flushPara() {
            if !para.isEmpty { blocks.append(.paragraph(para.joined(separator: "\n"))); para = [] }
        }
        func flushTable() {
            if !table.isEmpty { blocks.append(.table(table)); table = [] }
        }
        func flushQuote() {
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))); quote = [] }
        }
        func flushAll() { flushPara(); flushTable(); flushQuote() }

        for raw in text.components(separatedBy: "\n") {
            let line = raw.replacingOccurrences(of: "\t", with: "    ")
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if inCode {
                if trimmed.hasPrefix("```") {
                    blocks.append(.code(lang: codeLang, code: code.joined(separator: "\n")))
                    inCode = false; code = []
                } else {
                    code.append(line)
                }
                continue
            }
            if trimmed.hasPrefix("```") {
                flushAll()
                inCode = true
                codeLang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                continue
            }
            if trimmed.isEmpty { flushAll(); continue }

            // 표: | a | b |
            if trimmed.hasPrefix("|") {
                flushPara(); flushQuote()
                let cells = splitRow(trimmed)
                if !cells.allSatisfy(isSeparatorCell) { table.append(cells) }
                continue
            }
            flushTable()

            if trimmed.hasPrefix(">") {
                flushPara()
                quote.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
                continue
            }
            flushQuote()

            // 한 줄이 사진 경로뿐이면 그림으로(~/.cache/pi-remote/img-* 만)
            let img = ImageTokens.split(trimmed)
            if !img.paths.isEmpty, img.text.isEmpty {
                flushPara()
                for p in img.paths { blocks.append(.image(p)) }
                continue
            }
            if let h = heading(trimmed) { flushPara(); blocks.append(h); continue }
            if isRule(trimmed) { flushPara(); blocks.append(.rule); continue }
            if let item = listItem(line) { flushPara(); blocks.append(item); continue }
            para.append(line)
        }
        if inCode { blocks.append(.code(lang: codeLang, code: code.joined(separator: "\n"))) }
        flushAll()
        return blocks
    }

    /// 줄 안의 꾸밈(굵게·기울임·코드·링크). 코드는 고정폭 + 강조색.
    /// 해석은 InlineMarkdown 이 한다(물결표 하나짜리를 취소선으로 읽지 않게 가려서 넘김).
    static func inline(_ s: String) -> AttributedString {
        var attr = InlineMarkdown.parse(s)
        for run in attr.runs where run.inlinePresentationIntent?.contains(.code) == true {
            attr[run.range].font = .system(size: Typo.inlineCode, design: .monospaced)
            attr[run.range].foregroundColor = Theme.codeInline
        }
        return attr
    }

    private static func heading(_ t: String) -> MDBlock? {
        var level = 0
        for ch in t { if ch == "#" { level += 1 } else { break } }
        guard (1...6).contains(level), t.count > level,
              t[t.index(t.startIndex, offsetBy: level)] == " " else { return nil }
        return .heading(level, String(t.dropFirst(level + 1)))
    }

    private static func isRule(_ t: String) -> Bool {
        let s = t.replacingOccurrences(of: " ", with: "")
        guard s.count >= 3, let c = s.first, "-*_".contains(c) else { return false }
        return s.allSatisfy { $0 == c }
    }

    private static func listItem(_ line: String) -> MDBlock? {
        let lead = line.prefix { $0 == " " }.count
        let rest = line.dropFirst(lead)
        let indent = lead / 2
        for m in ["- ", "* ", "+ "] where rest.hasPrefix(m) {
            let body = String(rest.dropFirst(2))
            // 할 일 목록: - [ ] / - [x]
            if body.hasPrefix("[ ] ") { return .listItem(marker: "☐", indent: indent, text: String(body.dropFirst(4))) }
            if body.lowercased().hasPrefix("[x] ") { return .listItem(marker: "☑", indent: indent, text: String(body.dropFirst(4))) }
            return .listItem(marker: "•", indent: indent, text: body)
        }
        // 1. 또는 1)
        let digits = rest.prefix { $0.isNumber }
        if !digits.isEmpty, digits.count <= 3 {
            let after = rest.dropFirst(digits.count)
            if after.hasPrefix(". ") || after.hasPrefix(") ") {
                return .listItem(marker: "\(digits).", indent: indent, text: String(after.dropFirst(2)))
            }
        }
        return nil
    }

    private static func splitRow(_ t: String) -> [String] {
        var s = t
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") { s.removeLast() }
        return s.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func isSeparatorCell(_ c: String) -> Bool {
        let s = c.replacingOccurrences(of: ":", with: "")
        return !s.isEmpty && s.allSatisfy { $0 == "-" }
    }
}
