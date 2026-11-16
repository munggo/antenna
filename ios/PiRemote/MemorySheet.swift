import SwiftUI

/// pi 가 읽는 지침 파일(메모리)
struct MemoryFile: Codable, Equatable, Identifiable, Hashable {
    let path: String
    let label: String
    let exists: Bool
    let content: String
    var id: String { path }
}

struct MemorySaved: Equatable {
    let path: String
    let error: String?
    let at: Date
}

/// 메모리: 지침 파일 목록 → 고치기, 맨 위에서 한 줄 빠르게 더하기(Claude Code 의 '#' 처럼)
struct MemorySheet: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var meta: ChatMeta
    @Environment(\.dismiss) private var dismiss
    @State private var quick = ""
    @State private var quickTarget: String?

    var body: some View {
        NavigationStack {
            Group {
                if let files = meta.memoryFiles {
                    List {
                        Section {
                            HStack(spacing: 8) {
                                TextField("기억할 것 한 줄", text: $quick, axis: .vertical)
                                    .lineLimit(1...3)
                                    .accessibilityIdentifier("memoryQuick")
                                Button("더하기") { addQuick(files) }
                                    .disabled(quick.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                    .accessibilityIdentifier("memoryQuickAdd")
                            }
                            if files.count > 1 {
                                Picker("넣을 곳", selection: Binding(get: { quickTarget ?? files.first?.path ?? "" }, set: { quickTarget = $0 })) {
                                    ForEach(files) { f in Text(f.label).tag(f.path) }
                                }
                            }
                        } header: {
                            Text("빠르게 더하기")
                        } footer: {
                            Text("고른 파일 끝에 '- 내용' 한 줄로 더하고, pi 가 다시 불러와 적용해요.")
                        }
                        Section("지침 파일") {
                            ForEach(files) { f in
                                NavigationLink {
                                    MemoryEditor(file: f, session: session, meta: meta)
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(f.label).font(.system(size: Typo.row, weight: .semibold))
                                        Text(f.exists ? "\(f.content.split(separator: "\n").count)줄 · \(f.path)" : "아직 없음 · \(f.path)")
                                            .font(.system(size: Typo.caption)).foregroundColor(Theme.muted).lineLimit(1).truncationMode(.middle)
                                    }
                                }
                                .accessibilityIdentifier("memoryFile")
                            }
                        }
                    }
                } else {
                    ProgressView("맥에서 불러오는 중…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("메모리")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
        .tint(Theme.accent)
        .onAppear { session.requestMemory() }
        .accessibilityIdentifier("memorySheet")
    }

    private func addQuick(_ files: [MemoryFile]) {
        let line = quick.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty, let f = files.first(where: { $0.path == (quickTarget ?? files.first?.path) }) else { return }
        let base = f.content.hasSuffix("\n") || f.content.isEmpty ? f.content : f.content + "\n"
        session.saveMemory(path: f.path, content: base + "- " + line + "\n")
        quick = ""
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { session.requestMemory() }
    }
}

/// 지침 파일 고치기
struct MemoryEditor: View {
    let file: MemoryFile
    @ObservedObject var session: TerminalSession
    @ObservedObject var meta: ChatMeta
    @State private var text = ""
    @State private var saving = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TextEditor(text: $text)
            .font(.system(size: Typo.codeSmall + 1, design: .monospaced))
            .padding(.horizontal, 8)
            .accessibilityIdentifier("memoryEditor")
            .navigationTitle(file.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "저장 중…" : "저장") {
                        saving = true
                        session.saveMemory(path: file.path, content: text)
                    }
                    .disabled(saving || text == file.content)
                    .accessibilityIdentifier("memorySave")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let message {
                    Text(message).font(.system(size: Typo.caption + 1)).foregroundColor(Theme.muted).padding(8)
                }
            }
            .onAppear { text = file.content }
            .onChange(of: meta.memorySaved) { r in
                guard let r, r.path == file.path, saving else { return }
                saving = false
                if let e = r.error { message = e } else {
                    session.requestMemory()
                    dismiss()
                }
            }
    }
}
