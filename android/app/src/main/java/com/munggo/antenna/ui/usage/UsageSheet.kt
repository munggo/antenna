package com.munggo.antenna.ui.usage

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.AccountUsage
import com.munggo.antenna.model.UsageExtra
import com.munggo.antenna.model.UsageInfo
import com.munggo.antenna.tr
import com.munggo.antenna.ui.LocalSession
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.minus
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** 사용량 화면(Claude 앱 사용량 화면처럼 막대로 표시). … 메뉴·서랍 카드 → 사용량. 반쯤 열렸다가 끌어 올리면 전체 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageSheet(onDismiss: () -> Unit) {
    val session = LocalSession.current
    val p = colors
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val now = rememberUsageNow()
    LaunchedEffect(Unit) { session.requestUsage(force = false) }
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { if (!sheetState.isVisible) onDismiss() }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = p.bg) {
        // 머리줄: 새로 고침 · 제목 · 닫기
        Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 8.dp)) {
            val loading = session.usageLoading
            IconButton(onClick = { session.requestUsage(force = true) }, enabled = !loading,
                modifier = Modifier.align(Alignment.CenterStart).testTag("usageRefresh")) {
                Icon(Icons.Outlined.Refresh, contentDescription = tr("다시 불러오기", "Reload"),
                    tint = if (loading) p.muted.copy(alpha = 0.5f) else p.text)
            }
            Text(tr("사용량", "Usage"), color = p.text, fontSize = Typo.title, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.Center))
            Text(tr("닫기", "Close"), color = p.text, fontSize = Typo.title,
                modifier = Modifier.align(Alignment.CenterEnd).clip(RoundedCornerShape(8.dp)).clickable(onClick = close)
                    .padding(horizontal = 8.dp, vertical = 6.dp))
        }
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            val u = session.usage
            if (u == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = p.muted, strokeWidth = 2.dp)
                    Text(tr("불러오는 중…", "Loading…"), color = p.muted, fontSize = Typo.body)
                }
            } else if (u.error != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = p.red, modifier = Modifier.padding(top = 1.dp).size(17.dp))
                    Text(u.error, fontSize = 15.sp, color = p.red)
                }
            } else {
                val accounts = u.accounts
                if (!u.plan.isNullOrEmpty() && accounts.isNullOrEmpty()) {
                    Text(u.plan, fontSize = 15.sp, color = p.muted)
                }
                if (!accounts.isNullOrEmpty()) {
                    for (a in accounts) AccountSection(a, now)
                } else {
                    LimitsSection(u, now)
                }
                GraphSection(u, now)
                ExtraSection(u.extra)
                u.fetchedAt?.let(::parseUsageDate)?.let { at ->
                    Text(tr("${relativeText(at, now)} 업데이트", "Updated ${relativeText(at, now)}"), fontSize = Typo.caption, color = p.muted)
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, fontSize = Typo.body, fontWeight = FontWeight.SemiBold, color = colors.text)
}

@Composable
private fun MutedNote(text: String) {
    Text(text, fontSize = 15.sp, color = colors.muted)
}

/** 계정을 나눠 주지 않는 예전 브리지: 한도 막대만 */
@Composable
private fun LimitsSection(u: UsageInfo, now: Long) {
    val limits = u.limits.orEmpty()
    val p = colors
    Column(verticalArrangement = Arrangement.spacedBy(22.dp)) {
        SectionTitle(tr("요금제 사용 한도", "Plan usage limits"))
        if (limits.isEmpty()) MutedNote(tr("표시할 한도가 없어요", "No limits to show"))
        for (l in limits) {
            UsageBar(l.label, l.percent, resetText(l, now), l.alert, if (l.weekModel == null) p.accent else modelColor(p))
        }
    }
}

/** 계정 카드: '개인 · Claude Max 20x' / '회사 · 3시간 전 기준' + 한도 막대 */
@Composable
private fun AccountSection(a: AccountUsage, now: Long) {
    val p = colors
    val color = a.color(p)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.surfaceHigh.copy(alpha = 0.45f)).padding(14.dp)
            .testTag("usageAccount-${a.key}"),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).clip(CircleShape).background(color))
            Text(a.label, fontSize = Typo.body, fontWeight = FontWeight.SemiBold, color = p.text)
            if (!a.plan.isNullOrEmpty()) Text(a.plan, fontSize = 15.sp, color = p.muted)
            Spacer(Modifier.weight(1f))
            a.staleText(now)?.let { Text(it, fontSize = Typo.caption, color = p.muted) }
        }
        val limits = a.limits.orEmpty()
        if (limits.isEmpty()) {
            MutedNote(when (a.key) {
                "work" -> tr("회사 계정을 쓰면 사용량이 보여요", "Usage shows once the work account is used")
                "personal2" -> tr("추가 개인 계정을 쓰면 사용량이 보여요", "Usage shows once the second personal account is used")
                else -> tr("표시할 한도가 없어요", "No limits to show")
            })
        }
        for (l in limits) {
            // 모델별 주간 한도(예: Fable)는 서랍 고리의 안쪽 고리와 같은 색으로
            UsageBar(l.label, l.percent, resetText(l, now), l.alert, if (l.weekModel == null) color else modelColor(p))
        }
    }
}

/** 주간 사용 추이(7일)·하루 사용량 */
@Composable
private fun GraphSection(u: UsageInfo, now: Long) {
    val p = colors
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(tr("주간 사용 추이", "Weekly usage trend"))
        val series = u.chartSeries(p, now)
        if (series.any { it.points.size >= 2 }) {
            WeeklyUsageChart(series, now)
            if (series.size > 1) ChartLegend(series)
        } else {
            MutedNote(tr("기록을 모으는 중이에요. 맥이 10분마다 사용량을 기록해요.", "Collecting data. The Mac records usage every 10 minutes."))
        }
        val bars = u.dailyBars(p)
        if (bars.any { it.used > 0 } || !u.daily.isNullOrEmpty()) {
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(tr("하루 사용량", "Daily usage"), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = p.text)
                Spacer(Modifier.weight(1f))
                Text(tr("주간 한도 대비 %p", "points of the weekly limit"), fontSize = Typo.caption, color = p.muted)
            }
            DailyUsageChart(bars, now)
        }
    }
}

@Composable
private fun ExtraSection(e: UsageExtra?) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(tr("추가 사용량", "Extra usage"))
        if (e != null && e.enabled) {
            val pc = e.percent ?: 0.0
            UsageBar(moneyText(e), pc, tr("이번 달", "This month"), pc >= 90)
        } else {
            MutedNote(tr("꺼져 있어요", "Off"))
        }
    }
}

/** 한 줄 사용량 막대: 제목 · 퍼센트 / 막대 / 초기화 안내 */
@Composable
fun UsageBar(title: String, percent: Double, caption: String, alert: Boolean, color: Color = colors.accent) {
    val p = colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = Typo.row, color = p.text, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            Text(tr("${percent.roundToInt()}% 사용", "${percent.roundToInt()}% used"), fontSize = Typo.row - 1.sp,
                color = if (alert) p.red else p.muted)
        }
        Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(p.surfaceHigh)) {
            Box(Modifier.fillMaxWidth((percent / 100).coerceIn(0.0, 1.0).toFloat()).height(8.dp).clip(CircleShape)
                .background(if (alert) p.red else color))
        }
        if (caption.isNotEmpty()) Text(caption, fontSize = Typo.caption, color = p.muted)
    }
}
