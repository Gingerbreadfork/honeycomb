#!/usr/bin/env bash
# Fails unless package.json, tauri.conf.json, Cargo.toml and the newest release in the
# metainfo file carry the same version.
# Pass a version (or a tag like v0.2.0) to require that one.
set -euo pipefail
cd "$(dirname "$0")/.."

pkg=$(node -p "require('./package.json').version")
conf=$(node -p "require('./src-tauri/tauri.conf.json').version")
cargo=$(grep -m1 '^version' src-tauri/Cargo.toml | cut -d'"' -f2)
metainfo=$(grep -m1 -o '<release version="[^"]*"' src-tauri/io.github.gingerbreadfork.honeycomb.metainfo.xml | cut -d'"' -f2)
want="${1:-$pkg}"
want="${want#v}"

status=0
for entry in "package.json:$pkg" "src-tauri/tauri.conf.json:$conf" "src-tauri/Cargo.toml:$cargo" "src-tauri/io.github.gingerbreadfork.honeycomb.metainfo.xml:$metainfo"; do
  if [ "${entry#*:}" != "$want" ]; then
    echo "${entry%%:*} is at ${entry#*:}, expected $want" >&2
    status=1
  fi
done
[ "$status" = 0 ] && echo "All four files are at $want"
exit "$status"
