#!/bin/bash
# Launcher that strips problematic env vars and launches the bundled app
unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE
unset ELECTRON_ENABLE_LOGGING

# Allow user to override the location by setting APP_PATH
APP_PATH="${APP_PATH:-$(cd "$(dirname "$0")" && pwd)/dist/mac/中转API测试.app}"
ARM_PATH="${APP_PATH}-arm64"

# Pick the right arch for this machine
if [ -d "$ARM_PATH" ] && [ "$(uname -m)" = "arm64" ]; then
  APP_PATH="$ARM_PATH"
fi

if [ ! -d "$APP_PATH" ]; then
  echo "Cannot find app bundle at: $APP_PATH" >&2
  exit 1
fi

exec "$APP_PATH/Contents/MacOS/中转API测试" "$@"