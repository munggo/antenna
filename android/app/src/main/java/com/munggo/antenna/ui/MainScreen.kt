package com.munggo.antenna.ui

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddToPhotos
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Battery0Bar
import androidx.compose.material.icons.outlined.Battery3Bar
import androidx.compose.material.icons.outlined.Battery5Bar
import androidx.compose.material.icons.outlined.BatteryFull
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.munggo.antenna.model.MacBattery
import com.munggo.antenna.model.TmuxWindow
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr
import com.munggo.antenna.ui.chat.ChatView
import com.munggo.antenna.ui.input.InputBar
import com.munggo.antenna.ui.sheets.JobsSheet
import com.munggo.antenna.ui.usage.UsageSheet
import kotlinx.coroutines.launch

/**
 * 본 화면(아이폰 앱의 TerminalScreen 과 같은 배치).
 * 위: 서랍 단추(☰ + 다른 탭 상태 점) · 제목/연결 상태 · 오른쪽 알약(컨텍스트·보기 전환·더 보기)
 * 왼쪽 서랍: 탭 목록·새 탭·사용량·연결 설정 / 가운데: 채팅 또는 터미널 / 아래: 입력창
 */
@Composable
fun MainScreen(session: BridgeSession, onSettings: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("view", Context.MODE_PRIVATE) }
    // 보기 방식(chat | terminal). 채팅이 가능할 때만 chat 이 적용된다
    var viewMode by remember { mutableStateOf(prefs.getString("viewMode", "chat") ?: "chat") }
    LaunchedEffect(viewMode) { prefs.edit().putString("viewMode", viewMode).apply() }
    val showChat = session.chat.available && viewMode == "chat"
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var showUsage by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<TmuxWindow?>(null) }
    var closeTarget by remember { mutableStateOf<TmuxWindow?>(null) }
    var confirmCloseFinished by remember { mutableStateOf(false) }
    var confirmNewChat by remember { mutableStateOf(false) }
    var confirmRotate by remember { mutableStateOf(false) }
    var jobsTab by remember { mutableStateOf<TmuxWindow?>(null) }
    val active = session.windows.firstOrNull { it.active }

    // 터미널 보기를 앞에서 볼 때만 맥 tmux 창을 폰 크기로(채팅·뒤로 간 동안엔 맥 크기 그대로)
    var resumed by remember { mutableStateOf(true) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_RESUME) resumed = true
            if (e == Lifecycle.Event.ON_PAUSE) resumed = false
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(showChat, resumed, session.status) {
        if (session.status == BridgeSession.Status.Connected) session.setTerminalVisible(resumed && !showChat)
    }
    // 서랍을 열면 아래 사용량 카드를 위해 사용량을 청함(브리지가 1분 저장)
    LaunchedEffect(drawer.isOpen) { if (drawer.isOpen) session.requestUsage(false) }

    val width = LocalConfiguration.current.screenWidthDp.dp
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = colors.bg, modifier = Modifier.width(minOf(320.dp, width * 0.82f))) {
                TabDrawer(
                    session = session,
                    onSelect = { i -> session.selectWindow(i); scope.launch { drawer.close() } },
                    onJobs = { w ->
                        // 그 탭으로 가서 작업 목록을 엶(목록은 그 탭의 Claude Code 연결부가 답함)
                        if (!w.active) session.selectWindow(w.index)
                        scope.launch { drawer.close() }
                        jobsTab = w
                    },
                    onRename = { renameTarget = it },
                    onCloseWindow = { closeTarget = it },
                    onCloseFinished = { confirmCloseFinished = true },
                    onSettings = { scope.launch { drawer.close() }; onSettings() },
                    onUsage = { scope.launch { drawer.close() }; showUsage = true },
                    modifier = Modifier.statusBarsPadding().navigationBarsPadding(),
                )
            }
        },
    ) {
        Box(Modifier.fillMaxSize().background(colors.bg)) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                Header(
                    session, showChat,
                    onDrawer = { scope.launch { drawer.open() } },
                    onToggleView = { viewMode = if (showChat) "terminal" else "chat" },
                    onUsage = { showUsage = true },
                    onRotate = { confirmRotate = true },
                    onNewChat = { confirmNewChat = true },
                    onRename = { active?.let { renameTarget = it } },
                    onClose = { active?.let { closeTarget = it } },
                )
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    // 터미널은 늘 배치해 크기·내용을 유지하고, 채팅일 때는 가린다
                    TerminalPane(session, interactive = !showChat, modifier = Modifier.alpha(if (showChat) 0f else 1f))
                    if (showChat) ChatView(session)
                }
                InputBar(session, onTerminalCommand = { viewMode = "terminal" })
            }
            // 화면 위에 잠깐 띄우는 안내(저장·실패 등)
            AnimatedVisibility(session.toast != null, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 56.dp)) {
                Text(session.toast ?: "", color = colors.text, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.shadow(6.dp, CircleShape).clip(CircleShape).background(colors.surfaceHigh).border(1.dp, colors.border, CircleShape)
                        .padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
    }

    session.thumbs.viewing?.let { path -> ImageViewer(session, session.chat.imagePaths, path) { session.thumbs.viewing = null } }
    if (showUsage) UsageSheet(onDismiss = { showUsage = false })
    jobsTab?.let { w -> JobsSheet(tab = w, onDismiss = { jobsTab = null }) }

    renameTarget?.let { w ->
        var name by remember(w.index) { mutableStateOf(w.name) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(tr("창 이름 바꾸기", "Rename window")) },
            text = { OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(tr("이름", "Name")) }) },
            confirmButton = { TextButton({ name.trim().takeIf { it.isNotEmpty() }?.let { session.renameWindow(w.index, it) }; renameTarget = null }) { Text(tr("바꾸기", "Rename")) } },
            dismissButton = { TextButton({ renameTarget = null }) { Text(tr("취소", "Cancel")) } },
        )
    }
    closeTarget?.let { w ->
        val last = session.windows.size <= 1
        AlertDialog(
            onDismissRequest = { closeTarget = null },
            title = { Text(tr("'${w.name.ifEmpty { "창 ${w.index}" }}' 창을 닫을까요?", "Close the window '${w.name.ifEmpty { "Window ${w.index}" }}'?")) },
            text = { Text(if (last) tr("마지막 창은 닫을 수 없어요.", "You can't close the last window.") else tr("이 창에서 실행 중인 작업도 함께 종료돼요.", "Anything running in this window will also stop.")) },
            confirmButton = { if (!last) TextButton({ session.closeWindow(w.index); closeTarget = null }) { Text(tr("창 닫기", "Close window"), color = colors.red) } },
            dismissButton = { TextButton({ closeTarget = null }) { Text(tr("취소", "Cancel")) } },
        )
    }
    if (confirmCloseFinished) {
        val n = session.windows.count { it.finishedBackground }
        AlertDialog(
            onDismissRequest = { confirmCloseFinished = false },
            title = { Text(tr("끝난 백그라운드 탭 ${n}개를 닫을까요?", "Close $n finished background tab(s)?")) },
            text = { Text(tr("결과는 시킨 탭에 이미 보냈어요. 그 탭들에서 켜 둔 pi·Claude Code 도 함께 꺼져요.", "Results were already sent to the tabs that asked. pi or Claude Code running in those tabs will also quit.")) },
            confirmButton = { TextButton({ session.closeFinishedBackground(); confirmCloseFinished = false }) { Text(tr("모두 닫기", "Close all"), color = colors.red) } },
            dismissButton = { TextButton({ confirmCloseFinished = false }) { Text(tr("취소", "Cancel")) } },
        )
    }
    if (confirmRotate) AlertDialog(
        onDismissRequest = { confirmRotate = false },
        title = { Text(tr("연결 토큰을 새로 바꿀까요?", "Replace the connection token?")) },
        text = { Text(tr("맥이 새 토큰을 만들어 이 폰에 저장하고 다시 연결해요. 예전 토큰은 더 이상 쓸 수 없어요.", "The Mac makes a new token, saves it on this phone and reconnects. The old token stops working.")) },
        confirmButton = { TextButton({ session.rotateToken(); confirmRotate = false }) { Text(tr("새로 바꾸기", "Replace")) } },
        dismissButton = { TextButton({ confirmRotate = false }) { Text(tr("취소", "Cancel")) } },
    )
    if (confirmNewChat) {
        // 이 탭에서 도는 것의 이름으로(Claude Code 탭에서는 /clear 로 바뀌어 들어가고, 둘 다 /resume 으로 다시 엶)
        val agent = if (session.chat.meta.agentName == "Claude") "Claude Code" else "pi"
        AlertDialog(
            onDismissRequest = { confirmNewChat = false },
            title = { Text(tr("새 대화를 시작할까요?", "Start a new conversation?")) },
            text = { Text(tr("지금 대화는 $agent 기록에 남아요. 맥 $agent 에서 /resume 으로 다시 열 수 있어요.", "This conversation stays in $agent's history. You can reopen it with /resume in $agent on the Mac.")) },
            confirmButton = { TextButton({ session.newConversation(); confirmNewChat = false }) { Text(tr("새 대화 시작", "Start new conversation")) } },
            dismissButton = { TextButton({ confirmNewChat = false }) { Text(tr("취소", "Cancel")) } },
        )
    }
}

@Composable
private fun Header(
    session: BridgeSession, showChat: Boolean, onDrawer: () -> Unit, onToggleView: () -> Unit, onUsage: () -> Unit,
    onRotate: () -> Unit, onNewChat: () -> Unit, onRename: () -> Unit, onClose: () -> Unit,
) {
    val active = session.windows.firstOrNull { it.active }
    val connected = session.status == BridgeSession.Status.Connected
    val (dot, status) = when (session.status) {
        BridgeSession.Status.Connected -> if (session.isWorking) colors.accent to tr("작업 중", "Working") else colors.green to tr("연결됨", "Connected")
        BridgeSession.Status.Connecting -> colors.accent to tr("연결 중", "Connecting")
        BridgeSession.Status.Closed -> colors.muted to tr("종료됨", "Closed")
        BridgeSession.Status.Idle -> colors.muted to tr("대기", "Idle")
    }
    Row(
        Modifier.fillMaxWidth().background(colors.bg).padding(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        TabDrawerButton(session.windows, onDrawer)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(active?.name?.ifEmpty { null } ?: "pi", color = colors.text, fontSize = Typo.title, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable(enabled = active != null, onClick = onRename))
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
                Text(status, color = colors.muted, fontSize = Typo.subtitle, maxLines = 1)
                // 맥북 배터리: 연결돼 있을 때만(끊긴 동안의 값은 낡았을 수 있음)
                val b = session.macBattery
                if (connected && b != null) {
                    Text("·", color = colors.muted, fontSize = Typo.subtitle)
                    MacBatteryLabel(b)
                }
            }
        }
        Row(
            Modifier.height(40.dp).clip(CircleShape).background(colors.surfaceHigh).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showChat) ContextTopButton()
            if (session.chat.available) Icon(
                if (showChat) Icons.Outlined.Terminal else Icons.AutoMirrored.Outlined.Chat,
                tr("보기 바꾸기", "Switch view"), tint = colors.text,
                modifier = Modifier.size(22.dp).clickable(onClick = onToggleView).testTag("viewToggle"),
            )
            MoreMenu(session, onUsage, onRotate, onNewChat, onRename, onClose)
        }
    }
}

@Composable
private fun MoreMenu(session: BridgeSession, onUsage: () -> Unit, onRotate: () -> Unit, onNewChat: () -> Unit, onRename: () -> Unit, onClose: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    var newTab by remember { mutableStateOf(false) }
    val connected = session.status == BridgeSession.Status.Connected
    val active = session.windows.firstOrNull { it.active }
    Box {
        Icon(Icons.Outlined.MoreHoriz, tr("더 보기", "More"), tint = colors.text, modifier = Modifier.size(24.dp).clickable { open = true }.testTag("moreMenu"))
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text(tr("사용량", "Usage")) }, leadingIcon = { Icon(Icons.Outlined.BarChart, null) }, onClick = { open = false; onUsage() })
            DropdownMenuItem(text = { Text(tr("연결 토큰 바꾸기", "Replace connection token")) }, leadingIcon = { Icon(Icons.Outlined.Key, null) },
                enabled = connected, onClick = { open = false; onRotate() })
            DropdownMenuItem(text = { Text(tr("새 대화", "New conversation")) }, leadingIcon = { Icon(Icons.Outlined.EditNote, null) },
                enabled = session.chat.available && !session.isWorking, onClick = { open = false; onNewChat() })
            HorizontalDivider()
            // 질문·승인·확인 창은 늘 알림, 작업이 끝났을 때는 고름
            val minSec = session.pushDoneMinSec
            val span = if (minSec >= 3600) tr("${minSec / 3600}시간", "${minSec / 3600} h") else tr("${maxOf(1, minSec / 60)}분", "${maxOf(1, minSec / 60)} min")
            Text(if (session.pushOnMac) tr("알림", "Notifications") else tr("알림(맥 설정 없음)", "Notifications (not set up on the Mac)"),
                color = colors.muted, fontSize = Typo.caption, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            DropdownMenuItem(
                text = { Text(tr("$span 넘게 걸린 작업이 끝나면 알림", "Notify when work that took over $span finishes")) },
                leadingIcon = { Checkbox(session.pushDone, null) },
                onClick = { session.changePushDone(!session.pushDone) },
            )
            DropdownMenuItem(text = { Text(tr("시험 알림 보내기", "Send a test notification")) }, leadingIcon = { Icon(Icons.Outlined.NotificationsActive, null) },
                onClick = { open = false; session.sendTestPush() })
            HorizontalDivider()
            DropdownMenuItem(text = { Text(tr("새 창 열기", "Open a new window")) }, leadingIcon = { Icon(Icons.Outlined.AddToPhotos, null) },
                onClick = { if (session.newTabTools.isEmpty()) { open = false; session.newWindow(null) } else newTab = !newTab })
            if (newTab) NewTabChoices(session) { open = false; newTab = false }
            if (active != null) {
                DropdownMenuItem(text = { Text(tr("창 이름 바꾸기", "Rename window")) }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { open = false; onRename() })
                DropdownMenuItem(text = { Text(tr("창 닫기", "Close window"), color = colors.red) }, leadingIcon = { Icon(Icons.Outlined.Close, null, tint = colors.red) },
                    enabled = session.windows.size > 1, onClick = { open = false; onClose() })
            }
            DropdownMenuItem(text = { Text(tr("실행 중지", "Stop"), color = colors.red) }, leadingIcon = { Icon(Icons.Outlined.StopCircle, null, tint = colors.red) },
                onClick = { open = false; session.interrupt() })
        }
    }
}

/** 맥북 배터리: 충전기를 꽂았으면 번개, 아니면 잔량에 가까운 배터리 그림. 충전기 없이 낮으면 빨갛게 */
@Composable
fun MacBatteryLabel(b: MacBattery) {
    val color = if (b.low) colors.red else colors.muted
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("macBattery")) {
        val icon = when {
            b.plugged -> Icons.Outlined.Bolt
            b.percent < 13 -> Icons.Outlined.Battery0Bar
            b.percent < 50 -> Icons.Outlined.Battery3Bar
            b.percent < 88 -> Icons.Outlined.Battery5Bar
            else -> Icons.Outlined.BatteryFull
        }
        Icon(icon, null, tint = color, modifier = Modifier.size(13.dp))
        Text("${b.percent}%", color = color, fontSize = Typo.subtitle, maxLines = 1)
    }
}
