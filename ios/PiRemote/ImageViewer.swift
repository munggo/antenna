import SwiftUI
import UIKit

/// 채팅 속 사진 전체화면 보기(사진 앱과 같은 조작)
/// - 좌우로 밀기: 이전·다음 사진(대화 속 사진 순서)
/// - 두 손가락: 확대(최대 5배) / 두 번 탭: 확대·원래대로 / 확대 중 끌기: 사진 안에서 이동
/// - 아래로 쓸어내리기: 닫기(덜 내리면 제자리로) / X: 닫기
struct ImageViewer: View {
    @EnvironmentObject private var thumbs: ThumbStore
    @Environment(\.dismiss) private var dismiss
    let paths: [String]
    @State private var index: Int
    @State private var dragProgress: CGFloat = 0   // 아래로 끄는 정도(0~1) → 배경이 흐려짐

    init(paths: [String], start: String) {
        let list = paths.contains(start) ? paths : [start]
        self.paths = list
        _index = State(initialValue: list.firstIndex(of: start) ?? 0)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(1 - dragProgress * 0.85).ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(paths.enumerated()), id: \.offset) { i, path in
                    page(path).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            // 위쪽: 위치 표시 + 닫기(끄는 동안엔 숨김)
            HStack {
                // 저장: 누르면 사진 앱, 길게 누르면 pi-remote 폴더·다른 위치
                SaveButton(media: true, host: "image", file: { use in
                    guard paths.indices.contains(index) else { return }
                    thumbs.bestFile(paths[index]) { u in
                        if let u { use(u) } else { SaveCenter.shared.say("사진을 아직 받지 못했어요. 잠시 뒤 다시 해 주세요") }
                    }
                }) {
                    Image(systemName: "square.and.arrow.down")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Color.white.opacity(0.18)))
                }
                .padding(.leading, 16)
                Spacer()
                if paths.count > 1 {
                    Text("\(index + 1) / \(paths.count)")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.white)
                        .accessibilityIdentifier("viewerIndex")
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Color.white.opacity(0.18)))
                }
                .accessibilityIdentifier("viewerClose")
                .padding(.trailing, 16)
            }
            .padding(.top, 8)
            .opacity(dragProgress > 0.02 ? 0 : 1)
        }
        .statusBarHidden()
        .background(ClearBackground())   // 끌어내릴 때 뒤 채팅이 비쳐 보이게
        .saveSupport(host: "image")
    }

    @ViewBuilder
    private func page(_ path: String) -> some View {
        Group {
            if let img = thumbs.image(path, .full) ?? thumbs.image(path, .large) ?? thumbs.image(path, .small) {
                ZoomableImage(image: img,
                              onDismissProgress: { dragProgress = $0 },
                              onDismiss: { dismiss() })
                    .accessibilityIdentifier("imageViewer")
            } else if let why = thumbs.errors[path] {
                // 답 속 경로를 눌러 연 맥의 그림을 받지 못함(없는 파일 등)
                VStack(spacing: 10) {
                    Image(systemName: "photo").font(.system(size: 36)).foregroundColor(.white.opacity(0.6))
                    Text(why).font(.system(size: 15)).foregroundColor(.white).multilineTextAlignment(.center)
                    Text(path).font(.system(size: 12, design: .monospaced)).foregroundColor(.white.opacity(0.6))
                        .multilineTextAlignment(.center).lineLimit(3)
                }
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("imageViewerError")
            } else {
                ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .ignoresSafeArea()
        // pi 가 읽은 사진은 큰 그림이 원본 대신(넘겨서 처음 보는 사진도 받아 오게).
        // 답 속 경로로 연 맥의 그림은 열 때마다 새로 받는다(같은 경로에 다시 만들어질 수 있음)
        .onAppear { thumbs.request(path, path.hasPrefix("toolimg-") ? .large : .full, fresh: ThumbStore.isMacFile(path)) }
    }
}

/// 전체화면 시트의 기본 배경을 투명하게(끌어내릴 때 뒤가 보이게)
private struct ClearBackground: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        DispatchQueue.main.async { v.superview?.superview?.backgroundColor = .clear }
        return v
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

/// 확대·이동·아래로 끌어 닫기가 되는 사진
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    var onDismissProgress: (CGFloat) -> Void = { _ in }
    var onDismiss: () -> Void = {}

    func makeUIView(context: Context) -> ZoomScrollView {
        let v = ZoomScrollView(image: image)
        v.onDismissProgress = onDismissProgress
        v.onDismiss = onDismiss
        return v
    }

    func updateUIView(_ v: ZoomScrollView, context: Context) {
        v.onDismissProgress = onDismissProgress
        v.onDismiss = onDismiss
        if v.imageView.image !== image { v.setImage(image) }   // 더 선명한 원본이 도착하면 교체
    }
}

final class ZoomScrollView: UIScrollView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    let imageView = UIImageView()
    var onDismissProgress: (CGFloat) -> Void = { _ in }
    var onDismiss: () -> Void = {}
    private var lastBounds: CGSize = .zero
    private lazy var dismissPan = UIPanGestureRecognizer(target: self, action: #selector(dismissPanned(_:)))

    init(image: UIImage) {
        super.init(frame: .zero)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 5
        bouncesZoom = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        imageView.image = image
        addSubview(imageView)
        let dt = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        dt.numberOfTapsRequired = 2
        addGestureRecognizer(dt)
        dismissPan.delegate = self
        addGestureRecognizer(dismissPan)
        isAccessibilityElement = true
        accessibilityValue = "1.0"
    }

    required init?(coder: NSCoder) { fatalError() }

    func setImage(_ img: UIImage) {
        imageView.image = img
        setZoomScale(1, animated: false)
        fitImage()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != lastBounds {   // 처음·화면 회전 때 다시 맞춤
            lastBounds = bounds.size
            setZoomScale(1, animated: false)
            fitImage()
        }
    }

    /// 화면에 꽉 맞는(비율 유지) 크기로 놓고 가운데 정렬
    private func fitImage() {
        guard let img = imageView.image, img.size.width > 0, bounds.width > 0 else { return }
        let s = min(bounds.width / img.size.width, bounds.height / img.size.height)
        let size = CGSize(width: img.size.width * s, height: img.size.height * s)
        imageView.transform = .identity
        imageView.frame = CGRect(origin: .zero, size: size)
        contentSize = size
        center()
    }

    /// 사진이 화면보다 작을 땐 가운데 오도록 여백을 준다
    private func center() {
        let dx = max(0, (bounds.width - contentSize.width) / 2)
        let dy = max(0, (bounds.height - contentSize.height) / 2)
        contentInset = UIEdgeInsets(top: dy, left: dx, bottom: dy, right: dx)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        center()
        accessibilityValue = String(format: "%.1f", zoomScale)
    }

    @objc private func doubleTapped(_ g: UITapGestureRecognizer) {
        if zoomScale > 1.01 {
            setZoomScale(1, animated: true)
        } else {
            // 탭한 곳을 중심으로 2.5배
            let p = g.location(in: imageView)
            let s: CGFloat = 2.5
            let w = bounds.width / s, h = bounds.height / s
            zoom(to: CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), animated: true)
        }
    }

    // MARK: - 아래로 끌어 닫기(원래 크기일 때만, 아래쪽으로 끄는 동작만)

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === dismissPan else { return super.gestureRecognizerShouldBegin(g) }
        guard zoomScale <= 1.01 else { return false }
        let v = dismissPan.velocity(in: self)
        return v.y > 0 && v.y > abs(v.x) * 1.2
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        g === dismissPan && other === panGestureRecognizer
    }

    @objc private func dismissPanned(_ g: UIPanGestureRecognizer) {
        let t = g.translation(in: self)
        let progress = max(0, min(1, t.y / (bounds.height * 0.5)))
        switch g.state {
        case .changed:
            let scale = 1 - progress * 0.25
            imageView.transform = CGAffineTransform(translationX: t.x, y: max(0, t.y)).scaledBy(x: scale, y: scale)
            onDismissProgress(progress)
        case .ended, .cancelled:
            let v = g.velocity(in: self)
            if t.y > 120 || v.y > 900 {
                onDismiss()
            } else {
                UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) {
                    self.imageView.transform = .identity
                }
                onDismissProgress(0)
            }
        default:
            break
        }
    }
}
