package com.munggo.antenna.ui

import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * 터미널 보기(맥 tmux 화면, 보기 전용). 위아래로 끌면 맥에 마우스 휠 신호를 보내 tmux·에이전트가 스크롤하고,
 * 손을 떼면 속도만큼 미끄러진다(아이폰 앱의 TerminalContainerView 와 같다). 누르면 키보드를 내린다
 */
@Composable
fun TerminalPane(session: BridgeSession, interactive: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val step = with(LocalDensity.current) { 5.dp.toPx() }
    DisposableEffect(Unit) {
        session.terminal.attach(context)
        onDispose { session.terminal.detach(context.applicationContext) }
    }
    Box(modifier.fillMaxSize().background(TerminalBg)) {
        AndroidView(
            factory = { (session.terminal.view.parent as? ViewGroup)?.removeView(session.terminal.view); session.terminal.view },
            modifier = Modifier.fillMaxSize().testTag("terminal"),
        )
        if (interactive) {
            var coast: Job? = null
            Box(
                Modifier.fillMaxSize()
                    .pointerInput(Unit) { detectTapGestures { focus.clearFocus() } }
                    .pointerInput(Unit) {
                        val tracker = VelocityTracker()
                        var acc = 0f
                        detectVerticalDragGestures(
                            onDragStart = { coast?.cancel(); tracker.resetTracking(); acc = 0f },
                            onDragEnd = {
                                // 손 뗀 뒤 속도로 감속하며 더 스크롤(관성)
                                var v = tracker.calculateVelocity().y / density
                                coast = scope.launch {
                                    while (abs(v) > 50) {
                                        session.scrollLines(v > 0, (abs(v) / 650).toInt().coerceIn(1, 4))
                                        v *= 0.90f
                                        delay(16)
                                    }
                                }
                            },
                        ) { change, dy ->
                            tracker.addPosition(change.uptimeMillis, change.position)
                            acc += dy
                            if (abs(acc) >= step) {
                                val lines = (acc / step).toInt()
                                // 손가락을 아래로 끌면(dy>0) 과거 보기(위로 스크롤)
                                session.scrollLines(acc > 0, minOf(abs(lines), 5))
                                acc -= lines * step
                            }
                        }
                    },
            )
        }
        AnimatedVisibility(interactive && session.scrolledUp, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)) {
            Box(
                Modifier.size(40.dp).shadow(6.dp, CircleShape).clip(CircleShape).background(colors.surfaceHigh).border(1.dp, colors.border, CircleShape)
                    .clickable { session.scrollToBottom() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ArrowDownward, tr("맨 아래로", "Scroll to bottom"), tint = colors.text, modifier = Modifier.size(18.dp)) }
        }
    }
}
