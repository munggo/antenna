package com.munggo.antenna.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.munggo.antenna.model.ChangeStats
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.session.ThumbStore
import com.munggo.antenna.tr
import kotlinx.coroutines.delay

/** 화면 어디서나 쓰는 연결 세션 */
val LocalSession = staticCompositionLocalOf<BridgeSession> { error("세션 없음") }

/** 글을 클립보드에 넣는다 */
fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("Antenna", text))
}

/** 복사 단추(누르면 잠깐 체크 표시). 답변 아래·코드 블록·단계 상세에서 쓴다 */
@Composable
fun CopyButton(text: String, label: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    Box(
        modifier.size(width = 32.dp, height = 28.dp).clickable { copyText(context, text); copied = true },
        contentAlignment = Alignment.CenterStart,
    ) {
        Icon(
            if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
            contentDescription = if (copied) tr("복사됨", "Copied") else label,
            tint = colors.muted,
            modifier = Modifier.size(17.dp),
        )
    }
}

/** 동그란 X 닫기 단추 */
@Composable
fun CloseCircle(onClick: () -> Unit) {
    Box(
        Modifier.size(32.dp).clip(CircleShape).background(colors.surfaceHigh).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Close, contentDescription = tr("닫기", "Close"), tint = colors.text, modifier = Modifier.size(16.dp))
    }
}

/** "+73 −0" (초록·빨강 반쪽 알약) */
@Composable
fun StatsBadge(stats: ChangeStats) {
    Row(Modifier.height(22.dp).clip(RoundedCornerShape(6.dp))) {
        Text("+${stats.added}", color = colors.green, fontSize = Typo.caption, fontWeight = FontWeight.Medium,
            modifier = Modifier.background(colors.green.copy(alpha = 0.16f)).padding(horizontal = 7.dp, vertical = 2.dp))
        Text("−${stats.removed}", color = colors.red, fontSize = Typo.caption, fontWeight = FontWeight.Medium,
            modifier = Modifier.background(colors.red.copy(alpha = 0.14f)).padding(horizontal = 7.dp, vertical = 2.dp))
    }
}

/** 긴 것을 접는 기준(아이폰 앱과 같다): 화면 2장을 넘으면 반 장만 보이고 '더 보기'. 화면 한 장 = 화면 높이의 4분의 3 */
object Fold {
    @Composable fun page(): Dp = LocalConfiguration.current.screenHeightDp.dp * 0.75f
}

/** 길면 접어 두고 '더 보기'·'접기'로 펴고 접는 칸 */
@Composable
fun Foldable(fade: Color = colors.bg, limit: Dp? = null, folded: Dp? = null, fill: Boolean = true, content: @Composable () -> Unit) {
    val page = Fold.page()
    val limitDp = limit ?: (page * 2)
    val foldedDp = folded ?: (page * 0.5f)
    val limitPx = with(LocalDensity.current) { limitDp.toPx() }
    var long by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    val collapsed = long && !expanded
    val width = if (fill) Modifier.fillMaxWidth() else Modifier
    Column {
        Box(width.then(if (collapsed) Modifier.height(foldedDp) else Modifier).clipToBounds()) {
            Box(width.wrapContentHeight(Alignment.Top, unbounded = true).onSizeChanged { long = it.height > limitPx }) {
                content()
            }
            if (collapsed) {
                // 흐림 띠는 접힌 칸의 폭만큼(말풍선은 글 폭)
                Box(Modifier.matchParentSize()) {
                    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(56.dp)
                        .background(Brush.verticalGradient(listOf(fade.copy(alpha = 0f), fade))))
                }
            }
        }
        if (long) FoldToggle(collapsed) { expanded = collapsed }
    }
}

@Composable
fun FoldToggle(collapsed: Boolean, onClick: () -> Unit) {
    Text(
        if (collapsed) tr("더 보기", "Show more") else tr("접기", "Show less"),
        color = colors.accent, fontSize = Typo.caption + 1.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.clickable(onClick = onClick).padding(vertical = 6.dp),
    )
}

/** 차례로 깜빡이는 작은 점 3개(클레이 색). 0.6초 동안 진해졌다 0.6초 동안 흐려진다 */
@Composable
fun PulsingDots() {
    var t by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) { while (true) withInfiniteAnimationFrameMillis { t = it } }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until 3) {
            val turn = (t / 1000.0 - i * 0.2) / 1.2
            val x = turn - Math.floor(turn)
            val up = if (x < 0.5) x * 2 else (1 - x) * 2
            val a = 0.25 + 0.75 * up * up * (3 - 2 * up)
            Box(Modifier.size(5.dp).alpha(a.toFloat()).clip(CircleShape).background(colors.accent))
        }
    }
}

/** 59초까지 "N초", 60초부터 "1분" / "1분 5초", 1시간부터 "1시간 2분" */
fun elapsedText(ms: Long): String {
    val s = maxOf(0L, ms / 1000)
    if (s < 60) return tr("${s}초", "${s}s")
    if (s < 3600) return if (s % 60 == 0L) tr("${s / 60}분", "${s / 60}m") else tr("${s / 60}분 ${s % 60}초", "${s / 60}m ${s % 60}s")
    val m = (s % 3600) / 60
    return if (m == 0L) tr("${s / 3600}시간", "${s / 3600}h") else tr("${s / 3600}시간 ${m}분", "${s / 3600}h ${m}m")
}

/** 1초마다 바뀌는 지금 시각(경과 시간 표시용) */
@Composable
fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    return now
}

/** 사진 한 장(말풍선·답 속). 폰에 없으면 맥에서 받아 와 보이고, 누르면 전체 화면 */
@Composable
fun ThumbImage(path: String, size: ThumbStore.Size, modifier: Modifier = Modifier, fit: Boolean = false, tappable: Boolean = true) {
    val thumbs = LocalSession.current.thumbs
    LaunchedEffect(path, size) { thumbs.request(path, size) }
    val img = thumbs.image(path, size)
    Box(modifier.then(if (tappable) Modifier.clickable { thumbs.viewing = path } else Modifier), contentAlignment = Alignment.Center) {
        if (img != null) {
            Image(img, contentDescription = null, contentScale = if (fit) ContentScale.Fit else ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Box(Modifier.fillMaxSize().background(colors.surfaceHigh), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Image, contentDescription = null, tint = colors.muted)
            }
        }
    }
}
