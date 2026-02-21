#!/usr/bin/env bash
# =============================================================================
# scripts/stop.sh — Stop the Bookmark Manager pod (all services).
# =============================================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${CYAN}[stop]${NC} $*"; }
success() { echo -e "${GREEN}[stop]${NC} $*"; }

info "Stopping bookmark-pod.service..."
systemctl --user stop bookmark-pod.service
success "bookmark-pod.service stopped."
