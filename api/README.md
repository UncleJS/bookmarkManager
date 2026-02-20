# Bookmark Manager API

A Bun + Elysia API for managing bookmarks, tags, and classifications. Backed by MariaDB with Drizzle ORM. Data is never hard-deleted — all "delete" actions archive rows (`archived_at`).

## Quick Start (Development)

### 1. Start the dev pod (MariaDB + phpMyAdmin)

The dev pod is managed by rootless Podman via systemd (Quadlet). No Docker required.

```fish
systemctl --user daemon-reload
systemctl --user enable --now bookmark-dev-pod
```

This starts:
- **MariaDB** — pod-internal only (not exposed to host)
- **phpMyAdmin** on `http://localhost:11651` (localhost only, login required)

Check status and logs:
```fish
systemctl --user status bookmark-dev-pod bookmark-dev-db bookmark-dev-pma
journalctl --user -u bookmark-dev-db -f
```

Stop the pod:
```fish
systemctl --user stop bookmark-dev-pod
```

### 2. Configure environment

```fish
cp api/.env.example api/.env
# Edit api/.env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
```

> **Important:** `MARIADB_USER`, `MARIADB_PASSWORD`, and `DB_USER`, `DB_PASSWORD` must match.

### 3. Install dependencies

```fish
cd api
bun install
```

### 4. Run migrations

```fish
bun run db:migrate
```

For existing databases originally created with the old Express/plain-SQL schema, run the one-time upgrade script first:
```fish
# Connect to MariaDB and run:
# api/src/db/upgrade_from_v1.sql
# Then run: bun run db:migrate
```

### 5. Start the API

```fish
bun run dev        # file-watching dev mode
bun run start      # production mode
```

- **API:** `http://localhost:11650`
- **Swagger UI:** `http://localhost:11650/docs`
- **OpenAPI JSON:** `http://localhost:11650/openapi.json`

### 6. Health check

```fish
curl http://localhost:11650/health
# → {"status":"ok"}
```

### 7. Smoke test (no DB required)

```fish
bun run smoke
# → OK: /health → { status: "ok" }
```

---

## Scripts

| Command | Description |
|---|---|
| `bun run start` | Start production server |
| `bun run dev` | Start dev server with file watching |
| `bun run db:migrate` | Apply pending Drizzle migrations |
| `bun run db:generate` | Generate a new migration from schema changes |
| `bun run db:studio` | Open Drizzle Studio (visual DB browser) |
| `bun run smoke` | Smoke test (no DB required) |

---

## API Endpoints

Interactive docs always available at **`http://localhost:11650/docs`**.

### Health
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{ status: "ok" }` |

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

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `11650` | HTTP port |
| `LOG_LEVEL` | `info` | Elysia log level |
| `DB_HOST` | `127.0.0.1` | MariaDB host |
| `DB_PORT` | `3306` | MariaDB port |
| `DB_USER` | `bookmark` | DB username |
| `DB_PASSWORD` | — | DB password |
| `DB_NAME` | `bookmarks` | DB name |
| `MARIADB_DATABASE` | — | Used by mariadb:11 container init |
| `MARIADB_USER` | — | Used by mariadb:11 container init |
| `MARIADB_PASSWORD` | — | Used by mariadb:11 container init |
| `MARIADB_ROOT_PASSWORD` | — | Used by mariadb:11 container init |
| `PMA_HOST` | `127.0.0.1` | phpMyAdmin DB host (within pod) |
| `PMA_PORT` | `3306` | phpMyAdmin DB port |
| `PMA_ABSOLUTE_URI` | `http://localhost:11651/` | phpMyAdmin canonical URL |

---

## Production Deployment

The production pod (`bookmark.pod`) contains MariaDB + phpMyAdmin + API container.

### 1. Create prod env file

```fish
cp api/.env.example ~/bookmark-manager.env
# Edit ~/bookmark-manager.env — set all passwords, set DB_HOST=127.0.0.1
```

### 2. Build the API image

```fish
cd api
podman build -t localhost/bookmark-api:latest .
```

### 3. Start the pod

```fish
systemctl --user daemon-reload
systemctl --user enable --now bookmark-pod
```

### 4. Boot persistence (optional)

If services must start at boot without an interactive login session:
```fish
loginctl enable-linger $USER
```

---

## phpMyAdmin

Available at `http://localhost:11651` (dev) or `http://localhost:11651` via SSH tunnel (prod).

- Auto-login is **disabled** — credentials required on every login.
- Connect with the `bookmark` user (or `root` if needed).
