package com.munggo.antenna.chat

import com.munggo.antenna.model.ArtifactRef
import com.munggo.antenna.model.ChangeStats
import com.munggo.antenna.model.ChatMessage
import com.munggo.antenna.tr

/** 단계 하나(도구 호출 또는 생각) */
data class ToolCallInfo(
    val id: String,
    val name: String,           // 도구 이름(생각이면 "thinking")
    val summary: String,
    val desc: String,           // 한 줄 설명(생각이면 첫 줄 미리보기)
    val output: String?,
    val state: String,          // running | done | error | pending
    val stats: ChangeStats? = null,
    val image: Boolean = false, // 사진 파일을 읽은 단계
    val thinking: Boolean = false,
    val ref: String? = null,    // 생각 위치(상세 요청용)
    val answer: String? = null, // 고르는 질문의 답
    val artifact: ArtifactRef? = null,
)

/** 채팅 화면에 그릴 항목 */
sealed class ChatItem {
    abstract val id: String

    data class Truncated(val n: Int) : ChatItem() { override val id get() = "truncated" }
    data class User(val m: ChatMessage) : ChatItem() { override val id get() = m.id }
    data class Text(override val id: String, val text: String) : ChatItem()
    /** 도구 사이의 짧은 진행 설명(Claude Code 가 줄여서 준 글) */
    data class Progress(override val id: String, val text: String) : ChatItem()
    data class Tools(override val id: String, val calls: List<ToolCallInfo>) : ChatItem()
    data class Bash(val m: ChatMessage) : ChatItem() { override val id get() = m.id }
    data class Summary(val m: ChatMessage) : ChatItem() { override val id get() = m.id }
    data class Notice(override val id: String, val text: String, val isError: Boolean) : ChatItem()
    /** 답변이 끝난 자리의 복사 단추 */
    data class Copy(override val id: String, val text: String) : ChatItem()
}

/** 메시지 목록 → 화면 항목(아이폰 앱의 ChatItemBuilder 와 같은 규칙). 이어지는 도구 호출은 하나로 묶고, 도구 결과는 그 호출에 붙인다 */
object ChatItemBuilder {
    fun build(messages: List<ChatMessage>, truncated: Int, toolStates: Map<String, String>, working: Boolean): List<ChatItem> {
        val results = HashMap<String, ChatMessage>()
        for (m in messages) if (m.role == "toolResult") m.toolCallId?.let { results[it] = m }

        val items = ArrayList<ChatItem>()
        if (truncated > 0) items += ChatItem.Truncated(truncated)
        var group = ArrayList<ToolCallInfo>()
        var groupId = ""
        fun flush() {
            if (group.isNotEmpty()) { items += ChatItem.Tools(groupId, group); group = ArrayList() }
        }
        // 생각은 따로 줄을 만들지 않고 다음 도구 묶음의 단계로 넣는다. 도구로 이어지지 않은 생각만 그 자리에 '생각함' 줄로
        var pendingThinking = ArrayList<ToolCallInfo>()
        var pendingAt = 0
        fun flushThinking() {
            if (pendingThinking.isNotEmpty()) {
                items.add(minOf(pendingAt, items.size), ChatItem.Tools(pendingThinking[0].id, pendingThinking))
                pendingThinking = ArrayList()
            }
        }
        // 한 번의 답변(내 메시지와 다음 내 메시지 사이)의 글을 모아, 끝난 답변 아래에 복사 단추를 둔다
        val turnTexts = ArrayList<String>()
        var turnId = ""
        fun flushTurn() {
            if (turnTexts.isNotEmpty()) items += ChatItem.Copy("copy-$turnId", turnTexts.joinToString("\n\n"))
            turnTexts.clear()
        }

        for (m in messages) {
            when (m.role) {
                "user" -> { flush(); flushThinking(); flushTurn(); items += ChatItem.User(m) }
                "assistant" -> {
                    val blocks = m.blocks ?: emptyList()
                    blocks.forEachIndexed { i, b ->
                        when (b.type) {
                            "text" -> {
                                val t = (b.text ?: "").trim()
                                if (t.isNotEmpty()) {
                                    flush()
                                    if (b.update == true) items += ChatItem.Progress("${m.id}-$i", t)
                                    else {
                                        items += ChatItem.Text("${m.id}-$i", t)
                                        turnTexts += t
                                        turnId = m.id
                                    }
                                }
                            }
                            "tool" -> {
                                val callId = b.id ?: "${m.id}-$i"
                                val result = results[callId]
                                val state = when {
                                    result != null -> if (result.isError == true) "error" else "done"
                                    toolStates[callId] != null -> toolStates[callId]!!
                                    else -> if (working) "pending" else "done"
                                }
                                if (group.isEmpty()) {
                                    group = pendingThinking   // 앞선 생각을 이 묶음의 첫 단계로
                                    pendingThinking = ArrayList()
                                    groupId = group.firstOrNull()?.id ?: callId
                                }
                                group += ToolCallInfo(
                                    id = callId, name = b.name ?: tr("도구", "Tool"), summary = b.summary ?: "", desc = b.desc ?: "",
                                    output = result?.output, state = state, stats = b.stats, image = b.image ?: false,
                                    answer = result?.answer, artifact = result?.artifact,
                                )
                            }
                            "thinking" -> {
                                val step = ToolCallInfo(
                                    id = "think-${m.id}-$i", name = "thinking", summary = "", desc = b.desc ?: "",
                                    output = null, state = "done", thinking = true, ref = b.ref,
                                )
                                if (group.isNotEmpty()) group += step
                                else {
                                    if (pendingThinking.isEmpty()) pendingAt = items.size
                                    pendingThinking += step
                                }
                            }
                        }
                    }
                    if (m.stop == "error" && !m.error.isNullOrEmpty()) {
                        flush(); items += ChatItem.Notice("${m.id}-err", tr("오류: ${m.error}", "Error: ${m.error}"), true)
                    } else if (m.stop == "aborted") {
                        flush(); items += ChatItem.Notice("${m.id}-abort", tr("중단됨", "Interrupted"), false)
                    }
                }
                "bash" -> { flush(); flushThinking(); items += ChatItem.Bash(m) }
                "summary" -> { flush(); flushThinking(); items += ChatItem.Summary(m) }
            }
        }
        flush()
        // 작업 중이면 마지막 생각은 아직 다음 도구 묶음에 들어갈 수 있으니 보류(하단 '생각 중' 줄이 대신 보여줌)
        if (!working) {
            flushThinking()
            flushTurn()
        }
        return items
    }
}

/** 단계 문구(아이폰 앱의 StepText 와 같다) */
object StepText {
    fun verb(s: ToolCallInfo): String {
        if (s.thinking) return tr("생각함", "Thought")
        return when (s.name) {
            "bash" -> tr("실행됨", "Ran")
            "read" -> tr("읽음", "Read")
            "edit" -> tr("수정됨", "Edited")
            "write" -> tr("작성됨", "Wrote")
            "grep" -> tr("검색함", "Searched")
            "find" -> tr("찾음", "Found")
            "ls" -> tr("확인함", "Checked")
            "subagent" -> tr("맡김", "Delegated")
            "ask_user" -> tr("물어봄", "Asked")
            "show_artifact" -> tr("아티팩트", "Artifact")
            "todo_write" -> tr("할 일 정리", "Updated to-dos")
            else -> s.name
        }
    }

    fun runningVerb(s: ToolCallInfo): String = when (s.name) {
        "read" -> tr("읽는 중", "Reading")
        "edit" -> tr("수정 중", "Editing")
        "write" -> tr("작성 중", "Writing")
        "grep", "find" -> tr("검색 중", "Searching")
        "subagent" -> tr("맡긴 일 진행 중", "Subtask in progress")
        "ask_user" -> tr("답을 기다리는 중", "Waiting for your answer")
        "show_artifact" -> tr("아티팩트 준비 중", "Preparing artifact")
        "todo_write" -> tr("할 일 정리 중", "Updating to-dos")
        else -> tr("실행 중", "Running")
    }

    fun isFile(s: ToolCallInfo) = s.name in setOf("read", "edit", "write")

    /** 동사 뒤에 붙는 말: 파일이면 파일 이름, 아니면 한 줄 설명(없으면 요약) */
    fun subject(s: ToolCallInfo): String {
        if (isFile(s) && s.summary.isNotEmpty()) return s.summary.substringAfterLast('/')
        if (s.name == "ask_user") return s.answer?.let { "${s.desc} → $it" } ?: s.desc
        if (s.desc.isNotEmpty()) return s.desc
        return s.summary.lineSequence().firstOrNull() ?: ""
    }

    /** 상세 화면 제목 */
    fun title(s: ToolCallInfo): String {
        if (s.thinking) return tr("생각", "Thinking")
        val sub = if (isFile(s)) subject(s) else ""
        return if (sub.isEmpty()) verb(s) else "${verb(s)} $sub"
    }

    /** 단계 목록 창 제목 */
    fun groupTitle(steps: List<ToolCallInfo>): String {
        val tools = steps.filter { !it.thinking }
        if (tools.isEmpty()) return tr("생각", "Thinking")
        if (tools.size == 1) return title(tools[0])
        return groupLabel(tools)
    }

    private fun plural(n: Int, one: String, other: String) = if (n == 1) one else other

    /** "파일 2개 수정함, 명령어 5개 실행함" (처음 나온 순서대로, 파일은 같은 파일을 한 번만 셈) */
    fun groupLabel(tools: List<ToolCallInfo>): String {
        val order = ArrayList<String>()
        val counts = HashMap<String, Int>()
        val files = HashMap<String, MutableSet<String>>()
        for (t in tools) {
            val k = when (t.name) {
                "bash", "read", "edit", "write", "ls", "subagent" -> t.name
                "grep", "find" -> "search"
                "ask_user" -> "ask"
                else -> "other"
            }
            if (k !in counts) order += k
            counts[k] = (counts[k] ?: 0) + 1
            files.getOrPut(k) { HashSet() } += t.summary.ifEmpty { t.id }
        }
        return order.joinToString(", ") { k ->
            val n = counts[k] ?: 0
            val f = files[k]?.size ?: n
            when (k) {
                "bash" -> tr("명령어 ${n}개 실행함", plural(n, "Ran $n command", "Ran $n commands"))
                "read" -> tr("파일 ${f}개 읽음", plural(f, "Read $f file", "Read $f files"))
                "edit" -> tr("파일 ${f}개 수정함", plural(f, "Edited $f file", "Edited $f files"))
                "write" -> tr("파일 ${f}개 작성함", plural(f, "Wrote $f file", "Wrote $f files"))
                "search" -> tr("${n}번 검색함", plural(n, "Searched once", "Searched $n times"))
                "ls" -> tr("폴더 ${f}개 확인함", plural(f, "Checked $f folder", "Checked $f folders"))
                "subagent" -> tr("하위 작업 ${n}개 맡김", plural(n, "Delegated $n subtask", "Delegated $n subtasks"))
                "ask" -> tr("${n}번 물어봄", plural(n, "Asked once", "Asked $n times"))
                else -> tr("도구 ${n}개 사용함", plural(n, "Used $n tool", "Used $n tools"))
            }
        }
    }

    /** 파일 도구들의 늘어난·줄어든 줄 합계(파일 도구가 없으면 null) */
    fun totalStats(tools: List<ToolCallInfo>): ChangeStats? {
        val list = tools.mapNotNull { it.stats }
        if (list.isEmpty()) return null
        return ChangeStats(list.sumOf { it.added }, list.sumOf { it.removed })
    }
}
