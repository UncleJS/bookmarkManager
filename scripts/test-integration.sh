#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

systemctl --user start bookmark-pod.service >/dev/null

podman run --rm \
  --pod systemd-bookmark \
  --env-file "$ROOT_DIR/api/.env" \
  -v "$ROOT_DIR/api:/app:Z" \
  -w /app \
  docker.io/oven/bun:1.3.8 \
  bun test src/tests/backup.integration.test.ts

"$ROOT_DIR/scripts/verify-backup.sh" --source script

podman run --rm \
  --pod systemd-bookmark \
  --env-file "$ROOT_DIR/api/.env" \
  -v "$ROOT_DIR/api:/app:Z" \
  -w /app \
  docker.io/oven/bun:1.3.8 \
  bun test src/tests/bookmarks.integration.test.ts
