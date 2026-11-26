# Android app

The Android app (Kotlin, Jetpack Compose). Like the iOS app, it connects to the bridge on the Mac over one WebSocket and shows each tmux tab as a chat or as the real terminal. It is a port of the iOS app's core: pairing, chat and terminal views, approval and question cards, to-dos, the tab drawer with background tabs and tasks, photos, usage, and notifications.

What you need, how to install it on a phone and how to set up notifications are in the [setup guide](../docs/setup.md#android-app) ([한국어](../docs/setup.ko.md#안드로이드-앱)). This file is for working on the app itself.

## Build

```sh
echo "sdk.dir=/path/to/android/sdk" > local.properties   # git ignores it
./gradlew assembleDebug                                   # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest                               # unit tests (Markdown parsing, pairing link, chat items)
```

JDK 17 is enough (Gradle 8.11.1 through the wrapper, Android Gradle Plugin 8.9.2, Kotlin 2.1.0, Compose BOM 2024.12.01).

Notifications use Firebase Cloud Messaging. The Google services plugin is applied only when `app/google-services.json` exists (git ignores it), so the app builds without Firebase; `BuildConfig.HAS_FIREBASE` tells the code which build it is.

## Layout

`app/src/main/java/com/munggo/antenna/`

- `MainActivity.kt`, `AntennaApp.kt` — the entry point, intents (pairing links, notification taps), one session per process, background and foreground
- `net/` — pairing (`PairingClient`, `ConnectionSettings` with the `piremote://pair` parser), the token kept with an Android Keystore key (`SecureStore`), certificate pinning (`Tls`), finding the Mac on the local network (`Discovery`, NSD)
- `session/BridgeSession.kt` — the WebSocket session: candidate hosts, reconnecting, terminal bytes, the tab list, the chat feed, cards, everything the app sends
- `chat/` — the chat feed model (`ChatStore`), turning messages into rows (`ChatItems`), the Markdown parser (`Markdown`, `InlineMd`)
- `term/TerminalBridge.kt` — the terminal view: a WebView with [xterm.js](https://github.com/xtermjs/xterm.js) kept alive for the whole connection
- `ui/` — the screens: `MainScreen`, `chat/`, `input/`, `cards/`, `TabDrawer`, `usage/`, `sheets/`, `ContextGauge`, `PairScreen`, `ImageViewer`
- `push/PushService.kt` — receiving FCM data messages and showing the notification
- `model/Models.kt` — the JSON the bridge sends (same shapes as `ios/PiRemote/ChatModels.swift`)

`app/src/main/assets/xterm/` holds xterm.js 5.5.0 with the fit and unicode11 addons (MIT, `LICENSE-xterm.txt`) and the page that hosts it.

## Testing on an emulator

`test/env.sh` starts a test tmux session, a test bridge on 127.0.0.1 (the emulator reaches it as 10.0.2.2) and a fake chat feed (`test/fake-feed.mjs`), and prints a pairing link. It never touches the session or bridge you use.

```sh
sh android/test/env.sh up                       # prints piremote://pair?code=…&fp=…&host=10.0.2.2&port=8797
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -a android.intent.action.VIEW -d '"<the link>"'
sh android/test/env.sh down
```

What the app sent to the fake feed is written to `$TMPDIR/antenna-droid-test/signals/cmds`. Test tags are exported as resource ids, so `adb exec-out uiautomator dump` shows them. In debug builds, `adb shell am start -n com.munggo.antenna/.MainActivity --es test_notify approval --ei window 0` shows a notification without FCM, and the WebView can be inspected from Chrome (`chrome://inspect`).

## Notes

- The app connects without `chat=2`, so the bridge sends the whole conversation of the tab on screen instead of only what the phone lacks (the iOS app keeps every tab's conversation and asks for the difference).
- The terminal WebView must have `MATCH_PARENT` layout params. With the default (wrap content), `100%` heights inside the page are 0 and xterm.js can't measure rows.
- Strings are written in both languages with `tr("한국어", "English")`; English follows the iOS string catalog.
- Not ported yet: Live Activities and widgets, the Shortcuts action, past conversations, memory, the artifact viewer, pasting images from the clipboard.
