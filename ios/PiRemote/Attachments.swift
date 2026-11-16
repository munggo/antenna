import SwiftUI
import UIKit

/// 입력창에 붙인 사진. 고르자마자 칸부터 보이고(받는 중), 줄인 뒤 맥에 미리 올리고, 보낼 때 글과 함께 pi 에 넣는다.
struct Attachment: Identifiable, Equatable {
    enum State: Equatable {
        case preparing          // 고른 사진을 받아 줄이는 중
        case uploading
        case ready(String)      // 맥에 저장된 경로
        case failed
    }
    let id: String
    var preview: Data?          // 입력창 썸네일용 작은 JPEG(사진을 받기 전에는 없음)
    var state: State

    var path: String? { if case .ready(let p) = state { return p } else { return nil } }
}

/// 글 속 사진 경로(@…/.cache/pi-remote/img-숫자.jpg, ![](…)) 를 찾아 그림으로 바꿔 보여주기 위한 도구
enum ImageTokens {
    private static let pathPattern = #"/[^\s()]*?/\.cache/pi-remote/img-\d+\.(?:jpe?g|png)"#
    private static let token = try! NSRegularExpression(
        pattern: #"(?:!\[[^\]]*\]\((\#(pathPattern))\)|@(\#(pathPattern)))\s*"#)
    /// pi 가 사진을 받으면 모델에게 알려주려고 덧붙이는 크기 안내 → 말풍선에선 숨김
    private static let piImageNote = try! NSRegularExpression(
        pattern: #"\s*\[Image: original \d+x\d+, displayed at \d+x\d+\.[^\]]*\]"#)

    /// 글에서 사진 경로를 뽑고, 경로를 지운 나머지 글을 돌려준다
    static func split(_ text: String) -> (paths: [String], text: String) {
        let ns = text as NSString
        var paths: [String] = []
        for m in token.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            for g in 1...2 where m.range(at: g).location != NSNotFound {
                paths.append(ns.substring(with: m.range(at: g)))
            }
        }
        // 같은 사진이 여러 번 붙어 있으면 한 번만(순서 유지)
        var seen = Set<String>()
        paths = paths.filter { seen.insert($0).inserted }
        var rest = token.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: ns.length), withTemplate: "")
        rest = piImageNote.stringByReplacingMatches(in: rest, range: NSRange(location: 0, length: (rest as NSString).length), withTemplate: "")
        return (paths, rest.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

/// 썸네일 저장소. 기기에 저장해 두고, 없으면 맥에서 받아온다(브리지 thumb 요청).
/// 전체화면으로 보고 있는 사진
struct ViewingImage: Identifiable, Equatable { let id: String }   // id = 사진 경로

final class ThumbStore: ObservableObject {
    enum Size: String { case small, large, full }   // 말풍선 / 답변 속 그림 / 전체화면 확대용 원본

    /// 탭해서 전체화면으로 열린 사진(채팅 화면이 이 값으로 전체화면 보기를 띄운다)
    @Published var viewing: ViewingImage?

    @Published private(set) var images: [String: UIImage] = [:]   // 키: "파일이름|크기"
    /// 맥에 없다고 확인된 사진(읽은 사진이 기록에 없을 때 등) → 자리를 비워 두지 않고 숨김
    @Published private(set) var missing = Set<String>()
    /// 맥에 썸네일을 요청하는 함수(세션이 연결)
    var fetch: ((_ path: String, _ size: Size) -> Void)?
    private var requested = Set<String>()
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("thumbs")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private func key(_ path: String, _ size: Size) -> String {
        "\((path as NSString).lastPathComponent)|\(size.rawValue)"
    }

    private func file(_ key: String) -> URL {
        dir.appendingPathComponent(key.replacingOccurrences(of: "|", with: "-") + ".jpg")
    }

    func image(_ path: String, _ size: Size) -> UIImage? {
        let k = key(path, size)
        if let img = images[k] { return img }
        if let data = try? Data(contentsOf: file(k)), let img = UIImage(data: data) {
            DispatchQueue.main.async { self.images[k] = img }
            return img
        }
        // 큰 그림이 없으면 작은 그림이라도
        if size == .large { return images[key(path, .small)] }
        return nil
    }

    /// 받아 둔 그림 파일(없으면 nil). 저장하기에 씀
    func fileURL(_ path: String, _ size: Size) -> URL? {
        let u = file(key(path, size))
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    /// 화면에 처음 보일 때 호출: 기기에 없으면 맥에 한 번만 요청
    func request(_ path: String, _ size: Size) {
        let k = key(path, size)
        guard images[k] == nil, !FileManager.default.fileExists(atPath: file(k).path), !requested.contains(k) else { return }
        requested.insert(k)
        fetch?(path, size)
    }

    /// 받은(또는 직접 만든) 썸네일 저장
    func store(_ path: String, _ size: Size, data: Data) {
        let k = key(path, size)
        try? data.write(to: file(k), options: .atomic)
        if let img = UIImage(data: data) { images[k] = img }
    }

    /// 요청 실패(연결 끊김 등) → 나중에 다시 요청할 수 있게
    func forget(_ path: String, _ size: Size) { requested.remove(key(path, size)) }

    func markMissing(_ path: String) { missing.insert(path) }
    func isMissing(_ path: String) -> Bool { missing.contains(path) }
}

/// 사진 한 장(말풍선·답변 속). 기기에 없으면 맥에서 받아와 표시.
struct ThumbView: View {
    @EnvironmentObject private var thumbs: ThumbStore
    let path: String
    var size: ThumbStore.Size = .small
    var fit = false     // 답변 속 큰 그림은 잘리지 않게 전체를 보여줌
    var tappable = true // 탭하면 전체화면(단계 상세 창 안에서는 끔: 창 위에 또 띄울 수 없음)
    var axId = "bubbleThumb"

    var body: some View {
        Group {
            if let img = thumbs.image(path, size) {
                if fit {
                    Image(uiImage: img).resizable().scaledToFit()
                } else {
                    Image(uiImage: img).resizable().scaledToFill()
                }
            } else {
                ZStack {
                    Theme.surfaceHigh
                    Image(systemName: "photo").foregroundColor(Theme.muted)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if tappable { thumbs.viewing = ViewingImage(id: path) } }   // 탭 → 전체화면 보기
        // 길게 누르기 → 저장(사진 앱·pi-remote 폴더·다른 위치)
        .contextMenu {
            if tappable {
                SaveMenuItems(media: true, host: "main") { use in
                    thumbs.bestFile(path) { u in
                        if let u { use(u) } else { SaveCenter.shared.say("사진을 아직 받지 못했어요. 잠시 뒤 다시 해 주세요") }
                    }
                }
            }
        }
        .onAppear { thumbs.request(path, size) }
        .accessibilityIdentifier(axId)
    }
}

/// 말풍선 위 사진들(오른쪽 정렬). 한 줄에 최대 3장, 넘치면 다음 줄로.
/// (한 줄에 다 늘어놓으면 사진이 많을 때 화면보다 넓어져 화면 전체가 옆으로 밀렸음)
struct ThumbRow: View {
    let paths: [String]
    static let side: CGFloat = 88

    var body: some View {
        let cols = Array(repeating: GridItem(.fixed(Self.side), spacing: 6), count: min(max(paths.count, 1), 3))
        LazyVGrid(columns: cols, alignment: .trailing, spacing: 6) {
            ForEach(Array(paths.enumerated()), id: \.offset) { _, p in
                ThumbView(path: p)
                    .frame(width: Self.side, height: Self.side)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .fixedSize()
    }
}
