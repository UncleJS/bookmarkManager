#!/usr/bin/env bash
# =============================================================================
# scripts/backup.sh — Dump the bookmark MariaDB database to a gzipped SQL file.
#
# Steps:
#   1. Verify we're at repo root and api/.env.api exists
#   2. Load DB credentials from api/.env.api
#   3. Verify the bookmark-db container is running
#   4. Run mariadb-dump inside the container, pipe through gzip
#   5. Save to backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/api/.env.api"
BACKUP_DIR="${REPO_ROOT}/backups"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[backup]${NC} $*"; }
success() { echo -e "${GREEN}[backup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[backup]${NC} $*"; }
error()   { echo -e "${RED}[backup]${NC} $*" >&2; }

# ── 1. env file ───────────────────────────────────────────────────────────────
if [[ ! -f "${ENV_FILE}" ]]; then
  error "api/.env.api not found. Run ./scripts/install.sh first."
  exit 1
fi

# ── 2. load credentials ───────────────────────────────────────────────────────
# Source only the DB_* vars we need; avoid polluting the shell with other vars.
DB_USER="$(     grep -E '^DB_USER='     "${ENV_FILE}" | cut -d= -f2- | tr -d "'\"")"
DB_PASSWORD="$( grep -E '^DB_PASSWORD=' "${ENV_FILE}" | cut -d= -f2- | tr -d "'\"")"
DB_NAME="$(     grep -E '^DB_NAME='     "${ENV_FILE}" | cut -d= -f2- | tr -d "'\"")"

if [[ -z "${DB_USER}" || -z "${DB_PASSWORD}" || -z "${DB_NAME}" ]]; then
  error "Could not read DB_USER, DB_PASSWORD, or DB_NAME from api/.env.api."
  exit 1
fi

# ── 3. container check ────────────────────────────────────────────────────────
if ! podman ps --format '{{.Names}}' 2>/dev/null | grep -q '^bookmark-db$'; then
  error "Container 'bookmark-db' is not running."
  error "Start it with: ./scripts/start.sh"
  exit 1
fi

# ── 4 & 5. dump + compress ────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/bookmark_${TIMESTAMP}.sql.gz"

info "Dumping database '${DB_NAME}' from bookmark-db container..."

podman exec bookmark-db \
  mariadb-dump \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    --single-transaction \
    --routines \
    --triggers \
    "${DB_NAME}" \
  | gzip -9 > "${OUT_FILE}"

SIZE="$(du -sh "${OUT_FILE}" | cut -f1)"
success "Backup saved: ${OUT_FILE} (${SIZE})"
