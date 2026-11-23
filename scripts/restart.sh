#!/usr/bin/env bash
# =============================================================================
# scripts/restart.sh — Restart the Bookmark Manager pod or one service.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] [PORT_OFFSET=<n>] scripts/restart.sh [api|db|pma]

  (no argument)  whole pod: scripts/stop.sh, then scripts/start.sh
  api|db|pma     restart only that container's service
  -h, --help     show this help
EOF2
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "")
    "${REPO_ROOT}/scripts/stop.sh"
    "${REPO_ROOT}/scripts/start.sh"
    ;;
  api|db|pma)
    case "$1" in
      api) svc="${API_SERVICE}" ;;
      db)  svc="${DB_SERVICE}" ;;
      pma) svc="${PMA_SERVICE}" ;;
    esac
    describe_instance
    info "Restarting ${svc} ..."
    systemctl --user restart "${svc}"
    success "${svc} restarted."
    ;;
  *) error "Unknown target '$1'."; usage >&2; exit 2 ;;
esac
