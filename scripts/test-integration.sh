#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
# =============================================================================
# scripts/test-integration.sh — API integration tests in a throwaway pod.
#
# Steps:
#   1. Build the API test image (source COPY'd in; no bind mounts)
#   2. Create pod bookmark-it<suffix> with its own MariaDB + volume
#   3. Run `bun test src/tests` in the test image inside that pod
#   4. Backup/restore check: migrate a fresh DB, mariadb-dump it, restore it
#      into a temp DB and check the core tables
#   5. Remove the pod and its volume (unless --keep)
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
source "${REPO_ROOT}/scripts/lib/test-pod.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] scripts/test-integration.sh [--no-build] [--keep] [-- bun-test-args...]

Run the API integration tests in throwaway pod ${IT_POD}. The real pod
and its data are never used.

  --no-build   reuse the existing ${API_TEST_IMAGE}
  --keep       keep the test pod and volume afterwards (for debugging)
  -h, --help   show this help
EOF2
}

BUILD=1; KEEP=0; TEST_ARGS=(src/tests)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    --) shift; TEST_ARGS=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
  esac
  shift
done

EXPECTED_TABLES=(bookmarks tags categories subcategories sub_subcategories
  bookmark_tags bookmark_categories bookmark_subcategories bookmark_sub_subcategories)

describe_instance
cleanup() {
  if (( KEEP )); then
    warn "Kept ${IT_POD} (remove with: podman pod rm -f ${IT_POD}; podman volume rm ${IT_POD}-db-data)"
  else
    testpod_remove "${IT_POD}"
  fi
}
trap cleanup EXIT

(( BUILD )) && "${REPO_ROOT}/scripts/build.sh" --test
podman image exists "${MARIADB_IMAGE}" || podman pull -q "${MARIADB_IMAGE}" >/dev/null

testpod_create "${IT_POD}"

run_in_pod() { # run the test image in the test pod as DB root
  podman run --rm --pod "${IT_POD}" "${TEST_LABEL_ARGS[@]}" \
    -e DB_HOST=127.0.0.1 -e DB_PORT=3306 \
    -e DB_USER=root -e DB_PASSWORD="${TEST_ROOT_PW}" \
    -e MARIADB_ROOT_PASSWORD="${TEST_ROOT_PW}" \
    "$@"
}

info "Running bun test ${TEST_ARGS[*]} ..."
echo "CREATE DATABASE IF NOT EXISTS bookmarks_test" | testpod_sql "${IT_POD}" mysql
run_in_pod -e DB_NAME=bookmarks_test "${API_TEST_IMAGE}" bun test "${TEST_ARGS[@]}"
success "bun test passed."

info "Backup/restore check ..."
run_in_pod -e DB_NAME=bookmarks "${API_TEST_IMAGE}" bun run src/db/migrate.ts
podman exec "${IT_POD}-db" sh -c \
  'mariadb-dump --user=root --password="$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers bookmarks | gzip -9 > /tmp/backup.sql.gz && gzip -t /tmp/backup.sql.gz'
echo "CREATE DATABASE backup_verify" | testpod_sql "${IT_POD}" mysql
podman exec "${IT_POD}-db" sh -c \
  'gunzip -c /tmp/backup.sql.gz | mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" backup_verify'
restored="$(echo "SELECT table_name FROM information_schema.tables WHERE table_schema='backup_verify'" \
  | testpod_sql "${IT_POD}" mysql)"
for t in "${EXPECTED_TABLES[@]}"; do
  if ! grep -qxF "${t}" <<<"${restored}"; then
    error "Restore check failed: table '${t}' missing after restore."
    exit 1
  fi
done
success "Backup/restore check passed (${#EXPECTED_TABLES[@]} core tables restored)."
success "Integration tests passed."
