#!/bin/sh
# Install the cf-dam agent for this user and start it at login.
#   ./install-macos.sh https://dam.example.com ["Studio iMac"]
set -eu
URL="${1:?Usage: install-macos.sh https://dam.example.com [name]}"
NAME="${2:-$(scutil --get ComputerName 2>/dev/null || hostname)}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Install Node.js 24 from https://nodejs.org first." >&2; exit 1; }
"$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { echo "Node.js 24 or newer is needed." >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/cf-dam-agent/app"
mkdir -p "$APP"
cp "$HERE/agent.mjs" "$HERE/package.json" "$APP/"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund >/dev/null)

PLIST="$HOME/Library/LaunchAgents/com.cf-dam.agent.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cf-dam.agent</string>
  <key>ProgramArguments</key>
  <array><string>$(esc "$NODE")</string><string>$(esc "$APP/agent.mjs")</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CF_DAM_URL</key><string>$(esc "$URL")</string>
    <key>AGENT_NAME</key><string>$(esc "$NAME")</string>
    <key>NODE_NO_WARNINGS</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(esc "$HOME/Library/Logs/cf-dam-agent.log")</string>
  <key>StandardErrorPath</key><string>$(esc "$HOME/Library/Logs/cf-dam-agent.log")</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/com.cf-dam.agent" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. The pairing code will appear in ~/Library/Logs/cf-dam-agent.log and at http://localhost:8790"
