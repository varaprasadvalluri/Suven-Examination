#!/usr/bin/env bash
# Build a signed .ipa (App Store method) via xcodebuild, no Xcode GUI needed
# once you've done the one-time signing setup below.
#
# One-time setup (can only be done by you, needs your Apple ID):
#   1. Open ios/App/App.xcworkspace in Xcode.
#   2. Xcode > Settings > Accounts: sign in with the Apple Developer account.
#   3. Select the App target > Signing & Capabilities > pick your Team.
#      This registers the team/provisioning profile Xcode will reuse here.
#   4. Find your Team ID: https://developer.apple.com/account -> Membership.
#
# Usage:
#   APPLE_TEAM_ID=ABCDE12345 ./scripts/ios-archive.sh
set -euo pipefail

cd "$(dirname "$0")/.."

: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID=<your Apple Developer Team ID> and re-run}"

npm run build
npx cap sync ios

BUILD_DIR="build/ios"
ARCHIVE_PATH="$BUILD_DIR/App.xcarchive"
EXPORT_OPTIONS="$BUILD_DIR/ExportOptions.plist"

mkdir -p "$BUILD_DIR"
sed "s/__APPLE_TEAM_ID__/$APPLE_TEAM_ID/" scripts/ios-export-options.plist.template > "$EXPORT_OPTIONS"

xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID"

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$BUILD_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

echo ""
echo "Signed .ipa at $BUILD_DIR/App.ipa"
echo "Upload it with: xcrun altool --upload-app -f $BUILD_DIR/App.ipa -t ios --apiKey <key> --apiIssuer <issuer>"
echo "(or drag it into Transporter.app)"
