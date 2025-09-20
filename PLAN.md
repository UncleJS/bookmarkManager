# Bookmark Manager — Project Plan (Planning-Only Document)

Status: Planning Only — Do NOT implement yet. This document is a precise blueprint that any person or AI can follow to implement the project end-to-end without additional context.


## 1) Goals and Non-Goals

- Goals
  - Build a Chrome extension to capture bookmarks and send them to a Node.js API backed by MariaDB.
  - Support a rich capture form (URL, Title, Description, Classification, Tags, Flags) with data pulled from the API.
  - Support quick-save and full-save via context menu.
  - Keep the extension implementation simple: vanilla HTML/CSS/JS (optional Tailwind via CDN).

- Non-Goals (initial release)
  - User management and multi-tenant accounts (assume a single-user deployment on a trusted network).
  - Offline sync/queueing; if the network fails, show an error (queueing may be a later enhancement).
  - Browser support beyond Chromium-based browsers.
  - Complex search UI in the extension (minimal interactions only).


## 2) High-Level Architecture

- Chrome Extension (Manifest V3)
  - Popup UI (form) for full bookmark capture.
  - Background Service Worker for context menus, tab info, API calls, and messaging.
  - Optional Options page for configuring API base URL.
- Node.js API (Express) + MariaDB
  - Endpoints for bookmarks, tags, and classifications.
  - No authentication or CORS in v1; input validation is performed on the frontend.
- Data Flow
  1) Popup opens ➜ background fetches classifications/tags ➜ UI populates dropdowns.
  2) User submits ➜ popup sends message to background ➜ background POSTs to API ➜ background returns success/error to popup ➜ UI feedback.
  3) Context menu "Quick Save" ➜ background captures active tab (url/title) ➜ POST to API with defaults ➜ notification.
  4) Context menu "Full Save" ➜ background opens the popup, pre-filled with url/title.


## 3) Functional Requirements

- Popup form fields
  - URL: read-only, pre-filled with current tab URL.
  - Title: editable, pre-filled with current tab title.
  - Description: multiline textarea.
  - Classification: single-select with grouped options (optgroup). Options loaded from API. Ability to create a new classification on the fly.
  - Tags: multi-select (vanilla JS). Options loaded from API with search/autocomplete. Ability to create new tags on the fly.
  - Flags (checkboxes): readLater, hotTopic, cheatsheets, archived.
  - Save button submits to API. Show success/error message.
- Context menus
  - "Quick Save Bookmark": immediately posts active tab url/title with defaults.
  - "Full Save Bookmark": opens popup with pre-filled url/title.
- Permissions and behavior
  - Access to active tab (url/title), context menus, notifications, storage, and API host permissions.
  - Handle network errors with clear user feedback.
- API
  - Provide endpoints to list/create classifications and tags, and to create bookmarks.
  - No auth or CORS; rely on frontend validation before sending.
  - Enforce unique constraints to prevent duplicate bookmarks by URL (DB-level).


## 4) Non-Functional Requirements

- Simplicity: vanilla JS for the extension.
- Performance: responsive popup (under 200ms UI operations, excluding network).
- Reliability: API with clear errors; DB constraints enforce uniqueness/relations.
- Security: no auth/CORS in v1; operate in a trusted environment or network. Minimize extension permissions. Document risks.
- Observability: API logging for requests and errors.


## 5) Chrome Extension Plan (Manifest V3)

### 5.1 Tech Choices
- HTML, CSS (optional Tailwind via CDN), JS (ES modules where useful).
- No frameworks for popup UI.

### 5.2 File/Folder Structure (extension)
- extension/
  - manifest.json
  - popup/
    - popup.html
    - popup.css (optional if using Tailwind CDN)
    - popup.js
  - background/
    - background.js (service worker)
  - options/
    - options.html (optional, for configuring API base URL)
    - options.js
  - assets/
    - icons/ (16, 32, 48, 128 png)
  - lib/
    - api.js (fetch wrapper)
    - dom.js (helpers for dropdowns/multi-select)
    - storage.js (wrapper over chrome.storage.sync)

### 5.3 Manifest (target: MV3)
- Key fields
  - name, description, version, manifest_version: 3
  - action: default_popup to popup/popup.html
  - background: service_worker: background/background.js, type: module
  - permissions: ["tabs", "activeTab", "contextMenus", "storage", "notifications"]
  - host_permissions: ["https://YOUR_API_HOST/*"]
  - icons: point to assets/icons

- Notes
  - "tabs" and/or "activeTab" are needed to read the active tab’s URL and title. Include both to avoid surprises.
  - host_permissions must include the API origin to allow fetch calls from background/popup.

### 5.4 Popup UI Behavior
- On load
  - Read active tab (url/title) via chrome.tabs.query.
  - Fetch classification list (grouped) and tag suggestions (initial page) from API.
  - Populate form elements. Use optgroup for classification grouping.
- Tags multi-select
  - Use a basic input + listbox approach:
    - Input field for search; debounce API calls (250ms).
    - Render suggestion list below; allow keyboard navigation.
    - Selected tags shown as removable chips.
    - Allow entry of a new tag name when no suggestion matches; on submit, create via API then include returned tag id.
- Classification creation on the fly
  - Provide an "Add new classification" affordance (button or last option).
  - On click, show a minimal inline form (name + optional group selection) or prompt.
  - Call POST /classifications; on success, refresh the classification dropdown and select the new one.
- Submission
  - Validate url, title and all inputs on the frontend.
  - Construct payload; include selected classificationId, tagIds, flags, and description.
  - Send message to background to perform POST /bookmarks. Disable button + show loading indicator.
  - On success, show a success state (e.g., toast or text) and close popup after a short delay (e.g., 1–2s). On error, show inline error with retry.

### 5.5 Background Service Worker Responsibilities
- Register context menus on install/activate.
- Handle context menu clicks:
  - Quick Save: get active tab, build minimal payload, call API, show notification on success/error.
  - Full Save: open the popup programmatically (chrome.action.openPopup). If blocked (environment restrictions), fallback to opening a window to popup/popup.html with query params.
- Centralize API calls
  - Read API base URL from chrome.storage.sync.
  - Implement fetch with timeouts (and optional light retries for idempotent GETs) and error mapping.
- Message passing
  - Listen for messages from popup (e.g., getInitialData, createTag, createClassification, saveBookmark) and respond with results or errors.

### 5.6 Permissions
- permissions: ["tabs", "activeTab", "contextMenus", "storage", "notifications"]
- host_permissions: ["https://YOUR_API_HOST/*"]

### 5.7 UX and Feedback
- Notifications for quick-save outcomes.
- Inline status in popup for full-save.
- Basic error messages for common issues (network, DB constraint conflict, etc.).

### 5.8 Edge Cases
- Very long titles or URLs: truncate in UI display but send full to API.
- Duplicate URL: API returns conflict; show message and offer to update or ignore (initially: show a simple "Already saved" info).
- Large tag set: paginate suggestions; only fetch top N matches.
- Empty API configuration: prompt user to open Options.
- API failure/timeouts: inform user; do not retry POST to avoid duplicates (unless idempotency key is added later).


## 6) API Plan (Node.js + MariaDB)

### 6.1 Tech Choices
- Node.js LTS, Express.js, mysql2/promise, pino (logging), dotenv.
- Optional: helmet (security headers); TypeScript recommended.

### 6.2 Project Structure (api/)
- api/
  - src/
    - app.ts (Express app config)
    - server.ts (bootstrap)
    - routes/
      - bookmarks.ts
      - tags.ts
      - classifications.ts
      - health.ts
    - db/
      - pool.ts (mysql2 pool)
      - migrations/ (SQL files)
      - queries/ (parameterized SQL)
    - middleware/
      - error.ts (error handler)
    - types/
      - index.ts (shared types/interfaces)
  - package.json, tsconfig.json (or use JS if preferred)
  - .env.example
  - Dockerfile, docker-compose.yml (MariaDB + API)

### 6.3 Environment Variables
- API_PORT (default 3000)
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

### 6.4 Authentication
- None in v1. API is assumed to run in a trusted environment/network.

### 6.5 Endpoints and Contracts
- Health
  - GET /health → 200 { status: "ok" }

- Classifications
  - GET /classifications
    - 200 { groups: [ { id, name, order, classifications: [ { id, name, order } ] } ] }
  - POST /classifications
    - Body: { name: string, groupId?: number, groupName?: string }
    - Creates group if groupName is provided and groupId is missing.
    - 201 { id, name, groupId }

- Tags
  - GET /tags?query=partial&limit=20&offset=0
    - 200 { items: [ { id, name } ], total }
  - POST /tags
    - Body: { name: string }
    - 201 { id, name }

- Bookmarks
  - POST /bookmarks
    - Body
      {
        url: string,
        title: string,
        description?: string,
        classificationId?: number,
        tags?: number[],
        flags?: { readLater?: boolean, hotTopic?: boolean, cheatsheets?: boolean, archived?: boolean },
        faviconUrl?: string
      }
    - 201 { id, url, title, createdAt }
    - Errors
      - 400 malformed input (e.g., invalid JSON)
      - 409 conflict (duplicate URL)

- Optional
  - GET /bookmarks?search=&tag=...&classificationId=... (basic listing)

### 6.6 Database Schema (MariaDB)
- Tables
  - classification_groups (id PK, name, order INT, created_at)
  - classifications (id PK, group_id FK, name, order INT, created_at)
  - tags (id PK, name UNIQUE, created_at)
  - bookmarks (id PK, url UNIQUE, title, description TEXT, classification_id FK NULL, favicon_url, read_later TINYINT, hot_topic TINYINT, cheatsheets TINYINT, archived TINYINT, created_at, updated_at)
  - bookmark_tags (bookmark_id FK, tag_id FK, PRIMARY KEY (bookmark_id, tag_id))

- Indexes
  - bookmarks.url UNIQUE
  - tags.name UNIQUE
  - FK indexes on join columns

- Notes
  - Use utf8mb4, proper collations.
  - TINYINT(1) for booleans.

### 6.7 Migrations
- Store SQL files in api/src/db/migrations with an id and description prefix (e.g., 001_init.sql).
- Provide a minimal migration runner script (Node) to apply in order and record applied migrations in a migrations table.

### 6.8 Validation and Error Handling
- Frontend performs input validation before calling the API.
- API performs minimal checks and relies on DB constraints. Standard error response shape: { error: string, details?: any }.

### 6.9 CORS
- Not enabled in v1. Chrome extension will communicate directly with the API (ensure network accessibility). No server-side CORS middleware.

### 6.10 Logging
- Use pino in JSON mode. Log method, path, status, duration, and errors.

### 6.11 Duplicate Handling
- Unique constraint on bookmarks.url.
- On conflict, return 409. Later enhancement: add an "upsert" query parameter to update existing records if desired.


## 7) Contracts and Example Payloads

- POST /bookmarks request example
```json
{
  "url": "https://example.com/article",
  "title": "Great Article",
  "description": "Why this is useful…",
  "classificationId": 3,
  "tags": [1, 4, 7],
  "flags": { "readLater": true, "hotTopic": false, "cheatsheets": false, "archived": false },
  "faviconUrl": "https://example.com/favicon.ico"
}
```
- POST /bookmarks 201 response
```json
{ "id": 123, "url": "https://example.com/article", "title": "Great Article", "createdAt": "2025-09-20T12:34:56Z" }
```
- GET /classifications response example
```json
{
  "groups": [
    { "id": 1, "name": "Work", "order": 1, "classifications": [ { "id": 10, "name": "Project A" } ] },
    { "id": 2, "name": "Personal", "order": 2, "classifications": [ { "id": 20, "name": "Learning" } ] }
  ]
}
```
- GET /tags response example
```json
{ "items": [ { "id": 1, "name": "javascript" }, { "id": 2, "name": "database" } ], "total": 2 }
```


## 8) Implementation Steps (Do Not Execute Yet)

- Phase 0 — Repo layout
  - Create folders: extension/, api/
  - Add PLAN.md (this file). Add LICENSE and basic README.

- Phase 1 — API (scaffold and DB)
  - Initialize Node project; add dependencies (express, mysql2, dotenv, pino).
  - Create db schema migrations and runner.
  - Implement routes: /health, /classifications, /tags, /bookmarks.
  - Add error handler.
  - Add basic tests for DB queries and endpoint responses.
  - Provide Docker Compose for MariaDB + API.

- Phase 2 — Extension (scaffold)
  - Create manifest.json (MV3) with permissions and host_permissions.
  - Implement background service worker: context menus, messaging, API wrapper, notifications.
  - Implement popup UI (HTML/CSS/JS) with form, data loading, multi-select tags, classification creation.
  - Implement options page to set API base URL (stored in chrome.storage.sync).
  - Wire popup to background for all network calls and do frontend validation.

- Phase 3 — QA and polishing
  - Manual test plan (below) and fix defects.
  - Performance checks (debounce, minimal reflows).
  - Accessibility pass (labels, keyboard nav for listbox).
  - Packaging instructions (.crx or Chrome Web Store items for later phase).


## 9) Manual Test Plan

- Configuration
  - Set API base URL via extension options; verify storage and retrieval.

- Popup
  - Open on any page; URL/title pre-filled.
  - Classifications load; groups render as optgroup; can create a new classification and it appears selected.
  - Tags: type to search, select multiple, remove chips, create new tag when none matches.
  - Flags toggle correctly; frontend validation triggers on missing/invalid data; Save posts; success message then closes.
  - Simulate API error (network/DB conflict) and verify error message.

- Context menus
  - Right-click → Quick Save; verify notification success and entry exists in DB.
  - Right-click → Full Save; popup opens with pre-filled values.

- Edge cases
  - Duplicate URL: verify 409 handling and UI message.
  - Long titles/urls: UI remains responsive.
  - No network: errors appear, no crash.


## 10) Security and Privacy Considerations
- No authentication or CORS in v1; operate in a trusted environment. Understand the risk of unauthenticated endpoints.
- Request only necessary extension permissions.
- No content scripts reading page content beyond URL/title.


## 11) Deployment Plan

- API
  - Docker image build and push.
  - MariaDB via managed service or Docker. Apply migrations.
  - Set environment variables securely.
  - Expose HTTPS with reverse proxy (e.g., Nginx) as appropriate.

- Extension
  - Development: load unpacked extension from extension/.
  - Production: prepare assets and versioning, submit to Chrome Web Store (later phase).


## 12) Risks and Mitigations
- MV3 constraints on background tasks → keep logic lightweight; avoid long-running operations.
- openPopup limitations → fallback to opening a window/tab if blocked.
- Large taxonomy (tags/classifications) → paginate and debounce; limit rendering to visible items.
- Unauthenticated, no-CORS API exposure → deploy only on trusted networks; consider adding auth later if exposed publicly.


## 13) Acceptance Criteria (Definition of Done)
- Extension
  - Popup loads, pre-fills, fetches options, validates inputs on the frontend, and saves bookmarks successfully.
  - Context menus work for quick and full save; user feedback via notifications.
  - Options page configures API base URL; values persist.
  - No console errors; permissions minimal and correct.

- API
  - All endpoints return correct status codes and integrate with DB as expected.
  - DB schema created; constraints and indexes in place.
  - Logs available for requests and errors.


## 14) Glossary
- Quick Save: one-click save of url/title with default flags and no description, tags, or classification.
- Full Save: user completes the form in the popup before saving.
- Classification: a single category; grouped under a Classification Group for UI optgroup display.
- Tags: multiple labels that can be attached to bookmarks.


## 15) Appendix — Pseudo/Skeleton References (for implementers)

- manifest.json skeleton (do not copy verbatim; fill placeholders)
```json
{
  "manifest_version": 3,
  "name": "Bookmark Capture",
  "version": "0.1.0",
  "description": "Capture bookmarks to an API",
  "action": { "default_popup": "popup/popup.html" },
  "background": { "service_worker": "background/background.js", "type": "module" },
  "permissions": ["tabs", "activeTab", "contextMenus", "storage", "notifications"],
  "host_permissions": ["https://YOUR_API_HOST/*"],
  "icons": { "16": "assets/icons/icon16.png", "48": "assets/icons/icon48.png", "128": "assets/icons/icon128.png" }
}
```

- Background message types (example)
```ts
// Message envelope (TypeScript example)
export type BgMessage =
  | { type: "getInitialData" }
  | { type: "createTag"; payload: { name: string } }
  | { type: "createClassification"; payload: { name: string; groupId?: number; groupName?: string } }
  | { type: "saveBookmark"; payload: BookmarkPayload };
```

- Example background message instance (JSON)
```json
{ "type": "getInitialData" }
```

- Quick Save defaults
  - description: ""
  - classificationId: null
  - tags: []
  - flags: { readLater: true, hotTopic: false, cheatsheets: false, archived: false }

- Recommended debounce for tag search: 250ms

- Timeouts
  - GET: 5s; POST: 8s (tunable).

- HTTP status handling
  - 2xx: success; 4xx: show user-facing message; 5xx: show retry suggestion.


## 16) Open Questions (if needed for later phases)
- Should Quick Save set readLater=true by default? (Assumed yes.)
- Should duplicate URL upsert be allowed behind a flag? (Later.)
- Do we need export/import of bookmarks? (Out of scope for v1.)

