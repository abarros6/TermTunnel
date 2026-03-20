# TermTunnel

Mobile SSH terminal PWA. Access any Mac's shell from your phone over WebSocket + Tailscale.

```
Phone (PWA + xterm.js) → WebSocket → Node.js server (Mac) → SSH → local shell
```

TermTunnel runs a small Node.js server on each Mac you want to access. Your phone connects to it over Tailscale — a private encrypted network that works from any location, any network.

---

## How It Works

- **server.js** — Express static server + WebSocket-to-SSH bridge. Serves the PWA and bridges WebSocket messages from your phone to a local SSH session.
- **public/index.html** — Full PWA frontend with xterm.js terminal, mobile toolbar, connect screen, and settings.
- **Tailscale** — Creates a private network between your devices. Each Mac gets a permanent `100.x.x.x` IP that works from anywhere.
- **.env** — Per-machine config: SSH credentials, port, and auth token. Never committed to git.

---

## Setting Up a New Machine (Fresh Clone)

Do this on **every Mac** you want to SSH into from your phone.

### 1. Prerequisites

- Node.js 18+ installed
- Git
- Remote Login enabled: **System Settings → General → Sharing → Remote Login → ON**
- Tailscale app installed (see Tailscale section below)

### 2. Clone and install

```bash
git clone <your-repo-url> ~/termtunnel
cd ~/termtunnel
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
PORT=3000
SSH_HOST=127.0.0.1
SSH_PORT=22
SSH_USER=your_macos_username    # run: whoami
AUTH_TOKEN=                     # generate one (see below)
```

Generate a fresh AUTH_TOKEN for this machine:

```bash
node -e "const c=require('crypto'); console.log(c.randomBytes(32).toString('hex'))"
```

Paste the output as the `AUTH_TOKEN` value. **Each machine should have its own unique token.**

### 4. Add your SSH key to authorized_keys

This lets the server authenticate to the local SSH daemon:

```bash
# If you don't have a key yet, generate one:
ssh-keygen -t ed25519 -C "termtunnel"

# Add your public key to authorized_keys:
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 5. Allow Node through the macOS firewall

Run these once per machine:

```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which node)
```

### 6. Start the server

```bash
node server.js
```

You should see:
```
[TermTunnel] Server listening on http://localhost:3000
[TermTunnel] SSH target: youruser@127.0.0.1:22
[TermTunnel] Auth token: xxxxxxxx...
```

### 7. Keep it running permanently

```bash
npm install -g pm2
pm2 start server.js --name termtunnel
pm2 save && pm2 startup
# Run the command pm2 startup prints
```

---

## Tailscale Setup (Required for Remote Access)

Tailscale connects your phone and all your Macs into a private network. Each device gets a permanent `100.x.x.x` IP that works from any network — home, office, cellular, anywhere.

### On each Mac

1. Download and install the **Tailscale app** from [tailscale.com/download](https://tailscale.com/download) or the Mac App Store
2. Open Tailscale from your menu bar (the icon looks like a compass/fan)
3. Click **Log in** and sign in with Google, GitHub, or email
4. Tailscale will ask to add a VPN configuration — click **Allow**
5. Once connected, click the menu bar icon and note your machine's IP (e.g. `100.x.x.x`)

To find the IP from the terminal:
```bash
tailscale ip -4
```

### On your iPhone

1. Install **Tailscale** from the App Store
2. Open it and sign in with the **same account** as your Macs
3. Tap **Connect** — iOS will ask permission to add a VPN configuration, tap **Allow**
4. Both your phone and Macs should show as green/active in the Tailscale app

### Verify everything is connected

Open the Tailscale app on your Mac. You should see all your devices listed with green dots and their `100.x.x.x` IPs. Your phone and all your Macs should be in the list.

---

## Connecting from Your Phone

For each Mac you want to connect to:

1. Open `http://<tailscale-ip>:3000` in Safari (e.g. `http://100.x.x.x:3000`)
2. Fill in the connect screen:
   - **Host** — the Mac's Tailscale IP (e.g. `100.x.x.x`)
   - **Port** — `3000` (or whatever PORT is set in that machine's `.env`)
   - **Token** — the AUTH_TOKEN from that machine's `.env`
3. Tap **CONNECT**

The app saves your last connection in localStorage and auto-connects on next open.

**iOS tip:** Safari → Share button → "Add to Home Screen" — gives you a full-screen app icon on your home screen. Do this once per Mac you frequently access (use different names like "Mac Mini" and "MacBook").

---

## Managing Multiple Macs

Each Mac runs its own TermTunnel server. On your phone you connect to them independently by their Tailscale IP.

| Machine | Tailscale IP | Port | Token |
|---|---|---|---|
| MacBook Pro | `100.x.x.x` | 3000 | token from that machine's .env |
| Mac Mini | `100.x.x.x` | 3000 | token from that machine's .env |

You can run all servers on port 3000 — they're separate machines with separate IPs so there's no conflict.

---

## Mobile Toolbar

The scrollable bar at the bottom sends keys that are hard to type on a phone keyboard:

| Button | Sends |
|---|---|
| **Ctrl** | Modifier — tap Ctrl (turns amber), then tap a key to send Ctrl+key |
| **Tab** | `\t` — autocomplete in shell |
| **Esc** | `\x1b` — exit vim insert mode, cancel prompts |
| **↑ ↓** | Arrow keys — navigate command history |
| **← →** | Arrow keys — move cursor in line |
| **\| ~ / - _** | Common shell characters |

**Ctrl combos:** Tap `Ctrl` first (button turns amber), then tap any character. For example: Ctrl → `c` sends SIGINT (Ctrl+C). Ctrl deactivates automatically after one keypress.

---

## Settings

Tap the ⚙ button in the header to open settings:

- **Font Size** — adjust for readability
- **Scrollback** — number of lines to keep in history
- **Cursor Style** — block, underline, or bar
- **Auto-Reconnect** — automatically retry on disconnect (exponential backoff, max 5 attempts)

Settings persist in localStorage per device.

---

## .env Reference

```env
PORT=3000           # Port the TermTunnel server listens on
SSH_HOST=127.0.0.1  # SSH target (always localhost — the server SSHs into itself)
SSH_PORT=22         # SSH port
SSH_USER=username   # Your macOS username (run: whoami)
SSH_KEY_PATH=~/.ssh/id_ed25519   # Optional: explicit key path
SSH_PASSWORD=                    # Optional: password auth instead of key
AUTH_TOKEN=abc123...             # Secret token — phone must send this to connect
```

---

## Keep It Running

### pm2 (recommended)

```bash
npm install -g pm2
cd ~/termtunnel
pm2 start server.js --name termtunnel
pm2 save && pm2 startup
```

`pm2 startup` prints a command to run — run it. After that, TermTunnel starts automatically on login and restarts if it crashes.

Useful pm2 commands:
```bash
pm2 status              # check if running
pm2 logs termtunnel     # view logs
pm2 restart termtunnel  # restart
pm2 stop termtunnel     # stop
```

### launchd (macOS native, no extra tools)

Create `~/Library/LaunchAgents/com.termtunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>com.termtunnel</string>
  <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/node</string>
      <string>/Users/YOUR_USERNAME/termtunnel/server.js</string>
    </array>
  <key>WorkingDirectory</key>   <string>/Users/YOUR_USERNAME/termtunnel</string>
  <key>RunAtLoad</key>          <true/>
  <key>KeepAlive</key>          <true/>
  <key>StandardOutPath</key>    <string>/tmp/termtunnel.log</string>
  <key>StandardErrorPath</key>  <string>/tmp/termtunnel.err</string>
</dict>
</plist>
```

Replace `YOUR_USERNAME` with your actual username (`whoami`). Then:

```bash
launchctl load ~/Library/LaunchAgents/com.termtunnel.plist
```

---

## Security

- **AUTH_TOKEN** gates all WebSocket connections — keep it secret, use a unique one per machine
- **SSH key auth** is preferred over password — key is never transmitted
- **Tailscale** encrypts all traffic end-to-end — no open ports on the public internet
- **.env is gitignored** — tokens and credentials never get committed
- If you ever expose TermTunnel outside Tailscale, always use HTTPS/WSS (Cloudflare Tunnel or ngrok)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Can't reach `100.x.x.x:3000` | Open Tailscale app on both devices — both must show green/connected |
| Tailscale shows connected but can't reach server | Restart TermTunnel: `pm2 restart termtunnel` or `node server.js` |
| Empty reply / timeout | Node not allowed in firewall — run the `socketfilterfw --add` commands from step 5 above, then restart the server |
| Auth failed (code 4001) | Token mismatch — copy AUTH_TOKEN from the target machine's `.env` exactly |
| SSH auth failed | Check Remote Login is ON in System Settings; verify `SSH_USER` matches `whoami`; check `authorized_keys` was set up |
| Connection refused on port 3000 | Server isn't running — `pm2 status` or `lsof -i :3000` |
| Garbled display / wrong size | Rotate phone or change font size in settings — terminal resizes automatically |
| Frequent disconnects | SSH keepalive is 15s — check network stability; toggle auto-reconnect in settings |
| `id_ed25519` key not found | Run `ssh-keygen -t ed25519` to generate one, or set `SSH_KEY_PATH` in `.env` |
