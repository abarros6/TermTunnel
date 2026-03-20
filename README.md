# TermTunnel

Mobile SSH terminal PWA. Access any Mac's shell from your iPhone over WebSocket + Tailscale.

```
iPhone (Safari PWA) → Tailscale → WebSocket → Node.js → SSH → tmux → shell
```

Sessions run inside **tmux** — switching apps on your phone doesn't kill your session. Come back and pick up exactly where you left off.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Before You Start](#before-you-start)
3. [Step 1 — Install Tailscale](#step-1--install-tailscale)
4. [Step 2 — Clone and Run Setup](#step-2--clone-and-run-setup)
5. [Step 3 — Connect from Your Phone](#step-3--connect-from-your-phone)
6. [Using the App](#using-the-app)
7. [Session Persistence](#session-persistence)
8. [Managing Multiple Macs](#managing-multiple-macs)
9. [Settings](#settings)
10. [Shell Prompt](#shell-prompt)
11. [.env Reference](#env-reference)
12. [Keep It Running](#keep-it-running)
13. [Porting to Other Operating Systems](#porting-to-other-operating-systems)
14. [Security](#security)
15. [Common Commands](#common-commands)
16. [Troubleshooting](#troubleshooting)

---

## How It Works

- **server.js** — Node.js server. Serves the PWA and bridges WebSocket connections from your phone to a local SSH session.
- **public/index.html** — Single-file PWA with xterm.js terminal, clipboard buttons, and settings. No build step.
- **tmux** — Keeps your shell alive on the server when the WebSocket drops. Reconnecting re-attaches to the same session.
- **Tailscale** — Private encrypted network between your devices. Each Mac gets a stable `100.x.x.x` IP reachable from anywhere — no port forwarding, no public exposure.
- **.env** — Per-machine config (SSH credentials, port, auth token). Never committed to git.

---

## Before You Start

You need a Mac running macOS 12 (Monterey) or later. Have the following ready before running setup:

| Requirement | Why | How to get it |
|---|---|---|
| macOS account password | sudo access for firewall + SSH | — |
| Internet connection | Downloads Homebrew, Node, tmux | — |
| Tailscale account | Free — used for private networking | [tailscale.com](https://tailscale.com) |
| iPhone with Safari | Runs the terminal PWA | — |

The setup script installs everything else automatically (Homebrew, Node.js, tmux, pm2).

---

## Step 1 — Install Tailscale

Tailscale must be set up **before** running the setup script so it can print your connection URL at the end.

### On your Mac

1. Open the **Mac App Store** and search for **Tailscale**, or go to [tailscale.com/download](https://tailscale.com/download)
2. Install and open the app — a compass icon appears in your menu bar
3. Click the menu bar icon → **Log in**
4. Sign in with Google, GitHub, Microsoft, or email — **remember which one you use**
5. macOS will ask permission to add a VPN configuration — click **Allow**
6. The menu bar icon turns solid when connected

Verify it's working:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4
# prints something like: 100.x.x.x
```

### On your iPhone

1. Install **Tailscale** from the App Store
2. Open it and sign in with the **exact same account** as your Mac
3. Tap **Connect** — iOS asks to add a VPN configuration, tap **Allow**
4. Both devices should appear in each other's Tailscale app with green dots

> **Note:** Both your Mac and iPhone must be connected to Tailscale at the same time for TermTunnel to work. You do not need to be on the same Wi-Fi — Tailscale works over cellular, different networks, etc.

---

## Step 2 — Clone and Run Setup

Open Terminal on your Mac and run:

```bash
git clone <your-repo-url> ~/termtunnel
cd ~/termtunnel
bash setup.sh
```

The script runs through 10 steps automatically:

| Step | What it does |
|---|---|
| 1 | Checks for Xcode Command Line Tools (installs if missing — requires a click) |
| 2 | Checks for Homebrew (installs if missing) |
| 3 | Checks for Node.js 18+ (installs via Homebrew if missing) |
| 4 | Installs tmux via Homebrew (if missing) |
| 5 | Runs `npm install` |
| 6 | Creates `.env` with your username and a generated auth token |
| 7 | Enables Remote Login, generates SSH key, adds it to `authorized_keys` |
| 8 | Allows Node.js through the macOS firewall |
| 9 | Adds the compact TermTunnel prompt to `~/.zshrc` |
| 10 | Installs pm2, starts the server, registers it to launch on login |

**It will ask for your password** — this is needed for firewall and Remote Login configuration.

At the end you'll see:

```
╔══════════════════════════════════════╗
║       Setup complete! ✓              ║
╚══════════════════════════════════════╝

  Your auth token:
  2f82ca97...

  Connect from your phone:
  Open Safari and go to: http://100.x.x.x:3000
  Enter the token above when prompted.
```

**Save your auth token** — you'll need it once when connecting from your phone. After that it's stored in the browser.

### If the script stops at Xcode

The first time you run it on a fresh Mac, a dialog box appears asking to install Xcode Command Line Tools. Click **Install**, wait for it to finish (~5 minutes), then run `bash setup.sh` again.

### Retrieving your token later

```bash
grep AUTH_TOKEN ~/termtunnel/.env
```

---

## Step 3 — Connect from Your Phone

1. Make sure Tailscale is connected on your iPhone (green dot in the Tailscale app)
2. Open **Safari** on your iPhone
3. Go to the URL printed by the setup script — e.g. `http://100.x.x.x:3000`
4. Fill in the connect screen:
   - **Host** — the Mac's Tailscale IP (e.g. `100.x.x.x`)
   - **Port** — `3000`
   - **Token** — the auth token from setup (or run `grep AUTH_TOKEN ~/termtunnel/.env` on the Mac)
5. Tap **CONNECT**

The app remembers your connection details and auto-connects on next open.

### Install as a home screen app (recommended)

In Safari: tap the **Share** button → **Add to Home Screen** → give it a name (e.g. "MacBook Pro") → **Add**. This gives you a full-screen icon on your iPhone home screen with no browser chrome.

---

## Using the App

### Clipboard

The header bar has **Copy** and **Paste** buttons:

- **Copy** — select text in the terminal first (long-press to start selection), then tap Copy to send it to your iPhone clipboard
- **Paste** — reads your iPhone clipboard and types it into the terminal. iOS will ask for clipboard permission the first time — tap **Allow**

### Settings

Tap **⚙** in the header to open settings:

- **Font Size** — make text larger or smaller
- **Scrollback** — how many lines of history to keep
- **Cursor Style** — block, underline, or bar
- **Auto-Reconnect** — automatically retry on disconnect (exponential backoff, up to 5 attempts)

All settings are saved in the browser and persist between sessions.

### Reconnecting

Tap **⟳** in the header to manually force a reconnect. The app also reconnects automatically when you return to it from another app.

---

## Session Persistence

Your terminal session runs inside **tmux** on the Mac. This means:

- **Switch to another app** → come back → TermTunnel reconnects and re-attaches to your tmux session. Your shell is exactly where you left it, including running processes.
- **Drop the network** → reconnect → same thing. The session on the Mac never stopped.
- **Close the app entirely** → open it again → same tmux session is still there on the Mac, waiting.
- **Mac restarts** → new session on reconnect (tmux doesn't survive reboots, but the server starts automatically via pm2).

The tmux session is named `termtunnel`. You can interact with it from the Mac's own terminal:

```bash
tmux attach -t termtunnel        # attach from Mac's Terminal
tmux kill-session -t termtunnel  # force a fresh session next connect
tmux ls                          # list all sessions
```

### Hide the tmux status bar

By default tmux shows a green status bar at the bottom. To hide it:

```bash
echo 'set -g status off' >> ~/.tmux.conf
```

Reconnect from your phone for it to take effect.

---

## Managing Multiple Macs

Run `bash setup.sh` on each Mac you want to access. Each Mac gets its own auth token and Tailscale IP.

| Machine | Tailscale IP | Port | Token |
|---|---|---|---|
| MacBook Pro | `100.x.x.x` | 3000 | from that Mac's `.env` |
| Mac Mini | `100.x.x.x` | 3000 | from that Mac's `.env` |
| Mac Studio | `100.x.x.x` | 3000 | from that Mac's `.env` |

All servers run on port 3000 — separate machines, separate Tailscale IPs, no conflict.

On your phone, add each Mac as its own home screen app (Share → Add to Home Screen) with a descriptive name.

---

## Shell Prompt

Inside a TermTunnel session the shell prompt is simplified to show only the current folder name:

```
termtunnel %
projects %
~ %
```

This is configured automatically by `setup.sh`. It works by:
- Passing `TERMTUNNEL=1` into the tmux session environment
- A block in `~/.zshrc` detects this variable and sets a compact prompt

Your regular Terminal app on the Mac is completely unaffected.

To customise the prompt, edit `~/.zshrc` and find the TermTunnel block:

```zsh
if [[ -n "$TERMTUNNEL" ]]; then
  PROMPT='%F{green}%1~%f %# '
fi
```

Options:
- `%1~` — current folder name only (default)
- `%~` — full path from home (e.g. `~/projects/termtunnel`)
- `%F{cyan}` / `%F{white}` / `%F{yellow}` — change colour

After editing, kill the tmux session so the next connect picks up the change:

```bash
tmux kill-session -t termtunnel
```

---

## .env Reference

Created automatically by `setup.sh`. Located at `~/termtunnel/.env`.

```env
PORT=3000            # Port the server listens on
SSH_HOST=127.0.0.1   # Always localhost — server SSHs into itself
SSH_PORT=22          # SSH daemon port
SSH_USER=username    # Your macOS username (set by setup.sh from whoami)
SSH_KEY_PATH=~/.ssh/id_ed25519   # Private key path (set by setup.sh)
SSH_PASSWORD=        # Optional: use password auth instead of key
AUTH_TOKEN=abc123... # Secret token — your phone must send this to connect
```

Each Mac must have its own unique `AUTH_TOKEN`. Never commit `.env` to git (it's in `.gitignore`).

---

## Keep It Running

pm2 is set up by the setup script to start TermTunnel automatically when you log in.

```bash
pm2 status               # is it running?
pm2 logs termtunnel      # view live logs
pm2 restart termtunnel   # restart the server
pm2 stop termtunnel      # stop the server
pm2 start termtunnel     # start it again
```

### If the server isn't starting on login

The `pm2 startup` registration may have failed. Run this manually:

```bash
cd ~/termtunnel
pm2 start server.js --name termtunnel
pm2 save
pm2 startup              # prints a sudo command — copy and run it
```

### Alternative: launchd (no pm2)

<details>
<summary>Expand launchd instructions</summary>

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
      <string>/opt/homebrew/bin/node</string>
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

Replace `YOUR_USERNAME` with the output of `whoami`. Then:

```bash
launchctl load ~/Library/LaunchAgents/com.termtunnel.plist
```

</details>

---

## Porting to Other Operating Systems

The Node.js server (`server.js`) is cross-platform. The setup script and some dependencies are macOS-specific.

### Linux

Linux is the easiest port — all the same tools exist, just different package managers.

**1. Install dependencies**

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y git nodejs npm tmux openssh-server

# Fedora / RHEL
sudo dnf install -y git nodejs npm tmux openssh-server
```

Node.js from apt is often outdated — for v18+ use [NodeSource](https://github.com/nodesource/distributions) or `nvm`.

**2. Enable SSH daemon**

```bash
sudo systemctl enable --now ssh     # Debian/Ubuntu
sudo systemctl enable --now sshd    # Fedora/RHEL
```

**3. Open firewall port**

```bash
# ufw (Ubuntu)
sudo ufw allow 3000/tcp

# firewalld (Fedora/RHEL)
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload
```

**4. Fix setup.sh for Linux**

Two things differ from macOS:

- Change `sed -i ''` → `sed -i` in setup.sh (GNU sed doesn't accept the empty-string argument)
- Remove or replace the `socketfilterfw` firewall block with `ufw`/`firewalld` commands above

Everything else in setup.sh works on Linux as-is.

**5. Shell prompt (if using bash)**

Add to `~/.bashrc` instead of `~/.zshrc`:

```bash
if [[ -n "$TERMTUNNEL" ]]; then
  PS1='\[\033[32m\]\W\[\033[0m\] \$ '
fi
```

**6. pm2 auto-start**

pm2 uses systemd on Linux — `pm2 startup` handles this automatically:

```bash
pm2 startup systemd
# run the sudo command it prints
pm2 save
```

---

### Windows (WSL 2)

Native Windows is not supported. Run it under **WSL 2** (Windows Subsystem for Linux):

1. Install WSL 2: open PowerShell as Administrator and run `wsl --install`, then restart
2. Open the WSL Ubuntu terminal
3. Follow the **Linux** instructions above inside WSL
4. Install **Tailscale for Windows** (the native app) — it automatically covers the WSL network
5. Connect from your phone using the Windows machine's Tailscale IP

> pm2 auto-start in WSL requires extra configuration since WSL doesn't run systemd by default. The simplest workaround is to start pm2 manually after each Windows boot: `wsl -e bash -c "cd ~/termtunnel && pm2 start server.js --name termtunnel"` added to Windows Task Scheduler on login.

---

### Differences summary

| Component | macOS | Linux |
|---|---|---|
| tmux install | `brew install tmux` | `apt install tmux` |
| tmux path | `/opt/homebrew/bin/tmux` | `/usr/bin/tmux` (auto-detected) |
| Node.js install | `brew install node` | NodeSource / nvm |
| SSH daemon | System Settings → Remote Login | `systemctl enable sshd` |
| Firewall | `socketfilterfw` | `ufw` / `firewalld` |
| `sed` syntax | `sed -i ''` | `sed -i` |
| Shell config | `~/.zshrc` | `~/.zshrc` or `~/.bashrc` |
| pm2 init system | launchd | systemd |

`server.js` itself needs no changes on any platform.

---

## Security

- **AUTH_TOKEN** gates every WebSocket connection — keep it secret and unique per machine
- **SSH key auth** — the private key never leaves the Mac; no passwords over the wire
- **Tailscale** encrypts all traffic end-to-end (WireGuard) — no ports exposed to the public internet
- **.env is gitignored** — credentials are never committed
- **localhost SSH only** — the server only SSHs into itself; it can't be used as a jump host

If you ever need to expose TermTunnel outside of Tailscale (not recommended), use HTTPS/WSS via Cloudflare Tunnel or ngrok.

---

## Common Commands

```bash
# Server
pm2 status                               # check if server is running
pm2 logs termtunnel                      # view live server logs
pm2 restart termtunnel                   # restart server
curl http://localhost:3000/health        # verify server responds

# Auth token
grep AUTH_TOKEN ~/termtunnel/.env        # print your auth token

# Tailscale
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4   # get Tailscale IP

# SSH
ssh $(whoami)@127.0.0.1                  # test SSH to localhost

# tmux session
tmux attach -t termtunnel               # attach from Mac's Terminal
tmux kill-session -t termtunnel         # kill session (fresh on next connect)
tmux ls                                 # list all tmux sessions
```

---

## Troubleshooting

### Connection problems

| Problem | Likely cause | Fix |
|---|---|---|
| Safari can't reach `100.x.x.x:3000` | Tailscale disconnected | Open Tailscale on Mac and iPhone — both must show green |
| "Connection refused" on port 3000 | Server not running | `pm2 status` — if offline: `pm2 start termtunnel` |
| Timeout / no response | Node.js blocked by firewall | Run `bash setup.sh` again, or manually: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node) && sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which node)` |
| Tailscale says connected but still can't reach server | Server crashed | `pm2 logs termtunnel` to see error, then `pm2 restart termtunnel` |

### Authentication problems

| Problem | Likely cause | Fix |
|---|---|---|
| "Invalid auth token" / close code 4001 | Wrong token entered | Run `grep AUTH_TOKEN ~/termtunnel/.env` on the Mac and re-enter it exactly |
| Connect screen keeps reappearing | Token rejected | Same as above |

### SSH problems

| Problem | Likely cause | Fix |
|---|---|---|
| "SSH auth failed" in terminal | Remote Login is off | System Settings → General → Sharing → Remote Login → ON |
| SSH auth failed after Remote Login is on | Wrong `SSH_USER` in .env | Run `whoami` and make sure it matches `SSH_USER` in `.env` |
| SSH auth failed, user and Remote Login correct | Key not in `authorized_keys` | `cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys` |
| "Host key verification failed" | 127.0.0.1 not in known_hosts | `ssh-keyscan -H 127.0.0.1 >> ~/.ssh/known_hosts` |

### Terminal / display problems

| Problem | Likely cause | Fix |
|---|---|---|
| `tmux: command not found` in session | tmux not in SSH PATH | Re-run `bash setup.sh` — it uses the full path to tmux |
| Prompt still shows `user@hostname` | Existing tmux session predates prompt config | `tmux kill-session -t termtunnel` then reconnect from phone |
| Green tmux status bar at bottom | tmux default | `echo 'set -g status off' >> ~/.tmux.conf` then reconnect |
| Garbled / wrong size display | Terminal size mismatch | Rotate phone or adjust Font Size in ⚙ settings |
| Paste button does nothing | iOS clipboard permission denied | Tap Paste again — iOS re-prompts. Also check Settings → Safari → Paste from Other Apps |

### Auto-start problems

| Problem | Likely cause | Fix |
|---|---|---|
| Server doesn't start after reboot | pm2 startup not registered | `cd ~/termtunnel && pm2 save && pm2 startup` then run the sudo command it prints |
| pm2 shows "errored" status | Server crashed on start | `pm2 logs termtunnel` to read the error |
