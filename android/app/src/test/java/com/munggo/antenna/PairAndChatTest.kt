package com.munggo.antenna

import com.munggo.antenna.chat.ChatItem
import com.munggo.antenna.chat.ChatItemBuilder
import com.munggo.antenna.chat.ImageTokens
import com.munggo.antenna.chat.StepText
import com.munggo.antenna.model.ChatBlock
import com.munggo.antenna.model.ChatEnvelope
import com.munggo.antenna.model.ChatMessage
import com.munggo.antenna.model.json
import com.munggo.antenna.net.PairLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** 짝짓기 링크 읽기(아이폰 앱의 parsePairURL 과 같은 규칙)와 대화를 화면 항목으로 묶기(ChatItemBuilder) */
class PairAndChatTest {
    private val code = "a".repeat(32)
    private val fp = "B".repeat(64)

    @Test fun 지금_방식_링크() {
        val p = PairLink.parse("piremote://pair?code=$code&fp=$fp&host=10.0.0.5&host=mac.local&host=10.0.0.5&port=8797")!!
        assertEquals(code, p.code)
        assertNull("코드가 있으면 토큰은 쓰지 않음", p.token)
        assertEquals("지문은 소문자로", fp.lowercase(), p.fingerprint)
        assertEquals("주소는 여러 개, 같은 것은 한 번", listOf("10.0.0.5", "mac.local"), p.hosts)
        assertEquals("8797", p.port)
    }

    @Test fun 예전_방식_링크() {
        val tok = "0123456789abcdef".repeat(4)
        val p = PairLink.parse("piremote://pair?token=$tok&host=10.1.2.3&port=8787")!!
        assertEquals(tok, p.token)
        assertNull(p.code)
        assertNull("예전 QR 에는 지문이 없음", p.fingerprint)
    }

    @Test fun 틀린_링크는_거절하거나_값을_버림() {
        assertNull("다른 앱의 링크", PairLink.parse("https://example.com/pair?code=$code"))
        assertNull("코드·토큰이 없음", PairLink.parse("piremote://pair?host=10.0.0.5"))
        assertNull("코드 모양이 틀림", PairLink.parse("piremote://pair?code=xyz"))
        assertNull("짝짓기가 아닌 링크", PairLink.parse("piremote://tab/3?code=$code"))
        val p = PairLink.parse("piremote://pair?code=$code&fp=short&host=bad%20host&host=ok.host&port=99999")!!
        assertNull("짧은 지문은 버림", p.fingerprint)
        assertEquals("주소에 쓸 수 없는 글자가 든 것은 버림", listOf("ok.host"), p.hosts)
        assertNull("범위 밖 포트는 버림", p.port)
    }

    private fun tool(id: String, name: String, summary: String = "", desc: String = "") =
        ChatBlock(type = "tool", id = id, name = name, summary = summary, desc = desc)

    @Test fun 도구는_묶고_결과를_붙이고_생각은_다음_묶음으로() {
        Locale.setDefault(Locale.KOREAN)
        val msgs = listOf(
            ChatMessage("u1", "user", text = "고쳐 줘"),
            ChatMessage("a1", "assistant", stop = "toolUse", blocks = listOf(
                ChatBlock(type = "thinking", desc = "생각"),
                tool("t1", "bash", "ls"),
                tool("t2", "edit", "/a/b.md"),
            )),
            ChatMessage("r1", "toolResult", toolCallId = "t1", output = "ok"),
            ChatMessage("r2", "toolResult", toolCallId = "t2", isError = true, output = "실패"),
            ChatMessage("a2", "assistant", stop = "stop", blocks = listOf(
                ChatBlock(type = "text", text = "진행 설명", update = true),
                ChatBlock(type = "text", text = "끝났어요"),
            )),
        )
        val items = ChatItemBuilder.build(msgs, truncated = 3, toolStates = emptyMap(), working = false)
        assertEquals(listOf("Truncated", "User", "Tools", "Progress", "Text", "Copy"), items.map { it::class.simpleName })
        val tools = (items[2] as ChatItem.Tools).calls
        assertEquals("앞선 생각이 묶음의 첫 단계", listOf(true, false, false), tools.map { it.thinking })
        assertEquals(listOf("done", "done", "error"), tools.map { it.state })
        assertEquals("ok", tools[1].output)
        assertEquals("답변 복사에는 답 글만(진행 설명은 빼고)", "끝났어요", (items[5] as ChatItem.Copy).text)
        assertEquals("명령어 1개 실행함, 파일 1개 수정함", StepText.groupLabel(tools.filter { !it.thinking }))
        assertEquals("b.md", StepText.subject(tools[2]))
    }

    @Test fun 작업_중이면_결과_없는_도구는_진행_중이고_복사_단추는_아직() {
        val msgs = listOf(
            ChatMessage("u1", "user", text = "해 줘"),
            ChatMessage("a1", "assistant", stop = "pending", blocks = listOf(ChatBlock(type = "text", text = "하는 중"), tool("t1", "bash", "sleep 9"))),
        )
        val items = ChatItemBuilder.build(msgs, 0, emptyMap(), working = true)
        assertEquals(listOf("User", "Text", "Tools"), items.map { it::class.simpleName })
        assertEquals("pending", (items[2] as ChatItem.Tools).calls[0].state)
        val running = ChatItemBuilder.build(msgs, 0, mapOf("t1" to "running"), working = true)
        assertEquals("맥이 알려 준 단계 상태가 먼저", "running", (running[2] as ChatItem.Tools).calls[0].state)
    }

    @Test fun 오류와_중단() {
        Locale.setDefault(Locale.ENGLISH)
        val items = ChatItemBuilder.build(listOf(
            ChatMessage("a1", "assistant", stop = "error", error = "overloaded", blocks = emptyList()),
            ChatMessage("a2", "assistant", stop = "aborted", blocks = emptyList()),
        ), 0, emptyMap(), false)
        assertEquals(listOf("Error: overloaded", "Interrupted"), items.map { (it as ChatItem.Notice).text })
        assertTrue((items[0] as ChatItem.Notice).isError)
        Locale.setDefault(Locale.KOREAN)
    }

    @Test fun 글_속_사진_경로() {
        val (paths, rest) = ImageTokens.split("@/Users/me/.cache/pi-remote/img-123.jpg 이거 봐 [Image: original 3000x2000, displayed at 2048x1365. x]")
        assertEquals(listOf("/Users/me/.cache/pi-remote/img-123.jpg"), paths)
        assertEquals("이거 봐", rest)
    }

    @Test fun 브리지가_보낸_대화_해석() {
        // 모르는 칸이 있어도, 빠진 칸이 있어도 읽는다(맥 쪽이 새 칸을 더해도 예전 앱이 깨지지 않게)
        val raw = """{"type":"chat","d":{"t":"snapshot","v":3,"agent":"claude","new":1,"messages":[{"id":"u1","role":"user","text":"안녕","extra":{"a":1}}],"approvals":[{"id":"x","label":"보내기"}],"context":{"window":200000,"percent":12.5}}}"""
        val e = json.decodeFromString(ChatEnvelope.serializer(), raw).d
        assertEquals("snapshot", e.t)
        assertEquals("안녕", e.messages!![0].text)
        assertEquals("보내기", e.approvals!![0].label)
        assertEquals("", e.approvals!![0].detail)
        assertEquals("13%", e.context!!.percentText)
    }
}
