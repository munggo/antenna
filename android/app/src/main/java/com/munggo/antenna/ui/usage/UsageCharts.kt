package com.munggo.antenna.ui.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.plus
import java.time.ZoneId
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

// 그래프 도구 없이 Canvas 로 그린다(아이폰 앱은 Swift Charts)

/** 사용량 화면: 7일 동안 주간 사용률(계정별 선, 한 계정이면 면도). 값이 그대로 이어지다 다음 기록에서 바뀌는 계단 모양 */
@Composable
fun WeeklyUsageChart(series: List<UsageSeries>, now: Long, modifier: Modifier = Modifier) {
    val p = colors
    val measurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontSize = 10.sp, color = p.muted)
    Canvas(modifier.fillMaxWidth().height(170.dp).testTag("weeklyChart")) {
        val start = now - 7 * DAY_MS
        val yTicks = listOf(0, 25, 50, 75, 100).map { it to measurer.measure("$it%", labelStyle) }
        val textH = yTicks[0].second.size.height.toFloat()
        val gap = 6.dp.toPx()
        val left = yTicks.maxOf { it.second.size.width } + gap
        val right = size.width
        val top = textH / 2
        val bottom = size.height - textH - 4.dp.toPx()
        fun x(t: Long) = left + (t - start).toFloat() / (now - start).toFloat() * (right - left)
        fun y(v: Double) = bottom - (v / 100.0).toFloat() * (bottom - top)
        val line = 1.dp.toPx()

        // 가로 눈금(0·25·50·75·100%)과 왼쪽 글
        for ((v, layout) in yTicks) {
            val yy = y(v.toDouble())
            drawLine(p.border, Offset(left, yy), Offset(right, yy), strokeWidth = line)
            drawText(layout, topLeft = Offset(left - gap - layout.size.width, yy - layout.size.height / 2f))
        }
        // 세로 눈금: 날마다 자정, 아래에 요일
        val zone = ZoneId.systemDefault()
        var day = localDay(start)
        if (day.atStartOfDay(zone).toInstant().toEpochMilli() < start) day = day.plusDays(1)
        while (true) {
            val t = day.atStartOfDay(zone).toInstant().toEpochMilli()
            if (t > now) break
            val xx = x(t)
            drawLine(p.border.copy(alpha = p.border.alpha * 0.5f), Offset(xx, top), Offset(xx, bottom), strokeWidth = line)
            val lab = measurer.measure(weekdayName(day.dayOfWeek), labelStyle)
            drawText(lab, topLeft = Offset(minOf(xx + 2.dp.toPx(), right - lab.size.width), bottom + 4.dp.toPx()))
            day = day.plusDays(1)
        }

        val pad = 3.dp.toPx()
        clipRect(left - pad, top - pad, right + pad, bottom + pad) {
            for (s in series) {
                val pts = s.points.sortedBy { it.time }
                if (pts.isEmpty()) continue
                // 계단: 앞 값으로 다음 시각까지 가로로 간 뒤 세로로
                val corners = ArrayList<Offset>(pts.size * 2)
                corners.add(Offset(x(pts[0].time), y(pts[0].week)))
                for (i in 1 until pts.size) {
                    corners.add(Offset(x(pts[i].time), y(pts[i - 1].week)))
                    corners.add(Offset(x(pts[i].time), y(pts[i].week)))
                }
                if (series.size == 1 && pts.size >= 2) {
                    val area = Path().apply {
                        moveTo(corners[0].x, bottom)
                        for (c in corners) lineTo(c.x, c.y)
                        lineTo(corners.last().x, bottom)
                        close()
                    }
                    drawPath(area, Brush.verticalGradient(listOf(s.color.copy(alpha = 0.35f), s.color.copy(alpha = 0.03f)), startY = top, endY = bottom))
                }
                val path = Path().apply {
                    moveTo(corners[0].x, corners[0].y)
                    for (i in 1 until corners.size) lineTo(corners[i].x, corners[i].y)
                }
                drawPath(path, s.color, style = Stroke(width = 2.dp.toPx()))
                // 기록이 몇 개 없으면 점으로도
                if (pts.size < 3) for (pt in pts) drawCircle(s.color, radius = 2.2.dp.toPx(), center = Offset(x(pt.time), y(pt.week)))
            }
        }
    }
}

/** 범례: ● 개인 ● 회사 */
@Composable
fun ChartLegend(series: List<UsageSeries>) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        for (s in series) {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(s.color))
                Text(s.label, fontSize = Typo.caption + 1.sp, color = colors.muted)
            }
        }
    }
}

/** 날짜별 하루 사용량 막대(계정이 여럿이면 나란히). 오늘 막대만 진하게 */
@Composable
fun DailyUsageChart(bars: List<DailyBar>, now: Long, modifier: Modifier = Modifier) {
    val p = colors
    val measurer = rememberTextMeasurer()
    val yStyle = TextStyle(fontSize = 10.sp, color = p.muted)
    val xStyle = TextStyle(fontSize = 11.sp, color = p.muted)
    Canvas(modifier.fillMaxWidth().height(120.dp).testTag("dailyChart")) {
        val dates = bars.map { it.date }.distinct().sorted()
        val groups = bars.map { it.label }.distinct()
        val multi = groups.size > 1
        val maxV = bars.maxOfOrNull { it.used } ?: 0.0
        val step = niceStep(maxV)
        val topV = maxOf(step, ceil(maxV / step) * step)

        val yTicks = (0..(topV / step).roundToInt()).map { i ->
            val v = i * step
            v to measurer.measure(String.format(Locale.US, "%.0f", v), yStyle)
        }
        val gap = 6.dp.toPx()
        val left = yTicks.maxOf { it.second.size.width } + gap
        val right = size.width
        val top = yTicks[0].second.size.height / 2f
        val xLabelH = measurer.measure("0", xStyle).size.height
        val bottom = size.height - xLabelH - 4.dp.toPx()
        fun y(v: Double) = bottom - (v / topV).toFloat() * (bottom - top)

        // 가로 눈금과 왼쪽 글
        for ((v, layout) in yTicks) {
            val yy = y(v)
            drawLine(p.border, Offset(left, yy), Offset(right, yy), strokeWidth = 1.dp.toPx())
            drawText(layout, topLeft = Offset(left - gap - layout.size.width, yy - layout.size.height / 2f))
        }
        if (dates.isEmpty()) return@Canvas

        val today = localDay(now)
        val band = (right - left) / dates.size
        val groupW = band * 0.66f
        val inner = if (multi) 2.dp.toPx() else 0f
        val barW = (groupW - inner * (groups.size - 1).coerceAtLeast(0)) / (if (multi) groups.size else 1)
        val radius = CornerRadius(3.dp.toPx())
        dates.forEachIndexed { i, date ->
            val bandLeft = left + band * i
            val d = parseUsageDay(date)
            // 날짜를 못 읽으면 오늘로 본다(아이폰 앱과 같다)
            val isToday = (d ?: today) == today
            for (b in bars) {
                if (b.date != date || b.used <= 0) continue
                val slot = if (multi) groups.indexOf(b.label) else 0
                val bx = bandLeft + (band - groupW) / 2 + slot * (barW + inner)
                val by = y(b.used)
                drawRoundRect(if (isToday) b.color else b.color.copy(alpha = b.color.alpha * 0.55f),
                    topLeft = Offset(bx, by), size = Size(barW, bottom - by), cornerRadius = radius)
            }
            if (d != null) {
                val lab = measurer.measure(weekdayName(d.dayOfWeek), xStyle)
                drawText(lab, topLeft = Offset(bandLeft + (band - lab.size.width) / 2, bottom + 4.dp.toPx()))
            }
        }
    }
}

/** 세로 눈금 간격: 1·2·5 배수로 4칸쯤. 글을 정수로 적으니 1보다 잘게 나누지 않는다 */
private fun niceStep(maxV: Double): Double {
    if (maxV <= 0) return 1.0
    val rough = maxV / 4
    val mag = 10.0.pow(floor(log10(rough)))
    val n = rough / mag
    val step = (if (n <= 1) 1.0 else if (n <= 2) 2.0 else if (n <= 5) 5.0 else 10.0) * mag
    return maxOf(step, 1.0)
}

/**
 * 주간 사용률 원형 고리(가운데 %). 90% 넘으면 빨강.
 * inner 가 있으면 두 겹: 바깥은 모든 모델, 안쪽은 모델별 주간 한도(예: Fable)를 각자 자기 한도에 대한 %로 그린다
 */
@Composable
fun UsageRing(percent: Double?, color: Color, inner: Double? = null, ringSize: Dp = 58.dp) {
    val p = colors
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val label = percent?.let { "${it.roundToInt()}%" } ?: "–"
    val style = TextStyle(fontSize = (ringSize.value * (if (inner == null) 0.26f else 0.24f)).sp, fontWeight = FontWeight.SemiBold, color = p.text)
    // 안쪽 고리 안에 들어가게('100%'는 줄어듦, 최대 70%까지)
    val maxW = if (inner == null) ringSize else ringSize - 24.dp
    val scale = remember(label, style, maxW, density) {
        val w = measurer.measure(label, style, maxLines = 1, softWrap = false).size.width
        val maxPx = with(density) { maxW.toPx() }
        if (w > maxPx) maxOf(0.7f, maxPx / w) else 1f
    }
    Box(Modifier.size(ringSize).testTag("usageRing"), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(ringSize)) {
            val r = size.minDimension / 2
            ringArc(percent ?: 0.0, color, p.muted, p.red, 6.dp.toPx(), r)
            // 바깥 고리(굵기 6) 안쪽 가장자리에서 2 띄움: 3 + 2 + 안쪽 굵기의 반
            if (inner != null) ringArc(inner, modelColor(p), p.muted, p.red, 4.5.dp.toPx(), r - 7.25.dp.toPx())
        }
        Text(label, style = style.copy(fontSize = style.fontSize * scale), maxLines = 1, softWrap = false)
    }
}

/** 12시에서 시계 방향으로 차는 고리 한 겹(선 가운데가 반지름 r) */
private fun DrawScope.ringArc(percent: Double, color: Color, muted: Color, red: Color, width: Float, r: Float) {
    drawCircle(muted.copy(alpha = 0.22f), radius = r, center = center, style = Stroke(width))
    val sweep = (percent / 100).coerceIn(0.0, 1.0).toFloat() * 360f
    if (sweep <= 0f) return
    drawArc(if (percent >= 90) red else color, startAngle = -90f, sweepAngle = sweep, useCenter = false,
        topLeft = Offset(center.x - r, center.y - r), size = Size(r * 2, r * 2), style = Stroke(width, cap = StrokeCap.Round))
}
