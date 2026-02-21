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
| Infrastructure | Rootless Podman + systemd (Quadlet) |

## Quick Start

### 1. Configure environment

```fish
cp api/.env.example api/.env
# Edit api/.env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
```

### 2. Build the API image

```fish
podman build -t localhost/bookmark-api:latest api/
```

### 3. Start the pod

```fish
systemctl --user daemon-reload
systemctl --user start bookmark-pod.service
```

Starts MariaDB, phpMyAdmin (`http://localhost:11651`), and the API. Migrations run automatically on first start.

### 4. Health check

```fish
curl http://localhost:11650/health
# → {"status":"ok"}
```

- API: `http://localhost:11650`
- Swagger UI: `http://localhost:11650/docs`
- OpenAPI JSON: `http://localhost:11650/openapi.json`

### 5. Load the Chrome extension

- Open `chrome://extensions`
- Enable Developer mode
- Click "Load unpacked" → select the `extension/` folder
- The extension defaults to `http://localhost:11650` — change it in Options if needed

---

## API Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Redirect to bookmark viewer UI |
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/app` | Bookmark viewer UI |
| `GET` | `/categories` | Category management UI |
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
See `api/README.md` for full API documentation.

---

## Troubleshooting

- **Port busy:** Another service is using port 11650 or 11651. Edit `~/.config/containers/systemd/bookmark.pod` to change the host port mappings.
- **API can't reach DB:** Check `api/.env` — ensure `DB_PASSWORD` matches `MARIADB_PASSWORD` and `DB_HOST=127.0.0.1`.
- **Extension can't reach API:** Verify the base URL in Options and ensure `host_permissions` in `extension/manifest.json` includes your API origin.
