# scripts/

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

---

## start.sh

Starts the pod and all three containers (MariaDB, phpMyAdmin, API).

```bash
./scripts/start.sh
```

Equivalent to `systemctl --user start bookmark-pod.service`. Prints the service URLs on success.

---

## stop.sh

Stops the pod and all three containers gracefully.

```bash
./scripts/stop.sh
```

Equivalent to `systemctl --user stop bookmark-pod.service`. DB data is preserved.

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

---

© 2026 Jaco Steyn — Licensed under CC BY-SA 4.0
