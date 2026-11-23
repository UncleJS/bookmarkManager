#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
# =============================================================================
# scripts/logs.sh — Follow the journal of Bookmark Manager services.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] scripts/logs.sh [api|db|pma|all]

Follow journalctl --user for one service (default: api) or all of them.

  -h, --help   show this help
EOF2
}

case "${1:-api}" in
  -h|--help) usage; exit 0 ;;
  api) units=(-u "${API_SERVICE}") ;;
  db)  units=(-u "${DB_SERVICE}") ;;
  pma) units=(-u "${PMA_SERVICE}") ;;
  all) units=(-u "${POD_SERVICE}" -u "${API_SERVICE}" -u "${DB_SERVICE}" -u "${PMA_SERVICE}") ;;
  *) error "Unknown target '$1'."; usage >&2; exit 2 ;;
esac
info "Following ${units[*]} (Ctrl+C to exit) ..."
exec journalctl --user "${units[@]}" -f
