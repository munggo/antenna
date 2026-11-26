package com.munggo.antenna

import com.munggo.antenna.chat.InlineMd
import com.munggo.antenna.chat.Markdown
import com.munggo.antenna.chat.MdBlock
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 글 꾸밈 해석 시험. 사례는 아이폰 앱 시험(ios/test/inline-markdown.swift)과 같다.
 * 다른 점: 아이폰 기본 해석기가 메일 주소를 저절로 링크로 만드는 것은 하지 않는다(그 사례는 링크를 보지 않음)
 */
class InlineMdTest {
    private data class Seen(val text: String, val struck: List<String>, val code: List<String>, val strong: List<String>, val links: List<String>)

    private fun look(s: String): Seen {
        val spans = InlineMd.parse(s)
        val text = StringBuilder()
        val struck = ArrayList<String>(); val code = ArrayList<String>(); val strong = ArrayList<String>(); val links = ArrayList<String>()
        var last: com.munggo.antenna.chat.InlineSpan? = null
        for (sp in spans) {
            text.append(sp.text)
            fun add(list: ArrayList<String>, now: Boolean, before: Boolean) {
                if (!now) return
                if (before) list[list.size - 1] = list.last() + sp.text else list += sp.text
            }
            add(struck, sp.strike, last?.strike == true)
            add(code, sp.code, last?.code == true)
            add(strong, sp.bold, last?.bold == true)
            if (sp.link != null && sp.link != last?.link) links += sp.link!!
            last = sp
        }
        return Seen(text.toString(), struck, code, strong, links)
    }

    private fun check(source: String, text: String? = null, struck: List<String> = emptyList(), code: List<String> = emptyList(),
                      strong: List<String> = emptyList(), links: List<String>? = null) {
        val seen = look(source)
        assertEquals("보이는 글자 (원문: $source)", text ?: source, seen.text)
        assertEquals("취소선 (원문: $source)", struck, seen.struck)
        assertEquals("코드 (원문: $source)", code, seen.code)
        assertEquals("굵게 (원문: $source)", strong, seen.strong)
        if (links != null) assertEquals("링크 (원문: $source)", links, seen.links)
    }

    @Test fun 물결표_하나짜리는_취소선이_아니다() {
        check("기준표(7~12개월)로 계산하면 하루 188g이고, 주 80~120g씩 늘린 기록이 있습니다.")
        check("7~12개월")
        check("1~2개, 3~4개, 5~6개")
        check("7~12개월\n80~120g")
        check("7~12개월\n\n80~120g")
        check("(~/a) 와 (~/b)")
        check("~/a 를 보고 7~12")
        check("7~12 를 보고 ~/a")
        check("~10분 걸리고 ~3개 남음")
        check("좋아요~ 그렇죠~ 네")
        check("**7~12개월, 80~120g**", text = "7~12개월, 80~120g", strong = listOf("7~12개월, 80~120g"))
        check("[7~12 와 80~120](https://example.com/a)", text = "7~12 와 80~120", links = listOf("https://example.com/a"))
        check("ssh://host/~a~b 뒤")
        check("s3://bucket/~a~b 뒤")
        check("a~b~c@example.com 뒤")
    }

    @Test fun 물결표_두_개는_취소선() {
        check("이건 ~~지운 글~~ 입니다", text = "이건 지운 글 입니다", struck = listOf("지운 글"))
        check("~~지움~~ 그리고 7~12, 80~120", text = "지움 그리고 7~12, 80~120", struck = listOf("지움"))
        check("~~7~12~~ 뒤", text = "7~12 뒤", struck = listOf("7~12"))
        check("~~7~12, 80~120~~ 뒤", text = "7~12, 80~120 뒤", struck = listOf("7~12, 80~120"))
        check("**~~지움~~** 과 7~12, 80~120", text = "지움 과 7~12, 80~120", struck = listOf("지움"), strong = listOf("지움"))
        check("~~~세 개~~~ 뒤")
        check("~~~~네 개~~~~ 뒤")
    }

    @Test fun 코드_글자_안은_손대지_않는다() {
        check("명령 `cd ~/a && ls ~/b` 를 치면 7~12, 80~120", text = "명령 cd ~/a && ls ~/b 를 치면 7~12, 80~120", code = listOf("cd ~/a && ls ~/b"))
        check("`~/a` 와 `~/b` 그리고 7~12", text = "~/a 와 ~/b 그리고 7~12", code = listOf("~/a", "~/b"))
        check("``a`~b~`` 뒤 ~c~ 와 ~d~", text = "a`~b~ 뒤 ~c~ 와 ~d~", code = listOf("a`~b~"))
        check("`a ~b~ c")
        check("`` a ~b~ ` c ~d~")
        check("\\`a ~b~ c\\`", text = "`a ~b~ c`")
        check("`a\n~b~` 끝 ~c~ ~d~", text = "a ~b~ 끝 ~c~ ~d~", code = listOf("a ~b~"))
        check("` 와 `` 와 ``` 뒤 1~2, 3~4")
    }

    @Test fun 가린_글자() {
        check("7\\~12개월, 80\\~120g", text = "7~12개월, 80~120g")
        check("경로 C:\\\\~tmp 와 ~x~", text = "경로 C:\\~tmp 와 ~x~")
    }

    @Test fun 주소() {
        check("주소 https://example.com/~user/a~b 를 보고 7~12, 80~120", links = listOf("https://example.com/~user/a~b"))
        check("7~12 와 https://example.com/x~", links = listOf("https://example.com/x"))
        check("www.example.com/~a~b 와 7~12, 80~120", links = listOf("http://www.example.com/~a~b"))
        check("ftp://host.example.com/~a~b 와 7~12, 80~120", links = listOf("ftp://host.example.com/~a~b"))
        check("주소는www.example.com/~a~b 뒤", links = emptyList())
        check("<https://example.com/~x> 는 7~12 와 80~120", text = "https://example.com/~x 는 7~12 와 80~120", links = listOf("https://example.com/~x"))
        check("<https://example.com/~x>~a~ 뒤", text = "https://example.com/~x~a~ 뒤", links = listOf("https://example.com/~x"))
        check("[글](https://example.com/~user/a~b) 뒤 7~12, 80~120", text = "글 뒤 7~12, 80~120", links = listOf("https://example.com/~user/a~b"))
        check(
            "[1장](https://example.com/1)~[3장](https://example.com/3), [5장](https://example.com/5)~[7장](https://example.com/7)",
            text = "1장~3장, 5장~7장",
            links = listOf("https://example.com/1", "https://example.com/3", "https://example.com/5", "https://example.com/7"),
        )
        check("[글](https://example.com/a_(b))~c~ 뒤", text = "글~c~ 뒤", links = listOf("https://example.com/a_(b)"))
        check("[글](https://example.com/~a \"7~12\") 뒤 1~2, 3~4", text = "글 뒤 1~2, 3~4", links = listOf("https://example.com/~a"))
        check("[글](https://example.com/~a~b", links = listOf("https://example.com/~a~b"))
        check("[글](/~a/~b) 와 7~12, 80~120", text = "글 와 7~12, 80~120", links = listOf("/~a/~b"))
        check("(https://example.com/~a~b) 와 7~12, 80~120", links = listOf("https://example.com/~a~b"))
        check("주소는https://example.com/~a~b 이고 7~12, 80~120", links = listOf("https://example.com/~a~b"))
        check("HTTPS://example.com/~a~b 와 7~12, 80~120")
    }

    @Test fun 굵게와_기울임() {
        check("**굵게** 와 *기울임* 과 _밑줄 기울임_", text = "굵게 와 기울임 과 밑줄 기울임", strong = listOf("굵게"))
        check("snake_case_name 은 그대로")
        check("2 * 3 * 4 는 곱셈")
        val spans = InlineMd.parse("*기울임 **굵게** 기울임*")
        assertEquals("기울임 굵게 기울임", spans.joinToString("") { it.text })
        assertEquals(true, spans.all { it.italic })
        assertEquals(listOf("굵게"), spans.filter { it.bold }.map { it.text })
    }

    /** 그림 링크로 바뀐 경로들과 그림 링크가 아닌 링크들 */
    private fun pics(s: String): Pair<List<String>, List<String>> {
        val paths = ArrayList<String>(); val others = ArrayList<String>()
        var last: String? = null
        for (sp in InlineMd.parse(s)) {
            val l = sp.link ?: continue
            if (l == last) continue
            last = l
            InlineMd.imagePath(l)?.let { paths += it } ?: run { others += l }
        }
        return paths to others
    }

    @Test fun 맥의_그림_경로() {
        val hanti = "/Users/me/Downloads/한티 마스터 01.png"
        assertEquals(listOf(hanti), pics("QR 그림은 맥에 저장했습니다. `$hanti`").first)
        check("저장 `$hanti`", text = "저장 $hanti", code = listOf(hanti))
        assertEquals(listOf("/Users/me/out/chart.png"), pics("저장: /Users/me/out/chart.png 를 보세요").first)
        assertEquals(listOf("/Users/me/out/chart.png"), pics("/Users/me/out/chart.png를 열어").first)
        assertEquals(listOf("~/Desktop/qr.PNG"), pics("만들었습니다 ~/Desktop/qr.PNG.").first)
        assertEquals(listOf("/a/1.png", "/b/2.jpeg"), pics("/a/1.png 와 /b/2.jpeg 둘").first)
        assertEquals(emptyList<String>(), pics("`/Users/me/a.txt` 와 /Users/me/b.pdf").first)
        assertEquals(emptyList<String>(), pics("/tmp/a.png.bak 남김").first)
        assertEquals(emptyList<String>(), pics("out/a.png 와 ./b.png").first)
        assertEquals(emptyList<String>(), pics("`open /tmp/a.png`").first)
        assertEquals(emptyList<String>() to listOf("https://example.com/a.png"), pics("https://example.com/a.png 를 보면"))
        assertEquals(emptyList<String>() to listOf("/tmp/a.png"), pics("[그림](/tmp/a.png) 뒤"))
    }

    @Test fun 블록() {
        val b = Markdown.parse("# 제목\n\n문단 한 줄\n둘째 줄\n\n- 하나\n  - 안쪽\n1. 첫째\n- [x] 끝냄\n\n```kotlin\nval a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> 인용\n\n---\n@/Users/me/.cache/pi-remote/img-123.jpg\n```\n닫히지 않은 코드")
        assertEquals(
            listOf(
                MdBlock.Heading(1, "제목"),
                MdBlock.Paragraph("문단 한 줄\n둘째 줄"),
                MdBlock.ListItem("•", 0, "하나"),
                MdBlock.ListItem("•", 1, "안쪽"),
                MdBlock.ListItem("1.", 0, "첫째"),
                MdBlock.ListItem("☑", 0, "끝냄"),
                MdBlock.Code("kotlin", "val a = 1"),
                MdBlock.Table(listOf(listOf("a", "b"), listOf("1", "2"))),
                MdBlock.Quote("인용"),
                MdBlock.Rule,
                MdBlock.Image("/Users/me/.cache/pi-remote/img-123.jpg"),
                MdBlock.Code("", "닫히지 않은 코드"),
            ),
            b,
        )
    }
}
