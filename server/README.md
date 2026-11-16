# Bridge

The bridge runs on the Mac. It attaches to your tmux session in a pty and relays everything the app needs over one WebSocket: the terminal bytes, the tab list, the chat feed of Claude Code and pi tabs, approval and question cards, usage, and notifications.

Install and settings are covered by the [README](../README.md) and the [setup guide](../docs/setup.md) ([한국어](../docs/setup.ko.md)). This file is for working on the bridge itself.

## Run by hand

```sh
npm install
PI_TMUX_SESSION=antenna node bridge.mjs
```

`run.sh` does the same with the settings from `~/.config/pi-remote/env`; the login item calls it. Pair a phone with `sh ../deploy/pair.sh`.

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

## Connecting

`ws://<host>:<port>/?cols=<N>&rows=<M>` with the device token in an `Authorization: Bearer <token>` header. (Older apps put it in the address as `token=`; that still works.)

Binary frames carry terminal bytes in both directions. Text frames carry JSON messages with a `type` field, for example `{"type":"resize","cols":100,"rows":30}` or `{"type":"new-window"}`.

Pairing uses `ws://<host>:<port>/pair` without a token: the phone sends `{"type":"pair","code":"…","name":"…"}` and gets `{"type":"paired","token":"…"}` once. The code comes from the pairing QR, lasts five minutes and works one time.

## Tests

`sh ../test.sh` runs the whole suite. The tests here start their own bridge on another port with a test tmux session and never touch the one you use.
