// 그림 파일(PNG)의 QR 을 맥의 바코드 인식(Vision)으로 읽어 한 줄에 하나씩 낸다. 못 읽으면 빈 줄.
// test/qr.test.mjs 가 부른다: swift test/qr-decode.swift <그림>…
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    var text = ""
    if let image = NSImage(contentsOfFile: path), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
        text = request.results?.first?.payloadStringValue ?? ""
    }
    print(text)
}
