#!/usr/bin/env bash
# One-time: create the production signing key for the Play Store build.
#
# This key IS the app's identity on the Play Store. Losing it means you can
# never ship an update to the existing app listing again - only a new one.
# Keep the generated release.keystore and its passwords somewhere durable
# and backed up OUTSIDE this repo (password manager + offsite copy). Never
# commit it; android/.gitignore already excludes *.keystore/*.jks.
set -euo pipefail

cd "$(dirname "$0")/../android"

if [ -f release.keystore ]; then
  echo "android/release.keystore already exists - refusing to overwrite." >&2
  echo "Delete it yourself first if you really mean to replace it." >&2
  exit 1
fi

keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore release.keystore \
  -alias suvenedu \
  -keyalg RSA -keysize 2048 -validity 10000

cat <<EOF

Keystore created at android/release.keystore

Next: create android/keystore.properties (copy android/keystore.properties.example)
with the storeFile/storePassword/keyAlias/keyPassword you just entered.
That file is gitignored - build.gradle reads it to sign release builds.
EOF
