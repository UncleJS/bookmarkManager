#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
# =============================================================================
# scripts/install.sh — Install Bookmark Manager as rootless Podman Quadlet units.
#
# Steps:
#   1. Check prerequisites (rootless podman, systemd user session)
#   2. Check api/.env (job instances get a generated env file)
#   3. Split it into per-service env files, install them (mode 600) under
#      ~/.config/bookmark-manager<suffix>/
#   4. Pull the pinned base images, build the API image (scripts/build.sh)
#   5. Render quadlet/* into ~/.config/containers/systemd/ (names suffixed
#      and ports offset when JOB / PORT_OFFSET are set), daemon-reload
#   6. Start (or restart) the pod and wait for the API (unless --no-start)
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: [JOB=<slug>] [PORT_OFFSET=<n>] scripts/install.sh [--no-start]

Build the images, install the Quadlet units for this instance and start it.

  --no-start   install only; don't start the pod
  -h, --help   show this help

Main instance:  reads api/.env (copied from api/.env.example on first run;
                edit it, then run install again).
Job instance:   JOB=<slug> reads api/.env.job-<slug>, generated with random
                secrets if missing. Names get the suffix -<slug>, published
                ports get +PORT_OFFSET, and the pod does not start at boot.
EOF
}

START=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start) START=0 ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
  esac
  shift
done

OLD_DB_VOLUME_DIR="${HOME}/.local/share/bookmark-manager/prod-db"

write_env_file() {
  local source_file="$1" target_file="$2"
  shift 2
  : > "${target_file}"
  chmod 600 "${target_file}"
  local key line
  for key in "$@"; do
    line="$(grep -E "^${key}=" "${source_file}" | tail -n1 || true)"
    if [[ -z "${line}" ]]; then
      error "Required key '${key}' missing from ${source_file}."
      exit 1
    fi
    printf '%s\n' "${line}" >> "${target_file}"
  done
}

# Generate a job env file from the example with fresh random secrets.
generate_job_env() {
  local db_pw root_pw
  db_pw="$(random_secret 24)"; root_pw="$(random_secret 24)"
  (umask 077; sed \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=${db_pw}|" \
    -e "s|^MARIADB_PASSWORD=.*|MARIADB_PASSWORD=${db_pw}|" \
    -e "s|^MARIADB_ROOT_PASSWORD=.*|MARIADB_ROOT_PASSWORD=${root_pw}|" \
    -e "s|^API_TOKEN=.*|API_TOKEN=$(random_secret 32)|" \
    -e "s|^BACKUP_TOKEN=.*|BACKUP_TOKEN=$(random_secret 32)|" \
    -e "s|^PMA_ABSOLUTE_URI=.*|PMA_ABSOLUTE_URI=${PMA_URL}/|" \
    "${ENV_EXAMPLE}" > "${ENV_FILE}")
}

# Render one repo unit into the installed unit for this instance.
render_unit() {
  local src="$1" dest="$2"
  local -a expr=(
    -e "s|bookmark-pod\.service|${POD_SERVICE}|g"
    -e "s|bookmark-db-volume\.service|${VOLUME_SERVICE}|g"
    -e "s|bookmark-db\.service|${DB_SERVICE}|g"
    -e "s|bookmark-api\.service|${API_SERVICE}|g"
    -e "s|bookmark-pma\.service|${PMA_SERVICE}|g"
    -e "s|^Pod=bookmark\.pod$|Pod=bookmark${SUFFIX}.pod|"
    -e "s|^Volume=bookmark-db\.volume:|Volume=bookmark-db${SUFFIX}.volume:|"
    -e "s|^VolumeName=bookmark-db-data$|VolumeName=${DB_VOLUME}|"
    -e "s|^ContainerName=bookmark-api$|ContainerName=${API_CONTAINER}|"
    -e "s|^ContainerName=bookmark-db$|ContainerName=${DB_CONTAINER}|"
    -e "s|^ContainerName=bookmark-pma$|ContainerName=${PMA_CONTAINER}|"
    -e "s|^Image=localhost/bookmark-api:latest$|Image=${API_IMAGE}|"
    -e "s|%h/\.config/bookmark-manager/|%h/.config/bookmark-manager${SUFFIX}/|"
    -e "s|^Label=bookmark-manager\.instance=bookmark$|Label=${INSTANCE_LABEL}|"
    -e "s|^PublishPort=127\.0\.0\.1:11650:${API_CONTAINER_PORT}$|PublishPort=127.0.0.1:${API_HOST_PORT}:${API_CONTAINER_PORT}|"
    -e "s|^PublishPort=127\.0\.0\.1:11651:${PMA_CONTAINER_PORT}$|PublishPort=127.0.0.1:${PMA_HOST_PORT}:${PMA_CONTAINER_PORT}|"
  )
  if [[ -n "${JOB}" ]]; then
    expr+=(
      -e "s|^\(Description=.*\)$|\1 (job ${JOB})|"
      # job pods are started by hand, never at boot
      -e "/^WantedBy=default\.target$/d"
    )
  fi
  sed "${expr[@]}" "${src}" > "${dest}"
}

describe_instance

if [[ -n "${JOB}" ]] && (( PORT_OFFSET == 0 )); then
  error "JOB=${JOB} needs a non-zero PORT_OFFSET, or its ports clash with the main instance (11650/11651)."
  exit 2
fi

# ---- 1. prerequisites --------------------------------------------------------
command -v podman >/dev/null || { error "podman not found on PATH."; exit 1; }
if [[ "$(podman info --format '{{.Host.Security.Rootless}}')" != "true" ]]; then
  error "podman is not running rootless. Run this script as your normal user."
  exit 1
fi
if ! systemctl --user show-environment >/dev/null 2>&1; then
  error "No systemd user session (systemctl --user). Log in normally or run: loginctl enable-linger \$USER"
  exit 1
fi
info "podman: $(podman --version)"

# ---- 2. env file -------------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  [[ -f "${ENV_EXAMPLE}" ]] || { error "api/.env.example not found."; exit 1; }
  if [[ -n "${JOB}" ]]; then
    generate_job_env
    success "Generated ${ENV_FILE#"${REPO_ROOT}"/} with random secrets."
  else
    (umask 077; cp "${ENV_EXAMPLE}" "${ENV_FILE}")
    warn "api/.env was missing and has been copied from api/.env.example."
    warn "ACTION REQUIRED: set real passwords and tokens in ${ENV_FILE}, then run install again."
    exit 1
  fi
fi
info "Env file: ${ENV_FILE#"${REPO_ROOT}"/}"

# ---- 3. split env files ------------------------------------------------------
write_env_file "${ENV_FILE}" "${API_ENV_FILE}" \
  API_PORT LOG_LEVEL DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME API_TOKEN BACKUP_TOKEN
write_env_file "${ENV_FILE}" "${DB_ENV_FILE}" \
  MARIADB_DATABASE MARIADB_USER MARIADB_PASSWORD MARIADB_ROOT_PASSWORD
write_env_file "${ENV_FILE}" "${PMA_ENV_FILE}" \
  PMA_HOST PMA_PORT PMA_ABSOLUTE_URI
mkdir -p "${ENV_INSTALL_DIR}"
chmod 700 "${ENV_INSTALL_DIR}"
install -m 600 "${API_ENV_FILE}" "${ENV_INSTALL_DIR}/env.api"
install -m 600 "${DB_ENV_FILE}"  "${ENV_INSTALL_DIR}/env.db"
install -m 600 "${PMA_ENV_FILE}" "${ENV_INSTALL_DIR}/env.pma"
success "Installed env.api, env.db, env.pma into ${ENV_INSTALL_DIR}/"

# ---- 4. images ---------------------------------------------------------------
info "Pulling ${MARIADB_IMAGE} and ${PMA_IMAGE} ..."
podman pull -q "${MARIADB_IMAGE}" >/dev/null
podman pull -q "${PMA_IMAGE}" >/dev/null
"${REPO_ROOT}/scripts/build.sh" --api

# Legacy: move data from the old bind-mount directory into the named volume
# (main instance only; runs once, while the volume is still empty).
if [[ -z "${JOB}" && -d "${OLD_DB_VOLUME_DIR}" && -n "$(ls -A "${OLD_DB_VOLUME_DIR}" 2>/dev/null)" ]]; then
  podman volume exists "${DB_VOLUME}" || \
    podman volume create --label "${APP_LABEL}" --label "${INSTANCE_LABEL}" "${DB_VOLUME}" >/dev/null
  VOLUME_MOUNTPOINT="$(podman volume inspect "${DB_VOLUME}" --format '{{.Mountpoint}}')"
  if [[ -z "$(podman unshare ls -A "${VOLUME_MOUNTPOINT}" 2>/dev/null)" ]]; then
    warn "Migrating old data from ${OLD_DB_VOLUME_DIR} into volume ${DB_VOLUME} ..."
    podman unshare cp -a "${OLD_DB_VOLUME_DIR}/." "${VOLUME_MOUNTPOINT}/"
    mv "${OLD_DB_VOLUME_DIR}" "${OLD_DB_VOLUME_DIR}.bak"
    success "Migrated. Old directory kept as ${OLD_DB_VOLUME_DIR}.bak"
  fi
fi

# ---- 5. Quadlet units --------------------------------------------------------
mkdir -p "${QUADLET_DEST}"
for f in "${QUADLET_FILES[@]}"; do
  render_unit "${QUADLET_SRC}/${f}" "${QUADLET_DEST}/$(installed_unit_name "${f}")"
  info "  ${QUADLET_DEST}/$(installed_unit_name "${f}")"
done
systemctl --user daemon-reload
success "Quadlet units installed and systemd reloaded."

# ---- 6. start ----------------------------------------------------------------
if (( START )); then
  systemctl --user reset-failed "${ALL_SERVICES[@]}" 2>/dev/null || true
  if systemctl --user is-active --quiet "${POD_SERVICE}"; then
    "${REPO_ROOT}/scripts/restart.sh"
  else
    "${REPO_ROOT}/scripts/start.sh"
  fi
else
  info "Not started (--no-start). Start with: ${JOB:+JOB=${JOB} PORT_OFFSET=${PORT_OFFSET} }scripts/start.sh"
fi
