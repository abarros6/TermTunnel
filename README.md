# TermTunnel

Mobile terminal PWA. Access any Mac's shell from your iPhone over WebSocket + Tailscale.

```
iPhone (Safari PWA + xterm.js) → WebSocket → Node.js → node-pty → tmux → shell
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
13. [Updating](#updating)
14. [Porting to Other Operating Systems](#porting-to-other-operating-systems)
15. [Security](#security)
16. [Common Commands](#common-commands)
17. [Troubleshooting](#troubleshooting)

---

## How It Works

- **server.js** — Node.js server. Serves the PWA and bridges WebSocket connections from your phone to a local pty spawned via `node-pty`. No SSH involved — the server talks to the shell directly.
- **public/index.html** — Single-file PWA with xterm.js terminal, custom 3-page keyboard, macro shortcuts, floating status pill, and settings panel. No build step.
- **tmux** — Keeps your shell alive on the server when the WebSocket drops. Reconnecting re-attaches to the same session.
- **Tailscale** — Private encrypted network between your devices. Each Mac gets a stable `100.x.x.x` IP reachable from anywhere — no port forwarding, no public exposure.
- **.env** — Per-machine config (port, auth token). Never committed to git.

---

## Before You Start

You need a Mac running macOS 12 (Monterey) or later. Have the following ready before running setup:

| Requirement | Why | How to get it |
|---|---|---|
| macOS account password | sudo access for firewall | — |
| Internet connection | Downloads Homebrew, Node, tmux | — |
| Tailscale account | Free — used for private networking | [tailscale.com](https://tailscale.com) |
| iPhone with Safari | Runs the terminal PWA | — |

The setup script installs everything else automatically (Homebrew, Node.js, tmux, qrencode).

---

## Step 1 — Install Tailscale

Tailscale must be set up **before** running the setup script so it can print your connection URL and QR code at the end.

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
| 5 | Installs qrencode via Homebrew (if missing) |
| 6 | Runs `npm install` |
| 7 | Creates `.env` with a generated auth token; applies `THEME_COLOR` to the PWA manifest if set |
| 8 | Allows Node.js through the macOS firewall |
| 9 | Adds the compact TermTunnel prompt to `~/.zshrc` |
| 10 | Installs and starts the launchd service (auto-start + crash restart) |

**It will ask for your password** — this is needed for the firewall step only.

At the end you'll see your auth token, the connection URL, and a QR code you can scan directly with your iPhone camera to open the app.

### If the script stops at Xcode

The first time you run it on a fresh Mac, a dialog box appears asking to install Xcode Command Line Tools. Click **Install**, wait for it to finish (~5 minutes), then run `bash setup.sh` again.

### Retrieving your token later

```bash
grep AUTH_TOKEN ~/termtunnel/.env
```

---

## Step 3 — Connect from Your Phone

1. Make sure Tailscale is connected on your iPhone (green dot in the Tailscale app)
2. Scan the QR code from the setup output, or open **Safari** and go to the URL printed by the setup script — e.g. `http://100.x.x.x:3000`
3. The connect screen will show any existing tmux sessions — pick one or type a new name
4. Tap **CONNECT**

The app remembers your connection details and auto-connects on next open.

### Install as a home screen app (recommended)

In Safari: tap the **Share** button → **Add to Home Screen** → give it a name (e.g. "MacBook Pro") → **Add**. This gives you a full-screen icon on your iPhone home screen with no browser chrome.

---

## Using the App

### Status bar

A thin bar at the top of the screen contains:

- **Status dot** — green when connected, amber when reconnecting, red when disconnected
- **P0** (pane button) — appears when your tmux session has multiple panes. Shows the active pane index. Tap to cycle through panes; the current pane is highlighted in the terminal.
- **SCR** (scroll button) — appears when connected. Tap to enter scroll mode (tmux copy mode), letting you scroll back through terminal history. Tap again to exit.
- **⚙** — opens the settings panel

### Keyboard

The custom keyboard has three pages, accessible via the page buttons at the bottom right:

| Page | Contents |
|---|---|
| QWERTY | Standard letter keys. Many keys have alternates — long-press to see a picker strip (e.g. long-press `i` for `[` and `{`). |
| 123 | Numbers and common symbols |
| Symbols | Less common symbols and punctuation |

Special key behaviours:
- **Double-tap Space** — inserts a period (iOS-style)
- **Long-press Space** — sends Tab
- **Ctrl** — sticky modifier. Tap Ctrl, then tap a letter to send a control sequence (e.g. Ctrl + C).

### Toolbar

The toolbar above the keyboard contains:
- **Esc** — sends Escape. Long-press for a popup with additional control keys.
- **fn** — opens the macro page (common tmux and shell commands as one-tap buttons). Long-press for the full macro picker list.
- **← ↑ ↓ →** — arrow keys (can be hidden in settings)
- **⌨** — toggles the keyboard open/closed

### Macro page

The macro page (tap **fn**) gives you one-tap access to common actions:

- tmux: prefix, new window, next/prev window, scroll mode, detach, zoom
- Terminal: ^C, ^D, clear, cd ..
- Git: status, add ., commit, diff, log, pwd
- npm: npm run dev

### Floating D-Pad (optional)

Enable in settings. A draggable on-screen D-pad for arrow key navigation without opening the keyboard. Drag it anywhere on screen to reposition.

### Clipboard

- **Copy** — select text in the terminal (long-press to start a selection), then use the xterm selection — it's automatically available for paste within the terminal. To send selected text to your iPhone clipboard, xterm's built-in copy works on selection.
- **Paste** — tap the Paste key in the toolbar or use the iOS text input — iOS will ask for clipboard permission the first time.

---

## Session Persistence

Your terminal session runs inside **tmux** on the Mac. This means:

- **Switch to another app** → come back → TermTunnel reconnects and re-attaches to your tmux session. Your shell is exactly where you left it.
- **Drop the network** → reconnect → same thing. The session on the Mac never stopped.
- **Close the app entirely** → open it again → same tmux session is still there.
- **Mac restarts** → new session on reconnect (tmux doesn't survive reboots, but the server starts automatically via launchd).

The default tmux session is named `termtunnel`. You can interact with it from the Mac's own terminal:

```bash
tmux attach -t termtunnel        # attach from Mac's Terminal
tmux kill-session -t termtunnel  # force a fresh session next connect
tmux ls                          # list all sessions
```

### Hide the tmux status bar

```bash
echo 'set -g status off' >> ~/.tmux.conf
```

Reconnect from your phone for it to take effect.

---

## Managing Multiple Macs

Run `bash setup.sh` on each Mac you want to access. Each Mac gets its own auth token and Tailscale IP.

The connect screen discovers other Macs on your Tailscale network that are running TermTunnel and lists them automatically — no need to type IPs. Tap a machine name to switch to it.

If you add each Mac as its own home screen app (Share → Add to Home Screen), give each one a descriptive name like "MacBook Pro" or "Mac Mini" so they're easy to tell apart.

---

## Settings

Open the settings panel by tapping **⚙** in the status bar.

| Setting | Default | Description |
|---|---|---|
| Font Size | 14px | Terminal font size |
| Keyboard Font Size | 22px | Custom keyboard key label size |
| Scrollback | 2000 lines | Terminal history buffer |
| Cursor Style | Block | Block, underline, or bar |
| Auto-Reconnect | On | Retry automatically on disconnect (exponential backoff, up to 5 attempts) |
| Toolbar Arrows | On | Show/hide arrow keys in the toolbar |
| Floating D-Pad | Off | Enable draggable on-screen D-pad |

The panel also shows the current server version (git hash + branch) and a **Check** button that tells you if a newer version is available on the remote — see [Updating](#updating).

Action buttons at the top:
- **Reconnect** — force-reconnects the WebSocket
- **Switch Session** — returns to the connect screen to pick a different tmux session

All settings are saved in the browser and persist between sessions.

---

## Shell Prompt

Inside a TermTunnel session the shell prompt is simplified to show only the current folder name:

```
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
AUTH_TOKEN=abc123... # Secret token — your phone must send this to connect
# THEME_COLOR=#0a0e14  # Optional: PWA manifest colour (background, theme, icon)
```

Each Mac must have its own unique `AUTH_TOKEN`. Never commit `.env` to git (it's in `.gitignore`).

`THEME_COLOR` is optional. If set, `setup.sh` writes the colour into `public/manifest.json` so the home screen bookmark uses that colour. Useful for telling multiple Macs apart at a glance on your home screen.

---

## Keep It Running

`setup.sh` installs an auto-start service that launches TermTunnel on login and restarts it if it crashes.

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

TermTunnel does not update itself automatically. To update a machine, open a terminal session on that Mac and run:

```bash
cd ~/termtunnel
bash update.sh
```

The script checks for new commits, shows what's changed, asks for confirmation, pulls, and restarts the server. Your active terminal session on the phone will reconnect automatically once the server is back up.

You can also check for updates from your phone without SSHing in — tap **⚙** → **Check** next to the version number. It shows how many commits behind you are, without applying anything.

---

## Porting to Other Operating Systems

`server.js` is cross-platform. The setup script is macOS-specific.

### Linux

Linux is the easiest port — all the same tools exist, just different package managers. No SSH daemon is needed; TermTunnel spawns a local pty directly.

**1. Install dependencies**

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y git nodejs npm tmux qrencode

# Fedora / RHEL
sudo dnf install -y git nodejs npm tmux qrencode
```

Node.js from apt is often outdated — for v18+ use [NodeSource](https://github.com/nodesource/distributions) or `nvm`.

**2. Open firewall port**

```bash
# ufw (Ubuntu)
sudo ufw allow 3000/tcp

# firewalld (Fedora/RHEL)
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload
```

**3. Run setup.sh**

`setup.sh` detects Linux automatically and uses your package manager. Just run it:

```bash
bash setup.sh
```

It will install dependencies via `apt`/`dnf`/`pacman`, set up a systemd user service, and configure the shell prompt for bash or zsh.

**4. Shell prompt (if using bash)**

Add to `~/.bashrc` instead of `~/.zshrc`:

```bash
if [[ -n "$TERMTUNNEL" ]]; then
  PS1='\[\033[32m\]\W\[\033[0m\] \$ '
fi
```

---

### Windows (WSL 2)

Native Windows is not supported. Run it under **WSL 2** (Windows Subsystem for Linux):

1. Install WSL 2: open PowerShell as Administrator and run `wsl --install`, then restart
2. Open the WSL Ubuntu terminal
3. Follow the **Linux** instructions above inside WSL
4. Install **Tailscale for Windows** (the native app) — it automatically covers the WSL network
5. Connect from your phone using the Windows machine's Tailscale IP

> Auto-start in WSL requires extra configuration since WSL doesn't run systemd by default. The simplest workaround is to start the server manually after each Windows boot, or use Windows Task Scheduler to run `wsl -e bash -c "cd ~/termtunnel && node server.js"` on login.

---

### Differences summary

| Component | macOS | Linux |
|---|---|---|
| tmux install | `brew install tmux` | `apt install tmux` |
| Node.js install | `brew install node` | NodeSource / nvm |
| Firewall | `socketfilterfw` | `ufw` / `firewalld` |
| `sed` syntax | `sed -i ''` | `sed -i` |
| Shell config | `~/.zshrc` | `~/.zshrc` or `~/.bashrc` |
| Auto-start | launchd | systemd |

`server.js` itself needs no changes on any platform.

---

## Security

- **AUTH_TOKEN** gates every WebSocket connection — keep it secret and unique per machine
- **Tailscale** encrypts all traffic end-to-end (WireGuard) — no ports exposed to the public internet
- **node-pty** spawns a local shell directly — no SSH, no Remote Login required, no credentials over the wire
- **.env is gitignored** — credentials are never committed

If you ever need to expose TermTunnel outside of Tailscale (not recommended), use HTTPS/WSS via Cloudflare Tunnel or ngrok.

---

## Common Commands

```bash
# Server
launchctl list | grep termtunnel                 # check if running
launchctl kickstart -k gui/$(id -u)/com.termtunnel.server  # restart
tail -f ~/.termtunnel/server.log                 # view live logs
curl http://localhost:3000/health                # verify server responds

# Auth token
grep AUTH_TOKEN ~/termtunnel/.env

# Tailscale
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4   # get Tailscale IP

# tmux session
tmux attach -t termtunnel               # attach from Mac's Terminal
tmux kill-session -t termtunnel         # kill session (fresh on next connect)
tmux ls                                 # list all sessions

# Update
cd ~/termtunnel && bash update.sh       # check for and apply updates
```

---

## Troubleshooting

### Connection problems

| Problem | Likely cause | Fix |
|---|---|---|
| Safari can't reach `100.x.x.x:3000` | Tailscale disconnected | Open Tailscale on Mac and iPhone — both must show green |
| "Connection refused" on port 3000 | Server not running | `launchctl list \| grep termtunnel` — if missing: `launchctl load ~/Library/LaunchAgents/com.termtunnel.server.plist` |
| Timeout / no response | Node.js blocked by firewall | Run `bash setup.sh` again, or manually allow Node through System Settings → Network → Firewall |
| Tailscale says connected but still can't reach server | Server crashed | `tail -f ~/.termtunnel/server.log` to see the error, then restart |

### Authentication problems

| Problem | Likely cause | Fix |
|---|---|---|
| "Invalid auth token" / close code 4001 | Wrong token entered | Run `grep AUTH_TOKEN ~/termtunnel/.env` on the Mac and re-enter it exactly |
| Connect screen keeps reappearing | Token rejected | Same as above |

### Terminal / display problems

| Problem | Likely cause | Fix |
|---|---|---|
| `tmux: command not found` in session | tmux not in PATH | Re-run `bash setup.sh` — it uses the full path to tmux |
| Prompt still shows `user@hostname` | Existing tmux session predates prompt config | `tmux kill-session -t termtunnel` then reconnect |
| Green tmux status bar at bottom | tmux default | `echo 'set -g status off' >> ~/.tmux.conf` then reconnect |
| Garbled / wrong size display | Terminal size mismatch | Rotate phone or adjust Font Size in ⚙ settings |

### Auto-start problems

| Problem | Likely cause | Fix |
|---|---|---|
| Server doesn't start after reboot | launchd plist not loaded | `launchctl load ~/Library/LaunchAgents/com.termtunnel.server.plist` |
| launchd shows error status | Server crashed on start | `tail -f ~/.termtunnel/server.log` to read the error |
| Server starts but immediately exits | Missing .env or bad config | Check `.env` exists and has a valid `AUTH_TOKEN` |
