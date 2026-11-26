package com.munggo.antenna.ui

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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.filled.Help
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.TmuxWindow
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr
import com.munggo.antenna.ui.input.modelName
import com.munggo.antenna.ui.usage.DrawerUsageCard
import kotlinx.coroutines.delay

/** 탭(tmux 창)의 상태 색·글자. 맥 tmux 탭의 점 색과 같은 뜻 */
object TabStatus {
    @Composable
    fun color(s: String): Color = when (s) {
        "working" -> colors.accent      // 작업 중: 주황
        "asking" -> colors.purple       // 답을 기다림: 보라
        "yourturn" -> colors.green      // 끝남(아직 안 봄): 초록
        else -> colors.muted.copy(alpha = 0.45f)
    }

    fun label(s: String) = when (s) {
        "working" -> tr("작업 중", "Working")
        "asking" -> tr("답을 기다려요", "Waiting for you")
        "yourturn" -> tr("끝났어요", "Done")
        else -> ""
    }
}

/** 서랍 '백그라운드' 칸의 글: 이름은 앞의 'bg ' 를 뗀 할 일, 그 아래 "작업 중 · 12분 · 메인 작업에서 시킴" 처럼 */
object BackgroundText {
    /** 걸린 시간: "40초", "12분", "1시간 5분", "2일" */
    fun duration(sec: Long): String {
        val s = maxOf(0L, sec)
        if (s < 60) return tr("${s}초", "${s}s")
        if (s < 3600) return tr("${s / 60}분", "${s / 60}m")
        if (s < 86400) {
            val m = s % 3600 / 60
            return if (m == 0L) tr("${s / 3600}시간", "${s / 3600}h") else tr("${s / 3600}시간 ${m}분", "${s / 3600}h ${m}m")
        }
        return tr("${s / 86400}일", "${s / 86400}d")
    }

    fun title(w: TmuxWindow): String {
        val n = if (w.name.startsWith("bg ")) w.name.drop(3) else w.name
        return n.ifEmpty { tr("창 ${w.index}", "Window ${w.index}") }
    }

    /** 뒤에서 도는 일("셸 1개 · 에이전트 2개")을 "백그라운드 작업 3" 처럼 합한 수로. 없으면 "" */
    fun jobs(s: String): String {
        if (s.isEmpty()) return ""
        val n = s.split("·").sumOf { part -> part.filter { it.isDigit() }.toIntOrNull() ?: 0 }
        return if (n > 0) tr("백그라운드 작업 $n", "Background tasks $n") else tr("백그라운드 작업", "Background tasks")
    }

    fun thinking(level: String) = when (level) {
        "off" -> tr("생각 끔", "No thinking")
        "minimal" -> tr("최소", "Minimal")
        "low" -> tr("낮음", "Low")
        "medium" -> tr("보통", "Medium")
        "high" -> tr("높음", "High")
        "xhigh" -> tr("매우 높음", "Extra high")
        "max" -> tr("최대", "Max")
        else -> ""
    }

    /** 백그라운드 탭이 쓰는 모델·생각 깊이: "Opus 5.5 · 높음". 모델을 모르면 "" */
    fun model(w: TmuxWindow): String =
        if (w.model.isEmpty()) "" else listOf(modelName(w.model), thinking(w.thinking)).filter { it.isNotEmpty() }.joinToString(" · ")

    /** 상태(걸린 시간·끝난 때) · 시킨 쪽. now: 1970년부터 초 */
    fun line(w: TmuxWindow, now: Long): String {
        val b = w.bg ?: return ""
        val parts = ArrayList<String>()
        when (w.status) {
            "working" -> parts += if (b.started > 0) tr("작업 중 · ${duration(now - b.started)}", "Working · ${duration(now - b.started)}") else tr("작업 중", "Working")
            "asking" -> parts += tr("답을 기다려요", "Waiting for you")
            else -> parts += when {
                b.done > 0 -> if (now - b.done < 60) tr("끝남 · 방금", "Done · just now") else tr("끝남 · ${duration(now - b.done)} 전", "Done · ${duration(now - b.done)} ago")
                w.status == "yourturn" -> tr("끝났어요", "Done")
                else -> tr("쉬는 중", "Idle")
            }
        }
        val from = b.fromName.ifEmpty { b.from?.let { tr("창 $it", "Window $it") } ?: "" }
        when (b.by) {
            "ai" -> parts += if (from.isEmpty()) tr("AI가 시킴", "Started by AI") else tr("${from}의 AI가 시킴", "Started by AI in $from")
            "phone" -> parts += tr("폰에서 시킴", "Started from phone")
            "shortcut" -> parts += tr("단축어로 시킴", "Started by a shortcut")
            else -> if (from.isNotEmpty()) parts += tr("${from}에서 시킴", "Started from $from")
        }
        return parts.joinToString(" · ")
    }
}

/**
 * 왼쪽 위 서랍 단추(☰). 다른 탭에 있는 상태마다 색 점을 오른쪽 위에 살짝 겹쳐 보인다(최대 3개).
 * 지금 보는 탭은 빼고, 백그라운드 탭은 답을 기다릴 때만 넣는다
 */
@Composable
fun TabDrawerButton(windows: List<TmuxWindow>, onClick: () -> Unit) {
    val others = windows.filter { !it.active && (it.bg == null || it.status == "asking") }
    val badges = listOf("asking", "yourturn", "working").filter { s -> others.any { it.status == s } }
    Box {
        Box(Modifier.size(40.dp).clip(CircleShape).background(colors.surfaceHigh).clickable(onClick = onClick).testTag("drawerButton"),
            contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Menu, tr("탭 목록", "Tabs"), tint = colors.text, modifier = Modifier.size(20.dp))
        }
        // 왼쪽부터 덜 급한 순서, 오른쪽(모서리)일수록 위에 겹침
        if (badges.isNotEmpty()) Row(Modifier.align(Alignment.TopEnd).offset(x = 1.dp, y = (-1).dp), horizontalArrangement = Arrangement.spacedBy((-5).dp)) {
            for (s in badges.reversed()) Box(Modifier.size(11.dp).clip(CircleShape).background(colors.bg).padding(2.dp).clip(CircleShape).background(TabStatus.color(s)))
        }
    }
}

/** 새 탭에서 무엇을 켤지 고르는 항목들(서랍의 + 와 … 메뉴의 '새 창 열기') */
@Composable
fun NewTabChoices(session: BridgeSession, close: () -> Unit) {
    for (tool in session.newTabTools) DropdownMenuItem(text = { Text(tool.title) }, onClick = { close(); session.newWindow(tool) })
}

/**
 * 왼쪽 서랍(Claude 앱 방식): 탭을 세로로 이름·상태와 함께. 맨 위 새 탭, 아래 사용량·연결 설정.
 * - 탭을 누르면 그 탭으로, 길게 누르면 이름 바꾸기·닫기
 * - 백그라운드 탭은 아래 '백그라운드' 칸에 따로, 끝난 것 모두 닫기
 * - 탭 안에서 뒤에서 도는 일이 있으면 그 줄 아래 "백그라운드 작업 3 ›"(누르면 작업 목록)
 */
@Composable
fun TabDrawer(
    session: BridgeSession,
    onSelect: (Int) -> Unit,
    onJobs: (TmuxWindow) -> Unit,
    onRename: (TmuxWindow) -> Unit,
    onCloseWindow: (TmuxWindow) -> Unit,
    onCloseFinished: () -> Unit,
    onSettings: () -> Unit,
    onUsage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val main = session.windows.filter { it.bg == null }
    val bg = session.windows.filter { it.bg != null }
    // 걸린 시간은 서랍이 열려 있는 동안 30초마다 다시 셈
    var now by remember { mutableLongStateOf(System.currentTimeMillis() / 1000) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = System.currentTimeMillis() / 1000 } }
    Column(modifier.fillMaxHeight().background(colors.bg).testTag("drawer")) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(tr("탭", "Tabs"), color = colors.text, fontSize = Typo.title, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Box {
                var open by remember { mutableStateOf(false) }
                Box(Modifier.size(40.dp).clip(CircleShape).background(colors.surfaceHigh).clickable {
                    // 고를 것을 알려 주지 않는 예전 맥 브리지에서는 바로 연다
                    if (session.newTabTools.isEmpty()) session.newWindow(null) else open = true
                }.testTag("drawerNewTab"), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Add, tr("새 탭", "New tab"), tint = colors.text)
                }
                DropdownMenu(open, { open = false }) { NewTabChoices(session) { open = false } }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (w in main) TabRow(w, now, onSelect, onJobs, onRename, onCloseWindow)
            if (bg.isNotEmpty()) {
                val finished = bg.count { it.finishedBackground }
                Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(tr("백그라운드 ${bg.size}", "Background ${bg.size}"), color = colors.muted, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.testTag("drawerBgTitle"))
                    Spacer(Modifier.weight(1f))
                    if (finished > 0) Text(tr("끝난 것 모두 닫기", "Close all finished"), color = colors.text, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.clip(CircleShape).background(colors.surfaceHigh).clickable(onClick = onCloseFinished)
                            .padding(horizontal = 10.dp, vertical = 5.dp).testTag("bgCloseFinished"))
                }
                for (w in bg) TabRow(w, now, onSelect, onJobs, onRename, onCloseWindow)
            }
        }
        Box(Modifier.padding(horizontal = 12.dp).padding(bottom = 10.dp)) { DrawerUsageCard(onUsage) }
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
        Row(
            Modifier.fillMaxWidth().padding(8.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onSettings).padding(horizontal = 12.dp, vertical = 11.dp).testTag("drawerSettings"),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Settings, null, tint = colors.muted, modifier = Modifier.width(22.dp))
            Text(tr("연결 설정", "Connection settings"), color = colors.text, fontSize = Typo.row)
        }
    }
}

/** 탭 한 줄: 상태 그림, 이름, 그 아래 글. 뒤에서 도는 일이 있으면 그 아래 따로 누르는 '백그라운드 작업 N ›' */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TabRow(
    w: TmuxWindow, now: Long, onSelect: (Int) -> Unit, onJobs: (TmuxWindow) -> Unit,
    onRename: (TmuxWindow) -> Unit, onCloseWindow: (TmuxWindow) -> Unit,
) {
    val isBg = w.bg != null
    val title = if (isBg) BackgroundText.title(w) else w.name.ifEmpty { tr("창 ${w.index}", "Window ${w.index}") }
    val sub = if (isBg) BackgroundText.line(w, now) else TabStatus.label(w.status)
    val model = if (isBg) BackgroundText.model(w) else ""
    val jobs = BackgroundText.jobs(w.jobs)
    val subColor = if (w.status == "working" || w.status == "asking" || !isBg) TabStatus.color(w.status) else colors.muted
    var menu by remember { mutableStateOf(false) }
    Box {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (w.active) colors.surfaceHigh else Color.Transparent)
                .alpha(if (w.finishedBackground && !w.active) 0.6f else 1f),
        ) {
            Row(
                Modifier.fillMaxWidth().combinedClickable(onClick = { onSelect(w.index) }, onLongClick = { menu = true })
                    .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = if (jobs.isEmpty()) 10.dp else 2.dp).testTag("tab-${w.index}"),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) { StatusIcon(w) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(title, color = colors.text, fontSize = Typo.row, fontWeight = if (w.active) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (sub.isNotEmpty()) Text(sub, color = subColor, fontSize = Typo.caption + 1.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (model.isNotEmpty()) Text(model, color = colors.muted, fontSize = Typo.caption + 1.sp, maxLines = 1)
                }
            }
            if (jobs.isNotEmpty()) Row(
                Modifier.fillMaxWidth().clickable { onJobs(w) }.padding(start = 46.dp, end = 12.dp, top = 2.dp, bottom = 10.dp).testTag("tab-jobs-${w.index}"),
                horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(jobs, color = colors.accent, fontSize = Typo.caption + 1.sp)
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = colors.accent, modifier = Modifier.size(14.dp))
            }
        }
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem(text = { Text(tr("이름 바꾸기", "Rename")) }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { menu = false; onRename(w) })
            DropdownMenuItem(text = { Text(tr("창 닫기", "Close window"), color = colors.red) }, leadingIcon = { Icon(Icons.Outlined.Close, null, tint = colors.red) },
                onClick = { menu = false; onCloseWindow(w) })
        }
    }
}

@Composable
private fun StatusIcon(w: TmuxWindow) {
    when {
        w.status == "working" -> CircularProgressIndicator(Modifier.size(15.dp), color = colors.accent, strokeWidth = 2.dp)
        w.status == "asking" -> Icon(Icons.Filled.Help, null, tint = colors.purple, modifier = Modifier.size(18.dp))
        (w.bg?.done ?: 0) > 0 -> Icon(Icons.Outlined.CheckCircle, null, tint = colors.green, modifier = Modifier.size(17.dp))
        w.status == "yourturn" -> Box(Modifier.size(9.dp).clip(CircleShape).background(colors.green))
        else -> Box(Modifier.size(9.dp).clip(CircleShape).border(1.5.dp, colors.muted.copy(alpha = 0.5f), CircleShape))
    }
}
