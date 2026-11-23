#!/usr/bin/env bash
# =============================================================================
# scripts/test-e2e.sh — Playwright E2E suite, run in a container.
#
# Default: a throwaway pod bookmark-e2e<suffix> (own MariaDB + volume, the API
# image, random tokens). Playwright runs in its own image inside that pod.
# --installed: run against the installed pod of this instance instead.
# The HTML report is copied to e2e/playwright-report/.
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
source "${REPO_ROOT}/scripts/lib/test-pod.sh"

usage() {
  cat <<EOF2
Usage: [JOB=<slug>] scripts/test-e2e.sh [--installed [--allow-main]] [--no-build] [--keep] [-- playwright-args...]

  (default)      throwaway pod ${E2E_POD}: fresh DB, API and tokens
  --installed    use the installed pod ${POD_NAME} and the API_TOKEN from
                 its env file. The suite writes data, so the main
                 (production) instance is refused without --allow-main.
  --no-build     reuse the existing ${API_IMAGE} and ${E2E_IMAGE}
  --keep         keep the throwaway pod afterwards (for debugging)
  -h, --help     show this help

Examples:
  JOB=bm-infra scripts/test-e2e.sh
  JOB=bm-infra scripts/test-e2e.sh -- --project=api-smoke
EOF2
}

INSTALLED=0; ALLOW_MAIN=0; BUILD=1; KEEP=0; PW_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --installed) INSTALLED=1 ;;
    --allow-main) ALLOW_MAIN=1 ;;
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    --) shift; PW_ARGS=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
  esac
  shift
done

describe_instance
RUNNER="${E2E_POD}-runner"

cleanup() {
  podman rm -f "${RUNNER}" >/dev/null 2>&1 || true
  if (( ! INSTALLED )); then
    if (( KEEP )); then
      warn "Kept ${E2E_POD} (remove with: podman pod rm -f ${E2E_POD}; podman volume rm ${E2E_POD}-db-data)"
    else
      testpod_remove "${E2E_POD}"
    fi
  fi
}
trap cleanup EXIT

if (( INSTALLED )); then
  if [[ -z "${JOB}" && ${ALLOW_MAIN} -eq 0 ]]; then
    error "Refusing to run the E2E suite against the main (production) instance."
    error "Set JOB=<slug> for a job instance, or pass --allow-main."
    exit 1
  fi
  podman pod exists "${POD_NAME}" || { error "Pod ${POD_NAME} is not running. Start it with scripts/start.sh."; exit 1; }
  [[ -f "${API_ENV_FILE}" ]] || { error "${API_ENV_FILE} not found."; exit 1; }
  TARGET_POD="${POD_NAME}"
  API_TOKEN="$(load_env_value "${API_ENV_FILE}" API_TOKEN)"
  (( BUILD )) && "${REPO_ROOT}/scripts/build.sh" --e2e
else
  (( BUILD )) && "${REPO_ROOT}/scripts/build.sh" --api --e2e
  podman image exists "${MARIADB_IMAGE}" || podman pull -q "${MARIADB_IMAGE}" >/dev/null
  testpod_create "${E2E_POD}"
  TARGET_POD="${E2E_POD}"
  API_TOKEN="$(random_secret 32)"
  podman run -d --pod "${E2E_POD}" --name "${E2E_POD}-api" "${TEST_LABEL_ARGS[@]}" \
    -e API_PORT="${API_CONTAINER_PORT}" -e LOG_LEVEL=info \
    -e DB_HOST=127.0.0.1 -e DB_PORT=3306 -e DB_NAME=bookmarks \
    -e DB_USER="${TEST_DB_USER}" -e DB_PASSWORD="${TEST_DB_PW}" \
    -e API_TOKEN="${API_TOKEN}" -e BACKUP_TOKEN="$(random_secret 32)" \
    "${API_IMAGE}" >/dev/null
  info "Waiting for the API in ${E2E_POD} ..."
  ready=0
  for _ in $(seq 1 45); do
    if podman exec "${E2E_POD}-api" bun run /app/healthcheck.mjs >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  if (( ! ready )); then
    error "API in ${E2E_POD} did not become ready."
    podman logs --tail 40 "${E2E_POD}-api" >&2 || true
    exit 1
  fi
fi

# Inside the pod the API is on localhost:11650, the origin the extension's
# host_permissions allow.
info "Running Playwright in ${E2E_IMAGE} (pod ${TARGET_POD}) ..."
set +e
podman run --name "${RUNNER}" --pod "${TARGET_POD}" "${TEST_LABEL_ARGS[@]}" \
  --ipc=private --shm-size=1g \
  -e API_BASE_URL="http://localhost:${API_CONTAINER_PORT}" \
  -e API_TOKEN="${API_TOKEN}" \
  "${E2E_IMAGE}" "${PW_ARGS[@]}"
rc=$?
set -e

rm -rf "${REPO_ROOT}/e2e/playwright-report"
if podman cp "${RUNNER}:/work/e2e/playwright-report" "${REPO_ROOT}/e2e/playwright-report" 2>/dev/null; then
  info "HTML report: e2e/playwright-report/index.html"
fi

if (( rc != 0 )); then
  error "E2E suite failed (exit ${rc})."
  exit "${rc}"
fi
success "E2E suite passed."
