#!/bin/sh
set -eu

DATA_PATH="${DATA_DIR:-/data}"

mkdir -p "$DATA_PATH"
chown -R node:node "$DATA_PATH" 2>/dev/null || true

if su-exec node sh -c 'test -w "$1"' sh "$DATA_PATH"; then
  exec su-exec node "$@"
fi

echo "Warning: $DATA_PATH is not writable by the node user; running as root so persistent storage works." >&2
exec "$@"
