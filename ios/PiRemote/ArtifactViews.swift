import AVKit
import SwiftUI
import UIKit
import WebKit
import QuickLook

/// pi 가 show_artifact 로 등록한 결과물(웹페이지·문서·발표 자료·표·PDF·이미지 등)
struct ArtifactRef: Codable, Equatable, Identifiable, Hashable {
    let path: String
    let title: String
    let kind: String
    let size: Int?
    let description: String?

    var id: String { path }
    var fileName: String { (path as NSString).lastPathComponent }
    var kindLabel: String {
        switch kind {
        case "web": return String(localized: "웹페이지")
        case "markdown": return String(localized: "문서")
        case "pdf": return "PDF"
        case "image": return String(localized: "이미지")
        case "document": return String(localized: "문서")
        case "spreadsheet": return String(localized: "표")
        case "slides": return String(localized: "발표 자료")
        case "text": return String(localized: "글")
        case "video": return String(localized: "동영상")
        case "audio": return String(localized: "소리")
        default: return String(localized: "파일")
        }
    }
    /// 사진 앱에 저장할 수 있는 것(사진·동영상)
    var isMedia: Bool { kind == "image" || kind == "video" }
    var symbol: String {
        switch kind {
        case "web": return "globe"
        case "markdown", "document", "text": return "doc.text"
        case "pdf": return "doc.richtext"
        case "image": return "photo"
        case "spreadsheet": return "tablecells"
        case "slides": return "rectangle.on.rectangle"
        case "video": return "film"
        case "audio": return "waveform"
        default: return "doc"
        }
    }
}

/// 아티팩트 열기·내용 받기: 맥 피드에 2MB 조각씩 요청해 캐시 폴더 파일에 이어 붙임(크기 제한 없음, 진행률)
final class ArtifactCenter: ObservableObject {
    static let shared = ArtifactCenter()
    /// loading: 받은 비율(0~1, 모르면 nil)
    enum FileState: Equatable { case loading(Double?), ready(URL), failed(String) }

    /// 전체 화면으로 여는 아티팩트
    @Published var open: ArtifactRef?
    /// 아티팩트 목록 화면
    @Published var showList = false
    /// 목록에서 고른 것: 목록이 다 닫힌 뒤 연다(닫히는 도중에 전체 화면을 띄우면 안 열림)
    var pendingOpen: ArtifactRef?
    @Published private(set) var files: [String: FileState] = [:]
    /// 맥에 조각 요청(경로, 시작 위치). TerminalScreen 이 세션과 이어 줌
    var request: ((String, Int) -> Void)?

    private struct Partial {
        let url: URL
        let handle: FileHandle
        let size: Int
        let mtime: Double?
        var got: Int
    }
    private var partial: [String: Partial] = [:]
    private var stall: [String: DispatchWorkItem] = [:]
    /// 받는 대로 할 일(저장 메뉴 등)
    private var waiters: [String: [(URL?) -> Void]] = [:]

    /// 열 때마다 새로 받음(맥에서 파일이 바뀌었을 수 있음). 받는 중이면 그대로,
    /// 큰 파일(5MB 넘음)은 받아 둔 것의 크기가 등록 때와 같으면 다시 받지 않음
    func load(_ ref: ArtifactRef) {
        if case .loading = files[ref.path] { return }
        if case .ready(let url) = files[ref.path], let s = ref.size, s > 5_000_000,
           (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) == s { return }
        close(ref.path)
        files[ref.path] = .loading(nil)
        request?(ref.path, 0)
        watch(ref.path)
    }

    /// 파일이 준비되면 then(없으면 받아 온 뒤). 못 받으면 안내
    func withFile(_ ref: ArtifactRef, _ then: @escaping (URL) -> Void) {
        if case .ready(let url) = files[ref.path], FileManager.default.fileExists(atPath: url.path) { then(url); return }
        SaveCenter.shared.say(String(localized: "맥에서 받아 오는 중…"))
        waiters[ref.path, default: []].append { u in
            if let u { then(u) } else { SaveCenter.shared.say(String(localized: "맥에서 받아 오지 못했어요")) }
        }
        load(ref)
    }

    func receive(path: String, name: String?, data: Data?, error: String?,
                 size: Int? = nil, offset: Int? = nil, done: Bool? = nil, mtime: Double? = nil) {
        guard case .loading = files[path] else { return }   // 실패·완료 뒤 늦게 온 조각
        guard let data else { fail(path, error ?? String(localized: "열지 못했어요")); return }
        let fm = FileManager.default
        if offset == nil || offset == 0 {
            close(path)
            let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("artifacts/\(abs(path.hashValue))", isDirectory: true)
            try? fm.removeItem(at: dir)
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(name ?? (path as NSString).lastPathComponent)
            guard fm.createFile(atPath: url.path, contents: nil), let h = try? FileHandle(forWritingTo: url) else {
                fail(path, String(localized: "폰에 저장하지 못했어요")); return
            }
            // 예전 피드(위치 없음)는 통째로 한 번
            partial[path] = Partial(url: url, handle: h, size: size ?? data.count, mtime: mtime, got: 0)
        }
        guard var p = partial[path], p.got == (offset ?? 0), p.mtime == mtime else {
            fail(path, String(localized: "받는 중에 맥 파일이 바뀌었어요. 다시 열어 주세요")); return
        }
        do { try p.handle.write(contentsOf: data) } catch { fail(path, String(localized: "폰에 저장할 자리가 모자라요")); return }
        p.got += data.count
        partial[path] = p
        if offset == nil || done == true || p.got >= p.size {
            try? p.handle.close()
            partial[path] = nil
            stall[path]?.cancel(); stall[path] = nil
            files[path] = .ready(p.url)
            waiters.removeValue(forKey: path)?.forEach { $0(p.url) }
        } else {
            files[path] = .loading(Double(p.got) / Double(max(p.size, 1)))
            request?(path, p.got)
            watch(path)
        }
    }

    /// 30초 동안 조각이 안 오면 실패(연결이 끊긴 경우)
    private func watch(_ path: String) {
        stall[path]?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self, case .loading = self.files[path] else { return }
            self.fail(path, String(localized: "맥에서 받다가 끊겼어요. 다시 열어 주세요"))
        }
        stall[path] = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: w)
    }

    private func fail(_ path: String, _ msg: String) {
        close(path)
        files[path] = .failed(msg)
        waiters.removeValue(forKey: path)?.forEach { $0(nil) }
    }

    private func close(_ path: String) {
        if let p = partial[path] { try? p.handle.close() }
        partial[path] = nil
        stall[path]?.cancel()
        stall[path] = nil
    }
}

/// 답 안의 아티팩트 카드(Claude 앱처럼): 누르면 전체 화면
struct ArtifactCard: View {
    let ref: ArtifactRef

    var body: some View {
        Button { ArtifactCenter.shared.open = ref } label: { ArtifactCardLabel(ref: ref) }
            .buttonStyle(.plain)
            // 길게 누르기 → 저장(필요하면 맥에서 받아 온 뒤)
            .contextMenu {
                SaveMenuItems(media: ref.isMedia, host: "main") { use in ArtifactCenter.shared.withFile(ref, use) }
            }
            .accessibilityIdentifier("artifactCard")
    }
}

/// 카드 모양(카드·목록이 같이 씀)
struct ArtifactCardLabel: View {
    let ref: ArtifactRef

    var body: some View {
            HStack(spacing: 12) {
                Image(systemName: ref.symbol)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(Theme.accent)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.accent.opacity(0.12)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ref.title)
                        .font(.system(size: Typo.row, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text("\(ref.kindLabel) · \(ref.fileName)")
                        .font(.system(size: Typo.caption + 1))
                        .foregroundColor(Theme.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.muted)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceHigh))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.border.opacity(0.6)))
            .contentShape(Rectangle())
    }
}

/// 이 대화의 아티팩트 목록(최근 것 먼저)
struct ArtifactListSheet: View {
    let refs: [ArtifactRef]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(refs.reversed()) { r in
                        Button {
                            ArtifactCenter.shared.pendingOpen = r
                            dismiss()
                        } label: {
                            ArtifactCardLabel(ref: r)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("artifactRow")
                    }
                }
                .padding(16)
            }
            .background(Theme.bg)
            .navigationTitle("아티팩트 \(refs.count)개")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
            }
        }
        .tint(Theme.accent)
        .accessibilityIdentifier("artifactList")
    }
}

/// 전체 화면 보기: 웹페이지는 실제로 동작하게, 마크다운·글은 글로, 그 밖에는 iOS 미리보기. 공유 가능
struct ArtifactViewer: View {
    let ref: ArtifactRef
    @ObservedObject private var center = ArtifactCenter.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(ref.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("닫기") { dismiss() }.accessibilityIdentifier("artifactClose")
                    }
                    ToolbarItemGroup(placement: .primaryAction) {
                        if case .ready(let url) = center.files[ref.path] {
                            // 저장: 누르면 사진·동영상은 사진 앱, 문서는 pi-remote 폴더. 길게 누르면 메뉴
                            SaveButton(media: ref.isMedia, host: "artifact", file: { $0(url) }) {
                                Image(systemName: "square.and.arrow.down")
                            }
                            ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                                .accessibilityIdentifier("artifactShare")
                        }
                    }
                }
        }
        .tint(Theme.accent)
        .saveSupport(host: "artifact")
        .onAppear { center.load(ref) }
        .accessibilityIdentifier("artifactViewer")
    }

    @ViewBuilder private var content: some View {
        switch center.files[ref.path] {
        case .ready(let url):
            let ext = url.pathExtension.lowercased()
            if ["html", "htm", "svg"].contains(ext) {
                WebFilePreview(url: url).ignoresSafeArea(edges: .bottom)
            } else if ["md", "markdown"].contains(ext) {
                ScrollView {
                    MarkdownView(text: (try? String(contentsOf: url, encoding: .utf8)) ?? "")
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Theme.bg)
            } else if ["txt", "log", "json", "yaml", "yml"].contains(ext) {
                ScrollView([.vertical, .horizontal]) {
                    Text((try? String(contentsOf: url, encoding: .utf8)) ?? "")
                        .font(.system(size: Typo.codeSmall, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(16)
                }
                .background(Theme.bg)
            } else if ["mp4", "mov", "m4v", "mp3", "m4a", "wav", "aac", "aiff"].contains(ext) {
                MediaPlayerView(url: url)
            } else {
                QuickLookFilePreview(url: url).ignoresSafeArea(edges: .bottom)
            }
        case .failed(let msg):
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 28)).foregroundColor(Theme.muted)
                Text(msg).font(.system(size: Typo.row)).foregroundColor(Theme.text).multilineTextAlignment(.center)
                Text(ref.path).font(.system(size: Typo.caption)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.bg)
            .accessibilityIdentifier("artifactError")
        default:
            // 받는 중: 큰 파일은 진행률(받은 양 / 전체)
            VStack(spacing: 12) {
                if case .loading(let p?) = center.files[ref.path] {
                    ProgressView(value: p).frame(width: 220)
                    Text("맥에서 받아 오는 중… \(Int(p * 100))%")
                        .font(.system(size: Typo.row)).foregroundColor(Theme.text)
                    if let s = ref.size {
                        Text("\(Self.mb(Double(s) * p)) / \(Self.mb(Double(s)))")
                            .font(.system(size: Typo.caption + 1)).foregroundColor(Theme.muted)
                    }
                } else {
                    ProgressView("맥에서 받아 오는 중…")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.bg)
            .accessibilityIdentifier("artifactLoading")
        }
    }
}

extension ArtifactViewer {
    static func mb(_ bytes: Double) -> String {
        bytes >= 1_048_576 ? String(format: "%.1fMB", bytes / 1_048_576) : String(format: "%.0fKB", bytes / 1024)
    }
}

/// 동영상·소리: iOS 기본 재생기(재생·멈춤·탐색). 화면을 닫으면 멈춤
private struct MediaPlayerView: View {
    let url: URL
    @State private var player: AVPlayer?
    /// 읽기 상태(시험·확인용): loading | ready | failed
    @State private var status = "loading"

    var body: some View {
        VideoPlayer(player: player)
            .background(Color.black)
            .ignoresSafeArea(edges: .bottom)
            .onAppear {
                if player == nil { player = AVPlayer(url: url) }
                watchStatus(0)
            }
            .onDisappear { player?.pause() }
            .accessibilityIdentifier("mediaPlayer")
            .accessibilityValue(status)
    }

    private func watchStatus(_ n: Int) {
        switch player?.currentItem?.status {
        case .readyToPlay:
            // 재생 중이면 지난 시간도(시험에서 실제로 재생되는지 확인)
            let t = player?.currentTime().seconds ?? 0
            status = t > 0.5 ? String(format: "ready %.0f", t) : "ready"
            if n < 600 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { watchStatus(n + 1) } }
        case .failed: status = "failed"
        default:
            if n < 40 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { watchStatus(n + 1) } }
        }
    }
}

/// 웹페이지·SVG: 스크립트까지 실제로 동작
private struct WebFilePreview: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> WKWebView {
        let v = WKWebView()
        // 배경을 정하지 않은 웹페이지도 Safari 처럼 흰 바탕(다크 모드에서 검은 글자가 묻히지 않게)
        v.isOpaque = true
        v.backgroundColor = .white
        v.scrollView.backgroundColor = .white
        v.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        v.accessibilityIdentifier = "artifactWeb"
        return v
    }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

/// PDF·오피스·이미지·표 등: iOS 미리보기
private struct QuickLookFilePreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let c = QLPreviewController()
        c.dataSource = context.coordinator
        return c
    }
    func updateUIViewController(_ c: QLPreviewController, context: Context) {}

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
