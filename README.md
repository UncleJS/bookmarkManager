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

---

## Quick Start

### 1. Configure environment

```bash
cp api/.env.example api/.env
# Edit api/.env — set DB_PASSWORD, MARIADB_PASSWORD, MARIADB_ROOT_PASSWORD
nano api/.env
```

### 2. Install (build image + deploy Quadlet + start pod)

```bash
./scripts/install.sh
```

`install.sh` will:
- Copy `api/.env.example → api/.env` if missing (then exit so you can set passwords)
- Pull `mariadb:11` and `phpmyadmin:5`
- Build `localhost/bookmark-api:latest`
- Copy `quadlet/` unit files into `~/.config/containers/systemd/`
- Run `systemctl --user daemon-reload` and start the pod

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

### 4. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. The extension defaults to `http://localhost:11650` — change it in Options if needed

---

## Scripts

All scripts live in `scripts/` and are run from the repo root.

| Script | Description |
|---|---|
| `./scripts/install.sh` | Full install: build image, deploy Quadlet files, start pod |
| `./scripts/uninstall.sh` | Stop services, remove Quadlet files, optionally remove image + data |
| `./scripts/rebuild.sh` | Rebuild API image and restart `bookmark-api.service` |
| `./scripts/start.sh` | Start the pod (all services) |
| `./scripts/stop.sh` | Stop the pod (all services) |
| `./scripts/restart.sh [api\|db\|pma]` | Restart one service or the whole pod |
| `./scripts/logs.sh [api\|db\|pma\|all]` | Tail logs — defaults to `api` |
| `./scripts/status.sh` | Show `systemctl --user status` for all services |
| `./scripts/dev.sh` | Run API locally via `bun run dev` (no container) |

---

## Repository Structure

```
bookmarkManager/
├── api/                    # Bun/Elysia API
│   ├── src/
│   │   ├── server.ts       # Elysia app + routes
│   │   ├── db/             # Drizzle schema, client, migrations
│   │   ├── ui/             # Served HTML pages (/app, /categories)
│   │   └── smoke/          # No-DB health smoke test
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   ├── package.json
│   ├── .env                # Live credentials (gitignored)
│   └── .env.example        # Template — copy to .env
├── extension/              # Chrome MV3 extension (vanilla JS)
│   ├── manifest.json
│   ├── popup/
│   ├── background/
│   ├── options/
│   ├── lib/
│   └── assets/
├── quadlet/                # Canonical Quadlet unit files (version-controlled)
│   ├── bookmark.pod
│   ├── bookmark-api.container
│   ├── bookmark-db.container
│   └── bookmark-pma.container
├── scripts/                # Lifecycle scripts
│   ├── install.sh
│   ├── uninstall.sh
│   ├── rebuild.sh
│   ├── start.sh
│   ├── stop.sh
│   ├── restart.sh
│   ├── logs.sh
│   ├── status.sh
│   └── dev.sh
├── PLAN.md                 # Full project reference
└── README.md               # This file
```

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
| `GET` | `/tags` | Search tags (`?query=&limit=&offset=`) |
| `POST` | `/tags` | Create tag |
| `GET` | `/bookmarks` | List bookmarks (`?limit=&offset=`) |
| `POST` | `/bookmarks` | Save bookmark |
| `PATCH` | `/bookmarks/:id` | Update bookmark |
| `DELETE` | `/bookmarks/:id` | Archive bookmark (sets `archived_at`) |

**Duplicate URL detection:** the API returns `409` with existing bookmark metadata. Include `allowDuplicate: true` to save anyway after explicit user confirmation.

---

## Chrome Extension

- Click the action icon for the popup (full save with form)
- Right-click a page for context menus: **Quick Save** / **Full Save**

See `extension/README.md` for full extension documentation.
See `api/README.md` for full API documentation.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Port 11650 or 11651 busy | Edit `quadlet/bookmark.pod`, change `PublishPort`, re-run `./scripts/install.sh` |
| API can't reach DB | Check `api/.env` — `DB_PASSWORD` must match `MARIADB_PASSWORD`; `DB_HOST` must be `127.0.0.1` |
| Extension can't reach API | Verify base URL in Options; check `host_permissions` in `extension/manifest.json` |
| Services not starting at boot | Run `loginctl enable-linger $USER` to enable linger for your user |
