# Bookmark Manager API

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![Elysia](https://img.shields.io/badge/Framework-Elysia-5f67ff)](https://elysiajs.com)
[![MariaDB](https://img.shields.io/badge/Database-MariaDB%2011-003545?logo=mariadb)](https://mariadb.org)
[![Drizzle](https://img.shields.io/badge/ORM-Drizzle-c5f74f?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI%203.0-85ea2d?logo=openapiinitiative&logoColor=black)](http://localhost:11650/docs)
[![Podman](https://img.shields.io/badge/Container-Podman-892ca0?logo=podman)](https://podman.io)

A Bun + Elysia API for managing bookmarks, tags, and classifications. Backed by MariaDB with Drizzle ORM. Data is never hard-deleted — all "delete" actions archive rows (`archived_at`).

---

## Table of Contents

- [Quick Start](#quick-start)
  - [1. Configure environment](#1-configure-environment)
  - [2. Install and start](#2-install-and-start-from-repo-root)
  - [3. Health check](#3-health-check)
  - [4. Boot persistence](#4-boot-persistence)
- [Scripts](#scripts-from-repo-root)
- [Bun scripts](#bun-scripts-in-api)
- [API Endpoints](#api-endpoints)
  - [Health & UI](#health--ui)
  - [Bookmarks](#bookmarks)
  - [Tags](#tags)
  - [Classifications](#classifications)
  - [Classification Groups](#classification-groups)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Infrastructure](#infrastructure)
- [phpMyAdmin](#phpmyadmin)

---

## Quick Start

### 1. Configure environment

```bash
cp api/.env.example api/.env
# Edit api/.env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
nano api/.env
```

> **Important:** `MARIADB_USER`/`MARIADB_PASSWORD` and `DB_USER`/`DB_PASSWORD` must match.

`./scripts/install.sh` generates `api/.env.api`, `api/.env.db`, and `api/.env.pma` from `api/.env` so each container only receives the variables it needs.

### 2. Install and start (from repo root)

```bash
./scripts/install.sh
```

This will generate split env files, build the API image, copy Quadlet unit files, reload systemd, and start the pod.

Alternatively, run individual steps manually:

```bash
podman build -t localhost/bookmark-api:latest api/
systemctl --user daemon-reload
systemctl --user start bookmark-pod.service
```

This starts:
- **MariaDB** — pod-internal only (not exposed to host)
- **phpMyAdmin** on `http://localhost:11651` (localhost only, login required)
- **API** on `http://localhost:11650` (runtime migrations wait for the DB, then run automatically on start)

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

[↑ Table of Contents](#table-of-contents)

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

[↑ Table of Contents](#table-of-contents)

## Bun scripts (in `api/`)

| Command | Description |
|---|---|
| `bun run dev` | Watch mode (`bun --watch src/server.ts`) |
| `bun run start` | Production start |
| `bun run db:generate` | Generate a new Drizzle migration from schema changes |
| `bun run db:migrate` | Apply pending Drizzle migrations |
| `bun run db:studio` | Open Drizzle Studio (visual DB browser) |
| `bun run smoke` | Smoke test — verifies `/health` (no DB required) |

## Production runtime hardening

- The API container installs production dependencies only; `drizzle-kit` stays out of the runtime image.
- Startup migrations use `api/src/db/migrate.ts`, which waits for MariaDB and applies the checked-in SQL migrations before the server starts.
- The API container runs as a non-root user with a read-only root filesystem, a tmpfs-backed `/tmp`, and `NoNewPrivileges=true`.
- `mariadb-client` remains in the image only because the authenticated `/backup` endpoint streams `mariadb-dump`; this keeps deployment simple at the cost of a slightly larger runtime image.

### Workflow for schema changes

```bash
# 1. Edit api/src/db/schema.ts
# 2. Generate the migration
cd api && bun run db:generate
# 3. Rebuild and restart
./scripts/rebuild.sh
```

---

[↑ Table of Contents](#table-of-contents)

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

[↑ Table of Contents](#table-of-contents)

### Bookmarks

| Method | Path | Description |
|---|---|---|
| `GET` | `/bookmarks` | List/filter bookmarks (`?limit=&offset=&classificationId=&tagId=&flag=&sortBy=&archived=`) |
| `POST` | `/bookmarks` | Create bookmark |
| `PATCH` | `/bookmarks/:id` | Edit title, description, flags, tags, classifications |
| `PATCH` | `/bookmarks/:id/archive` | Soft-delete (sets `archivedAt`) |
| `PATCH` | `/bookmarks/:id/restore` | Restore archived bookmark |

[↑ Table of Contents](#table-of-contents)

### Tags

| Method | Path | Description |
|---|---|---|
| `GET` | `/tags` | List/search tags (`?query=&limit=&offset=&sort=`) |
| `POST` | `/tags` | Create tag |
| `PATCH` | `/tags/:id/archive` | Archive tag |
| `PATCH` | `/tags/:id/restore` | Restore archived tag |

[↑ Table of Contents](#table-of-contents)

### Classifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications` | All active classifications, nested by group |
| `POST` | `/classifications` | Create classification (optionally with new group) |
| `PATCH` | `/classifications/:id` | Rename classification |
| `PATCH` | `/classifications/:id/reorder` | Set display order |
| `PATCH` | `/classifications/:id/archive` | Archive classification |
| `PATCH` | `/classifications/:id/restore` | Restore archived classification |

[↑ Table of Contents](#table-of-contents)

### Classification Groups

| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications/groups` | List groups with nested classifications (management view) |
| `POST` | `/classifications/groups` | Create group |
| `PATCH` | `/classifications/groups/:id` | Rename group |
| `PATCH` | `/classifications/groups/:id/reorder` | Set display order |
| `PATCH` | `/classifications/groups/:id/archive` | Archive group |
| `PATCH` | `/classifications/groups/:id/restore` | Restore archived group |

**Data lifecycle:** nothing is hard-deleted. Entity records and bookmark association rows are archived via `archivedAt`, and restoring an entity or re-attaching an archived association preserves prior history.

**POST /bookmarks — duplicate detection:**
- Returns `409` with a `duplicates` array if an active bookmark with the same URL already exists.
- To save anyway after user confirmation, include `allowDuplicate: true` in the body.

---

[↑ Table of Contents](#table-of-contents)

## Database Schema

All tables include `archived_at DATETIME NULL`. A `NULL` value means the row is active. "Deleting" a row sets `archived_at = NOW()`. Bookmark association replacement archives removed junction rows and reactivates them if the same link is added later. Active queries filter on `archived_at IS NULL`.

| Table | Purpose |
|---|---|
| `bookmarks` | Core bookmark store |
| `classification_groups` | Groups for organizing classifications |
| `classifications` | Individual categories; many-to-many with bookmarks |
| `tags` | Flexible labels; many-to-many with bookmarks |
| `bookmark_tags` | Junction table with archive/restore semantics |
| `bookmark_classifications` | Junction table with archive/restore semantics |

**Uniqueness among active rows** — `tags` and `classifications` use a generated column (`name_active`) that is `NULL` when archived, with a unique index on that column. This allows archived rows to share names with active rows.

---

[↑ Table of Contents](#table-of-contents)

## Environment Variables

Set values in `api/.env` (gitignored). `./scripts/install.sh` splits that file into `api/.env.api`, `api/.env.db`, and `api/.env.pma` so each service only receives the variables it needs.

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

[↑ Table of Contents](#table-of-contents)

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

[↑ Table of Contents](#table-of-contents)

## phpMyAdmin

Available at `http://localhost:11651`.

- Auto-login is **disabled** — credentials required on every login.
- Connect with the `bookmark` user (or `root` if needed).

[↑ Table of Contents](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-NC-SA 4.0
