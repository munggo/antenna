package com.munggo.antenna.ui.cards

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.LiveHelp
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.QuestionItem
import com.munggo.antenna.model.QuestionOption
import com.munggo.antenna.model.QuestionSub
import com.munggo.antenna.tr
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.inline
import com.munggo.antenna.ui.minus
import com.munggo.antenna.ui.plus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 입력창 위 질문 카드(아이폰 앱 ios/PiRemote/QuestionCard.swift 와 같은 모양·흐름)

private val CardGap = 10.dp
private val MinMiddle = 56.dp

/**
 * 카드 틀(승인·질문 카드가 같이 씀): 위(머리)·아래(버튼)는 늘 다 보이고, 가운데 스크롤 칸만 자리에 맞춘다.
 * 가운데는 [cap] 까지 내용만큼 자라고, 자리가 모자라면(키보드가 올라옴) 56dp 까지 줄어든다.
 * 고정 높이였을 때는 카드가 화면을 넘쳐 아래 버튼이 키보드 뒤로 숨었다(아이폰 앱의 cardScrollHeight)
 */
@Composable
internal fun CardFrame(
    borderColor: Color,
    cap: Dp,
    modifier: Modifier = Modifier,
    top: @Composable () -> Unit = {},
    bottom: @Composable () -> Unit = {},
    middle: @Composable () -> Unit,
) {
    val c = colors
    val shape = RoundedCornerShape(16.dp)
    // 기본 글 모양(줄 높이 24sp·자간 0.5sp)은 작은 글에 너무 성겨서, 글자 크기에 맞는 줄 높이·자간 0 으로(아이폰 앱처럼)
    CompositionLocalProvider(LocalTextStyle provides LocalTextStyle.current.copy(lineHeight = TextUnit.Unspecified, letterSpacing = 0.sp)) {
        Layout(
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(CardGap)) { top() }
                Box { middle() }
                Column(verticalArrangement = Arrangement.spacedBy(CardGap)) { bottom() }
            },
            modifier = modifier.fillMaxWidth().clip(shape).background(c.surfaceHigh).border(1.dp, borderColor, shape).padding(12.dp),
        ) { measurables, constraints ->
            val gap = CardGap.roundToPx()
            val loose = constraints.copy(minWidth = 0, minHeight = 0)
            val topP = measurables[0].measure(loose)
            val bottomP = measurables[2].measure(loose)
            val fixed = topP.height + bottomP.height + (if (topP.height > 0) gap else 0) + (if (bottomP.height > 0) gap else 0)
            val capPx = cap.roundToPx()
            val room = if (constraints.hasBoundedHeight) constraints.maxHeight - fixed else Constraints.Infinity
            val midMax = minOf(capPx, maxOf(room, minOf(capPx, MinMiddle.roundToPx())))
            val midP = measurables[1].measure(loose.copy(maxHeight = maxOf(0, midMax)))
            val parts = listOf(topP, midP, bottomP).filter { it.height > 0 }
            val width = if (constraints.hasBoundedWidth) constraints.maxWidth else (parts.maxOfOrNull { it.width } ?: 0)
            val height = parts.sumOf { it.height } + gap * maxOf(0, parts.size - 1)
            layout(width.coerceIn(constraints.minWidth, constraints.maxWidth), height.coerceIn(constraints.minHeight, constraints.maxHeight)) {
                var y = 0
                for (p in parts) {
                    p.placeRelative(0, y)
                    y += p.height + gap
                }
            }
        }
    }
}

/**
 * 입력창 위 질문 카드(Claude 앱 방식)
 * - 하나 고르기: 선택지를 누르면 바로 답
 * - 여러 개 고르기: 체크한 뒤 [보내기]
 * - 기타: 입력창에 직접 써서 보내면 그 글이 답(입력창이 [picked] 와 함께 보냄)
 * 질문·선택지가 길면 카드 안에서 스크롤한다(키보드가 올라오면 더 낮게).
 *
 * @param picked 체크한 선택지 번호(여러 개 고르기). 입력창이 들고 있다가 '기타' 글과 함께 보내고, 질문이 바뀌면 비운다
 * @param compact 키보드가 올라와 있으면 카드를 낮게(입력창이 가려지지 않게)
 * @param onAnswer 고른 답(선택지 글). 여러 개 고르기면 선택지 순서대로
 * @param onOther '기타(직접 입력)'를 누름: 입력창에 초점을 옮긴다
 * @param onCancel 확인 창 취소(맥에서 Esc 를 누른 것과 같음). [QuestionItem.isPrompt] 일 때만 단추가 보인다
 */
@Composable
fun QuestionCard(
    item: QuestionItem,
    picked: Set<Int>,
    onPickedChange: (Set<Int>) -> Unit,
    compact: Boolean,
    onAnswer: (List<String>) -> Unit,
    onOther: () -> Unit,
    modifier: Modifier = Modifier,
    onCancel: () -> Unit = {},
) {
    val c = colors
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(item.id) { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    val screen = LocalConfiguration.current.screenHeightDp.dp
    // 카드 안 스크롤 영역의 최대 높이
    val cap = if (compact) minOf(170.dp, screen * 0.2f) else screen * 0.5f
    val scroll = remember(item.id) { ScrollState(0) }
    // 아직 재지 않았으면 maxValue 가 Int.MAX_VALUE
    val overflow = scroll.maxValue != Int.MAX_VALUE && scroll.maxValue > 1

    CardFrame(
        borderColor = c.accent.copy(alpha = 0.55f),
        cap = cap,
        modifier = modifier.testTag("questionCard"),
        bottom = {
            if (item.multi) {
                val ordered = picked.sorted().mapNotNull { item.options.getOrNull(it)?.label }
                Box(
                    Modifier.fillMaxWidth().height(42.dp).clip(CircleShape)
                        .background(c.accent.copy(alpha = if (picked.isEmpty()) 0.4f else 1f))
                        .clickable(enabled = picked.isNotEmpty()) { onAnswer(ordered) }
                        .testTag("questionSubmit"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (picked.isEmpty()) tr("골라 주세요", "Pick one") else tr("보내기(${picked.size}개)", "Send (${picked.size})"),
                        fontSize = Typo.row, fontWeight = FontWeight.SemiBold, color = Color.White,
                    )
                }
            }
            if (item.isPrompt) CancelRow(onCancel)
        },
    ) {
        Box {
            Column(
                Modifier.fillMaxWidth().verticalScroll(scroll)
                    // 끝까지 내리면 마지막 줄이 흐림에 가리지 않게
                    .padding(bottom = if (overflow) 16.dp else 0.dp)
                    .testTag("questionScroll"),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuestionHeader(item)
                if (item.kind == "confirm") {
                    ConfirmRow(item, onAnswer)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        item.options.forEachIndexed { i, o ->
                            OptionRow(i, o, multi = item.multi, on = i in picked) {
                                if (item.multi) {
                                    onPickedChange(if (i in picked) picked - i else picked + i)
                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                } else {
                                    onAnswer(listOf(o.label))
                                }
                            }
                        }
                        if (item.allowsOther) OtherRow(input = item.kind == "input", onClick = onOther)
                    }
                }
            }
            // 아래에 더 있음을 알리는 흐림(누름은 아래 스크롤로 그대로 간다)
            if (overflow) {
                Box(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(22.dp)
                        .background(Brush.verticalGradient(listOf(c.surfaceHigh.copy(alpha = 0f), c.surfaceHigh))),
                )
            }
        }
    }
}

/** 질문 첫 줄은 제목처럼(길면 보통 굵기), 나머지는 본문 */
@Composable
private fun QuestionHeader(item: QuestionItem) {
    val c = colors
    val q = item.question.trim()
    val nl = q.indexOf('\n')
    val title = if (nl < 0) q else q.substring(0, nl)
    val rest = if (nl < 0) "" else q.substring(nl + 1).trim()
    Column(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.testTag("questionText"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.AutoMirrored.Filled.LiveHelp, contentDescription = null, tint = c.accent,
                modifier = Modifier.padding(top = 2.dp).size(18.dp),
            )
            Text(
                inline(title), fontSize = Typo.row, color = c.text,
                fontWeight = if (title.length > 100) FontWeight.Normal else FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
        }
        if (rest.isNotEmpty()) {
            Text(inline(rest), fontSize = Typo.row - 1.sp, lineHeight = 21.sp, color = c.text.copy(alpha = 0.9f))
        }
        if (item.multi) {
            Text(tr("여러 개 고를 수 있어요", "You can pick more than one"), fontSize = Typo.caption + 1.sp, color = c.muted)
        }
        if (item.kind == "input") {
            Text(tr("아래 입력창에 써서 보내 주세요", "Type your answer in the box below"), fontSize = Typo.caption + 1.sp, color = c.muted)
        }
    }
}

/** 선택지 한 줄. 긴 선택지도 자르지 않고 전부 보여 줌 */
@Composable
private fun OptionRow(i: Int, o: QuestionOption, multi: Boolean, on: Boolean, onClick: () -> Unit) {
    val c = colors
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(c.bgElevated)
            .border(1.dp, if (on) c.accent else c.border.copy(alpha = 0.6f), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("questionOption-$i"),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (multi) {
            Icon(
                if (on) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, contentDescription = null,
                tint = if (on) c.accent else c.muted, modifier = Modifier.size(20.dp),
            )
        } else {
            Box(Modifier.size(22.dp).clip(CircleShape).background(c.surface), contentAlignment = Alignment.Center) {
                Text("${i + 1}", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.muted)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(inline(o.label), fontSize = Typo.row, fontWeight = FontWeight.Medium, lineHeight = 21.sp, color = c.text)
            o.description?.takeIf { it.isNotEmpty() }?.let { d ->
                Text(inline(d), fontSize = Typo.caption + 1.sp, lineHeight = 19.sp, color = c.muted)
            }
        }
    }
}

/** 기타: 입력창으로 가서 직접 쓰기 */
@Composable
private fun OtherRow(input: Boolean, onClick: () -> Unit) {
    val c = colors
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).border(1.dp, c.border.copy(alpha = 0.6f), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("questionOther"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Edit, contentDescription = null, tint = c.muted, modifier = Modifier.size(16.dp))
        }
        Text(
            if (input) tr("입력해서 답하기", "Type an answer") else tr("기타(직접 입력)", "Other (type your own)"),
            fontSize = Typo.row, color = c.muted,
        )
    }
}

/** 예/아니오 창: 버튼 두 개(아니오 · 예). 첫 선택지가 '예' */
@Composable
private fun ConfirmRow(item: QuestionItem, onAnswer: (List<String>) -> Unit) {
    val c = colors
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item.options.withIndex().reversed().forEach { (i, o) ->
            val yes = i == 0
            Box(
                Modifier.weight(1f).height(42.dp).clip(CircleShape)
                    .background(if (yes) c.accent else c.bgElevated)
                    .border(1.dp, if (yes) Color.Transparent else c.border.copy(alpha = 0.6f), CircleShape)
                    .clickable { onAnswer(listOf(o.label)) }
                    .testTag("questionOption-$i"),
                contentAlignment = Alignment.Center,
            ) {
                Text(o.label, fontSize = Typo.row, fontWeight = FontWeight.SemiBold, color = if (yes) Color.White else c.text)
            }
        }
    }
}

/** 확인 창 취소(맥에서 Esc 를 누른 것과 같음) */
@Composable
private fun CancelRow(onCancel: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(30.dp).clickable(onClick = onCancel).testTag("questionCancel"),
        contentAlignment = Alignment.Center,
    ) {
        Text(tr("취소", "Cancel"), fontSize = Typo.row - 1.sp, color = colors.muted)
    }
}

/**
 * 여러 질문 카드: 한 번에 질문 하나(맥 번호 상자와 같은 흐름)
 * - 하나 고르기: 누르면 바로 다음 질문, 마지막 질문이면 바로 보냄
 * - 여러 개 고르기·'기타' 입력: 고른 뒤 [다음](키보드 리턴도)으로 넘김
 * - [이전]으로 앞 질문에 돌아가 답을 바꿀 수 있음(고른 답은 남아 있음)
 *
 * @param compact 입력창에 키보드가 올라와 있으면 카드를 낮게
 * @param onSubmit 질문 순서대로 (고른 선택지 글, '기타' 글) 쌍. [com.munggo.antenna.session.BridgeSession.answerQuestions] 의 items 와 같은 꼴
 */
@Composable
fun MultiQuestionCard(
    item: QuestionItem,
    compact: Boolean,
    modifier: Modifier = Modifier,
    onSubmit: (List<Pair<List<String>, String>>) -> Unit,
) {
    val c = colors
    val subs = item.items.orEmpty()
    val haptic = LocalHapticFeedback.current
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(item.id) { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }

    val picks = remember(item.id, subs.size) { mutableStateListOf<Set<Int>>().apply { repeat(subs.size) { add(emptySet()) } } }
    val others = remember(item.id, subs.size) { mutableStateListOf<String>().apply { repeat(subs.size) { add("") } } }
    var step by remember(item.id, subs.size) { mutableIntStateOf(0) }
    var sent by remember(item.id) { mutableStateOf(false) }
    // 카드 안 '기타' 칸에 쓰는 중인 질문 번호(키보드가 올라와 있음)
    var otherFocus by remember(item.id) { mutableStateOf<Int?>(null) }
    val scroll = remember(item.id) { ScrollState(0) }

    val screen = LocalConfiguration.current.screenHeightDp.dp
    val cap = if (compact || otherFocus != null) minOf(220.dp, screen * 0.25f) else screen * 0.55f

    fun isLast() = step >= subs.size - 1
    fun answered(i: Int) = i < picks.size && i < others.size && (picks[i].isNotEmpty() || others[i].isNotBlank())

    fun go(i: Int) {
        if (i !in subs.indices) return
        otherFocus = null
        focusManager.clearFocus()
        step = i
    }

    // 다음 질문으로, 마지막이면 보냄(답 안 한 질문이 남아 있으면 그 질문으로)
    fun next() {
        if (!answered(step) || sent) return
        if (!isLast()) { go(step + 1); return }
        val miss = subs.indices.firstOrNull { !answered(it) }
        if (miss != null) { go(miss); return }
        sent = true
        otherFocus = null
        focusManager.clearFocus()
        onSubmit(subs.indices.map { i ->
            picks[i].sorted().mapNotNull { subs[i].options.getOrNull(it)?.label } to others[i].trim()
        })
    }

    // 새 질문은 맨 위부터
    LaunchedEffect(step) { scroll.scrollTo(0) }
    // '기타' 칸에 쓰기 시작하면 키보드가 다 올라온 뒤 그 칸이 보이게(칸은 질문의 맨 아래)
    LaunchedEffect(otherFocus) {
        if (otherFocus != null) {
            delay(350)
            scroll.animateScrollTo(scroll.maxValue)
        }
    }

    CardFrame(
        borderColor = c.accent.copy(alpha = 0.55f),
        cap = cap,
        modifier = modifier.testTag("questionCard"),
        top = {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.AutoMirrored.Filled.LiveHelp, contentDescription = null, tint = c.accent, modifier = Modifier.size(18.dp))
                val n = minOf(step, maxOf(subs.size - 1, 0)) + 1
                Text(
                    tr("질문 $n/${subs.size}", "Question $n/${subs.size}"),
                    fontSize = Typo.row, fontWeight = FontWeight.SemiBold, color = c.text,
                    modifier = Modifier.testTag("questionStep"),
                )
                Spacer(Modifier.weight(1f))
                // 진행 점: 지금 질문은 길게, 답한 질문은 주황
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    subs.indices.forEach { i ->
                        Box(
                            Modifier.width(if (i == step) 16.dp else 6.dp).height(6.dp).clip(CircleShape)
                                .background(if (i == step || answered(i)) c.accent else c.muted.copy(alpha = 0.35f)),
                        )
                    }
                }
            }
        },
        bottom = {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (step > 0) {
                    Row(
                        Modifier.height(40.dp).clip(CircleShape).background(c.bgElevated)
                            .clickable { go(step - 1) }
                            .padding(horizontal = 16.dp)
                            .testTag("questionPrev"),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
                        Text(tr("이전", "Back"), fontSize = Typo.row, fontWeight = FontWeight.Medium, color = c.text)
                    }
                }
                Spacer(Modifier.weight(1f))
                val ok = answered(step)
                val last = isLast()
                Row(
                    Modifier.height(40.dp).clip(CircleShape).background(c.accent.copy(alpha = if (ok) 1f else 0.4f))
                        .clickable(enabled = ok && !sent) { next() }
                        .padding(horizontal = 18.dp)
                        .testTag(if (last) "questionSubmit" else "questionNext"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(if (last) tr("보내기", "Send") else tr("다음", "Next"), fontSize = Typo.row, fontWeight = FontWeight.SemiBold, color = Color.White)
                    if (!last) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                }
            }
        },
    ) {
        if (step in subs.indices) {
            Column(Modifier.fillMaxWidth().verticalScroll(scroll).testTag("questionScroll")) {
                // 넘기는 방향으로 밀려 들어옴(앞으로는 오른쪽에서, 이전은 왼쪽에서)
                AnimatedContent(
                    targetState = step,
                    transitionSpec = {
                        val fwd = targetState > initialState
                        (slideInHorizontally(tween(220)) { w -> if (fwd) w else -w } + fadeIn(tween(220))) togetherWith fadeOut(tween(220))
                    },
                    label = "questionStep",
                ) { s ->
                    if (s in subs.indices) {
                        MultiBlock(
                            i = s,
                            sub = subs[s],
                            picked = picks.getOrElse(s) { emptySet() },
                            other = others.getOrElse(s) { "" },
                            last = s >= subs.size - 1,
                            onPick = { j ->
                                if (s < picks.size && !sent) {
                                    if (subs[s].multiSelect == true) {
                                        picks[s] = if (j in picks[s]) picks[s] - j else picks[s] + j
                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    } else {
                                        // 하나 고르기: 고른 것을 잠깐 보여 준 뒤 다음 질문(마지막이면 보냄)
                                        picks[s] = setOf(j)
                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                        scope.launch {
                                            delay(250)
                                            if (step == s) next()
                                        }
                                    }
                                }
                            },
                            onOther = { if (s < others.size) { others[s] = it } },
                            onReturn = { next() },
                            onFocus = { f ->
                                if (f) {
                                    otherFocus = s
                                } else if (otherFocus == s) {
                                    otherFocus = null
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

/** 여러 질문 카드의 질문 하나: 질문 · 선택지 · '기타' 칸 */
@Composable
private fun MultiBlock(
    i: Int,
    sub: QuestionSub,
    picked: Set<Int>,
    other: String,
    last: Boolean,
    onPick: (Int) -> Unit,
    onOther: (String) -> Unit,
    onReturn: () -> Unit,
    onFocus: (Boolean) -> Unit,
) {
    val c = colors
    val multi = sub.multiSelect ?: false
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            inline(sub.question), fontSize = Typo.row, fontWeight = FontWeight.SemiBold, color = c.text,
            modifier = Modifier.testTag("mq-$i-question"),
        )
        if (multi) {
            Text(tr("여러 개 고를 수 있어요", "You can pick more than one"), fontSize = Typo.caption + 1.sp, color = c.muted)
        }
        sub.options.forEachIndexed { j, o ->
            val on = j in picked
            Row(
                Modifier.fillMaxWidth().clip(shape).background(c.bgElevated)
                    .border(1.dp, if (on) c.accent else c.border.copy(alpha = 0.6f), shape)
                    .clickable { onPick(j) }
                    .padding(horizontal = 12.dp, vertical = 9.dp)
                    .testTag("mq-$i-$j"),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    when {
                        multi && on -> Icons.Filled.CheckBox
                        multi -> Icons.Filled.CheckBoxOutlineBlank
                        on -> Icons.Filled.RadioButtonChecked
                        else -> Icons.Filled.RadioButtonUnchecked
                    },
                    contentDescription = null, tint = if (on) c.accent else c.muted, modifier = Modifier.size(20.dp),
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(inline(o.label), fontSize = Typo.row, fontWeight = FontWeight.Medium, color = c.text)
                    o.description?.takeIf { it.isNotEmpty() }?.let { d ->
                        Text(inline(d), fontSize = Typo.caption + 1.sp, color = c.muted)
                    }
                }
            }
        }
        // 기타: 한 줄로 쓰고 리턴이면 다음(마지막이면 보냄). 안쪽 여백은 꾸밈 칸에 둬야 여백을 눌러도 칸이 잡힌다
        BasicTextField(
            value = other,
            onValueChange = onOther,
            singleLine = true,
            textStyle = TextStyle(color = c.text, fontSize = Typo.row - 1.sp),
            cursorBrush = SolidColor(c.accent),
            keyboardOptions = KeyboardOptions(imeAction = if (last) ImeAction.Send else ImeAction.Next),
            keyboardActions = KeyboardActions(onSend = { onReturn() }, onNext = { onReturn() }),
            modifier = Modifier.fillMaxWidth()
                .border(1.dp, c.border.copy(alpha = 0.6f), shape)
                .onFocusChanged { onFocus(it.isFocused) }
                .testTag("mq-$i-other"),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                    if (other.isEmpty()) {
                        Text(tr("기타(직접 입력)", "Other (type your own)"), fontSize = Typo.row - 1.sp, color = c.muted)
                    }
                    inner()
                }
            },
        )
    }
}
