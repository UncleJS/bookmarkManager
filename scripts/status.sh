#!/usr/bin/env bash
# =============================================================================
# scripts/status.sh — Show systemctl status for all Bookmark Manager services.
# =============================================================================
set -euo pipefail

CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}[status]${NC} $*"; }

info "bookmark-pod + all containers:"
echo ""
# --no-pager keeps output in the terminal; || true prevents non-zero exit
# from inactive services causing the script to abort.
systemctl --user status bookmark-pod.service \
                         bookmark-api.service \
                         bookmark-db.service \
                         bookmark-pma.service \
  --no-pager -l || true
