#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "Checking for updates…"
git fetch --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date."
  exit 0
fi

BEHIND=$(git rev-list --count HEAD..origin/master)
echo ""
echo "  $BEHIND new commit$([ "$BEHIND" -eq 1 ] || echo 's'):"
echo ""
git log HEAD..origin/master --oneline | sed 's/^/  /'
echo ""

read -r -p "Apply update and restart server? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Pulling…"
git pull --quiet

echo "Restarting server…"
case "$(uname)" in
  Darwin)
    launchctl kickstart -k "gui/$(id -u)/com.termtunnel.server" 2>/dev/null \
      || echo "  Note: launchctl restart failed — server may not be running via launchd."
    ;;
  Linux)
    systemctl --user restart termtunnel 2>/dev/null \
      || echo "  Note: systemctl restart failed — server may not be running via systemd."
    ;;
esac

echo "Done."
