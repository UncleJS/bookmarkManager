# E2E Tests — Playwright

Automated end-to-end tests for the Bookmark Manager using Playwright + Chromium.

Tests cover four areas:

| Suite | File | What is tested |
|---|---|---|
| API smoke | `tests/api.spec.ts` | REST endpoints (health, bookmarks CRUD, tags, categories, flag-counts) |
| Web UI | `tests/webapp.spec.ts` | `/app` viewer, `/manage-categories`, `/docs` Swagger |
| Options page | `tests/options.spec.ts` | Extension options — save URL, save token, persistence |
| Popup | `tests/popup.spec.ts` | Extension popup — form render, bookmark creation, duplicate warning, modal |

---

## Prerequisites

1. **API pod running** — `./scripts/start.sh` from the repo root
2. **API_TOKEN** — the token you set in `api/.env`

```bash
# Verify the API is reachable
curl http://localhost:11650/ready
```

3. **Playwright Chromium** — already installed via `bun install` inside `e2e/`.
   If you need to re-install:
   ```bash
   cd e2e && bunx playwright install chromium
   ```

---

## Running tests

### Recommended: shell script (from repo root)

```bash
# Full suite
API_TOKEN=<your-token> ./scripts/test-e2e.sh

# API smoke only (no extension, fastest)
API_TOKEN=<your-token> ./scripts/test-e2e.sh --project=api-smoke

# Headed mode (watch the browser)
API_TOKEN=<your-token> ./scripts/test-e2e.sh --headed
```

The script checks API readiness, warns on missing token, and forwards any extra arguments directly to Playwright.

### From `api/` via Bun scripts

```bash
# Full suite
API_TOKEN=<your-token> bun run e2e

# API smoke only
API_TOKEN=<your-token> bun run e2e:api

# Headed mode
API_TOKEN=<your-token> bun run e2e:headed

# Open the last HTML report
bun run e2e:report
```

### Directly from `e2e/`

```bash
cd e2e

# Full suite
API_TOKEN=<your-token> bun run test

# Per-suite
bun run test:api
bun run test:webapp
bun run test:options
bun run test:popup

# Interactive UI mode
bun run test:ui

# Debug mode (step through)
bun run test:debug

# Open the last HTML report
bun run report
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `http://localhost:11650` | Base URL of the running API |
| `API_TOKEN` | *(empty)* | Bearer token — required for authenticated tests |
| `EXTENSION_PATH` | `<repo>/extension` | Override the unpacked extension path |

If `API_TOKEN` is not set, all tests that require authentication are automatically **skipped** (not failed). The health-check and auth-guard tests always run regardless of whether a token is set.

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

---

## Project structure

```
e2e/
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
    ├── options.spec.ts     # Extension options page tests
    └── popup.spec.ts       # Extension popup tests
```

---

## CI notes

- Tests that require a token are decorated with `test.skip(!TOKEN, ...)` and will be
  reported as skipped (not failed) in environments where `API_TOKEN` is not set.
- On RHEL/Fedora-family systems, install Chromium deps manually or use the bundled binary
  at `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`.
- The `--no-sandbox` flag is automatically applied via the fixtures for environments
  where the sandbox is not available (e.g., containers without user namespaces).
- Temp Chrome profiles (`e2e/.tmp-chrome-*/`) and test artifacts (`e2e/playwright-report/`,
  `e2e/test-results/`) are gitignored.
