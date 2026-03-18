#!/usr/bin/env bash
# =============================================================================
# scripts/verify-backup.sh — Validate and restore-test bookmark backups.
#
# Usage:
#   ./scripts/verify-backup.sh --source script
#   ./scripts/verify-backup.sh --source api
#   ./scripts/verify-backup.sh --file backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz
#
# What it verifies:
#   1. The backup file exists and passes `gzip -t`
#   2. The dump restores into a temporary MariaDB database
#   3. The restored DB contains the expected core tables
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/api/.env"
API_ENV_FILE="${REPO_ROOT}/api/.env.api"
BACKUP_DIR="${REPO_ROOT}/backups"
SOURCE=""
BACKUP_FILE=""
KEEP_FILE=0
TEMP_DB=""
GENERATED_FILE=0
EXPECTED_TABLES=(bookmarks tags classifications classification_groups bookmark_tags bookmark_classifications)

# ---- colours -----------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[verify-backup]${NC} $*"; }
success() { echo -e "${GREEN}[verify-backup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[verify-backup]${NC} $*"; }
error()   { echo -e "${RED}[verify-backup]${NC} $*" >&2; }

usage() {
  cat <<'EOF'
Usage:
  ./scripts/verify-backup.sh --source script [--keep]
  ./scripts/verify-backup.sh --source api [--keep]
  ./scripts/verify-backup.sh --file backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz

Options:
  --source script   Generate a fresh dump via ./scripts/backup.sh, then verify it.
  --source api      Download a fresh dump from GET /backup, then verify it.
  --file PATH       Verify an existing .sql.gz dump file.
  --keep            Keep files generated via --source script|api.
EOF
}

load_env_value() {
  local source_file="$1"
  local key="$2"
  grep -E "^${key}=" "${source_file}" | cut -d= -f2- | tr -d "'\""
}

require_file() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    error "Required file not found: ${file_path}"
    exit 1
  fi
}

cleanup() {
  if [[ -n "${TEMP_DB}" && -n "${DB_ROOT_PASSWORD:-}" ]]; then
    podman exec bookmark-db mariadb \
      --user=root \
      --password="${DB_ROOT_PASSWORD}" \
      --execute="DROP DATABASE IF EXISTS \`${TEMP_DB}\`" >/dev/null 2>&1 || true
  fi

  if [[ ${GENERATED_FILE} -eq 1 && ${KEEP_FILE} -eq 0 && -n "${BACKUP_FILE}" && -f "${BACKUP_FILE}" ]]; then
    rm -f "${BACKUP_FILE}"
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --file)
      BACKUP_FILE="${2:-}"
      shift 2
      ;;
    --keep)
      KEEP_FILE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -n "${SOURCE}" && -n "${BACKUP_FILE}" ]]; then
  error "Use either --source or --file, not both."
  exit 1
fi

if [[ -z "${SOURCE}" && -z "${BACKUP_FILE}" ]]; then
  error "You must provide --source or --file."
  usage
  exit 1
fi

require_file "${ENV_FILE}"

if [[ ! -f "${API_ENV_FILE}" ]]; then
  warn "api/.env.api not found — falling back to api/.env"
  API_ENV_FILE="${ENV_FILE}"
fi

DB_NAME="$(load_env_value "${API_ENV_FILE}" DB_NAME)"
API_PORT="$(load_env_value "${API_ENV_FILE}" API_PORT)"
BACKUP_TOKEN="$(load_env_value "${API_ENV_FILE}" BACKUP_TOKEN)"
DB_ROOT_PASSWORD="$(load_env_value "${ENV_FILE}" MARIADB_ROOT_PASSWORD)"

if [[ -z "${DB_NAME}" || -z "${API_PORT}" || -z "${DB_ROOT_PASSWORD}" ]]; then
  error "Missing DB_NAME, API_PORT, or MARIADB_ROOT_PASSWORD in env files."
  exit 1
fi

if ! podman ps --format '{{.Names}}' 2>/dev/null | grep -q '^bookmark-db$'; then
  error "Container 'bookmark-db' is not running. Start it with: ./scripts/start.sh"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

if [[ -n "${SOURCE}" ]]; then
  case "${SOURCE}" in
    script)
      info "Generating backup via ./scripts/backup.sh ..."
      "${REPO_ROOT}/scripts/backup.sh" >/dev/null
      shopt -s nullglob
      matches=("${BACKUP_DIR}"/bookmark_*.sql.gz)
      shopt -u nullglob
      if [[ ${#matches[@]} -eq 0 ]]; then
        error "backup.sh did not produce a dump in ${BACKUP_DIR}."
        exit 1
      fi
      latest_file="$(printf '%s\n' "${matches[@]}" | sort | tail -n 1)"
      BACKUP_FILE="${latest_file}"
      GENERATED_FILE=1
      ;;
    api)
      if [[ -z "${BACKUP_TOKEN}" || "${BACKUP_TOKEN}" == "change_me_please" ]]; then
        error "BACKUP_TOKEN is not configured in api/.env."
        exit 1
      fi
      BACKUP_FILE="${BACKUP_DIR}/backup_api_verify_$(date +%Y-%m-%d_%H%M%S).sql.gz"
      info "Downloading backup via GET /backup ..."
      curl -fsS \
        -H "Authorization: Bearer ${BACKUP_TOKEN}" \
        "http://localhost:${API_PORT}/backup" \
        --output "${BACKUP_FILE}"
      GENERATED_FILE=1
      ;;
    *)
      error "Unsupported source '${SOURCE}'. Use 'script' or 'api'."
      exit 1
      ;;
  esac
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  error "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

info "Validating gzip integrity for ${BACKUP_FILE} ..."
gzip -t "${BACKUP_FILE}"
success "gzip integrity check passed."

TEMP_DB="backup_verify_$(date +%s)_$RANDOM"
info "Restoring dump into temporary database '${TEMP_DB}' ..."
podman exec bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  --execute="CREATE DATABASE \`${TEMP_DB}\`"

gunzip -c "${BACKUP_FILE}" | podman exec -i bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  "${TEMP_DB}"

for table_name in "${EXPECTED_TABLES[@]}"; do
  table_count="$(podman exec bookmark-db mariadb \
    --user=root \
    --password="${DB_ROOT_PASSWORD}" \
    --batch \
    --skip-column-names \
    --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TEMP_DB}' AND table_name='${table_name}'")"

  if [[ "${table_count}" != "1" ]]; then
    error "Restore verification failed: expected table '${table_name}' was not restored."
    exit 1
  fi
done

success "Restore verification passed for ${BACKUP_FILE}."

if [[ ${GENERATED_FILE} -eq 1 && ${KEEP_FILE} -eq 1 ]]; then
  success "Generated backup retained at ${BACKUP_FILE}."
fi
