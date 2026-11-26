// 앱의 글 꾸밈 해석(ios/PiRemote/InlineMarkdown.swift) 판정 시험. 시뮬레이터 없이 맥에서 바로 컴파일해 돌린다:
//   sh test.sh inline
// 보는 것: 물결표 하나짜리는 취소선이 되지 않고 글자 그대로 남는지(11-17 사용자 보고: '7~12개월 … 80~120g' 사이가 지운 글처럼 보임),
//          그러면서 정식 취소선(~~)·코드 글자·링크는 전과 같은지
// 작성: 서문교
import Foundation

struct Seen {
    var text = ""            // 화면에 보이는 글자
    var struck: [String] = []   // 취소선이 그어진 구간
    var code: [String] = []     // 코드 글자 구간
    var strong: [String] = []   // 굵은 구간
    var links: [String] = []    // 링크 주소(나온 순서)
}

func look(_ s: String) -> Seen {
    let attr = InlineMarkdown.parse(s)
    var seen = Seen()
    var last = (struck: false, code: false, strong: false, link: "")
    for run in attr.runs {
        let t = String(attr[run.range].characters)
        let intent = run.inlinePresentationIntent ?? []
        let now = (struck: intent.contains(.strikethrough), code: intent.contains(.code),
                   strong: intent.contains(.stronglyEmphasized), link: run.link?.absoluteString ?? "")
        seen.text += t
        // 굵게 등으로 조각이 나뉘어도 이어진 구간은 하나로 모은다
        if now.struck { if last.struck { seen.struck[seen.struck.count - 1] += t } else { seen.struck.append(t) } }
        if now.code { if last.code { seen.code[seen.code.count - 1] += t } else { seen.code.append(t) } }
        if now.strong { if last.strong { seen.strong[seen.strong.count - 1] += t } else { seen.strong.append(t) } }
        if !now.link.isEmpty, now.link != last.link { seen.links.append(now.link) }
        last = now
    }
    return seen
}

var passed = 0
var failed = 0

func report(_ ok: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
    if ok {
        passed += 1
        print("통과  \(name)")
    } else {
        failed += 1
        print("실패  \(name)\n        \(detail())")
    }
}

/// 원문을 해석한 모습이 기대와 같은지. text 를 주지 않으면 원문 그대로 보여야 한다
func check(_ name: String, _ source: String, text: String? = nil, struck: [String] = [], code: [String] = [],
           strong: [String] = [], links: [String]? = nil) {
    let seen = look(source)
    var wrong: [String] = []
    if seen.text != (text ?? source) { wrong.append("보이는 글자 [\(seen.text)] ≠ [\(text ?? source)]") }
    if seen.struck != struck { wrong.append("취소선 \(seen.struck) ≠ \(struck)") }
    if seen.code != code { wrong.append("코드 \(seen.code) ≠ \(code)") }
    if seen.strong != strong { wrong.append("굵게 \(seen.strong) ≠ \(strong)") }
    if let links, seen.links != links { wrong.append("링크 \(seen.links) ≠ \(links)") }
    // 주소 안의 물결표를 가리면 링크에 역슬래시(%5C)가 들어가 깨진다
    if seen.links.contains(where: { $0.contains("%5C") || $0.contains("\\") }) { wrong.append("링크에 역슬래시가 들어감 \(seen.links)") }
    report(wrong.isEmpty, name, wrong.joined(separator: " / ") + " (원문: \(source))")
}

func same(_ name: String, _ got: String, _ want: String) {
    report(got == want, name, "[\(got)] ≠ [\(want)]")
}

@main
enum InlineMarkdownTest {
    static func main() {
        // ── 물결표 하나짜리는 취소선이 아니다 ──
        check("범위가 두 번: 사이가 지워지지 않고 물결표도 남음",
              "기준표(7~12개월)로 계산하면 하루 188g이고, 주 80~120g씩 늘린 기록이 있습니다.")
        check("범위가 한 번", "7~12개월")
        check("범위가 세 번", "1~2개, 3~4개, 5~6개")
        check("줄이 달라도", "7~12개월\n80~120g")
        check("빈 줄을 사이에 두고도", "7~12개월\n\n80~120g")
        check("괄호 안 홈 경로 둘", "(~/a) 와 (~/b)")
        check("홈 경로 뒤에 범위", "~/a 를 보고 7~12")
        check("범위 뒤에 홈 경로", "7~12 를 보고 ~/a")
        check("대략을 뜻하는 물결표", "~10분 걸리고 ~3개 남음")
        check("끝말의 물결표", "좋아요~ 그렇죠~ 네")
        check("굵은 글 안의 범위 둘", "**7~12개월, 80~120g**", text: "7~12개월, 80~120g", strong: ["7~12개월, 80~120g"])
        check("링크 글 안의 범위 둘", "[7~12 와 80~120](https://example.com/a)", text: "7~12 와 80~120", links: ["https://example.com/a"])
        check("저절로 링크가 되지 않는 주소 꼴(ssh)", "ssh://host/~a~b 뒤")
        check("저절로 링크가 되지 않는 주소 꼴(s3)", "s3://bucket/~a~b 뒤")
        check("메일 주소 앞의 물결표", "a~b~c@example.com 뒤", links: ["mailto:c@example.com"])

        // ── 정식 취소선(물결표 두 개)은 그대로 ──
        check("물결표 두 개는 취소선", "이건 ~~지운 글~~ 입니다", text: "이건 지운 글 입니다", struck: ["지운 글"])
        check("취소선과 범위가 함께", "~~지움~~ 그리고 7~12, 80~120", text: "지움 그리고 7~12, 80~120", struck: ["지움"])
        check("취소선 안의 범위", "~~7~12~~ 뒤", text: "7~12 뒤", struck: ["7~12"])
        check("취소선 안의 범위 둘", "~~7~12, 80~120~~ 뒤", text: "7~12, 80~120 뒤", struck: ["7~12, 80~120"])
        check("굵은 취소선", "**~~지움~~** 과 7~12, 80~120", text: "지움 과 7~12, 80~120", struck: ["지움"], strong: ["지움"])
        check("물결표 세 개는 글자", "~~~세 개~~~ 뒤")
        check("물결표 네 개는 글자", "~~~~네 개~~~~ 뒤")

        // ── 코드 글자 안은 손대지 않는다(가리면 역슬래시가 보임) ──
        check("코드 안의 홈 경로와 밖의 범위", "명령 `cd ~/a && ls ~/b` 를 치면 7~12, 80~120",
              text: "명령 cd ~/a && ls ~/b 를 치면 7~12, 80~120", code: ["cd ~/a && ls ~/b"])
        check("코드 둘", "`~/a` 와 `~/b` 그리고 7~12", text: "~/a 와 ~/b 그리고 7~12", code: ["~/a", "~/b"])
        check("백틱 두 개로 싼 코드", "``a`~b~`` 뒤 ~c~ 와 ~d~", text: "a`~b~ 뒤 ~c~ 와 ~d~", code: ["a`~b~"])
        check("닫히지 않은 백틱은 글자", "`a ~b~ c")
        check("개수가 다른 백틱은 짝이 아님", "`` a ~b~ ` c ~d~")
        check("가린 백틱은 코드를 열지 않음", "\\`a ~b~ c\\`", text: "`a ~b~ c`")
        check("줄을 넘는 코드", "`a\n~b~` 끝 ~c~ ~d~", text: "a ~b~ 끝 ~c~ ~d~", code: ["a ~b~"])
        check("닫히지 않은 백틱이 여럿", "` 와 `` 와 ``` 뒤 1~2, 3~4")

        // ── 이미 가린 글자는 다시 가리지 않는다 ──
        check("이미 가린 물결표", "7\\~12개월, 80\\~120g", text: "7~12개월, 80~120g")
        check("역슬래시 글자 뒤의 물결표", "경로 C:\\\\~tmp 와 ~x~", text: "경로 C:\\~tmp 와 ~x~")

        // ── 주소 안은 손대지 않는다(가리면 링크가 깨짐) ──
        check("주소 안의 물결표와 밖의 범위", "주소 https://example.com/~user/a~b 를 보고 7~12, 80~120",
              links: ["https://example.com/~user/a~b"])
        check("주소 끝에 붙은 물결표", "7~12 와 https://example.com/x~", links: ["https://example.com/x"])
        check("www 로 시작하는 주소", "www.example.com/~a~b 와 7~12, 80~120", links: ["http://www.example.com/~a~b"])
        check("ftp 주소", "ftp://host.example.com/~a~b 와 7~12, 80~120", links: ["ftp://host.example.com/~a~b"])
        check("한글 뒤에 붙은 www 는 주소가 아님", "주소는www.example.com/~a~b 뒤", links: [])
        check("꺾쇠로 싼 주소", "<https://example.com/~x> 는 7~12 와 80~120",
              text: "https://example.com/~x 는 7~12 와 80~120", links: ["https://example.com/~x"])
        check("꺾쇠 주소 뒤에 붙은 물결표", "<https://example.com/~x>~a~ 뒤",
              text: "https://example.com/~x~a~ 뒤", links: ["https://example.com/~x"])
        check("링크의 주소", "[글](https://example.com/~user/a~b) 뒤 7~12, 80~120",
              text: "글 뒤 7~12, 80~120", links: ["https://example.com/~user/a~b"])
        check("링크와 링크를 잇는 물결표",
              "[1장](https://example.com/1)~[3장](https://example.com/3), [5장](https://example.com/5)~[7장](https://example.com/7)",
              text: "1장~3장, 5장~7장",
              links: ["https://example.com/1", "https://example.com/3", "https://example.com/5", "https://example.com/7"])
        check("괄호가 든 주소의 링크 뒤", "[글](https://example.com/a_(b))~c~ 뒤", text: "글~c~ 뒤", links: ["https://example.com/a_(b)"])
        check("제목이 붙은 링크", "[글](https://example.com/~a \"7~12\") 뒤 1~2, 3~4", text: "글 뒤 1~2, 3~4", links: ["https://example.com/~a"])
        check("닫히지 않은 링크(받는 중)", "[글](https://example.com/~a~b", links: ["https://example.com/~a~b"])
        check("주소가 아닌 링크 대상", "[글](/~a/~b) 와 7~12, 80~120", text: "글 와 7~12, 80~120", links: ["/~a/~b"])
        check("괄호 안의 주소", "(https://example.com/~a~b) 와 7~12, 80~120", links: ["https://example.com/~a~b"])
        check("한글이 붙은 주소", "주소는https://example.com/~a~b 이고 7~12, 80~120", links: ["https://example.com/~a~b"])
        check("대문자로 쓴 주소", "HTTPS://example.com/~a~b 와 7~12, 80~120")

        // ── 가린 모양 ──
        same("물결표가 없으면 원문 그대로", InlineMarkdown.escapeLoneTildes("물결표 없는 글 `코드` **굵게**"), "물결표 없는 글 `코드` **굵게**")
        same("물결표가 하나뿐이면 원문 그대로", InlineMarkdown.escapeLoneTildes("7~12개월"), "7~12개월")
        same("하나짜리만 가림", InlineMarkdown.escapeLoneTildes("7~12, 80~120"), "7\\~12, 80\\~120")
        same("두 개짜리는 두고 하나짜리만", InlineMarkdown.escapeLoneTildes("~~지움~~ 7~12"), "~~지움~~ 7\\~12")
        same("코드와 주소 안은 그대로", InlineMarkdown.escapeLoneTildes("`~/a` https://e.com/~b 와 ~c"), "`~/a` https://e.com/~b 와 \\~c")
        same("한글·그림 글자는 그대로", InlineMarkdown.escapeLoneTildes("가~나 😀~👍🏽 다"), "가\\~나 😀\\~👍🏽 다")

        // ── 맥의 그림 경로는 누르면 앱에서 보는 링크(11-25) ──
        /// 그림 링크로 바뀐 경로들(나온 순서)과, 그림 링크가 아닌 링크들
        func pics(_ s: String) -> (paths: [String], others: [String]) {
            let attr = InlineMarkdown.parse(s)
            var paths: [String] = [], others: [String] = []
            var last = ""
            for run in attr.runs {
                guard let url = run.link, url.absoluteString != last else { continue }
                last = url.absoluteString
                if let p = InlineMarkdown.imagePath(url) { paths.append(p) } else { others.append(url.absoluteString) }
            }
            return (paths, others)
        }
        let hanti = "/Users/me/Downloads/한티 마스터 01.png"
        same("코드 글자로 쓴 경로(띄어쓰기·한글)", pics("QR 그림은 맥에 저장했습니다. `\(hanti)`").paths.joined(separator: "|"), hanti)
        check("코드 글자의 경로도 보이는 글자와 코드 꾸밈은 그대로", "저장 `\(hanti)`", text: "저장 \(hanti)", code: [hanti])
        same("띄어 쓴 맨 경로", pics("저장: /Users/me/out/chart.png 를 보세요").paths.joined(separator: "|"), "/Users/me/out/chart.png")
        same("조사가 붙은 맨 경로는 조사를 뺌", pics("/Users/me/out/chart.png를 열어").paths.joined(separator: "|"), "/Users/me/out/chart.png")
        same("홈 경로·대문자 확장자·끝 마침표", pics("만들었습니다 ~/Desktop/qr.PNG.").paths.joined(separator: "|"), "~/Desktop/qr.PNG")
        same("맨 경로 둘", pics("/a/1.png 와 /b/2.jpeg 둘").paths.joined(separator: "|"), "/a/1.png|/b/2.jpeg")
        same("그림이 아닌 파일은 그대로", pics("`/Users/me/a.txt` 와 /Users/me/b.pdf").paths.joined(separator: "|"), "")
        same("확장자가 이어지면 그림이 아님", pics("/tmp/a.png.bak 남김").paths.joined(separator: "|"), "")
        same("상대 경로는 그대로", pics("out/a.png 와 ./b.png").paths.joined(separator: "|"), "")
        same("명령이 든 코드 글자는 그대로", pics("`open /tmp/a.png`").paths.joined(separator: "|"), "")
        let web = pics("https://example.com/a.png 를 보면")
        same("웹 주소의 그림은 웹 링크 그대로", "\(web.paths)|\(web.others)", "[]|[\"https://example.com/a.png\"]")
        let given = pics("[그림](/tmp/a.png) 뒤")
        same("이미 링크로 쓴 것은 그대로", "\(given.paths)|\(given.others)", "[]|[\"/tmp/a.png\"]")
        same("링크 주소에서 경로를 그대로 되찾음", InlineMarkdown.imageURL(hanti).flatMap { InlineMarkdown.imagePath($0) } ?? "(없음)", hanti)

        print(failed == 0 ? "모두 통과: \(passed)가지" : "실패 \(failed)가지 / 통과 \(passed)가지")
        exit(failed == 0 ? 0 : 1)
    }
}
