#!/usr/bin/env bash
# =============================================================================
# scripts/uninstall.sh — Remove what Bookmark Manager created to build and run.
#
# Default: stop the services, reset-failed, remove containers (incl. the
# throwaway test pods), pods, built images and their build cache, pulled base
# images no other container uses, networks/secrets, and the installed env
# copies under ~/.config. Volumes and Quadlet units are KEPT unless:
#   --purge            also remove the volumes (ALL DATA of this instance)
#   --remove-quadlets  also remove the installed units, then daemon-reload
#
# Ends with a leftover check and exits 1 if anything of this instance remains.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: [JOB=<slug>] scripts/uninstall.sh [--purge] [--remove-quadlets]

Remove instance '${INSTANCE}' without prompting.

  --purge            also delete the volumes (${DB_VOLUME} and test volumes):
                     ALL bookmark data of this instance is lost. With JOB set,
                     also deletes the generated api/.env.job-<slug>* files.
  --remove-quadlets  also delete the installed units from ${QUADLET_DEST}/
  -h, --help         show this help

'--purge --remove-quadlets' leaves no trace of the instance on the host.
EOF
}

PURGE=0; REMOVE_QUADLETS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1 ;;
    --remove-quadlets) REMOVE_QUADLETS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
  esac
  shift
done

# No Podman secrets or networks are created today (env files are used and the
# pod uses the default network); listed so the leftover check covers them.
SECRETS=()
INSTALLED_UNITS=()
for f in "${QUADLET_FILES[@]}"; do INSTALLED_UNITS+=("${QUADLET_DEST}/$(installed_unit_name "${f}")"); done
PODS=("${POD_NAME}" "${IT_POD}" "${E2E_POD}")
CONTAINERS=("${API_CONTAINER}" "${DB_CONTAINER}" "${PMA_CONTAINER}")

describe_instance
(( PURGE )) && warn "--purge: the volumes of ${INSTANCE} will be deleted."

# ---- 1. stop services, clear failed state ------------------------------------
info "Stopping services ..."
systemctl --user stop "${ALL_SERVICES[@]}" 2>/dev/null || true
systemctl --user reset-failed "${ALL_SERVICES[@]}" 2>/dev/null || true

# ---- 2. containers and pods --------------------------------------------------
label_containers() { podman ps -a --external --filter "label=${INSTANCE_LABEL}" --format '{{.ID}}'; }
mapfile -t ids < <(label_containers)
for c in "${CONTAINERS[@]}"; do podman container exists "${c}" && ids+=("${c}"); done
if (( ${#ids[@]} )); then
  info "Removing containers ..."
  podman rm -f -t 10 "${ids[@]}" >/dev/null 2>&1 || true
fi
mapfile -t pods < <(podman pod ps --filter "label=${INSTANCE_LABEL}" --format '{{.ID}}')
for p in "${PODS[@]}"; do podman pod exists "${p}" && pods+=("${p}"); done
if (( ${#pods[@]} )); then
  info "Removing pods (incl. infra containers) ..."
  podman pod rm -f -t 10 "${pods[@]}" >/dev/null 2>&1 || true
fi

# ---- 3. built images, intermediate layers, build cache -----------------------
for img in "${BUILT_IMAGES[@]}"; do
  if podman image exists "${img}"; then
    podman rmi -f "${img}" >/dev/null && info "Removed image ${img}"
  fi
done
# Intermediate/dangling layers carry the instance label (see the Containerfiles).
podman image prune -f --filter "label=${INSTANCE_LABEL}" >/dev/null || true
mapfile -t layers < <(podman images -a --filter "label=${INSTANCE_LABEL}" --format '{{.ID}}' | sort -u)
(( ${#layers[@]} )) && podman rmi -f "${layers[@]}" >/dev/null 2>&1 || true

# ---- 4. pulled base images, unless another container still uses them ---------
# Other installed instances (stopped ones have no containers) still need the
# images their units reference.
units_using() { # <image> → other installed units that reference it
  local u
  for u in "${QUADLET_DEST}"/*.container; do
    [[ -e "${u}" ]] || continue
    printf '%s\n' "${INSTALLED_UNITS[@]}" | grep -qxF "${u}" && continue
    if grep -qxF "Image=$1" "${u}"; then basename "${u}"; fi
  done
  return 0
}
SKIPPED_IMAGES=()
for img in "${BASE_IMAGES[@]}"; do
  podman image exists "${img}" || continue
  users="$(podman ps -a --external --filter "ancestor=${img}" --format '{{.Names}}' | paste -sd, -)"
  unit_users="$(units_using "${img}" | paste -sd, -)"
  if [[ -n "${unit_users}" ]]; then
    SKIPPED_IMAGES+=("${img}")
    warn "Kept base image ${img}: referenced by installed unit(s) ${unit_users}"
  elif [[ -n "${users}" ]]; then
    SKIPPED_IMAGES+=("${img}")
    warn "Kept base image ${img}: still used by ${users}"
  elif podman rmi "${img}" >/dev/null 2>&1; then
    info "Removed base image ${img}"
  else
    SKIPPED_IMAGES+=("${img}")
    warn "Kept base image ${img}: other images are built on it"
  fi
done

# ---- 5. networks and secrets -------------------------------------------------
mapfile -t nets < <(podman network ls --filter "label=${INSTANCE_LABEL}" --format '{{.Name}}')
(( ${#nets[@]} )) && podman network rm -f "${nets[@]}" >/dev/null
for s in "${SECRETS[@]}"; do podman secret exists "${s}" && podman secret rm "${s}" >/dev/null; done

# ---- 6. files under $HOME ----------------------------------------------------
if [[ -d "${ENV_INSTALL_DIR}" ]]; then
  rm -rf "${ENV_INSTALL_DIR}"
  info "Removed ${ENV_INSTALL_DIR}/"
fi

# ---- 7. volumes (--purge) ----------------------------------------------------
label_volumes() { podman volume ls --filter "label=${INSTANCE_LABEL}" --format '{{.Name}}'; }
if (( PURGE )); then
  mapfile -t vols < <(label_volumes)
  podman volume exists "${DB_VOLUME}" && vols+=("${DB_VOLUME}")
  if (( ${#vols[@]} )); then
    podman volume rm -f "${vols[@]}" >/dev/null
    info "Removed volumes: $(printf '%s ' "${vols[@]}" | xargs -n1 | sort -u | paste -sd' ' -)"
  fi
  if [[ -n "${JOB}" ]]; then
    rm -f "${ENV_FILE}" "${API_ENV_FILE}" "${DB_ENV_FILE}" "${PMA_ENV_FILE}"
    info "Removed generated ${ENV_FILE#"${REPO_ROOT}"/}*"
  fi
else
  podman volume exists "${DB_VOLUME}" && info "Kept volume ${DB_VOLUME} (use --purge to delete it)."
fi

# ---- 8. Quadlet units (--remove-quadlets) -------------------------------------
if (( REMOVE_QUADLETS )); then
  rm -f "${INSTALLED_UNITS[@]}"
  systemctl --user daemon-reload
  systemctl --user reset-failed "${ALL_SERVICES[@]}" 2>/dev/null || true
  info "Removed Quadlet units and reloaded systemd."
else
  info "Kept Quadlet units in ${QUADLET_DEST}/ (use --remove-quadlets to delete them)."
fi

# ---- 9. leftover check -------------------------------------------------------
LEFT=()
add_left() { [[ -n "$2" ]] && LEFT+=("$1: $2"); return 0; }
join() { paste -sd' ' -; }
# Print the last arg if the command succeeds; always succeeds itself, so the
# pipelines below don't trip set -e / pipefail when nothing is left.
present() { if "$@" >/dev/null 2>&1; then echo "${@: -1}"; fi; return 0; }

found="$( { label_containers; for c in "${CONTAINERS[@]}"; do present podman container exists "${c}"; done; } | join)"
add_left containers "${found}"
found="$( { podman pod ps --filter "label=${INSTANCE_LABEL}" --format '{{.Name}}'; for p in "${PODS[@]}"; do present podman pod exists "${p}"; done; } | sort -u | join)"
add_left pods "${found}"
found="$( { podman images -a --filter "label=${INSTANCE_LABEL}" --format '{{.ID}}'; for i in "${BUILT_IMAGES[@]}"; do present podman image exists "${i}"; done; } | sort -u | join)"
add_left images "${found}"
found="$(for i in "${BASE_IMAGES[@]}"; do
  if podman image exists "${i}" && ! printf '%s\n' "${SKIPPED_IMAGES[@]}" | grep -qxF "${i}"; then echo "${i}"; fi
done | join)"
add_left "base images" "${found}"
found="$(podman network ls --filter "label=${INSTANCE_LABEL}" --format '{{.Name}}' | join)"
add_left networks "${found}"
found="$(for s in "${SECRETS[@]}"; do present podman secret exists "${s}"; done | join)"
add_left secrets "${found}"
[[ -e "${ENV_INSTALL_DIR}" ]] && add_left files "${ENV_INSTALL_DIR}"
if (( PURGE )); then
  found="$( { label_volumes; present podman volume exists "${DB_VOLUME}"; } | sort -u | join)"
  add_left volumes "${found}"
  if [[ -n "${JOB}" ]]; then
    found="$(for f in "${ENV_FILE}" "${API_ENV_FILE}" "${DB_ENV_FILE}" "${PMA_ENV_FILE}"; do present test -e "${f}"; done | join)"
    add_left files "${found}"
  fi
fi
if (( REMOVE_QUADLETS )); then
  found="$(for u in "${INSTALLED_UNITS[@]}"; do present test -e "${u}"; done | join)"
  add_left units "${found}"
  found="$(for s in "${ALL_SERVICES[@]}"; do
    state="$(systemctl --user show -p LoadState --value "${s}" 2>/dev/null || true)"
    if [[ -n "${state}" && "${state}" != "not-found" ]]; then echo "${s}(${state})"; fi
  done | join)"
  add_left "systemd units" "${found}"
fi

echo ""
if (( ${#LEFT[@]} )); then
  error "Leftovers of ${INSTANCE} remain:"
  for l in "${LEFT[@]}"; do error "  ${l}"; done
  exit 1
fi
(( ${#SKIPPED_IMAGES[@]} )) && warn "Shared base images kept (in use): ${SKIPPED_IMAGES[*]}"
success "Uninstall of ${INSTANCE} complete; leftover check clean."
