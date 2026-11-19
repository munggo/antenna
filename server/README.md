# Bridge

The bridge runs on the Mac. It attaches to your tmux session in a pty and relays everything the app needs over one WebSocket: the terminal bytes, the tab list, the chat feed of Claude Code and pi tabs, approval and question cards, usage, and notifications.

Install and settings are covered by the [README](../README.md) and the [setup guide](../docs/setup.md) ([한국어](../docs/setup.ko.md)). This file is for working on the bridge itself.

## Run by hand

```sh
npm install
PI_TMUX_SESSION=antenna node bridge.mjs
```

`run.sh` does the same with the settings from `~/.config/pi-remote/env`; the login item calls it. Pair a phone with `sh ../deploy/pair.sh`.

`run.sh` starts the bridge from a copy of node named `Antenna 연결부` (`~/Library/Application Support/Antenna/`), so macOS privacy prompts and the Full Disk Access list show that name instead of "node" for every tab in the tmux the bridge starts. It sets `PI_REMOTE_NODE_DIR` to the original node folder, where the bridge looks for `pi` and `npm`. When a privacy prompt is waiting on the Mac, `mac-prompts.mjs` tells the phone which tab is waiting for which permission.

## Files

- `bridge.mjs` — the WebSocket server and everything it relays
- `push.mjs` — notifications through Apple's push service
- `tabs-restore.mjs` — saving the tab list and restoring it after a reboot
- `usage-history.mjs` — usage records for the app's usage screen
- `status-line.mjs` — reading the model and thinking level from the agent's status line
- `advertise.mjs` — announcing the bridge on the local network (Bonjour)
- `reach.mjs` — whether the outside address is up on this Mac
- `crash-log.mjs` — keeping the reason when the bridge dies
- `devices.mjs` — per-device tokens and one-time pairing codes
- `tls.mjs` — the Mac's own certificate and serving TLS and plain connections on one port
- `windows.mjs` — turning the tmux window list into the tab list the app shows
- `tasks.mjs` — starting a task sent by the app's Shortcuts action in a new background tab
- `battery.mjs` — the MacBook's battery and charger state
- `deps.mjs` — guarding `node_modules`: if it is deleted (a disk cleanup did this once), the bridge reinstalls it from the lock file while it keeps running

## Modules

`node-pty` is pinned to `1.2.0-beta.18`. Version 1.1.0 on macOS leaks a pty every time it starts a program (one per phone connection), and three when the start fails, so a bridge that ran for days could use up the Mac's ptys. The beta closes them and also says why a start failed (`posix_spawn failed: No such file or directory`).

The bridge cannot work without `node_modules/node-pty/prebuilds/<platform>/spawn-helper`: node-pty starts every program through it. If the folder or that file goes missing while the bridge is running, the bridge still runs on the modules it has loaded, but every new connection fails. So `deps.mjs` checks at start, every minute, and whenever starting tmux fails, and runs `npm ci` (one at a time, waiting five minutes after a failure). The next connection works without a restart. `run.sh` runs the same check before it starts the bridge, for when the modules are gone entirely. `node ../deploy/doctor.mjs --fix` does it by hand.

## Connecting

`wss://<host>:<port>/?cols=<N>&rows=<M>` with the device token in an `Authorization: Bearer <token>` header. (Older apps put it in the address as `token=`; that still works.)

The bridge makes a certificate of its own the first time it starts (`~/.config/pi-remote/tls/`) and the pairing QR carries its fingerprint, which is the only certificate the app accepts. Plain `ws://` on the same port is accepted only when `PI_REMOTE_TLS_ONLY=1` is not set, for old builds of the app.

Binary frames carry terminal bytes in both directions. Text frames carry JSON messages with a `type` field, for example `{"type":"resize","cols":100,"rows":30}` or `{"type":"new-window","agent":"claude"}` (a new tab running one of `claude`, `pi`, `codex` or `gemini` in the folder of the tab the app was showing).

Pairing uses `wss://<host>:<port>/pair` without a token: the phone sends `{"type":"pair","code":"…","name":"…"}` and gets `{"type":"paired","token":"…"}` once. The code comes from the pairing QR, lasts five minutes and works one time.

`wss://<host>:<port>/push`, with the token, is a short connection that does not attach to tmux. The app uses it when it is woken in the background: to register Live Activity tokens, and to start a task from the Shortcuts action (`{"type":"task-start","id":"…","text":"…","agent":"claude","cwd":"…"}`, answered with `task-started` or `task-failed`). The bridge closes it after ten seconds.

## Tests

`sh ../test.sh` runs the whole suite. The tests here start their own bridge on another port with a test tmux session and never touch the one you use. `node test/deps-e2e.mjs` (not in the suite, it needs the network) deletes the modules of a copy of the bridge while it runs and checks that it reinstalls them by itself.
