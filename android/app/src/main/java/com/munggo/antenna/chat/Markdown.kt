package com.munggo.antenna.chat

/**
 * 답변용 간단한 마크다운(아이폰 앱의 MarkdownParser·InlineMarkdown 과 같은 규칙).
 * 블록(제목·목록·코드·표·인용·구분선·문단)은 줄 단위로 나누고, 줄 안의 꾸밈(굵게·기울임·코드·링크·취소선)은 InlineMd 가 읽는다.
 * 쓰는 중에 아직 닫히지 않은 코드 블록도 코드로 보여 준다. 화면 꾸밈은 ui 쪽에서 입힌다
 */
sealed class MdBlock {
    data class Paragraph(val text: String) : MdBlock()
    data class Heading(val level: Int, val text: String) : MdBlock()
    data class ListItem(val marker: String, val indent: Int, val text: String) : MdBlock()
    data class Code(val lang: String, val code: String) : MdBlock()
    data class Table(val rows: List<List<String>>) : MdBlock()
    data class Quote(val text: String) : MdBlock()
    data object Rule : MdBlock()
    /** 한 줄이 사진 경로(![](…) 또는 @…)뿐일 때 */
    data class Image(val path: String) : MdBlock()
}

object Markdown {
    fun parse(text: String): List<MdBlock> {
        val blocks = ArrayList<MdBlock>()
        val para = ArrayList<String>()
        val table = ArrayList<List<String>>()
        val quote = ArrayList<String>()
        var inCode = false
        var codeLang = ""
        val code = ArrayList<String>()

        fun flushPara() { if (para.isNotEmpty()) { blocks += MdBlock.Paragraph(para.joinToString("\n")); para.clear() } }
        fun flushTable() { if (table.isNotEmpty()) { blocks += MdBlock.Table(table.toList()); table.clear() } }
        fun flushQuote() { if (quote.isNotEmpty()) { blocks += MdBlock.Quote(quote.joinToString("\n")); quote.clear() } }
        fun flushAll() { flushPara(); flushTable(); flushQuote() }

        for (raw in text.split("\n")) {
            val line = raw.replace("\t", "    ")
            val trimmed = line.trim(' ')
            if (inCode) {
                if (trimmed.startsWith("```")) {
                    blocks += MdBlock.Code(codeLang, code.joinToString("\n"))
                    inCode = false; code.clear()
                } else code += line
                continue
            }
            if (trimmed.startsWith("```")) {
                flushAll()
                inCode = true
                codeLang = trimmed.drop(3).trim()
                continue
            }
            if (trimmed.isBlank()) { flushAll(); continue }
            // 표: | a | b |
            if (trimmed.startsWith("|")) {
                flushPara(); flushQuote()
                val cells = splitRow(trimmed)
                if (!cells.all(::isSeparatorCell)) table += cells
                continue
            }
            flushTable()
            if (trimmed.startsWith(">")) {
                flushPara()
                quote += trimmed.drop(1).trim(' ')
                continue
            }
            flushQuote()
            // 한 줄이 사진 경로뿐이면 그림으로(~/.cache/pi-remote/img-* 만)
            val (paths, rest) = ImageTokens.split(trimmed)
            if (paths.isNotEmpty() && rest.isEmpty()) {
                flushPara()
                for (p in paths) blocks += MdBlock.Image(p)
                continue
            }
            val h = heading(trimmed)
            if (h != null) { flushPara(); blocks += h; continue }
            if (isRule(trimmed)) { flushPara(); blocks += MdBlock.Rule; continue }
            val item = listItem(line)
            if (item != null) { flushPara(); blocks += item; continue }
            para += line
        }
        if (inCode) blocks += MdBlock.Code(codeLang, code.joinToString("\n"))
        flushAll()
        return blocks
    }

    /** 글 속의 사진(한 줄짜리 사진 경로) */
    fun imagePaths(text: String): List<String> = parse(text).mapNotNull { (it as? MdBlock.Image)?.path }

    private fun heading(t: String): MdBlock? {
        val level = t.takeWhile { it == '#' }.length
        if (level !in 1..6 || t.length <= level || t[level] != ' ') return null
        return MdBlock.Heading(level, t.drop(level + 1))
    }

    private fun isRule(t: String): Boolean {
        val s = t.replace(" ", "")
        if (s.length < 3) return false
        val c = s[0]
        return c in "-*_" && s.all { it == c }
    }

    private fun listItem(line: String): MdBlock? {
        val lead = line.takeWhile { it == ' ' }.length
        val rest = line.drop(lead)
        val indent = lead / 2
        for (m in listOf("- ", "* ", "+ ")) if (rest.startsWith(m)) {
            val body = rest.drop(2)
            // 할 일 목록: - [ ] / - [x]
            if (body.startsWith("[ ] ")) return MdBlock.ListItem("☐", indent, body.drop(4))
            if (body.lowercase().startsWith("[x] ")) return MdBlock.ListItem("☑", indent, body.drop(4))
            return MdBlock.ListItem("•", indent, body)
        }
        // 1. 또는 1)
        val digits = rest.takeWhile { it.isDigit() }
        if (digits.isNotEmpty() && digits.length <= 3) {
            val after = rest.drop(digits.length)
            if (after.startsWith(". ") || after.startsWith(") ")) return MdBlock.ListItem("$digits.", indent, after.drop(2))
        }
        return null
    }

    private fun splitRow(t: String): List<String> {
        var s = t
        if (s.startsWith("|")) s = s.drop(1)
        if (s.endsWith("|")) s = s.dropLast(1)
        return s.split("|").map { it.trim() }
    }

    private fun isSeparatorCell(c: String): Boolean {
        val s = c.replace(":", "")
        return s.isNotEmpty() && s.all { it == '-' }
    }
}

/** 줄 안의 꾸밈 한 조각 */
data class InlineSpan(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val code: Boolean = false,
    val strike: Boolean = false,
    /** 링크 주소. 맥의 그림 경로면 antenna-image:<경로> */
    val link: String? = null,
)

/**
 * 줄 안의 꾸밈 해석(굵게 **·__, 기울임 *·_, 코드 `, 취소선 ~~, 링크 [글](주소)·<주소>·맨 주소).
 * 물결표 하나짜리는 취소선이 아니다('7~12개월 … 80~120g' 가 지운 글처럼 보이지 않게, 아이폰 앱 11-17 과 같다).
 * 맥의 그림 파일 경로는 누르면 앱에서 그 그림을 보는 링크로 만든다
 */
object InlineMd {
    const val IMAGE_SCHEME = "antenna-image"
    private const val IMAGE_EXT = "(?:png|jpe?g|gif|heic|heif|webp|bmp|tiff?)"
    /** 코드 글자 하나가 통째로 경로인 것 */
    private val wholePath = Regex("^(?:~/|/)(?!/)[^\\n`]*\\.$IMAGE_EXT$", RegexOption.IGNORE_CASE)
    /** 꾸밈 없는 글 속의 경로(띄어쓰기 없음). 앞이 글자·숫자·/·: 면 주소나 낱말의 일부라 보지 않고, 뒤에 붙은 조사·마침표는 뺀다 */
    private val barePath = Regex(
        "(?<![\\p{L}\\p{N}/_.~:\\-])(?:~/|/)(?!/)[^\\s`'\"<>()\\[\\]{}]*?\\.$IMAGE_EXT(?![A-Za-z0-9_]|\\.[A-Za-z0-9])",
        RegexOption.IGNORE_CASE,
    )
    private val autolink = Regex("""(?i)(?:https?://|ftp://|www\.)[^\s<]+""")

    fun imagePath(link: String): String? =
        if (link.startsWith("$IMAGE_SCHEME:")) java.net.URLDecoder.decode(link.substringAfter(':').replace("+", "%2B"), "UTF-8") else null

    private fun imageLink(path: String) = "$IMAGE_SCHEME:" + java.net.URLEncoder.encode(path, "UTF-8").replace("+", "%20")

    fun parse(s: String): List<InlineSpan> {
        val out = ArrayList<InlineSpan>()
        parseInto(s, Style(), out)
        return linkImagePaths(merge(out))
    }

    private data class Style(val bold: Boolean = false, val italic: Boolean = false, val strike: Boolean = false, val link: String? = null)

    private fun emit(out: MutableList<InlineSpan>, text: String, st: Style, code: Boolean = false) {
        if (text.isEmpty()) return
        out += InlineSpan(text, st.bold, st.italic, code, st.strike, st.link)
    }

    private fun parseInto(s: String, st: Style, out: MutableList<InlineSpan>) {
        val buf = StringBuilder()
        fun flush() { emit(out, buf.toString(), st); buf.clear() }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            // 역슬래시로 가린 글자
            if (c == '\\' && i + 1 < s.length && s[i + 1].isAsciiPunct()) { buf.append(s[i + 1]); i += 2; continue }
            // 코드 글자: 같은 수의 백틱으로 닫히면 그 안은 손대지 않는다
            if (c == '`') {
                val n = run(s, i, '`')
                val close = findBackticks(s, i + n, n)
                if (close >= 0) {
                    flush()
                    var code = s.substring(i + n, close).replace('\n', ' ')
                    if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.isNotBlank()) code = code.substring(1, code.length - 1)
                    emit(out, code, st, code = true)
                    i = close + n
                    continue
                }
                buf.append(s, i, i + n); i += n; continue
            }
            // 링크 [글](주소)
            if (c == '[' && st.link == null) {
                val close = matchBracket(s, i)
                if (close > 0 && close + 1 < s.length && s[close + 1] == '(') {
                    val end = matchParen(s, close + 1)
                    if (end > 0) {
                        val url = s.substring(close + 2, end).trim().substringBefore(' ')
                        if (url.isNotEmpty()) {
                            flush()
                            parseInto(s.substring(i + 1, close), st.copy(link = url), out)
                            i = end + 1
                            continue
                        }
                    }
                }
            }
            // <주소>
            if (c == '<' && st.link == null) {
                val end = s.indexOf('>', i + 1)
                if (end > 0) {
                    val inner = s.substring(i + 1, end)
                    if (Regex("(?i)^(https?|ftp)://\\S+$").matches(inner)) {
                        flush(); emit(out, inner, st.copy(link = inner)); i = end + 1; continue
                    }
                }
            }
            // 맨 주소(http… · www.). 주소 앞이 영문자면 낱말의 일부, www 는 앞이 빈칸·꾸밈 표시·여는 괄호일 때만(아이폰과 같다)
            if (st.link == null && c.lowercaseChar() in "hfw") {
                val prev = s.getOrNull(i - 1)
                val m = autolink.matchAt(s, i)
                val www = m != null && m.value.startsWith("www.", ignoreCase = true)
                val ok = m != null && if (www) (prev == null || prev.isWhitespace() || prev in "*_~(") else !(prev != null && prev.isAsciiLetter())
                if (m != null && ok) {
                    var url = m.value
                    // 문장 끝의 마침표·꾸밈 표시·짝 없는 닫는 괄호는 주소에 넣지 않는다
                    while (url.isNotEmpty()) {
                        val l = url.last()
                        if (l in ".,;:!?*_~") url = url.dropLast(1)
                        else if (l == ')' && url.count { it == '(' } < url.count { it == ')' }) url = url.dropLast(1)
                        else break
                    }
                    flush()
                    emit(out, url, st.copy(link = if (www) "http://$url" else url))
                    i += url.length
                    continue
                }
            }
            // 꾸밈 표시: ** __ ~~ * _ (물결표는 꼭 두 개일 때만 취소선)
            if (c == '*' || c == '_' || c == '~') {
                val n = run(s, i, c)
                val len = when {
                    c == '~' -> if (n == 2) 2 else 0
                    n >= 2 -> 2
                    else -> 1
                }
                if (len > 0 && canOpen(s, i, len, c)) {
                    val close = findCloser(s, i + len, c, len)
                    if (close > i + len) {
                        flush()
                        val inner = s.substring(i + len, close)
                        val next = when {
                            c == '~' -> st.copy(strike = true)
                            len == 2 -> st.copy(bold = true)
                            else -> st.copy(italic = true)
                        }
                        parseInto(inner, next, out)
                        i = close + len
                        continue
                    }
                }
                buf.append(s, i, i + n); i += n; continue
            }
            buf.append(c); i++
        }
        flush()
    }

    private fun Char.isAsciiLetter() = this in 'a'..'z' || this in 'A'..'Z'

    /** i 의 '(' 와 짝이 맞는 ')' 자리(주소 속 괄호를 건너뜀). 없으면 -1 */
    private fun matchParen(s: String, i: Int): Int {
        var depth = 0
        for (j in i until s.length) {
            when (s[j]) {
                '(' -> depth++
                ')' -> { depth--; if (depth == 0) return j }
                '\n' -> return -1
            }
        }
        return -1
    }

    private fun Char.isAsciiPunct() = this.code in 0x21..0x2F || this.code in 0x3A..0x40 || this.code in 0x5B..0x60 || this.code in 0x7B..0x7E

    private fun run(s: String, i: Int, c: Char): Int { var j = i; while (j < s.length && s[j] == c) j++; return j - i }

    private fun findBackticks(s: String, from: Int, count: Int): Int {
        var j = from
        while (j < s.length) {
            if (s[j] == '`') { val n = run(s, j, '`'); if (n == count) return j; j += n } else j++
        }
        return -1
    }

    private fun matchBracket(s: String, i: Int): Int {
        var depth = 0
        var j = i
        while (j < s.length) {
            when (s[j]) {
                '\\' -> j++
                '[' -> depth++
                ']' -> { depth--; if (depth == 0) return j }
                '`' -> { val n = run(s, j, '`'); val c = findBackticks(s, j + n, n); if (c >= 0) j = c + n - 1 else j += n - 1 }
            }
            j++
        }
        return -1
    }

    /** 여는 표시인지: 뒤가 빈칸이 아니고, 밑줄은 낱말 속(snake_case)이 아니어야 한다 */
    private fun canOpen(s: String, i: Int, len: Int, c: Char): Boolean {
        val after = s.getOrNull(i + len) ?: return false
        if (after.isWhitespace()) return false
        if (c == '_' && i > 0 && s[i - 1].isLetterOrDigit()) return false
        return true
    }

    /** 닫는 표시 자리(코드 글자 안은 건너뜀). 앞이 빈칸이 아니고, 밑줄은 뒤가 낱말 글자가 아니어야 한다 */
    private fun findCloser(s: String, from: Int, c: Char, len: Int): Int {
        var j = from
        while (j < s.length) {
            val ch = s[j]
            if (ch == '\\') { j += 2; continue }
            if (ch == '`') {
                val n = run(s, j, '`'); val e = findBackticks(s, j + n, n)
                j = if (e >= 0) e + n else j + n
                continue
            }
            if (ch == c) {
                val n = run(s, j, c)
                if (c == '~' && n != 2) { j += n; continue }
                // 굵게(2) 안의 기울임(1)처럼 더 긴 묶음은 안쪽 것으로 넘긴다
                if (n >= len && !s[j - 1].isWhitespace() && j > from &&
                    !(c == '_' && s.getOrNull(j + n)?.isLetterOrDigit() == true)) {
                    if (len == 1 && n == 2) { j += n; continue }
                    return j + (n - len)
                }
                j += n
                continue
            }
            j++
        }
        return -1
    }

    /** 꾸밈이 같은 이웃 조각을 합친다 */
    private fun merge(list: List<InlineSpan>): List<InlineSpan> {
        val out = ArrayList<InlineSpan>()
        for (sp in list) {
            val last = out.lastOrNull()
            if (last != null && last.copy(text = "") == sp.copy(text = "")) out[out.size - 1] = last.copy(text = last.text + sp.text)
            else out += sp
        }
        return out
    }

    /** 이미 링크인 곳은 그대로 두고, 그림 경로에 그림 링크를 단다 */
    private fun linkImagePaths(list: List<InlineSpan>): List<InlineSpan> {
        val out = ArrayList<InlineSpan>()
        for (sp in list) {
            if (sp.link != null) { out += sp; continue }
            if (sp.code) {
                out += if (wholePath.matches(sp.text)) sp.copy(link = imageLink(sp.text)) else sp
                continue
            }
            var last = 0
            for (m in barePath.findAll(sp.text)) {
                if (m.range.first > last) out += sp.copy(text = sp.text.substring(last, m.range.first))
                out += sp.copy(text = m.value, link = imageLink(m.value))
                last = m.range.last + 1
            }
            if (last < sp.text.length) out += sp.copy(text = sp.text.substring(last))
        }
        return out
    }
}
