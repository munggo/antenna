package com.munggo.antenna

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import com.munggo.antenna.net.ConnectionSettings
import com.munggo.antenna.session.BridgeSession

/** 앱 하나에 연결 세션 하나. 화면이 다시 만들어져도(회전 등) 연결과 터미널 화면은 그대로 둔다 */
class AntennaApp : Application() {
    val settings by lazy { ConnectionSettings(this) }
    private var sessionInstance: BridgeSession? = null
    /** 앱 화면이 앞에 있는지(알림 서비스가 다른 스레드에서 읽음) */
    @Volatile var foreground = false
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        // 앱이 뒤로 가면 잠시 뒤 연결을 끊고(배터리), 앞으로 오면 바로 다시 붙는다. 알림은 구글 푸시가 맡는다
        ProcessLifecycleOwner.get().lifecycle.addObserver(LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> { foreground = true; sessionInstance?.onAppForeground() }
                Lifecycle.Event.ON_STOP -> { foreground = false; sessionInstance?.onAppBackground() }
                else -> {}
            }
        })
    }

    /** 세션(화면 스레드에서 처음 만든다: 터미널 웹 보기가 들어 있어서) */
    fun session(): BridgeSession = sessionInstance ?: BridgeSession(this, settings).also {
        sessionInstance = it
        it.pushToken = getSharedPreferences("push", Context.MODE_PRIVATE).getString("token", null)
    }

    /** 구글 푸시 토큰을 저장하고, 세션이 있으면 맥에 등록한다(알림 서비스는 다른 스레드에서 부름) */
    fun savePushToken(token: String) {
        getSharedPreferences("push", Context.MODE_PRIVATE).edit().putString("token", token).apply()
        Handler(Looper.getMainLooper()).post { sessionInstance?.pushToken = token }
    }

    companion object {
        lateinit var instance: AntennaApp
            private set
    }
}
