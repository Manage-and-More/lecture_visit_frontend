#!/bin/sh
# Runs the TUM mail bridge every 15 minutes while you're logged in to this Mac.
#   sh scripts/mail-bridge/launchd.sh install     start the schedule
#   sh scripts/mail-bridge/launchd.sh uninstall   stop it
# Log: ~/Library/Logs/lecture-visit-mail-bridge.log
set -eu
LABEL="de.manageandmore.lecture-visit.mail-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NPM="$(command -v npm)"
LOG="$HOME/Library/Logs/lecture-visit-mail-bridge.log"

case "${1:-}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NPM</string><string>run</string><string>-s</string><string>mail:bridge</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NPM"):/usr/bin:/bin:/usr/sbin:/sbin</string><key>TZ</key><string>Europe/Berlin</string></dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Mail bridge runs every 15 minutes. Log: $LOG"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Mail bridge schedule removed."
    ;;
  *)
    echo "Usage: sh scripts/mail-bridge/launchd.sh install|uninstall" >&2
    exit 1
    ;;
esac
