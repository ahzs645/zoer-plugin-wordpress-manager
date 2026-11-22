#!/bin/sh
set -eu

demo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$demo_dir/../dist/playground"
cd "$demo_dir/../dist/playground"

# Mount the sample's content and SQLite database before installation.
mkdir -p wp-content
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require \"$demo_dir/loopback.cjs\""
exec npx --yes @wp-playground/cli@3.1.65 server --port 9417 --login \
  --mount-dir-before-install "$PWD/wp-content" /wordpress/wp-content
