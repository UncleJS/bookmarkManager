#!/usr/bin/env bash
# =============================================================================
# scripts/start.sh — Start the Bookmark Manager pod (all services).
# =============================================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${CYAN}[start]${NC} $*"; }
success() { echo -e "${GREEN}[start]${NC} $*"; }

info "Starting bookmark-pod.service..."
systemctl --user start bookmark-pod.service
success "bookmark-pod.service started."
echo ""
echo "  API         http://localhost:11650"
echo "  Swagger UI  http://localhost:11650/docs"
echo "  phpMyAdmin  http://localhost:11651"
