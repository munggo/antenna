package com.munggo.antenna

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.munggo.antenna.net.ConnectionSettings
import com.munggo.antenna.net.Discovery
import com.munggo.antenna.push.Notifier
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.ui.AntennaTheme
import com.munggo.antenna.ui.LocalSession
import com.munggo.antenna.ui.MainScreen
import com.munggo.antenna.ui.PairScreen

@OptIn(ExperimentalComposeUiApi::class)
class MainActivity : ComponentActivity() {
    private var discovery: Discovery? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as AntennaApp
        val session = app.session()
        val settings = app.settings
        // 같은 Wi-Fi 에서 맥 찾기: 찾은 주소는 짝짓기와 연결 후보에 함께 쓴다
        discovery = Discovery(this) { hosts ->
            settings.discovered = hosts
            session.setDiscovered(hosts)
        }.also { it.known = settings.hosts; it.start() }
        // 구글 푸시: 자기 Firebase 설정(google-services.json)을 넣어 빌드했을 때만
        if (BuildConfig.HAS_FIREBASE && FirebaseApp.getApps(this).isNotEmpty()) {
            Notifier.ensureChannels(this)
            FirebaseMessaging.getInstance().token.addOnSuccessListener { app.savePushToken(it) }
        }
        handle(intent)
        setContent {
            AntennaTheme {
                // 시험 이름(testTag)을 화면 정보로 내보낸다: 에뮬레이터 시험(uiautomator)이 요소를 찾는 데 씀
                CompositionLocalProvider(LocalSession provides session) {
                    androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.semantics { testTagsAsResourceId = true }) { AppRoot(session, settings) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** 짝짓기 링크(폰 카메라·렌즈로 찍은 QR)와 알림을 눌러 연 탭 */
    private fun handle(intent: Intent?) {
        intent ?: return
        val app = application as AntennaApp
        intent.dataString?.let { link ->
            // 앱 밖에서 열린 링크라, 이미 짝지은 폰의 맥 주소를 바꾸는 것이면 먼저 묻는다
            if (link.startsWith("piremote://pair", ignoreCase = true)) app.settings.applyPairLink(link, confirmHostChange = true)
        }
        // 디버그 빌드의 시험 문: 알림 모양과 누르면 그 탭으로 가는지(구글 푸시 없이). adb shell am start ... --es test_notify approval --ei window 0
        if (BuildConfig.DEBUG) intent.getStringExtra("test_notify")?.let { kind ->
            intent.removeExtra("test_notify")
            val win = intent.getIntExtra("window", -1).takeIf { it >= 0 }
            intent.removeExtra(EXTRA_WINDOW)
            Notifier.show(this, "승인 필요", "메인 작업", "Slack 에 보낼까요?", kind, win)
            return
        }
        val w = intent.getIntExtra(EXTRA_WINDOW, -1)
        if (w >= 0) {
            intent.removeExtra(EXTRA_WINDOW)
            getSharedPreferences("view", MODE_PRIVATE).edit().putString("viewMode", "chat").apply()
            app.session().pendingWindow = w
            Notifier.clear(this, w)
        }
    }

    override fun onDestroy() {
        discovery?.stop()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_WINDOW = "window"
    }
}

@Composable
private fun AppRoot(session: BridgeSession, settings: ConnectionSettings) {
    var showMain by rememberSaveable { mutableStateOf(settings.isValid) }
    // 토큰이 저장돼 있으면 켜자마자 연결(짝짓기 때 받은 맥 주소와 같은 Wi-Fi 에서 찾은 주소를 함께 시도)
    LaunchedEffect(Unit) { if (settings.isValid && session.status == BridgeSession.Status.Idle) session.connect() }
    // QR 로 새 토큰을 받으면 그 토큰으로 다시 연결
    LaunchedEffect(settings.pairedAt) {
        if (settings.pairedAt == null) return@LaunchedEffect
        session.disconnect()
        session.connect()
        showMain = true
        session.say(com.munggo.antenna.tr("연결 정보를 저장했어요", "Saved the connection"))
    }
    // 짝짓지 못한 까닭은 본 화면에서도 알린다
    LaunchedEffect(settings.pairNotice, showMain) {
        val n = settings.pairNotice ?: return@LaunchedEffect
        if (showMain) { session.say(n); settings.pairNotice = null }
    }

    if (showMain) {
        MainScreen(session, onSettings = { session.disconnect(); showMain = false })
        NotificationPermission()
    } else {
        PairScreen(session, settings, onConnect = { session.connect(); showMain = true })
    }

    settings.pendingPair?.let { link ->
        val none = com.munggo.antenna.tr("없음", "none")
        AlertDialog(
            onDismissRequest = { settings.pendingPair = null },
            title = { Text(com.munggo.antenna.tr("연결할 맥 주소를 바꿀까요?", "Change the Mac address to connect to?")) },
            text = {
                Text(com.munggo.antenna.tr(
                    "새 주소: ${link.hosts.joinToString(", ")}\n지금 주소: ${settings.hosts.joinToString(", ").ifEmpty { none }}\n내 맥 화면의 QR을 찍은 것이 맞을 때만 바꾸세요.",
                    "New address: ${link.hosts.joinToString(", ")}\nCurrent address: ${settings.hosts.joinToString(", ").ifEmpty { none }}\nOnly change it if you scanned the QR code on your own Mac.",
                ))
            },
            confirmButton = { TextButton({ settings.apply(link) }) { Text(com.munggo.antenna.tr("바꾸기", "Change")) } },
            dismissButton = { TextButton({ settings.pendingPair = null }) { Text(com.munggo.antenna.tr("취소", "Cancel")) } },
        )
    }
}

/** 안드로이드 13 이상: 알림을 띄우려면 한 번 허락을 받는다(구글 푸시를 넣어 빌드했을 때만) */
@Composable
private fun NotificationPermission() {
    if (!BuildConfig.HAS_FIREBASE || Build.VERSION.SDK_INT < 33) return
    val context = androidx.compose.ui.platform.LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
