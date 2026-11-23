# scripts/

[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
[![Shell](https://img.shields.io/badge/Language-Bash-4EAA25?logo=gnubash&logoColor=white)](https://www.gnu.org/software/bash/)
[![Podman](https://img.shields.io/badge/Container-Podman-892ca0?logo=podman)](https://podman.io)
[![systemd](https://img.shields.io/badge/Init-systemd-black?logo=systemd)](https://systemd.io)
[![tests](https://github.com/UncleJS/bookmarkManager/actions/workflows/tests.yml/badge.svg?branch=development)](https://github.com/UncleJS/bookmarkManager/actions/workflows/tests.yml)

Lifecycle and utility scripts for Bookmark Manager. They only call `podman` and `systemctl --user`; all builds, installs and tests run in containers.

```bash
./scripts/<script>.sh [args]       # works from any directory
./scripts/<script>.sh --help
```

Every script uses `set -euo pipefail`, supports `-h`/`--help`, `cd`s to the repo root and sources [`common.sh`](common.sh). Output is tagged with the script name and coloured on a terminal: cyan for info, green for success, yellow for warnings, red for errors (on stderr).

> **Full project documentation:** [`../README.md`](../README.md)

---

## Table of Contents

- [README Links](#readme-links)
- [Quick Reference](#quick-reference)
- [common.sh and job instances](#commonsh-and-job-instances)
  - [Names per instance](#names-per-instance)
  - [Labels](#labels)
- [install.sh](#installsh)
- [build.sh](#buildsh)
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

[↑ Back to TOC](#table-of-contents)

---

## Quick Reference

| Script | Args | Description |
|---|---|---|
| `install.sh` | `[--no-start]` | Check prerequisites, build, install the Quadlet units, start |
| `build.sh` | `[--api] [--api-e2e] [--test] [--e2e] [--all]` | Build the container images |
| `uninstall.sh` | `[--purge] [--remove-quadlets]` | Remove everything the instance created; leftover check |
| `rebuild.sh` | — | Rebuild the API image and restart the API service |
| `start.sh` | — | Start the pod and print the URLs |
| `stop.sh` | — | Stop the pod |
| `restart.sh` | `[api\|db\|pma]` | `stop.sh` + `start.sh`, or restart one service |
| `logs.sh` | `[api\|db\|pma\|all] [-f]` | Show journalctl logs |
| `status.sh` | — | systemctl status and the instance's containers |
| `dev.sh` | `[--down]` | Containerised dev instance (`JOB=dev`, port 11660) |
| `backup.sh` | — | Dump the DB to `backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz` |
| `verify-backup.sh` | `--source script\|api` / `--file <path>` | Validate and test-restore a backup |
| `test-integration.sh` | `[--no-build] [--keep] [-- bun-test-args]` | Integration tests + backup check in a throwaway pod |
| `test-e2e.sh` | `[--installed [--allow-main]] [--no-build] [--keep] [-- playwright-args]` | Playwright E2E suite in a container |
| `import-library-categories.sh` | `[--dry-run\|--apply] [--keep-stage-db]` | Bulk-import levels 1 + 2 taxonomy from seed SQL |
| `import-library-sub-subcategories.sh` | `[--dry-run\|--apply]` | Bulk-import level 3 taxonomy from seed SQL |

[↑ Back to TOC](#table-of-contents)

---

## common.sh and job instances

`common.sh` is sourced by every script (it is not executable). It holds every name, port and label the repo uses, so the scripts never hard-code them. Two environment variables select the instance:

| Variable | Default | Effect |
|---|---|---|
| `JOB` | *(empty = main instance)* | Suffix every name with `-<JOB>` (lowercase letters, digits, dashes) |
| `PORT_OFFSET` | read back from the installed pod unit, else `0` | Added to every published host port |

```bash
JOB=feature-x PORT_OFFSET=2000 ./scripts/install.sh     # API on :13650, phpMyAdmin on :13651
JOB=feature-x PORT_OFFSET=2000 ./scripts/status.sh
JOB=feature-x PORT_OFFSET=2000 ./scripts/uninstall.sh --purge --remove-quadlets
```

`install.sh` refuses `JOB` with `PORT_OFFSET=0`. Once installed, other scripts find the offset in the installed `.pod` unit, so `JOB=feature-x ./scripts/start.sh` is enough. A job instance runs next to the main one and never touches its pod, volume or env files. On first install it gets `api/.env.job-<slug>` with random secrets (git-ignored). Its pod has no `WantedBy=default.target`, so it does not start at boot.

### Names per instance

| Object | Main instance | `JOB=feature-x` |
|---|---|---|
| Quadlet units | `bookmark.pod`, `bookmark-{db,api,pma}.container`, `bookmark-db.volume` | `bookmark-feature-x.pod`, `bookmark-{db,api,pma}-feature-x.container`, `bookmark-db-feature-x.volume` |
| Pod / pod service | `systemd-bookmark` / `bookmark-pod.service` | `systemd-bookmark-feature-x` / `bookmark-feature-x-pod.service` |
| Containers | `bookmark-api`, `bookmark-db`, `bookmark-pma` | `bookmark-api-feature-x`, … |
| DB volume | `bookmark-db-data` | `bookmark-db-data-feature-x` |
| Images | `localhost/bookmark-api:latest` (+ `-test`, `bookmark-e2e`) | `localhost/bookmark-api-feature-x:latest`, … |
| Test pods | `bookmark-it`, `bookmark-e2e` | `bookmark-it-feature-x`, `bookmark-e2e-feature-x` |
| Env file / installed copy | `api/.env` / `~/.config/bookmark-manager/` | `api/.env.job-feature-x` / `~/.config/bookmark-manager-feature-x/` |
| Ports (API / phpMyAdmin) | `11650` / `11651` | `11650+offset` / `11651+offset` |

The repo's `quadlet/` units stay the source of truth. `install.sh` renders them with `sed` into `~/.config/containers/systemd/`.

### Labels

Everything the repo creates carries `app=bookmark-manager` and `bookmark-manager.instance=<instance>` (`bookmark` or `bookmark-<slug>`). That covers the pod, containers, volume, built images and their intermediate layers, and the test pods. `uninstall.sh` finds its objects by these labels.

[↑ Back to TOC](#table-of-contents)

---

## install.sh

Full install for one instance. Safe to re-run.

```bash
./scripts/install.sh              # main instance
./scripts/install.sh --no-start   # install, don't start
JOB=feature-x PORT_OFFSET=2000 ./scripts/install.sh
```

1. Checks that podman runs rootless and that a systemd user session exists
2. Main instance: copies `api/.env.example → api/.env` if missing, then exits so you can set real passwords. Job instance: generates `api/.env.job-<slug>` with random secrets
3. Splits the env file into `.api`, `.db` and `.pma` files (mode 600) and installs them as `~/.config/bookmark-manager<suffix>/env.{api,db,pma}` (dir mode 700)
4. Pulls `docker.io/library/mariadb:11.8` and `docker.io/library/phpmyadmin:5.2`, then runs `build.sh --api`
5. Main instance only: moves data from the legacy bind-mount directory `~/.local/share/bookmark-manager/prod-db` into the named volume, once
6. Renders the `quadlet/` units into `~/.config/containers/systemd/` and runs `systemctl --user daemon-reload`
7. Starts the pod (or restarts it if it is running) and waits for `GET /ready`

The repo no longer installs anything outside `$HOME`. The old `install-after-network.sh` (a root-owned systemd drop-in) is gone: the pod's `StartLimitBurst=10` / `StartLimitIntervalSec=300` lets it recover when pasta starts before the network is up. See *Boot persistence* in the [project README](../README.md#infrastructure) for an optional manual fix.

[↑ Back to TOC](#table-of-contents)

---

## build.sh

Builds the container images with labels.

```bash
./scripts/build.sh            # API runtime image (default)
./scripts/build.sh --test     # API test image
./scripts/build.sh --e2e      # Playwright image
./scripts/build.sh --all
```

| Flag | Image | Source |
|---|---|---|
| `--api` | `localhost/bookmark-api<suffix>:latest` | `api/Containerfile`, target `runtime` (production deps only) |
| `--api-e2e` | `localhost/bookmark-api-e2e<suffix>:latest` | Same as `--api`, separate tag for the throwaway e2e pod, so tests never replace the installed image |
| `--test` | `localhost/bookmark-api-test<suffix>:latest` | `api/Containerfile`, target `test` (all deps + source) |
| `--e2e` | `localhost/bookmark-e2e<suffix>:latest` | `e2e/Containerfile` (context: repo root, so `extension/` is included) |

Base images are pinned: `docker.io/oven/bun:1.4` and `mcr.microsoft.com/playwright:v1.63.0-noble`. The Playwright tag must match `@playwright/test` in `e2e/bun.lock`.

[↑ Back to TOC](#table-of-contents)

---

## uninstall.sh

Removes everything the instance created to build and run, without prompting.

```bash
./scripts/uninstall.sh                               # keep volumes and units
./scripts/uninstall.sh --purge                       # also delete the DB volume (ALL DATA)
./scripts/uninstall.sh --purge --remove-quadlets     # leave no trace
JOB=feature-x ./scripts/uninstall.sh --purge --remove-quadlets
```

By default it:
1. Stops all services of the instance and runs `systemctl --user reset-failed`
2. Removes its containers (by label and by name) and its pods, including the infra container and any leftover test pods
3. Removes the built images, their labelled intermediate layers and build cache
4. Removes the pulled base images (MariaDB, phpMyAdmin, Bun, Playwright), unless another container still uses them or other images are built on them. It says which ones it kept
5. Removes labelled networks and secrets (none are created today)
6. Removes `~/.config/bookmark-manager<suffix>/`

| Flag | Also removes |
|---|---|
| `--purge` | The DB volume and test volumes; with `JOB` set, the generated `api/.env.job-<slug>*` files |
| `--remove-quadlets` | The installed units in `~/.config/containers/systemd/`, then `daemon-reload` |

Without a flag it says what it kept. At the end it checks for leftovers of the instance: containers, pods, images, networks, secrets, files, and (with the flags) volumes and units. It lists anything it finds and exits `1`.

[↑ Back to TOC](#table-of-contents)

---

## rebuild.sh

Rebuilds the API image and restarts only the API service, then waits for `/ready`. Use it after code changes.

```bash
./scripts/rebuild.sh
```

[↑ Back to TOC](#table-of-contents)

---

## start.sh

Starts the pod service (all three containers), waits for `GET /ready` and prints the API, web app, Swagger and phpMyAdmin URLs.

```bash
./scripts/start.sh
```

[↑ Back to TOC](#table-of-contents)

---

## stop.sh

Stops the pod service. Exits cleanly if the units are not installed.

```bash
./scripts/stop.sh
```

[↑ Back to TOC](#table-of-contents)

---

## restart.sh

```bash
./scripts/restart.sh          # stop.sh, then start.sh
./scripts/restart.sh api      # restart one service: api | db | pma
```

[↑ Back to TOC](#table-of-contents)

---

## logs.sh

```bash
./scripts/logs.sh             # API logs
./scripts/logs.sh db -f       # follow the MariaDB logs
./scripts/logs.sh all
```

[↑ Back to TOC](#table-of-contents)

---

## status.sh

Shows `systemctl --user status` for the pod and the three container services, then the instance's containers.

```bash
./scripts/status.sh
```

[↑ Back to TOC](#table-of-contents)

---

## dev.sh

Installs a separate dev instance in containers (`JOB=dev`, `PORT_OFFSET=10`: API on `11660`), with its own DB, next to the main one. After code changes, run `JOB=dev PORT_OFFSET=10 ./scripts/rebuild.sh`.

```bash
./scripts/dev.sh          # install and start the dev instance
./scripts/dev.sh --down   # remove it completely (uninstall --purge --remove-quadlets)
```

`JOB` and `PORT_OFFSET` can be overridden. Nothing runs on the host.

[↑ Back to TOC](#table-of-contents)

---

## backup.sh

Dumps the instance's MariaDB database to a compressed SQL file.

```bash
./scripts/backup.sh
# → backups/bookmark_2026-02-25_143022.sql.gz
```

1. Reads `DB_USER`, `DB_PASSWORD`, `DB_NAME` from the split API env file (falls back to the instance env file)
2. Verifies the `bookmark-db<suffix>` container is running
3. Runs `mariadb-dump --single-transaction --routines --triggers` inside the container
4. Pipes through `gzip -9` → `backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz`

`backups/` is gitignored. A backup is also available via `GET /backup` (requires `Authorization: Bearer <BACKUP_TOKEN>`).

**Restore:**
```bash
gunzip -c backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz \
  | podman exec -i bookmark-db mariadb -u bookmark -p bookmarks
```

[↑ Back to TOC](#table-of-contents)

---

## verify-backup.sh

Checks that a backup of a running instance is intact and restores cleanly.

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

`--source api` reads `BACKUP_TOKEN` from the instance's env files. `test-integration.sh` runs the same dump/restore check in its throwaway pod, so tests never need the real database.

[↑ Back to TOC](#table-of-contents)

---

## test-integration.sh

Runs the API integration suite in a throwaway pod. No bind mounts, and the real pod is never used.

```bash
./scripts/test-integration.sh
./scripts/test-integration.sh -- src/tests/health.integration.test.ts
JOB=feature-x ./scripts/test-integration.sh --keep
```

1. `build.sh --test`: the source is copied into the test image
2. Creates pod `bookmark-it<suffix>` (no published ports) with MariaDB 11.8, its own volume `bookmark-it<suffix>-db-data` and a random root password
3. Runs `bun test src/tests` in the test image inside that pod, against database `bookmarks_test`
4. Backup/restore check: migrates a fresh `bookmarks` DB, dumps it with `mariadb-dump`, tests the gzip, restores it into a temp DB and checks the 9 core tables
5. Removes the pod and volume (`--keep` leaves them for debugging)

[↑ Back to TOC](#table-of-contents)

---

## test-e2e.sh

Runs the Playwright E2E suite (REST API, Web UI, Chrome extension) in a container. Playwright and Chromium never run on the host.

```bash
./scripts/test-e2e.sh                                  # throwaway pod
./scripts/test-e2e.sh -- --project=api-smoke           # pass args to playwright test
JOB=feature-x ./scripts/test-e2e.sh --installed        # against an installed job instance
```

| Mode | Target |
|---|---|
| default | Throwaway pod `bookmark-e2e<suffix>`: MariaDB, the API (own tag `bookmark-api-e2e<suffix>`) and a random `API_TOKEN`; removed afterwards (`--keep` keeps it) |
| `--installed` | The installed pod of this instance, with the `API_TOKEN` from its env file. The suite writes data, so the main instance is refused unless you pass `--allow-main` |

The runner image (`e2e/Containerfile`) is the official Playwright image plus Bun and the extension. It joins the target pod and reaches the API at `http://localhost:11650`, the origin the extension's `host_permissions` allow. The extension tests run headed Chromium under `xvfb-run`. The HTML report is copied to `e2e/playwright-report/`.

See [`e2e/README.md`](../e2e/README.md) for the full E2E documentation.

[↑ Back to TOC](#table-of-contents)

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
- Updates `description` for existing categories/sub-categories (matched by name)
- Inserts new categories and sub-categories not yet in the live DB
- Level-3 rows from the seed are skipped (handled by the sub-subcategories script)

**Prerequisites:**
- `bookmark-db<suffix>` container running
- the instance env file (`api/.env`, or `api/.env.job-<slug>`) must contain `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `MARIADB_ROOT_PASSWORD`

[↑ Back to TOC](#table-of-contents)

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
- Updates `description` for existing sub-sub-categories (matched by name within their parent)
- Inserts new sub-sub-categories not yet in the live DB

**Prerequisites:** same as `import-library-categories.sh`.

[↑ Back to TOC](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-SA 4.0
