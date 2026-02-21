#!/usr/bin/env bash
# =============================================================================
# scripts/logs.sh — Tail journalctl logs for Bookmark Manager services.
#
# Usage:
#   ./scripts/logs.sh              # tail API logs (default)
#   ./scripts/logs.sh api          # tail bookmark-api logs
#   ./scripts/logs.sh db           # tail bookmark-db logs
#   ./scripts/logs.sh pma          # tail bookmark-pma logs
#   ./scripts/logs.sh all          # tail all three services together
# =============================================================================
set -euo pipefail

TARGET="${1:-api}"

RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[logs]${NC} $*"; }
error() { echo -e "${RED}[logs]${NC} $*" >&2; }

case "${TARGET}" in
  api)
    info "Tailing bookmark-api logs (Ctrl+C to exit)..."
    exec journalctl --user -u bookmark-api -f
    ;;
  db)
    info "Tailing bookmark-db logs (Ctrl+C to exit)..."
    exec journalctl --user -u bookmark-db -f
    ;;
  pma)
    info "Tailing bookmark-pma logs (Ctrl+C to exit)..."
    exec journalctl --user -u bookmark-pma -f
    ;;
  all)
    info "Tailing all bookmark service logs (Ctrl+C to exit)..."
    exec journalctl --user -u bookmark-api -u bookmark-db -u bookmark-pma -f
    ;;
  *)
    error "Unknown target '${TARGET}'. Valid options: api (default) | db | pma | all"
    exit 1
    ;;
esac
