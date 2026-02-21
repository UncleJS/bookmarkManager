#!/usr/bin/env bash
# =============================================================================
# scripts/restart.sh — Restart Bookmark Manager services.
#
# Usage:
#   ./scripts/restart.sh           # restart the whole pod
#   ./scripts/restart.sh api       # restart only bookmark-api.service
#   ./scripts/restart.sh db        # restart only bookmark-db.service
#   ./scripts/restart.sh pma       # restart only bookmark-pma.service
# =============================================================================
set -euo pipefail

TARGET="${1:-pod}"

RED='\033[0;31m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${CYAN}[restart]${NC} $*"; }
success() { echo -e "${GREEN}[restart]${NC} $*"; }
error()   { echo -e "${RED}[restart]${NC} $*" >&2; }

case "${TARGET}" in
  api)
    info "Restarting bookmark-api.service..."
    systemctl --user restart bookmark-api.service
    success "bookmark-api.service restarted."
    ;;
  db)
    info "Restarting bookmark-db.service..."
    systemctl --user restart bookmark-db.service
    success "bookmark-db.service restarted."
    ;;
  pma)
    info "Restarting bookmark-pma.service..."
    systemctl --user restart bookmark-pma.service
    success "bookmark-pma.service restarted."
    ;;
  pod)
    info "Restarting bookmark-pod.service (all containers)..."
    systemctl --user restart bookmark-pod.service
    success "bookmark-pod.service restarted."
    ;;
  *)
    error "Unknown target '${TARGET}'. Valid options: api | db | pma | (none = pod)"
    exit 1
    ;;
esac
