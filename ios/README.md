# pi-remote iOS 앱

SwiftUI + SwiftTerm 기반. 맥 브리지 서버에 WebSocket 으로 붙어 tmux 세션을 그대로 미러링한다.

## 요구
- Xcode 16+ (SwiftTerm 1.18 은 Metal 셰이더를 쓴다 → Xcode 설치 시 Metal 툴체인 필요)
- XcodeGen (`brew install xcodegen`)

## 프로젝트 생성/열기
`PiRemote.xcodeproj` 는 git 에 올리지 않는다(생성물). `project.yml` 로 매번 생성한다.
```bash
cd ios
xcodegen generate
open PiRemote.xcodeproj
```

## 빌드/실행
1. Xcode 에서 타깃 **PiRemote** 선택
2. **Signing & Capabilities** 에서 본인 Apple ID 팀 지정 (실기기 배포용)
3. 아이폰 연결 후 Run

## 커맨드라인 빌드 확인 (시뮬레이터)
```bash
xcodebuild -project PiRemote.xcodeproj -scheme PiRemote \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## 구성
- `App.swift` — 앱 진입점
- `ContentView.swift` — 연결 설정 화면(호스트/포트/토큰)
- `TerminalScreen.swift` — 터미널 + 상태바 + 특수키 바
- `TerminalSession.swift` — SwiftTerm 뷰 + WebSocket 중계(핵심)
- `TerminalContainerView.swift` — SwiftTerm UIView 를 SwiftUI 에 래핑
- `KeyBar.swift` — Esc/Tab/Ctrl 조합/화살표/tmux prefix(C-a)
- `Theme.swift` — Tokyo Night 색상
- `ConnectionSettings.swift` / `KeychainHelper.swift` — 설정·토큰 저장

## 메모
- SwiftTerm 은 **1.18.0 고정**. 1.99.x(2.0 프리릴리스)는 빌드 플러그인 때문에 커맨드라인 빌드가 깨진다.
- 접속은 `ws://`(비TLS) — WireGuard 사설망 안에서만 쓰므로 Info.plist 에 로컬 네트워킹 허용.
