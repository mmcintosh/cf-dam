#!/bin/sh
# Remove the cf-dam agent from this Mac: stop it, and delete it, its key, its file list and its log.
# Photos are never touched. With --node, also remove Node.js as nodejs.org's installer put it in
# /usr/local (for a Mac that had Node only for the agent).
#   sh uninstall-macos.sh [--node]
set -u
SERVICE="gui/$(id -u)/com.cf-dam.agent"
if launchctl print "$SERVICE" >/dev/null 2>&1; then
  launchctl bootout "$SERVICE" 2>/dev/null || launchctl remove com.cf-dam.agent 2>/dev/null || true
  # bootout returns before the helper has exited; wait up to ten seconds for it to go.
  i=0
  while launchctl print "$SERVICE" >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
fi
# A helper started by hand, or one launchd let go of without stopping.
pkill -f 'cf-dam-agent/app/agent.mjs' 2>/dev/null || true
i=0
while pgrep -f 'cf-dam-agent/app/agent.mjs' >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
if pgrep -f 'cf-dam-agent/app/agent.mjs' >/dev/null 2>&1 || launchctl print "$SERVICE" >/dev/null 2>&1; then
  echo "The helper is still running. Restart your Mac, then run this again." >&2
  exit 1
fi
rm -f "$HOME/Library/LaunchAgents/com.cf-dam.agent.plist" "$HOME/Library/Logs/cf-dam-agent.log"
rm -rf "$HOME/Library/Application Support/cf-dam-agent"
echo "The cf-dam agent is removed. Your photos weren't touched."

if [ "${1:-}" = "--node" ]; then
  echo "Removing Node.js. Your Mac password is needed (nothing shows while you type it)."
  sudo rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/include/node \
    /usr/local/share/doc/node /usr/local/share/man/man1/node.1 /usr/local/share/systemtap/tapset/node.stp
  sudo rmdir /usr/local/lib/node_modules 2>/dev/null || true
  for p in $(pkgutil --pkgs | grep '^org\.nodejs\.'); do sudo pkgutil --forget "$p" >/dev/null; done
  rm -rf "$HOME/.npm" "$HOME/.node_repl_history"
  echo "Node.js is removed."
fi
