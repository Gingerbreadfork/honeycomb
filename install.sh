#!/usr/bin/env bash
# Builds Honeycomb and installs it for the current user (no sudo needed).
set -euo pipefail
cd "$(dirname "$0")"

pnpm install
pnpm tauri build --no-bundle

install -Dm755 src-tauri/target/release/honeycomb "$HOME/.local/bin/honeycomb"
install -Dm644 src-tauri/icon.svg "$HOME/.local/share/icons/hicolor/scalable/apps/honeycomb.svg"
install -Dm644 src-tauri/icons/128x128@2x.png "$HOME/.local/share/icons/hicolor/256x256/apps/honeycomb.png"
install -Dm644 src-tauri/icons/128x128.png "$HOME/.local/share/icons/hicolor/128x128/apps/honeycomb.png"
mkdir -p "$HOME/.local/share/applications"
sed "s|^Exec=.*|Exec=$HOME/.local/bin/honeycomb|" src-tauri/honeycomb.desktop > "$HOME/.local/share/applications/honeycomb.desktop"

update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Installed. Launch Honeycomb from the app grid, or run: $HOME/.local/bin/honeycomb"
