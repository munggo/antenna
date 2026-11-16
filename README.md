# Antenna

[한국어](./README.ko.md)

Use the [Claude Code](https://claude.com/claude-code) and [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) sessions running on your Mac from your iPhone.

Your agents keep running in tmux on the Mac. The iPhone app shows each tmux tab either as a chat (messages, approval and question cards, to-do list) or as the real terminal, and whatever you type on either side shows up on the other. Nothing runs on the phone and nothing leaves your own network: the app talks straight to a small bridge on your Mac.

> Formerly called pi-remote. Identifiers still use the old name: the config folder `~/.config/pi-remote`, the `PI_REMOTE_*` settings, the `piremote://` link scheme.

## What you get

- **Chat view** for Claude Code and pi tabs: the conversation, tool steps, and cards for permission prompts and multiple-choice questions that you can answer from the phone. Screens where Claude Code waits for a key without telling any hook (such as the unsent-feedback prompt on `/exit`) are read off the Mac screen and shown as cards too.
- **Terminal view** for any tab: the same tmux window you see on the Mac.
- **Tabs**: switch, open, rename and close tmux windows; send a long task to a background tab (listed in its own section of the drawer with its status, elapsed time, the tab that asked for it, and its model and thinking level; finished ones close in one tap); reopen a past pi conversation. Shells and agents that Claude Code runs in the background show up under the tab as "백그라운드 작업 N" (background tasks); tap it to see each task's name, running time (for an agent also its type and model, and its thinking level when known) and the shell's latest output, and stop it (a shell is stopped right away; for an agent, Claude is asked to stop it). On the Mac, the tab that handed off the work shows the same in one "백그라운드: …" (background) line: a widget in pi, and in Claude Code a line your status line script adds from the tmux window option `@ai_bg_line`.
- **Admin (sudo) commands** open in their own tab where you confirm and type the password yourself; the agent never sees it.
- **Usage** of your Claude subscription limits (see the [note on usage](./docs/setup.md#usage)).
- **Notifications** when an agent needs you or finishes, with your own Apple push key (see [Notifications](./docs/setup.md#notifications)).
- After a reboot the bridge restores your tabs and resumes the conversations that were open.

The app's interface, the command-line messages and the code comments are in Korean. The guides are in English and Korean.

## How it works

```
 iPhone app  ── WebSocket (token) ──▶  bridge on the Mac  ──▶  tmux session
 (SwiftUI + SwiftTerm)                 (Node, port 8787)        ├─ Claude Code tab ⇄ hooks + feed (claude-remote/)
                                                                ├─ pi tab          ⇄ extensions   (pi-extension/)
                                                                └─ shell tab
```

- `server/` — the bridge. Attaches to your tmux session and relays the terminal, tab list, chat feed and cards over one WebSocket.
- `claude-remote/` — connects Claude Code tabs: hooks installed into `~/.claude/settings.json` plus a small feed process per tab.
- `pi-extension/` — connects pi tabs: extensions for the chat feed, approval and question cards, to-do list, plan mode.
- `ios/` — the app (SwiftUI, [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm)). The Xcode project is generated with XcodeGen.
- `deploy/` — install helpers, the pairing QR, the health check, optional background jobs.

On the same Wi-Fi the phone finds the Mac by itself (Bonjour). Away from it, the phone connects to an address you give it, such as your Mac's Tailscale or VPN address.

## Requirements

- A Mac with [tmux](https://github.com/tmux/tmux) and [Node.js](https://nodejs.org) 20 or newer (`brew install tmux node`)
- Claude Code and/or pi on that Mac
- An iPhone or iPad on iOS 16 or newer
- To build the app: Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), and an Apple developer account to put it on a device

## Quick start

**1. Install the Mac side**

```sh
git clone <this repository> antenna
cd antenna
sh install.sh
```

`install.sh` checks tmux and Node, installs the bridge's modules, creates the settings file `~/.config/pi-remote/env`, hooks up Claude Code and pi if you have them, starts the bridge at login, and runs a health check. It is safe to run again. It does not install tmux or Node for you, and it does not touch anything optional.

**2. Put the app on your phone**

If you were invited to TestFlight, follow the invitation email and get Antenna in the TestFlight app. An app installed this way gets no notifications (see [Status](#status)).

Without an invitation, build it yourself:

```sh
cp ios/Local.xcconfig.example ios/Local.xcconfig   # put your Apple team ID and your own identifier prefix in it
cd ios && xcodegen generate && open PiRemote.xcodeproj
```

Select your phone and run. Details and a command-line install are in the [setup guide](./docs/setup.md#building-the-app).

**3. Pair**

```sh
sh deploy/pair.sh
```

A QR code appears in the terminal. Scan it with the phone's camera (or with "QR 코드 찍기" on the app's first screen). It carries a one-time pairing code, the fingerprint of your Mac's certificate, the port and your Mac's address, so there is nothing to type. The phone trades the code for a token of its own.

**4. Work**

```sh
tmux attach -t antenna
```

Start `claude` or `pi` inside that session. The tab shows up in the app.

## Away from home

By default the phone only finds the Mac on the same Wi-Fi. To reach it from anywhere, put both devices on a private network and tell Antenna the Mac's address on it:

```sh
sh install.sh --host 100.64.0.1    # your Mac's Tailscale / VPN IP address, comma-separated for several
sh deploy/pair.sh                  # scan again so the phone learns the address
```

Any network that gives the Mac an address the phone can reach will do (Tailscale, WireGuard, OpenVPN). Antenna itself was developed and is used daily over OpenVPN.

How to choose a network, and the steps for each way (a VPN service that links your devices, the VPN server on your home router, a company VPN), are in the [setup guide](./docs/setup.md#reaching-the-mac-from-outside).

## Security

- Each phone gets its own token when it pairs. The phone keeps it in the keychain; the Mac keeps only a hash of it.
- The QR holds a one-time code that expires after five minutes, so a photo of it is useless afterwards.
- `sh deploy/pair.sh --list` shows the paired devices and `sh deploy/pair.sh --revoke <id>` cuts one off, including a connection that is open.
- The connection is encrypted (TLS). Each Mac makes its own certificate; the QR carries its fingerprint and the app talks only to the Mac with that fingerprint, so another device on the same network cannot listen in or pose as your Mac.
- Anyone holding a device's token can type into your terminal. If a phone is lost, revoke it.
- Even so, do not forward the bridge's port to the internet. Reach it over your own Wi-Fi or a private network.

## Optional features

All off unless you turn them on. See the [setup guide](./docs/setup.md#optional-features).

- Notifications through your own Apple push key
- Two Claude accounts chosen by folder, switching when one hits its limit
- Keeping the Mac connected to an OpenVPN server
- Daily updates of Claude Code and pi, restarting idle sessions on a new version
- Opening a terminal attached to the session at login
- Extra pi extensions (compact tool display, web search, sub-agents)

## Check and test

```sh
node deploy/doctor.mjs         # is everything installed and running? (settings, bridge, hooks, installed copies)
node deploy/doctor.mjs --fix   # fix what can be fixed safely
sh test.sh                     # the test suite: no model calls, never touches your real session or bridge
```

If the bridge ever dies, the reason is kept in `~/.cache/pi-remote/crash.log` and the health check shows it.

## Status

A personal tool that grew up; expect rough edges.

- macOS and iOS only.
- The prebuilt app is shared only by TestFlight invitation for now. Without an invitation you build and sign it yourself.
- Notifications need your own Apple developer push key. So they come only to an app you built yourself, not to one installed from TestFlight.

## License

[Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE).

Author: 서문교
