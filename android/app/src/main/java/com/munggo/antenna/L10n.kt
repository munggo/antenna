package com.munggo.antenna

import java.util.Locale

/** 앱 화면 글의 언어: 폰 언어가 한국어면 한국어, 그 밖에는 영어(아이폰 앱과 같다) */
val isKorean: Boolean get() = Locale.getDefault().language == "ko"

/** 두 언어 글 가운데 폰 언어에 맞는 것(맥 브리지의 tr 과 같은 꼴) */
fun tr(ko: String, en: String): String = if (isKorean) ko else en
