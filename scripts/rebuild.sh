#!/usr/bin/env bash
# =============================================================================
# scripts/rebuild.sh — Rebuild the API container image and restart the service.
#
# Steps:
#   1. Build localhost/bookmark-api:latest from api/Dockerfile
#   2. systemctl --user restart bookmark-api.service
#   3. Wait for health check to pass
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH_URL="http://localhost:11650/health"
MAX_WAIT=30   # seconds

# ---- colours -----------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[rebuild]${NC} $*"; }
success() { echo -e "${GREEN}[rebuild]${NC} $*"; }
warn()    { echo -e "${YELLOW}[rebuild]${NC} $*"; }
error()   { echo -e "${RED}[rebuild]${NC} $*" >&2; }

# ---- 1. build ----------------------------------------------------------------
info "Building localhost/bookmark-api:latest ..."
podman build -t localhost/bookmark-api:latest "${REPO_ROOT}/api"
success "Image built."

# ---- 2. restart --------------------------------------------------------------
info "Restarting bookmark-api.service..."
systemctl --user restart bookmark-api.service
success "Service restarted."

# ---- 3. health check ---------------------------------------------------------
info "Waiting for API to become healthy (up to ${MAX_WAIT}s)..."
ELAPSED=0
until curl -sf "${HEALTH_URL}" &>/dev/null; do
  if [[ ${ELAPSED} -ge ${MAX_WAIT} ]]; then
    error "API did not become healthy within ${MAX_WAIT}s."
    error "Check logs: ./scripts/logs.sh api"
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  echo -n "."
done
echo ""
success "API is healthy at ${HEALTH_URL} (after ${ELAPSED}s)."
