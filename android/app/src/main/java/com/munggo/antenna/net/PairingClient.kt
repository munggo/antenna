package com.munggo.antenna.net

import android.os.Handler
import android.os.Looper
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import com.munggo.antenna.model.json
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * 짝짓기: QR 의 한 번 쓰는 코드를 맥에 내고 이 폰만의 연결 토큰을 받는다(아이폰 앱의 PairingClient 와 같다).
 * 맥 주소 후보마다 동시에 물어, 토큰을 준 답 하나를 쓴다(코드는 한 번만 쓸 수 있어 나머지는 거절되는데, 그건 무시).
 */
class PairingClient {
    enum class Failure { Invalid, Expired, Unreachable }

    private val main = Handler(Looper.getMainLooper())
    private val sockets = mutableListOf<WebSocket>()
    private var finished = false
    private var pending = 0
    private var rejected: Failure? = null

    /** 끝나면 메인 스레드에서 한 번 부른다(성공: 토큰, 실패: 까닭) */
    fun exchange(code: String, hosts: List<String>, port: Int, fingerprint: String, name: String, done: (String?, Failure?) -> Unit) {
        val finish: (String?, Failure?) -> Unit = { token, why ->
            if (!finished) {
                finished = true
                sockets.forEach { it.cancel() }
                done(token, why)
            }
        }
        if (hosts.isEmpty()) return finish(null, Failure.Unreachable)
        val client = Tls.client(fingerprint)
        val ask = buildJsonObject { put("type", "pair"); put("code", code); put("name", name) }.toString()
        for (host in hosts) {
            val scheme = if (fingerprint.isEmpty()) "ws" else "wss"
            val url = "$scheme://${hostPart(host)}:$port/pair"
            pending += 1
            var settled = false
            val settle: (Failure?) -> Unit = { why ->
                if (!settled && !finished) {
                    settled = true
                    if (why != null) rejected = why
                    pending -= 1
                    if (pending == 0) finish(null, rejected ?: Failure.Unreachable)
                }
            }
            val request = try { Request.Builder().url(url).build() } catch (e: IllegalArgumentException) { pending -= 1; continue }
            sockets += client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(ask)
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    main.post {
                        val obj = runCatching { json.parseToJsonElement(text) as JsonObject }.getOrNull()
                        val type = obj?.get("type")?.jsonPrimitive?.content
                        val token = obj?.get("token")?.jsonPrimitive?.content
                        if (type == "paired" && token != null && TOKEN.matches(token)) finish(token, null)
                        else settle(if (obj?.get("reason")?.jsonPrimitive?.content == "expired") Failure.Expired else Failure.Invalid)
                    }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    main.post { settle(null) }
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    main.post { settle(null) }
                }
            })
        }
        if (pending == 0) return finish(null, Failure.Unreachable)
        // 어디서도 답이 없으면 12초 뒤 그만둠
        main.postDelayed({ finish(null, rejected ?: Failure.Unreachable) }, 12_000)
    }

    companion object {
        val TOKEN = Regex("^[0-9a-fA-F]{32,128}$")

        /** IPv6 주소는 대괄호로 감싼다 */
        fun hostPart(host: String) = if (host.contains(':')) "[$host]" else host
    }
}
