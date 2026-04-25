# TermTunnel

Mobile terminal PWA. Access any Mac's shell from your iPhone over WebSocket + Tailscale.

```
iPhone (Safari PWA + xterm.js) → WebSocket → Node.js → node-pty → tmux → shell
```

Sessions run inside **tmux** — switching apps on your phone doesn't kill your session.

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
13. [Updating](#updating)
14. [Development](#development)
15. [Porting to Other Operating Systems](#porting-to-other-operating-systems)
16. [Security](#security)
17. [Common Commands](#common-commands)
18. [Troubleshooting](#troubleshooting)

---

## How It Works

- **server.js** — Node.js server. Serves the PWA and bridges WebSocket connections to a local pty via `node-pty`. No SSH — talks to the shell directly.
- **public/index.html** — Single-file PWA with xterm.js terminal, custom 3-page keyboard, floating status pill, and settings panel. No build step.
- **tmux** — Keeps your shell alive when the WebSocket drops. Reconnecting re-attaches to the same session.
- **Tailscale** — Private encrypted network between your devices. Each Mac gets a stable `100.x.x.x` IP — no port forwarding, no public exposure.
- **.env** — Optional per-machine config. Only needed if you want a non-default port. Never committed to git.

---

## Before You Start

You need a Mac running macOS 12 (Monterey) or later.

| Requirement | Why | How to get it |
|---|---|---|
| macOS account password | sudo for firewall step | — |
| Internet connection | Downloads Homebrew, Node, tmux | — |
| Tailscale account | Free — private networking | [tailscale.com](https://tailscale.com) |
| iPhone with Safari | Runs the terminal PWA | — |

The setup script installs everything else (Homebrew, Node.js, tmux, qrencode).

---

## Step 1 — Install Tailscale

Tailscale must be set up **before** running setup so it can print your connection URL at the end.

### On your Mac

1. Open the **Mac App Store** and search for **Tailscale**, or go to [tailscale.com/download](https://tailscale.com/download)
2. Install, open, and click the menu bar icon → **Log in**
3. macOS asks permission to add a VPN configuration — click **Allow**
4. The menu bar icon turns solid when connected

Verify:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4
# prints something like: 100.x.x.x
```

### On your iPhone

1. Install **Tailscale** from the App Store
2. Sign in with the **exact same account** as your Mac
3. Tap **Connect** — allow the VPN configuration
4. Both devices should show green dots in each other's Tailscale app

> Both devices must be connected to Tailscale at the same time. You don't need to be on the same Wi-Fi — Tailscale works over cellular.

---

## Step 2 — Clone and Run Setup

```bash
git clone https://github.com/abarros6/TermTunnel.git ~/termtunnel
cd ~/termtunnel
bash setup.sh
```

The script runs 10 steps automatically:

| Step | What it does |
|---|---|
| 1 | Checks for Xcode Command Line Tools (installs if missing — requires a click) |
| 2 | Checks for Homebrew (installs if missing) |
| 3 | Checks for Node.js 18+ (installs via Homebrew if missing) |
| 4 | Installs tmux via Homebrew (if missing) |
| 5 | Installs qrencode via Homebrew (if missing) |
| 6 | Runs `npm install` |
| 7 | Creates `.env` |
| 8 | Allows Node.js through the macOS firewall |
| 9 | Adds the compact TermTunnel prompt to `~/.zshrc` |
| 10 | Installs and starts the launchd service (auto-start + crash restart) |

**It will ask for your password** — needed for the firewall step only.

At the end you'll see the connection URL and a QR code you can scan with your iPhone camera.

### If the script stops at Xcode

On a fresh Mac, a dialog box appears asking to install Xcode Command Line Tools. Click **Install**, wait for it to finish (~5 minutes), then run `bash setup.sh` again.

---

## Step 3 — Connect from Your Phone

1. Make sure Tailscale is connected on your iPhone (green dot in the Tailscale app)
2. Scan the QR code from setup output, or open **Safari** and go to the URL printed — e.g. `http://100.x.x.x:3000`
3. The connect screen shows any existing tmux sessions — pick one or type a new name
4. Tap **CONNECT**

The app remembers your connection and auto-connects on next open.

### Install as a home screen app (recommended)

In Safari: **Share** → **Add to Home Screen** → name it (e.g. "MacBook Pro") → **Add**. Gives you a full-screen icon with no browser chrome.

---

## Using the App

### Status bar

A floating pill in the top-right contains:

- **Status dot** — green (connected), amber (reconnecting), red (disconnected)
- **SCR** — tap to enter tmux scroll/copy mode (scroll back through history). Tap again to exit.
- **⚙** — opens the settings panel

The pill hides automatically when the keyboard is open.

### Keyboard

Tap anywhere on the terminal to open or close the keyboard. Three pages, switched with the mode buttons in the bottom row:

| Page | Contents |
|---|---|
| QWERTY | Letter keys + Shift, Ctrl, Delete, Return |
| 123 | Numbers and common symbols |
| Symbols | Less common symbols and punctuation |

Special keys:
- **Ctrl** — sticky modifier. Tap Ctrl, then a letter (e.g. Ctrl + C sends `^C`).
- **Shift** — sticky. Tap to capitalise the next letter key.
- **⌫** — hold to repeat delete.

### Toolbar

Shown above the keyboard (and optionally without it):

- **Esc** — sends Escape. Long-press for SIGQUIT (`^\`) or Alt+. (insert last argument).
- **Tab** — sends a Tab character (useful for shell autocomplete).
- **← ↑ ↓ →** — arrow keys.

---

## Session Persistence

Your shell runs inside **tmux** on the Mac:

- **Switch to another app** → come back → TermTunnel reconnects to your session. Your shell is where you left it.
- **Drop the network** → reconnect → same thing.
- **Close the app entirely** → reopen → same session.
- **Mac restarts** → new session on reconnect (tmux doesn't survive reboots; the server auto-starts via launchd).

Interact with the session from the Mac's own terminal:

```bash
tmux attach -t termtunnel        # attach from Mac Terminal
tmux kill-session -t termtunnel  # force a fresh session on next connect
tmux ls                          # list all sessions
```

### Hide the tmux status bar

```bash
echo 'set -g status off' >> ~/.tmux.conf
```

Reconnect from your phone for it to take effect.

---

## Managing Multiple Macs

Run `bash setup.sh` on each Mac. Each gets its own Tailscale IP.

Add each Mac as its own home screen app with a descriptive name ("MacBook Pro", "Mac Mini") and connect by navigating to its Tailscale IP in Safari.

---

## Settings

Tap **⚙** in the status bar.

| Setting | Default | Description |
|---|---|---|
| Font Size | 14px | Terminal font size |
| Keyboard Font Size | 22px | Key label size |
| Scrollback | 2000 lines | Terminal history buffer |
| Cursor Style | Block | Block, underline, or bar |
| Auto-Reconnect | On | Retry on disconnect (exponential backoff, up to 5 attempts) |

The panel also shows the current server version and a **Check** button to see if a newer version is available — see [Updating](#updating).

Action buttons:
- **Reconnect** — force-reconnects the WebSocket
- **Switch Session** — returns to the connect screen

All settings persist in the browser.

---

## Shell Prompt

Inside a TermTunnel session the prompt is simplified to show only the current folder:

```
projects %
~ %
```

This is set up by `setup.sh`. It works by passing `TERMTUNNEL=1` into the tmux environment; a block in `~/.zshrc` detects this and sets a compact prompt. Your regular Terminal app is unaffected.

To customise, edit `~/.zshrc` and find the TermTunnel block:

```zsh
if [[ -n "$TERMTUNNEL" ]]; then
  PROMPT='%F{green}%1~%f %# '
fi
```

Options: `%1~` (folder name only), `%~` (full path from home), `%F{cyan}` / `%F{yellow}` (colour).

After editing, kill the session so the next connect picks it up:

```bash
tmux kill-session -t termtunnel
```

---

## .env Reference

`.env` is optional — the server runs fine without it. Only create one if you need to override the defaults.

```env
PORT=3000   # default: 3000
```

---

## Keep It Running

`setup.sh` installs an auto-start service that launches TermTunnel on login and restarts it on crash.

### Prevent your Mac from sleeping

If your Mac sleeps, the server becomes unreachable over Tailscale. To disable sleep (display can still sleep):

```bash
sudo pmset -a sleep 0 disksleep 0
```

To restore defaults: `sudo pmset -a sleep 10 disksleep 10`. You can also set this in **System Settings → Energy**. Mac Minis idle at ~6–10W and are designed to run 24/7.

### macOS (launchd)

```bash
launchctl list | grep termtunnel                               # check if running
launchctl kickstart -k gui/$(id -u)/com.termtunnel.server     # restart
launchctl unload ~/Library/LaunchAgents/com.termtunnel.server.plist  # stop
launchctl load   ~/Library/LaunchAgents/com.termtunnel.server.plist  # start
tail -f ~/.termtunnel/server.log                               # view logs
```

### Linux (systemd)

```bash
systemctl --user status termtunnel    # check if running
systemctl --user restart termtunnel   # restart
systemctl --user stop termtunnel      # stop
systemctl --user start termtunnel     # start
tail -f ~/.termtunnel/server.log      # view logs
```

---

## Updating

To update, open a terminal session on the Mac and run:

```bash
cd ~/termtunnel
bash update.sh
```

The script checks for new commits, shows what changed, asks for confirmation, pulls, and restarts. Your phone session reconnects automatically once the server is back up.

You can also check for updates from your phone — tap **⚙** → **Check** next to the version number. It shows how many commits you're behind without applying anything.

---

## Development

```bash
git clone https://github.com/abarros6/TermTunnel.git
cd TermTunnel
npm install
node server.js         # start the server
```

Open `http://localhost:3000` in a browser, or point your phone at your machine's local IP while on the same network.

The frontend is a single HTML file (`public/index.html`) and `public/app.js`. No build step. Edit and reload the browser. The server is `server.js` (ESM). Restart it to pick up changes.

### Workflow

1. Branch from `master`: `git checkout -b feature/my-thing`
2. Push: `git push -u origin feature/my-thing`
3. Open a PR against `master`
4. Squash merge — keeping history clean
5. Branch auto-deletes after merge

**No direct pushes to `master`** — branch protection is on.

---

## Porting to Other Operating Systems

`server.js` is cross-platform. The setup script handles both macOS and Linux.

### Linux

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y git nodejs npm tmux qrencode

# Fedora / RHEL
sudo dnf install -y git nodejs npm tmux qrencode
```

Node.js from apt is often outdated — use [NodeSource](https://github.com/nodesource/distributions) or `nvm` for v18+.

Open firewall port:

```bash
sudo ufw allow 3000/tcp          # ufw (Ubuntu)
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload  # firewalld
```

Then just run `bash setup.sh` — it detects Linux, uses your package manager, and sets up a systemd user service.

### Windows (WSL 2)

Native Windows is not supported. Use **WSL 2**:

1. `wsl --install` in PowerShell as Administrator, then restart
2. Follow the Linux instructions above inside WSL
3. Install **Tailscale for Windows** (native app) — it covers the WSL network
4. Connect using the Windows machine's Tailscale IP

> Auto-start in WSL requires extra configuration since WSL doesn't run systemd by default. Simplest workaround: start the server manually after each boot, or use Windows Task Scheduler to run `wsl -e bash -c "cd ~/termtunnel && node server.js"` on login.

### Platform differences

| Component | macOS | Linux |
|---|---|---|
| tmux install | `brew install tmux` | `apt install tmux` |
| Node.js install | `brew install node` | NodeSource / nvm |
| Firewall | `socketfilterfw` | `ufw` / `firewalld` |
| Shell config | `~/.zshrc` | `~/.zshrc` or `~/.bashrc` |
| Auto-start | launchd | systemd |

---

## Security

- **Tailscale** encrypts all traffic end-to-end (WireGuard) — no ports exposed to the public internet
- **node-pty** spawns a local shell directly — no SSH, no Remote Login, no credentials over the wire
- **.env is gitignored** — config is never committed

If you ever need to expose TermTunnel outside Tailscale (not recommended), use HTTPS/WSS via Cloudflare Tunnel or ngrok.

---

## Common Commands

```bash
# Status
cd ~/termtunnel && bash status.sh                              # server status, URLs, sleep settings, tmux sessions

# Server
launchctl list com.termtunnel.server                          # check launchd service
launchctl kickstart -k gui/$(id -u)/com.termtunnel.server     # restart
tail -f ~/.termtunnel/server.log                              # view logs

# Tailscale
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4   # get Tailscale IP

# tmux
tmux attach -t termtunnel               # attach from Mac Terminal
tmux kill-session -t termtunnel         # kill session (fresh on next connect)
tmux ls                                 # list all sessions

# Update
cd ~/termtunnel && bash update.sh

# Power (always-on machines)
pmset -g | grep -E '^ *(sleep|disksleep)'    # check sleep settings
sudo pmset -a sleep 0 disksleep 0            # disable sleep
```

---

## Troubleshooting

### Connection problems

| Problem | Likely cause | Fix |
|---|---|---|
| Safari can't reach `100.x.x.x:3000` | Tailscale disconnected | Open Tailscale on Mac and iPhone — both must show green |
| "Connection refused" on port 3000 | Server not running | `launchctl list \| grep termtunnel` — if missing: `launchctl load ~/Library/LaunchAgents/com.termtunnel.server.plist` |
| Timeout / no response | Node.js blocked by firewall | Run `bash setup.sh` again, or allow Node in System Settings → Network → Firewall |
| Tailscale connected but still can't reach server | Server crashed | `tail -f ~/.termtunnel/server.log`, then restart |

### Terminal / display problems

| Problem | Likely cause | Fix |
|---|---|---|
| `tmux: command not found` in session | tmux not in PATH | Re-run `bash setup.sh` |
| Prompt still shows `user@hostname` | Existing session predates prompt config | `tmux kill-session -t termtunnel` then reconnect |
| Green tmux status bar at bottom | tmux default | `echo 'set -g status off' >> ~/.tmux.conf` then reconnect |
| Garbled / wrong size display | Terminal size mismatch | Rotate phone or adjust Font Size in ⚙ settings |

### Auto-start problems

| Problem | Likely cause | Fix |
|---|---|---|
| Server doesn't start after reboot | launchd plist not loaded | `launchctl load ~/Library/LaunchAgents/com.termtunnel.server.plist` |
| launchd shows error status | Server crashed on start | `tail -f ~/.termtunnel/server.log` |
| Server starts but immediately exits | Bad config or missing dependency | `tail -f ~/.termtunnel/server.log` to read the error |
