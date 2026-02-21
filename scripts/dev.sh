#!/usr/bin/env bash
# =============================================================================
# scripts/dev.sh — Run the API locally via Bun (no container).
#
# Steps:
#   1. Check api/.env (copy from .env.example if missing, then exit to prompt edit)
#   2. bun install in api/ (if node_modules is absent or package.json is newer)
#   3. bun run dev  (bun --watch src/server.ts)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="${REPO_ROOT}/api"
ENV_FILE="${API_DIR}/.env"
ENV_EXAMPLE="${API_DIR}/.env.example"

# ---- colours -----------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[dev]${NC} $*"; }
success() { echo -e "${GREEN}[dev]${NC} $*"; }
warn()    { echo -e "${YELLOW}[dev]${NC} $*"; }
error()   { echo -e "${RED}[dev]${NC} $*" >&2; }

# ---- 1. .env check -----------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    error "Neither api/.env nor api/.env.example found."
    exit 1
  fi
  warn "api/.env not found — copying from api/.env.example"
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  echo ""
  warn "================================================================"
  warn "  ACTION REQUIRED: edit api/.env and set real DB passwords,"
  warn "  then run this script again."
  warn ""
  warn "  nano ${ENV_FILE}"
  warn "================================================================"
  echo ""
  exit 1
fi
info "api/.env found."

# ---- 2. bun check ------------------------------------------------------------
if ! command -v bun &>/dev/null; then
  error "bun not found on PATH. Install Bun: https://bun.sh"
  exit 1
fi
info "bun: $(bun --version)"

# ---- 3. bun install ----------------------------------------------------------
MODULES_DIR="${API_DIR}/node_modules"
PKG_FILE="${API_DIR}/package.json"

if [[ ! -d "${MODULES_DIR}" ]] || [[ "${PKG_FILE}" -nt "${MODULES_DIR}" ]]; then
  info "Running bun install in api/..."
  bun install --cwd "${API_DIR}"
  success "Dependencies installed."
else
  info "node_modules up to date — skipping bun install."
fi

# ---- 4. bun run dev ----------------------------------------------------------
success "Starting API in watch mode (Ctrl+C to stop)..."
echo ""
exec bun run --cwd "${API_DIR}" dev
