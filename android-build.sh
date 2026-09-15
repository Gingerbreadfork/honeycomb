#!/usr/bin/env bash
# Builds a release APK for arm64 phones and signs it with a personal keystore.
# Pass --sign-only to skip the build and sign the existing unsigned APK.
set -euo pipefail
cd "$(dirname "$0")"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)}"
if [ -z "${JAVA_HOME:-}" ]; then
  for j in /usr/lib/jvm/java-21-openjdk /usr/lib/jvm/java-17-openjdk "$HOME"/.gradle/jdks/*21*; do
    [ -x "$j/bin/javac" ] && export JAVA_HOME="$j" && break
  done
fi
export PATH="$JAVA_HOME/bin:$PATH"

BUILD_TOOLS=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
KEYSTORE="${HONEYCOMB_KEYSTORE:-$HOME/.config/honeycomb/android-release.jks}"
STOREPASS="${HONEYCOMB_KEYSTORE_PASS:-honeycomb}"
UNSIGNED=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
OUT_DIR=src-tauri/target/release/bundle/android
VERSION=$(grep -o '"version": *"[^"]*"' src-tauri/tauri.conf.json | head -1 | grep -o '[0-9][^"]*')
OUT="$OUT_DIR/Honeycomb-$VERSION-arm64.apk"

if [ "${1:-}" != "--sign-only" ]; then
  pnpm install
  pnpm tauri android build --apk --target aarch64
fi

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias honeycomb -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STOREPASS" -keypass "$STOREPASS" -dname "CN=Honeycomb, OU=Personal, O=Honeycomb" >/dev/null 2>&1
  echo "Created signing key at $KEYSTORE (keep it; updates must be signed with the same key)"
fi

mkdir -p "$OUT_DIR"
ALIGNED=$(mktemp --suffix=.apk)
"$BUILD_TOOLS/zipalign" -p -f 4 "$UNSIGNED" "$ALIGNED"
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias honeycomb --ks-pass "pass:$STOREPASS" --key-pass "pass:$STOREPASS" --out "$OUT" "$ALIGNED"
rm -f "$ALIGNED" "$OUT.idsig"
"$BUILD_TOOLS/apksigner" verify "$OUT"
echo "Signed APK: $OUT"
