package com.munggo.antenna.session

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import com.munggo.antenna.chat.ChatStore
import com.munggo.antenna.model.ChatEnvelope
import com.munggo.antenna.model.MacBattery
import com.munggo.antenna.model.TabTool
import com.munggo.antenna.model.TmuxWindow
import com.munggo.antenna.model.UsageInfo
import com.munggo.antenna.model.WindowsMessage
import com.munggo.antenna.model.json
import com.munggo.antenna.net.ConnectionSettings
import com.munggo.antenna.net.Tls
import com.munggo.antenna.term.TerminalBridge
import com.munggo.antenna.tr
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/** 입력창에 붙인 사진. 고르자마자 칸부터 보이고(받는 중), 줄인 뒤 맥에 미리 올리고, 보낼 때 글과 함께 넣는다 */
data class Attachment(val id: String, val preview: ImageBitmap?, val state: State) {
    sealed class State {
        data object Preparing : State()
        data object Uploading : State()
        data class Ready(val path: String) : State()
        data object Failed : State()
    }
    val path: String? get() = (state as? State.Ready)?.path
}

/**
 * 맥 브리지와의 연결 하나(아이폰 앱의 TerminalSession 과 같다).
 * - 집·밖 후보 주소를 동시에 시도해 먼저 열리는 쪽을 쓰고 나머지는 닫는다
 * - 끊기면 후보들을 다시 시도한다(실패가 이어지면 2→4→8→16→최대 30초)
 * - 터미널 바이트(이진 프레임)는 터미널 보기로, 글 프레임(JSON)은 탭 목록·대화 피드·카드로
 */
class BridgeSession(private val app: Context, val settings: ConnectionSettings) {
    enum class Status { Idle, Connecting, Connected, Closed }

    private val main = Handler(Looper.getMainLooper())

    var status by mutableStateOf(Status.Idle); private set
    var activeHost by mutableStateOf<String?>(null); private set
    var windows by mutableStateOf(listOf<TmuxWindow>()); private set
    var macBattery by mutableStateOf<MacBattery?>(null); private set
    var newTabTools by mutableStateOf(listOf<TabTool>()); private set
    var models by mutableStateOf(listOf<String>()); private set
    var piModel by mutableStateOf(""); private set
    var piThinking by mutableStateOf(""); private set
    var piWorking by mutableStateOf(false); private set
    var pushOnMac by mutableStateOf(false); private set
    var pushDone by mutableStateOf(true); private set
    var pushDoneMinSec by mutableStateOf(3600); private set
    var usage by mutableStateOf<UsageInfo?>(null); private set
    var usageLoading by mutableStateOf(false); private set
    var scrolledUp by mutableStateOf(false)
    val attachments = mutableStateListOf<Attachment>()
    /** 화면 위에 잠깐 띄우는 안내(저장·실패 등) */
    var toast by mutableStateOf<String?>(null); private set
    private var toastSeq = 0

    val thumbs = ThumbStore(app)
    val chat = ChatStore()
    val terminal = TerminalBridge(app) { c, r -> sendResize(c, r) }

    /** 작업 중 여부: 대화 피드가 있으면 그걸(정확), 없으면 화면 읽기 값 */
    val isWorking: Boolean get() = if (chat.available) chat.working else piWorking

    private val activeRef = AtomicReference<WebSocket?>(null)
    private val candidates = mutableListOf<WebSocket>()
    private var discovered = listOf<String>()
    private var shouldReconnect = false
    private var failCount = 0
    private var reconnecting = false
    private var retry: Runnable? = null
    private var terminalVisible = false
    /** 알림을 눌러 연 탭(그 탭이 '지금 탭'이 될 때까지 붙잡아 둔다) */
    var pendingWindow: Int? = null
        set(v) { field = v; pendingSince = null; pendingSentAt = 0; main.post { openPendingWindow() } }
    private var pendingSince: Long? = null
    private var pendingSentAt = 0L
    /** 폰 알림 주소(구글 푸시 토큰). 생기면 맥에 등록 */
    var pushToken: String? = null
        set(v) { field = v; main.post { registerPush() } }

    init {
        thumbs.fetch = { path, size ->
            if (path.startsWith("toolimg-")) {
                // 도구가 읽은 사진: 맥 파일이 아니라 대화 기록에서 꺼내 온다(원본 요청은 큰 그림으로 대신)
                if (size == ThumbStore.Size.Large) sendControl(buildJsonObject { put("type", "toolimage"); put("id", path.removePrefix("toolimg-")) })
            } else sendControl(buildJsonObject { put("type", "thumb"); put("path", path); put("size", size.raw) })
        }
        chat.onToolImage = { id, data, error ->
            val path = "toolimg-$id"
            val bytes = data?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
            when {
                bytes != null -> thumbs.store(path, ThumbStore.Size.Large, bytes)
                (error ?: "").contains("찾지 못") || (error ?: "").contains("not found") -> thumbs.markMissing(path)
                else -> thumbs.forget(path, ThumbStore.Size.Large)
            }
        }
        // 네트워크가 바뀌면(Wi-Fi↔LTE, VPN) 바로 다시 시도
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { main.post { retryNow() } }
        })
    }

    fun say(text: String) {
        toastSeq += 1
        val seq = toastSeq
        toast = text
        main.postDelayed({ if (toastSeq == seq) toast = null }, 3000)
    }

    // MARK: - 연결

    fun connect() {
        shouldReconnect = true
        openCandidates()
    }

    fun disconnect() {
        shouldReconnect = false
        retry?.let { main.removeCallbacks(it) }
        reconnecting = false
        activeRef.getAndSet(null)?.close(1001, null)
        cancelCandidates()
        status = Status.Closed
        activeHost = null
        windows = emptyList()
        chat.markDisconnected()
    }

    /** 같은 Wi-Fi 에서 찾은 주소. 아직 연결 전이면 새 후보를 넣어 다시 시도 */
    fun setDiscovered(hosts: List<String>) {
        discovered = hosts
        if (activeRef.get() == null && shouldReconnect) openCandidates()
    }

    private fun openCandidates() {
        cancelCandidates()
        activeRef.set(null)
        status = Status.Connecting
        val hosts = (discovered + settings.hosts).distinct()
        if (hosts.isEmpty() || !settings.isValid) return   // 찾기·입력 대기(맥을 찾으면 다시 시도)
        val client = Tls.client(settings.fingerprint)
        for (host in hosts) {
            val url = settings.url(host, "/", "cols=${terminal.cols}&rows=${terminal.rows}")
            val req = try {
                Request.Builder().url(url).header("Authorization", "Bearer ${settings.token}").build()
            } catch (e: IllegalArgumentException) { continue }
            candidates += client.newWebSocket(req, Listener(host))
        }
        if (candidates.isEmpty()) scheduleReconnect()
    }

    private fun cancelCandidates() {
        for (c in candidates) if (c !== activeRef.get()) c.cancel()
        candidates.clear()
    }

    /** 다시 연결 예약. 실패가 이어지면 간격을 늘려 배터리를 아낀다 */
    private fun scheduleReconnect() {
        if (!shouldReconnect || reconnecting) return
        reconnecting = true
        status = Status.Connecting
        val delay = minOf(30_000L, 2_000L * (1L shl minOf(failCount, 4)))
        failCount += 1
        val r = Runnable {
            reconnecting = false
            if (shouldReconnect) openCandidates()
        }
        retry = r
        main.postDelayed(r, delay)
    }

    /** 기다리던 다시 연결을 그만두고 바로 시도(연결돼 있으면 아무것도 안 함) */
    fun retryNow() {
        if (!shouldReconnect || activeRef.get() != null) return
        retry?.let { main.removeCallbacks(it) }
        reconnecting = false
        failCount = 0
        openCandidates()
    }

    // 앱이 뒤로 가면 잠시 뒤 끊고(배터리), 앞으로 오면 바로 다시 붙는다. 알림은 구글 푸시가 맡는다
    private var pauseRunnable: Runnable? = null
    private var paused = false

    private var backgroundAt = 0L

    fun onAppBackground() {
        backgroundAt = System.currentTimeMillis()
        val r = Runnable {
            if (!shouldReconnect) return@Runnable
            paused = true
            disconnect()
        }
        pauseRunnable = r
        main.postDelayed(r, 60_000)
    }

    fun onAppForeground() {
        pauseRunnable?.let { main.removeCallbacks(it) }
        pauseRunnable = null
        val away = backgroundAt > 0 && System.currentTimeMillis() - backgroundAt > 20_000
        backgroundAt = 0
        if (paused) {
            paused = false
            connect()
        } else if (away && shouldReconnect && activeRef.get() != null) {
            // 안드로이드가 뒤의 앱을 얼린 동안 끊겼을 수 있는 연결: 끊긴 것을 알아챌 때까지 기다리지 않고 새로 붙는다
            activeRef.getAndSet(null)?.cancel()
            activeHost = null
            chat.markDisconnected()
            retry?.let { main.removeCallbacks(it) }
            reconnecting = false
            failCount = 0
            openCandidates()
        } else retryNow()
    }

    private inner class Listener(private val host: String) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            // 먼저 열린 후보 하나만 쓴다(나머지는 닫음). 받은 바이트보다 먼저 정해야 해서 연결 스레드에서 바로 정한다
            if (!activeRef.compareAndSet(null, webSocket)) { webSocket.close(1001, null); return }
            terminal.reset()
            main.post {
                for (c in candidates) if (c !== webSocket) c.cancel()
                candidates.clear()
                activeHost = host
                status = Status.Connected
                failCount = 0
                sendResize(terminal.cols, terminal.rows)
                if (terminalVisible) sendControl(buildJsonObject { put("type", "view"); put("terminal", true) })
                registerPush()
                openPendingWindow()
            }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (webSocket === activeRef.get()) terminal.feed(bytes.toByteArray())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (webSocket !== activeRef.get()) return
            // 대화 피드는 여기(연결 스레드)서 해석해 화면 스레드 부담을 줄인다
            if (text.startsWith("{\"type\":\"chat\"")) {
                val env = runCatching { json.decodeFromString(ChatEnvelope.serializer(), text) }.getOrNull() ?: return
                main.post { chat.apply(env.d) }
                return
            }
            if (text.startsWith("{\"type\":\"chat-bg\"")) return   // 탭 미리 받기는 쓰지 않음(chat=2 를 보내지 않으므로 오지 않음)
            val obj = if (text.startsWith("{")) runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() else null
            val type = obj?.str("type")
            if (obj == null || type == null) { terminal.feedText(text); return }
            if (type == "usage") {
                val info = runCatching { json.decodeFromString(UsageInfo.serializer(), text) }.getOrNull()
                main.post {
                    usage = info ?: UsageInfo(error = tr("사용량 응답을 해석하지 못했어요", "Couldn't read the usage response"))
                    usageLoading = false
                }
                return
            }
            if (type == "windows") {
                val w = runCatching { json.decodeFromString(WindowsMessage.serializer(), text) }.getOrNull() ?: return
                main.post { receivedWindows(w) }
                return
            }
            main.post { if (!handleControl(type, obj)) terminal.feedText(text) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = ended(webSocket)
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = ended(webSocket)

        private fun ended(webSocket: WebSocket) {
            val wasActive = activeRef.compareAndSet(webSocket, null)
            main.post {
                if (wasActive) {
                    activeHost = null
                    chat.markDisconnected()
                    scheduleReconnect()   // 쓰던 연결이 끊김 → 다시 시도
                } else {
                    candidates.remove(webSocket)
                    if (activeRef.get() == null && candidates.isEmpty()) scheduleReconnect()   // 모든 후보 실패
                }
            }
        }
    }

    private fun receivedWindows(w: WindowsMessage) {
        windows = w.windows
        viewingWindow = w.windows.firstOrNull { it.active }?.index
        val tools = w.newTabTools.mapNotNull { TabTool.of(it) }
        if (newTabTools != tools) newTabTools = tools
        if (macBattery != w.battery) macBattery = w.battery
        chat.showWindow(w.windows.firstOrNull { it.active }?.index)
        openPendingWindow()
    }

    /** 맥이 보낸 제어 메시지. 처리하면 true(터미널 출력 아님) */
    private fun handleControl(type: String, o: JsonObject): Boolean {
        when (type) {
            "push-status" -> {
                pushOnMac = o.bool("enabled") ?: false
                val prefs = o["prefs"] as? JsonObject
                pushDone = prefs?.bool("done") ?: true
                pushDoneMinSec = prefs?.int("doneMinSec") ?: 3600
            }
            "token-rotated" -> {
                val t = o.str("token") ?: return true
                if (Regex("^[0-9a-fA-F]{32,128}$").matches(t)) {
                    settings.token = t
                    say(tr("연결 토큰을 새로 바꿨어요. 곧 다시 연결돼요", "Replaced the connection token. Reconnecting shortly"))
                }
            }
            "pistatus" -> {
                // 빈 값은 브리지가 3초 연속 비었을 때만 보낸다(pi 가 없는 창) → 그대로 반영
                piModel = o.str("model") ?: ""
                piThinking = o.str("thinking") ?: ""
                piWorking = o.bool("working") ?: false
            }
            "image-saved" -> {
                val id = o.str("id") ?: ""
                val path = o.str("path")
                val i = attachments.indexOfFirst { it.id == id }
                if (i >= 0) {
                    val a = attachments[i]
                    attachments[i] = a.copy(state = if (path != null) Attachment.State.Ready(path) else Attachment.State.Failed)
                    // 보낸 뒤 말풍선에 바로 보이도록 미리 보기를 썸네일로 저장
                    if (path != null) previewBytes.remove(id)?.let { thumbs.store(path, ThumbStore.Size.Small, it) }
                }
            }
            "thumb" -> {
                val path = o.str("path") ?: ""
                val size = ThumbStore.Size.entries.firstOrNull { it.raw == o.str("size") } ?: ThumbStore.Size.Small
                val data = o.str("data")?.let { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
                when {
                    data != null -> thumbs.store(path, size, data)
                    ThumbStore.isMacFile(path) -> thumbs.fail(path, size, o.str("error") ?: tr("맥에서 그림을 받지 못했어요", "Couldn't get the image from the Mac"))
                    else -> thumbs.forget(path, size)
                }
            }
            "models" -> models = (o["models"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
            "sessions", "session-opened" -> {}   // 지난 대화 열기는 아직 없음
            else -> return false
        }
        return true
    }

    // MARK: - 보내기

    private fun sendControl(obj: JsonObject) {
        activeRef.get()?.send(obj.toString())
    }

    fun sendBytes(bytes: ByteArray) {
        activeRef.get()?.send(bytes.toByteString())
    }

    private fun sendResize(cols: Int, rows: Int) {
        sendControl(buildJsonObject { put("type", "resize"); put("cols", cols); put("rows", rows) })
    }

    /** 폰에서 터미널 보기를 보고 있는지(브리지가 이때만 tmux 창을 폰 크기로 맞춤) */
    fun setTerminalVisible(on: Boolean) {
        terminalVisible = on
        terminal.setBlink(on && status == Status.Connected)
        sendControl(buildJsonObject { put("type", "view"); put("terminal", on) })
    }

    /**
     * 입력창에서 쓴 글을 맥 입력창에 한 번에 넣는다.
     * 괄호 붙여넣기로 감싸 여러 줄이 중간에 보내지지 않게 하고, 마지막에 Enter
     */
    fun sendText(text: String, submit: Boolean = true) {
        if (text.isEmpty()) return
        val bytes = "\u001b[200~".toByteArray() + text.toByteArray() + "\u001b[201~".toByteArray() + (if (submit) byteArrayOf(0x0d) else byteArrayOf())
        sendBytes(bytes)
        scrolledUp = false
        // 채팅 화면이면 보낸 즉시 내 말풍선을 띄운다(명령 / 와 셸 ! 은 대화 메시지가 아니므로 빼고)
        val t = text.trim()
        if (submit && chat.available && !t.startsWith("/") && !t.startsWith("!")) chat.addPending(t, if (isWorking) "steer" else null)
    }

    /** 관리자 권한 확인 창에 넣는 입력: 글자 그대로와 Enter 만(말풍선·기록 없음) */
    fun sendSecret(text: String) = sendBytes(text.toByteArray() + byteArrayOf(0x0d))

    /** 지금 보는 탭이 관리자 권한 확인 창(🔐sudo)이면 그 단계, 아니면 null */
    val secretStage: String? get() {
        val w = windows.firstOrNull { it.active } ?: return null
        if (!w.name.startsWith("🔐")) return null
        return w.sudo.ifEmpty { "unknown" }
    }

    /**
     * 메시지 보내기. 붙인 사진은 '@경로'로 글 앞에 붙는다.
     * mode: steer(바로 반영) | followUp(끝나고 실행) | interrupt(멈추고 실행). 쉬는 중이면 바로 실행
     */
    fun sendMessage(body: String, mode: String) {
        val paths = attachments.mapNotNull { it.path }
        val text = (paths.map { "@$it" } + listOfNotNull(body.ifEmpty { null })).joinToString(" ")
        if (text.isEmpty()) return
        val isCommand = body.startsWith("/") || body.startsWith("!")
        if (chat.available && !isCommand) {
            sendControl(buildJsonObject {
                put("type", "pi-send"); put("text", text); put("mode", mode)
                put("images", JsonArray(paths.map { JsonPrimitive(it) }))
            })
            chat.addPending(text, if (isWorking) mode else null)
        } else sendText(text)   // 피드가 없거나 /명령·!셸: 맥 입력창에 붙여 넣고 Enter
        attachments.clear()
        scrolledUp = false
    }

    /** 백그라운드로 보내기(브리지가 새 탭을 엶) */
    fun sendBackground(body: String) {
        val paths = attachments.mapNotNull { it.path }
        val text = (paths.map { "@$it" } + listOfNotNull(body.ifEmpty { null })).joinToString(" ")
        if (text.isEmpty()) return
        sendControl(buildJsonObject { put("type", "bg-start"); put("text", text) })
        attachments.clear()
    }

    /** Esc: 실행 중인 작업 멈추기 */
    fun interrupt() = sendBytes(byteArrayOf(0x1b))

    fun selectWindow(index: Int) = sendControl(buildJsonObject { put("type", "select-window"); put("index", index) })
    fun renameWindow(index: Int, name: String) = sendControl(buildJsonObject { put("type", "rename-window"); put("index", index); put("name", name) })
    fun closeWindow(index: Int) = sendControl(buildJsonObject { put("type", "close-window"); put("index", index) })
    fun closeFinishedBackground() = sendControl(buildJsonObject { put("type", "close-finished-bg") })
    fun newWindow(tool: TabTool?) = sendControl(buildJsonObject { put("type", "new-window"); tool?.let { put("agent", it.raw) } })
    fun setModel(id: String) = sendControl(buildJsonObject { put("type", "pi-command"); put("text", "/model $id") })
    fun setThinking(level: String) = sendControl(buildJsonObject { put("type", "pi-command"); put("text", "/thinking $level") })
    fun setPermMode(m: String) = sendControl(buildJsonObject { put("type", "pi-command"); put("text", "/mode $m") })
    fun newConversation() = sendControl(buildJsonObject { put("type", "pi-command"); put("text", "/new") })
    fun reloadPi() = sendControl(buildJsonObject { put("type", "pi-command"); put("text", "/reload") })
    fun compactNow() = sendControl(buildJsonObject { put("type", "compact") })
    fun setAccount(a: String) = sendControl(buildJsonObject { put("type", "set-account"); put("account", a) })
    fun rewind(id: String, text: String) = sendControl(buildJsonObject { put("type", "rewind"); put("id", id); put("text", text) })
    fun requestBgJobs() = sendControl(buildJsonObject { put("type", "bg-jobs") })
    fun killBgJob(id: String) = sendControl(buildJsonObject { put("type", "bg-job-kill"); put("id", id) })
    fun rotateToken() = sendControl(buildJsonObject { put("type", "rotate-token") })

    fun requestUsage(force: Boolean) {
        usageLoading = true
        sendControl(buildJsonObject { put("type", "usage"); put("force", force) })
    }

    /** 단계 상세 요청(도구 id 또는 생각 위치). 답은 대화 피드로 와서 chat.details 에 들어간다 */
    fun requestDetail(key: String, kind: String, id: String, ref: String) =
        sendControl(buildJsonObject { put("type", "detail"); put("key", key); put("kind", kind); put("id", id); put("ref", ref) })

    /** 입력창 '@' 파일 찾기 */
    fun requestFiles(query: String) {
        chat.meta.requestedFilesQuery = query
        chat.meta.filesLoading = true
        sendControl(buildJsonObject { put("type", "files"); put("query", query) })
    }

    /** 승인 카드의 허용·거부. 카드는 바로 내린다 */
    fun answerApproval(id: String, approved: Boolean) {
        sendControl(buildJsonObject { put("type", "approval"); put("id", id); put("approved", approved) })
        chat.meta.approvals = chat.meta.approvals.filter { it.id != id }
    }

    fun answerQuestion(id: String, answers: List<String>, other: String = "", cancel: Boolean = false) {
        sendControl(buildJsonObject {
            put("type", "question-answer"); put("id", id)
            put("answers", JsonArray(answers.map { JsonPrimitive(it) })); put("other", other); put("cancel", cancel)
        })
        chat.meta.questions = chat.meta.questions.filter { it.id != id }
    }

    /** 여러 질문 카드의 답(질문별 answers·other) */
    fun answerQuestions(id: String, items: List<Pair<List<String>, String>>) {
        sendControl(buildJsonObject {
            put("type", "question-answer"); put("id", id); put("answers", JsonArray(emptyList())); put("other", "")
            put("items", JsonArray(items.map { (a, o) ->
                buildJsonObject { put("answers", JsonArray(a.map { JsonPrimitive(it) })); put("other", o) }
            }))
        })
        chat.meta.questions = chat.meta.questions.filter { it.id != id }
    }

    /** 끌기 → 마우스 휠 신호(SGR)로 바꿔 보낸다. tmux·에이전트가 스크롤을 처리한다. up 이면 과거 보기 */
    fun scrollLines(up: Boolean, count: Int) {
        val col = maxOf(1, terminal.cols / 2)
        val row = maxOf(1, terminal.rows / 2)
        val seq = "\u001b[<${if (up) 64 else 65};$col;${row}M"
        sendBytes(seq.repeat(maxOf(1, count)).toByteArray())
        if (up) scrolledUp = true
    }

    /** 맨 아래(최신)로: 휠 다운을 많이 보내 바닥까지 내린다 */
    fun scrollToBottom() {
        scrollLines(false, 120)
        scrolledUp = false
    }

    // MARK: - 폰 알림

    /** 맥 브리지에 이 폰의 알림 주소 등록(연결될 때마다) */
    fun registerPush() {
        val t = pushToken ?: return
        if (status != Status.Connected) return
        sendControl(buildJsonObject { put("type", "push-register"); put("token", t); put("platform", "fcm") })
    }

    /** '작업이 끝났을 때도 알림' 켜기·끄기(질문·승인은 늘 알림) */
    fun changePushDone(on: Boolean) {
        pushDone = on
        sendControl(buildJsonObject { put("type", "push-prefs"); put("done", on) })
    }

    fun sendTestPush() = sendControl(buildJsonObject { put("type", "push-test") })

    /** 알림을 눌러 열었으면 그 탭으로. 30초 안에 못 옮기거나 그 탭이 없으면 그만둔다 */
    private fun openPendingWindow() {
        val w = pendingWindow ?: return
        val now = System.currentTimeMillis()
        val since = pendingSince ?: now.also { pendingSince = it }
        if (now - since > 30_000) { pendingWindow = null; return }
        if (status != Status.Connected || windows.isEmpty()) return
        if (windows.none { it.index == w }) { pendingWindow = null; return }
        if (windows.firstOrNull { it.active }?.index == w) { pendingWindow = null; return }
        if (now - pendingSentAt > 2000) {
            pendingSentAt = now
            selectWindow(w)
        }
    }

    // MARK: - 사진 첨부

    private val previewBytes = HashMap<String, ByteArray>()

    /** 고른 사진의 칸을 먼저 만든다(고르자마자 '받는 중' 칸이 보이게) */
    fun reserveAttachment(): String {
        val id = UUID.randomUUID().toString()
        attachments += Attachment(id, null, Attachment.State.Preparing)
        return id
    }

    /** 줄인 사진을 맥에 미리 올린다(보내기 전까지 에이전트에는 넣지 않음). 45초 안에 답이 없으면 실패로 */
    fun uploadAttachment(id: String, full: ByteArray, preview: ImageBitmap, previewJpeg: ByteArray) {
        val i = attachments.indexOfFirst { it.id == id }
        if (i < 0) return
        attachments[i] = attachments[i].copy(preview = preview, state = Attachment.State.Uploading)
        previewBytes[id] = previewJpeg
        sendControl(buildJsonObject {
            put("type", "image"); put("id", id); put("name", "image.jpg"); put("data", Base64.encodeToString(full, Base64.NO_WRAP))
        })
        main.postDelayed({
            val j = attachments.indexOfFirst { it.id == id }
            if (j >= 0 && attachments[j].state == Attachment.State.Uploading) attachments[j] = attachments[j].copy(state = Attachment.State.Failed)
        }, 45_000)
    }

    fun failAttachment(id: String) {
        val i = attachments.indexOfFirst { it.id == id }
        if (i >= 0) attachments[i] = attachments[i].copy(state = Attachment.State.Failed)
    }

    fun removeAttachment(id: String) {
        attachments.removeAll { it.id == id }
        previewBytes.remove(id)
    }

    companion object {
        /** 지금 보고 있는 탭(알림 서비스가 다른 스레드에서 읽음: 그 탭의 알림은 띄우지 않음) */
        @Volatile var viewingWindow: Int? = null
    }
}

private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.booleanOrNull
private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.intOrNull
