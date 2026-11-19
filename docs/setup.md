# Setup guide

[한국어](./setup.ko.md) · Back to the [README](../README.md)

`sh install.sh` covers the usual case. This guide explains what it sets up, how to change it, and the optional parts.

- [Settings](#settings)
- [Reaching the Mac from outside](#reaching-the-mac-from-outside)
- [Building the app](#building-the-app)
- [Notifications](#notifications)
- [Usage](#usage)
- [Shortcuts](#shortcuts)
- [Optional features](#optional-features)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Uninstalling](#uninstalling)

## Settings

Everything lives in one file, `~/.config/pi-remote/env` (mode 600), read by the bridge when it starts.

| Name | Default | Meaning |
|---|---|---|
| `PI_TMUX_SESSION` | `antenna` | The tmux session the bridge attaches to. The bridge creates it if it does not exist. |
| `HOST` | `0.0.0.0` | Address the bridge listens on. |
| `PORT` | `8787` | Port the bridge listens on. |
| `PI_REMOTE_TLS_ONLY` | `1` | Accept encrypted connections only. Remove the line only if you still use an old build of the app that connects without encryption. |
| `PI_REMOTE_NODE` | found by `install.sh` | The Node binary that runs the bridge. Background jobs do not have your shell's `PATH`, so the path is written down. |
| `PI_REMOTE_HOSTS` | empty | IP addresses the phone uses outside your Wi-Fi, comma-separated, no spaces. Goes into the pairing QR. |

After editing the file, restart the bridge. If the port or addresses changed, pair the phone again.

```sh
launchctl kickstart -k gui/$(id -u)/com.munggo.pi-remote   # restart the bridge
sh deploy/pair.sh                                          # show the pairing QR
```

`sh install.sh --no-agent` skips the login item. Then you start the bridge yourself with `server/run.sh`. Until you do, the health check at the end of the install marks the bridge with ✗; it goes away once the bridge runs.

### Paired devices

The phone's token is not in the settings file. `sh deploy/pair.sh` shows a QR with a one-time code that is valid for five minutes; the phone trades it for a token of its own, and the Mac keeps only a hash of that token in `~/.config/pi-remote/devices.json`.

The QR also carries the fingerprint of the Mac's certificate. The bridge creates that certificate the first time it starts (`~/.config/pi-remote/tls/`), and the app accepts an encrypted connection only from the Mac with that fingerprint. If you ever delete the certificate, pair the phone again.

```sh
sh deploy/pair.sh                  # pair a phone
sh deploy/pair.sh --list           # paired devices
sh deploy/pair.sh --revoke <id>    # cut one off (an open connection closes within a minute)
```

"연결 토큰 바꾸기" (replace the connection token) in the app's menu replaces that phone's token only.

(Only for a Mac that was set up with an earlier version.) Installs from before per-device tokens have a shared `PI_REMOTE_TOKEN` line in the settings file and no `PI_REMOTE_TLS_ONLY` line, and phones paired then keep working, without encryption. Once every phone runs the current app and has been paired again, delete the `PI_REMOTE_TOKEN` line, add `PI_REMOTE_TLS_ONLY=1` and restart the bridge. Choosing "연결 토큰 바꾸기" on such a phone does the same: the phone gets its own token and the shared one is removed. `sh deploy/pair.sh --legacy` shows the old kind of QR for an app that does not know pairing codes.

## Reaching the Mac from outside

On the same Wi-Fi the phone finds the Mac by itself, so there is nothing to do. To use it elsewhere, the phone and the Mac need one private network (a VPN) on which they can reach each other. Do not open the bridge's port to the internet on your router (port forwarding).

The phone tries the address it finds on the local network (Bonjour) and the addresses from the pairing QR at the same time, and uses whichever answers first. So nothing changes in the app between home and outside.

### Choosing a network

| Way | When | What you need |
|---|---|---|
| [A VPN service that links your devices](#a-vpn-service-that-links-your-devices) (Tailscale and the like) | The easiest. You cannot touch the router, or you carry the Mac around | Install the app on the Mac and the phone and sign in to the same account |
| [The VPN server on your home router](#the-vpn-server-on-your-home-router) (OpenVPN, WireGuard) | Your router has a VPN server and you would rather not depend on another service | Turn the VPN server on and put a profile on the phone; on the Mac too if you carry it around |
| [A company VPN](#a-company-vpn) | A company Mac that must stay on the company network | Help from the VPN administrator |

A paid VPN that hides your internet address (the kind where you pick a country) does not connect your own devices to each other, so it cannot be used.

### The steps in common

Whichever way you choose, the job is the same: tell Antenna the IP address the Mac has on that network, then scan the QR again.

1. First pair on the same Wi-Fi and check that the app works ([Quick start](../README.md#quick-start)).
2. Put the phone and the Mac on the network you chose (see the sections below).
3. Give the Mac's IP address on that network with `sh install.sh --host <address>`. Several addresses can be given with commas. Use the IP address; host names have not been tested.
4. Run `sh deploy/pair.sh` and scan again. The address travels to the phone inside the QR.
5. Turn Wi-Fi off on the phone, turn the VPN on, and open the app to see that it connects.

The health check (`node deploy/doctor.mjs`) tells you if an address in `PI_REMOTE_HOSTS` is not currently up on the Mac. After a reboot the bridge waits up to 90 seconds for that address and then, if notifications are set up, tells the phone whether the outside path is ready.

The connection is encrypted and the app trusts only your Mac's certificate. Even so, keep the port off the public internet and reach the Mac over a private network.

### A VPN service that links your devices

Tailscale is the example here; similar services work the same way.

1. Install the Tailscale app on the Mac and the phone and sign in to the same account.
2. Look up the Mac's Tailscale address (it is under the Tailscale icon in the menu bar). It starts with `100.`.
3. Run `sh install.sh --host <that address>` and scan the QR again.

The app reconnects by itself, so nothing more is needed when you carry the Mac around. On a company Mac, check first that you are allowed to install such an app.

### The VPN server on your home router

This is what the author uses every day (the router's OpenVPN server).

**On the router**

1. Turn on the VPN server (OpenVPN or WireGuard) in the admin page. The menu's name and place differ by router; follow the maker's guide.
2. Your home's internet address can change. Turn on the router's DDNS (a name that follows the changing address) and make the profile connect to that name.
3. Make a separate profile (an `.ovpn` file for OpenVPN) for each device. A phone and a Mac sharing one profile can knock each other off.
4. Let devices that come in over the VPN reach the devices at home (usually a setting named like "local network access").

If your home internet has an address that cannot be reached from outside (one your provider shares among many homes), this way does not work. Use a VPN service from the section above.

**On the phone**, install OpenVPN Connect (or WireGuard) and import the profile.

**If the Mac always stays at home**, the Mac does not need the VPN. Give its home network address.

```sh
ipconfig getifaddr en0             # the Mac's home network address (may not be en0 on a wired connection)
sh install.sh --host <that address>
```

Give the Mac a fixed address on the router (a DHCP reservation) so it does not change.

**If you carry the Mac around**, keep the Mac on the same VPN too and give the address it has on the VPN. Then the phone uses that one address wherever the Mac is.

- Make the Mac's profile send only home-side addresses through the VPN; otherwise all of the Mac's internet traffic goes through your home. For OpenVPN, add `route-nopull` and list only the ranges you need with `route` lines.
- On the VPN server, allow devices on the VPN to talk to each other (`client-to-client` in OpenVPN). If this is blocked, the phone cannot reach the Mac.
- Have the server give that device a fixed VPN address. If it changes, do `--host` and the QR again.
- The Mac's VPN address is the `inet` value of the entry that starts with `utun` in `ifconfig`.
- With OpenVPN, use [Keeping the Mac on an OpenVPN server](#keeping-the-mac-on-an-openvpn-server) so it reconnects by itself. The WireGuard app reconnects by itself.

### A company VPN

It works when the phone and the Mac can reach each other on the company VPN. The four things below can only be done by the VPN administrator, so ask before you start.

- Whether a phone may join the company VPN, and the profile to put on the phone
- A path from the phone to the bridge's port on the Mac (TCP 8787, or the port you changed it to). Many VPNs block traffic between connected devices
- Whether the Mac always gets the same address on that network. If it changes, `--host` and the QR have to be done again
- Whether this tool may be used on a company Mac. It lets a phone type into the Mac's terminal ([Security](../README.md#security))

Once the path is open, the rest is [the steps in common](#the-steps-in-common). If the company VPN is OpenVPN and the Mac has to reconnect by itself, use [Keeping the Mac on an OpenVPN server](#keeping-the-mac-on-an-openvpn-server).

## Building the app

Skip this section if you got the app through a TestFlight invitation.

You need Xcode, XcodeGen and a paid membership in the Apple Developer Program (the app declares the push notification capability, which free accounts cannot sign).

- The author builds with Xcode 27.2. Older versions have not been tested.
- The terminal view (SwiftTerm) uses Metal shaders, so Xcode's Metal toolchain has to be installed. If it is missing, get it with `xcodebuild -downloadComponent MetalToolchain`.
- Turn on Developer Mode on the phone (Settings › Privacy & Security › Developer Mode; it appears after the phone has been connected to Xcode once).

```sh
cp ios/Local.xcconfig.example ios/Local.xcconfig
```

Fill in two values in `ios/Local.xcconfig`. The file is ignored by git.

- `DEVELOPMENT_TEAM` — your team ID (10 characters, shown under Membership details at developer.apple.com)
- `BUNDLE_ID_PREFIX` — a prefix of your own, for example your domain reversed. The app becomes `<prefix>.piremote`.

**With Xcode**

```sh
(cd ios && xcodegen generate && open PiRemote.xcodeproj)
```

Connect the phone to the Mac and trust it, then select the phone in Xcode and run. Run `xcodegen generate` again whenever `project.yml` or the xcconfig files change.

**From the command line** (phone on the same Wi-Fi as the Mac)

`sh deploy/install-ios.sh` builds and installs using an App Store Connect API key instead of an Xcode account. It reads:

- `~/.appstoreconnect/config` — `ASC_KEY_ID` and `ASC_ISSUER_ID`; the key file goes in `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8`
- `~/.config/pi-remote/env` — `PI_REMOTE_DEVICE`, the identifier of your phone from `xcrun devicectl list devices`

`deploy/testflight.sh` and `deploy/testflight-setup.mjs` upload a build to TestFlight, which also works when the phone is not on the same network. They are written for the author's app identifier and profile names, so adapt them before using them with your own account.

## Notifications

Notifications go from the bridge straight to Apple's push service with your own key, so they work only with an app you built and signed yourself.

1. At developer.apple.com create a key with Apple Push Notifications service enabled and download the `.p8` file.
2. Add four lines to `~/.config/pi-remote/env`:

   ```sh
   PI_REMOTE_APNS_KEY=~/.config/pi-remote/AuthKey_XXXXXXXXXX.p8
   PI_REMOTE_APNS_KEY_ID=XXXXXXXXXX
   PI_REMOTE_APNS_TEAM=YYYYYYYYYY
   PI_REMOTE_APNS_TOPIC=<prefix>.piremote
   ```

   `PI_REMOTE_APNS_TOPIC` is the app's bundle identifier.
3. Restart the bridge and allow notifications in the app.

You are notified when an agent asks a question or needs an approval, and when a task finishes after running longer than a threshold you set in the app (one hour by default). While you are using the Mac, notifications are held back: a question still waiting is sent once the Mac is locked or left idle for a while, and a finished-task notice is dropped.

You are also notified when a macOS privacy prompt ("… would like to access …") is waiting on the Mac, with the tab and the permission when they can be told. macOS does not let programs click these prompts, so they cannot be approved from the phone; the tab's work continues once you answer on the Mac. This notice is also held back while you are using the Mac and sent if the prompt is still there once you stop. To see fewer prompts, add `~/Library/Application Support/Antenna/Antenna 연결부` under System Settings > Privacy & Security > Full Disk Access. The bridge runs a copy of its node under that name, so prompts and the list show it instead of "node". Every tab in the tmux started by the bridge is granted under that name, so once is enough (tabs in a tmux started before this change keep the node name until a reboot). Permissions that cannot be added ahead of time, such as controlling another app or Photos, still need one answer on the first prompt.

## Usage

The usage screen shows your Claude subscription limits. The bridge reads them with pi's login (`~/.pi/agent/auth.json`). When that login is about to expire the bridge refreshes it the same way pi does, so the lookup keeps working even if you have not used pi for a while. Per-model limits (e.g. Fable) are only available from this lookup; when there is one, the ring in the drawer becomes a double ring. Without pi's login the bridge falls back to the values recorded in `~/.cache/pi-remote/claude-accounts.json`, which the pi extension `claude-accounts` writes.

If you use two accounts (see "Two Claude accounts" below) and the second one runs on a token from `claude setup-token`, that token cannot look up usage. To see the second account's limits too, store a lookup-only login once: `node deploy/usage-login.mjs work` (open the printed address, approve with the second account and paste the code; it is saved to `~/.config/pi-remote/usage-auth.json`, readable by you only; `status` and `logout` are also available).

If you use only Claude Code, nothing records those values yet, so the screen says there is no data. A small status line helper for this is not included in this repository yet.

## Shortcuts

Installing the app adds one action to the Shortcuts app: **맥의 AI 에게 일 시키기** (give the Mac's AI a task). It opens a new background tab on the Mac and starts Claude Code or pi with the task you give it. It runs in the background without opening the app, so you can attach it to a Shortcuts automation.

| Field | Meaning |
|---|---|
| 할 일 (task) | What to tell the agent |
| 누구에게 (who) | Claude Code (the default) or pi. The tool you pick has to be installed on the Mac |
| 폴더 (folder) | The folder on the Mac to start in, for example `~/works/my-project`. Leave it empty for the home folder |

To use it, create a shortcut in the Shortcuts app, tap Add Action, and pick the action under Antenna. To run it on an event, open the Automation tab of the Shortcuts app, choose a trigger (a time of day, arriving somewhere, connecting the charger, an NFC tag and so on) and add this action. You can also say "Antenna에 일 시키기" to Siri, or find the action in Spotlight.

The task shows up in the background section of the app's drawer, marked '단축어로 시킴' (started by a shortcut). If [notifications](#notifications) are set up, you are notified when it finishes, however long it ran. In an app that gets no notifications (one installed from TestFlight), check that section to see whether it has finished.

Things to know:

- The phone has to reach the Mac at that moment: the same Wi-Fi, or the VPN from [Reaching the Mac from outside](#reaching-the-mac-from-outside) turned on. If it cannot, the shortcut shows why.
- The shortcut does not look for the Mac again. It uses the address the app last connected to and the addresses from the QR. If the Mac's address on your home Wi-Fi has changed, open the app once so it connects again.
- In an automation, choose to run it without asking ("Run Immediately"). Otherwise you have to confirm on the phone every time the trigger fires.
- After restarting the phone, unlock it once so the app can read its connection token.
- The agent starts with the same settings it normally has in that folder. If it asks for an approval, the card and the notification reach the phone as usual.
- If the Antenna on the Mac is an older version that does not know this action, the shortcut says so. [Update](#updating) the Mac.

## Optional features

Nothing here is installed by `install.sh`.

### Background jobs

```sh
sh deploy/install-agents.sh <name> [<name> …]   # install the ones you name
sh deploy/install-agents.sh --all               # everything
```

| Name | What it does |
|---|---|
| `claude-auto-update` | Updates Claude Code every day at 05:00, then restarts idle sessions that still run the old version, resuming the same conversation. |
| `claude-reload` | Every 30 minutes does the same restart for sessions left on an old version after Claude Code updated itself. Only sessions idle for 30 minutes with an empty input box and no background work are touched. |
| `pi-auto-update` | Updates pi and its extensions every day at 05:00. |
| `antenna-attach` | At login opens iTerm2 attached to the tmux session. |

These were written for the author's Mac and assume a few things. On a Mac that does not match, the job can be registered but does nothing.

- `claude-auto-update`, `claude-reload` — Claude Code has to be at `~/.local/bin/claude` (where Anthropic's install script puts it). A copy installed with Homebrew or npm is not found
- `pi-auto-update` — finds pi only under a Node installed with nvm
- `antenna-attach` — needs iTerm2, and tmux installed with Homebrew

To remove one: `launchctl bootout gui/$(id -u)/com.munggo.<name>` and delete `~/Library/LaunchAgents/com.munggo.<name>.plist`.

### Two Claude accounts

If you have two Claude subscriptions (say personal and work), Antenna can pick one by folder and switch to the other when the first is close to its limit.

- List the folders that should default to the second account in `~/.config/pi-remote/work-dirs`, one per line. `~` is allowed and `#` starts a comment. Without this file the first account is used everywhere.
- The second account's token is read from the macOS keychain item `pi-anthropic-work`. Create it with `claude setup-token` while signed in to that account, then:

  ```sh
  security add-generic-password -s pi-anthropic-work -a "$USER" -T /usr/bin/security -w
  ```

- For Claude Code, `~/.claude/pi-remote/claude-account <folder>` prints the account to use in that folder (`work` or `personal`), and `~/.claude/pi-remote/claude-as.sh <account>` starts Claude Code with that account (for `work` it passes the keychain token as `CLAUDE_CODE_OAUTH_TOKEN`). Put a function in your shell settings (`~/.zshrc`) so every start uses the right account:

  ```sh
  claude() {
    ~/.claude/pi-remote/claude-as.sh "$(~/.claude/pi-remote/claude-account "$PWD")" "$@"
  }
  ```

  When a limit makes it switch accounts, it does not resume the same conversation under the other account (that causes problems). The feed switches in this order:
  1. When the default account passes 95%, it stops the current work with Esc even mid-task (the remaining usage is needed to write the handoff). Switching back to the default account waits until the session is idle. Either way it waits while a permission prompt, question, running command, background job or text in the input box is present.
  2. It asks the current session for a handoff document as its answer and saves it to `<working folder>/.work/handoff/<time>.md` (with a `.gitignore` in that folder so git ignores it). If no document arrives within 10 minutes (for example, the limit is already used up), it goes on without one.
  3. `/clear` → `/exit` → starts a new conversation with `claude-as.sh`.
  4. It tells the new session to read the handoff document (or, without one, the previous transcript file) and carry on.

  Messages sent from the phone during the switch are not typed in; the phone gets a notice instead. The right account is used even in a shell opened before you changed the shell function. If the account is still unchanged after the restart, it stops switching for 6 hours and notifies your phone.

  You can also pick the account per tab in the app. Tap the account chip in a Claude Code tab's input bar (it shows the current account) and choose auto, personal or work. The tab is then restarted on that account in the same way; if it is working, the switch waits until the current task is done (meanwhile the chip shows, for example, "개인→회사", personal to work). The picked account becomes that tab's default: when it passes 95% the tab moves to the other account (with a phone notification) and comes back when the limit resets. Choosing auto goes back to picking by folder and limits. The choice stays with that tab (tmux window); tabs restored after a reboot start on auto.
- For pi, install the extension: `sh pi-extension/install.sh --with claude-accounts`.
- Switching by limit needs each account's usage, and for now only the pi extension `claude-accounts` records it (`~/.cache/pi-remote/claude-accounts.json`). On a Mac with Claude Code only, choosing by folder is all that works. If you store a lookup-only login for the second account (see "Usage" above), the bridge records that account's values in this file.

### Keeping the Mac on an OpenVPN server

Needed only if your private network is an OpenVPN server and the Mac must reconnect by itself. Tailscale and the WireGuard app already do that.

```sh
brew install openvpn
```

Add to `~/.config/pi-remote/env`:

```sh
PI_REMOTE_VPN_CONFIG=~/.config/pi-remote/client.ovpn   # your client profile
PI_REMOTE_VPN_GATEWAY=10.8.0.1                         # optional: an address across the tunnel, pinged every 30 seconds
```

Then:

```sh
sh deploy/install-vpn-guard.sh --print   # show the script that would be installed
sudo sh deploy/install-vpn-guard.sh      # install it as a root background job
```

The guard runs OpenVPN as root with your profile. Keep that file writable only by you; the installer refuses a profile other users can modify. To remove: `sudo launchctl bootout system/com.munggo.pi-remote-vpn-guard`, then delete `/usr/local/bin/pi-remote-vpn-guard.sh` and `/Library/LaunchDaemons/com.munggo.pi-remote-vpn-guard.plist`.

### More pi extensions

```sh
sh pi-extension/install.sh --list
sh pi-extension/install.sh --with compact-tools,web,subagent
```

- `compact-tools` — folds tool calls into one line each in pi's own terminal view
- `web` — web search and fetch tools
- `subagent` — sub-agents with roles, plus `/review` and `/security-review` prompts

Files that differ from what you already have are kept in `~/.cache/pi-remote/backup/` before being replaced. Run `/reload` in pi afterwards.

## Updating

Update the Mac and the phone separately. If only one side is new, the features you already use keep working; a newly added feature needs both sides to be new.

On the Mac:

```sh
cd antenna        # the folder you cloned into
git pull
sh install.sh
```

`install.sh` is safe to run again. It keeps your settings, replaces the Claude Code feed and the pi extensions with the new version, and restarts the bridge if the bridge code changed (the phone disconnects for a moment and reconnects). The feed of a Claude Code tab that is already running switches to the new version by itself when that tab is idle. A pi that is already running needs `/reload` to pick up the new extensions.

On the phone: if you got the app from TestFlight, get the new build in the TestFlight app (it arrives by itself if automatic updates are on). If you built it yourself, build and install it again.

Afterwards run `node deploy/doctor.mjs` to check.

## Troubleshooting

Start with the health check. It reads the settings, checks the bridge, the hooks and the installed copies, and tells you what to run.

```sh
node deploy/doctor.mjs
node deploy/doctor.mjs --fix
```

- **After scanning the QR the app says "맥에 닿지 못했어요" (could not reach the Mac).** Check that the phone and the Mac are on the same Wi-Fi. If the app has just been opened for the first time, allow local network access and scan again while the QR is still up (a code that never reached the Mac has not been used, so it still works). If it says "QR 이 만료됐어요" (the QR has expired) or "이미 쓴 QR 이에요" (the QR was already used), run `sh deploy/pair.sh` again.
- **The app cannot connect on the same Wi-Fi.** Allow local network access for the app in iOS Settings. Check that the bridge is running and the port is open (the health check shows both).
- **It worked, and some time later it cannot connect.** When the Mac sleeps, the bridge stops too. The Mac has to stay awake while you use it from the phone. Keep it plugged in and prevent sleep (leave `caffeinate -s` running in a terminal, or change System Settings so it does not sleep while plugged in). A MacBook sleeps when you close the lid.
- **It connects at home but not outside.** Check in order: the VPN is on on the phone; the Mac is on that network (the health check tells you when an address in `PI_REMOTE_HOSTS` is not up on the Mac); you scanned the QR again after changing the address; and the network does not block traffic between your devices ([Reaching the Mac from outside](#reaching-the-mac-from-outside)).
- **A Claude Code tab shows only the terminal.** The hooks are missing or the session started before they were installed. Run `sh claude-remote/install.sh` and start a new Claude Code session.
- **A pi tab shows only the terminal.** Run `sh pi-extension/install.sh`, then `/reload` in pi.
- **It worked, and now the app stays at "연결 중" (connecting), though the Mac and the network are fine.** The bridge's module folder `server/node_modules` may have been deleted, for example by a disk cleanup. The bridge keeps running on the modules it already loaded, but it cannot start tmux whenever the phone connects (`/tmp/pi-remote.err` shows "tmux 실행 실패", failed to start tmux). Within a minute the bridge notices and reinstalls from the lock file, and the next connection works (needs the network; no restart needed). To fix it right away, run `node deploy/doctor.mjs --fix`. When you use a disk cleanup tool, exclude this folder: it looks like a folder that can be rebuilt, but the bridge is using it.
- **The bridge keeps restarting.** See `/tmp/pi-remote.err` and `~/.cache/pi-remote/crash.log`.
- **The QR will not scan.** Enlarge the terminal window so the code is not wrapped, and raise the screen brightness.

## Uninstalling

```sh
launchctl bootout gui/$(id -u)/com.munggo.pi-remote
rm ~/Library/LaunchAgents/com.munggo.pi-remote.plist
rm -r ~/.config/pi-remote ~/.cache/pi-remote
```

`~/.cache/pi-remote/backup/` holds your own files (pi extensions) that the install replaced. Take out anything you want back before deleting it.

On a Mac where Claude Code was hooked up, there is more. Quit the Claude Code sessions that are running first (the feed that runs for each tab ends with it).

```sh
sh claude-remote/install.sh --remove      # take the hooks out of ~/.claude/settings.json and delete the /bgtab command file
rm -r ~/.claude/pi-remote                 # the Claude Code feed files
```

The settings as they were before the change are kept in `~/.claude/settings.json.bak-pi-remote`.

Also:

- The pi extensions are plain files in `~/.pi/agent/extensions/`, so delete them yourself. `sh pi-extension/install.sh --list` shows their names. Run `/reload` in pi afterwards.
- The tmux session stays. If you do not need it, close it with `tmux kill-session -t antenna` (whatever runs in it ends too).
- If you installed any [optional features](#optional-features), remove them as each section says.
- On the phone, delete the app. Once the settings folder on the Mac is gone, the token the phone was given no longer works.
- Delete the repository folder last.
