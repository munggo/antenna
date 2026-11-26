package com.munggo.antenna.ui.input

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardReturn
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FrontHand
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.NoteAdd
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.SubdirectoryArrowRight
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.FileSuggestion
import com.munggo.antenna.model.SlashCommand
import com.munggo.antenna.model.TabAccount
import com.munggo.antenna.session.Attachment
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.cards.ApprovalCard
import com.munggo.antenna.ui.cards.MultiQuestionCard
import com.munggo.antenna.ui.cards.QuestionCard
import com.munggo.antenna.ui.cards.TodoPanel
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.plus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

/** 생각 깊이 단계(맥 브리지·pi 와 같은 이름) */
val THINKING_LEVELS = listOf("off", "minimal", "low", "medium", "high", "xhigh", "max")

/** 기본 명령(폰에서 쓸 만한 것만). /model·/thinking 은 칩으로, 맥 화면에서 방향키로 고르는 창을 띄우는 명령은 뺐다 */
val BUILTIN_COMMANDS = listOf(
    SlashCommand("compact", tr("대화 압축 — 앞부분을 요약해 공간 확보", "Compact — summarize the earlier part to free up room"), "builtin", needsArg = false),
    SlashCommand("new", tr("새 대화 시작", "Start a new conversation"), "builtin", needsArg = false),
    SlashCommand("clone", tr("지금 대화 복제", "Duplicate this conversation"), "builtin", needsArg = false),
    SlashCommand("name", tr("대화 이름 정하기", "Name this conversation"), "builtin", needsArg = true),
    SlashCommand("session", tr("대화 정보·통계", "Conversation info and stats"), "builtin", needsArg = false, terminal = true),
    SlashCommand("export", tr("대화 내보내기(HTML)", "Export the conversation (HTML)"), "builtin", needsArg = false, terminal = true),
    SlashCommand("copy", tr("마지막 답을 맥 클립보드로 복사", "Copy the last answer to the Mac clipboard"), "builtin", needsArg = false),
    SlashCommand("reload", tr("확장·스킬 다시 불러오기", "Reload extensions and skills"), "builtin", needsArg = false),
    SlashCommand("hotkeys", tr("단축키 보기", "Show keyboard shortcuts"), "builtin", needsArg = false, terminal = true),
    SlashCommand("changelog", tr("pi 변경 내역", "pi changelog"), "builtin", needsArg = false, terminal = true),
)

/** 입력한 글(/ 다음)로 고르기: 이름이 그 글로 시작하는 것 먼저, 그다음 이름·설명에 포함된 것 */
fun slashSuggestions(query: String, ext: List<SlashCommand>): List<SlashCommand> {
    val all = BUILTIN_COMMANDS + ext.filter { e -> BUILTIN_COMMANDS.none { it.name == e.name } }
    val q = query.lowercase()
    if (q.isEmpty()) return all
    val starts = all.filter { it.name.lowercase().startsWith(q) }
    val contains = all.filter { !it.name.lowercase().startsWith(q) && (it.name.lowercase().contains(q) || it.description.lowercase().contains(q)) }
    return starts + contains
}

/** 'claude/claude-opus-5-5' → 'Opus 5.5'(맥 하단 줄·칩과 같은 이름) */
fun modelName(id: String): String {
    val parts = id.substringAfterLast('/').split('-').filter { it != "claude" }
    val fam = parts.firstOrNull() ?: return id
    val ver = parts.drop(1).filter { it.toIntOrNull() != null }.joinToString(".")
    val name = fam.replaceFirstChar { it.uppercase() }
    return if (ver.isEmpty()) name else "$name $ver"
}

fun accountName(a: String) = when (a) {
    "work" -> tr("회사", "Work")
    "personal2" -> tr("추가 개인", "Personal 2")
    else -> tr("개인", "Personal")
}

private fun modeTitle(m: String) = when (m) {
    "auto" -> tr("자동", "Auto")
    "followUp" -> tr("끝나고 실행", "Run after")
    "interrupt" -> tr("멈추고 실행", "Stop and run")
    else -> tr("바로 반영", "Steer now")
}

private fun modeIcon(m: String): ImageVector = when (m) {
    "auto" -> Icons.Outlined.Bolt
    "followUp" -> Icons.Outlined.Schedule
    "interrupt" -> Icons.Outlined.StopCircle
    else -> Icons.Outlined.SubdirectoryArrowRight
}

private fun modePlaceholder(m: String) = when (m) {
    "auto" -> tr("보내면 바로 전달돼요", "Sends right away")
    "followUp" -> tr("보내면 지금 작업이 끝난 뒤 실행돼요", "Runs after the current work finishes")
    "interrupt" -> tr("보내면 지금 작업을 멈추고 실행돼요", "Stops the current work and runs")
    else -> tr("보내면 다음 단계에서 바로 반영돼요", "Applied at the next step")
}

private fun thinkingLabel(level: String) = when (level) {
    "off" -> tr("끄기", "Off")
    "minimal" -> tr("최소 (minimal)", "Minimal")
    "low" -> tr("낮음 (low)", "Low")
    "medium" -> tr("보통 (medium)", "Medium")
    "high" -> tr("높음 (high)", "High")
    "xhigh" -> tr("매우 높음 (xhigh)", "Extra high (xhigh)")
    "max" -> tr("최대 (max)", "Max")
    else -> level
}

/**
 * 하단 작성창(Claude 앱 배치, 아이폰 앱의 InputBar 와 같다).
 * 맨 위: 명령·파일 제안, 할 일, 승인·질문 카드, 붙인 사진 / 가운데: 여러 줄 입력
 * 아랫줄: + (사진·맥 파일) · 생각 깊이 · 모델 · 계정 · 권한 모드 · 보내기(↑)/멈추기(■). 작업 중엔 생각·모델 대신 보내는 시점 칩
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun InputBar(session: BridgeSession, onTerminalCommand: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("input", Context.MODE_PRIVATE) }
    val meta = session.chat.meta
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    // 쓰던 글은 폰에 저장(앱이 꺼졌다 켜져도 남음)
    var field by remember { mutableStateOf(TextFieldValue(prefs.getString("draft", "") ?: "")) }
    val text = field.text
    fun setText(t: String) { field = TextFieldValue(t, TextRange(t.length)) }
    LaunchedEffect(text) { prefs.edit().putString("draft", text).apply() }
    // 작업 중에 보낼 때 시점: auto(기본) | steer | followUp | interrupt
    var sendMode by remember { mutableStateOf(prefs.getString("sendMode2", "auto") ?: "auto") }
    LaunchedEffect(sendMode) { prefs.edit().putString("sendMode2", sendMode).apply() }
    var secret by remember { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    var accountAsk by remember { mutableStateOf<String?>(null) }
    // 질문 카드에서 체크한 선택지(여러 개 고르기). 입력창의 '기타' 답과 함께 보내고, 질문이 바뀌면 비운다
    var picked by remember { mutableStateOf(setOf<Int>()) }
    LaunchedEffect(meta.questions.firstOrNull()?.id) { picked = emptySet() }
    val connected = session.status == BridgeSession.Status.Connected

    // 되감은 뒤: 그 메시지 글을 입력창에(고쳐서 다시 보내기)
    LaunchedEffect(meta.prefill) {
        meta.prefill?.let { setText(it); meta.prefill = null; runCatching { focusRequester.requestFocus() } }
    }

    val slashQuery = if (text.startsWith("/") && !text.contains(' ') && !text.contains('\n')) text.drop(1) else null
    // 끝 단어가 '@…'이면 그 뒤 글자(맥 파일 찾기). 끝이 빈칸·줄바꿈이면 끝난 것으로 봄
    val atQuery = text.lastOrNull()?.takeIf { !it.isWhitespace() }?.let {
        val token = text.split(Regex("\\s")).last()
        if (token.startsWith("@")) token.drop(1) else null
    }
    // '@' 파일 찾기를 잠깐 쉬었다 보낸다(글자마다 맥에 묻지 않게)
    LaunchedEffect(atQuery) { if (atQuery != null) { delay(150); session.requestFiles(atQuery) } }

    val uploading = session.attachments.any { it.state == Attachment.State.Uploading || it.state == Attachment.State.Preparing }
    val hasText = text.isNotBlank()
    val canSend = connected && !uploading && (hasText || session.attachments.any { it.path != null })

    fun runCommand(line: String) {
        val name = line.drop(1).substringBefore(' ')
        if (name == "reload" && session.isWorking) {
            // pi 는 작업 중 /reload 를 경고만 하고 버린다 → 폰에서 먼저 알림
            session.chat.showNotice(tr("작업이 끝난 뒤에 다시 불러올 수 있어요", "You can reload after the work finishes"))
            return
        }
        session.sendMessage(line, sendMode)
        if (BUILTIN_COMMANDS.firstOrNull { it.name == name }?.terminal == true) {
            onTerminalCommand()
            session.chat.showNotice(tr("맥 화면의 선택 창을 터미널 보기로 열었어요", "Opened the Mac's picker in the terminal view"))
        }
    }

    fun send() {
        if (!canSend) return
        val body = text.trim()
        val q = meta.questions.firstOrNull()
        when {
            body.startsWith("/") -> runCommand(body)
            // 질문 카드가 떠 있으면 입력한 글이 그 질문의 답(기타)
            q != null && q.allowsOther && body.isNotEmpty() -> session.answerQuestion(q.id, if (q.multi) pickedLabels(q, picked) else emptyList(), body)
            else -> session.sendMessage(body, sendMode)
        }
        setText("")
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    fun sendBackground() {
        if (!canSend) return
        session.sendBackground(text.trim())
        setText("")
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    // 사진 고르기: 고르자마자 사진 수만큼 '받는 중' 칸부터 띄우고, 세 장씩 함께 줄여 맥에 올린다
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(8)) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val jobs = uris.map { it to session.reserveAttachment() }
        val gate = Semaphore(3)
        for ((uri, id) in jobs) scope.launch {
            gate.withPermit {
                val made = withContext(Dispatchers.Default) {
                    val full = ImageShrink.decode(context, uri, ImageShrink.MAX_PIXEL) ?: return@withContext null
                    val small = ImageShrink.scaled(full, 300)
                    Triple(ImageShrink.jpeg(full, 85), small.asImageBitmap(), ImageShrink.jpeg(small, 80))
                }
                if (made == null) session.failAttachment(id) else session.uploadAttachment(id, made.first, made.second, made.third)
            }
        }
    }

    Column(Modifier.fillMaxWidth().background(colors.bg).padding(top = 6.dp)) {
        Column(
            Modifier.padding(start = 10.dp, end = 10.dp, bottom = 6.dp).fillMaxWidth()
                .clip(RoundedCornerShape(24.dp)).background(colors.surface).border(1.dp, colors.border, RoundedCornerShape(24.dp)).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (slashQuery != null) {
                val list = slashSuggestions(slashQuery, meta.commands)
                if (list.isNotEmpty()) SlashPanel(list) { c ->
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    if (c.needsArg) setText("/${c.name} ") else { setText(""); runCommand("/${c.name}") }
                }
            }
            if (atQuery != null) FilePanel(meta.files, meta.filesLoading || meta.filesQuery != atQuery, meta.filesError) { f ->
                setText(text.dropLast(atQuery.length + 1) + f.value + if (f.isDir) "" else " ")
            }
            if (meta.todos.isNotEmpty() && (session.isWorking || meta.todos.any { it.status != "completed" })) TodoPanel(meta.todos)
            // 승인이 여러 개면 하나씩(답하면 다음 것이 뜸)
            meta.approvals.firstOrNull()?.let { a ->
                androidx.compose.runtime.key(a.id) { ApprovalCard(a, meta.approvals.size) { session.answerApproval(a.id, it) } }
            }
            meta.questions.firstOrNull()?.let { q ->
                androidx.compose.runtime.key(q.id) {
                    if (q.isMulti) MultiQuestionCard(q, compact = focused) { session.answerQuestions(q.id, it) }
                    else QuestionCard(
                        item = q, compact = focused, picked = picked, onPickedChange = { picked = it },
                        onAnswer = { answers -> session.answerQuestion(q.id, answers) },
                        onOther = { runCatching { focusRequester.requestFocus() } },
                        onCancel = { session.answerQuestion(q.id, emptyList(), cancel = true) },
                    )
                }
            }
            if (meta.outdated) ReloadBanner(session)
            if (session.attachments.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp, start = 4.dp, end = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (a in session.attachments) AttachmentChip(a) { session.removeAttachment(a.id) }
            }

            val stage = session.secretStage
            if (stage != null) {
                // 관리자 권한 확인 창(🔐 탭): 단계에 맞는 화면. 확인 단계에는 글을 넣을 칸이 없다(여기에 비밀번호를 치는 일이 없게)
                when (stage) {
                    "confirm" -> SecretConfirm(session)
                    "done" -> Text(tr("끝났어요. 이 탭은 곧 닫혀요.", "Done. This tab will close soon."), color = colors.muted, fontSize = Typo.body,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 8.dp))
                    else -> {
                        val knowsStage = stage != "unknown"
                        fun sendSecret() {
                            if (!connected || (secret.isEmpty() && knowsStage)) return
                            session.sendSecret(secret); secret = ""
                        }
                        BasicTextField(
                            secret, { secret = it }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            textStyle = TextStyle(color = colors.text, fontSize = Typo.body), cursorBrush = SolidColor(colors.accent),
                            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = androidx.compose.ui.text.input.KeyboardType.Password),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp).testTag("secretInput"),
                            decorationBox = { inner ->
                                Box { if (secret.isEmpty()) Text(if (!connected) tr("연결 중…", "Connecting…") else tr("비밀번호를 물으면 여기에(가려서 보내요)", "If asked for a password, type it here (sent hidden)"), color = colors.muted, fontSize = Typo.body); inner() }
                            },
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            SecretChip(if (knowsStage) tr("멈추기", "Stop") else tr("취소", "Cancel"), connected) { session.sendBytes(byteArrayOf(0x03)); secret = "" }
                            Text(
                                when { secret.isNotEmpty() -> tr("가려서 보내고 바로 지워요", "Sent hidden, then cleared"); knowsStage -> tr("비밀번호를 물을 때만 넣어 주세요", "Only type it when asked for a password"); else -> tr("비워서 보내면 Enter(실행)", "Send empty to press Enter (run)") },
                                color = colors.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                            )
                            val ok = connected && !(knowsStage && secret.isEmpty())
                            RoundButton(if (secret.isEmpty() && !knowsStage) Icons.AutoMirrored.Outlined.KeyboardReturn else Icons.Outlined.ArrowUpward,
                                colors.accent.copy(alpha = if (ok) 1f else 0.4f), Color.White, "secretSend") { sendSecret() }
                        }
                    }
                }
            } else {
                BasicTextField(
                    field, { field = it },
                    textStyle = TextStyle(color = colors.text, fontSize = Typo.body, lineHeight = 22.sp),
                    cursorBrush = SolidColor(colors.accent), maxLines = 8,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp).padding(top = 4.dp).focusRequester(focusRequester)
                        .onFocusChanged { focused = it.isFocused }.testTag("composerInput"),
                    decorationBox = { inner ->
                        Box {
                            if (text.isEmpty()) {
                                val q = meta.questions.firstOrNull()
                                Text(
                                    when {
                                        !connected -> tr("연결 중… 연결되면 보낼 수 있어요", "Connecting… You can send once connected")
                                        q?.kind == "input" -> q.placeholder?.ifEmpty { null } ?: tr("여기에 써서 답하기", "Type your answer here")
                                        q?.allowsOther == true -> tr("직접 입력해 답하기", "Type your own answer")
                                        session.isWorking -> modePlaceholder(sendMode)
                                        else -> tr("${meta.agentName}에게 메시지 보내기", "Message ${meta.agentName}")
                                    },
                                    color = colors.muted, fontSize = Typo.body, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                )
                            }
                            inner()
                        }
                    },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    PlusMenu(
                        onFile = {
                            val t = if (text.isNotEmpty() && !text.last().isWhitespace()) "$text " else text
                            setText("$t@"); runCatching { focusRequester.requestFocus() }
                        },
                        onPhotos = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    )
                    // 가운데 칩: 글자가 잘리지 않게 넘치면 옆으로 밀어 보기
                    Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        if (session.isWorking) {
                            // 질문에 답하는 중에는 보내기 방식이 의미 없음(쓴 글이 곧 답)
                            if (meta.questions.isEmpty()) SendModeMenu(sendMode) { sendMode = it }
                        } else {
                            ThinkingMenu(session)
                            ModelMenu(session)
                        }
                        AccountChip(session) { accountAsk = it }
                        PermModeChip(session)
                    }
                    when {
                        canSend -> Box {
                            var menu by remember { mutableStateOf(false) }
                            Box(
                                Modifier.size(34.dp).clip(CircleShape).background(colors.accent)
                                    .combinedClickable(onClick = { send() }, onLongClick = { menu = true }).testTag("sendButton"),
                                contentAlignment = Alignment.Center,
                            ) { Icon(Icons.Outlined.ArrowUpward, tr("보내기", "Send"), tint = Color.White, modifier = Modifier.size(18.dp)) }
                            // 길게 누르면: 새 탭에서 백그라운드로(끝나면 폰 알림, 이 탭에 결과 요약)
                            DropdownMenu(menu, { menu = false }) {
                                DropdownMenuItem(text = { Text(tr("백그라운드로 보내기(새 탭)", "Send to background (new tab)")) },
                                    onClick = { menu = false; sendBackground() }, modifier = Modifier.testTag("menuBackground"))
                            }
                        }
                        session.isWorking && !hasText && session.attachments.isEmpty() ->
                            RoundButton(Icons.Filled.Stop, colors.text, colors.bg, "stopButton", iconSize = 14) {
                                session.interrupt(); haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            }
                        else -> Box(Modifier.size(34.dp).clip(CircleShape).background(colors.accent.copy(alpha = 0.4f)).testTag("sendButtonDisabled"),
                            contentAlignment = Alignment.Center) {
                            if (uploading) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                            else Icon(Icons.Outlined.ArrowUpward, null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }

    accountAsk?.let { k ->
        val how = tr("지금 대화에 인수인계 문서를 쓰게 한 뒤 대화를 비우고 새로 켜요. 일하는 중이면 끝난 뒤에 바꿔요.",
            "It has the agent write a handoff note, clears the conversation and starts again. If it's working, it switches after it finishes.")
        AlertDialog(
            onDismissRequest = { accountAsk = null },
            title = { Text(if (k == "auto") tr("계정을 자동으로 되돌릴까요?", "Switch the account back to automatic?") else tr("${accountName(k)} 계정으로 바꿀까요?", "Switch to the ${accountName(k)} account?")) },
            text = { Text(if (k == "auto") tr("폴더·한도 기준 계정이 지금과 다르면 $how", "If the account chosen by folder and limits differs from now, $how") else how) },
            confirmButton = { TextButton({ session.setAccount(k); accountAsk = null }) { Text(if (k == "auto") tr("자동으로 되돌리기", "Back to automatic") else tr("바꾸기", "Switch")) } },
            dismissButton = { TextButton({ accountAsk = null }) { Text(tr("취소", "Cancel")) } },
        )
    }
}

/** 여러 개 고르기 질문에서 체크한 선택지의 이름 */
private fun pickedLabels(q: com.munggo.antenna.model.QuestionItem, picked: Set<Int>) =
    picked.sorted().mapNotNull { q.options.getOrNull(it)?.label }

@Composable
private fun RoundButton(icon: ImageVector, bg: Color, fg: Color, tag: String, iconSize: Int = 18, onClick: () -> Unit) {
    Box(Modifier.size(34.dp).clip(CircleShape).background(bg).clickable(onClick = onClick).testTag(tag), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(iconSize.dp))
    }
}

@Composable
private fun Chip(icon: ImageVector?, text: String, chevron: Boolean = false, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
    Row(
        Modifier.height(34.dp).clip(CircleShape).border(1.dp, colors.border, CircleShape).clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 9.dp).testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, tint = colors.muted, modifier = Modifier.size(14.dp))
        Text(text, color = colors.muted, fontSize = Typo.chip, fontWeight = FontWeight.Medium, maxLines = 1)
        if (chevron) Icon(Icons.Outlined.KeyboardArrowDown, null, tint = colors.muted, modifier = Modifier.size(14.dp))
    }
}

@Composable
private fun MenuHeader(text: String) {
    Text(text, color = colors.muted, fontSize = Typo.caption, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

@Composable
private fun CheckItem(text: String, checked: Boolean, tag: String? = null, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(text) }, onClick = onClick,
        leadingIcon = { if (checked) Icon(Icons.Outlined.Check, null) else Spacer(Modifier.size(24.dp)) },
        modifier = if (tag != null) Modifier.testTag(tag) else Modifier,
    )
}

/** + : 맥 파일 첨부 · 사진 보관함 */
@Composable
private fun PlusMenu(onFile: () -> Unit, onPhotos: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Box(Modifier.size(34.dp).clip(CircleShape).border(1.dp, colors.border, CircleShape).clickable { open = true }.testTag("plusMenu"),
            contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Add, tr("첨부", "Attach"), tint = colors.text, modifier = Modifier.size(20.dp)) }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text(tr("맥 파일 첨부", "Attach a Mac file")) }, leadingIcon = { Icon(Icons.Outlined.NoteAdd, null) },
                onClick = { open = false; onFile() })
            DropdownMenuItem(text = { Text(tr("사진 보관함", "Photo library")) }, leadingIcon = { Icon(Icons.Outlined.PhotoLibrary, null) },
                onClick = { open = false; onPhotos() })
        }
    }
}

@Composable
private fun SendModeMenu(mode: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Chip(modeIcon(mode), modeTitle(mode), chevron = true, tag = "sendModeMenu") { open = true }
        DropdownMenu(open, { open = false }) {
            MenuHeader(tr("작업 중에 보낼 때", "When sending while working"))
            for (m in listOf("auto", "steer", "followUp", "interrupt")) CheckItem(modeTitle(m), m == mode) { onPick(m); open = false }
        }
    }
}

/** 생각 깊이. Claude Code 에는 off·minimal 이 없다 */
@Composable
private fun ThinkingMenu(session: BridgeSession) {
    var open by remember { mutableStateOf(false) }
    val levels = if (session.chat.meta.agentName == "Claude") THINKING_LEVELS.filter { it != "off" && it != "minimal" } else THINKING_LEVELS
    Box {
        Chip(Icons.Outlined.Psychology, session.piThinking.ifEmpty { tr("생각", "Thinking") }, tag = "thinkingMenu") { open = true }
        DropdownMenu(open, { open = false }) {
            MenuHeader(tr("생각 깊이", "Thinking level"))
            for (l in levels) CheckItem(thinkingLabel(l), l == session.piThinking) { session.setThinking(l); open = false }
        }
    }
}

/** 모델: Claude Code 탭은 맥의 /model 화면과 같은 선택지, pi 는 로그인된 모델 목록(Claude 자동 계정 먼저) */
@Composable
private fun ModelMenu(session: BridgeSession) {
    var open by remember { mutableStateOf(false) }
    val meta = session.chat.meta
    val choices = meta.modelChoices
    val main = remember(session.models) {
        val auto = session.models.filter { it.startsWith("claude/") }
        val list = (auto.ifEmpty { session.models.filter { it.startsWith("anthropic/") } }).filter { !Regex("-\\d{8}$").containsMatchIn(it) }
        val rank = mapOf("opus" to 0, "sonnet" to 1, "fable" to 2, "haiku" to 3)
        list.sortedWith(compareBy({ id -> id.substringAfterLast('/').split('-').firstNotNullOfOrNull { rank[it] } ?: 9 },
            { id -> -(id.substringAfterLast('/').split('-').mapNotNull { it.toIntOrNull() }.fold(0) { a, n -> a * 100 + n }) }))
    }
    val others = remember(session.models) {
        session.models.map { it.substringBefore('/') }.distinct().filter { it !in setOf("claude", "anthropic", "anthropic-work", "anthropic-personal2") }
    }
    Box {
        Chip(null, session.piModel.ifEmpty { tr("모델", "Model") }, tag = "modelMenu", enabled = session.models.isNotEmpty() || choices.isNotEmpty()) { open = true }
        DropdownMenu(open, { open = false }, Modifier.heightIn(max = 420.dp)) {
            MenuHeader(if (session.piModel.isEmpty()) tr("모델", "Model") else tr("현재: ${session.piModel}", "Current: ${session.piModel}"))
            if (choices.isNotEmpty()) for (c in choices) {
                CheckItem(c.name, session.piModel.lowercase().startsWith(c.name.lowercase())) { session.setModel(c.id); open = false }
            } else {
                for (id in main) CheckItem(modelName(id), modelName(id) == session.piModel) { session.setModel(id); open = false }
                for (p in others) {
                    HorizontalDivider()
                    MenuHeader(if (p == "openai") "OpenAI" else p)
                    for (id in session.models.filter { it.startsWith("$p/") }) CheckItem(id.removePrefix("$p/"), false) { session.setModel(id); open = false }
                }
            }
        }
    }
}

/** 지금 보는 Claude Code 탭의 계정(맥 연결부가 알려 준 때만). 일하는 중이면 끝난 뒤에 바꾸고, 그동안 '개인→회사'처럼 보인다 */
@Composable
private fun AccountChip(session: BridgeSession, onAsk: (String) -> Unit) {
    if (session.chat.meta.agentName != "Claude") return
    val a: TabAccount = session.windows.firstOrNull { it.active }?.account?.takeIf { it.now.isNotEmpty() } ?: return
    val moving = a.next.isNotEmpty() && a.next != a.now
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.height(34.dp).clip(CircleShape).background(if (moving) colors.accent else Color.Transparent)
                .border(1.dp, if (moving) Color.Transparent else colors.border, CircleShape)
                .clickable(enabled = a.phase != "switch") { open = true }.padding(horizontal = 9.dp).testTag("accountChip"),
            horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            val fg = if (moving) Color.White else colors.muted
            Icon(if (moving) (if (a.phase == "switch") Icons.Outlined.Autorenew else Icons.Outlined.Schedule) else Icons.Outlined.PersonOutline, null, tint = fg, modifier = Modifier.size(14.dp))
            Text(if (moving) "${accountName(a.now)}→${accountName(a.next)}" else accountName(a.now), color = fg, fontSize = Typo.chip, fontWeight = FontWeight.Medium, maxLines = 1)
            if (a.pin.isNotEmpty() && !moving) Icon(Icons.Outlined.PushPin, null, tint = fg, modifier = Modifier.size(11.dp))
        }
        DropdownMenu(open, { open = false }) {
            MenuHeader(tr("이 탭의 계정 · 지금 ${accountName(a.now)}", "This tab's account · now ${accountName(a.now)}"))
            for ((key, title) in listOf("auto" to tr("자동 — 폴더 기준", "Automatic — by folder"), "personal" to accountName("personal"),
                "personal2" to accountName("personal2"), "work" to accountName("work"))) {
                val pin = if (key == "auto") "" else key
                CheckItem(title, pin == a.pin, "account-$key") {
                    open = false
                    if (pin != a.pin) { if (pin.isEmpty() || pin != a.now) onAsk(key) else session.setAccount(key) }
                }
            }
            Text(tr("바꾸면 지금 대화에 인수인계 문서를 쓰게 한 뒤 새로 켜요. 일하는 중이면 끝난 뒤에 바꿔요. 한도가 95%를 넘으면 그대로 쓸지 바꿀지 물어봐요",
                "Switching has the agent write a handoff note and starts again. If it's working, it switches after it finishes. Above 95% of a limit, you're asked whether to keep or switch."),
                color = colors.muted, fontSize = Typo.caption, modifier = Modifier.width(280.dp).padding(horizontal = 16.dp, vertical = 8.dp))
        }
    }
}

/** 권한 모드 칩(Claude Code 의 Shift+Tab 처럼): 자동이 평소, 다른 모드면 강조 */
@Composable
private fun PermModeChip(session: BridgeSession) {
    val meta = session.chat.meta
    val m = meta.permMode
    val (icon, label) = when (m) {
        "ask", "manual" -> Icons.Outlined.FrontHand to tr("묻기", "Ask")
        "acceptEdits" -> Icons.Outlined.Edit to tr("수정 허용", "Accept edits")
        "plan" -> Icons.Outlined.ListAlt to tr("계획", "Plan")
        "bypass" -> Icons.Outlined.GppMaybe to tr("모두 허용", "Allow all")
        else -> Icons.Outlined.Bolt to tr("자동", "Auto")
    }
    val on = m != "auto"
    val options = if (meta.agentName == "Claude") listOf(
        Triple("auto", tr("자동", "Auto"), tr("Claude 가 판단해 위험한 일만 물어요", "Claude decides and asks only for risky actions")),
        Triple("manual", tr("매번 묻기", "Always ask"), tr("파일 수정·명령마다 물어요", "Asks before every edit and command")),
        Triple("acceptEdits", tr("수정 허용", "Accept edits"), tr("파일 수정은 묻지 않고, 명령은 물어요", "Edits files without asking; asks for commands")),
        Triple("plan", tr("계획", "Plan"), tr("읽기만 하며 계획을 세워요", "Only reads and makes a plan")),
    ) else listOf(
        Triple("auto", tr("자동", "Auto"), tr("보내기·위험한 일만 물어요", "Asks only for sending and risky actions")),
        Triple("ask", tr("매번 묻기", "Always ask"), tr("파일 수정·명령도 실행 전에 물어요", "Also asks before edits and commands")),
        Triple("plan", tr("계획", "Plan"), tr("읽기만 하며 계획을 세워요", "Only reads and makes a plan")),
    )
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.height(30.dp).clip(CircleShape).background(if (on) colors.accent else Color.Transparent)
                .border(1.dp, if (on) Color.Transparent else colors.border, CircleShape).clickable { open = true }.padding(horizontal = 10.dp).testTag("modeChip"),
            horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            val fg = if (on) Color.White else colors.muted
            Icon(icon, null, tint = fg, modifier = Modifier.size(13.dp))
            Text(label, color = fg, fontSize = Typo.caption + 2.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
        }
        DropdownMenu(open, { open = false }) {
            MenuHeader(tr("권한 모드", "Permission mode"))
            for ((key, name, desc) in options) CheckItem("$name — $desc", key == m) { session.setPermMode(key); open = false }
        }
    }
}

/** 맥 pi 가 예전 확장으로 돌 때: 새 기능을 쓰려면 다시 불러와야 함 */
@Composable
private fun ReloadBanner(session: BridgeSession) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(colors.surfaceHigh).padding(horizontal = 10.dp, vertical = 8.dp).testTag("reloadBanner"),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Autorenew, null, tint = colors.accent, modifier = Modifier.size(17.dp))
        Text(tr("맥 pi가 예전 확장으로 돌고 있어 새 기능이 안 보여요", "pi on the Mac is running an old extension, so new features don't show"),
            color = colors.text, fontSize = Typo.caption + 1.sp, modifier = Modifier.weight(1f))
        Text(
            if (session.isWorking) tr("작업 끝나면", "After the work") else tr("다시 불러오기", "Reload"),
            color = if (session.isWorking) colors.muted else colors.text, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(CircleShape).background(colors.surface).clickable(enabled = !session.isWorking) { session.reloadPi() }
                .padding(horizontal = 10.dp, vertical = 6.dp).testTag("reloadPi"),
        )
    }
}

/** 🔐 탭 확인 단계: 실행할지 묻는 단추들(맥 화면의 Enter·v·q 와 같은 동작) */
@Composable
private fun SecretConfirm(session: BridgeSession) {
    val connected = session.status == BridgeSession.Status.Connected
    Column(Modifier.padding(horizontal = 6.dp).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(tr("관리자 권한 명령을 실행할까요?", "Run the administrator command?"), color = colors.text, fontSize = Typo.body, fontWeight = FontWeight.SemiBold)
        Text(tr("무엇을 하는지는 위 화면에 적혀 있어요. 비밀번호는 실행을 누른 뒤에 물어요.", "What it does is shown on the screen above. You're asked for the password after tapping Run."),
            color = colors.muted, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SecretChip(tr("취소", "Cancel"), connected) { session.sendSecret("q") }
            SecretChip(tr("명령 보기", "Show command"), connected) { session.sendSecret("v") }
            Spacer(Modifier.weight(1f))
            Text(tr("실행", "Run"), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(CircleShape).background(colors.accent.copy(alpha = if (connected) 1f else 0.4f))
                    .clickable(enabled = connected) { session.sendSecret("") }.padding(horizontal = 20.dp, vertical = 8.dp).testTag("secretRun"))
        }
    }
}

@Composable
private fun SecretChip(title: String, enabled: Boolean, onClick: () -> Unit) {
    Text(title, color = colors.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(CircleShape).background(colors.surfaceHigh).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp))
}

/** 입력창 위 명령 제안 목록 */
@Composable
private fun SlashPanel(commands: List<SlashCommand>, onPick: (SlashCommand) -> Unit) {
    Column(Modifier.heightIn(max = 250.dp).verticalScroll(rememberScrollState()).testTag("slashPanel")) {
        for (c in commands) Row(
            Modifier.fillMaxWidth().clickable { onPick(c) }.padding(horizontal = 10.dp, vertical = 8.dp).testTag("slash-${c.name}"),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(when (c.source) { "skill" -> Icons.Outlined.School; "prompt" -> Icons.Outlined.Description; "extension" -> Icons.Outlined.Extension; else -> Icons.Outlined.Code },
                null, tint = colors.muted, modifier = Modifier.size(16.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("/${c.name}", color = colors.text, fontSize = 15.sp, fontFamily = FontFamily.Monospace)
                if (c.description.isNotEmpty()) Text(c.description, color = colors.muted, fontSize = Typo.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (c.terminal) Icon(Icons.Outlined.Terminal, null, tint = colors.muted, modifier = Modifier.size(14.dp))
        }
    }
}

/** 입력창 위 '@' 파일 목록. 파일을 고르면 '@경로 '가 들어가고, 폴더를 고르면 그 안을 이어서 찾는다 */
@Composable
private fun FilePanel(files: List<FileSuggestion>, loading: Boolean, error: String?, onPick: (FileSuggestion) -> Unit) {
    Column(Modifier.heightIn(max = 250.dp).verticalScroll(rememberScrollState()).testTag("filePanel")) {
        if (files.isEmpty()) Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (loading) CircularProgressIndicator(Modifier.size(14.dp), color = colors.muted, strokeWidth = 1.5.dp)
            Text(if (loading) tr("맥에서 찾는 중…", "Searching on the Mac…") else error ?: tr("맞는 파일이 없어요", "No matching files"), color = colors.muted, fontSize = Typo.caption + 1.sp)
        }
        for (f in files) Row(
            Modifier.fillMaxWidth().clickable { onPick(f) }.padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(if (f.isDir) Icons.Outlined.Folder else Icons.Outlined.Description, null, tint = colors.muted, modifier = Modifier.size(16.dp))
            Column(Modifier.weight(1f)) {
                Text(f.label, color = colors.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (f.path != f.label.dropLast(if (f.isDir) 1 else 0)) Text(f.path, color = colors.muted, fontSize = Typo.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** 입력창 위 사진 하나: 받는 중·올리는 중(진행 표시) / 완료 / 실패(느낌표), 오른쪽 위 x 로 빼기 */
@Composable
private fun AttachmentChip(a: Attachment, onRemove: () -> Unit) {
    Box(Modifier.padding(top = 4.dp, end = 4.dp)) {
        Box(Modifier.size(58.dp).clip(RoundedCornerShape(12.dp)).background(colors.surfaceHigh).testTag("attachmentThumb"), contentAlignment = Alignment.Center) {
            a.preview?.let { Image(it, null, contentScale = ContentScale.Crop, modifier = Modifier.size(58.dp)) }
            when (a.state) {
                Attachment.State.Preparing, Attachment.State.Uploading -> Box(Modifier.size(58.dp).background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                }
                Attachment.State.Failed -> Box(Modifier.size(58.dp).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Warning, null, tint = Color.Yellow)
                }
                is Attachment.State.Ready -> {}
            }
        }
        Icon(Icons.Outlined.Cancel, tr("빼기", "Remove"), tint = Color.White,
            modifier = Modifier.align(Alignment.TopEnd).offset(x = 7.dp, y = (-7).dp).size(22.dp).clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.65f)).clickable(onClick = onRemove).testTag("attachmentRemove"))
    }
}
