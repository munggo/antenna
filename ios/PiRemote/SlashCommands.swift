import SwiftUI

/// 명령 하나(입력창에 `/` 를 치면 제안)
struct SlashCommand: Identifiable, Equatable, Decodable {
    let name: String            // 앞의 / 없이
    let description: String
    let source: String          // builtin | extension | skill | prompt
    var needsArg = false        // 누르면 바로 실행하지 않고 입력창에 채움(뒤에 입력이 필요)
    var terminal = false        // pi 가 맥 화면에 선택창·출력을 띄움 → 폰도 터미널 보기로

    var id: String { name }

    enum CodingKeys: String, CodingKey { case name, description, source }

    init(_ name: String, _ description: String, source: String = "builtin", needsArg: Bool = false, terminal: Bool = false) {
        self.name = name
        self.description = description
        self.source = source
        self.needsArg = needsArg
        self.terminal = terminal
    }

    /// 확장·스킬·프롬프트 명령(확장이 보내줌): 뒤에 입력이 올 수 있으니 누르면 입력창에 채운다
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        description = (try? c.decode(String.self, forKey: .description)) ?? ""
        source = (try? c.decode(String.self, forKey: .source)) ?? "extension"
        needsArg = true
        terminal = false
    }

    /// pi 기본 명령(폰에서 쓸 만한 것만, 한국어 설명).
    /// /model·/thinking 은 입력창 칩으로, /quit·/login 같은 인증·종료 명령은 맥에서 하도록 뺐다.
    /// 맥 화면에 방향키로 고르는 창을 띄우는 명령(/tree·/fork·/settings·/scoped-models·/mcp)은 폰에서 조작할 수 없어 뺐고,
    /// 대화 전체를 밖으로 올리는 /share 도 뺐다. /resume 은 폰의 '지난 대화' 화면을 연다.
    static let builtins: [SlashCommand] = [
        .init("compact", String(localized: "대화 압축 — 앞부분을 요약해 공간 확보")),
        .init("new", String(localized: "새 대화 시작")),
        .init("resume", String(localized: "지난 대화 이어하기")),
        .init("clone", String(localized: "지금 대화 복제")),
        .init("name", String(localized: "대화 이름 정하기"), needsArg: true),
        .init("session", String(localized: "대화 정보·통계"), terminal: true),
        .init("export", String(localized: "대화 내보내기(HTML)"), terminal: true),
        .init("copy", String(localized: "마지막 답을 맥 클립보드로 복사")),
        .init("reload", String(localized: "확장·스킬 다시 불러오기")),
        .init("hotkeys", String(localized: "단축키 보기"), terminal: true),
        .init("changelog", String(localized: "pi 변경 내역"), terminal: true),
    ]

    /// 입력한 글(`/` 다음)로 고르기: 이름이 그 글로 시작하는 것 먼저, 그다음 이름·설명에 포함된 것
    static func suggestions(_ query: String, ext: [SlashCommand]) -> [SlashCommand] {
        let all = builtins + ext.filter { e in !builtins.contains { $0.name == e.name } }
        let q = query.lowercased()
        if q.isEmpty { return all }
        let starts = all.filter { $0.name.lowercased().hasPrefix(q) }
        let contains = all.filter { c in
            !c.name.lowercased().hasPrefix(q) && (c.name.lowercased().contains(q) || c.description.lowercased().contains(q))
        }
        return starts + contains
    }
}

/// 입력창 위 명령 제안 목록
struct SlashPanel: View {
    let commands: [SlashCommand]
    let onPick: (SlashCommand) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(commands) { c in
                    Button { onPick(c) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: icon(c))
                                .font(.system(size: 13))
                                .foregroundColor(Theme.muted)
                                .frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("/\(c.name)")
                                    .font(.system(size: 15, design: .monospaced))
                                    .foregroundColor(Theme.text)
                                if !c.description.isEmpty {
                                    Text(c.description)
                                        .font(.system(size: Typo.caption))
                                        .foregroundColor(Theme.muted)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: 4)
                            if c.terminal {
                                Image(systemName: "terminal")
                                    .font(.system(size: 12))
                                    .foregroundColor(Theme.muted)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("slash-\(c.name)")
                }
            }
        }
        .frame(maxHeight: 250)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("slashPanel")
    }

    private func icon(_ c: SlashCommand) -> String {
        switch c.source {
        case "skill": return "graduationcap"
        case "prompt": return "doc.text"
        case "extension": return "puzzlepiece.extension"
        default: return "command"
        }
    }
}
