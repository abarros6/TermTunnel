#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load PORT from .env if present
PORT=3000
if [ -f "$REPO_DIR/.env" ]; then
  PORT_LINE=$(grep -E '^PORT=' "$REPO_DIR/.env" 2>/dev/null || true)
  if [ -n "$PORT_LINE" ]; then
    PORT="${PORT_LINE#PORT=}"
  fi
fi

echo ""
echo "── TermTunnel Status ──────────────────────────────"

# launchd service
echo ""
echo "Service (launchd):"
LAUNCHD=$(launchctl list com.termtunnel.server 2>/dev/null || true)
if [ -n "$LAUNCHD" ]; then
  PID=$(echo "$LAUNCHD" | grep '"PID"' | grep -o '[0-9]*' | head -1)
  STATUS=$(echo "$LAUNCHD" | grep '"LastExitStatus"' | grep -o '[0-9]*' | head -1)
  echo "  Status:         running"
  echo "  PID:            ${PID:-unknown}"
  echo "  LastExitStatus: ${STATUS:-0}"
else
  echo "  Status:         not loaded"
fi

# Server uptime via /health
echo ""
echo "Server:"
HEALTH=$(curl -s --max-time 2 "http://localhost:${PORT}/health" 2>/dev/null || true)
if [ -n "$HEALTH" ]; then
  UPTIME_SEC=$(echo "$HEALTH" | sed -n 's/.*"uptime":\([0-9.]*\).*/\1/p')
  if [ -n "$UPTIME_SEC" ]; then
    UPTIME_INT=${UPTIME_SEC%.*}
    DAYS=$(( UPTIME_INT / 86400 ))
    HOURS=$(( (UPTIME_INT % 86400) / 3600 ))
    MINS=$(( (UPTIME_INT % 3600) / 60 ))
    echo "  Uptime:  ${DAYS}d ${HOURS}h ${MINS}m"
  fi
  echo "  Health:  ok"
else
  echo "  Health:  unreachable on port ${PORT}"
fi

# URL
echo ""
echo "Access:"
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unavailable")
TS_BIN=$(which tailscale 2>/dev/null || echo "/Applications/Tailscale.app/Contents/MacOS/Tailscale")
TS_IP=$("$TS_BIN" ip -4 2>/dev/null | head -1 || echo "unavailable")
echo "  Local:     http://${LOCAL_IP}:${PORT}"
echo "  Tailscale: http://${TS_IP}:${PORT}"
echo "  Port:      ${PORT}"

# Sleep settings
echo ""
echo "Power (pmset):"
SLEEP_VAL=$(pmset -g      | awk '/^ *sleep /{print $2}' || echo "unknown")
DISK_VAL=$(pmset -g       | awk '/^ *disksleep /{print $2}' || echo "unknown")
SLEEP_STR=$([ "$SLEEP_VAL" = "0" ] && echo "disabled" || echo "${SLEEP_VAL} min")
DISK_STR=$([ "$DISK_VAL"  = "0" ] && echo "disabled" || echo "${DISK_VAL} min")
echo "  sleep:      ${SLEEP_STR}"
echo "  disksleep:  ${DISK_STR}"

# tmux sessions
echo ""
echo "tmux sessions:"
SESSIONS=$(tmux list-sessions 2>/dev/null || echo "none")
echo "$SESSIONS" | sed 's/^/  /'

echo ""
echo "───────────────────────────────────────────────────"
echo ""
