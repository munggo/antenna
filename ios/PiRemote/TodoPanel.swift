import SwiftUI

/// pi 의 할 일 목록 항목(todo_write)
struct TodoItem: Codable, Equatable, Hashable {
    let content: String
    let status: String          // pending | in_progress | completed
    let activeForm: String?
}

/// 입력창 위 할 일 칸: 접히면 '할 일 2/5 · 지금: …' 한 줄, 누르면 목록
struct TodoPanel: View {
    let todos: [TodoItem]
    @State private var open = false

    private var done: Int { todos.filter { $0.status == "completed" }.count }
    private var current: TodoItem? { todos.first { $0.status == "in_progress" } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(.easeOut(duration: 0.18)) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "checklist")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Theme.accent)
                    Text("할 일 \(done)/\(todos.count)")
                        .font(.system(size: Typo.row - 1, weight: .semibold))
                        .foregroundColor(Theme.text)
                    if let c = current {
                        Text("· \(c.activeForm ?? c.content)")
                            .font(.system(size: Typo.row - 1))
                            .foregroundColor(Theme.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: open ? "chevron.down" : "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Theme.muted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("todoPanel")
            .accessibilityValue("\(done)/\(todos.count)")

            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(todos.enumerated()), id: \.offset) { _, t in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: t.status == "completed" ? "checkmark.circle.fill" : t.status == "in_progress" ? "circle.dashed" : "circle")
                                .font(.system(size: 14))
                                .foregroundColor(t.status == "pending" ? Theme.muted : Theme.accent)
                            Text(t.content)
                                .font(.system(size: Typo.row - 1, weight: t.status == "in_progress" ? .semibold : .regular))
                                .foregroundColor(t.status == "completed" ? Theme.muted : Theme.text)
                                .strikethrough(t.status == "completed", color: Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                    }
                }
                .padding(.leading, 2)
                .accessibilityIdentifier("todoList")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceHigh))
    }
}
