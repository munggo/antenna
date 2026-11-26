package com.munggo.antenna.ui.usage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import com.munggo.antenna.isKorean
import com.munggo.antenna.model.AccountUsage
import com.munggo.antenna.model.UsageExtra
import com.munggo.antenna.model.UsageInfo
import com.munggo.antenna.model.UsageLimit
import com.munggo.antenna.tr
import com.munggo.antenna.ui.Palette
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay

// 사용량 화면·서랍 카드가 함께 쓰는 계산과 글 형식(아이폰 앱 UsageView.swift·UsageChart.swift 와 같다)

internal const val DAY_MS = 86_400_000L

/** 주간 사용률 기록 한 점(time: ms) */
data class UsagePoint(val time: Long, val week: Double)

/** 그래프 계열 하나(계정) */
data class UsageSeries(val label: String, val color: Color, val points: List<UsagePoint>)

/** 하루 사용량 막대 하나(계정별) */
data class DailyBar(val date: String, val used: Double, val label: String, val color: Color)

/** 30초마다 바뀌는 지금 시각(ms). '남은 시간'·'N분 전' 글이 화면을 연 채로도 맞게 */
@Composable
internal fun rememberUsageNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = System.currentTimeMillis() } }
    return now
}

// --- 날짜 ---

/** ISO 8601 시각(소수 초가 있어도 없어도) */
internal fun parseUsageDate(s: String): Instant? = runCatching { OffsetDateTime.parse(s).toInstant() }.getOrNull()

/** yyyy-MM-dd */
internal fun parseUsageDay(s: String): LocalDate? = runCatching { LocalDate.parse(s) }.getOrNull()

internal fun localDay(ms: Long): LocalDate = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()

private val weekdaysKo = listOf("일", "월", "화", "수", "목", "금", "토")
private val weekdaysEn = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

/** 요일 한 글자(영어는 세 글자) */
internal fun weekdayName(d: DayOfWeek): String = (if (isKorean) weekdaysKo else weekdaysEn)[d.value % 7]

/** 서랍 카드용 '11/16(월) 16:00 초기화' */
internal fun resetShortText(iso: String?): String? {
    val d = iso?.let(::parseUsageDate)?.atZone(ZoneId.systemDefault()) ?: return null
    val w = weekdayName(d.dayOfWeek)
    return tr(
        String.format(Locale.US, "%d/%d(%s) %02d:%02d 초기화", d.monthValue, d.dayOfMonth, w, d.hour, d.minute),
        String.format(Locale.US, "%d/%d (%s) %02d:%02d resets", d.monthValue, d.dayOfMonth, w, d.hour, d.minute),
    )
}

/** 세션: "3시간 12분 후 초기화" / 주간: "11월 16일 (일) 오후 3:59 초기화" */
internal fun resetText(l: UsageLimit, now: Long): String {
    val d = l.resetsAt?.let(::parseUsageDate) ?: return ""
    val mins = maxOf(0L, (d.toEpochMilli() - now) / 60_000).toInt()
    if (l.session || mins < 24 * 60) {
        val h = mins / 60
        val m = mins % 60
        return if (h > 0) tr("${h}시간 ${m}분 후 초기화", "Resets in ${h}h ${m}m") else tr("${m}분 후 초기화", "Resets in ${m}m")
    }
    // 앱 언어에 맞춘 월·요일·오전오후
    val f = if (isKorean) DateTimeFormatter.ofPattern("M'월' d'일' (E) a h:mm", Locale.KOREA)
    else DateTimeFormatter.ofPattern("MMM d (E) h:mm a", Locale.US)
    val s = d.atZone(ZoneId.systemDefault()).format(f)
    return tr("$s 초기화", "Resets $s")
}

/** "방금" / "N분 전" / "N시간 전" (맥·폰 시계가 조금 어긋나 미래로 나와도 "방금") */
internal fun relativeText(d: Instant, now: Long): String {
    val mins = (now - d.toEpochMilli()) / 60_000
    if (mins < 1) return tr("방금", "just now")
    if (mins < 60) return tr("${mins}분 전", "${mins}m ago")
    return tr("${mins / 60}시간 전", "${mins / 60}h ago")
}

/** 추가 사용량 금액(센트 단위 정수일 수 있어 decimals 로 나눔) */
internal fun moneyText(e: UsageExtra): String {
    val div = Math.pow(10.0, (e.decimals ?: 0).toDouble())
    fun fmt(v: Double?): String = v?.let { String.format(Locale.US, "%.2f", it / div) } ?: "-"
    return "${fmt(e.used)} / ${fmt(e.limit)} ${e.currency ?: ""}".trim()
}

// --- 한도 ---

/** 모델별 주간 한도면 그 모델 이름(week:Fable → Fable, 회사 계정은 work:7d:Fable → Fable). 모든 모델 한도·세션이면 null */
val UsageLimit.weekModel: String?
    get() {
        val k = key ?: return null
        for (p in listOf("week:", "work:7d:")) {
            if (!k.startsWith(p)) continue
            val m = k.substring(p.length)
            return if (m.isEmpty()) null else m.substring(0, 1).uppercase() + m.substring(1)
        }
        return null
    }

/** 빨갛게 보일 한도(맥이 경고로 알렸거나 90% 이상). severity 가 비어 오면(옛 자료) 보통으로 본다 */
internal val UsageLimit.alert: Boolean get() = (severity.isNotEmpty() && severity != "normal") || percent >= 90

/** 모델별 주간 한도를 그리는 색(서랍 고리의 안쪽 고리·사용량 화면의 막대). 계정 색(주황·청록)과 따로 */
internal fun modelColor(p: Palette): Color = p.purple

/** 모델별 주간 한도 가운데 가장 많이 쓴 것(먼저 차는 것). outer(바깥 고리로 그리는 한도)와 같은 것은 뺀다 */
internal fun modelWeek(limits: List<UsageLimit>?, outer: UsageLimit?): UsageLimit? =
    limits.orEmpty().filter { it.weekModel != null && it.key != outer?.key }.maxByOrNull { it.percent }

/** 모든 모델 주간 한도(없으면 첫 주간 한도) */
val UsageInfo.weekLimit: UsageLimit?
    get() = limits?.firstOrNull { it.key == "week" } ?: limits?.firstOrNull { !it.session }

/** 모델별 주간 한도(계정을 나눠 주지 않는 예전 브리지: 회사 계정 것은 빼고) */
val UsageInfo.modelWeekLimit: UsageLimit?
    get() = modelWeek(limits?.filter { it.key?.startsWith("work:") != true }, weekLimit)

/** 최근 7일 주간 % 기록([시각(ms), 세션%, 주간%]) */
internal fun usagePoints(history: List<List<Double?>>?, now: Long): List<UsagePoint> {
    val since = now - 7 * DAY_MS
    return history.orEmpty().mapNotNull { row ->
        if (row.size < 3) return@mapNotNull null
        val t = row[0] ?: return@mapNotNull null
        val w = row[2] ?: return@mapNotNull null
        val time = t.toLong()
        if (time >= since) UsagePoint(time, w) else null
    }
}

/** 계정별 주간 선(계정 정보가 없으면 한 선) */
internal fun UsageInfo.chartSeries(p: Palette, now: Long): List<UsageSeries> {
    val a = accounts
    if (!a.isNullOrEmpty()) return a.map { UsageSeries(it.label, it.color(p), usagePoints(it.history, now)) }
    return listOf(UsageSeries(tr("주간", "Weekly"), p.accent, usagePoints(history, now)))
}

/** 계정별 하루 사용량 막대 */
internal fun UsageInfo.dailyBars(p: Palette): List<DailyBar> {
    val a = accounts
    if (!a.isNullOrEmpty()) return a.flatMap { acc -> acc.daily.orEmpty().map { DailyBar(it.date, it.used, acc.label, acc.color(p)) } }
    return daily.orEmpty().map { DailyBar(it.date, it.used, "", p.accent) }
}

// --- 계정 ---

/** 계정 색: 회사 청록, 추가 개인(11-25) 초록, 나머지 주황 */
internal fun AccountUsage.color(p: Palette): Color = when (key) {
    "work" -> p.teal
    "personal2" -> p.green
    else -> p.accent
}

val AccountUsage.weekLimit: UsageLimit?
    get() = limits?.firstOrNull { it.key == "week" || it.key == "work:7d" } ?: limits?.firstOrNull { !it.session }

/** 모델별 주간 한도(예: Fable) 가운데 가장 많이 쓴 것. 없으면 null */
val AccountUsage.modelWeekLimit: UsageLimit? get() = modelWeek(limits, weekLimit)

/** '3시간 전 기준'(회사, 10분 넘었을 때) */
internal fun AccountUsage.staleText(now: Long): String? {
    val t = updatedAt ?: return null
    val m = (now / 1000.0 - t / 1000).toInt() / 60
    if (m < 10) return null
    return when {
        m < 120 -> tr("${m}분 전 기준", "as of ${m}m ago")
        m < 48 * 60 -> tr("${m / 60}시간 전 기준", "as of ${m / 60}h ago")
        else -> tr("${m / 1440}일 전 기준", "as of ${m / 1440}d ago")
    }
}
