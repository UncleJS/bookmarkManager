#!/usr/bin/env bash
# =============================================================================
# scripts/build.sh — Build the Bookmark Manager container image(s).
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: [JOB=<slug>] [PORT_OFFSET=<n>] scripts/build.sh [--api] [--api-e2e] [--test] [--e2e] [--all]

Build container images with podman. Every image is labelled
${APP_LABEL} and bookmark-manager.instance=<instance>.

  --api    API runtime image   ${API_IMAGE}   (default; used by the installed pod)
  --api-e2e  same image, tagged ${API_E2E_IMAGE} for test-e2e.sh
  --test   API test image      ${API_TEST_IMAGE}
  --e2e    Playwright image    ${E2E_IMAGE}
  --all    all three
  -h, --help  show this help
EOF
}

BUILD_API=0; BUILD_API_E2E=0; BUILD_TEST=0; BUILD_E2E=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api)  BUILD_API=1 ;;
    --api-e2e) BUILD_API_E2E=1 ;;
    --test) BUILD_TEST=1 ;;
    --e2e)  BUILD_E2E=1 ;;
    --all)  BUILD_API=1; BUILD_TEST=1; BUILD_E2E=1 ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown argument: $1"; usage >&2; exit 2 ;;
  esac
  shift
done
(( BUILD_API + BUILD_API_E2E + BUILD_TEST + BUILD_E2E == 0 )) && BUILD_API=1

command -v podman >/dev/null || { error "podman not found on PATH."; exit 1; }
describe_instance

LABEL_ARGS=(--label "${APP_LABEL}" --label "${INSTANCE_LABEL}")

if (( BUILD_API )); then
  info "Building ${API_IMAGE} (api/Containerfile, target runtime) ..."
  podman build "${LABEL_ARGS[@]}" \
    --build-arg BUN_IMAGE="${BUN_IMAGE}" --build-arg INSTANCE="${INSTANCE}" \
    --target runtime -f api/Containerfile -t "${API_IMAGE}" api
  success "Built ${API_IMAGE}"
fi

if (( BUILD_API_E2E )); then
  info "Building ${API_E2E_IMAGE} (api/Containerfile, target runtime) ..."
  podman build "${LABEL_ARGS[@]}" --label bookmark-manager.role=test \
    --build-arg BUN_IMAGE="${BUN_IMAGE}" --build-arg INSTANCE="${INSTANCE}" \
    --target runtime -f api/Containerfile -t "${API_E2E_IMAGE}" api
  success "Built ${API_E2E_IMAGE}"
fi

if (( BUILD_TEST )); then
  info "Building ${API_TEST_IMAGE} (api/Containerfile, target test) ..."
  podman build "${LABEL_ARGS[@]}" --label bookmark-manager.role=test \
    --build-arg BUN_IMAGE="${BUN_IMAGE}" --build-arg INSTANCE="${INSTANCE}" \
    --target test -f api/Containerfile -t "${API_TEST_IMAGE}" api
  success "Built ${API_TEST_IMAGE}"
fi

if (( BUILD_E2E )); then
  info "Building ${E2E_IMAGE} (e2e/Containerfile) ..."
  podman build "${LABEL_ARGS[@]}" --label bookmark-manager.role=test \
    --build-arg PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE}" --build-arg BUN_IMAGE="${BUN_IMAGE}" \
    --build-arg INSTANCE="${INSTANCE}" \
    -f e2e/Containerfile -t "${E2E_IMAGE}" .
  success "Built ${E2E_IMAGE}"
fi
