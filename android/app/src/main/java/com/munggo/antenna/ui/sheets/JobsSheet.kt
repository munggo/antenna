package com.munggo.antenna.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.BgJob
import com.munggo.antenna.model.TmuxWindow
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr
import com.munggo.antenna.ui.CloseCircle
import com.munggo.antenna.ui.LocalSession
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.minus
import com.munggo.antenna.ui.plus
import com.munggo.antenna.ui.rememberNow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 뒤에서 도는 작업 목록(서랍의 '백그라운드 작업 N ›'을 누르면): 작업마다 종류·이름·걸린 시간·셸의 최근 출력과 종료.
 * 에이전트는 그 아래 줄에 종류·모델·생각 깊이(맥이 확실히 아는 것만).
 * 셸은 맥에서 바로 종료하고, 에이전트·감시는 에이전트에게 종료해 달라고 보낸다(맥 연결부가 처리).
 * 열려 있는 동안 2초마다 새로 받는다. 탭을 막 바꿨을 때 들어온 다른 탭의 목록은 쓰지 않는다(창 번호로 가림)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsSheet(tab: TmuxWindow, onDismiss: () -> Unit) {
    val session = LocalSession.current
    val meta = session.chat.meta
    val store = session.chat
    var confirm by remember { mutableStateOf<BgJob?>(null) }
    // 아이폰의 중간·큰 높이처럼: 처음엔 반쯤 열리고 끌어올리면 다 열린다
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { if (!sheetState.isVisible) onDismiss() }
    }

    // 열 때 지난 목록을 비우고 받은 뒤, 열려 있는 동안 2초마다 다시 받는다
    LaunchedEffect(tab.index) {
        meta.bgJobs = null
        meta.bgJobsError = null
        session.requestBgJobs()
        while (true) {
            delay(2000)
            session.requestBgJobs()
        }
    }

    // 탭 이름이 그사이 바뀌었을 수 있어 최신 탭 목록에서 다시 찾는다
    val current = session.windows.firstOrNull { it.index == tab.index } ?: tab

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        containerColor = colors.bg,
        contentColor = colors.text,
    ) {
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth()) {
                JobsHeader(subtitle = tabTitle(current), onClose = close)
                JobsContent(
                    session = session,
                    tab = tab,
                    minHeight = LocalConfiguration.current.screenHeightDp.dp * 0.4f,
                    onKill = { confirm = it },
                )
            }
            store.notice?.let { n ->
                Text(
                    n,
                    fontSize = Typo.caption + 1.sp,
                    color = colors.text,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 20.dp)
                        .clip(CircleShape)
                        .background(colors.surfaceHigh)
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
    }

    confirm?.let { j ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(confirmTitle(j), fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Text(
                    if (j.kind == "shell") tr(
                        "맥에서 바로 종료해요. Claude Code 는 이 셸이 끝났다는 알림을 받아요.",
                        "Stops it on the Mac right away. Claude Code is told that the shell has ended.",
                    ) else tr(
                        "Claude 에게 이 작업을 종료해 달라고 보내요. 일하는 중이면 다음 단계에서 종료해요.",
                        "Asks Claude to stop this task. If it's busy, it stops at the next step.",
                    ),
                    fontSize = Typo.row - 1.sp,
                )
            },
            confirmButton = {
                TextButton(onClick = { session.killBgJob(j.id); confirm = null }) {
                    Text(
                        if (j.kind == "shell") tr("셸 종료", "Stop shell") else tr("종료해 달라고 보내기", "Ask it to stop"),
                        color = colors.red, fontWeight = FontWeight.SemiBold,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirm = null }) { Text(tr("취소", "Cancel"), color = colors.text) }
            },
            containerColor = colors.bgElevated,
            titleContentColor = colors.text,
            textContentColor = colors.muted,
        )
    }
}

/** 위쪽 줄: 왼쪽 닫기, 가운데 제목과 탭 이름 */
@Composable
private fun JobsHeader(subtitle: String, onClose: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp)) {
        Box(Modifier.align(Alignment.CenterStart)) { CloseCircle(onClick = onClose) }
        Column(
            Modifier.align(Alignment.Center).padding(horizontal = 44.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(tr("백그라운드 작업", "Background tasks"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = colors.text, maxLines = 1)
            Text(subtitle, fontSize = Typo.caption, color = colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun JobsContent(session: BridgeSession, tab: TmuxWindow, minHeight: Dp, onKill: (BgJob) -> Unit) {
    val meta = session.chat.meta
    val err = meta.bgJobsError
    // 이 탭의 목록(다른 탭의 목록이면 아직 못 받은 것으로)
    val mine = if (meta.bgJobsWindow == tab.index) meta.bgJobs else null
    when {
        err != null -> CenteredBox(minHeight) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(err, fontSize = Typo.row, color = colors.muted)
                TextButton(onClick = { meta.bgJobsError = null; session.requestBgJobs() }) {
                    Text(tr("다시 시도", "Try again"), fontSize = Typo.row, color = colors.text)
                }
            }
        }
        mine != null && mine.isEmpty() -> CenteredBox(minHeight) {
            Text(tr("뒤에서 도는 작업이 없어요", "Nothing is running in the background"), fontSize = Typo.row, color = colors.muted)
        }
        mine != null -> LazyColumn(
            Modifier.fillMaxWidth().heightIn(min = minHeight),
            contentPadding = PaddingValues(bottom = 60.dp),
        ) {
            items(mine, key = { it.id }) { j ->
                JobRow(j, onKill = { onKill(j) })
                Box(Modifier.padding(start = 52.dp).fillMaxWidth().height(0.5.dp).background(colors.border))
            }
        }
        session.status != BridgeSession.Status.Connected -> CenteredBox(minHeight) {
            Text(tr("맥에 연결되면 목록을 불러와요", "The list loads once you're connected to the Mac"), fontSize = Typo.row, color = colors.muted)
        }
        else -> CenteredBox(minHeight) {
            CircularProgressIndicator(color = colors.muted, strokeWidth = 2.5.dp, modifier = Modifier.size(24.dp))
        }
    }
}

/** 빈 목록·불러오는 중 같은 안내를 시트 가운데에(아이폰의 중간 높이 시트처럼 반쯤은 차지) */
@Composable
private fun CenteredBox(minHeight: Dp, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().height(minHeight).padding(horizontal = 24.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun JobRow(j: BgJob, onKill: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                Icon(kindIcon(j.kind), contentDescription = kindName(j.kind), tint = colors.accent, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(j.title, fontSize = Typo.row, color = colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                JobSubline(j)
                val agent = agentLine(j)
                if (agent.isNotEmpty()) {
                    Text(agent, fontSize = Typo.caption + 1.sp, color = colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(
                tr("종료", "Stop"),
                fontSize = Typo.caption + 1.sp,
                fontWeight = FontWeight.Medium,
                color = colors.red,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(colors.surfaceHigh)
                    .clickable(onClick = onKill)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        val t = j.tail
        if (!t.isNullOrEmpty()) {
            Text(
                t,
                fontSize = Typo.codeSmall - 1.sp,
                fontFamily = FontFamily.Monospace,
                color = colors.muted,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(start = 32.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(colors.bgElevated)
                    .padding(8.dp),
            )
        }
    }
}

/** 걸린 시간 줄(1초마다 바뀌므로 이 줄만 다시 그린다) */
@Composable
private fun JobSubline(j: BgJob) {
    val now = rememberNow()
    Text(subline(j, now), fontSize = Typo.caption + 1.sp, color = colors.muted)
}

/** "셸 · 12분째" */
private fun subline(j: BgJob, nowMs: Long): String {
    val sec = (nowMs / 1000.0 - j.startedAt / 1000.0).toInt()
    val kind = kindName(j.kind)
    val d = duration(sec)
    return tr("$kind · ${d}째", "$kind · $d")
}

/** 에이전트의 종류·모델·생각 깊이: "Explore · Haiku 5.5 · 높음"(모르는 값은 뺌). 에이전트가 아니거나 다 모르면 "" */
private fun agentLine(j: BgJob): String {
    if (j.kind != "agent") return ""
    return listOf(j.agentType ?: "", j.model ?: "", thinkingName(j.thinking ?: "")).filter { it.isNotEmpty() }.joinToString(" · ")
}

private fun kindName(k: String): String = when (k) {
    "shell" -> tr("셸", "Shell")
    "agent" -> tr("에이전트", "Agent")
    "monitor" -> tr("감시", "Monitor")
    else -> tr("작업", "Task")
}

private fun kindIcon(k: String): ImageVector = when (k) {
    "shell" -> Icons.Outlined.Terminal
    "agent" -> Icons.Outlined.Group
    "monitor" -> Icons.Outlined.Visibility
    else -> Icons.Outlined.Settings
}

private fun confirmTitle(j: BgJob): String {
    val name = if (j.title.length > 30) j.title.take(30) + "…" else j.title
    val obj = kindObject(j.kind)
    return tr("'$name' $obj 종료할까요?", "Stop $obj '$name'?")
}

/** 종류 + 받침에 맞는 목적격 조사: "셸을", "에이전트를", "감시를", "작업을" */
private fun kindObject(k: String): String = when (k) {
    "shell" -> tr("셸을", "the shell")
    "agent" -> tr("에이전트를", "the agent")
    "monitor" -> tr("감시를", "the monitor")
    else -> tr("작업을", "the task")
}

// 아래는 아이폰 앱 서랍(TabDrawer.swift)의 BackgroundText 가운데 이 시트가 쓰는 것만 옮겼다

/** 걸린 시간: "40초", "12분", "1시간 5분", "2일" */
private fun duration(sec: Int): String {
    val s = maxOf(0, sec)
    if (s < 60) return tr("${s}초", "${s}s")
    if (s < 3600) return tr("${s / 60}분", "${s / 60}m")
    if (s < 86400) {
        val h = s / 3600
        val m = s % 3600 / 60
        return if (m == 0) tr("${h}시간", "${h}h") else tr("${h}시간 ${m}분", "${h}h ${m}m")
    }
    return tr("${s / 86400}일", "${s / 86400}d")
}

/** 탭 이름(앞의 'bg ' 를 뗌). 비어 있으면 "창 N" */
private fun tabTitle(w: TmuxWindow): String {
    val n = if (w.name.startsWith("bg ")) w.name.drop(3) else w.name
    return n.ifEmpty { tr("창 ${w.index}", "Tab ${w.index}") }
}

/** 생각 깊이 → 짧은 말(맥 화면의 '백그라운드: …' 줄과 같은 낱말). 모르는 값은 "" */
private fun thinkingName(level: String): String = when (level) {
    "off" -> tr("생각 끔", "No thinking")
    "minimal" -> tr("최소", "Minimal")
    "low" -> tr("낮음", "Low")
    "medium" -> tr("보통", "Medium")
    "high" -> tr("높음", "High")
    "xhigh" -> tr("매우 높음", "Very high")
    "max" -> tr("최대", "Max")
    else -> ""
}
