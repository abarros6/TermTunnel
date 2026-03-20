# TermTunnel — Claude Context

## What This Project Is

TermTunnel is a mobile SSH terminal PWA. It lets the user SSH into any of their Macs from their iPhone using a browser-based terminal (xterm.js) over WebSocket, tunneled through Tailscale. Terminal sessions run inside tmux so they survive the WebSocket dropping (e.g. switching apps on iPhone).

```
iPhone (Safari PWA + xterm.js) → WebSocket → Node.js server → SSH → tmux → shell
```

## Architecture

- **server.js** — ESM Node.js. Express serves `public/` as static files. A `ws` WebSocketServer on `/ws` bridges each WebSocket connection to a local SSH session via `ssh2`. On connect, opens an SSH shell and immediately runs `exec /opt/homebrew/bin/tmux new-session -A -s termtunnel -e TERMTUNNEL=1` to attach to (or create) a persistent tmux session with the `TERMTUNNEL` env var set. Messages are JSON with base64-encoded terminal I/O.
- **public/index.html** — Single-file PWA. No build step. Loads xterm.js from CDN. Contains the connect form, xterm terminal, Copy/Paste buttons in the header, and settings panel. No toolbar — the terminal fills the screen.
- **public/manifest.json** — PWA manifest for standalone display and home screen install.
- **public/sw.js** — Service worker for offline caching (cache-first for static, network-first for everything else).
- **setup.sh** — One-shot setup script for new machines. Installs tmux, creates .env, generates SSH keys, configures pm2, adds the TermTunnel shell prompt to ~/.zshrc, and prints connection info.
- **.env** — Per-machine config. Gitignored. Contains AUTH_TOKEN, SSH credentials, port.

## Message Protocol (WebSocket)

All messages are JSON:
- `{type: 'data', data: base64}` — bidirectional terminal I/O
- `{type: 'resize', cols, rows}` — client → server on terminal resize
- `{type: 'status', data: 'connected'|'disconnected'}` — server → client
- `{type: 'error', data: string}` — server → client errors

WebSocket close code `4001` = invalid auth token.

## Key Design Decisions

- **No build step** — frontend is a single HTML file loading everything from CDN. Easy to deploy, no toolchain needed on each machine.
- **ESM throughout** — `"type": "module"` in package.json. Use `import`/`export`, not `require`.
- **Per-machine .env** — each Mac has its own AUTH_TOKEN and SSH credentials. `.env` is never committed.
- **SSH to localhost** — the server always SSHs into itself (`SSH_HOST=127.0.0.1`). Requires Remote Login enabled and SSH public key in `~/.ssh/authorized_keys`.
- **tmux for session persistence** — the shell runs inside `tmux new-session -A -s termtunnel -e TERMTUNNEL=1`. When the WebSocket drops (iOS backgrounds the app), tmux keeps the session alive. Reconnecting re-attaches. The tmux binary full path (`/opt/homebrew/bin/tmux`) is used in the exec command because the SSH session PATH may not include Homebrew. The `-e TERMTUNNEL=1` flag sets an env var that triggers the compact prompt in `~/.zshrc`.
- **Custom shell prompt** — `~/.zshrc` contains a conditional block that sets `PROMPT='%F{green}%1~%f %# '` when `$TERMTUNNEL` is set. This shows only the current folder name (e.g. `TermTunnel %`) inside TermTunnel sessions. Regular terminals are unaffected. Set up by `setup.sh`.
- **Tailscale for remote access** — no port forwarding, no public exposure. Each Mac gets a permanent `100.x.x.x` IP accessible from anywhere on the Tailscale network.
- **No toolbar** — the old scrollable key toolbar was removed. The terminal fills the full screen. Copy/Paste are in the header bar.
- **Background reconnect** — a `visibilitychange` listener silently reconnects when the user returns to the app, without showing the connect overlay.

## User's Setup (this Mac)

- **Primary machine:** MacBook Pro, username `<your-username>`
- **Tailscale IP (this Mac):** `100.x.x.x`
- **Port:** `3000`
- **AUTH_TOKEN:** stored in `.env` (gitignored) — retrieve with `grep AUTH_TOKEN .env`
- **SSH key:** `~/.ssh/id_ed25519` — added to `authorized_keys`
- **tmux:** installed at `/opt/homebrew/bin/tmux`
- **pm2:** running, process saved, startup registered
- **Node firewall:** allowed via `socketfilterfw`
- **Tailscale:** installed as Mac App (menu bar app), iPhone connected on same account

## Adding a New Machine

Run `bash setup.sh` from the repo root after cloning. The script handles everything. See README.md for the full checklist if manual setup is needed.

Key prerequisites the script does NOT handle automatically:
- Remote Login must be enabled in System Settings before running (SSH won't work without it)
- The `pm2 startup` sudo command must be run manually from the terminal after the script finishes

## Dependencies

- `express` — static file serving + HTTP server
- `ws` — WebSocket server
- `ssh2` — SSH client (connects to localhost)
- `dotenv` — loads .env
- `tmux` — system dependency (not npm), installed via Homebrew

## Common Commands

```bash
bash setup.sh                   # set up a new machine (run once)
node server.js                  # run directly
pm2 start server.js --name termtunnel  # run with pm2
pm2 logs termtunnel             # view logs
pm2 restart termtunnel          # restart
grep AUTH_TOKEN .env            # retrieve token
tailscale ip -4                 # get this machine's Tailscale IP
ssh <username>@127.0.0.1                # test SSH works locally
curl http://localhost:3000/health  # test server is up
tmux attach -t termtunnel       # attach to the terminal session locally
tmux kill-session -t termtunnel # kill session (next connect starts fresh)
```

## Things to Know

- The frontend stores connection config (host, port, token) in `localStorage` and auto-connects on load if config exists.
- Auto-reconnect uses exponential backoff (1s → 15s cap, max 5 attempts), controlled by a settings toggle.
- When the app returns to foreground (`visibilitychange`), if the WebSocket is dead and the user was previously connected, it immediately reconnects without showing the overlay.
- **Copy** button copies the current xterm selection to the iPhone clipboard. **Paste** reads from clipboard and sends to terminal. Both are in the header bar.
- `visualViewport` resize listener handles the iOS virtual keyboard pushing the terminal up.
- xterm's `FitAddon` is called on both `ResizeObserver` and `visualViewport` resize events.
- The tmux status bar appears at the bottom of the terminal. Hide it with `echo 'set -g status off' >> ~/.tmux.conf`.
- The tmux session is named `termtunnel`. It persists until explicitly killed or the Mac reboots (pm2/launchd restarts the Node server on reboot, but tmux sessions don't survive a reboot).
- The shell prompt inside TermTunnel is controlled by the `TERMTUNNEL` env var set by tmux. The prompt block lives in `~/.zshrc` — edit it there to customise colour or format. `%1~` = folder name only, `%~` = full path from home.
