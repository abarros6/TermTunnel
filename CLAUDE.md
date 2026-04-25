# TermTunnel — Claude Context

## What This Project Is

TermTunnel is a mobile terminal PWA. It gives you a full terminal on your iPhone (or Android) via a browser-based xterm.js client over WebSocket, tunneled through Tailscale. The server spawns a local pty (via `node-pty`) inside tmux so sessions survive the WebSocket dropping (e.g. switching apps on iPhone).

```
iPhone/Android (Safari/Chrome PWA + xterm.js) → WebSocket → Node.js server → node-pty → tmux → shell
```

## Architecture

- **server.js** — ESM Node.js. Express serves `public/` as static files. A `ws` WebSocketServer on `/ws` spawns a local pty via `node-pty`, then execs into a tmux session for persistence. PTY output is buffered and flushed every 16ms to reduce WebSocket message rate. Also exposes `/api/peers` (Tailscale peer discovery, probes each peer for a running TermTunnel instance) and `/api/sessions` (lists tmux sessions).
- **public/index.html** — Single-page PWA. No build step. Loads xterm.js from CDN. Contains the connect screen (with tmux session picker), xterm terminal, custom 3-page keyboard, floating status pill, settings panel, and clipboard buttons.
- **public/manifest.json** — PWA manifest for standalone display and home screen install.
- **public/sw.js** — Unregister stub. Replaces a previous caching service worker. Clears all caches from old installs and unregisters itself. Does nothing for new installs.
- **setup.sh** — One-shot setup script for new machines. Installs Xcode CLI tools, Homebrew, Node.js, tmux, npm deps, launchd service. Prints connection info at the end.
- **.env** — Optional per-machine config. Only needed to override PORT. Gitignored.
- **LIMITATIONS.md** — Reference doc covering iOS/Android PWA capabilities and restrictions.

## Message Protocol (WebSocket)

Connection: `ws(s)://host:port/ws?session=<session-name>`

All messages are JSON:

Client → Server:
- `{type: 'data', data: base64}` — terminal input
- `{type: 'resize', cols, rows}` — terminal resize

Server → Client:
- `{type: 'data', data: base64}` — terminal output
- `{type: 'status', data: 'connected'|'disconnected', keybinds: {...}}` — connection state + tmux keybinds

## Key Design Decisions

- **No build step** — frontend loads everything from CDN. Easy to deploy, no toolchain needed on each machine.
- **ESM throughout** — `"type": "module"` in package.json. Use `import`/`export`, not `require`.
- **node-pty instead of SSH** — the server spawns a local pty directly. No SSH, no SSH keys, no Remote Login requirement.
- **Per-machine .env** — each Mac has its own PORT. `.env` is never committed.
- **tmux for session persistence** — the pty execs into `tmux new-session -s <name> -e TERMTUNNEL=1`. When the WebSocket drops, tmux keeps the session alive. Reconnecting re-attaches. If a session already exists, the server creates a grouped session (`tt_ph_<name>`) so the phone gets its own terminal size without resizing the original.
- **Custom shell prompt** — `~/.zshrc` contains a conditional block that sets `PROMPT='%F{green}%1~%f %# '` when `$TERMTUNNEL` is set. Shows only the current folder name inside TermTunnel sessions. Set up by `setup.sh`.
- **Tailscale for remote access** — no port forwarding, no public exposure. Each Mac gets a permanent `100.x.x.x` IP. The connect screen discovers Tailscale peers and probes them for running TermTunnel instances.
- **Custom keyboard** — 3-page layout (QWERTY, 123, symbols). Toolbar has Esc, Tab, and arrow keys. Ctrl is a sticky modifier. Status pill hides when the keyboard is open. All key dispatch fires on `touchstart` (finger-down, zero latency). Hit testing uses exact rect for all keys with nearest-center fallback for gap taps.
- **No service worker** — the app requires a live WebSocket so offline caching is useless. `sw.js` is a cleanup stub for existing installs only. iOS home screen install works without a SW via the manifest alone.
- **launchd for process management** — `setup.sh` creates a launchd plist (`com.termtunnel.server`) with `KeepAlive` and `RunAtLoad`.
- **Manual update** — run `bash update.sh` to check for and apply updates. `/api/version` and `/api/check-update` endpoints support the in-app update check in settings.
- **Background reconnect** — a `visibilitychange` listener silently reconnects when the user returns to the app, without showing the connect overlay.

## Adding a New Machine

Run `bash setup.sh` from the repo root after cloning. The script handles everything including the launchd service.

## Dependencies

- `express` — static file serving + HTTP server
- `ws` — WebSocket server
- `node-pty` — spawns local pty processes
- `dotenv` — loads .env
- `tmux` — system dependency (not npm), installed via Homebrew by `setup.sh`

## Common Commands

```bash
bash setup.sh                                                 # set up a new machine (run once)
bash status.sh                                                # show server status, URLs, sleep settings, tmux sessions
bash update.sh                                                # check for updates and restart
node server.js                                                # run directly (for development)
tail -f ~/.termtunnel/server.log                              # view server logs
launchctl kickstart -k gui/$(id -u)/com.termtunnel.server     # restart server
launchctl list com.termtunnel.server                          # check launchd service status
pmset -g | grep -E '^ *(sleep|disksleep)'                    # check sleep settings
sudo pmset -a sleep 0 disksleep 0                             # disable sleep (recommended for always-on)
tmux attach -t termtunnel                                     # attach to terminal session locally
tmux kill-session -t termtunnel                               # kill session (next connect starts fresh)
```

## Things to Know

- The frontend stores connection config (host, port) in `localStorage` and auto-connects on load if config exists.
- Auto-reconnect uses exponential backoff (1s → 15s cap, max 5 attempts), controlled by a settings toggle.
- When the app returns to foreground (`visibilitychange`), if the WebSocket is dead and the user was previously connected, it immediately reconnects without showing the overlay.
- The **floating status pill** (top-right) shows connection state and opens the settings panel. It hides when the keyboard is open.
- The **custom keyboard** has 3 pages (QWERTY, 123, symbols). The toolbar above the keyboard has Esc, Tab (`\x09`), and four arrow keys. All dispatch is unified on `touchstart`; `findNearestKey()` handles hit testing with a rect-first, nearest-center-fallback approach.
- `visualViewport` resize listener handles layout when the keyboard opens/closes.
- xterm's `FitAddon` is called on both `ResizeObserver` and `visualViewport` resize events.
- The tmux session is named `termtunnel` by default. It persists until explicitly killed or the Mac reboots.
- The shell prompt inside TermTunnel is controlled by the `TERMTUNNEL` env var set by tmux. The prompt block lives in `~/.zshrc`. `%1~` = folder name only, `%~` = full path from home.
- The connect screen lists available tmux sessions on the current host. `/api/peers` is implemented server-side for future multi-machine Tailscale support but not yet wired up on the frontend.
- Settings are persisted in `localStorage`. The settings panel re-reads from `localStorage` every time it opens to ensure the UI reflects the saved state.

## Development Workflow

- **Single repo:** `github.com/abarros6/TermTunnel`
- **Branch from `master`:** `git checkout -b feature/my-thing`
- **Push & PR:** `git push -u origin feature/my-thing`, then open a PR
- **Squash merge to `master`:** keeping history clean
- **No direct pushes to `master`** — branch protection requires PRs
- **Both devs use Claude Code** — keep this CLAUDE.md accurate when making changes
