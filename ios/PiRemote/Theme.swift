import SwiftUI
import SwiftTerm
import UIKit

/// Claude 앱 분위기의 색상. 폰의 라이트/다크 설정을 자동으로 따른다.
/// - 다크: 거의 검정에 가까운 회색 배경 + 밝은 글자
/// - 라이트: 밝은 회백색 배경 + 거의 검정 글자
/// 값은 Claude 앱 스크린샷에서 직접 뽑았다.
/// 강조색은 둘 다 클레이 오렌지 계열.
enum Theme {
    static let bg = dyn(light: 0xF9F9F7, dark: 0x151515)          // 화면 배경
    static let bgElevated = dyn(light: 0xF0F0EE, dark: 0x202020)  // 코드 블록·표·도구 출력
    static let surface = dyn(light: 0xFFFFFF, dark: 0x2A2A2A)     // 입력창·토큰 입력
    static let bubble = dyn(light: 0xEFEFED, dark: 0x2A2A2A)      // 내 메시지 말풍선
    static let surfaceHigh = dyn(light: 0xEFEFED, dark: 0x3D3D3D) // 칩·원형 버튼·선택된 탭
    static let border = SwiftUI.Color(UIColor { t in
        t.userInterfaceStyle == .dark ? UIColor.white.withAlphaComponent(0.08)
                                      : UIColor.black.withAlphaComponent(0.10)
    })
    static let text = dyn(light: 0x0F0F0E, dark: 0xF9F9F7)
    static let muted = dyn(light: 0x74736E, dark: 0x96958D)
    static let accent = dyn(light: 0xC96442, dark: 0xCC7C5E)      // Claude 클레이
    static let green = dyn(light: 0x4E8A3E, dark: 0x8BBF7A)
    static let purple = dyn(light: 0x8A5CC7, dark: 0xB08EE6)    // 답을 기다리는 탭
    static let teal = dyn(light: 0x2E7D8C, dark: 0x6FB7C4)      // 회사 계정(사용량 그래프)
    static let red = dyn(light: 0xC0453A, dark: 0xE5675A)
    static let codeInline = dyn(light: 0xB5532F, dark: 0xEBA37E)  // 문장 안 `코드`

    // 터미널(SwiftTerm)은 맥 pi 화면을 그대로 옮기므로 라이트 모드에서도 어둡게 유지
    static let terminalBg = SwiftUI.Color(hex: 0x151515)
    static let uiBg = UIColor(hex: 0x151515)
    static let uiText = UIColor(hex: 0xF9F9F7)

    private static func dyn(light: UInt32, dark: UInt32) -> SwiftUI.Color {
        SwiftUI.Color(UIColor { t in
            t.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }

    /// SwiftTerm 터미널 ANSI 팔레트(따뜻한 톤, 어두운 배경용).
    static func terminalColors() -> [SwiftTerm.Color] {
        let hexes: [UInt32] = [
            0x1F1E1D, 0xE5675A, 0x8BBF7A, 0xE0B46A, // black red green yellow
            0x7FA7D9, 0xC49BD9, 0x79C2C0, 0xD6D3CA, // blue magenta cyan white
            0x5A5852, 0xF07F72, 0xA3D191, 0xF0C47E, // bright black..yellow
            0x96BBE8, 0xD4B0E6, 0x92D6D3, 0xF5F4EE, // bright blue..white
        ]
        return hexes.map { h in
            SwiftTerm.Color(
                red: UInt16((h >> 16 & 0xff)) * 257,
                green: UInt16((h >> 8 & 0xff)) * 257,
                blue: UInt16((h & 0xff)) * 257
            )
        }
    }
}

/// 글자 크기. Claude 앱 화면을 재서 맞춘 값(본문 17pt, 줄 높이 약 27pt).
enum Typo {
    static let body: CGFloat = 17           // 답변 본문·내 메시지·목록·입력창
    static let bodyLineSpacing: CGFloat = 7
    static let quote: CGFloat = 16
    static let h1: CGFloat = 22
    static let h2: CGFloat = 20
    static let h3: CGFloat = 18
    static let inlineCode: CGFloat = 15.5
    static let code: CGFloat = 14            // 코드 블록·도구 명령
    static let codeSmall: CGFloat = 13       // 도구 출력
    static let table: CGFloat = 15
    static let row: CGFloat = 16             // "명령어 N개 실행함"·작업 중 줄
    static let caption: CGFloat = 13         // 안내·보조 문구
    static let chip: CGFloat = 15            // 모델·생각 깊이 칩
    static let title: CGFloat = 17           // 상단 제목
    static let subtitle: CGFloat = 14        // 상단 연결 상태
    static let tab: CGFloat = 14
}

extension SwiftUI.Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: 1
        )
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
    }
}
