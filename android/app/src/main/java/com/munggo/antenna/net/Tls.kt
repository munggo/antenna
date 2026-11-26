package com.munggo.antenna.net

import okhttp3.OkHttpClient
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * 맥의 인증서를 지문으로 확인한다(지문 고정, 아이폰 앱의 TLSPin 과 같다).
 * 브리지는 맥마다 만든 자체 인증서를 쓰므로 인증 기관으로는 확인할 수 없다. 대신 짝짓기 QR 로 받은 지문과 같은 인증서일 때만 믿는다.
 * 같은 망의 다른 기기가 맥인 척하면 지문이 달라 연결하지 않는다.
 */
object Tls {
    /** 인증서 DER 의 SHA-256, 16진수 소문자 64자 */
    fun fingerprint(cert: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }

    class PinnedTrust(private val expected: String) : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw CertificateException("클라이언트 인증서는 쓰지 않음")
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val leaf = chain?.firstOrNull() ?: throw CertificateException("인증서 없음")
            if (expected.isEmpty() || fingerprint(leaf) != expected.lowercase()) throw CertificateException("맥 인증서 지문이 달라요")
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private val base: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)   // 안 닿는 후보는 8초 안에 실패시켜 빠르게 전환
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)    // 답이 없으면 끊긴 것으로 보고 다시 연결
            .build()
    }

    /** 지문이 있으면 그 맥만 믿는 연결, 없으면 암호화 없는 예전 방식에 쓰는 기본 연결 */
    fun client(fingerprint: String): OkHttpClient {
        if (fingerprint.isEmpty()) return base
        val trust = PinnedTrust(fingerprint)
        val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
        // 맥 인증서의 이름은 주소와 맞지 않는다(IP·VPN 주소로 붙음). 지문으로 이미 확인했으므로 이름은 보지 않는다
        return base.newBuilder().sslSocketFactory(ssl.socketFactory, trust).hostnameVerifier { _, _ -> true }.build()
    }
}
