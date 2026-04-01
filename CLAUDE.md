# TermTunnel — Claude Context

## What This Project Is

TermTunnel is a mobile terminal PWA. It gives you a full terminal on your iPhone via a browser-based xterm.js client over WebSocket, tunneled through Tailscale. The server spawns a local pty (via `node-pty`) inside tmux so sessions survive the WebSocket dropping (e.g. switching apps on iPhone).

```
iPhone (Safari PWA + xterm.js) → WebSocket → Node.js server → node-pty → tmux → shell
```

## Architecture

- **server.js** — ESM Node.js. Express serves `public/` as static files. A `ws` WebSocketServer on `/ws` spawns a local pty via `node-pty`, then execs into a tmux session for persistence. PTY output is buffered and flushed every 16ms to reduce WebSocket message rate. Also exposes `/api/peers` (Tailscale peer discovery, probes each peer for a running TermTunnel instance) and `/api/sessions` (lists tmux sessions). Auto-updates by running `git pull` every 15 minutes — if new commits are found, exits with code 0 so launchd restarts it with the new code.
- **public/index.html** — Single-file PWA (~2000 lines). No build step. Loads xterm.js from CDN. Contains the connect screen (with Tailscale peer discovery and tmux session picker), xterm terminal, custom 3-page keyboard, floating status pill, D-pad, settings panel, and clipboard buttons.
- **public/manifest.json** — PWA manifest for standalone display and home screen install.
- **public/sw.js** — Service worker for offline caching (cache-first for static, network-first for everything else).
- **setup.sh** — One-shot setup script for new machines. 9 steps: Xcode CLI tools, Homebrew, Node.js, tmux, npm install, .env creation, macOS firewall, shell prompt, launchd service. Prints connection info at the end.
- **.env** — Optional per-machine config. Only needed to override PORT or set THEME_COLOR. Gitignored. See `.env.example`.
- **LIMITATIONS.md** — Reference doc covering iOS/Android PWA capabilities and restrictions.

## Message Protocol (WebSocket)

Connection: `ws(s)://host:port/ws?session=<session-name>`

All messages are JSON:

Client → Server:
- `{type: 'data', data: base64}` — terminal input
- `{type: 'resize', cols, rows}` — terminal resize
- `{type: 'pane-select', dir: 'up'|'down'|'left'|'right'}` — navigate between tmux panes

Server → Client:
- `{type: 'data', data: base64}` — terminal output
- `{type: 'status', data: 'connected'|'disconnected', keybinds: {...}}` — connection state + tmux keybinds

## Key Design Decisions

- **No build step** — frontend is a single HTML file loading everything from CDN. Easy to deploy, no toolchain needed on each machine.
- **ESM throughout** — `"type": "module"` in package.json. Use `import`/`export`, not `require`.
- **node-pty instead of SSH** — the server spawns a local pty directly. No SSH, no SSH keys, no Remote Login requirement. Simpler and lower latency than the old ssh2 approach.
- **Per-machine .env** — each Mac has its own PORT. `.env` is never committed.
- **tmux for session persistence** — the pty execs into `tmux new-session -s <name> -e TERMTUNNEL=1`. When the WebSocket drops, tmux keeps the session alive. Reconnecting re-attaches. If a session already exists, the server creates a grouped session (`tt_ph_<name>`) so the phone gets its own terminal size without resizing the original.
- **Custom shell prompt** — `~/.zshrc` contains a conditional block that sets `PROMPT='%F{green}%1~%f %# '` when `$TERMTUNNEL` is set. Shows only the current folder name inside TermTunnel sessions. Set up by `setup.sh`.
- **Tailscale for remote access** — no port forwarding, no public exposure. Each Mac gets a permanent `100.x.x.x` IP. The connect screen discovers Tailscale peers and probes them for running TermTunnel instances.
- **Custom keyboard** — 3-page layout (QWERTY, 123, symbols) with a floating status pill instead of a header bar. Features: iOS-style key callout on press, long-press for alternate characters, double-tap space for period, long-press space for Tab, Ctrl as sticky modifier, macro picker via long-press on fn button. All key dispatch fires on `touchstart` (finger-down, zero latency). Hit testing uses exact rect for all keys with nearest-center fallback for gap taps — wide keys (space, backspace) and non-data keys (ctrl, shift, page buttons) are protected by the rect pass.
- **launchd for process management** — `setup.sh` creates a launchd plist (`com.termtunnel.server`) with `KeepAlive` and `RunAtLoad`. Replaces the old pm2 approach.
- **Manual update** — run `bash update.sh` to check for and apply updates. The script fetches, shows new commits, confirms, pulls, and restarts via launchctl. `/api/version` and `/api/check-update` endpoints support the in-app update check in the settings panel.
- **Background reconnect** — a `visibilitychange` listener silently reconnects when the user returns to the app, without showing the connect overlay.

## Adding a New Machine

Run `bash setup.sh` from the repo root after cloning. The script handles everything including the launchd service. See README.md for the full checklist if manual setup is needed.

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
- **Copy** button copies the current xterm selection to the iPhone clipboard. **Paste** reads from clipboard and sends to terminal.
- The **custom keyboard** has 3 pages (QWERTY, 123, symbols) plus a macro page via long-press on the fn button. Keys show an iOS-style callout on press. Keys with alternates (e.g. long-press `e` for accented variants) show a picker strip. Double-tap space inserts a period (iOS-style), long-press space sends Tab. Long-press features can be toggled off in settings. All dispatch is unified on `touchstart`; `findNearestKey()` handles hit testing with a rect-first, nearest-center-fallback approach.
- `visualViewport` resize listener handles the iOS virtual keyboard pushing the terminal up.
- xterm's `FitAddon` is called on both `ResizeObserver` and `visualViewport` resize events.
- The tmux session is named `termtunnel` by default. It persists until explicitly killed or the Mac reboots (launchd restarts the Node server on reboot, but tmux sessions don't survive a reboot).
- The shell prompt inside TermTunnel is controlled by the `TERMTUNNEL` env var set by tmux. The prompt block lives in `~/.zshrc` — edit it there to customise colour or format. `%1~` = folder name only, `%~` = full path from home.
- The connect screen discovers other Macs running TermTunnel on the same Tailscale network and lists available tmux sessions.

## Development Workflow

- **Single repo:** `github.com/abarros6/TermTunnel`
- **Branch from `main`:** `git checkout -b feature/my-thing`
- **Push & PR:** `git push -u origin feature/my-thing`, then open a PR
- **Squash merge to `main`:** GitHub is configured to squash-merge only, keeping `main` history clean
- **Tagged releases:** semver tags on `main` after milestones (e.g. `v0.1.0`)
- **No direct pushes to `main`** — branch protection requires PRs
- **Both devs use Claude Code** — keep this CLAUDE.md accurate when making changes
