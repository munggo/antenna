package com.munggo.antenna.ui.cards

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.ApprovalItem
import com.munggo.antenna.model.ApprovalScript
import com.munggo.antenna.tr
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.minus
import com.munggo.antenna.ui.plus

// 입력창 위 승인 카드(아이폰 앱 ios/PiRemote/ApprovalCard.swift 와 같은 모양)

/**
 * 입력창 위 승인 카드: 무엇을 · 어디로 · 내용(눌러서 펼침) · [거부] [허용]
 *
 * @param waiting 기다리는 승인 수(이 카드 포함). 2 이상이면 머리에 '1/N'
 * @param onAnswer 허용이면 true, 거부면 false
 */
@Composable
fun ApprovalCard(
    item: ApprovalItem,
    waiting: Int = 1,
    modifier: Modifier = Modifier,
    onAnswer: (Boolean) -> Unit,
) {
    val c = colors
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(item.id) { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    // 승인마다 처음 모양으로(입력창이 key 로 감싸지 않아도)
    var expanded by remember(item.id) { mutableStateOf(false) }
    var openScripts by remember(item.id) { mutableStateOf(setOf<String>()) }
    var contentExpanded by remember(item.id) { mutableStateOf(false) }
    val scroll = remember(item.id) { ScrollState(0) }

    val isSend = item.kind == "send"
    // 카드에 그대로 보일 글: 읽기 쉬운 항목, 사람에게 보낼 보통 글은 그대로. 명령·JSON·코드는 요약만
    val contentText: String? = when {
        !item.display.isNullOrEmpty() -> item.display
        isSend && item.guessed != true && item.codeLike != true -> item.detail
        else -> null
    }
    // 원본(명령·JSON)을 접어 둔 단추가 필요한지
    val hasHiddenRaw = contentText != item.detail
    val tint = if (isSend) c.accent else c.red
    val risk = item.risk.orEmpty()
    val riskColor = when (risk) {
        "상" -> c.red
        "중" -> c.accent
        else -> c.muted
    }
    val screen = LocalConfiguration.current.screenHeightDp.dp

    CardFrame(
        borderColor = tint.copy(alpha = 0.55f),
        // 가운데(무엇·맥락·요약·명령·스크립트): 길면 카드 안에서 스크롤(화면 절반까지)
        cap = screen * 0.45f,
        modifier = modifier.testTag("approvalCard"),
        top = {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // 위험도 색 동그라미 + '승인이 필요합니다 (중)'(이모지 대신 동그라미, 위험도는 괄호)
                Box(Modifier.size(9.dp).clip(CircleShape).background(if (risk.isEmpty()) tint else riskColor))
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = c.text)) { append(tr("승인이 필요합니다", "Approval needed")) }
                        if (risk.isNotEmpty()) withStyle(SpanStyle(color = riskColor)) { append(" (${riskName(risk)})") }
                    },
                    fontSize = Typo.row, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.testTag("approvalRisk"),
                )
                Spacer(Modifier.weight(1f))
                if (waiting > 1) {
                    Text(
                        "1/$waiting", fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.SemiBold, color = c.muted,
                        modifier = Modifier.clip(CircleShape).background(c.bgElevated)
                            .padding(horizontal = 8.dp, vertical = 3.dp).testTag("approvalQueue"),
                    )
                }
            }
        },
        bottom = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.weight(1f).height(42.dp).clip(CircleShape).background(c.surface)
                        .border(1.dp, c.border, CircleShape)
                        .clickable { onAnswer(false) }
                        .testTag("approvalDeny"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(tr("거부", "Deny"), fontSize = Typo.row, fontWeight = FontWeight.Medium, color = c.text)
                }
                Box(
                    Modifier.weight(1f).height(42.dp).clip(CircleShape).background(tint)
                        .clickable { onAnswer(true) }
                        .testTag("approvalAllow"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(tr("허용", "Allow"), fontSize = Typo.row, fontWeight = FontWeight.SemiBold, color = Color.White)
                }
            }
        },
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(scroll).animateContentSize(tween(180)).testTag("approvalScroll"),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // 가운데: 무엇을 하는 명령인지 한 문장. 나오기 전에는 하려는 일, 아래에 걸린 이유 · 하려는 일
            val sentence = item.headline.orEmpty()
            val purpose = item.purpose.orEmpty()
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                if (sentence.isNotEmpty()) {
                    SelectionContainer {
                        Text(
                            sentence, fontSize = Typo.row, fontWeight = FontWeight.Medium, color = c.text,
                            modifier = Modifier.testTag("approvalHeadline"),
                        )
                    }
                    item.summary?.takeIf { it.isNotEmpty() }?.let { note ->
                        Text(note, fontSize = Typo.row - 2.sp, color = c.muted, modifier = Modifier.testTag("approvalSummary"))
                    }
                } else {
                    Text(purpose.ifEmpty { item.label }, fontSize = Typo.row, fontWeight = FontWeight.Medium, color = c.text)
                    if (item.summarizing == true) {
                        Row(
                            Modifier.testTag("approvalSummarizing"),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            CircularProgressIndicator(Modifier.size(12.dp), color = c.muted, strokeWidth = 1.5.dp)
                            Text(tr("설명을 쓰는 중…", "Writing a summary…"), fontSize = Typo.caption + 1.sp, color = c.muted)
                        }
                    }
                }
                // 걸린 이유 · 하려는 일(작게)
                val reason = item.label + (if (item.guessed == true) tr("(글자로 판단)", " (guessed from the text)") else "")
                Text(
                    listOf(reason, if (sentence.isEmpty()) "" else purpose).filter { it.isNotEmpty() }.joinToString(" · "),
                    fontSize = Typo.caption + 1.sp, color = tint.copy(alpha = 0.9f),
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.testTag("approvalPurpose"),
                )
                item.to?.takeIf { it.isNotEmpty() }?.let { to ->
                    Text(tr("받는 곳: $to", "To: $to"), fontSize = Typo.caption + 1.sp, color = c.muted)
                }
            }
            if (contentText != null) {
                // 사람에게 보낼 글·읽기 쉬운 항목: 그대로(접히면 6줄, 누르면 전체)
                Text(
                    contentText, fontSize = Typo.row - 1.sp, lineHeight = 20.sp, color = c.text.copy(alpha = 0.92f),
                    maxLines = if (contentExpanded) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.bgElevated)
                        .clickable { contentExpanded = !contentExpanded }
                        .padding(10.dp)
                        .testTag("approvalContent"),
                )
            }
            if (hasHiddenRaw) {
                // 명령·JSON·코드: 핵심(요약)만 보이고, 원본은 눌러야 펼침
                val bash = item.source == "bash"
                val scripts = item.scripts.orEmpty()
                val label = if (expanded) {
                    if (bash) tr("명령 접기", "Hide command") else tr("원본 접기", "Hide original")
                } else {
                    (if (bash) tr("명령 보기", "Show command") else tr("원본 보기", "Show original")) +
                        (if (scripts.isEmpty()) "" else tr(" · 스크립트 ${scripts.size}개", if (scripts.size == 1) " · 1 script" else " · ${scripts.size} scripts"))
                }
                Row(
                    Modifier.fillMaxWidth().clickable { expanded = !expanded }.testTag("approvalShowCode"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        if (expanded) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null, tint = c.muted, modifier = Modifier.size(14.dp),
                    )
                    Text(label, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium, color = c.muted)
                }
                if (expanded) {
                    SelectionContainer(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.bgElevated).testTag("approvalDetail")) {
                        Text(
                            item.detail.ifEmpty { " " },
                            fontFamily = FontFamily.Monospace, fontSize = Typo.codeSmall + 0.5.sp, color = c.text.copy(alpha = 0.9f),
                            modifier = Modifier.fillMaxWidth().padding(10.dp),
                        )
                    }
                    scripts.forEach { sc ->
                        key(sc.path) {
                            ScriptRow(sc, open = sc.path in openScripts) {
                                openScripts = if (sc.path in openScripts) openScripts - sc.path else openScripts + sc.path
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 위험도 값(맥이 주는 상·중·하, 주고받는 값이라 바꾸지 않음)을 화면 말로. 한국어 화면은 그대로 */
private fun riskName(r: String): String = when (r) {
    "상" -> tr("상", "high")
    "중" -> tr("중", "medium")
    "하" -> tr("하", "low")
    else -> r
}

/** 실행하는 스크립트: 누르면 전문 */
@Composable
private fun ScriptRow(sc: ApprovalScript, open: Boolean, onToggle: () -> Unit) {
    val c = colors
    val lines = if (sc.lines == 1) "1 line" else "${sc.lines} lines"
    val title = tr(
        "📄 ${sc.path} · ${sc.lines}줄${if (sc.truncated) "(앞부분)" else ""}",
        "📄 ${sc.path} · $lines${if (sc.truncated) " (first part)" else ""}",
    )
    Column(Modifier.fillMaxWidth().testTag("approvalScript"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                if (open) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null, tint = c.text, modifier = Modifier.size(14.dp),
            )
            // 경로가 길면 앞을 잘라 파일 이름·줄 수가 보이게
            Text(
                title, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium, color = c.text,
                maxLines = 1, softWrap = false,
                modifier = Modifier.weight(1f).clipStart(),
            )
        }
        if (open) {
            Box(
                Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(10.dp)).background(c.bgElevated)
                    .verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()),
            ) {
                SelectionContainer {
                    Text(
                        sc.content, fontFamily = FontFamily.Monospace, fontSize = Typo.codeSmall,
                        color = c.text.copy(alpha = 0.9f), softWrap = false,
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }
        }
    }
}

/** 한 줄 글이 칸보다 길면 끝을 맞추고 앞을 자른다(경로의 앞부분을 버림) */
private fun Modifier.clipStart(): Modifier = clipToBounds().layout { measurable, constraints ->
    val p = measurable.measure(constraints.copy(minWidth = 0, maxWidth = Constraints.Infinity))
    val w = p.width.coerceIn(constraints.minWidth, constraints.maxWidth)
    val h = p.height.coerceIn(constraints.minHeight, constraints.maxHeight)
    layout(w, h) { p.place(minOf(0, w - p.width), 0) }
}
