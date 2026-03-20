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
header() { echo -e "\n${BOLD}$*${RESET}"; }
step()   { echo -e "\n${BOLD}${GREEN}[$1]${RESET} ${BOLD}$2${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║        TermTunnel Setup              ║${RESET}"
echo -e "${BOLD}${GREEN}║  WebSocket SSH bridge for iPhone     ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "${DIM}This script sets up everything needed to run TermTunnel on this Mac.${RESET}"
echo -e "${DIM}It will request sudo for firewall and auto-start configuration.${RESET}"
echo ""

ERRORS=()  # collect non-fatal issues to surface at the end

# ── Step 1: Xcode Command Line Tools ─────────────────────────────────────────
step "1/10" "Xcode Command Line Tools"

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
step "2/10" "Homebrew"

if command -v brew &>/dev/null; then
  ok "Homebrew $(brew --version | head -1 | cut -d' ' -f2)"
else
  info "Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || \
    fail "Homebrew install failed. Install manually from https://brew.sh then re-run."

  # Add Homebrew to PATH for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  ok "Homebrew installed"
fi

# ── Step 3: Node.js ───────────────────────────────────────────────────────────
step "3/10" "Node.js"

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
step "4/10" "tmux (session persistence)"

if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V | cut -d' ' -f2)"
else
  info "Installing tmux via Homebrew…"
  brew install tmux
  ok "tmux $(tmux -V | cut -d' ' -f2) installed"
fi

# ── Step 5: npm dependencies ──────────────────────────────────────────────────
step "5/10" "Node dependencies"

npm install --silent
ok "npm packages installed"

# ── Step 6: .env ──────────────────────────────────────────────────────────────
step "6/10" ".env configuration"

if [[ -f .env ]]; then
  warn ".env already exists — skipping (delete it and re-run to regenerate)"
else
  cp .env.example .env

  SSH_USER=$(whoami)
  AUTH_TOKEN=$(node -e "const c=require('crypto'); process.stdout.write(c.randomBytes(32).toString('hex'))")

  sed -i '' "s/SSH_USER=your_username/SSH_USER=${SSH_USER}/" .env
  sed -i '' "s/AUTH_TOKEN=generate_with_crypto_randomBytes_32_hex/AUTH_TOKEN=${AUTH_TOKEN}/" .env
  sed -i '' "s|# SSH_KEY_PATH=~/.ssh/id_ed25519|SSH_KEY_PATH=~/.ssh/id_ed25519|" .env

  ok ".env created (SSH_USER=${SSH_USER})"
fi

# ── Step 7: SSH key + Remote Login ───────────────────────────────────────────
step "7/10" "SSH configuration"

# Enable Remote Login
info "Enabling Remote Login (SSH daemon)…"
if sudo systemsetup -setremotelogin on 2>/dev/null; then
  ok "Remote Login enabled"
else
  # systemsetup is deprecated in newer macOS — try launchctl
  sudo launchctl enable system/com.apple.remote_login 2>/dev/null && \
  sudo launchctl start com.apple.remote_login 2>/dev/null && \
  ok "Remote Login enabled" || {
    warn "Could not enable Remote Login automatically."
    warn "Enable it manually: System Settings → General → Sharing → Remote Login → ON"
    ERRORS+=("Remote Login: enable manually via System Settings → General → Sharing → Remote Login → ON")
  }
fi

# SSH key
mkdir -p ~/.ssh
chmod 700 ~/.ssh

if [[ ! -f ~/.ssh/id_ed25519 ]]; then
  info "Generating SSH key…"
  ssh-keygen -t ed25519 -C "termtunnel" -N "" -f ~/.ssh/id_ed25519 -q
  ok "SSH key generated at ~/.ssh/id_ed25519"
else
  ok "SSH key exists at ~/.ssh/id_ed25519"
fi

if ! grep -qF "$(cat ~/.ssh/id_ed25519.pub)" ~/.ssh/authorized_keys 2>/dev/null; then
  cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  ok "Public key added to ~/.ssh/authorized_keys"
else
  ok "Public key already in ~/.ssh/authorized_keys"
fi

if ! ssh-keygen -F 127.0.0.1 &>/dev/null; then
  ssh-keyscan -H 127.0.0.1 >> ~/.ssh/known_hosts 2>/dev/null
  ok "127.0.0.1 added to ~/.ssh/known_hosts"
else
  ok "127.0.0.1 already in ~/.ssh/known_hosts"
fi

# Test SSH
if ssh -o BatchMode=yes -o ConnectTimeout=5 "$(whoami)@127.0.0.1" echo "ok" &>/dev/null; then
  ok "SSH to localhost works"
else
  warn "SSH test failed — Remote Login may need a moment or manual intervention."
  ERRORS+=("SSH: test 'ssh $(whoami)@127.0.0.1' after ensuring Remote Login is ON in System Settings")
fi

# ── Step 8: macOS firewall ────────────────────────────────────────────────────
step "8/10" "macOS firewall"

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

# ── Step 9: Shell prompt ──────────────────────────────────────────────────────
step "9/10" "Shell prompt"

ZSHRC="$HOME/.zshrc"
PROMPT_MARKER="# TermTunnel — compact prompt"

if grep -q "$PROMPT_MARKER" "$ZSHRC" 2>/dev/null; then
  ok "TermTunnel prompt already in ~/.zshrc"
else
  cat >> "$ZSHRC" << 'EOF'

# TermTunnel — compact prompt (only active inside TermTunnel sessions)
if [[ -n "$TERMTUNNEL" ]]; then
  PROMPT='%F{green}%1~%f %# '
fi
EOF
  ok "Compact prompt added to ~/.zshrc"
fi

# ── Step 10: pm2 ─────────────────────────────────────────────────────────────
step "10/10" "pm2 process manager"

if ! command -v pm2 &>/dev/null; then
  info "Installing pm2 globally…"
  npm install -g pm2 --silent
  ok "pm2 installed"
else
  ok "pm2 $(pm2 --version)"
fi

if pm2 describe termtunnel &>/dev/null 2>&1; then
  pm2 restart termtunnel --silent
  ok "termtunnel restarted"
else
  pm2 start server.js --name termtunnel --silent
  ok "termtunnel started"
fi

pm2 save --silent
ok "pm2 process list saved"

# Register pm2 to start on login automatically
info "Registering pm2 for auto-start on login…"
STARTUP_CMD=$(pm2 startup 2>/dev/null | grep -E "^sudo " | head -1 || true)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD" &>/dev/null && ok "pm2 auto-start registered" || {
    warn "Could not register auto-start automatically."
    ERRORS+=("pm2 auto-start: run manually: $STARTUP_CMD")
  }
else
  ok "pm2 auto-start already registered"
fi

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
  warn "Server health check failed — check: pm2 logs termtunnel"
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
echo -e "  ${DIM}grep AUTH_TOKEN .env         # show token anytime${RESET}"
echo -e "  ${DIM}pm2 logs termtunnel          # view server logs${RESET}"
echo -e "  ${DIM}pm2 restart termtunnel       # restart server${RESET}"
echo -e "  ${DIM}tmux attach -t termtunnel    # attach to terminal session${RESET}"

# Surface any non-fatal issues
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${BOLD}${AMBER}Action required:${RESET}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${AMBER}!${RESET}  $err"
  done
fi

echo ""
