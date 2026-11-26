package com.munggo.antenna.ui.input

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream

/**
 * 보낼 사진을 긴 변 최대 2048px JPEG 로 줄인다(아이폰 앱의 ImageShrink 와 같은 크기).
 * 어떤 형식이든 읽고(HEIC 포함, 안드로이드 9 이상은 회전 정보도 반영), 원본을 통째로 펼치지 않고 줄인 크기로 바로 읽는다
 */
object ImageShrink {
    const val MAX_PIXEL = 2048

    fun decode(context: Context, uri: Uri, maxPixel: Int): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                val w = info.size.width; val h = info.size.height
                val scale = minOf(1.0, maxPixel.toDouble() / maxOf(w, h))
                decoder.setTargetSize(maxOf(1, (w * scale).toInt()), maxOf(1, (h * scale).toInt()))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPixel) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            val b = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
            scaled(b, maxPixel)
        }
    }.getOrNull()

    fun scaled(b: Bitmap, maxPixel: Int): Bitmap {
        val longest = maxOf(b.width, b.height)
        if (longest <= maxPixel) return b
        val s = maxPixel.toDouble() / longest
        return Bitmap.createScaledBitmap(b, maxOf(1, (b.width * s).toInt()), maxOf(1, (b.height * s).toInt()), true)
    }

    fun jpeg(b: Bitmap, quality: Int): ByteArray = ByteArrayOutputStream().use { b.compress(Bitmap.CompressFormat.JPEG, quality, it); it.toByteArray() }
}
