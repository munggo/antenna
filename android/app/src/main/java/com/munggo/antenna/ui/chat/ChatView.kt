package com.munggo.antenna.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.Article
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.NoteAdd
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.chat.ChatItem
import com.munggo.antenna.chat.ImageTokens
import com.munggo.antenna.chat.StepText
import com.munggo.antenna.chat.ToolCallInfo
import com.munggo.antenna.model.ChatMessage
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.session.ThumbStore
import com.munggo.antenna.tr
import com.munggo.antenna.ui.CopyButton
import com.munggo.antenna.ui.Foldable
import com.munggo.antenna.ui.LocalSession
import com.munggo.antenna.ui.MarkdownView
import com.munggo.antenna.ui.PulsingDots
import com.munggo.antenna.ui.StatsBadge
import com.munggo.antenna.ui.ThumbImage
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.copyText
import com.munggo.antenna.ui.elapsedText
import com.munggo.antenna.ui.minus
import com.munggo.antenna.ui.plus
import com.munggo.antenna.ui.rememberNow
import kotlinx.coroutines.launch

/** 단계 창 열기 요청: 대화 속 단계 묶음(작업 중이면 단계가 늘어나므로 최신 것을 다시 찾음)과 연 순간의 단계 */
data class StepsRequest(val groupId: String?, val steps: List<ToolCallInfo>)

/**
 * 대화를 Claude 앱처럼 그리는 채팅 화면(아이폰 앱의 ChatView 와 같다).
 * 목록은 아래에서 위로 쌓는다(reverseLayout): 맨 아래를 보고 있으면 새 내용이 와도 맨 아래에 붙어 있고, 위를 읽는 중이면 그대로 둔다
 */
@Composable
fun ChatView(session: BridgeSession) {
    val store = session.chat
    val meta = store.meta
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var steps by remember { mutableStateOf<StepsRequest?>(null) }
    val items = store.items
    // 목록의 이름표는 겹치면 안 된다(겹치면 앱이 죽음). 맥 기록에 같은 메시지 id 가 겹쳐 오면 뒤의 것에 번호를 붙인다
    val keyed = remember(items) {
        val seen = HashMap<String, Int>()
        items.asReversed().map { item ->
            val n = seen.merge(item.id, 1, Int::plus)!!
            (if (n == 1) item.id else "${item.id}#$n") to item
        }
    }
    val atBottom by remember { derivedStateOf { state.firstVisibleItemIndex == 0 && state.firstVisibleItemScrollOffset < 80 } }

    // 대화 전체를 새로 받으면(탭을 바꿈) 맨 아래로
    LaunchedEffect(store.snapshotCount) { state.scrollToItem(0) }
    // 보내면 최신으로
    LaunchedEffect(store.sentCount) { if (store.sentCount > 0) state.animateScrollToItem(0) }

    Box(Modifier.fillMaxSize().background(colors.bg)) {
        LazyColumn(
            state = state,
            reverseLayout = true,
            modifier = Modifier.fillMaxSize().testTag("chatScroll"),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.Bottom),
        ) {
            // 맨 아래(목록의 처음)부터: 상태 줄 → 앱이 먼저 띄운 말풍선 → 받아 둔 대기열 → 대화
            item(key = "status") { StatusLine(session) { steps = it } }
            items(store.visiblePending.reversed(), key = { it.id }) { WaitingBubble(it.text, waitingCaption(it.mode)) }
            items(store.queue.reversed().distinctBy { it.id }, key = { "q-" + it.id }) { WaitingBubble(it.text, waitingCaption(it.kind)) }
            items(keyed, key = { it.first }, contentType = { it.second::class.simpleName }) { (_, item) ->
                ChatItemView(item, onSteps = { steps = it }, onRewind = { id, text -> session.rewind(id, text) })
            }
        }

        // 위에 잠깐 띄우는 안내(업데이트·다시 불러오기 등)
        AnimatedVisibility(store.notice != null, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
            Text(
                store.notice ?: "", color = colors.text, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(top = 8.dp).shadow(6.dp, CircleShape).clip(CircleShape).background(colors.surfaceHigh)
                    .border(1.dp, colors.border, CircleShape).padding(horizontal = 14.dp, vertical = 8.dp).testTag("noticeBanner"),
            )
        }

        // 위로 올려 읽는 중에만 보이는 '맨 아래로'
        AnimatedVisibility(!atBottom, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)) {
            Box(
                Modifier.size(40.dp).shadow(6.dp, CircleShape).clip(CircleShape).background(colors.surfaceHigh)
                    .border(1.dp, colors.border, CircleShape).clickable { scope.launch { state.animateScrollToItem(0) } }.testTag("scrollToBottom"),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ArrowDownward, tr("맨 아래로", "Scroll to bottom"), tint = colors.text, modifier = Modifier.size(18.dp)) }
        }
    }

    steps?.let { r -> StepsSheet(r, session) { steps = null } }

    // 대화를 누르면 키보드를 내린다(Claude 앱처럼)
    LaunchedEffect(state.isScrollInProgress) { if (state.isScrollInProgress) focus.clearFocus() }
}

private fun waitingCaption(mode: String?): String? = when (mode) {
    null, "" -> null
    "auto" -> tr("곧 전달돼요", "Will be delivered soon")
    "followUp" -> tr("작업이 끝나면 실행돼요", "Runs when the current work finishes")
    "interrupt" -> tr("지금 작업을 멈추고 실행해요", "Stops the current work and runs now")
    else -> tr("다음 단계에서 전달돼요", "Delivered at the next step")
}

/** 하단 상태 줄: "• • 7초 · 생각 중…" (작업 중·압축 중·연결 중) */
@Composable
private fun StatusLine(session: BridgeSession, onSteps: (StepsRequest) -> Unit) {
    val store = session.chat
    val meta = store.meta
    when {
        session.status != BridgeSession.Status.Connected -> StatusRow(tr("연결 중", "Connecting"), null, animated = false)
        store.compacting -> StatusRow(tr("대화를 압축하는 중", "Compacting the conversation"), store.compactingSince)
        store.working -> {
            val label = when {
                meta.approvals.isNotEmpty() -> tr("승인을 기다리는 중", "Waiting for approval")
                meta.questions.isNotEmpty() -> tr("답을 기다리는 중", "Waiting for your answer")
                else -> workingLabel(store.messages)
            }
            val live = liveThinking(store.messages)
            StatusRow(label, store.workingSince, onTap = live?.let { t -> { onSteps(StepsRequest(null, listOf(t))) } })
        }
        else -> Spacer(Modifier.size(1.dp))
    }
}

/** 지금 쓰이는 중인 생각(하단 '생각 중' 줄을 누르면 이걸 창으로) */
private fun liveThinking(messages: List<ChatMessage>): ToolCallInfo? {
    val last = messages.lastOrNull() ?: return null
    val blocks = last.blocks ?: return null
    val b = blocks.lastOrNull() ?: return null
    if (last.role != "assistant" || last.stop != "pending" || b.type != "thinking") return null
    return ToolCallInfo("think-${last.id}-${blocks.size - 1}", "thinking", "", b.desc ?: "", null, "done", thinking = true, ref = b.ref)
}

/** 하단 작업 상태 문구: 답변 중 / 생각 중 / 작업 중 */
private fun workingLabel(messages: List<ChatMessage>): String {
    val last = messages.lastOrNull() ?: return tr("작업 중", "Working")
    if (last.role == "assistant" && last.stop == "pending") {
        when (last.blocks?.lastOrNull()?.type) {
            "thinking" -> return tr("생각 중", "Thinking")
            "text" -> return tr("답변 중", "Answering")
        }
    }
    return tr("작업 중", "Working")
}

@Composable
fun StatusRow(label: String, since: Long?, animated: Boolean = true, onTap: (() -> Unit)? = null) {
    val now = rememberNow()
    Row(
        Modifier.padding(top = 2.dp).then(if (onTap != null) Modifier.clickable(onClick = onTap) else Modifier).testTag("statusRow"),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (animated) PulsingDots() else Box(Modifier.size(6.dp).clip(CircleShape).background(colors.accent))
        Text(if (since != null) "${elapsedText(now - since)} · $label…" else "$label…", color = colors.muted, fontSize = Typo.row)
        if (onTap != null) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = colors.muted, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun ChatItemView(item: ChatItem, onSteps: (StepsRequest) -> Unit, onRewind: (String, String) -> Unit) {
    when (item) {
        is ChatItem.Truncated -> Text(
            tr("이전 메시지 ${item.n}개는 생략했어요", if (item.n == 1) "${item.n} earlier message omitted" else "${item.n} earlier messages omitted"),
            color = colors.muted, fontSize = Typo.caption, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        is ChatItem.User -> UserBubble(item.m, onRewind)
        // 아주 긴 답은 앞부분만 보이고 '더 보기'
        is ChatItem.Text -> Foldable { MarkdownView(item.text, foldLongCode = true) }
        // 마지막 답과 구분되게 조금 흐리게
        is ChatItem.Progress -> MarkdownView(item.text, foldLongCode = true, modifier = Modifier.alpha(0.68f).testTag("progressNote"))
        is ChatItem.Tools -> ToolGroupRow(item.id, item.calls, onSteps)
        is ChatItem.Bash -> BashRow(item.m)
        is ChatItem.Summary -> SummaryRow(item.m)
        is ChatItem.Notice -> SelectionContainer {
            Text(item.text, color = if (item.isError) colors.red else colors.muted, fontSize = Typo.row - 1.sp)
        }
        is ChatItem.Copy -> CopyButton(item.text, tr("답변 복사", "Copy answer"), Modifier.testTag("copyAnswer"))
    }
}

/** 내 메시지: 사진은 말풍선 위에 썸네일로, 글은 말풍선으로(글 속 사진 경로는 감춤). 길게 누르면 복사·여기서 다시 하기 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UserBubble(m: ChatMessage, onRewind: (String, String) -> Unit) {
    val (paths, text) = remember(m.text) { ImageTokens.split(m.text ?: "") }
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth()) {
        Spacer(Modifier.widthIn(min = 48.dp).weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (paths.isNotEmpty()) ThumbRow(paths)
            else if ((m.images ?: 0) > 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Outlined.Image, null, tint = colors.muted, modifier = Modifier.size(14.dp))
                Text(tr("이미지 ${m.images}장", "${m.images} image(s)"), color = colors.muted, fontSize = Typo.caption)
            }
            if (text.isNotEmpty()) Box {
                Box(
                    Modifier.clip(RoundedCornerShape(20.dp)).background(colors.bubble)
                        .combinedClickable(onClick = {}, onLongClick = { menu = true }).padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    Foldable(fade = colors.bubble, fill = false) {
                        Text(text, color = colors.text, fontSize = Typo.body, lineHeight = 24.sp, modifier = Modifier.testTag("userBubble"))
                    }
                }
                DropdownMenu(menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(tr("복사", "Copy")) }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) },
                        onClick = { copyText(context, text); menu = false })
                    DropdownMenuItem(text = { Text(tr("여기서 다시 하기", "Redo from here")) }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Undo, null) },
                        onClick = { onRewind(m.id, m.text ?: ""); menu = false })
                }
            }
        }
    }
}

/** 말풍선 위 사진들(오른쪽 정렬). 한 줄에 최대 3장 */
@Composable
fun ThumbRow(paths: List<String>, alpha: Float = 1f) {
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.alpha(alpha)) {
        for (row in paths.chunked(3)) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (p in row) ThumbImage(p, ThumbStore.Size.Small, Modifier.size(88.dp).clip(RoundedCornerShape(14.dp)).testTag("bubbleThumb"))
        }
    }
}

/** 아직 대화에 들어가지 않은 내 메시지(보내자마자 표시) */
@Composable
private fun WaitingBubble(text: String, caption: String?) {
    val (paths, rest) = remember(text) { ImageTokens.split(text) }
    val dim = if (caption == null) 1f else 0.75f
    Row(Modifier.fillMaxWidth().testTag("pendingBubble")) {
        Spacer(Modifier.widthIn(min = 48.dp).weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (paths.isNotEmpty()) ThumbRow(paths, dim)
            if (rest.isNotEmpty()) Text(
                rest, color = colors.text, fontSize = Typo.body, lineHeight = 24.sp,
                modifier = Modifier.alpha(dim).clip(RoundedCornerShape(20.dp)).background(colors.bubble).padding(horizontal = 14.dp, vertical = 10.dp),
            )
            if (caption != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Outlined.Schedule, null, tint = colors.muted, modifier = Modifier.size(13.dp))
                Text(caption, color = colors.muted, fontSize = Typo.caption)
            }
        }
    }
}

/** 단계 아이콘(명령은 Claude 앱처럼 ">_") */
@Composable
fun StepIcon(step: ToolCallInfo, size: Float = 15f) {
    if (step.name == "bash" && !step.thinking) {
        Text(">_", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, fontSize = (size - 1).sp, color = colors.muted)
        return
    }
    val icon: ImageVector = if (step.thinking) Icons.Outlined.Lightbulb else when (step.name) {
        "read" -> Icons.Outlined.Visibility
        "edit" -> Icons.Outlined.Edit
        "write" -> Icons.Outlined.NoteAdd
        "grep", "find" -> Icons.Outlined.Search
        "ls" -> Icons.Outlined.Folder
        "subagent" -> Icons.Outlined.Group
        "ask_user" -> Icons.Outlined.QuestionAnswer
        "show_artifact" -> Icons.Outlined.Article
        "todo_write" -> Icons.Outlined.Checklist
        else -> Icons.Outlined.Build
    }
    Icon(icon, null, tint = colors.muted, modifier = Modifier.size((size + 2).dp))
}

/**
 * 단계 줄(Claude 앱처럼). 누르면 아래에서 단계 창이 올라온다.
 * 도구 하나: "실행됨 무엇을 하는지" / 여러 개: "파일 2개 수정함, 명령어 5개 실행함  +73 −0" / 생각만: "생각함 첫 줄"
 */
@Composable
private fun ToolGroupRow(id: String, calls: List<ToolCallInfo>, onSteps: (StepsRequest) -> Unit) {
    val tools = calls.filter { !it.thinking }
    val running = tools.firstOrNull { it.state == "running" || it.state == "pending" }
    val c = colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { onSteps(StepsRequest(id, calls)) }.testTag("toolGroup"),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
                when {
                    running != null -> CircularProgressIndicator(Modifier.size(14.dp), color = c.muted, strokeWidth = 1.5.dp)
                    tools.isEmpty() -> StepIcon(calls[0])
                    tools.size == 1 -> StepIcon(tools[0])
                    else -> Icon(Icons.AutoMirrored.Outlined.List, null, tint = c.muted, modifier = Modifier.size(17.dp))
                }
            }
            val label = when {
                running != null -> line(StepText.runningVerb(running), running)
                tools.isEmpty() -> androidx.compose.ui.text.AnnotatedString(tr("생각함", "Thought") + if (calls[0].desc.isEmpty()) "" else " ${calls[0].desc}")
                tools.size == 1 -> line(StepText.verb(tools[0]), tools[0])
                else -> androidx.compose.ui.text.AnnotatedString(StepText.groupLabel(tools))
            }
            Text(label, color = c.muted, fontSize = Typo.row, maxLines = if (tools.size > 1 && running == null) 2 else 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (tools.any { it.state == "error" }) Icon(Icons.Outlined.Warning, tr("오류 있음", "Has errors"), tint = c.muted, modifier = Modifier.size(15.dp))
            StepText.totalStats(tools)?.let { StatsBadge(it) }
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = c.muted, modifier = Modifier.size(16.dp))
        }
        // 여러 단계면 무엇을 했는지 한두 줄(하나면 줄에 이미 보임)
        if (tools.size > 1 && running == null) {
            val d = tools.map { it.desc }.filter { it.isNotEmpty() }.distinct().joinToString(" · ")
            if (d.isNotEmpty()) Text(d, color = c.muted.copy(alpha = 0.85f), fontSize = Typo.caption + 1.sp, maxLines = 2,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 32.dp))
        }
        for (t in tools.filter { it.image && it.state == "done" }) ToolImageInline("toolimg-${t.id}")
        for (a in tools.filter { it.state == "done" }.mapNotNull { it.artifact }) ArtifactCard(a.title.ifEmpty { a.path.substringAfterLast('/') })
    }
}

/** "동사 대상": 파일 이름은 진하게, 설명은 흐리게 */
@Composable
private fun line(verb: String, t: ToolCallInfo): androidx.compose.ui.text.AnnotatedString {
    val sub = StepText.subject(t)
    val strong = colors.text
    return androidx.compose.ui.text.buildAnnotatedString {
        append(verb)
        append(" ")
        if (StepText.isFile(t)) pushStyle(androidx.compose.ui.text.SpanStyle(color = strong))
        append(sub)
        if (StepText.isFile(t)) pop()
    }
}

/** 단계가 읽은 사진(대화 기록에서 받아 옴). 기록에 없으면 자리 없이 숨김 */
@Composable
fun ToolImageInline(path: String, tappable: Boolean = true) {
    val thumbs = LocalSession.current.thumbs
    if (thumbs.isMissing(path)) return
    ThumbImage(
        path, ThumbStore.Size.Large, fit = true, tappable = tappable,
        modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).height(220.dp)
            .clip(RoundedCornerShape(14.dp)).border(1.dp, colors.border, RoundedCornerShape(14.dp)).testTag("toolImage"),
    )
}

/** 아티팩트 카드(안드로이드 앱은 아직 열지 못해 이름만 보인다) */
@Composable
private fun ArtifactCard(title: String) {
    val session = LocalSession.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(colors.bgElevated).border(1.dp, colors.border, RoundedCornerShape(14.dp))
            .clickable { session.say(tr("아티팩트는 아직 안드로이드 앱에서 열 수 없어요", "Artifacts can't be opened in the Android app yet")) }
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Article, null, tint = colors.muted)
        Text(title, color = colors.text, fontSize = Typo.row, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** 사용자가 직접 실행한 `!` 명령 */
@Composable
private fun BashRow(m: ChatMessage) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(colors.bgElevated).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        SelectionContainer { Text("$ ${m.command ?: ""}", color = colors.text, fontSize = Typo.code, fontFamily = FontFamily.Monospace) }
        val out = m.output
        if (!out.isNullOrEmpty()) {
            // 12줄쯤만 보이고, 더 있으면 '더 보기'로 펼친다
            Foldable(fade = colors.bgElevated, limit = 200.dp, folded = 200.dp) {
                SelectionContainer { Text(out, color = colors.muted, fontSize = Typo.codeSmall, fontFamily = FontFamily.Monospace) }
            }
        }
    }
}

/** 대화 압축(요약) 지점 */
@Composable
private fun SummaryRow(m: ChatMessage) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { expanded = !expanded },
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Archive, null, tint = colors.muted, modifier = Modifier.size(13.dp))
            Text(tr("이전 대화를 요약했어요", "Summarized the earlier conversation"), color = colors.muted, fontSize = Typo.caption + 1.sp)
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = colors.muted,
                modifier = Modifier.size(14.dp).rotate(if (expanded) 90f else 0f))
        }
        if (expanded) m.text?.let { SelectionContainer { Text(it, color = colors.muted, fontSize = Typo.caption + 1.sp) } }
    }
}
