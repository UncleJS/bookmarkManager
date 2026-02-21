# Bookmark Manager — Project Reference

A precise description of what is built, how it works, and how to extend it.

---

## 1) Goals and Non-Goals

- Goals
  - Chrome extension to capture bookmarks and send them to a Bun/Elysia API backed by MariaDB.
  - Rich capture form (URL, Title, Description, Classification, Tags, Flags) with data pulled from the API.
  - Quick-save and full-save via context menu.
  - Simple extension implementation: vanilla HTML/CSS/JS.

- Non-Goals
  - User management and multi-tenant accounts (single-user deployment on a trusted network).
  - Offline sync/queueing; if the network fails, show an error.
  - Browser support beyond Chromium-based browsers.
  - Complex search UI in the extension.

---

## 2) High-Level Architecture

- Chrome Extension (Manifest V3)
  - Popup UI (form) for full bookmark capture.
  - Background Service Worker for context menus, tab info, API calls, and messaging.
  - Options page for configuring API base URL.
- Bun/Elysia API + MariaDB
  - Endpoints for bookmarks, tags, and classifications.
  - No authentication or CORS; input validation on the frontend.
  - Swagger UI at `/docs`; OpenAPI spec at `/openapi.json`.
- Data Flow
  1) Popup opens ➜ background fetches classifications/tags ➜ UI populates dropdowns.
  2) User submits ➜ popup sends message to background ➜ background POSTs to API ➜ background returns success/error to popup ➜ UI feedback.
  3) Context menu "Quick Save" ➜ background captures active tab (url/title) ➜ POST to API with defaults ➜ notification.
  4) Context menu "Full Save" ➜ background opens the popup, pre-filled with url/title.

---

## 3) Functional Requirements

- Popup form fields
  - URL: read-only, pre-filled with current tab URL.
  - Title: editable, pre-filled with current tab title.
  - Description: multiline textarea.
  - Classification: single-select with grouped options (optgroup). Options loaded from API. Ability to create a new classification on the fly.
  - Tags: multi-select (vanilla JS). Options loaded from API with search/autocomplete. Ability to create new tags on the fly.
  - Flags (checkboxes): readLater, hotTopic, cheatsheets, forReview.
  - Save button submits to API. Show success/error message.
- Context menus
  - "Quick Save Bookmark": immediately posts active tab url/title with defaults.
  - "Full Save Bookmark": opens popup with pre-filled url/title.
- Permissions and behavior
  - Access to active tab (url/title), context menus, notifications, storage, and API host permissions.
  - Handle network errors with clear user feedback.
- API
  - Endpoints to list/create classifications and tags, and to create/edit/archive bookmarks.
  - No auth or CORS.
- Detect existing bookmarks with the same URL and require explicit user confirmation before creating a duplicate.

---

## 4) Non-Functional Requirements

- Simplicity: vanilla JS for the extension.
- Performance: responsive popup (under 200ms UI operations, excluding network).
- Reliability: API with clear errors; DB constraints enforce uniqueness/relations.
- Security: no auth/CORS; operate in a trusted environment. Minimize extension permissions.
- Observability: API logging for requests and errors.
- Data safety: no hard deletes — all tables have `archived_at`; archive-only lifecycle.

---

## 5) Chrome Extension (Manifest V3)

### 5.1 Tech Choices
- HTML, CSS, JS (ES modules).
- No frameworks for popup UI.

### 5.2 File/Folder Structure

```
extension/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── background/
│   └── background.js       # Service worker
├── options/
│   ├── options.html
│   └── options.js
├── lib/
│   ├── api.js              # fetch wrapper
│   ├── dom.js              # DOM helpers
│   └── storage.js          # chrome.storage.sync wrapper
└── assets/
    └── icons/
```

### 5.3 Manifest
- `permissions`: `["tabs", "activeTab", "contextMenus", "storage", "notifications"]`
- `host_permissions`: `["http://localhost:11650/*"]`
- Configurable via Options page (stored in `chrome.storage.sync`)

### 5.4 Popup UI Behavior
- On load: read active tab, fetch classifications and tag suggestions, populate form.
- Tags multi-select: input + listbox, debounced API calls (250ms), removable chips, create new on the fly.
- Classification creation: inline affordance → POST /classifications → refresh dropdown.
- Submission: validate, construct payload, send via background message, disable button + loader, show success/error.

### 5.5 Background Service Worker
- Registers context menus on install/activate.
- Quick Save: captures active tab → POST /bookmarks → notification.
- Full Save: opens popup programmatically (fallback to window if blocked).
- Centralises all API calls (reads base URL from storage, fetch with timeouts, error mapping).
- Message types: `getInitialData`, `createTag`, `createClassification`, `saveBookmark`, `searchTags`.

### 5.6 Edge Cases
- Very long titles/URLs: truncate in UI display; send full to API.
- Duplicate URL: API returns 409 with existing metadata; UI presents duplicates and lets user cancel or proceed.
- Large tag set: paginate suggestions; fetch top N matches only.
- Empty API configuration: prompt user to open Options.
- API failure/timeouts: inform user; do not retry POST.

---

## 6) API (Bun/Elysia + MariaDB)

### 6.1 Tech Choices
- Bun runtime, Elysia framework, Drizzle ORM, mysql2 driver, TypeScript.
- Swagger UI at `/docs`; OpenAPI spec at `/openapi.json`.
- Environment loaded automatically by Bun from `api/.env`.

### 6.2 Project Structure

```
api/
├── src/
│   ├── server.ts               # Elysia app + all routes
│   ├── db/
│   │   ├── schema.ts           # Drizzle table definitions
│   │   ├── client.ts           # Drizzle + mysql2 pool
│   │   └── migrations/         # Drizzle-generated SQL
│   ├── ui/
│   │   ├── app.html            # Bookmark viewer UI (served at /app)
│   │   └── categories.html     # Category management UI (served at /categories)
│   └── smoke/
│       └── health.ts           # No-DB smoke test
├── drizzle.config.ts
├── healthcheck.mjs             # Container healthcheck (reads $API_PORT)
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env                        # Live credentials — gitignored
└── .env.example                # Template — copy to .env
```

### 6.3 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `11650` | HTTP port |
| `LOG_LEVEL` | `info` | Log level |
| `DB_HOST` | `127.0.0.1` | MariaDB host |
| `DB_PORT` | `3306` | MariaDB port |
| `DB_USER` | `bookmark` | DB username |
| `DB_PASSWORD` | — | DB password |
| `DB_NAME` | `bookmarks` | DB name |
| `MARIADB_DATABASE` | — | MariaDB container init |
| `MARIADB_USER` | — | MariaDB container init |
| `MARIADB_PASSWORD` | — | MariaDB container init |
| `MARIADB_ROOT_PASSWORD` | — | MariaDB container init |
| `PMA_HOST` | `127.0.0.1` | phpMyAdmin DB host |
| `PMA_PORT` | `3306` | phpMyAdmin DB port |
| `PMA_ABSOLUTE_URI` | `http://localhost:11651/` | phpMyAdmin canonical URL |

### 6.4 Authentication
- None. API runs in a trusted local environment.

### 6.5 Endpoints

Interactive docs always available at **`http://localhost:11650/docs`**.

#### Health & UI

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Redirect to `/app` |
| `GET` | `/health` | `{ status: "ok" }` |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/app` | Bookmark viewer UI |
| `GET` | `/categories` | Category management UI |
| `GET` | `/flag-counts` | Count of active bookmarks per flag |

#### Bookmarks

| Method | Path | Description |
|---|---|---|
| `GET` | `/bookmarks` | List/filter bookmarks (`?limit=&offset=&classificationId=&tagId=&flag=&sortBy=&archived=`) |
| `POST` | `/bookmarks` | Create bookmark |
| `PATCH` | `/bookmarks/:id` | Edit title, description, flags, tags, classifications |
| `PATCH` | `/bookmarks/:id/archive` | Soft-delete (sets `archivedAt`) |
| `PATCH` | `/bookmarks/:id/restore` | Restore archived bookmark |

#### Tags

| Method | Path | Description |
|---|---|---|
| `GET` | `/tags` | List/search tags (`?query=&limit=&offset=&sort=`) |
| `POST` | `/tags` | Create tag |
| `PATCH` | `/tags/:id/archive` | Archive tag |
| `PATCH` | `/tags/:id/restore` | Restore archived tag |

#### Classifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications` | All active classifications, nested by group |
| `POST` | `/classifications` | Create classification (optionally with new group) |
| `PATCH` | `/classifications/:id` | Rename classification |
| `PATCH` | `/classifications/:id/reorder` | Set display order |
| `PATCH` | `/classifications/:id/archive` | Archive classification |
| `PATCH` | `/classifications/:id/restore` | Restore archived classification |

#### Classification Groups

| Method | Path | Description |
|---|---|---|
| `GET` | `/classifications/groups` | List groups with nested classifications (management view) |
| `POST` | `/classifications/groups` | Create group |
| `PATCH` | `/classifications/groups/:id` | Rename group |
| `PATCH` | `/classifications/groups/:id/reorder` | Set display order |
| `PATCH` | `/classifications/groups/:id/archive` | Archive group |
| `PATCH` | `/classifications/groups/:id/restore` | Restore archived group |

**POST /bookmarks duplicate detection:**
- Returns `409` with a `duplicates` array if an active bookmark with the same URL already exists.
- Send with `allowDuplicate: true` to create a copy after user confirmation.

### 6.6 Database Schema

All tables include `archived_at DATETIME NULL`. `NULL` = active. "Delete" sets `archived_at = NOW()`.

| Table | Purpose |
|---|---|
| `bookmarks` | Core bookmark store |
| `classification_groups` | Groups for organizing classifications |
| `classifications` | Individual categories; many-to-many with bookmarks |
| `tags` | Flexible labels; many-to-many with bookmarks |
| `bookmark_tags` | Junction table |
| `bookmark_classifications` | Junction table |

**Uniqueness among active rows** — `tags` and `classifications` use a generated column (`name_active`) that is `NULL` when archived, with a unique index. Archived rows may share names with active rows.

### 6.7 Migrations
- Managed by Drizzle Kit. Schema defined in `src/db/schema.ts`.
- Generate: `bun run db:generate` → Apply: `bun run db:migrate`
- Migration files: `src/db/migrations/`
- Migrations run automatically at container start (Dockerfile CMD).

### 6.8 Validation and Error Handling
- Frontend validates before calling the API.
- API validates with Elysia's type system and DB constraints.
- Error response shape: `{ error: string, details?: any }`.

### 6.9 Duplicate Handling
- Before inserting, query for existing bookmarks with the same URL.
- Return 409 with existing bookmark metadata.
- Client resends with `allowDuplicate: true` after user confirmation.

---

## 7) Infrastructure (Rootless Podman + Quadlet)

### Pod: `bookmark.pod`
- Ports: `11650` (API), `127.0.0.1:11651` (phpMyAdmin)
- All containers share the pod network (`127.0.0.1` routing within the pod)
- Starts at boot via `WantedBy=default.target` (Quadlet generator)

### Containers
| Unit file | Image | Purpose |
|---|---|---|
| `bookmark-api.container` | `localhost/bookmark-api:latest` | Bun/Elysia API |
| `bookmark-db.container` | `docker.io/mariadb:11` | MariaDB (pod-internal only) |
| `bookmark-pma.container` | `docker.io/phpmyadmin:5` | phpMyAdmin |

### Environment
- Single file: `api/.env` (gitignored)
- Loaded by all three containers via `EnvironmentFile=%h/0_opencode/bookmarkManager/api/.env`
- Template: `api/.env.example`

### Quadlet unit files
Canonical copies live in `quadlet/` (version-controlled). `scripts/install.sh` deploys them to `~/.config/containers/systemd/`.

```
quadlet/                                  ← source of truth (repo)
├── bookmark.pod
├── bookmark-api.container
├── bookmark-db.container
└── bookmark-pma.container

~/.config/containers/systemd/             ← deployed by install.sh
├── bookmark.pod
├── bookmark-api.container
├── bookmark-db.container
└── bookmark-pma.container
```

### DB data volume
```
~/.local/share/bookmark-manager/prod-db
```
Created by `scripts/install.sh`. Never removed automatically — only on explicit confirmation in `scripts/uninstall.sh`.

### Lifecycle scripts
All scripts live in `scripts/` and are run from the repo root.

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

### Common commands (manual equivalents)
```bash
# Install (first time)
./scripts/install.sh

# Start / stop
./scripts/start.sh
./scripts/stop.sh

# Rebuild API after source changes
./scripts/rebuild.sh

# Tail API logs
./scripts/logs.sh

# Status overview
./scripts/status.sh

# Boot persistence (run once per user)
loginctl enable-linger $USER
```

---

## 8) Contracts and Example Payloads

POST /bookmarks request:
```json
{
  "url": "https://example.com/article",
  "title": "Great Article",
  "description": "Why this is useful…",
  "classificationId": 3,
  "tags": [1, 4, 7],
  "flags": { "readLater": true, "hotTopic": false, "cheatsheets": false, "forReview": false },
  "faviconUrl": "https://example.com/favicon.ico"
}
```

POST /bookmarks 201 response:
```json
{ "id": 123, "url": "https://example.com/article", "title": "Great Article", "createdAt": "2026-02-21T07:05:28Z" }
```

GET /classifications response:
```json
{
  "groups": [
    { "id": 1, "name": "Personal", "order": 1, "classifications": [ { "id": 10, "name": "Learning" } ] },
    { "id": 2, "name": "Technology", "order": 2, "classifications": [ { "id": 20, "name": "Database" } ] }
  ]
}
```

GET /tags response:
```json
{ "items": [ { "id": 1, "name": "javascript" }, { "id": 2, "name": "database" } ], "total": 2 }
```

---

## 9) Security and Privacy Considerations

- No authentication or CORS; operate in a trusted local network only.
- Extension requests only necessary permissions.
- No content scripts reading page content beyond URL and title.
- `api/.env` is gitignored — credentials never committed.

---

## 10) Glossary

- **Quick Save**: one-click save of url/title with default flags; no description, tags, or classification.
- **Full Save**: user completes the form in the popup before saving.
- **Classification**: a single category; grouped under a Classification Group for UI optgroup display.
- **Tags**: multiple labels that can be attached to bookmarks.
- **Archive**: soft-delete — sets `archived_at = NOW()`; row remains in DB and can be restored.
