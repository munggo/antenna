package com.munggo.antenna.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.munggo.antenna.AntennaApp
import com.munggo.antenna.MainActivity
import com.munggo.antenna.R
import com.munggo.antenna.session.BridgeSession
import com.munggo.antenna.tr

/**
 * 구글 푸시(FCM)로 오는 알림. 맥 브리지가 자기 Firebase 키로 보낸 '데이터 메시지'를 받아 앱이 직접 알림을 띄운다
 * (제목·부제·내용·종류·탭 번호. server/push.mjs 의 fcm 보내기와 같은 모양). 알림을 누르면 그 탭으로 간다
 */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        AntennaApp.instance.savePushToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val window = d["window"]?.toIntOrNull()
        // 앱을 보고 있을 때 온 알림: 지금 보는 탭 것이면 숨긴다(이미 화면에 보임)
        if (AntennaApp.instance.foreground && window != null && window == BridgeSession.viewingWindow) return
        Notifier.show(this, d["title"] ?: "Antenna", d["subtitle"] ?: "", d["body"] ?: "", d["kind"] ?: "done", window)
    }
}

object Notifier {
    private const val ASK = "ask"
    private const val DONE = "done"

    /** 알림 갈래: 묻는 것(승인·질문·확인 창)은 소리와 함께 위에 뜨고, 끝남·시험은 보통 알림 */
    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(ASK, tr("답을 기다림", "Waiting for you"), NotificationManager.IMPORTANCE_HIGH).apply {
            description = tr("승인·질문·확인 창", "Approvals, questions and prompts")
        })
        nm.createNotificationChannel(NotificationChannel(DONE, tr("작업 끝남", "Work finished"), NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = tr("작업이 끝났거나 멈췄을 때", "When work finishes or stops")
        })
    }

    fun show(context: Context, title: String, subtitle: String, body: String, kind: String, window: Int?) {
        ensureChannels(context)
        val urgent = kind in setOf("approval", "prompt", "choice", "question")
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (window != null) putExtra(MainActivity.EXTRA_WINDOW, window)
        }
        val tag = "pi-${window ?: ""}"
        val pi = PendingIntent.getActivity(context, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, if (urgent) ASK else DONE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .apply { if (subtitle.isNotEmpty()) setSubText(subtitle) }
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(if (urgent) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setGroup(tag)
            .build()
        // 같은 탭의 같은 갈래 알림은 새것으로 바꾼다(아이폰의 thread-id 처럼 탭마다 묶음)
        runCatching { NotificationManagerCompat.from(context).notify(tag, if (urgent) 1 else 2, n) }
    }

    /** 앱을 연 그 탭의 알림은 지운다 */
    fun clear(context: Context, window: Int) {
        Handler(Looper.getMainLooper()).post {
            val nm = NotificationManagerCompat.from(context)
            nm.cancel("pi-$window", 1)
            nm.cancel("pi-$window", 2)
        }
    }
}
