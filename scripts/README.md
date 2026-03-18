# scripts/

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Shell](https://img.shields.io/badge/Language-Bash-4EAA25?logo=gnubash&logoColor=white)](https://www.gnu.org/software/bash/)
[![Podman](https://img.shields.io/badge/Container-Podman-892ca0?logo=podman)](https://podman.io)
[![systemd](https://img.shields.io/badge/Init-systemd-black?logo=systemd)](https://systemd.io)

Lifecycle scripts for Bookmark Manager. All scripts must be run from the **repo root**.

```bash
./scripts/<script>.sh [args]
```

Every script uses `set -euo pipefail` and colour-coded output:
- **Cyan** — informational step
- **Green** — success
- **Yellow** — warning / action required
- **Red** — error (written to stderr)

---

## Table of Contents

- [Quick reference](#quick-reference)
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

---

## Quick reference

| Script | Args | Description |
|---|---|---|
| [`install.sh`](#installsh) | — | Full first-time install |
| [`uninstall.sh`](#uninstallsh) | — | Remove services and optionally data |
| [`rebuild.sh`](#rebuildsh) | — | Rebuild API image and restart service |
| [`start.sh`](#startsh) | — | Start the pod |
| [`stop.sh`](#stopsh) | — | Stop the pod |
| [`restart.sh`](#restartsh) | `[api\|db\|pma]` | Restart one service or the whole pod |
| [`logs.sh`](#logssh) | `[api\|db\|pma\|all]` | Tail journalctl logs |
| [`status.sh`](#statussh) | — | Show systemctl status for all services |
| [`dev.sh`](#devsh) | — | Run API locally via Bun (no container) |
| [`backup.sh`](#backupsh) | — | Dump DB to `backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz` |

---

## install.sh

Full first-time install. Run this once after cloning the repo.

```bash
./scripts/install.sh
```

**Steps executed:**

1. Verifies `api/` and `quadlet/` directories exist (confirms repo root).
2. Checks for `api/.env`.
   - If missing: copies `api/.env.example` → `api/.env`, prints a warning, and **exits** so you can fill in real passwords before continuing.
3. Verifies `podman` is on `PATH`.
4. Pulls base images: `docker.io/mariadb:11` and `docker.io/phpmyadmin:5`.
5. Builds `localhost/bookmark-api:latest` from `api/Dockerfile`.
6. Creates the DB data volume directory: `~/.local/share/bookmark-manager/prod-db`.
7. Copies `quadlet/*.{pod,container}` → `~/.config/containers/systemd/`.
8. Runs `systemctl --user daemon-reload`.
9. Runs `systemctl --user enable --now bookmark-pod.service`.
10. Prints service URLs.

**First-time flow:**

```bash
# 1. Copy and edit credentials
cp api/.env.example api/.env
nano api/.env   # set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD

# 2. Install
./scripts/install.sh
```

**Re-running install** is safe — it is idempotent. Existing Quadlet files are overwritten, the image is rebuilt, and the pod is (re)started.

**Outputs on success:**

```
API         http://localhost:11650
Swagger UI  http://localhost:11650/docs
phpMyAdmin  http://localhost:11651  (login required)
```

[↑ Table of Contents](#table-of-contents)

---

## uninstall.sh

Stops and removes all Bookmark Manager services. Interactively asks before removing the container image or the database data.

```bash
./scripts/uninstall.sh
```

**Steps executed:**

1. Stops `bookmark-pod.service` (tolerates already-stopped).
2. Disables `bookmark-pod.service` (tolerates not-enabled).
3. Removes the four Quadlet unit files from `~/.config/containers/systemd/`.
4. Runs `systemctl --user daemon-reload`.
5. **Asks:** remove `localhost/bookmark-api:latest` image? (default: **N**)
6. **Asks:** delete DB data volume at `~/.local/share/bookmark-manager/prod-db`? (default: **N**, with a prominent warning)

> **Data safety:** The DB volume is never deleted without an explicit `y` confirmation. This preserves all bookmark data across uninstall/reinstall cycles.

[↑ Table of Contents](#table-of-contents)

---

## rebuild.sh

Rebuilds the API container image from source and restarts only the API service. Use this after making changes to `api/src/`.

```bash
./scripts/rebuild.sh
```

**Steps executed:**

1. Builds `localhost/bookmark-api:latest` from `api/Dockerfile`.
2. Restarts `bookmark-api.service` (DB and phpMyAdmin are unaffected).
3. Polls `GET /health` every 2 seconds for up to 30 seconds.
   - Exits 0 when healthy, exits 1 with instructions if the timeout is exceeded.

**Workflow for source changes:**

```bash
# Edit API source
nano api/src/server.ts

# Rebuild and restart
./scripts/rebuild.sh

# Tail logs if something looks wrong
./scripts/logs.sh api
```

**Workflow for schema changes** (generate migration first):

```bash
cd api && bun run db:generate
cd ..
./scripts/rebuild.sh   # migrations run automatically on container start
```

[↑ Table of Contents](#table-of-contents)

---

## start.sh

Starts the pod and all three containers (MariaDB, phpMyAdmin, API).

```bash
./scripts/start.sh
```

Equivalent to `systemctl --user start bookmark-pod.service`. Prints the service URLs on success.

[↑ Table of Contents](#table-of-contents)

---

## stop.sh

Stops the pod and all three containers gracefully.

```bash
./scripts/stop.sh
```

Equivalent to `systemctl --user stop bookmark-pod.service`. DB data is preserved.

[↑ Table of Contents](#table-of-contents)

---

## restart.sh

Restarts one specific service or the entire pod.

```bash
./scripts/restart.sh          # restart whole pod (all containers)
./scripts/restart.sh api      # restart bookmark-api.service only
./scripts/restart.sh db       # restart bookmark-db.service only
./scripts/restart.sh pma      # restart bookmark-pma.service only
```

| Argument | Service restarted |
|---|---|
| _(none)_ | `bookmark-pod.service` (all containers) |
| `api` | `bookmark-api.service` |
| `db` | `bookmark-db.service` |
| `pma` | `bookmark-pma.service` |

> Tip: after a `rebuild.sh` the API is already restarted automatically. Use `restart.sh api` only when you need to restart without rebuilding the image.

[↑ Table of Contents](#table-of-contents)

---

## logs.sh

Tails `journalctl --user` logs for one or all services. Exits on Ctrl+C.

```bash
./scripts/logs.sh             # API logs (default)
./scripts/logs.sh api         # bookmark-api logs
./scripts/logs.sh db          # bookmark-db logs
./scripts/logs.sh pma         # bookmark-pma logs
./scripts/logs.sh all         # all three services interleaved
```

| Argument | Logs shown |
|---|---|
| _(none)_ / `api` | `bookmark-api` |
| `db` | `bookmark-db` |
| `pma` | `bookmark-pma` |
| `all` | `bookmark-api` + `bookmark-db` + `bookmark-pma` |

[↑ Table of Contents](#table-of-contents)

---

## status.sh

Shows `systemctl --user status` for the pod and all three container services in one view.

```bash
./scripts/status.sh
```

Equivalent to:
```bash
systemctl --user status bookmark-pod.service \
                         bookmark-api.service \
                         bookmark-db.service \
                         bookmark-pma.service \
  --no-pager -l
```

Does not exit non-zero when services are inactive — safe to run at any time.

[↑ Table of Contents](#table-of-contents)

---

## dev.sh

Runs the API locally using Bun in watch mode, without any container. Useful for rapid development when the MariaDB container is already running separately.

```bash
./scripts/dev.sh
```

**Steps executed:**

1. Checks for `api/.env`.
   - If missing: copies from `api/.env.example` and exits with a prompt to fill in passwords.
2. Verifies `bun` is on `PATH`.
3. Runs `bun install` in `api/` if `node_modules/` is absent or `package.json` is newer.
4. Executes `bun run dev` (`bun --watch src/server.ts`) — reloads on file changes.

**Prerequisites:** A running MariaDB instance reachable at the host/port configured in `api/.env` (`DB_HOST` / `DB_PORT`). The DB container can be started without the API via:

```bash
./scripts/start.sh            # start everything, then...
systemctl --user stop bookmark-api.service  # stop only the API container
./scripts/dev.sh              # run API locally against the container DB
```

[↑ Table of Contents](#table-of-contents)

---

## backup.sh

Dumps the live MariaDB database to a gzip-compressed SQL file in `backups/`.

```bash
./scripts/backup.sh
# → backups/bookmark_2026-02-25_143022.sql.gz (42K)
```

**What it does:**

1. Reads `DB_USER`, `DB_PASSWORD`, `DB_NAME` from `api/.env`.
2. Verifies the `bookmark-db` container is running.
3. Runs `mariadb-dump --single-transaction --routines --triggers` inside the container.
4. Pipes the output through `gzip -9` and saves to `backups/bookmark_YYYY-MM-DD_HHMMSS.sql.gz`.

**Notes:**

- `backups/` is gitignored — dump files are never committed.
- A backup is also available via the browser at `GET /backup` — send `Authorization: Bearer <BACKUP_TOKEN>` (set `BACKUP_TOKEN` in `api/.env`).
- To restore: `gunzip -c backups/<file>.sql.gz | podman exec -i bookmark-db mariadb -u<user> -p<pass> <dbname>`

[↑ Table of Contents](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-NC-SA 4.0
