package com.munggo.antenna.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.chat.InlineMd
import com.munggo.antenna.chat.Markdown
import com.munggo.antenna.chat.MdBlock
import com.munggo.antenna.session.ThumbStore
import com.munggo.antenna.tr

/** 코드 블록을 접는 줄 수(아이폰 앱처럼 화면 2장을 넘으면 반 장만). 코드 한 줄 높이를 약 17dp 로 친다 */
private const val CODE_LINE_DP = 17f

/**
 * 답변용 간단한 마크다운 그리기(아이폰 앱의 MarkdownView 와 같은 모양).
 * 블록은 Markdown.parse, 줄 안의 꾸밈은 InlineMd.parse. 맥의 그림 경로 링크는 누르면 앱에서 그 그림을 본다
 */
@Composable
fun MarkdownView(text: String, modifier: Modifier = Modifier, foldLongCode: Boolean = false) {
    val blocks = remember(text) { Markdown.parse(text) }
    SelectionContainer(modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxWidth()) {
            for (b in blocks) Block(b, foldLongCode)
        }
    }
}

@Composable
private fun Block(b: MdBlock, foldLongCode: Boolean) {
    val c = colors
    when (b) {
        is MdBlock.Paragraph -> Text(inline(b.text), color = c.text, fontSize = Typo.body, lineHeight = 26.sp)
        is MdBlock.Heading -> Text(
            inline(b.text), color = c.text, fontWeight = FontWeight.SemiBold,
            fontSize = when { b.level <= 1 -> Typo.h1; b.level == 2 -> Typo.h2; else -> Typo.h3 },
            modifier = Modifier.padding(top = 4.dp),
        )
        is MdBlock.ListItem -> Row(Modifier.padding(start = (b.indent * 16).dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(b.marker, color = c.text, fontSize = Typo.body, lineHeight = 26.sp, textAlign = TextAlign.End, modifier = Modifier.widthIn(min = 14.dp))
            Text(inline(b.text), color = c.text, fontSize = Typo.body, lineHeight = 26.sp)
        }
        is MdBlock.Code -> CodeBlock(b.lang, b.code, foldLongCode)
        is MdBlock.Table -> TableBlock(b.rows)
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.width(3.dp).fillMaxHeight().clip(RoundedCornerShape(1.5.dp)).background(c.surfaceHigh))
            Text(inline(b.text), color = c.muted, fontSize = Typo.quote, lineHeight = 22.sp)
        }
        MdBlock.Rule -> Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).height(1.dp).background(c.border))
        is MdBlock.Image -> ThumbImage(
            b.path, ThumbStore.Size.Large, fit = true,
            modifier = Modifier.fillMaxWidth().heightIn(max = 440.dp).height(240.dp).clip(RoundedCornerShape(14.dp)),
        )
    }
}

/** 줄 안의 꾸밈 → 글자 모양. 코드는 고정폭 + 강조색, 맥의 그림 경로는 밑줄 */
@Composable
fun inline(s: String): AnnotatedString {
    val c = colors
    val session = LocalSession.current
    val uri = LocalUriHandler.current
    return remember(s, c) {
        buildAnnotatedString {
            for (sp in InlineMd.parse(s)) {
                val style = SpanStyle(
                    fontWeight = if (sp.bold) FontWeight.SemiBold else null,
                    fontStyle = if (sp.italic) FontStyle.Italic else null,
                    fontFamily = if (sp.code) FontFamily.Monospace else null,
                    fontSize = if (sp.code) Typo.inlineCode else androidx.compose.ui.unit.TextUnit.Unspecified,
                    color = if (sp.code) c.codeInline else Color.Unspecified,
                    textDecoration = if (sp.strike) TextDecoration.LineThrough else null,
                )
                val link = sp.link
                if (link == null) withStyle(style) { append(sp.text) }
                else {
                    val image = InlineMd.imagePath(link)
                    val linkStyle = TextLinkStyles(SpanStyle(color = if (image != null && sp.code) c.codeInline else c.accent, textDecoration = if (image != null) TextDecoration.Underline else null))
                    val ann = LinkAnnotation.Clickable(link, linkStyle) {
                        if (image != null) session.thumbs.viewing = image
                        else runCatching { uri.openUri(link) }
                    }
                    withLink(ann) { withStyle(style) { append(sp.text) } }
                }
            }
        }
    }
}

@Composable
fun CodeBlock(lang: String, code: String, foldable: Boolean) {
    val c = colors
    val page = Fold.page()
    val limitLines = ((page * 2).value / CODE_LINE_DP).toInt()
    val foldedLines = ((page * 0.5f).value / CODE_LINE_DP).toInt()
    val lines = remember(code) { code.count { it == '\n' } + 1 }
    val long = foldable && lines > limitLines
    // 스스로 접는 것은 처음 그릴 때 이미 길었던 코드뿐이다(쓰는 중에 자라난 코드는 그대로 두고 '접기'만 붙임)
    var folded by remember { mutableStateOf(long) }
    val collapsed = long && folded
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.bgElevated).border(1.dp, c.border, RoundedCornerShape(12.dp)),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(lang, color = c.muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.weight(1f))
            CopyButton(code, tr("코드 복사", "Copy code"))
        }
        Box {
            Text(
                if (collapsed) code.lineSequence().take(foldedLines).joinToString("\n") else code,
                color = c.text, fontSize = Typo.code, fontFamily = FontFamily.Monospace, softWrap = false,
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),
            )
        }
        if (long) Box(Modifier.padding(start = 12.dp, bottom = 4.dp)) { FoldToggle(collapsed) { folded = !collapsed } }
    }
}

@Composable
private fun TableBlock(rows: List<List<String>>) {
    val c = colors
    val cols = rows.maxOfOrNull { it.size } ?: 0
    // 칸이 줄을 넘지 않으므로(옆으로 밀어 봄) 열마다 세로로 쌓아도 줄이 맞는다
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.bgElevated).border(1.dp, c.border, RoundedCornerShape(12.dp))
            .horizontalScroll(rememberScrollState()).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        for (ci in 0 until cols) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                rows.forEachIndexed { r, row ->
                    Text(
                        inline(row.getOrNull(ci) ?: ""), softWrap = false, fontSize = Typo.table,
                        fontWeight = if (r == 0) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (r == 0) c.text else c.text.copy(alpha = 0.9f),
                    )
                }
            }
        }
    }
}
