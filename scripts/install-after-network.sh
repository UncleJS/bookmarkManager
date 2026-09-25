#!/usr/bin/env bash
# Install the user-session network-online drop-in for the invoking account.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_UID="${SUDO_UID:-$(id -u)}"

if [[ "$TARGET_UID" == "0" ]]; then
  echo "Run this through sudo from your login user, so the drop-in targets that user session." >&2
  exit 1
fi

if [[ "$(id -u)" != "0" ]]; then
  echo "Re-run with sudo: sudo ./scripts/install-after-network.sh" >&2
  exit 1
fi

DEST="/etc/systemd/system/user@${TARGET_UID}.service.d"
install -d -m 755 "$DEST"
install -m 644 "$ROOT_DIR/quadlet/system-dropin/after-network.conf" "$DEST/after-network.conf"
systemctl daemon-reload
echo "Installed network-online ordering for user@${TARGET_UID}."
