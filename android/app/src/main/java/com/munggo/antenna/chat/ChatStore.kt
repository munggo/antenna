package com.munggo.antenna.chat

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.munggo.antenna.model.ApprovalItem
import com.munggo.antenna.model.BgJob
import com.munggo.antenna.model.ChatEvent
import com.munggo.antenna.model.ChatMessage
import com.munggo.antenna.model.ContextInfo
import com.munggo.antenna.model.FileSuggestion
import com.munggo.antenna.model.ModelChoice
import com.munggo.antenna.model.QueueItem
import com.munggo.antenna.model.QuestionItem
import com.munggo.antenna.model.SlashCommand
import com.munggo.antenna.model.TodoItem
import com.munggo.antenna.model.ToolDetail

/** 보내자마자 화면에 먼저 띄우는 내 메시지. 에이전트가 실제로 대화에 넣으면 사라지고 진짜 말풍선으로 바뀐다 */
data class PendingMessage(val id: String, val text: String, val mode: String?, val window: Int?)

/** 입력창이 쓰는 값(명령 목록·컨텍스트 사용량·카드). 대화 내용과 따로 둬서 답이 흘러나오는 동안 입력창이 다시 그려지지 않게 한다 */
class ChatMeta {
    var commands by mutableStateOf(listOf<SlashCommand>())
    var context by mutableStateOf<ContextInfo?>(null)
    /** 이 탭의 에이전트 이름: "pi" | "Claude" */
    var agentName by mutableStateOf("pi")
    var modelChoices by mutableStateOf(listOf<ModelChoice>())
    /** 맥 pi 가 예전 확장으로 돌고 있음 */
    var outdated by mutableStateOf(false)
    var approvals by mutableStateOf(listOf<ApprovalItem>())
    var questions by mutableStateOf(listOf<QuestionItem>())
    var todos by mutableStateOf(listOf<TodoItem>())
    var planMode by mutableStateOf(false)
    /** 권한 모드: auto | ask | plan */
    var permMode by mutableStateOf("auto")
    /** 되감은 뒤 입력창에 넣을 글 */
    var prefill by mutableStateOf<String?>(null)
    var files by mutableStateOf(listOf<FileSuggestion>())
    var filesQuery by mutableStateOf<String?>(null)
    var filesLoading by mutableStateOf(false)
    var filesError by mutableStateOf<String?>(null)
    var requestedFilesQuery: String? = null
    var bgJobs by mutableStateOf<List<BgJob>?>(null)
    var bgJobsWindow by mutableStateOf<Int?>(null)
    var bgJobsError by mutableStateOf<String?>(null)

    companion object {
        /** 이 앱이 쓰는 기능이 들어간 맥 확장의 판 */
        const val NEEDED_VERSION = 3
    }
}

/** 폰이 들고 있는 대화. 피드 이벤트를 차례로 적용한다(메인 스레드에서만 부른다). 아이폰 앱의 ChatStore 와 같다 */
class ChatStore {
    private val main = Handler(Looper.getMainLooper())

    var items by mutableStateOf(listOf<ChatItem>()); private set
    /** 대화 속 사진(내가 보낸 사진 + 답 속 그림)을 순서대로. 전체 화면에서 넘길 때 쓴다 */
    var imagePaths: List<String> = emptyList(); private set
    var pending by mutableStateOf(listOf<PendingMessage>()); private set
    /** 지금 보고 있는 탭(tmux 창 번호). 대기 말풍선은 보낸 탭에서만 보인다 */
    var window by mutableStateOf<Int?>(null); private set
    val visiblePending: List<PendingMessage> get() = pending.filter { it.window == window }
    var queue by mutableStateOf(listOf<QueueItem>()); private set
    var details by mutableStateOf(mapOf<String, ToolDetail>()); private set
    val meta = ChatMeta()
    var compacting by mutableStateOf(false); private set
    var compactingSince by mutableStateOf<Long?>(null); private set
    var notice by mutableStateOf<String?>(null); private set
    private var noticeSeq = 0
    private var pendingSeq = 0
    var messages by mutableStateOf(listOf<ChatMessage>()); private set
    var truncated by mutableStateOf(0); private set
    var toolStates by mutableStateOf(mapOf<String, String>()); private set
    /** 내용이 바뀔 때마다 늘어남 → 채팅 화면이 맨 아래를 따라가는 신호 */
    var version by mutableStateOf(0); private set
    /** 내가 보낼 때마다 늘어남 → 채팅 화면을 맨 아래로(보내면 최신으로) */
    var sentCount by mutableStateOf(0); private set
    /** 대화 전체를 새로 받을 때마다 늘어남 → 채팅 화면을 맨 아래로 다시 맞춤 */
    var snapshotCount by mutableStateOf(0); private set
    /** 긴 대화는 최근 것부터 그리고, 맨 위 '이전 대화 더 보기'로 더 그린다 */
    var firstShown by mutableStateOf(0); private set
    private var resetShown = false

    var available by mutableStateOf(false); private set
    var working by mutableStateOf(false); private set
    /** 이번 작업이 시작된 시각(ms, 경과 시간용) */
    var workingSince by mutableStateOf<Long?>(null); private set
    /** 도구가 읽은 사진을 받았을 때(세션이 썸네일 저장소에 넣는다) */
    var onToolImage: ((id: String, data: String?, error: String?) -> Unit)? = null

    fun showMore() { firstShown = maxOf(0, firstShown - MORE_DRAW) }

    fun apply(e: ChatEvent) {
        when (e.t) {
            "snapshot" -> {
                messages = e.messages ?: emptyList()
                resetShown = true
                meta.agentName = if (e.agent == "claude") "Claude" else "pi"
                meta.modelChoices = e.modelChoices ?: emptyList()
                truncated = e.truncated ?: 0
                toolStates = emptyMap()
                queue = e.queue ?: emptyList()
                e.notice?.takeIf { it.isNotEmpty() }?.let { showNotice(it) }
                meta.context = e.context
                val approvals = e.approvals ?: emptyList()
                if (meta.approvals != approvals) meta.approvals = approvals
                val questions = e.questions ?: emptyList()
                if (meta.questions != questions) meta.questions = questions
                e.planMode?.let { if (meta.planMode != it) meta.planMode = it }
                val pm = e.permMode ?: if (e.planMode == true) "plan" else "auto"
                if (meta.permMode != pm) meta.permMode = pm
                val todos = e.todos ?: emptyList()
                if (meta.todos != todos) meta.todos = todos
                val old = (e.v ?: 1) < ChatMeta.NEEDED_VERSION
                if (meta.outdated != old) meta.outdated = old
                setCompacting(e.compacting ?: false, e.compactSince)
                for (m in messages.takeLast(30)) if (m.role == "user") matchPending(m.text ?: "")
                for (q in queue) matchPending(q.text)
                snapshotCount += 1
                setState(true, e.working ?: false, e.since)
                // 다른 탭에 가 있는 동안 이 탭 작업이 끝났으면 남은 대기 말풍선 정리
                if (e.working != true) clearLeftoverPending(2000)
            }
            "upsert" -> {
                val m = e.message ?: return
                val i = messages.indexOfLast { it.id == m.id }
                messages = if (i >= 0) messages.toMutableList().also { it[i] = m } else messages + m
                if (m.role == "user") matchPending(m.text ?: "")
                if (!available) setState(true, working)
            }
            "tool" -> {
                val id = e.id; val s = e.state
                if (id != null && s != null) toolStates = toolStates + (id to s)
            }
            "notice" -> e.text?.takeIf { it.isNotEmpty() }?.let { showNotice(it) }
            "commands" -> { meta.commands = e.commands ?: emptyList(); return }
            "approval" -> {
                val a = e.item ?: return
                if (meta.approvals.none { it.id == a.id }) meta.approvals = meta.approvals + a
                return
            }
            "approval-update" -> {
                val id = e.id ?: return
                meta.approvals = meta.approvals.map {
                    if (it.id != id) it
                    else it.copy(summary = e.summary, headline = e.headline, risk = e.risk?.takeIf { r -> r.isNotEmpty() } ?: it.risk, summarizing = e.summarizing)
                }
            }
            "approval-done" -> { e.id?.let { id -> meta.approvals = meta.approvals.filter { it.id != id } }; return }
            "question" -> {
                val q = e.question ?: return
                if (meta.questions.none { it.id == q.id }) meta.questions = meta.questions + q
                return
            }
            "question-done" -> { e.id?.let { id -> meta.questions = meta.questions.filter { it.id != id } }; return }
            "bg-jobs" -> {
                meta.bgJobs = e.jobs ?: emptyList()
                meta.bgJobsWindow = e.window
                meta.bgJobsError = e.error
                return
            }
            "files" -> {
                val q = e.query
                if (q == null || q != meta.requestedFilesQuery) return
                meta.files = e.files ?: emptyList()
                meta.filesQuery = q
                meta.filesError = e.error
                meta.filesLoading = false
                return
            }
            "planmode" -> { meta.planMode = e.on ?: false; return }
            "permmode" -> { meta.permMode = e.mode ?: "auto"; return }
            "rewound" -> { meta.prefill = e.text ?: ""; return }
            "todos" -> {
                val list = e.todos ?: emptyList()
                if (meta.todos != list) meta.todos = list
                return
            }
            "context" -> { if (meta.context != e.context) meta.context = e.context; return }
            "compacting" -> { setCompacting(e.value ?: false, e.since); return }
            "detail" -> { e.detail?.let { details = details + (it.key to it) }; return }
            "toolimage" -> { e.id?.let { onToolImage?.invoke(it, e.data, e.error) }; return }
            "queue" -> {
                queue = e.items ?: emptyList()
                for (q in queue) matchPending(q.text)
            }
            "working" -> {
                val w = e.value ?: false
                setState(available, w, e.since)
                if (!w) clearLeftoverPending(2000)
            }
            "unavailable" -> {
                setState(false, false)
                meta.context = null
                meta.outdated = false
                meta.approvals = emptyList()
                meta.questions = emptyList()
                meta.todos = emptyList()   // 대화 피드가 없는 탭(셸 등)에 앞 탭의 할 일이 남지 않게
                setCompacting(false)
            }
            else -> return
        }
        rebuild()
    }

    /** 이 도구의 결과가 이미 왔는지(안 왔고 작업 중이면 아직 실행 중) */
    fun hasResult(callId: String) = messages.any { it.role == "toolResult" && it.toolCallId == callId }

    /** 이 생각 단계가 지금 쓰이는 중인지(작업 중인 마지막 답의 마지막 블록) */
    fun isLiveThinking(stepId: String): Boolean {
        val last = messages.lastOrNull() ?: return false
        val blocks = last.blocks ?: return false
        if (!working || last.role != "assistant" || last.stop != "pending" || blocks.lastOrNull()?.type != "thinking") return false
        return stepId == "think-${last.id}-${blocks.size - 1}"
    }

    private fun setCompacting(v: Boolean, since: Double? = null) {
        if (v) {
            if (since != null) compactingSince = since.toLong()
            else if (!compacting) compactingSince = System.currentTimeMillis()
        } else compactingSince = null
        if (compacting != v) compacting = v
    }

    fun showNotice(text: String) {
        noticeSeq += 1
        val seq = noticeSeq
        notice = text
        main.postDelayed({ if (noticeSeq == seq) notice = null }, 5000)
    }

    /** 보낸 즉시 화면에 내 말풍선을 띄운다. 작업 중이면 '전송 대기'로 */
    fun addPending(text: String, mode: String?) {
        pendingSeq += 1
        val p = PendingMessage("pending-$pendingSeq", text, mode, window)
        pending = pending + p
        sentCount += 1
        if (mode == null) {
            // 쉬는 중에 보낸 건 곧 대화에 들어온다. 10초 넘게 안 들어오면 정리
            main.postDelayed({
                if (pending.any { it.id == p.id }) { pending = pending.filter { it.id != p.id }; rebuild() }
            }, 10_000)
        }
        rebuild()
    }

    /** 에이전트가 대화에 넣은 내 메시지와 같은 글이면 대기 말풍선을 지운다(사진 경로 등이 앞에 붙을 수 있어 포함 여부로 비교) */
    private fun matchPending(userText: String) {
        val t = userText.trim()
        val i = pending.indexOfFirst { it.window == window && t.contains(it.text.trim()) }
        if (i >= 0) pending = pending.toMutableList().also { it.removeAt(i) }
    }

    /** 작업이 끝났는데도 안 들어온 대기 메시지는 정리 */
    private fun clearLeftoverPending(afterMs: Long) {
        val w = window
        main.postDelayed({
            if (!working && window == w && pending.any { it.window == w }) {
                pending = pending.filter { it.window != w }
                rebuild()
            }
        }, afterMs)
    }

    /** 지금 보는 탭이 바뀌면 대기 말풍선을 그 탭 것만 보이게 */
    fun showWindow(w: Int?) {
        if (w == window) return
        window = w
        rebuild()
    }

    private fun rebuild() {
        items = ChatItemBuilder.build(messages, truncated, toolStates, working)
        if (resetShown) {
            resetShown = false
            firstShown = maxOf(0, items.size - FIRST_DRAW)
        }
        imagePaths = collectImages(messages)
        version += 1
    }

    /** 연결이 끊겨도 채팅 화면은 그대로 둔다. 작업 중 표시만 끈다 */
    fun markDisconnected() = setState(available, false)

    private fun setState(a: Boolean, w: Boolean, since: Double? = null) {
        if (w) {
            if (since != null) workingSince = since.toLong()
            else if (!working) workingSince = System.currentTimeMillis()
        } else workingSince = null
        available = a
        working = w
    }

    companion object {
        const val FIRST_DRAW = 40
        const val MORE_DRAW = 60

        /** 사진 보기에서 넘길 목록(대화 순서): 내가 보낸 사진, 답 속 사진, 에이전트가 읽은 사진(toolimg-<id>) */
        fun collectImages(messages: List<ChatMessage>): List<String> {
            val done = messages.filter { it.role == "toolResult" && it.isError != true }.mapNotNull { it.toolCallId }.toSet()
            val out = LinkedHashSet<String>()
            for (m in messages) {
                if (m.role == "user") out += ImageTokens.split(m.text ?: "").first
                else if (m.role == "assistant") for (b in m.blocks ?: emptyList()) {
                    if (b.type == "text") out += Markdown.imagePaths(b.text ?: "")
                    else if (b.type == "tool" && b.image == true && b.id != null && b.id in done) out += "toolimg-${b.id}"
                }
            }
            return out.toList()
        }
    }
}

/** 글 속 사진 경로(@…/.cache/pi-remote/img-숫자.jpg, ![](…))를 찾아 그림으로 바꿔 보여 주기 위한 도구 */
object ImageTokens {
    private const val PATH = """/[^\s()]*?/\.cache/pi-remote/img-\d+\.(?:jpe?g|png)"""
    private val token = Regex("""(?:!\[[^\]]*\]\(($PATH)\)|@($PATH))\s*""")
    /** 에이전트가 사진을 받으면 모델에게 알려 주려고 덧붙이는 크기 안내 → 말풍선에선 숨김 */
    private val piImageNote = Regex("""\s*\[Image: original \d+x\d+, displayed at \d+x\d+\.[^\]]*\]""")

    /** 글에서 사진 경로를 뽑고, 경로를 지운 나머지 글을 돌려준다 */
    fun split(text: String): Pair<List<String>, String> {
        val paths = LinkedHashSet<String>()
        for (m in token.findAll(text)) {
            m.groups[1]?.value?.let { paths += it }
            m.groups[2]?.value?.let { paths += it }
        }
        val rest = piImageNote.replace(token.replace(text, ""), "")
        return paths.toList() to rest.trim()
    }
}
