#!/bin/bash
# Double-clickable launcher for the API testing tool.
# Strips ELECTRON_RUN_AS_NODE (set by some shells) which would cause
# the bundled Electron to run as plain Node.js instead of opening the UI.

DIR="$(cd "$(dirname "$0")" && pwd)"
unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE
unset ELECTRON_ENABLE_LOGGING

LAUNCHER="$DIR/launch-mac.sh"
if [ -x "$LAUNCHER" ]; then
  exec "$LAUNCHER"
else
  echo "Cannot find launch-mac.sh next to this file"
  read -p "Press Enter to close..."
fi