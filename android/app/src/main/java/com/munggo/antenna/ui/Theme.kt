package com.munggo.antenna.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp

/** 아이폰 앱(ios/PiRemote/Theme.swift)과 같은 색. 폰의 밝은·어두운 화면 설정을 따른다 */
@Immutable
data class Palette(
    val bg: Color,
    val bgElevated: Color,
    val surface: Color,
    val bubble: Color,
    val surfaceHigh: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val green: Color,
    val purple: Color,
    val teal: Color,
    val red: Color,
    val codeInline: Color,
)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightPalette = Palette(
    bg = c(0xF9F9F7), bgElevated = c(0xF0F0EE), surface = c(0xFFFFFF), bubble = c(0xEFEFED), surfaceHigh = c(0xEFEFED),
    border = Color.Black.copy(alpha = 0.10f), text = c(0x0F0F0E), muted = c(0x74736E), accent = c(0xC96442),
    green = c(0x4E8A3E), purple = c(0x8A5CC7), teal = c(0x2E7D8C), red = c(0xC0453A), codeInline = c(0xB5532F),
)

val DarkPalette = Palette(
    bg = c(0x151515), bgElevated = c(0x202020), surface = c(0x2A2A2A), bubble = c(0x2A2A2A), surfaceHigh = c(0x3D3D3D),
    border = Color.White.copy(alpha = 0.08f), text = c(0xF9F9F7), muted = c(0x96958D), accent = c(0xCC7C5E),
    green = c(0x8BBF7A), purple = c(0xB08EE6), teal = c(0x6FB7C4), red = c(0xE5675A), codeInline = c(0xEBA37E),
)

/** 터미널은 맥 화면을 그대로 옮기므로 밝은 화면에서도 어둡게 둔다 */
val TerminalBg = c(0x151515)

/** 글자 크기(아이폰 앱의 Typo 와 같은 값, pt → sp) */
object Typo {
    val body = 17.sp
    val quote = 16.sp
    val h1 = 22.sp
    val h2 = 20.sp
    val h3 = 18.sp
    val inlineCode = 15.5.sp
    val code = 14.sp
    val codeSmall = 13.sp
    val table = 15.sp
    val row = 16.sp
    val caption = 13.sp
    val chip = 15.sp
    val title = 17.sp
    val subtitle = 14.sp
    val tab = 14.sp
}

/** 글자 크기 더하고 빼기(둘 다 sp): Typo.caption + 1.sp */
operator fun androidx.compose.ui.unit.TextUnit.plus(other: androidx.compose.ui.unit.TextUnit) = (value + other.value).sp
operator fun androidx.compose.ui.unit.TextUnit.minus(other: androidx.compose.ui.unit.TextUnit) = (value - other.value).sp

val LocalPalette = staticCompositionLocalOf { DarkPalette }

/** 지금 화면의 색 */
val colors: Palette @Composable get() = LocalPalette.current

@Composable
fun AntennaTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val p = if (dark) DarkPalette else LightPalette
    val scheme = if (dark) {
        darkColorScheme(primary = p.accent, background = p.bg, surface = p.surface, onBackground = p.text, onSurface = p.text,
            surfaceVariant = p.surfaceHigh, onSurfaceVariant = p.muted, error = p.red, outline = p.border)
    } else {
        lightColorScheme(primary = p.accent, background = p.bg, surface = p.surface, onBackground = p.text, onSurface = p.text,
            surfaceVariant = p.surfaceHigh, onSurfaceVariant = p.muted, error = p.red, outline = p.border)
    }
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
