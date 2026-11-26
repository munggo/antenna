import SwiftUI

/// 맥 파일 찾기 결과 하나(맥 pi 입력창 '@'와 같은 결과)
struct FileSuggestion: Codable, Identifiable, Equatable {
    let value: String   // 넣을 글자(@경로, 폴더는 끝이 /)
    let label: String   // 이름(폴더는 끝이 /)
    let path: String    // 대화 폴더 기준 경로
    var id: String { value }
    var isDir: Bool { label.hasSuffix("/") }
}

/// 입력창 위 '@' 파일 목록. 파일을 고르면 '@경로 '가 들어가고, 폴더를 고르면 그 안을 이어서 찾는다.
struct FilePanel: View {
    let files: [FileSuggestion]
    let loading: Bool
    let error: String?
    let onPick: (FileSuggestion) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if files.isEmpty {
                    HStack(spacing: 8) {
                        if loading { ProgressView().scaleEffect(0.7) }
                        Text(loading ? String(localized: "맥에서 찾는 중…") : (error ?? String(localized: "맞는 파일이 없어요")))
                            .font(.system(size: Typo.caption + 1))
                            .foregroundColor(Theme.muted)
                    }
                    .padding(10)
                }
                ForEach(files) { f in
                    Button { onPick(f) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: f.isDir ? "folder" : "doc.text")
                                .font(.system(size: 13))
                                .foregroundColor(Theme.muted)
                                .frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.label)
                                    .font(.system(size: 15))
                                    .foregroundColor(Theme.text)
                                    .lineLimit(1)
                                if f.path != String(f.label.dropLast(f.isDir ? 1 : 0)) {
                                    Text(f.path)
                                        .font(.system(size: Typo.caption))
                                        .foregroundColor(Theme.muted)
                                        .lineLimit(1)
                                        .truncationMode(.head)
                                }
                            }
                            Spacer(minLength: 4)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("file-\(f.path)")
                }
            }
        }
        .frame(maxHeight: 250)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("filePanel")
    }
}
