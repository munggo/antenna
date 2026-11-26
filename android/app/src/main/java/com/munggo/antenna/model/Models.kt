package com.munggo.antenna.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// 맥 브리지가 보내는 자료. 모양은 아이폰 앱(ios/PiRemote/ChatModels.swift 등)과 같다.
// 대화 피드는 브리지가 {"type":"chat","d":<이벤트>} 로 감싸 보낸다.

/** 모르는 칸은 넘기고, 빈 값은 기본값으로 */
val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
}

/** 파일 도구가 바꾼 줄 수 */
@Serializable
data class ChangeStats(val added: Int = 0, val removed: Int = 0)

/** 단계 하나의 상세(눌렀을 때 맥에서 받아 옴) */
@Serializable
data class ToolDetail(
    val key: String,
    val kind: String? = null,       // bash | edit | write | read | thinking | other
    val command: String? = null,
    val path: String? = null,
    val edits: List<EditPair>? = null,
    val content: String? = null,
    val output: String? = null,
    val isError: Boolean? = null,
    val done: Boolean? = null,
    val text: String? = null,       // 생각 내용
    val title: String? = null,
    val args: String? = null,
    val error: String? = null,
) {
    @Serializable
    data class EditPair(val old: String = "", val new: String = "")
}

@Serializable
data class ChatBlock(
    val type: String,               // text | thinking | tool
    val text: String? = null,
    val id: String? = null,         // tool 호출 id
    val name: String? = null,       // tool 이름
    val summary: String? = null,    // tool 인자 한 줄 요약
    val desc: String? = null,       // 무엇을 하는지 한 줄 설명
    val stats: ChangeStats? = null,
    val ref: String? = null,        // 생각 블록 위치(상세 요청용)
    val image: Boolean? = null,     // 사진 파일을 읽은 단계
    val update: Boolean? = null,    // 도구를 부르기 전의 짧은 진행 설명
)

@Serializable
data class ArtifactRef(
    val path: String,
    val title: String = "",
    val kind: String = "",
    val size: Int? = null,
    val description: String? = null,
)

@Serializable
data class ChatMessage(
    val id: String,
    val role: String,               // user | assistant | toolResult | bash | summary
    val text: String? = null,
    val images: Int? = null,
    val blocks: List<ChatBlock>? = null,
    val stop: String? = null,       // pending(스트리밍 중) | stop | toolUse | error | aborted ...
    val error: String? = null,
    val toolCallId: String? = null,
    val isError: Boolean? = null,
    val output: String? = null,
    val answer: String? = null,     // 고르는 질문의 답
    val artifact: ArtifactRef? = null,
    val command: String? = null,    // bash(! 명령)
    val exitCode: Int? = null,
)

/** 작업 중에 받아 둔(끼워넣기 대기) 메시지 */
@Serializable
data class QueueItem(val id: String, val text: String = "", val kind: String = "")

/** 뒤에서 도는 작업(Claude Code 의 백그라운드 셸·하위 에이전트·감시) */
@Serializable
data class BgJob(
    val id: String,
    val kind: String = "",          // shell | agent | monitor
    val title: String = "",
    val startedAt: Double = 0.0,    // ms
    val tail: String? = null,
    val agentType: String? = null,
    val model: String? = null,
    val thinking: String? = null,
)

@Serializable
data class ApprovalScript(val path: String = "", val lines: Int = 0, val content: String = "", val truncated: Boolean = false)

/** 맥 에이전트가 승인을 기다리는 동작 */
@Serializable
data class ApprovalItem(
    val id: String,
    val kind: String = "",          // send: 사람에게 보내기 / danger: 위험 명령
    val label: String = "",
    val to: String? = null,
    val detail: String = "",
    val since: Double? = null,
    val task: String? = null,
    val intent: String? = null,
    val note: String? = null,
    val purpose: String? = null,
    val guessed: Boolean? = null,
    val display: String? = null,
    val codeLike: Boolean? = null,
    val source: String? = null,
    val risk: String? = null,
    val scripts: List<ApprovalScript>? = null,
    val summary: String? = null,
    val headline: String? = null,
    val summarizing: Boolean? = null,
)

@Serializable
data class QuestionOption(val label: String, val description: String? = null)

@Serializable
data class QuestionSub(val question: String = "", val options: List<QuestionOption> = emptyList(), val multiSelect: Boolean? = null)

/** 사용자에게 고르게 묻는 질문. kind 가 있으면 확인 창(select·confirm·input)을 피드가 중계한 것 */
@Serializable
data class QuestionItem(
    val id: String,
    val question: String = "",
    val options: List<QuestionOption> = emptyList(),
    val multiSelect: Boolean? = null,
    val since: Double? = null,
    val kind: String? = null,
    val placeholder: String? = null,
    val items: List<QuestionSub>? = null,
) {
    val multi: Boolean get() = multiSelect ?: false
    val isMulti: Boolean get() = !items.isNullOrEmpty()
    val isPrompt: Boolean get() = kind != null
    /** 입력창에 쓴 글을 답으로 받는지(고르기 질문의 '기타', 글 입력 창) */
    val allowsOther: Boolean get() = (kind == null && !isMulti) || kind == "input"
}

@Serializable
data class TodoItem(val content: String = "", val status: String = "", val activeForm: String? = null)

/** 컨텍스트 사용량 */
@Serializable
data class ContextInfo(
    val tokens: Int? = null,
    val window: Int = 0,
    val percent: Double? = null,
    val auto: Boolean = false,
    val reserve: Int = 0,
) {
    /** 자동 압축이 시작되는 사용률(0~100). 꺼져 있으면 100 */
    val autoAt: Double get() = if (!auto || window <= 0) 100.0 else maxOf(0, window - reserve).toDouble() / window * 100
    /** 자동 압축 지점까지 얼마나 찼는지(0~1) */
    val nearness: Double get() = percent?.let { if (autoAt > 0) it / autoAt else 0.0 } ?: 0.0
    val percentText: String get() = percent?.let { "${Math.round(it)}%" } ?: "–"

    companion object {
        /** 8.2K / 84K / 1M / 1.5M */
        fun tokens(n: Int): String {
            if (n >= 1_000_000) {
                val v = n / 1_000_000.0
                return if (v == Math.rint(v)) "${v.toInt()}M" else String.format(java.util.Locale.US, "%.1fM", v)
            }
            if (n >= 10_000) return "${Math.round(n / 1000.0)}K"
            if (n >= 1000) return String.format(java.util.Locale.US, "%.1fK", n / 1000.0)
            return "$n"
        }
    }
}

/** 명령 하나(입력창에 / 를 치면 제안). 피드가 보낸 것(확장·스킬·프롬프트)은 누르면 입력창에 채운다 */
@Serializable
data class SlashCommand(
    val name: String,
    val description: String = "",
    val source: String = "extension",
    val needsArg: Boolean = true,
    val terminal: Boolean = false,
)

/** 맥 파일 찾기 결과('@') */
@Serializable
data class FileSuggestion(val value: String, val label: String = "", val path: String = "") {
    val isDir: Boolean get() = label.endsWith("/")
}

/** 모델 메뉴의 한 줄 */
@Serializable
data class ModelChoice(val id: String, val name: String = "")

@Serializable
data class ChatEvent(
    val t: String,
    val v: Int? = null,
    val messages: List<ChatMessage>? = null,
    val truncated: Int? = null,
    val working: Boolean? = null,
    val message: ChatMessage? = null,
    val id: String? = null,
    val state: String? = null,
    val value: Boolean? = null,
    val items: List<QueueItem>? = null,
    val queue: List<QueueItem>? = null,
    val text: String? = null,
    val commands: List<SlashCommand>? = null,
    val detail: ToolDetail? = null,
    val context: ContextInfo? = null,
    val compacting: Boolean? = null,
    val since: Double? = null,
    val compactSince: Double? = null,
    val item: ApprovalItem? = null,
    val approvals: List<ApprovalItem>? = null,
    val summary: String? = null,
    val headline: String? = null,
    val risk: String? = null,
    val summarizing: Boolean? = null,
    val question: QuestionItem? = null,
    val questions: List<QuestionItem>? = null,
    val todos: List<TodoItem>? = null,
    val planMode: Boolean? = null,
    val permMode: String? = null,
    val mode: String? = null,
    val agent: String? = null,
    val modelChoices: List<ModelChoice>? = null,
    val on: Boolean? = null,
    val files: List<FileSuggestion>? = null,
    val query: String? = null,
    val data: String? = null,
    val error: String? = null,
    val path: String? = null,
    val notice: String? = null,
    val jobs: List<BgJob>? = null,
    val window: Int? = null,
)

@Serializable
data class ChatEnvelope(val d: ChatEvent)

// --- 탭 목록 ---

@Serializable
data class BackgroundInfo(
    val by: String = "user",        // user | ai | phone | shortcut
    val started: Long = 0,
    val done: Long = 0,
    val from: Int? = null,
    val fromName: String = "",
)

@Serializable
data class TabAccount(val now: String = "", val pin: String = "", val next: String = "", val phase: String = "")

@Serializable
data class TmuxWindow(
    val index: Int,
    val name: String = "",
    val active: Boolean = false,
    /** working | asking(답을 기다림) | yourturn(끝남, 아직 안 봄) | "" */
    val status: String = "",
    /** 관리자 권한 확인 창(🔐sudo)의 단계: confirm | running | done | "" */
    val sudo: String = "",
    val bg: BackgroundInfo? = null,
    val jobs: String = "",
    val model: String = "",
    val thinking: String = "",
    val account: TabAccount? = null,
    val key: String = "",
) {
    /** '끝난 것 모두 닫기'로 닫을 탭(맥 브리지 server/windows.mjs 와 같은 규칙) */
    val finishedBackground: Boolean get() = (bg?.done ?: 0) > 0 && status != "working" && status != "asking" && jobs.isEmpty()
}

@Serializable
data class MacBattery(val percent: Int, val plugged: Boolean = false, val low: Boolean = false)

@Serializable
data class WindowsMessage(
    val windows: List<TmuxWindow> = emptyList(),
    val newTabTools: List<String> = emptyList(),
    val battery: MacBattery? = null,
)

/** 새 탭에서 켤 수 있는 도구(이름은 맥 브리지의 NEW_TAB_TOOLS 와 같다) */
enum class TabTool(val raw: String, val title: String) {
    Claude("claude", "Claude Code"), Pi("pi", "pi"), Codex("codex", "Codex"), Gemini("gemini", "Gemini CLI");

    companion object {
        fun of(raw: String) = entries.firstOrNull { it.raw == raw }
    }
}

// --- 사용량 ---

@Serializable
data class UsageLimit(
    val key: String? = null,        // session | week | week:<모델>
    val label: String = "",
    val percent: Double = 0.0,
    val resetsAt: String? = null,
    val session: Boolean = false,
    val severity: String = "",
)

@Serializable
data class UsageExtra(
    val enabled: Boolean = false,
    val used: Double? = null,
    val limit: Double? = null,
    val currency: String? = null,
    val decimals: Int? = null,
    val percent: Double? = null,
)

@Serializable
data class DailyUsage(val date: String, val used: Double = 0.0)

@Serializable
data class AccountUsage(
    val key: String,
    val label: String = "",
    val plan: String? = null,
    val limits: List<UsageLimit>? = null,
    val history: List<List<Double?>>? = null,
    val daily: List<DailyUsage>? = null,
    val updatedAt: Double? = null,
)

@Serializable
data class UsageInfo(
    val plan: String? = null,
    val limits: List<UsageLimit>? = null,
    val extra: UsageExtra? = null,
    val fetchedAt: String? = null,
    val error: String? = null,
    val history: List<List<Double?>>? = null,
    val daily: List<DailyUsage>? = null,
    val accounts: List<AccountUsage>? = null,
)
