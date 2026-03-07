#!/usr/bin/env bash
# =============================================================================
# scripts/install.sh — Full install for Bookmark Manager
#
# Steps:
#   1. Verify we're at repo root
#   2. Check / bootstrap api/.env
#   3. Verify podman is available
#   4. Pull base images
#   5. Build localhost/bookmark-api:latest
#   6. Create DB data volume directory
#   7. Copy Quadlet unit files into ~/.config/containers/systemd/
#   8. systemctl --user daemon-reload
#   9. Enable + start bookmark-pod.service
#  10. Print service URLs
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUADLET_SRC="${REPO_ROOT}/quadlet"
QUADLET_DEST="${HOME}/.config/containers/systemd"
ENV_FILE="${REPO_ROOT}/api/.env"
ENV_EXAMPLE="${REPO_ROOT}/api/.env.example"
DB_VOLUME_NAME="bookmark-db-data"
OLD_DB_VOLUME_DIR="${HOME}/.local/share/bookmark-manager/prod-db"

# ---- colours -----------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[install]${NC} $*"; }
success() { echo -e "${GREEN}[install]${NC} $*"; }
warn()    { echo -e "${YELLOW}[install]${NC} $*"; }
error()   { echo -e "${RED}[install]${NC} $*" >&2; }

# ---- 1. repo root check ------------------------------------------------------
if [[ ! -d "${REPO_ROOT}/api" || ! -d "${REPO_ROOT}/quadlet" ]]; then
  error "Must be run from the bookmarkManager repo root."
  error "Expected: api/ and quadlet/ directories to exist."
  exit 1
fi

info "Repo root: ${REPO_ROOT}"

# ---- 2. .env check -----------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    error "Neither api/.env nor api/.env.example found. Cannot continue."
    exit 1
  fi
  warn "api/.env not found — copying from api/.env.example"
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  echo ""
  warn "================================================================"
  warn "  ACTION REQUIRED: edit api/.env and set real passwords before"
  warn "  running install again."
  warn ""
  warn "  nano ${ENV_FILE}"
  warn "================================================================"
  echo ""
  exit 1
fi

info "api/.env found."

# ---- 3. podman check ---------------------------------------------------------
if ! command -v podman &>/dev/null; then
  error "podman not found on PATH. Install Podman before continuing."
  exit 1
fi
info "podman: $(podman --version)"

# ---- 4. pull base images -----------------------------------------------------
info "Pulling base images..."
podman pull docker.io/mariadb:11
podman pull docker.io/phpmyadmin:5

# ---- 5. build API image ------------------------------------------------------
info "Building localhost/bookmark-api:latest ..."
podman build -t localhost/bookmark-api:latest "${REPO_ROOT}/api"
success "API image built."

# ---- 6. DB named volume + optional data migration ----------------------------
if ! podman volume exists "${DB_VOLUME_NAME}" 2>/dev/null; then
  info "Creating Podman volume: ${DB_VOLUME_NAME}"
  podman volume create "${DB_VOLUME_NAME}"
  success "Volume created: ${DB_VOLUME_NAME}"
else
  info "Podman volume already exists: ${DB_VOLUME_NAME}"
fi

# Migrate data from old bind-mount path if it has content
if [[ -d "${OLD_DB_VOLUME_DIR}" ]] && [[ -n "$(ls -A "${OLD_DB_VOLUME_DIR}" 2>/dev/null)" ]]; then
  VOLUME_MOUNTPOINT="$(podman volume inspect "${DB_VOLUME_NAME}" --format '{{.Mountpoint}}')"
  if [[ -z "$(ls -A "${VOLUME_MOUNTPOINT}" 2>/dev/null)" ]]; then
    warn "Old bind-mount data found at: ${OLD_DB_VOLUME_DIR}"
    info "Migrating data into Podman volume ${DB_VOLUME_NAME} ..."
    podman unshare cp -a "${OLD_DB_VOLUME_DIR}/." "${VOLUME_MOUNTPOINT}/"
    success "Data migrated to Podman volume."
    # Rename old directory as a backup
    mv "${OLD_DB_VOLUME_DIR}" "${OLD_DB_VOLUME_DIR}.bak"
    info "Old directory renamed to: ${OLD_DB_VOLUME_DIR}.bak"
    info "You may delete it once you have verified the service is healthy."
  else
    info "Podman volume already has data — skipping migration."
  fi
fi

# ---- 7. copy Quadlet files ---------------------------------------------------
info "Copying Quadlet unit files to ${QUADLET_DEST}/"
mkdir -p "${QUADLET_DEST}"
cp "${QUADLET_SRC}/bookmark.pod"            "${QUADLET_DEST}/bookmark.pod"
cp "${QUADLET_SRC}/bookmark-db.volume"      "${QUADLET_DEST}/bookmark-db.volume"
cp "${QUADLET_SRC}/bookmark-api.container"  "${QUADLET_DEST}/bookmark-api.container"
cp "${QUADLET_SRC}/bookmark-db.container"   "${QUADLET_DEST}/bookmark-db.container"
cp "${QUADLET_SRC}/bookmark-pma.container"  "${QUADLET_DEST}/bookmark-pma.container"
success "Quadlet files copied."

# ---- 8. daemon-reload --------------------------------------------------------
info "Reloading systemd user daemon..."
systemctl --user daemon-reload
success "Daemon reloaded."

# ---- 9. enable + start -------------------------------------------------------
info "Enabling and starting bookmark-pod.service..."
systemctl --user enable --now bookmark-pod.service
success "bookmark-pod.service started."

# ---- 10. URLs ----------------------------------------------------------------
echo ""
success "================================================================"
success "  Bookmark Manager is running!"
success ""
success "  API         http://localhost:11650"
success "  Swagger UI  http://localhost:11650/docs"
success "  phpMyAdmin  http://localhost:11651  (login required)"
success "================================================================"
echo ""
info "Useful commands:"
echo "  ./scripts/status.sh        — service status"
echo "  ./scripts/logs.sh          — tail API logs"
echo "  ./scripts/stop.sh          — stop all services"
