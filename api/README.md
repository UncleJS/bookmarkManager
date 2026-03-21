# Bookmark Manager API

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![Elysia](https://img.shields.io/badge/Framework-Elysia-5f67ff)](https://elysiajs.com)
[![MariaDB](https://img.shields.io/badge/Database-MariaDB%2011-003545?logo=mariadb)](https://mariadb.org)
[![Drizzle](https://img.shields.io/badge/ORM-Drizzle-c5f74f?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI%203.0-85ea2d?logo=openapiinitiative&logoColor=black)](http://localhost:11650/docs)

Bun + Elysia API for managing bookmarks, tags, and a 3-level category taxonomy. Backed by MariaDB with Drizzle ORM. Nothing is hard-deleted — all tables use archive/restore semantics via `archived_at`.

> **Full project documentation:** [`../README.md`](../README.md)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Bun Scripts](#bun-scripts)
- [Project Structure](#project-structure)
- [Authentication](#authentication)
- [Endpoint Summary](#endpoint-summary)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Infrastructure Notes](#infrastructure-notes)
- [phpMyAdmin](#phpmyadmin)

---

## Quick Start

```bash
# From repo root — first time
cp api/.env.example api/.env
nano api/.env   # set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD, API_TOKEN, BACKUP_TOKEN
./scripts/install.sh

# Health checks
curl http://localhost:11650/health   # → {"status":"ok","check":"liveness"}
curl http://localhost:11650/ready    # → {"status":"ok","check":"readiness"}
```

`./scripts/install.sh` generates `api/.env.api`, `api/.env.db`, and `api/.env.pma` from `api/.env`, builds the image, deploys Quadlet unit files, and waits for `/ready` before reporting success. Re-running it is safe (idempotent).

**Boot persistence** — run once per user:
```bash
loginctl enable-linger $USER
```

---

[↑ Table of Contents](#table-of-contents)

## Bun Scripts

Run from the `api/` directory.

| Command | Description |
|---|---|
| `bun run dev` | Watch mode (`bun --watch src/server.ts`) |
| `bun run start` | Production start |
| `bun run test:integration` | Run integration suite when MariaDB is reachable from your shell |
| `bun run db:generate` | Generate a new Drizzle migration from schema changes |
| `bun run db:migrate` | Apply pending Drizzle migrations |
| `bun run db:studio` | Open Drizzle Studio (visual DB browser) |
| `bun run smoke` | Smoke-test real `/health` + `/ready` behavior |
| `bun run e2e` | Run the full Playwright E2E suite |
| `bun run e2e:api` | API smoke tests only |
| `bun run e2e:headed` | E2E suite in headed (visible) browser mode |
| `bun run e2e:report` | Open the last Playwright HTML report |

**Schema changes workflow:**

```bash
# 1. Edit api/src/db/schema.ts
cd api && bun run db:generate
cd .. && ./scripts/rebuild.sh   # migrations run automatically on container start
```

---

[↑ Table of Contents](#table-of-contents)

## Project Structure

```
api/
├── src/
│   ├── server.ts               # Elysia app + route registration
│   ├── routes/
│   │   ├── bookmarks.ts
│   │   ├── tags.ts
│   │   ├── categories.ts
│   │   ├── subcategories.ts
│   │   ├── subSubcategories.ts
│   │   ├── health.ts           # /health, /ready, /config, /app, /manage-*, /backup
│   │   └── shared.ts           # Shared schema helpers + error types
│   ├── db/
│   │   ├── schema.ts           # Drizzle table definitions
│   │   ├── client.ts           # Drizzle + mysql2 pool
│   │   ├── migrate.ts          # Startup migration runner
│   │   └── migrations/         # Drizzle-generated SQL files
│   ├── ui/
│   │   ├── app.html            # Bookmark viewer (served at /app)
│   │   ├── categories.html     # Category manager (served at /manage-categories)
│   │   └── tags.html           # Tag manager (served at /manage-tags)
│   └── smoke/
│       └── health.ts           # No-DB smoke test
├── Dockerfile
├── healthcheck.mjs             # Container healthcheck (reads $API_PORT)
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env.example                # Template — copy to .env
└── .env                        # Live credentials (gitignored)
```

---

[↑ Table of Contents](#table-of-contents)

## Authentication

All bookmark-management routes require `Authorization: Bearer <API_TOKEN>`.

**Auth-exempt routes:**
- `/health`, `/ready` — health probes
- `/app`, `/manage-categories`, `/manage-tags` — static UI pages
- `/config` — returns the `apiToken` for browser UI bootstrap
- `/docs`, `/openapi.json` — Swagger

**Backup auth** — `GET /backup` uses a separate `BACKUP_TOKEN` credential.

Both `API_TOKEN` and `BACKUP_TOKEN` must be set to a strong random value in `api/.env`. The default placeholder `change_me_please` is explicitly rejected with `503`.

The pod binds the API port to `127.0.0.1:11650` only — no LAN access is possible at the network level.

---

[↑ Table of Contents](#table-of-contents)

## Endpoint Summary

Interactive docs always at **`http://localhost:11650/docs`**.

### Health & UI

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | No | Redirect to `/app` |
| `GET` | `/health` | No | Liveness check (HTTP process) |
| `GET` | `/ready` | No | Readiness check (verifies MariaDB) |
| `GET` | `/config` | No | Returns `apiToken` for browser UI bootstrap |
| `GET` | `/docs` | No | Swagger UI |
| `GET` | `/openapi.json` | No | OpenAPI spec |
| `GET` | `/app` | No | Bookmark viewer UI |
| `GET` | `/manage-categories` | No | Category + sub-sub-category management UI |
| `GET` | `/manage-tags` | No | Tag management UI |
| `GET` | `/flag-counts` | Yes | Active bookmark count per flag |
| `GET` | `/backup` | `BACKUP_TOKEN` | Download gzipped MariaDB dump |

### Bookmarks

| Method | Path | Description |
|---|---|---|
| `GET` | `/bookmarks` | List/filter (`?limit=&offset=&subcategoryId=&tagId=&flag=&sortBy=&archived=`) |
| `POST` | `/bookmarks` | Create bookmark |
| `PATCH` | `/bookmarks/:id` | Edit title, description, flags, tags, sub-categories, sub-sub-categories |
| `PATCH` | `/bookmarks/:id/archive` | Soft-delete |
| `PATCH` | `/bookmarks/:id/restore` | Restore |

`POST /bookmarks` body fields: `url`, `title`, `description?`, `subcategoryIds?`, `subSubcategoryIds?`, `categoryIds?`, `tags?`, `flags?`, `faviconUrl?`, `allowDuplicate?`.

Returns `409` with a `duplicates` array if an active bookmark already has the same URL. Set `allowDuplicate: true` to bypass.

### Tags

| Method | Path | Description |
|---|---|---|
| `GET` | `/tags` | List/search (`?query=&exact=&limit=&offset=&sort=count\|alpha&archived=`) |
| `POST` | `/tags` | Create tag |
| `PATCH` | `/tags/:id` | Rename tag |
| `PATCH` | `/tags/:id/archive` | Archive (blocked if active bookmarks still use it) |
| `PATCH` | `/tags/:id/restore` | Restore |

### Sub-categories

| Method | Path | Description |
|---|---|---|
| `GET` | `/subcategories` | All active sub-categories nested by category (includes sub-sub-categories + bookmark counts) |
| `POST` | `/subcategories` | Create (`name`, `description?`, `categoryId?`, `categoryName?`) |
| `PATCH` | `/subcategories/:id` | Rename / update description |
| `PATCH` | `/subcategories/:id/archive` | Archive (blocked if active bookmarks still use it) |
| `PATCH` | `/subcategories/:id/restore` | Restore |

### Sub-sub-categories

| Method | Path | Description |
|---|---|---|
| `GET` | `/subSubcategories` | All active sub-sub-categories grouped by sub-category |
| `POST` | `/subSubcategories` | Create (`name`, `description?`, `subcategoryId`) |
| `PATCH` | `/subSubcategories/:id` | Rename / update description |
| `PATCH` | `/subSubcategories/:id/archive` | Archive (blocked if active bookmarks still use it) |
| `PATCH` | `/subSubcategories/:id/restore` | Restore |

### Categories

| Method | Path | Description |
|---|---|---|
| `GET` | `/categories` | Management view — categories + nested sub-categories + sub-sub-categories + `archivedAt` |
| `POST` | `/categories` | Create (`name`, `description?`) |
| `PATCH` | `/categories/:id` | Rename / update description |
| `PATCH` | `/categories/:id/archive` | Archive (blocked if any active bookmarks exist in the whole category branch) |
| `PATCH` | `/categories/:id/restore` | Restore (sub-categories are not auto-restored) |

---

[↑ Table of Contents](#table-of-contents)

## Database Schema

All tables carry `archived_at DATETIME NULL`. `NULL` = active. Setting `archived_at = NOW()` is the only form of deletion. Replaced bookmark associations (tags, sub-categories, sub-sub-categories) archive removed junction rows and reactivate them if the same link is added later.

| Table | Purpose |
|---|---|
| `bookmarks` | Core bookmark store |
| `categories` | Top-level taxonomy; optional `description` |
| `subcategories` | Second-level taxonomy grouped under a category; optional `description` |
| `sub_subcategories` | Third-level taxonomy nested under a sub-category; optional `description` |
| `tags` | Flexible labels; many-to-many with bookmarks |
| `bookmark_tags` | Junction: bookmarks ↔ tags |
| `bookmark_subcategories` | Junction: bookmarks ↔ sub-categories |
| `bookmark_sub_subcategories` | Junction: bookmarks ↔ sub-sub-categories |

**Active-row uniqueness** — `tags`, `subcategories`, and `sub_subcategories` use a generated column (`name_active`) that is `NULL` when archived, with a unique index. Archived rows may share names with active rows.

---

[↑ Table of Contents](#table-of-contents)

## Environment Variables

Set values in `api/.env`. `./scripts/install.sh` splits that file into `api/.env.api`, `api/.env.db`, and `api/.env.pma`.

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `11650` | HTTP port |
| `LOG_LEVEL` | `info` | Elysia log level |
| `DB_HOST` | `127.0.0.1` | MariaDB host (must be `127.0.0.1` within the pod) |
| `DB_PORT` | `3306` | MariaDB port |
| `DB_USER` | `bookmark` | DB username |
| `DB_PASSWORD` | — | DB password |
| `DB_NAME` | `bookmarks` | DB name |
| `API_TOKEN` | `change_me_please` | Bearer token for all management routes; placeholder rejected with `503` |
| `BACKUP_TOKEN` | `change_me_please` | Bearer token for `GET /backup`; placeholder rejected with `503` |
| `MARIADB_DATABASE` | — | MariaDB container first-init |
| `MARIADB_USER` | — | MariaDB container first-init |
| `MARIADB_PASSWORD` | — | MariaDB container first-init |
| `MARIADB_ROOT_PASSWORD` | — | MariaDB container first-init; also used by import scripts |
| `PMA_HOST` | `127.0.0.1` | phpMyAdmin DB host |
| `PMA_PORT` | `3306` | phpMyAdmin DB port |
| `PMA_ABSOLUTE_URI` | `http://localhost:11651/` | phpMyAdmin canonical URL |

---

[↑ Table of Contents](#table-of-contents)

## Infrastructure Notes

- **Port binding** — `127.0.0.1:11650` (API) and `127.0.0.1:11651` (phpMyAdmin). MariaDB is pod-internal only.
- **Startup migrations** — `api/src/db/migrate.ts` waits for MariaDB and applies pending SQL migrations before the HTTP server starts.
- **Container hardening** — non-root user, read-only root filesystem, `tmpfs` at `/tmp`, `NoNewPrivileges=true`.
- **`mariadb-client` in image** — required by the authenticated `GET /backup` endpoint which streams `mariadb-dump`.
- **DB data volume** — `~/.local/share/bookmark-manager/prod-db`; never deleted automatically.

---

[↑ Table of Contents](#table-of-contents)

## phpMyAdmin

Available at `http://localhost:11651`. Auto-login is disabled — connect with the `bookmark` user or `root`.

[↑ Table of Contents](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-NC-SA 4.0
