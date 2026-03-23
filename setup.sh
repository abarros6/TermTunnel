#!/usr/bin/env bash
# TermTunnel — setup script
# Run from the repo root: bash setup.sh

set -uo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; AMBER='\033[0;33m'; RED='\033[0;31m'
DIM='\033[0;90m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET}  $*"; }
info() { echo -e "${DIM}→${RESET}  $*"; }
warn() { echo -e "${AMBER}!${RESET}  $*"; }
fail() { echo -e "${RED}✗${RESET}  $*"; echo ""; exit 1; }
step() { echo -e "\n${BOLD}${GREEN}[$1]${RESET} ${BOLD}$2${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Detect OS ─────────────────────────────────────────────────────────────────
case "$(uname)" in
  Darwin) OS="mac" ;;
  Linux)  OS="linux" ;;
  *)      fail "Unsupported OS: $(uname). TermTunnel supports macOS and Linux." ;;
esac

# ── Detect package manager (Linux) ───────────────────────────────────────────
PKG_MGR=""
if [[ "$OS" == "linux" ]]; then
  if   command -v apt-get &>/dev/null; then PKG_MGR="apt"
  elif command -v dnf     &>/dev/null; then PKG_MGR="dnf"
  elif command -v pacman  &>/dev/null; then PKG_MGR="pacman"
  else fail "No supported package manager found (apt, dnf, pacman)."
  fi
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

# Cross-platform sed in-place
sedi() {
  if [[ "$OS" == "mac" ]]; then sed -i '' "$@"; else sed -i "$@"; fi
}

# Linux package install
pkg_install() {
  case "$PKG_MGR" in
    apt)    sudo apt-get install -y "$@" ;;
    dnf)    sudo dnf install -y "$@" ;;
    pacman) sudo pacman -S --noconfirm "$@" ;;
  esac
}

# Step counter
STEP=0
if [[ "$OS" == "mac" ]]; then TOTAL=10; else TOTAL=7; fi
next_step() { STEP=$((STEP+1)); step "$STEP/$TOTAL" "$1"; }

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║        TermTunnel Setup              ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${RESET}"
echo ""
if [[ "$OS" == "linux" ]]; then
  echo -e "${DIM}Platform: Linux (${PKG_MGR})${RESET}"
else
  echo -e "${DIM}Platform: macOS${RESET}"
fi
echo -e "${DIM}sudo is required for the firewall step only.${RESET}"
echo ""

ERRORS=()

# ── Step [mac]: Xcode Command Line Tools ─────────────────────────────────────
if [[ "$OS" == "mac" ]]; then
  next_step "Xcode Command Line Tools"
  if xcode-select -p &>/dev/null; then
    ok "Xcode Command Line Tools installed"
  else
    info "Installing Xcode Command Line Tools…"
    xcode-select --install 2>/dev/null || true
    echo ""
    warn "A dialog has appeared asking you to install Xcode Command Line Tools."
    warn "Click Install, wait for it to finish, then re-run this script."
    exit 0
  fi
fi

# ── Step [mac]: Homebrew ──────────────────────────────────────────────────────
if [[ "$OS" == "mac" ]]; then
  next_step "Homebrew"
  if command -v brew &>/dev/null; then
    ok "Homebrew $(brew --version | head -1 | cut -d' ' -f2)"
  else
    info "Installing Homebrew…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || \
      fail "Homebrew install failed. Install manually from https://brew.sh then re-run."
    if   [[ -f /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew    ]]; then eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
  fi
fi

# ── Step: Node.js ─────────────────────────────────────────────────────────────
next_step "Node.js"
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
  MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [[ "$MAJOR" -lt 18 ]]; then
    warn "Node.js $NODE_VER found but TermTunnel requires v18+."
    if [[ "$OS" == "mac" ]]; then
      brew upgrade node || brew install node
    else
      fail "Install Node.js 18+ via nvm (https://github.com/nvm-sh/nvm) then re-run."
    fi
  fi
  ok "Node.js $(node -e "process.stdout.write(process.versions.node)")"
else
  info "Installing Node.js…"
  if [[ "$OS" == "mac" ]]; then
    brew install node
  else
    pkg_install nodejs npm
    NODE_VER=$(node -e "process.stdout.write(process.versions.node)" 2>/dev/null || echo "0")
    MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
    if [[ "$MAJOR" -lt 18 ]]; then
      warn "Package manager provided Node.js $NODE_VER (< 18)."
      fail "Install Node.js 18+ via nvm (https://github.com/nvm-sh/nvm) then re-run."
    fi
  fi
  ok "Node.js $(node -e "process.stdout.write(process.versions.node)") installed"
fi

# ── Step: tmux ────────────────────────────────────────────────────────────────
next_step "tmux (session persistence)"
if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V | cut -d' ' -f2)"
else
  info "Installing tmux…"
  if [[ "$OS" == "mac" ]]; then brew install tmux; else pkg_install tmux; fi
  ok "tmux $(tmux -V | cut -d' ' -f2) installed"
fi

# ── Step: qrencode ────────────────────────────────────────────────────────────
next_step "qrencode (QR code for phone setup)"
if command -v qrencode &>/dev/null; then
  ok "qrencode $(qrencode --version 2>&1 | head -1)"
else
  info "Installing qrencode…"
  if [[ "$OS" == "mac" ]]; then brew install qrencode; else pkg_install qrencode; fi
  ok "qrencode installed"
fi

# ── Step: npm dependencies ────────────────────────────────────────────────────
next_step "Node dependencies"
npm install --silent
ok "npm packages installed"

# ── Step: .env ────────────────────────────────────────────────────────────────
next_step ".env configuration"
if [[ -f .env ]]; then
  warn ".env already exists — skipping (delete it and re-run to regenerate)"
else
  cp .env.example .env
  AUTH_TOKEN=$(node -e "const c=require('crypto'); process.stdout.write(c.randomBytes(32).toString('hex'))")
  sedi "s/AUTH_TOKEN=/AUTH_TOKEN=${AUTH_TOKEN}/" .env
  ok ".env created"
fi

# Apply THEME_COLOR to manifest.json if set in .env
THEME_COLOR=$(grep '^THEME_COLOR=' .env | cut -d'=' -f2 | tr -d '[:space:]' || true)
if [[ -n "$THEME_COLOR" ]]; then
  sedi "s|\"background_color\": \"#[0-9a-fA-F]*\"|\"background_color\": \"${THEME_COLOR}\"|g" public/manifest.json
  sedi "s|\"theme_color\": \"#[0-9a-fA-F]*\"|\"theme_color\": \"${THEME_COLOR}\"|g" public/manifest.json
  ENCODED_COLOR=$(echo "$THEME_COLOR" | sed 's/#/%23/')
  sedi "s|fill='%23[0-9a-fA-F]*'|fill='${ENCODED_COLOR}'|g" public/manifest.json
  ok "Manifest theme color set to ${THEME_COLOR}"
fi

# ── Step [mac]: Firewall ──────────────────────────────────────────────────────
if [[ "$OS" == "mac" ]]; then
  next_step "macOS firewall"
  NODE_PATH=$(which node)
  FW="/usr/libexec/ApplicationFirewall/socketfilterfw"
  if sudo "$FW" --getappblocked "$NODE_PATH" 2>/dev/null | grep -q "ALLOW"; then
    ok "Node.js already allowed in firewall"
  else
    info "Allowing Node.js through the macOS firewall…"
    sudo "$FW" --add "$NODE_PATH" 2>/dev/null || true
    sudo "$FW" --unblockapp "$NODE_PATH" 2>/dev/null || true
    ok "Node.js allowed in firewall"
  fi
fi

# ── Step: Shell prompt ────────────────────────────────────────────────────────
next_step "Shell prompt"
SHELL_NAME=$(basename "$SHELL")
PROMPT_MARKER="# TermTunnel — compact prompt"

if [[ "$SHELL_NAME" == "zsh" ]]; then
  SHELL_RC="$HOME/.zshrc"
  PROMPT_BLOCK=$(printf '%s\n%s\n%s\n%s' \
    "$PROMPT_MARKER (only active inside TermTunnel sessions)" \
    'if [[ -n "$TERMTUNNEL" ]]; then' \
    "  PROMPT='%F{green}%1~%f %# '" \
    'fi')
elif [[ "$SHELL_NAME" == "bash" ]]; then
  SHELL_RC="$HOME/.bashrc"
  PROMPT_BLOCK=$(printf '%s\n%s\n%s\n%s' \
    "$PROMPT_MARKER (only active inside TermTunnel sessions)" \
    'if [[ -n "$TERMTUNNEL" ]]; then' \
    "  PS1='\\[\\033[32m\\]\\W\\[\\033[0m\\] \\$ '" \
    'fi')
else
  warn "Unknown shell ($SHELL_NAME) — skipping prompt config. Add it manually to your shell rc."
  SHELL_RC=""
fi

if [[ -n "$SHELL_RC" ]]; then
  if grep -q "$PROMPT_MARKER" "$SHELL_RC" 2>/dev/null; then
    ok "TermTunnel prompt already in $SHELL_RC"
  else
    printf '\n%s\n' "$PROMPT_BLOCK" >> "$SHELL_RC"
    ok "Compact prompt added to $SHELL_RC"
  fi
fi

# ── Step: Auto-start ──────────────────────────────────────────────────────────
if [[ "$OS" == "mac" ]]; then
  next_step "launchd service (auto-start + crash restart)"
  NODE_BIN=$(which node)
  PLIST_DIR="$HOME/Library/LaunchAgents"
  PLIST_FILE="$PLIST_DIR/com.termtunnel.server.plist"
  LOG_DIR="$HOME/.termtunnel"
  LOG_FILE="$LOG_DIR/server.log"
  mkdir -p "$PLIST_DIR" "$LOG_DIR"

  cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.termtunnel.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${SCRIPT_DIR}/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
</dict>
</plist>
EOF

  ok "plist written to $PLIST_FILE"
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  launchctl load "$PLIST_FILE"
  ok "launchd service loaded — server will start now and on every login"

else
  next_step "systemd service (auto-start + crash restart)"
  NODE_BIN=$(which node)
  LOG_DIR="$HOME/.termtunnel"
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  SERVICE_FILE="$SYSTEMD_DIR/termtunnel.service"
  mkdir -p "$LOG_DIR" "$SYSTEMD_DIR"

  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=TermTunnel server
After=network.target

[Service]
ExecStart=${NODE_BIN} ${SCRIPT_DIR}/server.js
WorkingDirectory=${SCRIPT_DIR}
Restart=always
RestartSec=3
Environment=HOME=${HOME}
StandardOutput=append:${LOG_DIR}/server.log
StandardError=append:${LOG_DIR}/server.log

[Install]
WantedBy=default.target
EOF

  ok "systemd unit written to $SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable --now termtunnel
  loginctl enable-linger "$USER" 2>/dev/null || \
    warn "loginctl enable-linger failed — server may not start after reboot without a login session."
  ok "systemd service enabled — server will start now and on every login"
fi

# ── Tailscale check ───────────────────────────────────────────────────────────
TAILSCALE_IP=""
if [[ "$OS" == "mac" ]]; then
  TAILSCALE_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  TAILSCALE_INSTALL_HINT="Install Tailscale from the Mac App Store, sign in, then re-run."
  if [[ -x "$TAILSCALE_BIN" ]]; then
    TAILSCALE_IP=$("$TAILSCALE_BIN" ip -4 2>/dev/null || true)
  elif command -v tailscale &>/dev/null; then
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
  fi
else
  TAILSCALE_INSTALL_HINT="Install Tailscale from https://tailscale.com/download/linux, sign in, then re-run."
  if command -v tailscale &>/dev/null; then
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
  fi
fi

# ── Verify server ─────────────────────────────────────────────────────────────
sleep 1
PORT=$(grep '^PORT=' .env | cut -d'=' -f2 || echo "3000")
PORT=${PORT:-3000}
AUTH=$(grep '^AUTH_TOKEN=' .env | cut -d'=' -f2)

SERVER_OK=false
if curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
  SERVER_OK=true
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${RESET}"
if [[ ${#ERRORS[@]} -eq 0 && "$SERVER_OK" == true ]]; then
  echo -e "${BOLD}${GREEN}║       Setup complete! ✓              ║${RESET}"
else
  echo -e "${BOLD}${AMBER}║    Setup complete (with warnings)    ║${RESET}"
fi
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${RESET}"
echo ""

if [[ "$SERVER_OK" == true ]]; then
  ok "Server is running at http://localhost:${PORT}"
else
  warn "Server health check failed — check: tail -f ~/.termtunnel/server.log"
fi

echo ""
echo -e "  ${BOLD}Your auth token:${RESET}"
echo -e "  ${GREEN}${AUTH}${RESET}"
echo ""

if [[ -n "$TAILSCALE_IP" ]]; then
  echo -e "  ${BOLD}Connect from your phone:${RESET}"
  echo -e "  Open Safari and go to: ${GREEN}http://${TAILSCALE_IP}:${PORT}${RESET}"
  echo -e "  Enter the token above when prompted."
  echo ""
  echo -e "  ${DIM}Or scan this QR code with your iPhone camera:${RESET}"
  echo ""
  qrencode -t UTF8 "http://${TAILSCALE_IP}:${PORT}" 2>/dev/null | sed 's/^/  /' || true
else
  echo -e "  ${BOLD}Connect from your phone:${RESET}"
  echo -e "  ${AMBER}Tailscale is not installed or not connected.${RESET}"
  echo -e "  ${TAILSCALE_INSTALL_HINT}"
  ERRORS+=("Tailscale not found — install, sign in, then note your IP with: tailscale ip -4")
fi

echo ""
echo -e "  ${DIM}grep AUTH_TOKEN .env                  # show token anytime${RESET}"
echo -e "  ${DIM}tail -f ~/.termtunnel/server.log       # view server logs${RESET}"
if [[ "$OS" == "mac" ]]; then
  echo -e "  ${DIM}launchctl kickstart -k gui/$(id -u)/com.termtunnel.server  # restart${RESET}"
else
  echo -e "  ${DIM}systemctl --user restart termtunnel   # restart${RESET}"
fi
echo -e "  ${DIM}tmux attach -t termtunnel              # attach to terminal session${RESET}"

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${BOLD}${AMBER}Action required:${RESET}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${AMBER}!${RESET}  $err"
  done
fi

echo ""
