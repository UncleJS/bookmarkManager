#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
# =============================================================================
# scripts/dev.sh — Build and run a separate dev instance in containers.
#
# The API never runs on the host. A dev instance is a job instance named
# "dev" on ports 11652/11653 with its own DB volume and generated secrets.
# Re-run after a code change to rebuild and restart it.
# =============================================================================
set -euo pipefail

usage() {
  cat <<'EOF2'
Usage: scripts/dev.sh [--down]

Install (or rebuild and restart) the dev instance:
  JOB=dev PORT_OFFSET=2 scripts/install.sh   → http://localhost:11652

  --down       remove the dev instance completely
               (uninstall.sh --purge --remove-quadlets)
  -h, --help   show this help

JOB and PORT_OFFSET can be overridden from the environment.
EOF2
}

export JOB="${JOB:-dev}" PORT_OFFSET="${PORT_OFFSET:-2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --down) exec "${HERE}/uninstall.sh" --purge --remove-quadlets ;;
  "") exec "${HERE}/install.sh" ;;
  *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
esac
