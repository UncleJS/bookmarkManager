# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS

# shellcheck shell=bash
# Sourced library (not executable): inherits set -euo pipefail from the caller.
# =============================================================================
# scripts/lib/test-pod.sh — Throwaway test pods. Sourced after common.sh.
#
# A test pod is a plain podman pod (no Quadlet: it lives only for one test
# run and must also work in CI without a systemd user session). It has no
# published ports, its own named DB volume and random credentials, and it
# carries the instance labels so uninstall.sh finds it if a run is killed.
# It never touches the real pod or its volume.
# =============================================================================

TEST_LABEL_ARGS=(--label "${APP_LABEL}" --label "${INSTANCE_LABEL}" --label bookmark-manager.role=test)

# testpod_create <pod> — pod + volume <pod>-db-data + MariaDB container <pod>-db.
# Sets TEST_ROOT_PW, TEST_DB_USER, TEST_DB_PW.
testpod_create() {
  local pod="$1"
  TEST_ROOT_PW="$(random_secret 24)"
  TEST_DB_USER="bookmark"
  TEST_DB_PW="$(random_secret 24)"

  testpod_remove "${pod}"
  podman volume create "${TEST_LABEL_ARGS[@]}" "${pod}-db-data" >/dev/null
  podman pod create "${TEST_LABEL_ARGS[@]}" --name "${pod}" >/dev/null
  podman run -d --pod "${pod}" --name "${pod}-db" "${TEST_LABEL_ARGS[@]}" \
    -e MARIADB_ROOT_PASSWORD="${TEST_ROOT_PW}" \
    -e MARIADB_DATABASE=bookmarks \
    -e MARIADB_USER="${TEST_DB_USER}" \
    -e MARIADB_PASSWORD="${TEST_DB_PW}" \
    -v "${pod}-db-data:/var/lib/mysql:Z" \
    "${MARIADB_IMAGE}" --default-time-zone=+00:00 >/dev/null

  info "Waiting for MariaDB in ${pod} ..."
  local i
  for i in $(seq 1 60); do
    if podman exec "${pod}-db" healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  error "MariaDB in ${pod} did not become ready."
  podman logs --tail 30 "${pod}-db" >&2 || true
  return 1
}

# testpod_remove <pod> — remove the pod, its containers and its volume.
testpod_remove() {
  local pod="$1"
  podman pod exists "${pod}" && podman pod rm -f -t 5 "${pod}" >/dev/null
  podman volume exists "${pod}-db-data" && podman volume rm -f "${pod}-db-data" >/dev/null
  return 0
}

# testpod_sql <pod> <db> — run SQL from stdin as root in the test DB.
testpod_sql() {
  podman exec -i "$1-db" mariadb --user=root --password="${TEST_ROOT_PW}" --batch --skip-column-names "$2"
}
