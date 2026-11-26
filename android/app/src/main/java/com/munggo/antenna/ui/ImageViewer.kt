package com.munggo.antenna.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.session.ThumbStore

/**
 * 사진 전체 화면 보기: 좌우로 넘기고, 두 손가락으로 확대하고, 두 번 누르면 확대·되돌림.
 * 대화 속 사진이 아니면(답 속 맥 그림 경로) 그 한 장만. 맥에서 원본을 받아 온다
 */
@Composable
fun ImageViewer(session: BridgeSession, paths: List<String>, start: String, onClose: () -> Unit) {
    val list = if (start in paths) paths else listOf(start)
    val pager = rememberPagerState(initialPage = maxOf(0, list.indexOf(start))) { list.size }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).testTag("imageViewer")) {
            HorizontalPager(pager, modifier = Modifier.fillMaxSize()) { page -> ZoomImage(session, list[page]) }
            Box(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(16.dp)) { CloseCircle(onClose) }
        }
    }
}

@Composable
private fun ZoomImage(session: BridgeSession, path: String) {
    val thumbs = session.thumbs
    // 원본(맥에서 다시 만든 큰 그림)을 청하고, 오기 전에는 받아 둔 큰 그림·작은 그림을 보인다
    val size = if (path.startsWith("toolimg-")) ThumbStore.Size.Large else ThumbStore.Size.Full
    LaunchedEffect(path) { thumbs.request(path, size); thumbs.request(path, ThumbStore.Size.Large) }
    val img = thumbs.image(path, size) ?: thumbs.image(path, ThumbStore.Size.Large)
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) { detectTapGestures(onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f }) }
            // 두 손가락이거나 확대한 뒤에만 손짓을 쓴다(확대하지 않았을 때 한 손가락으로 끌면 옆 사진으로 넘어가게)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        if (event.changes.count { it.pressed } >= 2 || scale > 1f) {
                            scale = (scale * event.calculateZoom()).coerceIn(1f, 6f)
                            offset = if (scale == 1f) Offset.Zero else offset + event.calculatePan()
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        when {
            img != null -> Image(
                img, null, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
            )
            thumbs.errors[path] != null -> Text(thumbs.errors[path] ?: "", color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.padding(32.dp))
            else -> CircularProgressIndicator(color = Color.White)
        }
    }
}
