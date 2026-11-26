import Foundation

/// 줄 안의 꾸밈(굵게·기울임·코드·링크·취소선)을 iOS 기본 마크다운 해석으로 읽는다.
/// 글꼴·색 같은 화면 꾸밈은 부르는 쪽(MarkdownParser.inline)에서 입힌다.
/// 화면 프레임워크를 쓰지 않아 맥에서 바로 시험할 수 있다(ios/test/inline-markdown.swift, `sh test.sh inline`).
enum InlineMarkdown {
    static func parse(_ s: String) -> AttributedString {
        let opts = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        var attr = (try? AttributedString(markdown: escapeLoneTildes(s), options: opts)) ?? AttributedString(s)
        linkImagePaths(&attr)
        return attr
    }

    // ── 맥의 그림 파일 경로 → 누르면 앱에서 그 그림을 보는 링크(11-25 사용자 요청: 답에 '그림은 맥에 저장했습니다. /Users/…/qr.png') ──
    /// 링크 주소의 앞부분. 뒤에 퍼센트 인코딩한 경로를 붙인다. 채팅 화면이 이 주소를 받아 그림 보기를 연다
    static let imageScheme = "antenna-image"
    private static let imageExt = "(?:png|jpe?g|gif|heic|heif|webp|bmp|tiff?)"
    /// 코드 글자 하나가 통째로 경로인 것(띄어쓰기가 있어도 됨: 백틱이 끝을 정해 줌)
    private static let wholePath = try! NSRegularExpression(pattern: "^(?:~/|/)(?!/)[^\\n`]*\\.\(imageExt)$", options: .caseInsensitive)
    /// 꾸밈 없는 글 속의 경로(띄어쓰기 없음). 앞이 글자·숫자·/·: 면 주소나 낱말의 일부라 보지 않고,
    /// 뒤에 붙은 한글 조사·마침표는 뺀다('…/a.png를', '…/a.png.'). '…/a.png.bak' 처럼 확장자가 이어지면 그림이 아니다
    private static let barePath = try! NSRegularExpression(
        pattern: "(?<![\\p{L}\\p{N}/_.~:\\-])(?:~/|/)(?!/)[^\\s`'\"<>()\\[\\]{}]*?\\.\(imageExt)(?![A-Za-z0-9_]|\\.[A-Za-z0-9])",
        options: .caseInsensitive)

    static func imageURL(_ path: String) -> URL? {
        guard let enc = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "\(imageScheme):\(enc)")
    }

    /// 그림 링크 주소 → 맥의 경로(그림 링크가 아니면 nil)
    static func imagePath(_ url: URL) -> String? {
        guard url.scheme == imageScheme else { return nil }
        return String(url.absoluteString.dropFirst(imageScheme.count + 1)).removingPercentEncoding
    }

    /// 이미 링크인 곳은 그대로 두고, 그림 경로에 그림 링크를 단다
    static func linkImagePaths(_ attr: inout AttributedString) {
        var found: [(Range<AttributedString.Index>, String)] = []
        for run in attr.runs where run.link == nil {
            let text = String(attr[run.range].characters)
            let full = NSRange(location: 0, length: (text as NSString).length)
            if run.inlinePresentationIntent?.contains(.code) == true {
                if wholePath.firstMatch(in: text, range: full) != nil { found.append((run.range, text)) }
                continue
            }
            for m in barePath.matches(in: text, range: full) {
                guard let r = Range(m.range, in: text) else { continue }
                let lo = attr.characters.index(run.range.lowerBound, offsetBy: text.distance(from: text.startIndex, to: r.lowerBound))
                let hi = attr.characters.index(lo, offsetBy: text.distance(from: r.lowerBound, to: r.upperBound))
                found.append((lo..<hi, String(text[r])))
            }
        }
        for (range, path) in found {
            if let url = imageURL(path) { attr[range].link = url }
        }
    }

    /// 물결표 하나짜리는 취소선으로 보지 않게 `\~` 로 가린다. `~~두 개~~` 는 그대로 취소선.
    /// iOS 해석기는 `~글~` 도 취소선으로 읽어서, '7~12개월 … 80~120g'처럼 범위가 두 번 나오면
    /// 그 사이가 지운 글처럼 보이고 물결표는 사라진다(11-17 사용자 보고).
    /// 가리면 안 되는 곳은 그대로 둔다: 코드 글자 안(역슬래시가 그대로 보임)과 주소 안(링크에 역슬래시가 들어가 깨짐).
    static func escapeLoneTildes(_ s: String) -> String {
        // 물결표가 둘이 안 되면 짝이 될 수 없다(대부분의 글은 여기서 끝)
        var tildes = 0
        for c in s.utf8 where c == tilde {
            tildes += 1
            if tildes == 2 { break }
        }
        guard tildes == 2 else { return s }

        let b = Array(s.utf8)
        var out: [UInt8] = []
        out.reserveCapacity(b.count + 8)
        var noCloser = Set<Int>()   // 뒤에 닫는 짝이 없다고 확인한 백틱 개수(같은 것을 다시 찾지 않게)
        var i = 0
        while i < b.count {
            let c = b[i]
            if c == backslash {
                // 이미 가린 글자(\~ 나 \` 등)는 그대로
                let n = i + 1 < b.count && isPunctuation(b[i + 1]) ? 2 : 1
                out.append(contentsOf: b[i..<(i + n)])
                i += n
            } else if c == backtick {
                // 코드 글자: 같은 수의 백틱으로 닫히면 그 안은 손대지 않는다. 닫히지 않으면 백틱은 그냥 글자
                let n = run(b, i)
                let end = closingBackticks(b, from: i + n, count: n, noCloser: &noCloser) ?? (i + n)
                out.append(contentsOf: b[i..<end])
                i = end
            } else if c == tilde {
                let n = run(b, i)
                if n == 1 { out.append(backslash) }
                out.append(contentsOf: b[i..<(i + n)])
                i += n
            } else if let end = addressEnd(b, i) {
                out.append(contentsOf: b[i..<end])
                i = end
            } else {
                out.append(c)
                i += 1
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    private static let tilde = UInt8(ascii: "~")
    private static let backslash = UInt8(ascii: "\\")
    private static let backtick = UInt8(ascii: "`")

    /// i 에서 시작하는 같은 글자의 이어진 개수
    private static func run(_ b: [UInt8], _ i: Int) -> Int {
        var j = i
        while j < b.count, b[j] == b[i] { j += 1 }
        return j - i
    }

    /// from 뒤에서 백틱이 정확히 count 개 이어진 곳의 끝. 없으면 nil
    private static func closingBackticks(_ b: [UInt8], from: Int, count: Int, noCloser: inout Set<Int>) -> Int? {
        if noCloser.contains(count) { return nil }
        var j = from
        while j < b.count {
            if b[j] == backtick {
                let n = run(b, j)
                if n == count { return j + n }
                j += n
            } else {
                j += 1
            }
        }
        noCloser.insert(count)
        return nil
    }

    /// i 가 해석기가 저절로 링크로 만드는 주소(http·https·ftp·www.)의 시작이면 그 끝. 아니면 nil.
    /// 주소 안의 물결표는 취소선이 되지 않는다. 끝은 해석기처럼 빈칸이나 '<' 앞까지(뒤에 붙은 한글도 주소에 들어감).
    private static func addressEnd(_ b: [UInt8], _ i: Int) -> Int? {
        let c = b[i] | 0x20   // 영문자면 소문자로
        guard c == UInt8(ascii: "h") || c == UInt8(ascii: "f") || c == UInt8(ascii: "w") else { return nil }
        let prev: UInt8? = i > 0 ? b[i - 1] : nil
        var start: Int?
        if !(prev.map(isLetter) ?? false) {
            for scheme in ["https://", "http://", "ftp://"] where hasPrefix(b, i, scheme, anyCase: true) {
                start = i + scheme.utf8.count
                break
            }
        }
        if start == nil, hasPrefix(b, i, "www.", anyCase: false),
           prev.map({ isSpace($0) || "*_~(".utf8.contains($0) }) ?? true {
            start = i + 4
        }
        guard var j = start else { return nil }
        // <주소> 는 '>' 에서, [글](주소) 는 짝이 맞는 ')' 에서 끝난다(그 뒤는 보통 글)
        let angled = prev == UInt8(ascii: "<")
        let inLink = prev == UInt8(ascii: "(") && i >= 2 && b[i - 2] == UInt8(ascii: "]")
        var depth = 0
        while j < b.count {
            let d = b[j]
            if isSpace(d) || d == UInt8(ascii: "<") { break }
            if angled, d == UInt8(ascii: ">") { break }
            if inLink {
                if d == UInt8(ascii: "(") { depth += 1 }
                if d == UInt8(ascii: ")") {
                    if depth == 0 { break }
                    depth -= 1
                }
            }
            j += 1
        }
        return j
    }

    private static func hasPrefix(_ b: [UInt8], _ i: Int, _ p: String, anyCase: Bool) -> Bool {
        var j = i
        for want in p.utf8 {
            guard j < b.count else { return false }
            let got = anyCase && isLetter(b[j]) ? b[j] | 0x20 : b[j]
            if got != want { return false }
            j += 1
        }
        return true
    }

    private static func isLetter(_ c: UInt8) -> Bool {
        (c >= UInt8(ascii: "a") && c <= UInt8(ascii: "z")) || (c >= UInt8(ascii: "A") && c <= UInt8(ascii: "Z"))
    }

    private static func isSpace(_ c: UInt8) -> Bool {
        c == 0x20 || (c >= 0x09 && c <= 0x0D)
    }

    /// 역슬래시로 가릴 수 있는 글자(ASCII 문장 부호)
    private static func isPunctuation(_ c: UInt8) -> Bool {
        (c >= 0x21 && c <= 0x2F) || (c >= 0x3A && c <= 0x40) || (c >= 0x5B && c <= 0x60) || (c >= 0x7B && c <= 0x7E)
    }
}
