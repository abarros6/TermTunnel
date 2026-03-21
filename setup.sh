#!/usr/bin/env bash
# TermTunnel — one-shot setup script for a new Mac
# Run from the repo root: bash setup.sh

set -uo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; AMBER='\033[0;33m'; RED='\033[0;31m'
DIM='\033[0;90m'; BOLD='\033[1m'; RESET='\033[0m'

ok()     { echo -e "${GREEN}✓${RESET}  $*"; }
info()   { echo -e "${DIM}→${RESET}  $*"; }
warn()   { echo -e "${AMBER}!${RESET}  $*"; }
fail()   { echo -e "${RED}✗${RESET}  $*"; echo ""; exit 1; }
step()   { echo -e "\n${BOLD}${GREEN}[$1]${RESET} ${BOLD}$2${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║        TermTunnel Setup              ║${RESET}"
echo -e "${BOLD}${GREEN}║   Mobile terminal for your iPhone    ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "${DIM}This script sets up everything needed to run TermTunnel on this Mac.${RESET}"
echo -e "${DIM}sudo is required for the firewall step only.${RESET}"
echo ""

ERRORS=()

# ── Step 1: Xcode Command Line Tools ─────────────────────────────────────────
step "1/9" "Xcode Command Line Tools"

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

# ── Step 2: Homebrew ──────────────────────────────────────────────────────────
step "2/9" "Homebrew"

if command -v brew &>/dev/null; then
  ok "Homebrew $(brew --version | head -1 | cut -d' ' -f2)"
else
  info "Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || \
    fail "Homebrew install failed. Install manually from https://brew.sh then re-run."

  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  ok "Homebrew installed"
fi

# ── Step 3: Node.js ───────────────────────────────────────────────────────────
step "3/9" "Node.js"

if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
  MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [[ "$MAJOR" -lt 18 ]]; then
    warn "Node.js $NODE_VER is installed but TermTunnel requires v18+. Upgrading…"
    brew upgrade node || brew install node
  fi
  ok "Node.js $(node -e "process.stdout.write(process.versions.node)")"
else
  info "Installing Node.js via Homebrew…"
  brew install node
  ok "Node.js $(node -e "process.stdout.write(process.versions.node)") installed"
fi

# ── Step 4: tmux ─────────────────────────────────────────────────────────────
step "4/9" "tmux (session persistence)"

if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V | cut -d' ' -f2)"
else
  info "Installing tmux via Homebrew…"
  brew install tmux
  ok "tmux $(tmux -V | cut -d' ' -f2) installed"
fi

# ── Step 5: npm dependencies ──────────────────────────────────────────────────
step "5/9" "Node dependencies"

npm install --silent
ok "npm packages installed"

# ── Step 6: .env ──────────────────────────────────────────────────────────────
step "6/9" ".env configuration"

if [[ -f .env ]]; then
  warn ".env already exists — skipping (delete it and re-run to regenerate)"
else
  cp .env.example .env
  AUTH_TOKEN=$(node -e "const c=require('crypto'); process.stdout.write(c.randomBytes(32).toString('hex'))")
  sed -i '' "s/AUTH_TOKEN=/AUTH_TOKEN=${AUTH_TOKEN}/" .env
  ok ".env created"
fi

# ── Step 7: macOS firewall ────────────────────────────────────────────────────
step "7/9" "macOS firewall"

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

# ── Step 8: launchd service ───────────────────────────────────────────────────
# ── Step 8: Shell prompt ──────────────────────────────────────────────────────
step "8/9" "Shell prompt"

ZSHRC="$HOME/.zshrc"
PROMPT_MARKER="# TermTunnel — compact prompt"

if grep -q "$PROMPT_MARKER" "$ZSHRC" 2>/dev/null; then
  ok "TermTunnel prompt already in ~/.zshrc"
else
  cat >> "$ZSHRC" << 'ZSHEOF'

# TermTunnel — compact prompt (only active inside TermTunnel sessions)
if [[ -n "$TERMTUNNEL" ]]; then
  PROMPT='%F{green}%1~%f %# '
fi
ZSHEOF
  ok "Compact prompt added to ~/.zshrc"
fi

# ── Step 9: launchd service ───────────────────────────────────────────────────
step "9/9" "launchd service (auto-start + crash restart)"

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

# ── Tailscale check ───────────────────────────────────────────────────────────
TAILSCALE_IP=""
TAILSCALE_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [[ -x "$TAILSCALE_BIN" ]]; then
  TAILSCALE_IP=$("$TAILSCALE_BIN" ip -4 2>/dev/null || true)
elif command -v tailscale &>/dev/null; then
  TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
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
else
  echo -e "  ${BOLD}Connect from your phone:${RESET}"
  echo -e "  ${AMBER}Tailscale is not installed or not connected.${RESET}"
  echo -e "  Install Tailscale from the Mac App Store, sign in, then run:"
  echo -e "  ${DIM}/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4${RESET}"
  echo -e "  Use that IP in Safari: ${DIM}http://<tailscale-ip>:${PORT}${RESET}"
  ERRORS+=("Tailscale: install from Mac App Store, sign in, then note your IP with: tailscale ip -4")
fi

echo ""
echo -e "  ${DIM}grep AUTH_TOKEN .env                 # show token anytime${RESET}"
echo -e "  ${DIM}tail -f ~/.termtunnel/server.log      # view server logs${RESET}"
echo -e "  ${DIM}launchctl kickstart -k gui/$(id -u)/com.termtunnel.server  # restart${RESET}"
echo -e "  ${DIM}tmux attach -t termtunnel             # attach to terminal session${RESET}"

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${BOLD}${AMBER}Action required:${RESET}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${AMBER}!${RESET}  $err"
  done
fi

echo ""
