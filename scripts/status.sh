#!/usr/bin/env bash
# =============================================================================
# scripts/status.sh — Show the status of every Bookmark Manager service.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] scripts/status.sh

Show systemctl --user status for ${POD_SERVICE}, ${DB_SERVICE},
${API_SERVICE} and ${PMA_SERVICE}, plus the pod's containers.

  -h, --help   show this help
EOF2
}
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
esac

describe_instance
# inactive units make systemctl exit non-zero; that's not an error here
systemctl --user status "${POD_SERVICE}" "${DB_SERVICE}" "${API_SERVICE}" "${PMA_SERVICE}" \
  --no-pager -l || true
echo ""
podman ps -a --filter "label=${INSTANCE_LABEL}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
