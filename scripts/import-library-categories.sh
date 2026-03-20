#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/api/.env.api"
FALLBACK_ENV_FILE="${REPO_ROOT}/api/.env"
SEED_FILE="${REPO_ROOT}/backups/library_categories_schema_seed.sql"
MODE="dry-run"
KEEP_STAGE_DB=0
STAGE_DB="library_import_$(date +%Y%m%d_%H%M%S)_$RANDOM"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { printf '%b\n' "${CYAN}[library-import]${NC} $*"; }
success() { printf '%b\n' "${GREEN}[library-import]${NC} $*"; }
warn()    { printf '%b\n' "${YELLOW}[library-import]${NC} $*"; }
error()   { printf '%b\n' "${RED}[library-import]${NC} $*" >&2; }

usage() {
  cat <<'EOF'
Usage:
  ./scripts/import-library-categories.sh [--dry-run] [--apply] [--keep-stage-db]

Options:
  --dry-run        Run staging + validation only (default).
  --apply          Import level 1 -> categories and level 2 -> subcategories.
  --keep-stage-db  Keep the temporary staging database for inspection.
EOF
}

load_env_value() {
  local source_file="$1"
  local key="$2"
  grep -E "^${key}=" "${source_file}" | cut -d= -f2- | tr -d "'\""
}

cleanup() {
  if [[ ${KEEP_STAGE_DB} -eq 0 && -n "${STAGE_DB:-}" && -n "${DB_ROOT_PASSWORD:-}" ]]; then
    podman exec bookmark-db mariadb \
      --user=root \
      --password="${DB_ROOT_PASSWORD}" \
      --execute="DROP DATABASE IF EXISTS \`${STAGE_DB}\`" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --keep-stage-db)
      KEEP_STAGE_DB=1
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

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${FALLBACK_ENV_FILE}" ]]; then
    warn "api/.env.api not found - falling back to api/.env"
    ENV_FILE="${FALLBACK_ENV_FILE}"
  else
    error "Neither api/.env.api nor api/.env was found."
    exit 1
  fi
fi

if [[ ! -f "${SEED_FILE}" ]]; then
  error "Seed file not found: ${SEED_FILE}"
  exit 1
fi

DB_USER="$(load_env_value "${ENV_FILE}" DB_USER)"
DB_PASSWORD="$(load_env_value "${ENV_FILE}" DB_PASSWORD)"
DB_NAME="$(load_env_value "${ENV_FILE}" DB_NAME)"
DB_ROOT_PASSWORD="$(load_env_value "${REPO_ROOT}/api/.env" MARIADB_ROOT_PASSWORD)"

if [[ -z "${DB_USER}" || -z "${DB_PASSWORD}" || -z "${DB_NAME}" || -z "${DB_ROOT_PASSWORD}" ]]; then
  error "Missing DB_USER, DB_PASSWORD, DB_NAME, or MARIADB_ROOT_PASSWORD in env files."
  exit 1
fi

if ! podman ps --format '{{.Names}}' 2>/dev/null | grep -q '^bookmark-db$'; then
  error "Container 'bookmark-db' is not running. Start it with: ./scripts/start.sh"
  exit 1
fi

info "Creating staging database ${STAGE_DB}"
podman exec bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  --execute="CREATE DATABASE \`${STAGE_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

info "Loading seed into staging database"
podman exec -i bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  "${STAGE_DB}" < "${SEED_FILE}"

SQL_FILE="$(mktemp)"
cat > "${SQL_FILE}" <<'SQL'
SET @target_db := '__DB_NAME__';
SET @stage_db := '__STAGE_DB__';

SET @sql := CONCAT(
  'CREATE OR REPLACE TABLE `', @stage_db, '`.`level1_seed` AS ',
  'SELECT category_id AS seed_category_id, TRIM(category_name) AS seed_name, description, sort_order ',
  'FROM `', @stage_db, '`.`library_categories` ',
  'WHERE category_level = 1 AND is_active = 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'CREATE OR REPLACE TABLE `', @stage_db, '`.`level2_seed` AS ',
  'SELECT category_id AS seed_subcategory_id, parent_id AS parent_seed_category_id, TRIM(category_name) AS seed_name, description, sort_order ',
  'FROM `', @stage_db, '`.`library_categories` ',
  'WHERE category_level = 2 AND is_active = 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''seed_level1_rows'' AS metric, COUNT(*) AS value FROM `', @stage_db, '`.`level1_seed` ',
  'UNION ALL SELECT ''seed_level2_rows'', COUNT(*) FROM `', @stage_db, '`.`level2_seed` ',
  'UNION ALL SELECT ''seed_level3_rows_skipped'', COUNT(*) FROM `', @stage_db, '`.`library_categories` WHERE category_level = 3 AND is_active = 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''seed_duplicate_level1'' AS issue, seed_name AS ref, COUNT(*) AS qty ',
  'FROM `', @stage_db, '`.`level1_seed` GROUP BY seed_name HAVING COUNT(*) > 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''seed_duplicate_level2'' AS issue, CONCAT(parent_seed_category_id, '':'', seed_name) AS ref, COUNT(*) AS qty ',
  'FROM `', @stage_db, '`.`level2_seed` GROUP BY parent_seed_category_id, seed_name HAVING COUNT(*) > 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''live_duplicate_categories'' AS issue, TRIM(name) AS ref, COUNT(*) AS qty ',
  'FROM `', @target_db, '`.`categories` WHERE archived_at IS NULL GROUP BY TRIM(name) HAVING COUNT(*) > 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''live_duplicate_subcategories'' AS issue, CONCAT(COALESCE(category_id, 0), '':'', TRIM(name)) AS ref, COUNT(*) AS qty ',
  'FROM `', @target_db, '`.`subcategories` WHERE archived_at IS NULL GROUP BY category_id, TRIM(name) HAVING COUNT(*) > 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''existing_level1_matches'' AS metric, COUNT(*) AS value ',
  'FROM `', @stage_db, '`.`level1_seed` s ',
  'INNER JOIN `', @target_db, '`.`categories` c ON CONVERT(TRIM(c.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin AND c.archived_at IS NULL'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''existing_level2_matches'' AS metric, COUNT(*) AS value ',
  'FROM `', @stage_db, '`.`level2_seed` s ',
  'INNER JOIN `', @stage_db, '`.`level1_seed` p ON p.seed_category_id = s.parent_seed_category_id ',
  'INNER JOIN `', @target_db, '`.`categories` c ON CONVERT(TRIM(c.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p.seed_name USING utf8mb4) COLLATE utf8mb4_bin AND c.archived_at IS NULL ',
  'INNER JOIN `', @target_db, '`.`subcategories` sc ON sc.category_id = c.id AND CONVERT(TRIM(sc.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin AND sc.archived_at IS NULL'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT COUNT(*) INTO @seed_dup_level1 FROM (',
  'SELECT seed_name FROM `', @stage_db, '`.`level1_seed` GROUP BY seed_name HAVING COUNT(*) > 1',
  ') d'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT COUNT(*) INTO @seed_dup_level2 FROM (',
  'SELECT parent_seed_category_id, seed_name FROM `', @stage_db, '`.`level2_seed` GROUP BY parent_seed_category_id, seed_name HAVING COUNT(*) > 1',
  ') d'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT COUNT(*) INTO @live_dup_categories FROM (',
  'SELECT TRIM(name) FROM `', @target_db, '`.`categories` WHERE archived_at IS NULL GROUP BY TRIM(name) HAVING COUNT(*) > 1',
  ') d'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT COUNT(*) INTO @live_dup_subcategories FROM (',
  'SELECT category_id, TRIM(name) FROM `', @target_db, '`.`subcategories` WHERE archived_at IS NULL GROUP BY category_id, TRIM(name) HAVING COUNT(*) > 1',
  ') d'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT COUNT(*) INTO @missing_level2_parents FROM `', @stage_db, '`.`level2_seed` s ',
  'LEFT JOIN `', @stage_db, '`.`level1_seed` p ON p.seed_category_id = s.parent_seed_category_id ',
  'WHERE p.seed_category_id IS NULL'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'preflight_status' AS metric,
  CASE
    WHEN @seed_dup_level1 > 0 THEN 'fail_seed_duplicate_level1'
    WHEN @seed_dup_level2 > 0 THEN 'fail_seed_duplicate_level2'
    WHEN @live_dup_categories > 0 THEN 'fail_live_duplicate_categories'
    WHEN @live_dup_subcategories > 0 THEN 'fail_live_duplicate_subcategories'
    WHEN @missing_level2_parents > 0 THEN 'fail_missing_level2_parents'
    ELSE 'ok'
  END AS value;

SELECT @seed_dup_level1 AS seed_dup_level1,
  @seed_dup_level2 AS seed_dup_level2,
  @live_dup_categories AS live_dup_categories,
  @live_dup_subcategories AS live_dup_subcategories,
  @missing_level2_parents AS missing_level2_parents;
SQL
sed -i "s/__DB_NAME__/${DB_NAME}/g; s/__STAGE_DB__/${STAGE_DB}/g" "${SQL_FILE}"

info "Running import preflight"
PRECHECK_OUTPUT="$(podman exec -i bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  --table \
  "${DB_NAME}" 2>&1 < "${SQL_FILE}")"
rm -f "${SQL_FILE}"

printf '%s\n' "${PRECHECK_OUTPUT}"

if [[ "${PRECHECK_OUTPUT}" != *"ok"* ]]; then
  error "Preflight failed. Import aborted."
  exit 1
fi

if [[ "${MODE}" == "dry-run" ]]; then
  success "Dry run completed. No data was changed."
  if [[ ${KEEP_STAGE_DB} -eq 1 ]]; then
    success "Staging database retained: ${STAGE_DB}"
  fi
  exit 0
fi

APPLY_SQL_FILE="$(mktemp)"
cat > "${APPLY_SQL_FILE}" <<'SQL'
START TRANSACTION;

UPDATE \
  \
  __DB_NAME__.categories c
INNER JOIN __STAGE_DB__.level1_seed s
  ON CONVERT(TRIM(c.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND c.archived_at IS NULL
SET c.description = s.description,
    c.`order` = s.sort_order;
SET @updated_categories := ROW_COUNT();

INSERT INTO __DB_NAME__.categories (name, description, `order`)
SELECT s.seed_name, s.description, s.sort_order
FROM __STAGE_DB__.level1_seed s
LEFT JOIN __DB_NAME__.categories c
  ON CONVERT(TRIM(c.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND c.archived_at IS NULL
WHERE c.id IS NULL;
SET @inserted_categories := ROW_COUNT();

CREATE OR REPLACE TABLE __STAGE_DB__.category_map AS
SELECT s.seed_category_id, c.id AS live_category_id
FROM __STAGE_DB__.level1_seed s
INNER JOIN __DB_NAME__.categories c
  ON CONVERT(TRIM(c.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND c.archived_at IS NULL;

UPDATE __DB_NAME__.subcategories sc
INNER JOIN __STAGE_DB__.level2_seed s
  ON CONVERT(TRIM(sc.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND sc.archived_at IS NULL
INNER JOIN __STAGE_DB__.category_map m
  ON m.seed_category_id = s.parent_seed_category_id
 AND sc.category_id = m.live_category_id
SET sc.description = s.description,
    sc.`order` = s.sort_order;
SET @updated_subcategories := ROW_COUNT();

INSERT INTO __DB_NAME__.subcategories (category_id, name, description, `order`)
SELECT m.live_category_id, s.seed_name, s.description, s.sort_order
FROM __STAGE_DB__.level2_seed s
INNER JOIN __STAGE_DB__.category_map m
  ON m.seed_category_id = s.parent_seed_category_id
LEFT JOIN __DB_NAME__.subcategories sc
  ON sc.category_id = m.live_category_id
 AND CONVERT(TRIM(sc.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(s.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND sc.archived_at IS NULL
WHERE sc.id IS NULL;
SET @inserted_subcategories := ROW_COUNT();

COMMIT;

SELECT 'updated_categories' AS metric, @updated_categories AS value
UNION ALL SELECT 'inserted_categories', @inserted_categories
UNION ALL SELECT 'updated_subcategories', @updated_subcategories
UNION ALL SELECT 'inserted_subcategories', @inserted_subcategories;
SQL
sed -i "s/__DB_NAME__/${DB_NAME}/g; s/__STAGE_DB__/${STAGE_DB}/g" "${APPLY_SQL_FILE}"

info "Applying import"
APPLY_OUTPUT="$(podman exec -i bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  --table \
  "${DB_NAME}" 2>&1 < "${APPLY_SQL_FILE}")"
rm -f "${APPLY_SQL_FILE}"

printf '%s\n' "${APPLY_OUTPUT}"

VERIFY_SQL_FILE="$(mktemp)"
cat > "${VERIFY_SQL_FILE}" <<'SQL'
SELECT 'active_categories_after_import' AS metric, COUNT(*) AS value
FROM __DB_NAME__.categories
WHERE archived_at IS NULL;

SELECT 'active_subcategories_after_import' AS metric, COUNT(*) AS value
FROM __DB_NAME__.subcategories
WHERE archived_at IS NULL;

SELECT c.name, sc.name, sc.description
FROM __DB_NAME__.subcategories sc
INNER JOIN __DB_NAME__.categories c ON c.id = sc.category_id
WHERE c.name IN ('Technology', 'Science_Engineering')
ORDER BY c.`order`, c.name, sc.`order`, sc.name
LIMIT 8;
SQL
sed -i "s/__DB_NAME__/${DB_NAME}/g" "${VERIFY_SQL_FILE}"

info "Verifying import results"
podman exec -i bookmark-db mariadb \
  --user=root \
  --password="${DB_ROOT_PASSWORD}" \
  --table \
  "${DB_NAME}" < "${VERIFY_SQL_FILE}"
rm -f "${VERIFY_SQL_FILE}"

success "Import completed successfully."
if [[ ${KEEP_STAGE_DB} -eq 1 ]]; then
  success "Staging database retained: ${STAGE_DB}"
fi
