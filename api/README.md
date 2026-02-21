# Bookmark Manager API

A Bun + Elysia API for managing bookmarks, tags, and classifications. Backed by MariaDB with Drizzle ORM. Data is never hard-deleted — all "delete" actions archive rows (`archived_at`).

## Quick Start

### 1. Configure environment

```fish
cp api/.env.example api/.env
# Edit api/.env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
```

> **Important:** `MARIADB_USER`/`MARIADB_PASSWORD` and `DB_USER`/`DB_PASSWORD` must match.

### 2. Build the API image

```fish
podman build -t localhost/bookmark-api:latest api/
```

### 3. Start the pod

```fish
systemctl --user daemon-reload
systemctl --user start bookmark-pod.service
```

This starts:
- **MariaDB** — pod-internal only (not exposed to host)
- **phpMyAdmin** on `http://localhost:11651` (localhost only, login required)
- **API** on `http://localhost:11650` (migrations run automatically on start)

Check status and logs:
```fish
systemctl --user status bookmark-pod bookmark-db bookmark-pma bookmark-api
journalctl --user -u bookmark-api -f
```

Stop the pod:
```fish
systemctl --user stop bookmark-pod.service
```

### 4. Health check

```fish
curl http://localhost:11650/health
# → {"status":"ok"}
```

- **API:** `http://localhost:11650`
- **Swagger UI:** `http://localhost:11650/docs`
- **OpenAPI JSON:** `http://localhost:11650/openapi.json`
- **Bookmark viewer:** `http://localhost:11650/app`
- **Category manager:** `http://localhost:11650/categories`

### 5. Boot persistence

To start automatically at boot without an interactive login session:
```fish
loginctl enable-linger $USER
```

---

## Making changes to the source

After editing source files, rebuild the image and restart the API:

```fish
podman build -t localhost/bookmark-api:latest api/
systemctl --user restart bookmark-api.service
```

For schema changes, generate a new migration before rebuilding:
```fish
cd api && bun run db:generate
```

---

## Scripts

| Command | Description |
|---|---|
| `bun run db:migrate` | Apply pending Drizzle migrations |
| `bun run db:generate` | Generate a new migration from schema changes |
| `bun run db:studio` | Open Drizzle Studio (visual DB browser) |
| `bun run smoke` | Smoke test — verifies `/health` (no DB required) |

---

## API Endpoints

Interactive docs always available at **`http://localhost:11650/docs`**.

### Health & UI
| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Redirect to `/app` |
| `GET` | `/health` | Returns `{ status: "ok" }` |
| `GET` | `/app` | Bookmark viewer UI |
| `GET` | `/categories` | Category management UI |

### Tags
| Method | Path | Description |
|---|---|---|
| `GET` | `/tags` | List/search tags (`?query=&limit=&offset=`) |
| `POST` | `/tags` | Create a tag (`{ name }`) |

### Classifications
| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications` | All classifications grouped |
| `POST` | `/classifications` | Create classification + optional group |

### Bookmarks
| Method | Path | Description |
|---|---|---|
| `GET` | `/bookmarks` | List bookmarks (`?limit=&offset=`) |
| `POST` | `/bookmarks` | Create bookmark |
| `PATCH` | `/bookmarks/:id` | Update bookmark |
| `DELETE` | `/bookmarks/:id` | Archive bookmark (sets `archived_at`) |

**POST /bookmarks** — duplicate detection:
- Returns `409` with a `duplicates` array if the URL already exists.
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

## phpMyAdmin

Available at `http://localhost:11651`.

- Auto-login is **disabled** — credentials required on every login.
- Connect with the `bookmark` user (or `root` if needed).
