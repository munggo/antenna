package com.munggo.antenna.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.chat.ChatItem
import com.munggo.antenna.chat.StepText
import com.munggo.antenna.chat.ToolCallInfo
import com.munggo.antenna.model.ToolDetail
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr
import com.munggo.antenna.ui.CloseCircle
import com.munggo.antenna.ui.CopyButton
import com.munggo.antenna.ui.MarkdownView
import com.munggo.antenna.ui.StatsBadge
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.minus
import com.munggo.antenna.ui.plus
import kotlinx.coroutines.delay

/**
 * 단계 창(Claude 앱처럼 아래에서 올라옴, 아이폰 앱의 StepsSheet 와 같다)
 * - 단계 줄을 누르면: 단계 목록(아이콘·한 줄 설명·+/− 줄 수, 세로 선으로 이어짐)
 * - 단계를 누르면: 전체 명령·출력 / 바뀐 줄 / 생각 내용 — 맥에 요청해 받아 온다
 * - 실행 중인 단계·쓰는 중인 생각은 창이 열려 있는 동안 2초마다 새로 받는다
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StepsSheet(request: StepsRequest, session: BridgeSession, onDismiss: () -> Unit) {
    val store = session.chat
    // 최신 단계 목록(작업 중이면 늘어남)
    val steps = request.groupId?.let { gid -> store.items.firstNotNullOfOrNull { (it as? ChatItem.Tools)?.takeIf { t -> t.id == gid }?.calls } } ?: request.steps
    // 단계가 하나뿐이면 목록 없이 바로 상세
    val direct = request.steps.size == 1
    var openId by remember { mutableStateOf<String?>(if (direct) request.steps[0].id else null) }
    val open = openId?.let { id -> steps.firstOrNull { it.id == id } ?: request.steps.firstOrNull { it.id == id } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false), containerColor = colors.bg) {
        Column(Modifier.fillMaxWidth().heightIn(min = 300.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (open != null && !direct) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, tr("뒤로", "Back"), tint = colors.text,
                        modifier = Modifier.size(32.dp).clickable { openId = null }.padding(4.dp))
                } else CloseCircle(onDismiss)
                Text(
                    if (open != null) StepText.title(open) else StepText.groupTitle(steps),
                    color = colors.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                )
                if (open != null && !direct) CloseCircle(onDismiss)
            }
            if (open != null) StepDetail(open, session)
            else Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp).testTag("stepsList")) {
                steps.forEachIndexed { i, s ->
                    StepRow(s, isLast = i == steps.size - 1, modifier = Modifier.clickable { openId = s.id }.testTag("stepRow-$i"))
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** 목록의 단계 한 줄: 아이콘(아래로 세로 선) · 동사 · +/− · › / 아래에 설명 */
@Composable
private fun StepRow(step: ToolCallInfo, isLast: Boolean, modifier: Modifier) {
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.width(26.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) { StepIcon(step, 17f) }
            if (!isLast) Box(Modifier.width(1.5.dp).weight(1f).background(colors.border))
        }
        Column(Modifier.weight(1f).padding(bottom = if (isLast) 4.dp else 22.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.heightIn(min = 26.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(StepText.verb(step), color = colors.text, fontSize = Typo.body, fontWeight = FontWeight.Medium)
                if (step.state == "running" || step.state == "pending") CircularProgressIndicator(Modifier.size(14.dp), color = colors.muted, strokeWidth = 1.5.dp)
                if (step.state == "error") Icon(Icons.Outlined.Warning, null, tint = colors.muted, modifier = Modifier.size(14.dp))
                Spacer(Modifier.weight(1f))
                step.stats?.let { StatsBadge(it) }
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = colors.muted, modifier = Modifier.size(16.dp))
            }
            val sub = StepText.subject(step)
            if (sub.isNotEmpty()) Text(sub, color = colors.muted, fontSize = Typo.row, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun StepDetail(step: ToolCallInfo, session: BridgeSession) {
    val store = session.chat
    val detail: ToolDetail? = store.details[step.id]
    // 아직 진행 중(실행 중인 도구 / 쓰는 중인 생각) → 2초마다 새로 받음
    val live = if (step.thinking) store.isLiveThinking(step.id) else (store.working && !store.hasResult(step.id))
    LaunchedEffect(step.id, live) {
        val fetch = { session.requestDetail(step.id, if (step.thinking) "thinking" else "tool", step.id, step.ref ?: "") }
        if (live) while (true) { fetch(); delay(2000) } else fetch()
    }
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp).testTag("stepDetail"),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        if (!step.thinking) detail?.error?.let { Notice(it) }
        if (step.thinking) {
            val t = detail?.text
            when {
                t != null -> {
                    if (live) Text(tr("생각하는 중 — 2초마다 새로 받아요", "Thinking — refreshing every 2 seconds"), color = colors.muted, fontSize = Typo.caption)
                    MarkdownView(t.ifEmpty { tr("(아직 내용이 없어요)", "(Nothing yet)") }, Modifier.testTag("thinkingText"))
                }
                detail?.error == null -> Loading()
                else -> Notice(detail.error)
            }
        } else {
            // 질문은 아래 '질문' 칸에 전체가 나오므로 제목 줄은 생략
            if (step.desc.isNotEmpty() && !StepText.isFile(step) && step.name != "ask_user") {
                Text(step.desc, color = colors.text, fontSize = Typo.body, fontWeight = FontWeight.SemiBold)
            }
            when (step.name) {
                "bash" -> { Section(tr("명령", "Command"), detail?.command ?: step.summary); Output(step, detail, live) }
                "edit" -> {
                    PathRow(step, detail)
                    val edits = detail?.edits
                    if (edits != null) edits.forEachIndexed { i, e ->
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (edits.size > 1) Text(tr("바뀐 곳 ${i + 1}", "Change ${i + 1}"), color = colors.muted, fontSize = Typo.caption, fontWeight = FontWeight.Medium)
                            DiffView(e.old, e.new)
                        }
                    } else if (detail == null) Loading()
                    if (detail?.isError == true && !detail.output.isNullOrEmpty()) Section(tr("오류", "Error"), detail.output, tint = colors.red)
                }
                "write" -> {
                    PathRow(step, detail)
                    val content = detail?.content
                    if (content != null) Section(tr("내용", "Content"), content) else if (detail == null) Loading()
                    if (detail?.isError == true && !detail.output.isNullOrEmpty()) Section(tr("오류", "Error"), detail.output, tint = colors.red)
                }
                "read" -> { PathRow(step, detail); if (step.image) ToolImageInline("toolimg-${step.id}", tappable = false) else Output(step, detail, live) }
                "ask_user" -> {
                    Section(tr("질문", "Question"), detail?.args ?: step.desc, mono = false)
                    val a = step.answer
                    if (a != null) Section(tr("답", "Answer"), a, mono = false) else Output(step, detail, live)
                }
                else -> { Section(tr("입력", "Input"), detail?.args ?: step.summary); Output(step, detail, live) }
            }
        }
    }
}

@Composable
private fun Output(step: ToolCallInfo, detail: ToolDetail?, live: Boolean) {
    val out = detail?.output ?: step.output ?: ""
    val isErr = detail?.isError ?: (step.state == "error")
    when {
        out.isNotEmpty() -> Section(if (isErr) tr("오류", "Error") else tr("결과", "Result"), out, tint = if (isErr) colors.red else null)
        live -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.HourglassEmpty, null, tint = colors.muted, modifier = Modifier.size(14.dp))
            Text(tr("실행 중", "Running"), color = colors.muted, fontSize = Typo.caption + 1.sp)
        }
        detail == null -> Loading()
        else -> Text(tr("출력 없음", "No output"), color = colors.muted, fontSize = Typo.caption + 1.sp)
    }
}

@Composable
private fun PathRow(step: ToolCallInfo, detail: ToolDetail?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SelectionContainer(Modifier.weight(1f)) {
            Text(detail?.path ?: step.summary, color = colors.text.copy(alpha = 0.9f), fontSize = Typo.code, fontFamily = FontFamily.Monospace)
        }
        step.stats?.let { StatsBadge(it) }
    }
}

@Composable
private fun Loading() {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(14.dp), color = colors.muted, strokeWidth = 1.5.dp)
        Text(tr("맥에서 불러오는 중…", "Loading from the Mac…"), color = colors.muted, fontSize = Typo.caption + 1.sp)
    }
}

@Composable
private fun Notice(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.ErrorOutline, null, tint = colors.muted, modifier = Modifier.size(15.dp))
        Text(text, color = colors.muted, fontSize = Typo.caption + 1.sp)
    }
}

/** 제목 + 복사 단추 + 고정폭 글 상자 */
@Composable
private fun Section(title: String, text: String, tint: Color? = null, mono: Boolean = true) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = colors.muted, fontSize = Typo.caption, fontWeight = FontWeight.Medium)
            Spacer(Modifier.weight(1f))
            CopyButton(text, tr("$title 복사", "Copy ${title.lowercase()}"))
        }
        SelectionContainer {
            Text(
                text.ifEmpty { " " }, color = tint ?: colors.text.copy(alpha = 0.9f),
                fontSize = if (mono) Typo.codeSmall + 0.5.sp else Typo.row - 1.sp,
                fontFamily = if (mono) FontFamily.Monospace else null, lineHeight = if (mono) 18.sp else 21.sp,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.bgElevated).padding(12.dp).testTag("stepOutput"),
            )
        }
    }
}

/** 줄 단위 비교: 가장 긴 공통 줄을 기준으로 지운 줄·더한 줄을 나눈다. 너무 크면 통째로(지움 → 더함) */
object Diff {
    sealed class Line { data class Same(val t: String) : Line(); data class Del(val t: String) : Line(); data class Add(val t: String) : Line() }

    fun diff(a: String, b: String): List<Line> {
        val x = a.split("\n"); val y = b.split("\n")
        val n = x.size; val m = y.size
        if (n.toLong() * m > 250_000) return x.map { Line.Del(it) } + y.map { Line.Add(it) }
        val dp = Array(n + 1) { IntArray(m + 1) }
        for (i in n - 1 downTo 0) for (j in m - 1 downTo 0) dp[i][j] = if (x[i] == y[j]) dp[i + 1][j + 1] + 1 else maxOf(dp[i + 1][j], dp[i][j + 1])
        val out = ArrayList<Line>()
        var i = 0; var j = 0
        while (i < n && j < m) {
            when {
                x[i] == y[j] -> { out += Line.Same(x[i]); i++; j++ }
                dp[i + 1][j] >= dp[i][j + 1] -> { out += Line.Del(x[i]); i++ }
                else -> { out += Line.Add(y[j]); j++ }
            }
        }
        while (i < n) { out += Line.Del(x[i]); i++ }
        while (j < m) { out += Line.Add(y[j]); j++ }
        return out
    }
}

@Composable
private fun DiffView(old: String, new: String) {
    val lines = remember(old, new) { Diff.diff(old, new) }
    val c = colors
    SelectionContainer {
      // 줄 배경이 칸 끝까지 차게: 가장 긴 줄과 칸 폭 가운데 넓은 쪽에 모든 줄을 맞춘다
      androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.bgElevated)) {
        val full = maxWidth
        Column(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 6.dp).widthIn(min = full).width(IntrinsicSize.Max).testTag("diffView")) {
            for (l in lines) {
                val (mark, text, fg, bg) = when (l) {
                    is Diff.Line.Same -> listOf(" ", l.t, c.muted, Color.Transparent)
                    is Diff.Line.Del -> listOf("−", l.t, c.red, c.red.copy(alpha = 0.12f))
                    is Diff.Line.Add -> listOf("+", l.t, c.green, c.green.copy(alpha = 0.14f))
                }
                Row(Modifier.fillMaxWidth().background(bg as Color).padding(horizontal = 10.dp, vertical = 1.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(mark as String, color = fg as Color, fontSize = Typo.codeSmall + 0.5.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(12.dp))
                    Text((text as String).ifEmpty { " " }, color = fg, fontSize = Typo.codeSmall + 0.5.sp, fontFamily = FontFamily.Monospace, softWrap = false)
                }
            }
        }
      }
    }
}
