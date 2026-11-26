package com.munggo.antenna.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.ContextInfo
import com.munggo.antenna.tr
import kotlinx.coroutines.launch

/** 숫자 폭을 고르게(아이폰의 monospacedDigit) */
private val TabularDigits = TextStyle(fontFeatureSettings = "tnum")

/** 게이지 색: 자동 압축 지점의 70% 전까지 회색, 90% 전까지 주황(클레이), 그 뒤 빨강 */
val ContextInfo.gaugeColor: Color
    @Composable get() = when {
        nearness >= 0.9 -> colors.red
        nearness >= 0.7 -> colors.accent
        else -> colors.muted
    }

/** 둥근 사용량 표시(작게: 칩 / 크게: 사용량 시트). 크게 그릴 땐 자동 압축 지점에 눈금을 그린다 */
@Composable
fun ContextRing(info: ContextInfo, size: Dp = 16.dp, lineWidth: Dp = 2.5.dp, showTick: Boolean = false) {
    val frac = ((info.percent ?: 0.0) / 100).coerceIn(0.0, 1.0).toFloat()
    val track = colors.muted.copy(alpha = 0.25f)
    val fill = info.gaugeColor
    val tick = colors.text.copy(alpha = 0.55f)
    val tickAt = if (showTick && info.auto) (info.autoAt / 100 * 360).toFloat() else null
    Canvas(Modifier.size(size)) {
        // 아이폰의 Circle().stroke 처럼 선 가운데가 원 둘레에 오게(선 절반은 틀 밖으로)
        val w = lineWidth.toPx()
        val r = this.size.minDimension / 2
        drawCircle(color = track, radius = r, style = Stroke(width = w))
        // 0%면 둥근 끝만 점으로 찍히지 않게 그리지 않는다
        if (frac > 0f) {
            drawArc(
                color = fill,
                startAngle = -90f,
                sweepAngle = 360f * frac,
                useCenter = false,
                topLeft = Offset(center.x - r, center.y - r),
                size = Size(r * 2, r * 2),
                style = Stroke(width = w, cap = StrokeCap.Round),
            )
        }
        if (tickAt != null) {
            // 자동 압축 지점 눈금: 폭 2, 길이 선 굵기 + 6 의 짧은 막대를 12시에서 그 각도만큼 돌린다
            val tw = 2.dp.toPx()
            val half = (w + 6.dp.toPx()) / 2
            rotate(tickAt, pivot = center) {
                drawLine(
                    color = tick,
                    start = Offset(center.x, center.y - r - half + tw / 2),
                    end = Offset(center.x, center.y - r + half - tw / 2),
                    strokeWidth = tw,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}

/** 작은 게이지: ◔ 42%. 가까워지면 % 글자도 게이지 색으로 */
@Composable
fun ContextGauge(info: ContextInfo, modifier: Modifier = Modifier, horizontalPadding: Dp = 8.dp) {
    Row(
        modifier.height(32.dp).padding(horizontal = horizontalPadding),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ContextRing(info)
        Text(
            info.percentText,
            fontSize = Typo.caption,
            fontWeight = FontWeight.Medium,
            color = if (info.nearness >= 0.7) info.gaugeColor else colors.muted,
            style = TabularDigits,
        )
    }
}

/** 위쪽 오른쪽 컨텍스트 사용량(고리 + %). 누르면 컨텍스트 시트. 사용량을 아직 모르면 아무것도 그리지 않는다 */
@Composable
fun ContextTopButton(modifier: Modifier = Modifier) {
    val session = LocalSession.current
    var show by remember { mutableStateOf(false) }
    val c = session.chat.meta.context
    if (c != null) {
        val label = tr("컨텍스트 ${c.percentText}", "Context ${c.percentText}")
        // 아이폰은 칩 좌우 여백을 4씩 줄여(-4) 위 줄 단추들과 간격을 맞췄다
        ContextGauge(
            c,
            horizontalPadding = 4.dp,
            modifier = modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(role = Role.Button) { show = true }
                .semantics { contentDescription = label },
        )
    }
    // 열린 동안 사용량이 사라져도(연결 끊김 등) 시트는 그대로 두고 안내를 보인다
    if (show) ContextSheet(onDismiss = { show = false })
}

/** 게이지를 누르면 뜨는 사용량 시트: 큰 원 · 사용 중 토큰 · 자동 압축 지점 · 지금 압축하기 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContextSheet(onDismiss: () -> Unit) {
    val session = LocalSession.current
    val meta = session.chat.meta
    // 아이폰은 중간 높이 하나뿐이라 반쯤 열린 단계 없이 내용 높이만큼 연다
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { if (!sheetState.isVisible) onDismiss() }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        containerColor = colors.bg,
        contentColor = colors.text,
    ) {
        ContextSheetHeader(onClose = close)
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            val c = meta.context
            if (c != null) {
                Box(
                    Modifier.padding(top = 8.dp).semantics(mergeDescendants = true) {},
                    contentAlignment = Alignment.Center,
                ) {
                    ContextRing(c, size = 112.dp, lineWidth = 10.dp, showTick = true)
                    Text(c.percentText, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = colors.text, style = TabularDigits)
                }

                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    val used = c.tokens?.let {
                        val a = ContextInfo.tokens(it)
                        val b = ContextInfo.tokens(c.window)
                        tr("$a / $b 토큰", "$a / $b tokens")
                    } ?: tr("압축 직후라 다음 답변 뒤에 다시 계산돼요", "Just compacted; recalculated after the next answer")
                    InfoRow(tr("사용 중", "In use"), used)
                    val auto = if (c.auto) {
                        val pct = Math.round(c.autoAt)
                        val at = ContextInfo.tokens(maxOf(0, c.window - c.reserve))
                        tr("$pct%($at)에서 시작", "Starts at $pct% ($at)")
                    } else tr("꺼져 있음", "Off")
                    InfoRow(tr("자동 압축", "Auto-compact"), auto)
                }

                val agent = if (meta.agentName == "Claude") "Claude Code" else "pi"
                Text(
                    tr(
                        "대화가 길어져 자동 압축 지점에 닿으면 ${agent}가 앞부분을 요약해 공간을 비워요. 요약된 앞부분의 자세한 내용은 잊을 수 있어요.",
                        "When the conversation reaches the auto-compact point, $agent summarizes the earlier part to free up space. Details from the summarized part may be forgotten.",
                    ),
                    fontSize = Typo.caption + 1.sp,
                    color = colors.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )

                val working = session.isWorking
                // 작업 중이거나 압축 직후(사용량 모름)면 누를 수 없다
                val disabled = working || c.tokens == null
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(46.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(colors.surfaceHigh)
                        .clickable(enabled = !disabled, role = Role.Button) { session.compactNow(); close() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (working) tr("작업이 끝나면 압축할 수 있어요", "You can compact once the task finishes") else tr("지금 압축하기", "Compact now"),
                        fontSize = Typo.row,
                        fontWeight = FontWeight.Medium,
                        color = if (disabled) colors.muted else colors.text,
                    )
                }
            } else {
                Text(tr("사용량을 아직 받지 못했어요", "No usage data yet"), fontSize = Typo.row, color = colors.muted)
            }
        }
    }
}

/** 위쪽 줄: 왼쪽 닫기, 가운데 제목 */
@Composable
private fun ContextSheetHeader(onClose: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp)) {
        Box(Modifier.align(Alignment.CenterStart)) { CloseCircle(onClick = onClose) }
        Text(
            tr("컨텍스트", "Context"),
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = colors.text,
            modifier = Modifier.align(Alignment.Center),
        )
    }
}

/** 이름 ─ 값 한 줄(값은 오른쪽 정렬, 길면 여러 줄) */
@Composable
private fun InfoRow(title: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(title, fontSize = Typo.row, color = colors.muted, modifier = Modifier.alignByBaseline())
        Spacer(Modifier.width(12.dp))
        // 남은 폭을 다 받고 글은 오른쪽 끝에 붙인다(아이폰의 Spacer + 오른쪽 정렬과 같은 모양)
        Text(
            value,
            fontSize = Typo.row,
            color = colors.text,
            textAlign = TextAlign.End,
            modifier = Modifier.alignByBaseline().weight(1f),
        )
    }
}
