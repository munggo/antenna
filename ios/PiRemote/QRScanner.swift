import SwiftUI
import VisionKit

/// 맥 'antenna-pair' 의 연결 QR(piremote://pair?token=…&host=…&port=…)을 앱 안에서 찍기.
/// 찍히면 found(링크)를 부르고 닫음. 카메라를 못 쓰면(시뮬레이터·권한 거부·지원 안 되는 기기) 안내를 보임
struct QRScanSheet: View {
    let found: (URL) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var wrong = false

    private var available: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    var body: some View {
        NavigationStack {
            Group {
                if available {
                    ZStack(alignment: .bottom) {
                        QRScannerView { text in
                            if let url = URL(string: text), url.scheme == "piremote", url.host == "pair" {
                                found(url)
                                dismiss()
                            } else {
                                wrong = true
                            }
                        }
                        .ignoresSafeArea()
                        Text(wrong ? "Antenna 연결 QR이 아니에요. 맥에서 sh deploy/pair.sh 로 띄운 QR을 찍어 주세요."
                                   : "맥 화면의 연결 QR을 비춰 주세요")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(Capsule().fill(Color.black.opacity(0.7)))
                            .padding(.bottom, 40).padding(.horizontal, 24)
                            .accessibilityIdentifier("qrHint")
                    }
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "camera.fill").font(.system(size: 34)).foregroundColor(Theme.muted)
                        Text("카메라를 쓸 수 없어요")
                            .font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.text)
                        Text("설정 › Antenna › 카메라를 허용하거나,\n아이폰 카메라 앱으로 QR을 찍어도 돼요.")
                            .font(.system(size: 14)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.bg)
                    .accessibilityIdentifier("qrUnavailable")
                }
            }
            .navigationTitle("QR 코드 찍기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() }.accessibilityIdentifier("qrClose") }
            }
        }
        .tint(Theme.accent)
        .accessibilityIdentifier("qrSheet")
    }
}

/// VisionKit 스캐너(QR 만)
private struct QRScannerView: UIViewControllerRepresentable {
    let onText: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                           qualityLevel: .balanced, isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    static func dismantleUIViewController(_ vc: DataScannerViewController, coordinator: Coordinator) { vc.stopScanning() }
    func makeCoordinator() -> Coordinator { Coordinator(onText: onText) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onText: (String) -> Void
        private var done = false
        init(onText: @escaping (String) -> Void) { self.onText = onText }
        func dataScanner(_ s: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for case .barcode(let b) in items {
                if let t = b.payloadStringValue {
                    if t.hasPrefix("piremote://pair") { done = true }
                    onText(t)
                    return
                }
            }
        }
    }
}
