#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
# =============================================================================
# scripts/start.sh — Start the Bookmark Manager pod and wait for the API.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] [PORT_OFFSET=<n>] scripts/start.sh

Start ${POD_SERVICE} (all containers), wait until ${API_URL}/ready answers,
then print the URLs.

  -h, --help   show this help
EOF2
}
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
esac

describe_instance
if [[ ! -f "${QUADLET_DEST}/$(installed_unit_name bookmark.pod)" ]]; then
  error "Units for ${INSTANCE} are not installed. Run: ${JOB:+JOB=${JOB} PORT_OFFSET=${PORT_OFFSET} }scripts/install.sh"
  exit 1
fi

info "Starting ${POD_SERVICE} ..."
systemctl --user start "${POD_SERVICE}"

info "Waiting for ${API_URL}/ready (up to 90s) ..."
if ! wait_for_url "${API_URL}/ready" 90; then
  error "API did not become ready. Check: ${JOB:+JOB=${JOB} }scripts/logs.sh api"
  exit 1
fi
success "Bookmark Manager (${INSTANCE}) is running."
echo ""
echo "  API         ${API_URL}"
echo "  Web app     ${API_URL}/app"
echo "  Swagger UI  ${API_URL}/docs"
echo "  phpMyAdmin  ${PMA_URL}  (login required)"
