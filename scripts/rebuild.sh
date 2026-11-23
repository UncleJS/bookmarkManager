#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
# =============================================================================
# scripts/rebuild.sh — Rebuild the API image and restart only the API.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] [PORT_OFFSET=<n>] scripts/rebuild.sh

scripts/build.sh --api, then restart ${API_SERVICE} and wait for
${API_URL}/ready.

  -h, --help   show this help
EOF2
}
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
esac

"${REPO_ROOT}/scripts/build.sh" --api
info "Restarting ${API_SERVICE} ..."
systemctl --user restart "${API_SERVICE}"
info "Waiting for ${API_URL}/ready (up to 60s) ..."
if ! wait_for_url "${API_URL}/ready" 60; then
  error "API did not become ready. Check: ${JOB:+JOB=${JOB} }scripts/logs.sh api"
  exit 1
fi
success "API is ready at ${API_URL}"
