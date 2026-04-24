#!/usr/bin/env bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.termtunnel.server.plist"

# Check whether the service is currently loaded
if ! launchctl list com.termtunnel.server &>/dev/null; then
  echo "TermTunnel is not running."
  exit 0
fi

echo "Stopping TermTunnel…"
launchctl bootout "gui/$(id -u)/com.termtunnel.server" 2>/dev/null \
  || launchctl unload "$PLIST" 2>/dev/null \
  || { echo "Failed to stop service."; exit 1; }

echo "Stopped. To start again:"
echo "  launchctl bootstrap gui/\$(id -u) $PLIST"
