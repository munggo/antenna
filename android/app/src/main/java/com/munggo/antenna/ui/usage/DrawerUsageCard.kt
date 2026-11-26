package com.munggo.antenna.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.UsageLimit
import com.munggo.antenna.tr
import com.munggo.antenna.ui.LocalSession
import com.munggo.antenna.ui.Typo
import com.munggo.antenna.ui.colors
import com.munggo.antenna.ui.minus
import com.munggo.antenna.ui.plus
import kotlin.math.roundToInt

private data class UsageCell(val label: String, val color: Color, val percent: Double?, val note: String?, val model: UsageLimit?)

/**
 * 서랍 아래 작은 카드: 계정별 이번 주 사용률 원형 고리 · 초기화 시각(회사는 'N시간 전 기준'). 누르면 사용량 화면(onOpen).
 * 모델별 주간 한도(예: Fable)가 있는 계정은 고리가 두 겹이고, 이름 아래에 'Fable 74%' 한 줄이 붙는다.
 * 사용량은 LocalSession 에서 읽는다(서랍을 열 때 따로 요청하지 않음. 아이폰 앱과 같다)
 */
@Composable
fun DrawerUsageCard(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val usage = LocalSession.current.usage
    val p = colors
    val now = rememberUsageNow()
    val accounts = usage?.accounts
    val cells = if (!accounts.isNullOrEmpty()) {
        accounts.map {
            UsageCell(it.label, it.color(p), it.weekLimit?.percent, it.staleText(now) ?: resetShortText(it.weekLimit?.resetsAt), it.modelWeekLimit)
        }
    } else {
        listOf(UsageCell(tr("이번 주", "This week"), p.accent, usage?.weekLimit?.percent, resetShortText(usage?.weekLimit?.resetsAt), usage?.modelWeekLimit))
    }
    val anyModel = cells.any { it.model != null }
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier.fillMaxWidth().clip(shape).background(p.surfaceHigh.copy(alpha = 0.6f)).clickable(onClick = onOpen)
            .padding(12.dp).testTag("usageMiniCard"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(tr("이번 주 사용량", "This week's usage"), fontSize = Typo.caption, color = p.muted)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            for (c in cells) {
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    UsageRing(percent = c.percent, color = c.color, inner = c.model?.percent)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(c.color))
                        Text(c.label, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium, color = p.text)
                    }
                    val m = c.model
                    if (m != null) {
                        val hot = m.percent >= 90
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(6.dp).clip(CircleShape).background(if (hot) p.red else modelColor(p)))
                            Text("${m.weekModel ?: ""} ${m.percent.roundToInt()}%", fontSize = Typo.caption,
                                color = if (hot) p.red else p.text, maxLines = 1)
                        }
                    } else if (anyModel) {
                        // 다른 계정에만 모델별 한도가 있을 때: 초기화 글의 줄이 어긋나지 않게 자리만
                        Text(" ", fontSize = Typo.caption)
                    }
                    c.note?.let { n ->
                        Text(n.replace(tr(" 초기화", " resets"), tr("\n초기화", "\nresets")), fontSize = Typo.caption - 1.sp,
                            color = p.muted, textAlign = TextAlign.Center, maxLines = 2)
                    }
                }
            }
        }
    }
}
