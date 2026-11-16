import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 저장하기(사용자 결정):
/// - 사진·동영상: 누르면 사진 앱에 저장(처음 한 번 '사진 추가' 권한을 물음)
/// - 문서: 누르면 파일 앱 › 나의 iPhone › Antenna 폴더에 바로 저장
/// - 길게 누르면(메뉴) 사진 앱·pi-remote 폴더·'다른 위치에 저장…'(파일 앱에서 폴더 고르기)
final class SaveCenter: ObservableObject {
    static let shared = SaveCenter()
    enum Kind { case image, video, other }

    /// 화면 위에 잠깐 뜨는 결과 안내
    @Published var toast: String?
    /// '다른 위치에 저장…' 창(띄운 화면에서만 열리게 host 로 구분)
    @Published var export: ExportItem?
    struct ExportItem: Identifiable {
        let id = UUID()
        let url: URL
        let host: String
    }
    private var hide: DispatchWorkItem?

    func say(_ text: String) {
        DispatchQueue.main.async {
            self.toast = text
            self.hide?.cancel()
            let w = DispatchWorkItem { [weak self] in self?.toast = nil }
            self.hide = w
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: w)
        }
    }

    static func kind(of url: URL) -> Kind {
        guard let t = UTType(filenameExtension: url.pathExtension.lowercased()) else { return .other }
        if t.conforms(to: .movie) { return .video }
        if t.conforms(to: .image) { return .image }
        return .other
    }

    // MARK: 사진 앱

    func toPhotos(_ url: URL) {
        let kind = Self.kind(of: url)
        guard kind != .other else { say("사진 앱에는 사진·동영상만 저장할 수 있어요"); return }
        authorize { ok in
            guard ok else { self.say("사진 앱에 저장하려면 설정 › Antenna › 사진에서 '사진 추가만'을 허용해 주세요"); return }
            let ext = url.pathExtension.lowercased()
            PHPhotoLibrary.shared().performChanges({
                if kind == .video {
                    PHAssetCreationRequest.forAsset().addResource(with: .video, fileURL: url, options: nil)
                } else if ["jpg", "jpeg", "png", "heic", "heif", "gif"].contains(ext) {
                    PHAssetCreationRequest.forAsset().addResource(with: .photo, fileURL: url, options: nil)
                } else if let img = UIImage(contentsOfFile: url.path) {
                    PHAssetChangeRequest.creationRequestForAsset(from: img)   // webp·bmp 등은 그림으로 바꿔 저장
                }
            }) { done, _ in
                self.say(done ? (kind == .video ? "동영상을 사진 앱에 저장했어요" : "사진 앱에 저장했어요")
                              : (kind == .video ? "사진 앱이 이 동영상 형식을 받지 않아요. 파일 앱에 저장해 주세요" : "사진 앱에 저장하지 못했어요"))
            }
        }
    }

    private func authorize(_ done: @escaping (Bool) -> Void) {
        let st = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if st == .authorized || st == .limited { done(true); return }
        guard st == .notDetermined else { done(false); return }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { s in
            DispatchQueue.main.async { done(s == .authorized || s == .limited) }
        }
    }

    // MARK: 파일 앱

    /// 파일 앱 › 나의 iPhone › pi-remote 폴더(앱 문서 폴더)에 바로. 같은 이름이 있으면 '이름 2'
    func toAppFolder(_ url: URL) {
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
        var dest = docs.appendingPathComponent(url.lastPathComponent)
        var n = 2
        while fm.fileExists(atPath: dest.path) {
            dest = docs.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        do {
            try fm.copyItem(at: url, to: dest)
            say("파일 앱 › Antenna 폴더에 저장했어요")
        } catch {
            say("저장하지 못했어요")
        }
    }

    /// 다른 위치에 저장…: 파일 앱에서 폴더 고르기
    func elsewhere(_ url: URL, host: String) {
        DispatchQueue.main.async { self.export = ExportItem(url: url, host: host) }
    }

    /// 기본 동작(저장 버튼을 그냥 눌렀을 때): 사진·동영상은 사진 앱, 나머지는 pi-remote 폴더
    func quick(_ url: URL) {
        Self.kind(of: url) == .other ? toAppFolder(url) : toPhotos(url)
    }
}

/// 저장 메뉴 항목(버튼 메뉴·길게 누르기 메뉴가 같이 씀). file: 저장할 파일을 (필요하면 받아 와서) 넘겨 줌
struct SaveMenuItems: View {
    let media: Bool
    let host: String
    let file: (@escaping (URL) -> Void) -> Void

    var body: some View {
        if media {
            Button { file { SaveCenter.shared.toPhotos($0) } } label: { Label("사진 앱에 저장", systemImage: "photo.on.rectangle") }
        }
        Button { file { SaveCenter.shared.toAppFolder($0) } } label: { Label("파일 앱 › Antenna 폴더에 저장", systemImage: "folder") }
        Button { file { SaveCenter.shared.elsewhere($0, host: host) } } label: { Label("다른 위치에 저장…", systemImage: "folder.badge.plus") }
    }
}

/// 저장 버튼: 누르면 기본 저장, 길게 누르면 메뉴
struct SaveButton<L: View>: View {
    let media: Bool
    let host: String
    let file: (@escaping (URL) -> Void) -> Void
    @ViewBuilder let label: () -> L

    var body: some View {
        Menu {
            SaveMenuItems(media: media, host: host, file: file)
        } label: {
            label()
        } primaryAction: {
            file { SaveCenter.shared.quick($0) }
        }
        .accessibilityIdentifier("saveButton")
    }
}

/// '다른 위치에 저장…' 창(파일 앱 폴더 고르기)
struct DocumentExporter: UIViewControllerRepresentable {
    let url: URL
    let done: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let vc = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let done: (Bool) -> Void
        init(done: @escaping (Bool) -> Void) { self.done = done }
        func documentPicker(_ c: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(true) }
        func documentPickerWasCancelled(_ c: UIDocumentPickerViewController) { done(false) }
    }
}

extension View {
    /// 저장 결과 안내(위쪽 알약)와 '다른 위치에 저장…' 창. host: 이 화면 이름(창이 띄운 화면에서만 열리게)
    func saveSupport(host: String) -> some View { modifier(SaveSupport(host: host)) }
}

private struct SaveSupport: ViewModifier {
    let host: String
    @ObservedObject private var center = SaveCenter.shared

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let t = center.toast {
                    Text(t)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Capsule().fill(Color.black.opacity(0.82)))
                        .padding(.top, 60).padding(.horizontal, 24)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .allowsHitTesting(false)
                        .accessibilityIdentifier("saveToast")
                }
            }
            .animation(.easeOut(duration: 0.2), value: center.toast)
            .sheet(item: Binding(get: { center.export?.host == host ? center.export : nil },
                                 set: { if $0 == nil { center.export = nil } })) { item in
                DocumentExporter(url: item.url) { ok in
                    center.export = nil
                    if ok { center.say("저장했어요") }
                }
                .ignoresSafeArea()
            }
    }
}

/// 사진(채팅 속 사진·pi 가 읽은 사진)을 파일로: 받아 둔 가장 선명한 그림 파일, 없으면 받아 온 뒤
extension ThumbStore {
    func bestFile(_ path: String, _ done: @escaping (URL?) -> Void) {
        let tool = path.hasPrefix("toolimg-")
        let want: Size = tool ? .large : .full
        func pick() -> URL? {
            for s in [want, .large, .small] { if let u = fileURL(path, s) { return u } }
            return nil
        }
        if let u = fileURL(path, want) { done(named(u, path)); return }
        request(path, want)
        var tries = 0
        func poll() {
            if let u = fileURL(path, want) { done(named(u, path)); return }
            tries += 1
            if tries > 40 { done(pick().map { named($0, path) }); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { poll() }
        }
        poll()
    }

    /// 저장할 때 보일 이름(캐시 이름 'img-1-full.jpg' → 'img-1.jpg')
    private func named(_ src: URL, _ path: String) -> URL {
        let base = ((path as NSString).lastPathComponent as NSString).deletingPathExtension
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("save-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dst = dir.appendingPathComponent("\(base).jpg")
        return (try? FileManager.default.copyItem(at: src, to: dst)) != nil ? dst : src
    }
}
