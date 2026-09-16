#!/usr/bin/env bash
# Build an Android release artifact. Signed if android/keystore.properties
# exists (see android/keystore.properties.example + scripts/android-generate-keystore.sh),
# otherwise gradle produces an unsigned build you cannot install directly.
#
# Usage:
#   ./scripts/android-build.sh apk   # sideloadable .apk, for direct install/BrowserStack
#   ./scripts/android-build.sh aab   # .aab bundle, for Play Console upload
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:-apk}"

npm run build
npx cap sync android

cd android
case "$TARGET" in
  apk)
    ./gradlew assembleRelease
    OUT="app/build/outputs/apk/release/app-release.apk"
    ;;
  aab)
    ./gradlew bundleRelease
    OUT="app/build/outputs/bundle/release/app-release.aab"
    ;;
  *)
    echo "Usage: $0 [apk|aab]" >&2
    exit 1
    ;;
esac

if [ ! -f keystore.properties ]; then
  echo ""
  echo "WARNING: android/keystore.properties not found - this build is UNSIGNED."
  echo "Run scripts/android-generate-keystore.sh once, then create keystore.properties"
  echo "from keystore.properties.example, to produce an installable/uploadable build."
fi

echo ""
echo "Output: android/$OUT"
