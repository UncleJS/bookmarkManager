#!/usr/bin/env bash
# =============================================================================
# scripts/uninstall.sh — Remove Bookmark Manager services and optionally
#                        clean up the image and DB data volume.
#
# Steps:
#   1. Stop bookmark-pod.service
#   2. Disable bookmark-pod.service
#   3. Remove Quadlet unit files
#   4. systemctl --user daemon-reload
#   5. (Interactive) Remove localhost/bookmark-api image?
#   6. (Interactive) Remove DB data volume?
# =============================================================================
set -euo pipefail

QUADLET_DEST="${HOME}/.config/containers/systemd"
DB_VOLUME_DIR="${HOME}/.local/share/bookmark-manager/prod-db"

# ---- colours -----------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[uninstall]${NC} $*"; }
success() { echo -e "${GREEN}[uninstall]${NC} $*"; }
warn()    { echo -e "${YELLOW}[uninstall]${NC} $*"; }

# ---- 1. stop -----------------------------------------------------------------
info "Stopping bookmark-pod.service (if running)..."
systemctl --user stop bookmark-pod.service 2>/dev/null || true
success "Stopped."

# ---- 2. disable --------------------------------------------------------------
info "Disabling bookmark-pod.service (if enabled)..."
systemctl --user disable bookmark-pod.service 2>/dev/null || true
success "Disabled."

# ---- 3. remove Quadlet files -------------------------------------------------
info "Removing Quadlet unit files..."
REMOVED=0
for f in bookmark.pod bookmark-api.container bookmark-db.container bookmark-pma.container; do
  TARGET="${QUADLET_DEST}/${f}"
  if [[ -f "${TARGET}" ]]; then
    rm -f "${TARGET}"
    info "  Removed: ${TARGET}"
    REMOVED=$((REMOVED + 1))
  else
    warn "  Not found (skipping): ${TARGET}"
  fi
done
[[ ${REMOVED} -gt 0 ]] && success "Quadlet files removed." || warn "No Quadlet files found to remove."

# ---- 4. daemon-reload --------------------------------------------------------
info "Reloading systemd user daemon..."
systemctl --user daemon-reload
success "Daemon reloaded."

# ---- 5. remove API image? ----------------------------------------------------
echo ""
warn "Remove the API container image 'localhost/bookmark-api:latest'?"
warn "  (This will require a full rebuild on next install.)"
read -r -p "  Remove image? [y/N] " REMOVE_IMAGE
REMOVE_IMAGE="${REMOVE_IMAGE:-N}"
if [[ "${REMOVE_IMAGE,,}" == "y" ]]; then
  if podman image exists localhost/bookmark-api:latest 2>/dev/null; then
    podman rmi localhost/bookmark-api:latest
    success "Image removed."
  else
    warn "Image not found — nothing to remove."
  fi
else
  info "Keeping image (skipped)."
fi

# ---- 6. remove DB data volume? -----------------------------------------------
echo ""
warn "================================================================"
warn "  WARNING: Removing the DB data volume will PERMANENTLY DELETE"
warn "  all bookmark data stored in MariaDB."
warn ""
warn "  Volume path: ${DB_VOLUME_DIR}"
warn "================================================================"
read -r -p "  Delete DB data volume? [y/N] " REMOVE_DATA
REMOVE_DATA="${REMOVE_DATA:-N}"
if [[ "${REMOVE_DATA,,}" == "y" ]]; then
  if [[ -d "${DB_VOLUME_DIR}" ]]; then
    rm -rf "${DB_VOLUME_DIR}"
    success "DB data volume removed."
  else
    warn "Volume directory not found — nothing to remove."
  fi
else
  info "Keeping DB data (skipped). Data remains at: ${DB_VOLUME_DIR}"
fi

echo ""
success "Uninstall complete."
