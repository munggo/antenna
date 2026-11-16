import Foundation
import ImageIO
import UniformTypeIdentifiers

/// 보낼 사진을 긴 변 최대 2048px JPEG 로 줄인다.
/// - HEIC·ProRAW(DNG)·PNG 등 어떤 형식이든 읽고, 사진의 회전 정보도 반영한다.
/// - 원본을 통째로 펼치지 않고 줄인 크기로 바로 읽어 메모리를 적게 쓴다.
/// (UIKit 을 쓰지 않아 맥에서도 같은 코드로 시험할 수 있다)
enum ImageShrink {
    static let maxPixel = 2048

    static func jpeg(from data: Data, maxPixel: Int = maxPixel, quality: Double = 0.85) -> Data? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,   // 회전 정보 반영
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return encode(img, quality: quality)
    }

    /// 사진 파일에 들어 있는 작은 미리보기(아이폰 카메라 사진의 HEIC·JPEG 에 있음)를 꺼낸다. 원본을 풀지 않아 몇 ms 면 된다.
    /// 없으면(화면 캡처 PNG 등) nil. 고르자마자 입력창 칸에 그림을 띄우는 데 쓴다(11-15: 원본을 두 번 푼 뒤에야 칸이 떴음)
    static func embeddedPreview(from data: Data, maxPixel: Int = 300) -> Data? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageIfAbsent: false,   // 들어 있는 것만(없으면 원본에서 만들지 않음)
            kCGImageSourceCreateThumbnailFromImageAlways: false,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return encode(img, quality: 0.8)
    }

    private static func encode(_ img: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dst = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dst, img, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dst) else { return nil }
        return out as Data
    }

    /// 사진 파일 형식(시간 기록용): heic | jpeg | png | 그 밖
    static func kind(_ data: Data) -> String {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil), let t = CGImageSourceGetType(src) as String? else { return "?" }
        return UTType(t)?.preferredFilenameExtension ?? t
    }
}
