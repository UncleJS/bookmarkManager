# scripts/

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Shell](https://img.shields.io/badge/Language-Bash-4EAA25?logo=gnubash&logoColor=white)](https://www.gnu.org/software/bash/)
[![Podman](https://img.shields.io/badge/Container-Podman-892ca0?logo=podman)](https://podman.io)
[![systemd](https://img.shields.io/badge/Init-systemd-black?logo=systemd)](https://systemd.io)

Lifecycle and utility scripts for Bookmark Manager. All scripts must be run from the **repo root**.

```bash
./scripts/<script>.sh [args]
```

Every script uses `set -euo pipefail` with colour-coded output:
- **Cyan** — informational step
- **Green** — success
- **Yellow** — warning / action required
- **Red** — error (written to stderr)

> **Full project documentation:** [`../README.md`](../README.md)

---

## Table of Contents

- [README Links](#readme-links)
- [Quick Reference](#quick-reference)
- [install.sh](#installsh)
- [uninstall.sh](#uninstallsh)
- [rebuild.sh](#rebuildsh)
- [start.sh](#startsh)
- [stop.sh](#stopsh)
- [restart.sh](#restartsh)
- [logs.sh](#logssh)
- [status.sh](#statussh)
- [dev.sh](#devsh)
- [backup.sh](#backupsh)
- [verify-backup.sh](#verify-backupsh)
- [test-integration.sh](#test-integrationsh)
- [test-e2e.sh](#test-e2esh)
- [import-library-categories.sh](#import-library-categoriessh)
- [import-library-sub-subcategories.sh](#import-library-sub-subcategoriessh)

---

## README Links

- [Project Overview](../README.md)
- [API README](../api/README.md)
- [Extension README](../extension/README.md)
- [Scripts README](./README.md)
- [E2E README](../e2e/README.md)

---

## Quick Reference

| Script | Args | Description |
|---|---|---|
| `install.sh` | — | Full first-time install |
| `uninstall.sh` | — | Remove services and optionally data |
| `rebuild.sh` | — | Rebuild API image and restart service |
| `start.sh` | — | Start the pod |
| `stop.sh` | — | Stop the pod |
| `restart.sh` | `[api\|db\|pma]` | Restart one service or the whole pod |
| `logs.sh` | `[api\|db\|pma\|all]` | Tail journalctl logs |
| `status.sh` | — | Show systemctl status for all services |
| `dev.sh` | — | Run API locally via Bun (no container) |
| `backup.sh` | — | Dump DB to `backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz` |
| `verify-backup.sh` | `--source script\|api` / `--file <path>` | Validate and test-restore a backup |
| `test-integration.sh` | — | Run Bun integration tests against the pod DB |
| `test-e2e.sh` | `[playwright args]` | Run the Playwright E2E suite |
| `import-library-categories.sh` | `[--dry-run\|--apply] [--keep-stage-db]` | Bulk-import levels 1 + 2 taxonomy from seed SQL |
| `import-library-sub-subcategories.sh` | `[--dry-run\|--apply]` | Bulk-import level 3 taxonomy from seed SQL |

---

## install.sh

Full first-time install. Run once after cloning.

```bash
./scripts/install.sh
```

**Steps executed:**
1. Verifies `api/` and `quadlet/` directories exist
2. Copies `api/.env.example → api/.env` if missing, then exits so you can fill in passwords
3. Generates `api/.env.api`, `api/.env.db`, `api/.env.pma` from `api/.env`
4. Verifies `podman` is on `PATH`
5. Pulls `docker.io/mariadb:11` and `docker.io/phpmyadmin:5`
6. Builds `localhost/bookmark-api:latest` from `api/Dockerfile`
7. Creates DB data volume: `~/.local/share/bookmark-manager/prod-db`
8. Copies `quadlet/*.{pod,container}` → `~/.config/containers/systemd/`
9. Runs `systemctl --user daemon-reload`
10. Runs `systemctl --user enable --now bookmark-pod.service`
11. Polls `GET /ready` until the API is up, then prints service URLs

Re-running is safe — idempotent.

[↑ Table of Contents](#table-of-contents)

---

## uninstall.sh

Stops and removes all services. Interactively prompts before removing image or data.

```bash
./scripts/uninstall.sh
```

1. Stops and disables `bookmark-pod.service`
2. Removes Quadlet unit files from `~/.config/containers/systemd/`
3. Runs `systemctl --user daemon-reload`
4. **Asks:** remove `localhost/bookmark-api:latest`? (default: **N**)
5. **Asks:** delete DB data at `~/.local/share/bookmark-manager/prod-db`? (default: **N**)

> The DB volume is never deleted without an explicit `y`. All bookmark data is preserved across uninstall/reinstall cycles unless you confirm deletion.

[↑ Table of Contents](#table-of-contents)

---

## rebuild.sh

Rebuilds the API container image and restarts only the API service. Use after changes to `api/src/`.

```bash
./scripts/rebuild.sh
```

1. Builds `localhost/bookmark-api:latest`
2. Restarts `bookmark-api.service` (DB and phpMyAdmin unaffected)
3. Polls `GET /ready` every 2 s for up to 30 s; exits 0 when ready

```bash
# After source changes
./scripts/rebuild.sh

# After schema changes (generate migration first)
cd api && bun run db:generate
cd .. && ./scripts/rebuild.sh
```

[↑ Table of Contents](#table-of-contents)

---

## start.sh

Starts the pod and all three containers.

```bash
./scripts/start.sh
```

Equivalent to `systemctl --user start bookmark-pod.service`.

[↑ Table of Contents](#table-of-contents)

---

## stop.sh

Stops the pod gracefully. DB data is preserved.

```bash
./scripts/stop.sh
```

Equivalent to `systemctl --user stop bookmark-pod.service`.

[↑ Table of Contents](#table-of-contents)

---

## restart.sh

Restarts one service or the whole pod.

```bash
./scripts/restart.sh          # whole pod
./scripts/restart.sh api      # bookmark-api.service only
./scripts/restart.sh db       # bookmark-db.service only
./scripts/restart.sh pma      # bookmark-pma.service only
```

> After `rebuild.sh` the API is already restarted. Use `restart.sh api` only to restart without rebuilding the image.

[↑ Table of Contents](#table-of-contents)

---

## logs.sh

Tails `journalctl --user` logs. Exits on Ctrl+C.

```bash
./scripts/logs.sh             # API logs (default)
./scripts/logs.sh api
./scripts/logs.sh db
./scripts/logs.sh pma
./scripts/logs.sh all         # all three services interleaved
```

[↑ Table of Contents](#table-of-contents)

---

## status.sh

Shows `systemctl --user status` for the pod and all three container services.

```bash
./scripts/status.sh
```

Safe to run at any time — does not exit non-zero when services are inactive.

[↑ Table of Contents](#table-of-contents)

---

## dev.sh

Runs the API locally in Bun watch mode. No container needed for the API; MariaDB must still be running.

```bash
./scripts/dev.sh
```

1. Checks for `api/.env`; copies from example and exits if missing
2. Verifies `bun` is on `PATH`
3. Runs `bun install` in `api/` if `node_modules/` is absent
4. Executes `bun run dev` (`bun --watch src/server.ts`)

**Typical dev workflow:**
```bash
./scripts/start.sh
systemctl --user stop bookmark-api.service   # stop the container API
./scripts/dev.sh                             # run API locally against the container DB
```

[↑ Table of Contents](#table-of-contents)

---

## backup.sh

Dumps the live MariaDB database to a compressed SQL file.

```bash
./scripts/backup.sh
# → backups/bookmark_2026-02-25_143022.sql.gz
```

1. Reads `DB_USER`, `DB_PASSWORD`, `DB_NAME` from `api/.env.api` (falls back to `api/.env`)
2. Verifies `bookmark-db` container is running
3. Runs `mariadb-dump --single-transaction --routines --triggers` inside the container
4. Pipes through `gzip -9` → `backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz`

`backups/` is gitignored. A backup is also available via `GET /backup` (requires `Authorization: Bearer <BACKUP_TOKEN>`).

**Restore:**
```bash
gunzip -c backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz \
  | podman exec -i bookmark-db mariadb -u bookmark -p bookmarks
```

[↑ Table of Contents](#table-of-contents)

---

## verify-backup.sh

Validates that a backup is intact and can be successfully restored.

```bash
./scripts/verify-backup.sh --source script   # generate via backup.sh and verify
./scripts/verify-backup.sh --source api      # generate via GET /backup and verify
./scripts/verify-backup.sh --file backups/bookmark_2026-02-25_143022.sql.gz
```

1. Generates or loads a `.sql.gz` file
2. Runs `gzip -t` to verify archive integrity
3. Restores into a temporary MariaDB database
4. Checks that the core bookmark tables exist after restore
5. Drops the temporary database

`--source api` reads `BACKUP_TOKEN` from `api/.env.api` (or `api/.env` as fallback).

The integration test suite covers both backup paths automatically.

[↑ Table of Contents](#table-of-contents)

---

## test-integration.sh

Runs the Bun integration suite from a temporary container joined to the running pod.

```bash
./scripts/test-integration.sh
```

1. Starts `bookmark-pod.service` if not already running
2. Launches a temporary `docker.io/oven/bun:1.3.8` container inside the `systemd-bookmark` pod
3. Mounts `api/` and runs `bun test src/tests/bookmarks.integration.test.ts`

The test container reaches MariaDB at `127.0.0.1:3306` exactly as the API container does.

[↑ Table of Contents](#table-of-contents)

---

## test-e2e.sh

Runs the full Playwright E2E suite against the running pod. Covers REST API, Web UI, and the Chrome extension.

```bash
API_TOKEN=<your-token> ./scripts/test-e2e.sh [playwright-args...]
```

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `http://localhost:11650` | Base URL of the running API |
| `API_TOKEN` | *(empty)* | Bearer token — required for authenticated tests |
| `EXTENSION_PATH` | `<repo>/extension` | Path to unpacked extension |

If `API_TOKEN` is not set, token-gated tests are skipped (not failed). Health and auth-guard tests always run.

**Common examples:**
```bash
# Full suite
API_TOKEN=abc123 ./scripts/test-e2e.sh

# API smoke only (fastest)
API_TOKEN=abc123 ./scripts/test-e2e.sh --project=api-smoke

# Headed mode
API_TOKEN=abc123 ./scripts/test-e2e.sh --headed
```

See [`e2e/README.md`](../e2e/README.md) for the full E2E documentation.

[↑ Table of Contents](#table-of-contents)

---

## import-library-categories.sh

Bulk-imports levels 1 (categories) and 2 (sub-categories) from a seed SQL file.

```bash
# Dry run (default) — validates and reports counts; no data changed
./scripts/import-library-categories.sh

# Apply
./scripts/import-library-categories.sh --apply

# Apply and keep the staging database for inspection
./scripts/import-library-categories.sh --apply --keep-stage-db
```

**Seed file:** `backups/library_categories_schema_seed.sql` (must exist before running).

**Preflight checks (any failure aborts):**
- No duplicate category names in seed
- No duplicate sub-category names within the same parent in seed
- No duplicate active categories in live DB
- No duplicate active sub-categories within the same parent in live DB
- All level-2 rows have a valid level-1 parent in seed

**What `--apply` does (single transaction):**
- Updates `description` and `order` for existing categories/sub-categories (matched by name)
- Inserts new categories and sub-categories not yet in the live DB
- Level-3 rows from the seed are skipped (handled by the sub-subcategories script)

**Prerequisites:**
- `bookmark-db` container running
- `api/.env` must contain `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `MARIADB_ROOT_PASSWORD`

[↑ Table of Contents](#table-of-contents)

---

## import-library-sub-subcategories.sh

Bulk-imports level 3 (sub-sub-categories) from the same seed SQL file.

```bash
./scripts/import-library-sub-subcategories.sh           # dry run
./scripts/import-library-sub-subcategories.sh --apply
```

**Seed file:** `backups/library_categories_schema_seed.sql` (same file as the categories script).

Maps level-3 entries to live sub-categories created by the categories script. Reports `seed_level3_rows`, `mapped_level3_rows`, and `missing_parent_rows` before applying.

**Run order:** always run `import-library-categories.sh --apply` first so the parent sub-categories exist.

**What `--apply` does:**
- Updates `description` and `order` for existing sub-sub-categories (matched by name within their parent)
- Inserts new sub-sub-categories not yet in the live DB

**Prerequisites:** same as `import-library-categories.sh`.

[↑ Table of Contents](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-NC-SA 4.0
