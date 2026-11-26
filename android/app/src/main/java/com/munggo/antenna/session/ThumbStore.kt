package com.munggo.antenna.session

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File
import java.security.MessageDigest

/**
 * 말풍선·답 속 사진 썸네일 저장소(아이폰 앱의 ThumbStore 와 같다). 폰에 저장해 두고, 없으면 맥에서 받아 온다(브리지 thumb 요청)
 */
class ThumbStore(context: Context) {
    enum class Size(val raw: String) { Small("small"), Large("large"), Full("full") }

    private val dir = File(context.cacheDir, "thumbs").apply { mkdirs() }
    private val images = mutableStateMapOf<String, ImageBitmap>()
    /** 맥에 없다고 확인된 사진(읽은 사진이 기록에 없을 때 등) → 자리를 비워 두지 않고 숨김 */
    private val missing = mutableStateMapOf<String, Boolean>()
    /** 맥이 그림을 주지 못한 까닭(키: 경로) */
    val errors = mutableStateMapOf<String, String>()
    private val requested = HashSet<String>()
    /** 전체 화면으로 보고 있는 사진 */
    var viewing by mutableStateOf<String?>(null)
    /** 맥에 썸네일을 요청하는 함수(세션이 연결) */
    var fetch: ((path: String, size: Size) -> Unit)? = null

    private fun key(path: String, size: Size): String {
        // 맥의 일반 그림은 폴더가 달라도 이름이 같을 수 있어 경로 전체로 가른다
        if (!isMacFile(path)) return "${path.substringAfterLast('/')}|${size.raw}"
        val digest = MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).take(10).joinToString("") { "%02x".format(it) }
        return "mac-$digest|${size.raw}"
    }

    private fun file(key: String) = File(dir, key.replace("|", "-") + ".jpg")

    /** 받아 둔 그림(그리는 중에 부름: 읽기만). 큰 그림이 없으면 작은 그림이라도 */
    fun image(path: String, size: Size): ImageBitmap? =
        images[key(path, size)] ?: if (size == Size.Large) images[key(path, Size.Small)] else null

    /** 화면에 처음 보일 때(그리기 밖에서 부름): 폰에 저장돼 있으면 읽고, 없으면 맥에 한 번만 요청 */
    fun request(path: String, size: Size) {
        val k = key(path, size)
        if (images.containsKey(k)) return
        val f = file(k)
        if (f.exists()) {
            BitmapFactory.decodeFile(f.path)?.asImageBitmap()?.let { images[k] = it; return }
        }
        if (k in requested) return
        requested += k
        fetch?.invoke(path, size)
    }

    fun store(path: String, size: Size, data: ByteArray) {
        val k = key(path, size)
        runCatching { file(k).writeBytes(data) }
        BitmapFactory.decodeByteArray(data, 0, data.size)?.asImageBitmap()?.let { images[k] = it }
        errors.remove(path)
    }

    fun fail(path: String, size: Size, why: String) {
        requested -= key(path, size)
        errors[path] = why
    }

    /** 요청 실패(연결 끊김 등) → 나중에 다시 요청할 수 있게 */
    fun forget(path: String, size: Size) { requested -= key(path, size) }
    fun markMissing(path: String) { missing[path] = true }
    fun isMissing(path: String) = missing[path] == true

    companion object {
        /** 맥의 일반 그림 파일인지(폰에서 올린 사진·도구가 읽은 사진이 아닌 것). 맥 브리지의 makeThumb 와 같은 가름 */
        fun isMacFile(path: String): Boolean {
            val name = path.substringAfterLast('/')
            if (name.startsWith("toolimg-")) return false
            val uploaded = Regex("^img-\\d+\\.(?:jpe?g|png)$", RegexOption.IGNORE_CASE).matches(name)
            return !(uploaded && (!path.contains('/') || path.substringBeforeLast('/').endsWith("/.cache/pi-remote")))
        }
    }
}
