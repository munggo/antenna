package com.munggo.antenna.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import java.net.Inet4Address

/**
 * 같은 Wi-Fi 에서 맥 브리지(_piremote._tcp)를 찾아 주소 목록을 준다(아이폰 앱의 BonjourBrowser 자리).
 * 사용자가 맥 주소를 몰라도 앱이 알아서 찾는다.
 */
class Discovery(context: Context, private val onHosts: (List<String>) -> Unit) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val main = Handler(Looper.getMainLooper())
    private var lock: WifiManager.MulticastLock? = null
    private var listener: NsdManager.DiscoveryListener? = null
    private val hosts = mutableListOf<String>()
    /** 짝짓기 때 받은 맥 주소(VPN 주소 등). 따로 시도하므로 찾은 목록에는 넣지 않는다 */
    var known: List<String> = emptyList()
    /** 한 번에 하나씩만 풀 수 있는 예전 안드로이드를 위해 차례로 */
    private val queue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false

    fun start() {
        if (listener != null) return
        lock = wifi.createMulticastLock("antenna-discovery").apply { setReferenceCounted(false); acquire() }
        val l = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceLost(service: NsdServiceInfo) {}
            override fun onServiceFound(service: NsdServiceInfo) {
                main.post { queue.addLast(service); resolveNext() }
            }
        }
        listener = l
        runCatching { nsd.discoverServices("_piremote._tcp", NsdManager.PROTOCOL_DNS_SD, l) }
    }

    fun stop() {
        listener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
        listener = null
        lock?.release()
        lock = null
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (resolving) return
        val s = queue.removeFirstOrNull() ?: return
        resolving = true
        nsd.resolveService(s, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                main.post { resolving = false; resolveNext() }
            }
            override fun onServiceResolved(info: NsdServiceInfo) {
                // IPv6 는 건너뛰고 IPv4 를 쓴다(아이폰 앱과 같다)
                val h = (info.host as? Inet4Address)?.hostAddress
                main.post {
                    resolving = false
                    if (h != null && h !in known && h !in hosts) {
                        hosts += h
                        onHosts(hosts.toList())
                    }
                    resolveNext()
                }
            }
        })
    }
}
