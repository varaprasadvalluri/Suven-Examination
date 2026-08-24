#!/usr/bin/env bash
# Build + sync the Android shell against your local dev server (npm run dev),
# same as ios:sync:local. See capacitor.config.ts for the full story.
#
# Android emulator/device is a separate VM from your Mac, so plain `localhost`
# inside it means the device itself, not your machine. `adb reverse` forwards
# the device's own localhost:3000 back to your Mac's, making it a real secure
# origin (Chromium WebView only trusts localhost/127.0.0.1 as secure - NOT
# the 10.0.2.2 emulator alias). Skip this and Web Crypto APIs like
# crypto.randomUUID silently vanish, breaking Firestore's onSnapshot
# listeners - confirmed 2026-08-23, see capacitor.config.ts comment.
#
# Best-effort: if no emulator/device is attached yet, this just warns and
# continues - run it again (or just `adb reverse tcp:3000 tcp:3000`) once one is.
set -euo pipefail

cd "$(dirname "$0")/.."

find_adb() {
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return
  fi
  for candidate in "${ANDROID_HOME:-}/platform-tools/adb" "${ANDROID_SDK_ROOT:-}/platform-tools/adb" "$HOME/Library/Android/sdk/platform-tools/adb"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

ADB="$(find_adb || true)"
if [ -n "$ADB" ]; then
  if "$ADB" reverse tcp:3000 tcp:3000 2>/dev/null; then
    echo "adb reverse tcp:3000 tcp:3000 OK - emulator/device localhost:3000 now reaches this Mac's dev server."
  else
    echo "WARNING: adb reverse failed - no emulator/device attached? Data fetching will break until you run:" >&2
    echo "  adb reverse tcp:3000 tcp:3000" >&2
  fi
else
  echo "WARNING: adb not found on PATH or under \$ANDROID_HOME/\$ANDROID_SDK_ROOT - skipping adb reverse." >&2
  echo "  Run manually once your device is up: adb reverse tcp:3000 tcp:3000" >&2
fi

CAP_ENV=local npx vite build
CAP_ENV=local npx cap sync android
