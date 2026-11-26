package com.munggo.antenna.net

import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.munggo.antenna.tr
import java.net.URLDecoder

/** 짝짓기 링크(맥 deploy/pair.sh 의 QR)에서 읽은 값 */
data class PairLink(
    /** 예전 방식: 모든 폰이 같이 쓰던 토큰 */
    val token: String?,
    /** 지금 방식: 한 번 쓰는 짝짓기 코드(5분). 맥에 내고 이 폰만의 토큰을 받는다 */
    val code: String?,
    /** 맥 인증서의 지문. 있으면 그 지문의 맥과만 암호화 연결을 맺는다 */
    val fingerprint: String?,
    /** 맥 주소(같은 Wi-Fi 밖에서 붙을 주소. 맥 설정에 적어 두지 않았으면 비어 있음) */
    val hosts: List<String>,
    val port: String?,
) {
    companion object {
        private val SECRET = Regex("^[0-9a-fA-F]{32,128}$")
        private val FP = Regex("^[0-9a-fA-F]{64}$")
        private val HOST = Regex("^[A-Za-z0-9.:-]{1,253}$")

        /**
         * 짝짓기 링크 읽기. 형식이 맞지 않으면 null.
         * 지금 방식 piremote://pair?code=…&fp=…&host=…&port=… / 예전 방식 piremote://pair?token=…&host=…&port=…
         */
        fun parse(link: String): PairLink? {
            val s = link.trim()
            val head = "piremote://pair"
            if (!s.startsWith(head, ignoreCase = true)) return null
            val rest = s.substring(head.length)
            if (rest.isNotEmpty() && rest[0] != '?' && rest[0] != '/') return null
            val query = rest.substringAfter('?', "")
            val items = query.split('&').filter { it.isNotEmpty() }.map {
                val k = it.substringBefore('=')
                val v = runCatching { URLDecoder.decode(it.substringAfter('=', ""), "UTF-8") }.getOrDefault("")
                k to v
            }
            fun first(name: String) = items.firstOrNull { it.first == name }?.second
            fun secret(name: String) = first(name)?.takeIf { SECRET.matches(it) }
            val token = secret("token")
            val code = secret("code")
            if (token == null && code == null) return null
            val fp = first("fp")?.takeIf { FP.matches(it) }?.lowercase()
            // 주소는 여러 개일 수 있다(VPN 주소·이름 등). 주소에 쓸 수 없는 글자가 든 것은 버림
            val hosts = items.filter { it.first == "host" && HOST.matches(it.second) }.map { it.second }.distinct()
            val port = first("port")?.toIntOrNull()?.takeIf { it in 1..65535 }?.toString()
            // 코드가 있으면 지금 방식으로(토큰이 함께 있어도 코드가 먼저)
            return PairLink(token = if (code == null) token else null, code = code, fingerprint = fp, hosts = hosts, port = port)
        }
    }
}

/**
 * 접속 설정. 주소는 사용자 입력 없이 자동(같은 Wi-Fi 에서는 맥 찾기, 그 밖에서는 짝짓기 QR 로 받은 맥 주소).
 * 사용자는 맥 화면의 짝짓기 QR 을 한 번 찍으면 된다(아이폰 앱의 ConnectionSettings 와 같다).
 */
class ConnectionSettings(private val context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)

    private var _token by mutableStateOf(SecureStore.get(prefs, "token"))
    var token: String
        get() = _token
        set(v) { _token = v; SecureStore.put(prefs, "token", v) }

    private var _port by mutableStateOf(prefs.getString("port", null) ?: "8787")
    var port: String
        get() = _port
        set(v) { _port = v; prefs.edit().putString("port", v).apply() }

    /** 맥 인증서의 지문. 있으면 그 지문의 맥과만 암호화 연결, 비어 있으면 예전 방식(암호화 없음) */
    private var _fingerprint by mutableStateOf(prefs.getString("fingerprint", null) ?: "")
    var fingerprint: String
        get() = _fingerprint
        set(v) { _fingerprint = v; prefs.edit().putString("fingerprint", v).apply() }

    /** 짝짓기 QR 로 받은 맥 주소들(VPN 주소 등). 같은 Wi-Fi 밖에서는 이 주소로 붙는다 */
    private var _hosts by mutableStateOf(prefs.getString("hosts", null)?.split(',')?.filter { it.isNotEmpty() } ?: emptyList())
    var hosts: List<String>
        get() = _hosts
        set(v) { _hosts = v; prefs.edit().putString("hosts", v.joinToString(",")).apply() }

    /** QR 로 새 토큰을 받은 시각(받으면 화면이 새 토큰으로 다시 연결) */
    var pairedAt by mutableStateOf<Long?>(null)
    /** 앱 밖에서 열린 링크가 이미 짝지은 폰의 맥 주소를 다른 주소로 바꾸려 함 → 물은 뒤 저장 */
    var pendingPair by mutableStateOf<PairLink?>(null)
    /** 짝짓는 중(코드를 맥에 내고 토큰을 기다림) */
    var pairing by mutableStateOf(false)
    /** 짝짓기 결과를 알리는 글(화면이 한 번 보여 줌) */
    var pairNotice by mutableStateOf<String?>(null)
    /** 같은 망에서 찾은 맥 주소. 짝지을 때 QR 에 주소가 없으면 이 주소로 코드를 낸다 */
    var discovered: List<String> = emptyList()
    private var pairingClient: PairingClient? = null

    val isValid: Boolean get() = token.isNotEmpty() && port.toIntOrNull() != null

    /**
     * 맥 QR 링크: 맞으면 짝짓고 true. confirmHostChange: 앱 밖에서 열린 링크일 때 켠다.
     * 이미 짝지은 폰의 맥 주소를 다른 주소로 바꾸는 링크면 바로 저장하지 않고 pendingPair 에 두어 묻는다
     */
    fun applyPairLink(link: String, confirmHostChange: Boolean = false): Boolean {
        val p = PairLink.parse(link) ?: return false
        if (confirmHostChange && token.isNotEmpty() && p.hosts.isNotEmpty() && p.hosts.toSet() != hosts.toSet()) {
            pendingPair = p
            return true
        }
        apply(p)
        return true
    }

    fun apply(link: PairLink) {
        pendingPair = null
        if (link.code != null) {
            pair(link.code, link)
            return
        }
        // 예전 방식: 링크의 토큰을 그대로 저장. 그런 QR 에는 지문이 없으니 그 맥의 방식대로 암호화 없이 붙는다
        save(link, link.token ?: "")
    }

    private fun save(link: PairLink, newToken: String) {
        // 링크에 주소가 없으면(맥 설정에 주소를 적어 두지 않음) 쓰던 주소를 그대로 둔다
        if (link.hosts.isNotEmpty()) hosts = link.hosts
        link.port?.let { port = it }
        fingerprint = link.fingerprint ?: ""
        token = newToken
        pairedAt = System.currentTimeMillis()
    }

    /** 지금 방식 짝짓기: 받기 전에는 쓰던 연결 정보를 건드리지 않는다(실패해도 지금 연결이 그대로) */
    private fun pair(code: String, link: PairLink) {
        if (pairing) return
        pairing = true
        val candidates = (link.hosts + discovered + (if (link.hosts.isEmpty()) hosts else emptyList())).distinct()
        val client = PairingClient()
        pairingClient = client
        client.exchange(code, candidates, (link.port ?: port).toIntOrNull() ?: 8787, link.fingerprint ?: "", deviceName()) { newToken, why ->
            pairing = false
            pairingClient = null
            if (newToken != null) save(link, newToken)
            else pairNotice = when (why) {
                PairingClient.Failure.Expired -> tr("QR 이 만료됐어요. 맥에서 다시 띄워 주세요", "The QR code has expired. Show it again on the Mac")
                PairingClient.Failure.Invalid -> tr("이미 쓴 QR 이에요. 맥에서 다시 띄워 주세요", "That QR code was already used. Show a new one on the Mac")
                else -> tr("맥에 닿지 못했어요. 같은 Wi-Fi 인지, VPN 이 켜져 있는지 확인해 주세요", "Couldn't reach the Mac. Check that you're on the same Wi-Fi or that the VPN is on")
            }
        }
    }

    /** 맥의 짝지은 기기 목록에 보일 이름 */
    private fun deviceName(): String =
        Settings.Global.getString(context.contentResolver, "device_name")?.takeIf { it.isNotBlank() } ?: Build.MODEL

    /** 이 맥으로 가는 주소. 지문이 있으면 암호화 연결(wss) */
    fun url(host: String, path: String, query: String = ""): String {
        val scheme = if (fingerprint.isEmpty()) "ws" else "wss"
        return "$scheme://${PairingClient.hostPart(host)}:$port$path${if (query.isEmpty()) "" else "?$query"}"
    }
}
