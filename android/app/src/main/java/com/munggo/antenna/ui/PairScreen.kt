package com.munggo.antenna.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.munggo.antenna.net.ConnectionSettings
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr

/**
 * 첫 화면(짝짓기). 맥에서 sh deploy/pair.sh 로 띄운 QR 을 찍으면 끝난다(코드를 맥에 내고 이 폰만의 토큰을 받음).
 * QR 찍기는 구글 Play 서비스의 화면을 써서 앱에 카메라 권한이 필요 없다. 폰 카메라·렌즈로 찍은 링크로 열어도 된다
 */
@Composable
fun PairScreen(session: BridgeSession, settings: ConnectionSettings, onConnect: () -> Unit) {
    val context = LocalContext.current
    Box(Modifier.fillMaxSize().background(colors.bg).padding(horizontal = 28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(22.dp), modifier = Modifier.fillMaxWidth()) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                Logo(Modifier.padding(bottom = 6.dp))
                Text("Antenna", color = colors.text, fontSize = 32.sp, fontFamily = FontFamily.Serif)
                Text(tr("맥의 pi·Claude Code를 어디서나 이어서", "Pick up pi and Claude Code on your Mac from anywhere"), color = colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
            }
            Column(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxWidth()) {
                OutlineButton(Icons.Outlined.QrCodeScanner, tr("QR 코드 찍기", "Scan QR code"), "scanQR") {
                    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                    GmsBarcodeScanning.getClient(context, options).startScan()
                        .addOnSuccessListener { code ->
                            val raw = code.rawValue ?: ""
                            if (!settings.applyPairLink(raw)) session.say(tr("Antenna 짝짓기 QR 이 아니에요", "That isn't an Antenna pairing QR code"))
                        }
                        .addOnFailureListener { session.say(tr("QR 찍기를 열지 못했어요: ${it.message}", "Couldn't open the QR scanner: ${it.message}")) }
                }
                // 다른 앱으로 찍었거나 링크를 받았을 때: piremote://pair?… 를 복사해 두고 붙여 넣는다
                OutlineButton(Icons.Outlined.ContentPaste, tr("복사한 짝짓기 링크 붙여넣기", "Paste a copied pairing link"), "pastePair") {
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val text = cm.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
                    if (!settings.applyPairLink(text)) session.say(tr("복사한 글이 짝짓기 링크가 아니에요", "The copied text isn't a pairing link"))
                }
                Text(
                    if (settings.pairing) tr("맥과 짝짓는 중…", "Pairing with the Mac…")
                    else tr("맥의 Antenna 폴더에서 sh deploy/pair.sh 를 실행하고, 화면에 뜬 QR을 찍으면 돼요.", "Run sh deploy/pair.sh in the Antenna folder on your Mac and scan the QR code it shows."),
                    color = colors.muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
            Text(
                tr("연결", "Connect"), color = if (settings.isValid) Color.White else colors.muted, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().clip(CircleShape).background(if (settings.isValid) colors.accent else colors.surfaceHigh)
                    .clickable(enabled = settings.isValid, onClick = onConnect).padding(15.dp).testTag("connectButton"),
            )
            when (session.status) {
                BridgeSession.Status.Connecting -> Text(tr("연결 중…", "Connecting…"), color = colors.muted, fontSize = 13.sp)
                BridgeSession.Status.Connected -> Text(tr("연결됨", "Connected"), color = colors.green, fontSize = 13.sp)
                else -> Spacer(Modifier.height(1.dp))
            }
            session.toast?.let { Text(it, color = colors.text, fontSize = 13.sp, textAlign = TextAlign.Center) }
            settings.pairNotice?.let { Text(it, color = colors.red, fontSize = 13.sp, textAlign = TextAlign.Center) }
        }
    }
}

@Composable
private fun OutlineButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tag: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, colors.accent.copy(alpha = 0.7f), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick).padding(vertical = 12.dp).testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = colors.accent, modifier = Modifier.size(20.dp))
        Text(label, color = colors.accent, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** 앱 아이콘과 같은 모양: 탭 상태 색의 점 세 개(작업 중·답을 기다림·끝남)와 두 겹 고리 */
@Composable
fun Logo(modifier: Modifier = Modifier) {
    val d: Dp = 22.dp
    Row(modifier) {
        for (c in listOf(colors.accent, colors.purple, colors.green)) {
            Box(Modifier.width(d * 1.6f).height(d * 1.63f), contentAlignment = Alignment.Center) {
                Box(Modifier.size(d * 1.63f).border(1.2.dp, c.copy(alpha = 0.30f), CircleShape))
                Box(Modifier.size(d * 1.31f).border(1.6.dp, c.copy(alpha = 0.72f), CircleShape))
                Box(Modifier.size(d).clip(CircleShape).background(c))
            }
        }
    }
}
