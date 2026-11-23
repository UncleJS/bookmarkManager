# E2E Tests — Playwright

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](../LICENSE)
[![Playwright](https://img.shields.io/badge/Tests-Playwright%201.63-2EAD33?logo=playwright)](https://playwright.dev)
[![Podman](https://img.shields.io/badge/Container-Podman-892ca0?logo=podman)](https://podman.io)
[![tests](https://github.com/UncleJS/bookmarkManager/actions/workflows/tests.yml/badge.svg?branch=development)](https://github.com/UncleJS/bookmarkManager/actions/workflows/tests.yml)

Automated end-to-end tests for the Bookmark Manager using Playwright + Chromium.

Tests cover four areas:

| Suite | File | What is tested |
|---|---|---|
| API smoke | `tests/api.spec.ts` | REST endpoints (health, bookmarks CRUD, tags, categories, flag-counts) |
| Web UI | `tests/webapp.spec.ts` | `/app` viewer, `/manage-categories`, `/docs` Swagger |
| Options page | `tests/options.spec.ts` | Extension options — save URL, save token, persistence |
| Popup | `tests/popup.spec.ts` | Extension popup — form render, bookmark creation, duplicate warning, modal |

---

## Table of Contents

- [README Links](#readme-links)
- [Prerequisites](#prerequisites)
- [Running tests](#running-tests)
  - [Environment variables](#environment-variables)
- [How extension tests work](#how-extension-tests-work)
- [Project structure](#project-structure)
- [CI notes](#ci-notes)

---

## README Links

- [Project Overview](../README.md)
- [API README](../api/README.md)
- [Extension README](../extension/README.md)
- [Scripts README](../scripts/README.md)
- [E2E README](./README.md)

[↑ Back to TOC](#table-of-contents)

---

## Prerequisites

Only rootless Podman. Playwright, Chromium and Bun run in the test image built from [`Containerfile`](Containerfile) (the official `mcr.microsoft.com/playwright:v1.63.0-noble` image plus Bun and the extension). Nothing is installed on the host. The image tag must match `@playwright/test` in `bun.lock`.

[↑ Back to TOC](#table-of-contents)

---

## Running tests

Always run the suite through the script, from anywhere in the repo:

```bash
# Full suite against a throwaway pod (fresh DB, API and random API_TOKEN)
./scripts/test-e2e.sh

# API smoke only (fastest)
./scripts/test-e2e.sh -- --project=api-smoke

# One spec file
./scripts/test-e2e.sh -- tests/webapp.spec.ts

# Against an installed job instance (uses the API_TOKEN from its env file)
JOB=feature-x ./scripts/test-e2e.sh --installed
```

The script builds the API and Playwright images, starts the throwaway pod `bookmark-e2e<suffix>`, runs `playwright test` in a container joined to that pod, copies the HTML report to `e2e/playwright-report/` and removes the pod. Arguments after `--` go to `playwright test`. The suite writes data, so `--installed` refuses the main (production) instance unless you pass `--allow-main`.

Inside the pod the API is at `http://localhost:11650`, the origin the extension's `host_permissions` allow. That is why the runner joins the pod instead of using an offset host port. Headed Chromium (needed for the extension) runs under `xvfb-run`.

Open the report in a browser from `e2e/playwright-report/index.html`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `http://localhost:11650` | Base URL of the running API |
| `API_TOKEN` | *(empty)* | Bearer token — required for authenticated tests |
| `EXTENSION_PATH` | `<repo>/extension` | Override the unpacked extension path |

If `API_TOKEN` is not set, all tests that require authentication are automatically **skipped** (not failed). The health-check and auth-guard tests always run regardless of whether a token is set.

[↑ Back to TOC](#table-of-contents)

---

## How extension tests work

Playwright loads the unpacked extension from `../extension` using a **persistent Chromium context**:

```
chromium.launchPersistentContext(userDataDir, {
  args: [
    '--disable-extensions-except=<path/to/extension>',
    '--load-extension=<path/to/extension>',
  ]
})
```

The `global-setup.ts` script:
1. Verifies the API is reachable at `/ready`
2. Launches a throw-away Chromium context to discover the extension's `chrome-extension://` ID
3. Stores the ID in `process.env.EXTENSION_ID` for all tests to use

Each extension test suite then gets its own persistent context via the shared `fixtures.ts` fixture, which provides:
- `extensionContext` — the `BrowserContext` with the extension loaded
- `extensionId` — the resolved chrome-extension ID
- `optionsPage` — `Page` opened directly at `chrome-extension://<id>/options/options.html`
- `popupPage` — `Page` opened directly at `chrome-extension://<id>/popup/popup.html`

> **Note:** Extension tests must run serially (`workers: 1` in `playwright.config.ts`).
> This is required because MV3 service workers and persistent contexts do not tolerate
> concurrent writes to the same Chrome profile.

[↑ Back to TOC](#table-of-contents)

---

## Project structure

```
e2e/
├── Containerfile           # Playwright test image (built by scripts/build.sh --e2e)
├── package.json            # Dependencies (@playwright/test)
├── bun.lock                # Bun lockfile
├── playwright.config.ts    # Playwright project config (3 projects: api-smoke, webapp, extension)
├── tsconfig.json           # TypeScript config for e2e/
├── global-setup.ts         # API readiness check + extension ID discovery
├── fixtures.ts             # Shared extensionContext / optionsPage / popupPage fixtures
├── README.md               # This file
└── tests/
    ├── api.spec.ts         # API smoke tests (no browser)
    ├── webapp.spec.ts      # Web UI tests (/app, /manage-categories, /docs)
    ├── ui-theme-date.spec.ts # Theme toggle and yyyy-MM-dd HH:mm:ss dates (America/New_York, en-US)
    ├── options.spec.ts     # Extension options page tests
    └── popup.spec.ts       # Extension popup tests
```

[↑ Back to TOC](#table-of-contents)

---

## CI notes

- Tests that require a token are decorated with `test.skip(!TOKEN, ...)` and will be
  reported as skipped (not failed) in environments where `API_TOKEN` is not set.
- GitHub Actions runs `scripts/test-e2e.sh` with `JOB=ci` (`.github/workflows/tests.yml`) and uploads
  `e2e/playwright-report/` as an artifact.
- Chromium and its system libraries come from the Playwright image, so no host packages are needed.
- The `--no-sandbox` flag is automatically applied via the fixtures for environments
  where the sandbox is not available (e.g., containers without user namespaces).
- Temp Chrome profiles (`e2e/.tmp-chrome-*/`) and test artifacts (`e2e/playwright-report/`,
  `e2e/test-results/`) are gitignored.

[↑ Back to TOC](#table-of-contents)

---

© 2026 UncleJS — Licensed under [AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.txt)
