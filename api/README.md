# Bookmark Manager API

A Bun + Elysia API for managing bookmarks, tags, and classifications. Backed by MariaDB with Drizzle ORM. Data is never hard-deleted — all "delete" actions archive rows (`archived_at`).

---

## Quick Start

### 1. Configure environment

```bash
cp api/.env.example api/.env
# Edit api/.env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
nano api/.env
```

> **Important:** `MARIADB_USER`/`MARIADB_PASSWORD` and `DB_USER`/`DB_PASSWORD` must match.

### 2. Install and start (from repo root)

```bash
./scripts/install.sh
```

This will build the API image, copy Quadlet unit files, reload systemd, and start the pod.

Alternatively, run individual steps manually:

```bash
podman build -t localhost/bookmark-api:latest api/
systemctl --user daemon-reload
systemctl --user start bookmark-pod.service
```

This starts:
- **MariaDB** — pod-internal only (not exposed to host)
- **phpMyAdmin** on `http://localhost:11651` (localhost only, login required)
- **API** on `http://localhost:11650` (migrations run automatically on start)

### 3. Health check

```bash
curl http://localhost:11650/health
# → {"status":"ok"}
```

| Service | URL |
|---|---|
| API | `http://localhost:11650` |
| Swagger UI | `http://localhost:11650/docs` |
| OpenAPI JSON | `http://localhost:11650/openapi.json` |
| Bookmark viewer | `http://localhost:11650/app` |
| Category manager | `http://localhost:11650/categories` |
| phpMyAdmin | `http://localhost:11651` |

### 4. Boot persistence

To start automatically at boot without an interactive login session:

```bash
loginctl enable-linger $USER
```

---

## Scripts (from repo root)

| Script | Description |
|---|---|
| `./scripts/install.sh` | Full install: build image, deploy Quadlet files, start pod |
| `./scripts/uninstall.sh` | Stop services, remove Quadlet files, optionally remove image + data |
| `./scripts/rebuild.sh` | Rebuild API image, restart `bookmark-api.service`, wait for health |
| `./scripts/start.sh` | Start the pod (all services) |
| `./scripts/stop.sh` | Stop the pod (all services) |
| `./scripts/restart.sh [api\|db\|pma]` | Restart one service or whole pod |
| `./scripts/logs.sh [api\|db\|pma\|all]` | Tail logs — defaults to `api` |
| `./scripts/status.sh` | Show `systemctl --user status` for all services |
| `./scripts/dev.sh` | Run API locally via `bun run dev` (no container, watch mode) |

---

## Bun scripts (in `api/`)

| Command | Description |
|---|---|
| `bun run dev` | Watch mode (`bun --watch src/server.ts`) |
| `bun run start` | Production start |
| `bun run db:generate` | Generate a new Drizzle migration from schema changes |
| `bun run db:migrate` | Apply pending Drizzle migrations |
| `bun run db:studio` | Open Drizzle Studio (visual DB browser) |
| `bun run smoke` | Smoke test — verifies `/health` (no DB required) |

### Workflow for schema changes

```bash
# 1. Edit api/src/db/schema.ts
# 2. Generate the migration
cd api && bun run db:generate
# 3. Rebuild and restart
./scripts/rebuild.sh
```

---

## API Endpoints

Interactive docs always available at **`http://localhost:11650/docs`**.

### Health & UI

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Redirect to `/app` |
| `GET` | `/health` | Returns `{ status: "ok" }` |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/app` | Bookmark viewer UI |
| `GET` | `/categories` | Category management UI |
| `GET` | `/flag-counts` | Count of active bookmarks per flag |

### Bookmarks

| Method | Path | Description |
|---|---|---|
| `GET` | `/bookmarks` | List/filter bookmarks (`?limit=&offset=&classificationId=&tagId=&flag=&sortBy=&archived=`) |
| `POST` | `/bookmarks` | Create bookmark |
| `PATCH` | `/bookmarks/:id` | Edit title, description, flags, tags, classifications |
| `PATCH` | `/bookmarks/:id/archive` | Soft-delete (sets `archivedAt`) |
| `PATCH` | `/bookmarks/:id/restore` | Restore archived bookmark |

### Tags

| Method | Path | Description |
|---|---|---|
| `GET` | `/tags` | List/search tags (`?query=&limit=&offset=&sort=`) |
| `POST` | `/tags` | Create tag |
| `PATCH` | `/tags/:id/archive` | Archive tag |
| `PATCH` | `/tags/:id/restore` | Restore archived tag |

### Classifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications` | All active classifications, nested by group |
| `POST` | `/classifications` | Create classification (optionally with new group) |
| `PATCH` | `/classifications/:id` | Rename classification |
| `PATCH` | `/classifications/:id/reorder` | Set display order |
| `PATCH` | `/classifications/:id/archive` | Archive classification |
| `PATCH` | `/classifications/:id/restore` | Restore archived classification |

### Classification Groups

| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications/groups` | List groups with nested classifications (management view) |
| `POST` | `/classifications/groups` | Create group |
| `PATCH` | `/classifications/groups/:id` | Rename group |
| `PATCH` | `/classifications/groups/:id/reorder` | Set display order |
| `PATCH` | `/classifications/groups/:id/archive` | Archive group |
| `PATCH` | `/classifications/groups/:id/restore` | Restore archived group |

**Data lifecycle:** nothing is hard-deleted. All "delete" actions set `archivedAt` and can be reversed with the corresponding `/restore` endpoint.

**POST /bookmarks — duplicate detection:**
- Returns `409` with a `duplicates` array if an active bookmark with the same URL already exists.
- To save anyway after user confirmation, include `allowDuplicate: true` in the body.

---

## Database Schema

All tables include `archived_at DATETIME NULL`. A `NULL` value means the row is active. "Deleting" a row sets `archived_at = NOW()`. All queries filter on `archived_at IS NULL`.

| Table | Purpose |
|---|---|
| `bookmarks` | Core bookmark store |
| `classification_groups` | Groups for organizing classifications |
| `classifications` | Individual categories; many-to-many with bookmarks |
| `tags` | Flexible labels; many-to-many with bookmarks |
| `bookmark_tags` | Junction table |
| `bookmark_classifications` | Junction table |

**Uniqueness among active rows** — `tags` and `classifications` use a generated column (`name_active`) that is `NULL` when archived, with a unique index on that column. This allows archived rows to share names with active rows.

---

## Environment Variables

All vars live in `api/.env` (gitignored). Copy from `api/.env.example` to get started.

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `11650` | HTTP port |
| `LOG_LEVEL` | `info` | Elysia log level |
| `DB_HOST` | `127.0.0.1` | MariaDB host (must be `127.0.0.1` within the pod) |
| `DB_PORT` | `3306` | MariaDB port |
| `DB_USER` | `bookmark` | DB username |
| `DB_PASSWORD` | — | DB password |
| `DB_NAME` | `bookmarks` | DB name |
| `MARIADB_DATABASE` | — | Used by mariadb:11 container on first init |
| `MARIADB_USER` | — | Used by mariadb:11 container on first init |
| `MARIADB_PASSWORD` | — | Used by mariadb:11 container on first init |
| `MARIADB_ROOT_PASSWORD` | — | Used by mariadb:11 container on first init |
| `PMA_HOST` | `127.0.0.1` | phpMyAdmin DB host (within pod) |
| `PMA_PORT` | `3306` | phpMyAdmin DB port |
| `PMA_ABSOLUTE_URI` | `http://localhost:11651/` | phpMyAdmin canonical URL |

---

## Infrastructure

### Pod: `bookmark.pod`

| Port | Service | Access |
|---|---|---|
| `11650` | API | host + LAN |
| `11651` | phpMyAdmin | `127.0.0.1` only |

MariaDB is pod-internal only — never exposed to the host.

### Quadlet unit files

Canonical copies live in `quadlet/` (version-controlled). `scripts/install.sh` copies them to `~/.config/containers/systemd/`.

```
quadlet/
├── bookmark.pod
├── bookmark-api.container
├── bookmark-db.container
└── bookmark-pma.container
```

### DB data volume

```
~/.local/share/bookmark-manager/prod-db
```

Created automatically by `scripts/install.sh`. **Not removed by `uninstall.sh` unless explicitly confirmed.**

---

## phpMyAdmin

Available at `http://localhost:11651`.

- Auto-login is **disabled** — credentials required on every login.
- Connect with the `bookmark` user (or `root` if needed).
