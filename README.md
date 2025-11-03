# Bookmark Manager (JavaScript)

This repo contains:
- Chrome Extension (MV3) to capture bookmarks
- Node.js API (Express + MariaDB) to store bookmarks, tags, and classifications

Everything is implemented in JavaScript (no TypeScript).

## Quick Start

### Dev environment (local API + dev DB in Docker)

- Start MariaDB only (dev compose):

```fish
cd api
docker compose up -d
```

- Prepare API env and run migrations:

```fish
cd api
cp -n .env.example .env
npm install
npm run migrate
```

- Start the API locally:

```fish
cd api
npm start
```

- Health check:

```fish
curl http://localhost:3000/health
```

- Optional: quick smoke test (no DB required):

```fish
cd api
npm run smoke
```

Notes:
- The dev DB listens on host port 3306. If you already have MySQL/MariaDB on 3306, change the port mapping in `api/docker-compose.yml`.
- The default `.env.example` points the API at `127.0.0.1:3306`, which works for the dev DB container.

### Production-like (API in a container, external DB)

- Create an API production env file:

```fish
cd api
cp .env.prod.example .env.prod
# edit .env.prod to point DB_* to your production/external database
```

- Build and run only the API container:

```fish
cd api
docker compose -f docker-compose.prod.yml up -d --build
```

- Health check:

```fish
curl http://localhost:3000/health
```

## Chrome Extension

- Load the extension:
  - Open chrome://extensions
  - Enable Developer mode
  - Click "Load unpacked" and select the `extension/` folder

- Configure API base URL:
  - Options → set `http://localhost:3000` (or your deployed API URL)

- Use:
  - Click the action icon for the popup (full save)
  - Right-click a page for context menus (Quick Save / Full Save)

## API Overview

- GET /health → `{ status: "ok" }`
- GET /classifications → grouped payload for optgroups
- POST /classifications → create classification (and group if provided)
- GET /tags?query=&limit=&offset=
- POST /tags → create tag
- POST /bookmarks → create bookmark

The API detects bookmarks that already exist for a URL and returns the matching records so the extension can warn users before they choose to save a duplicate. Tag names remain unique at the database level.

## Troubleshooting

- Dev DB port busy (3306): edit `api/docker-compose.yml` to map another host port.
- API can’t reach DB: verify `.env` matches your DB host/port/creds.
- Extension can’t reach API: set the correct base URL in Options and ensure `host_permissions` in `extension/manifest.json` includes your API origin.
