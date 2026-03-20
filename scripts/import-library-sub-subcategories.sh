#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/api/.env.api"
FALLBACK_ENV_FILE="${REPO_ROOT}/api/.env"
SEED_FILE="${REPO_ROOT}/backups/library_categories_schema_seed.sql"
MODE="dry-run"

info() { printf '[library-subsub-import] %s\n' "$*"; }
error() { printf '[library-subsub-import] %s\n' "$*" >&2; }

load_env_value() {
  local source_file="$1"
  local key="$2"
  grep -E "^${key}=" "${source_file}" | cut -d= -f2- | tr -d "'\""
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  ENV_FILE="${FALLBACK_ENV_FILE}"
fi

DB_USER="$(load_env_value "${ENV_FILE}" DB_USER)"
DB_PASSWORD="$(load_env_value "${ENV_FILE}" DB_PASSWORD)"
DB_NAME="$(load_env_value "${ENV_FILE}" DB_NAME)"
DB_ROOT_PASSWORD="$(load_env_value "${REPO_ROOT}/api/.env" MARIADB_ROOT_PASSWORD)"
STAGE_DB="library_subsub_import_$(date +%Y%m%d_%H%M%S)_$RANDOM"

cleanup() {
  podman exec bookmark-db mariadb --user=root --password="${DB_ROOT_PASSWORD}" --execute="DROP DATABASE IF EXISTS \`${STAGE_DB}\`" >/dev/null 2>&1 || true
}
trap cleanup EXIT

info "Creating staging database ${STAGE_DB}"
podman exec bookmark-db mariadb --user=root --password="${DB_ROOT_PASSWORD}" --execute="CREATE DATABASE \`${STAGE_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
podman exec -i bookmark-db mariadb --user=root --password="${DB_ROOT_PASSWORD}" "${STAGE_DB}" < "${SEED_FILE}"

SQL_FILE="$(mktemp)"
cat > "${SQL_FILE}" <<'SQL'
SET @target_db := '__DB_NAME__';
SET @stage_db := '__STAGE_DB__';

SET @sql := CONCAT(
  'CREATE OR REPLACE TABLE `', @stage_db, '`.`level1_seed` AS ',
  'SELECT category_id, TRIM(category_name) AS seed_name FROM `', @stage_db, '`.`library_categories` WHERE category_level = 1 AND is_active = 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'CREATE OR REPLACE TABLE `', @stage_db, '`.`level2_seed` AS ',
  'SELECT category_id, parent_id, TRIM(category_name) AS seed_name FROM `', @stage_db, '`.`library_categories` WHERE category_level = 2 AND is_active = 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'CREATE OR REPLACE TABLE `', @stage_db, '`.`level3_seed` AS ',
  'SELECT category_id, parent_id, TRIM(category_name) AS seed_name, description, sort_order FROM `', @stage_db, '`.`library_categories` WHERE category_level = 3 AND is_active = 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'CREATE OR REPLACE TABLE `', @stage_db, '`.`parent_map` AS ',
  'SELECT l3.category_id AS seed_sub_subcategory_id, c.id AS live_category_id, s.id AS live_subcategory_id, l3.seed_name, l3.description, l3.sort_order ',
  'FROM `', @stage_db, '`.`level3_seed` l3 ',
  'INNER JOIN `', @stage_db, '`.`level2_seed` l2 ON l2.category_id = l3.parent_id ',
  'INNER JOIN `', @stage_db, '`.`level1_seed` l1 ON l1.category_id = l2.parent_id ',
  'INNER JOIN `', @target_db, '`.`categories` c ON CONVERT(TRIM(c.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(l1.seed_name USING utf8mb4) COLLATE utf8mb4_bin AND c.archived_at IS NULL ',
  'INNER JOIN `', @target_db, '`.`subcategories` s ON s.category_id = c.id AND CONVERT(TRIM(s.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(l2.seed_name USING utf8mb4) COLLATE utf8mb4_bin AND s.archived_at IS NULL'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := CONCAT(
  'SELECT ''seed_level3_rows'' AS metric, COUNT(*) AS value FROM `', @stage_db, '`.`level3_seed` ',
  'UNION ALL SELECT ''mapped_level3_rows'', COUNT(*) FROM `', @stage_db, '`.`parent_map` ',
  'UNION ALL SELECT ''missing_parent_rows'', (SELECT COUNT(*) FROM `', @stage_db, '`.`level3_seed`) - (SELECT COUNT(*) FROM `', @stage_db, '`.`parent_map`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SQL
sed -i "s/__DB_NAME__/${DB_NAME}/g; s/__STAGE_DB__/${STAGE_DB}/g" "${SQL_FILE}"
podman exec -i bookmark-db mariadb --user=root --password="${DB_ROOT_PASSWORD}" --table "${DB_NAME}" < "${SQL_FILE}"
rm -f "${SQL_FILE}"

if [[ "${MODE}" == "dry-run" ]]; then
  info "Dry run complete"
  exit 0
fi

APPLY_SQL="$(mktemp)"
cat > "${APPLY_SQL}" <<'SQL'
UPDATE __DB_NAME__.sub_subcategories live
INNER JOIN __STAGE_DB__.parent_map staged
  ON live.subcategory_id = staged.live_subcategory_id
 AND CONVERT(TRIM(live.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(staged.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND live.archived_at IS NULL
SET live.description = staged.description,
    live.`order` = staged.sort_order;
SET @updated_rows := ROW_COUNT();

INSERT INTO __DB_NAME__.sub_subcategories (subcategory_id, name, description, `order`)
SELECT staged.live_subcategory_id, staged.seed_name, staged.description, staged.sort_order
FROM __STAGE_DB__.parent_map staged
LEFT JOIN __DB_NAME__.sub_subcategories live
  ON live.subcategory_id = staged.live_subcategory_id
 AND CONVERT(TRIM(live.name) USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(staged.seed_name USING utf8mb4) COLLATE utf8mb4_bin
 AND live.archived_at IS NULL
WHERE live.id IS NULL;
SET @inserted_rows := ROW_COUNT();

SELECT 'updated_sub_subcategories' AS metric, @updated_rows AS value
UNION ALL SELECT 'inserted_sub_subcategories', @inserted_rows;
SQL
sed -i "s/__DB_NAME__/${DB_NAME}/g; s/__STAGE_DB__/${STAGE_DB}/g" "${APPLY_SQL}"
podman exec -i bookmark-db mariadb --user=root --password="${DB_ROOT_PASSWORD}" --table "${DB_NAME}" < "${APPLY_SQL}"
rm -f "${APPLY_SQL}"

info "Import complete"
