# App

The iOS app (SwiftUI + [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm)). It connects to the bridge on the Mac over one WebSocket and shows each tmux tab as a chat or as the real terminal.

What you need, signing and the install steps are in the [setup guide](../docs/setup.md#building-the-app) ([한국어](../docs/setup.ko.md#앱-빌드)). This file is for working on the app itself.

## Project

`PiRemote.xcodeproj` is generated and not kept in git. Generate it from `project.yml`, and again whenever that file or an xcconfig file changes:

```sh
xcodegen generate
open PiRemote.xcodeproj
```

The signing values (`DEVELOPMENT_TEAM`, `BUNDLE_ID_PREFIX`) come from `Local.xcconfig`, which git ignores. Copy `Local.xcconfig.example` to start.

## Build check without signing

```sh
xcodebuild -project PiRemote.xcodeproj -scheme PiRemote \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Layout

- `PiRemote/` — the app
  - `App.swift`, `ContentView.swift` — the entry point and the first screen (pairing)
  - `Pairing.swift`, `QRScanner.swift`, `ConnectionSettings.swift`, `KeychainHelper.swift`, `BonjourBrowser.swift` — pairing, the saved connection, finding the Mac on the local network
  - `TerminalSession.swift` — the WebSocket session: terminal bytes, the tab list, the chat feed, cards
  - `TerminalScreen.swift`, `TerminalContainerView.swift`, `InputBar.swift` — the main screen, the terminal view, the input bar
  - `ChatView.swift`, `ChatModels.swift`, `MarkdownView.swift`, `ApprovalCard.swift`, `QuestionCard.swift` — the chat view and its cards
  - `TabDrawer.swift`, `JobsSheet.swift`, `SessionsSheet.swift` — tabs, background tasks, past conversations
  - `UsageView.swift`, `PushManager.swift`, `LiveActivities.swift`, `Shortcuts.swift` — usage, notifications, Live Activities, the Shortcuts action
- `PiRemoteWidgets/` — the Live Activity widget
- `Shared/` — what the app and the widget share
- `PiRemoteUITests/` — UI tests. `sh test.sh --app` in the repository root runs them in a simulator against a test bridge
- `test/` — a small check of the inline Markdown parser, run by `sh test.sh`

## Notes

- SwiftTerm is pinned to 1.18.0 in `project.yml`. 1.99.x (the 2.0 pre-release) broke command-line builds because of its build plugin.
- When the pairing QR carried the Mac's certificate fingerprint (the default), the app connects over TLS and accepts only that certificate.
- The interface is in Korean.
