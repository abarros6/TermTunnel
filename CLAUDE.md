# TermTunnel — Claude Context

## What This Project Is

TermTunnel is a mobile SSH terminal PWA. It lets the user SSH into any of their Macs from their iPhone using a browser-based terminal (xterm.js) over WebSocket, tunneled through Tailscale.

```
iPhone (Safari PWA + xterm.js) → WebSocket → Node.js server → SSH → local shell
```

## Architecture

- **server.js** — ESM Node.js. Express serves `public/` as static files. A `ws` WebSocketServer on `/ws` bridges each WebSocket connection to a local SSH session via `ssh2`. Messages are JSON with base64-encoded terminal I/O.
- **public/index.html** — Single-file PWA. No build step. Loads xterm.js from CDN. Contains the connect form, xterm terminal, mobile toolbar, and settings panel.
- **public/manifest.json** — PWA manifest for standalone display and home screen install.
- **public/sw.js** — Service worker for offline caching (cache-first for static, network-first for everything else).
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
- **Tailscale for remote access** — no port forwarding, no public exposure. Each Mac gets a permanent `100.x.x.x` IP accessible from anywhere on the Tailscale network.

## User's Setup

- **Primary machine:** MacBook Pro, username `anthonybarros`
- **Tailscale IP (this Mac):** `100.x.x.x`
- **Port:** `3000`
- **AUTH_TOKEN:** stored in `.env` (gitignored) — user retrieves with `grep AUTH_TOKEN .env`
- **SSH key:** `~/.ssh/id_ed25519` — added to `authorized_keys`
- **Node firewall:** allowed via `socketfilterfw`
- **Tailscale:** installed as Mac App (menu bar app), iPhone connected on same account

## Adding a New Mac

The full checklist is in README.md. Key steps:
1. Clone repo, `npm install`
2. `cp .env.example .env` — generate a new AUTH_TOKEN, set SSH_USER
3. Add SSH public key to `~/.ssh/authorized_keys`
4. Allow Node through firewall (`socketfilterfw --add $(which node)`)
5. Enable Remote Login in System Settings
6. Install Tailscale app, sign in with same account
7. `pm2 start server.js --name termtunnel && pm2 save && pm2 startup`

## Dependencies

- `express` — static file serving + HTTP server
- `ws` — WebSocket server
- `ssh2` — SSH client (connects to localhost)
- `dotenv` — loads .env

## Common Commands

```bash
node server.js              # run directly
pm2 start server.js --name termtunnel  # run with pm2
pm2 logs termtunnel         # view logs
grep AUTH_TOKEN .env        # retrieve token
tailscale ip -4             # get this machine's Tailscale IP
ssh anthonybarros@127.0.0.1 # test SSH works locally
curl http://localhost:3000/health  # test server is up
```

## Things to Know

- The frontend stores connection config (host, port, token) in `localStorage` and auto-connects on load if config exists.
- Auto-reconnect uses exponential backoff (1s → 15s cap, max 5 attempts), controlled by a settings toggle.
- The mobile toolbar's Ctrl button is a modifier — tap Ctrl (turns amber), then tap a character to send the ctrl code. Auto-deactivates after one keypress.
- `visualViewport` resize listener handles the iOS virtual keyboard pushing the terminal up.
- xterm's `FitAddon` is called on both `ResizeObserver` and `visualViewport` resize events.
