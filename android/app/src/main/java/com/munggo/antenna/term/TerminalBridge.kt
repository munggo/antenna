package com.munggo.antenna.term

import android.annotation.SuppressLint
import android.content.Context
import android.content.MutableContextWrapper
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayOutputStream

/**
 * 터미널 보기(맥 tmux 화면). xterm.js 를 담은 웹 보기 하나를 연결 내내 살려 두고 받은 바이트를 계속 넣는다
 * (채팅을 보는 동안에도 받아 두므로 바꾸면 바로 최신 화면. 아이폰 앱이 터미널 뷰를 세션에 두는 것과 같다).
 * 보기 전용이다: 입력은 아래 입력창이 맡는다.
 */
class TerminalBridge(appContext: Context, private val onSize: (cols: Int, rows: Int) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val holder = MutableContextWrapper(appContext)
    private var ready = false
    private val pending = ByteArrayOutputStream()
    private val pendingText = StringBuilder()
    private var flushPosted = false

    /** 지금 터미널 칸 수(웹 보기가 크기를 알려 주기 전에는 80×24) */
    var cols = 80; private set
    var rows = 24; private set

    init {
        // 디버그 빌드: 맥의 크롬에서 터미널 웹 보기를 살펴볼 수 있게(chrome://inspect)
        if (com.munggo.antenna.BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    val view: WebView = WebView(holder).apply {
        // 부모만큼 채우기: 내용만큼 높이(기본)로 놓이면 웹 보기 안의 100% 높이가 0 이 되어 칸 수를 잴 수 없다
        layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        setBackgroundColor(Color.parseColor("#151515"))
        settings.javaScriptEnabled = true
        settings.allowFileAccess = true
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        isFocusable = false
        isFocusableInTouchMode = false
        webViewClient = WebViewClient()
        // 배치가 바뀔 때마다(화면에 붙음·키보드·회전) 칸 수를 다시 잰다. 웹 보기 안의 크기 감지만으로는 마지막 변화를 놓친 적이 있다
        addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob ->
            if ((r - l != or - ol || b - t != ob - ot) && ready) main.postDelayed({ evaluateJavascript("refit()", null) }, 50)
        }
        addJavascriptInterface(object {
            @JavascriptInterface
            fun onReady() { main.post { ready = true; flush() } }

            @JavascriptInterface
            fun onResize(c: Int, r: Int) {
                main.post {
                    if (c <= 0 || r <= 0 || (c == cols && r == rows)) return@post
                    cols = c; rows = r
                    onSize(c, r)
                }
            }
        }, "Antenna")
        loadUrl("file:///android_asset/xterm/index.html")
    }

    /** 화면에 붙일 때 그 화면의 문맥으로 바꾼다(떼면 앱 문맥으로 돌려 화면이 새지 않게) */
    fun attach(context: Context) { holder.baseContext = context }
    fun detach(appContext: Context) { holder.baseContext = appContext }

    /** 맥에서 받은 터미널 바이트(아무 스레드에서나) */
    fun feed(bytes: ByteArray) {
        synchronized(pending) { pending.write(bytes) }
        scheduleFlush()
    }

    /** 맥이 글 프레임으로 보낸 터미널 글(JSON 이 아닌 것) */
    fun feedText(text: String) {
        synchronized(pending) { pendingText.append(text) }
        scheduleFlush()
    }

    private fun scheduleFlush() {
        synchronized(pending) {
            if (flushPosted) return
            flushPosted = true
        }
        // 한 화면에 한 번만 넣는다(작은 조각마다 넣으면 느려짐)
        main.postDelayed({ flush() }, 16)
    }

    private fun flush() {
        val bytes: ByteArray
        val text: String
        synchronized(pending) {
            flushPosted = false
            if (!ready) return
            bytes = pending.toByteArray()
            pending.reset()
            text = pendingText.toString()
            pendingText.clear()
        }
        if (bytes.isNotEmpty()) view.evaluateJavascript("feed('${Base64.encodeToString(bytes, Base64.NO_WRAP)}')", null)
        if (text.isNotEmpty()) view.evaluateJavascript("feedText(${org.json.JSONObject.quote(text)})", null)
    }

    /** 숨어 있거나 맥에 붙기 전에는 커서를 깜빡이지 않는다 */
    fun setBlink(on: Boolean) {
        if (ready) view.evaluateJavascript("setBlink($on)", null)
    }

    /** 새 연결: 지난 화면을 지운다(맥 tmux 가 붙자마자 화면 전체를 다시 그림). 연결 스레드에서 받은 바이트보다 먼저 부른다 */
    fun reset() {
        synchronized(pending) { pending.reset(); pendingText.clear() }
        main.post { if (ready) view.evaluateJavascript("reset()", null) }
    }
}
