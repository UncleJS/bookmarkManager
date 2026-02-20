# Bookmark Manager

A Chrome extension (MV3) that captures bookmarks and sends them to a local Bun/Elysia API backed by MariaDB.

Everything is implemented in JavaScript (no TypeScript) for the extension; the API uses TypeScript with Bun.

## Stack

| Layer | Technology |
|---|---|
| Chrome Extension | Manifest V3, vanilla JS/HTML/CSS |
| API | Bun + Elysia + TypeScript |
| ORM | Drizzle |
| Database | MariaDB 11 |
| Dev infrastructure | Rootless Podman + systemd (Quadlet) |

## Quick Start

### 1. Start the dev database pod

```fish
systemctl --user daemon-reload
systemctl --user enable --now bookmark-dev-pod
```

Starts MariaDB (pod-internal) and phpMyAdmin on `http://localhost:11651`.

### 2. Configure and migrate

```fish
cd api
cp .env.example .env
# Edit .env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
bun install
bun run db:migrate
```

### 3. Start the API

```fish
cd api
bun run dev
```

- API: `http://localhost:11650`
- Swagger UI: `http://localhost:11650/docs`
- OpenAPI JSON: `http://localhost:11650/openapi.json`

### 4. Health check

```fish
curl http://localhost:11650/health
# → {"status":"ok"}
```

### 5. Load the Chrome extension

- Open `chrome://extensions`
- Enable Developer mode
- Click "Load unpacked" → select the `extension/` folder
- Open Options → set API base URL to `http://localhost:11650`

---

## API Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/classifications` | List classifications (grouped) |
| `POST` | `/classifications` | Create classification |
| `GET` | `/tags` | Search tags |
| `POST` | `/tags` | Create tag |
| `GET` | `/bookmarks` | List bookmarks |
| `POST` | `/bookmarks` | Save bookmark |

Duplicate URL detection: the API returns `409` with existing bookmark metadata. Include `allowDuplicate: true` to save anyway after explicit user confirmation.

---

## Chrome Extension

- Click the action icon for the popup (full save with form)
- Right-click a page for context menus: **Quick Save** / **Full Save**

See `extension/README.md` for full extension documentation.
See `api/README.md` for full API documentation including production deployment.

## Troubleshooting

- **Dev DB port busy:** Another service is using the dev pod ports. Edit `~/.config/containers/systemd/bookmark-dev.pod` to change the host port mappings.
- **API can't reach DB:** Check `api/.env` matches your DB credentials and `DB_HOST=127.0.0.1`.
- **Extension can't reach API:** Verify the base URL in Options and ensure `host_permissions` in `extension/manifest.json` includes your API origin.
