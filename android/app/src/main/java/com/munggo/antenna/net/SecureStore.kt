package com.munggo.antenna.net

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 연결 토큰을 폰의 키 저장소(Android Keystore) 키로 잠가 저장한다(아이폰 앱의 키체인 자리).
 * 키는 기기 밖으로 나가지 않고, 앱을 지우면 함께 사라진다.
 */
object SecureStore {
    private const val ALIAS = "antenna-connection"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun put(prefs: SharedPreferences, name: String, value: String) {
        if (value.isEmpty()) {
            prefs.edit().remove(name).apply()
            return
        }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val box = c.iv + c.doFinal(value.toByteArray())
        prefs.edit().putString(name, Base64.encodeToString(box, Base64.NO_WRAP)).apply()
    }

    fun get(prefs: SharedPreferences, name: String): String {
        val raw = prefs.getString(name, null) ?: return ""
        return try {
            val box = Base64.decode(raw, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, box, 0, 12))
            String(c.doFinal(box, 12, box.size - 12))
        } catch (e: Exception) {
            "" // 키가 바뀌었거나(앱 데이터 복원 등) 깨짐 → 다시 짝지어야 함
        }
    }
}
