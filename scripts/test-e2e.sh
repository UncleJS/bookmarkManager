#!/usr/bin/env bash
# =============================================================================
# scripts/test-e2e.sh — Run the Playwright E2E suite against a live API.
#
# Usage:
#   API_TOKEN=<your-token> ./scripts/test-e2e.sh [playwright-args...]
#
# Optional env vars:
#   API_BASE_URL  — defaults to http://localhost:11650
#   API_TOKEN     — bearer token; token-gated tests are skipped when absent
#   EXTENSION_PATH — path to unpacked extension; defaults to <repo>/extension
#
# Examples:
#   API_TOKEN=abc123 ./scripts/test-e2e.sh
#   API_TOKEN=abc123 ./scripts/test-e2e.sh --project=api-smoke
#   API_TOKEN=abc123 ./scripts/test-e2e.sh --headed
# =============================================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${CYAN}[e2e]${NC} $*"; }
success() { echo -e "${GREEN}[e2e]${NC} $*"; }
warn()    { echo -e "${YELLOW}[e2e]${NC} $*"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/e2e"

# ── Warn if no token ──────────────────────────────────────────────────────────
if [[ -z "${API_TOKEN:-}" ]]; then
  warn "API_TOKEN is not set — token-gated tests will be skipped."
fi

# ── Ensure the API is running ─────────────────────────────────────────────────
API_BASE="${API_BASE_URL:-http://localhost:11650}"
info "Checking API at $API_BASE/ready ..."
if ! curl -sf "$API_BASE/ready" | grep -q '"ok"'; then
  warn "API does not appear to be running. Starting bookmark-pod.service..."
  systemctl --user start bookmark-pod.service
  sleep 3
fi

# ── Run Playwright ────────────────────────────────────────────────────────────
info "Running Playwright E2E suite..."
cd "$E2E_DIR"
export API_BASE_URL="${API_BASE_URL:-http://localhost:11650}"
bun run test "$@"
success "E2E suite complete."
