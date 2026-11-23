#!/usr/bin/env bash
# =============================================================================
# scripts/stop.sh — Stop the Bookmark Manager pod (all services).
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] scripts/stop.sh

Stop ${POD_SERVICE} and every container in it.

  -h, --help   show this help
EOF2
}
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
esac

describe_instance
if [[ "$(systemctl --user show -p LoadState --value "${POD_SERVICE}" 2>/dev/null)" != "loaded" ]]; then
  warn "${POD_SERVICE} is not installed; nothing to stop."
  exit 0
fi
info "Stopping ${POD_SERVICE} ..."
systemctl --user stop "${POD_SERVICE}"
success "${POD_SERVICE} stopped."
