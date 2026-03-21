# Bookmark Manager Chrome Extension

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Chrome Extension](https://img.shields.io/badge/Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![JavaScript](https://img.shields.io/badge/Language-JavaScript-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

Chrome Manifest V3 extension for capturing bookmarks and sending them to the local Bun/Elysia API.

> **Full project documentation:** [`../README.md`](../README.md)

---

## Table of Contents

- [Setup](#setup)
- [Capture Methods](#capture-methods)
- [Popup Form](#popup-form)
- [Duplicate URL Handling](#duplicate-url-handling)
- [API Token](#api-token)
- [Architecture](#architecture)
- [Permissions](#permissions)
- [Edge Cases](#edge-cases)

---

## Setup

1. Start the API pod: `./scripts/start.sh` (from repo root)
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory
4. Right-click the extension icon → **Options**
5. Set **API Base URL** (default: `http://localhost:11650`) and **API Token** (value of `API_TOKEN` from `api/.env`)
6. Click **Save**

---

[↑ Table of Contents](#table-of-contents)

## Capture Methods

| Method | How | Behaviour |
|---|---|---|
| **Full Save** | Click the extension icon | Opens popup pre-filled with current tab URL, title, and favicon |
| **Quick Save** | Right-click → "Quick Save Bookmark" | Immediately `POST /bookmarks` with `forReview: true`; shows an in-page toast |
| **Full Save via menu** | Right-click → "Open bookmark form…" | Opens the popup programmatically (fallback: new popup window) |

---

[↑ Table of Contents](#table-of-contents)

## Popup Form

| Field | Behaviour |
|---|---|
| **URL** | Read-only, pre-filled from active tab |
| **Title** | Editable, pre-filled from active tab |
| **Description** | Multiline textarea |
| **Sub-categories** | Multi-select with category-grouped suggestions; supports sub-sub-category selection; removable chips; create new sub-category on the fly (name + optional description) |
| **Tags** | Multi-select with debounced autocomplete (250 ms); removable chips; create new tag on the fly |
| **Flags** | `readLater`, `hotTopic`, `cheatsheets`, `forReview` checkboxes |

Sub-sub-category selection is available when a sub-category that has sub-sub-categories is chosen. The level selector (sub-category / sub-sub-category) appears inline.

On submit: form is validated → message sent to background service worker → `POST /bookmarks` → success/error feedback shown in popup.

---

[↑ Table of Contents](#table-of-contents)

## Duplicate URL Handling

If the URL already has an active bookmark, the API returns `409` with a `duplicates` array. The popup surfaces the existing bookmarks for review without creating another active bookmark with the same URL. Archived bookmarks do not trigger the duplicate guard.

---

[↑ Table of Contents](#table-of-contents)

## API Token

The token is stored in `chrome.storage.local` (machine-local; never synced across Chrome profiles or devices). It is sent as `Authorization: Bearer <token>` on every API call from the background service worker.

To update: right-click the extension icon → **Options** → update **API Token** → **Save**.

If the token is wrong or missing, API calls return `401` and the popup shows an error.

---

[↑ Table of Contents](#table-of-contents)

## Architecture

```
extension/
├── manifest.json               # MV3 extension config
├── popup/
│   ├── popup.html              # Capture form UI
│   ├── popup.js                # Form logic, API messaging
│   └── popup.css
├── background/
│   └── background.js           # Service worker: context menus, API calls, messaging
├── options/
│   ├── options.html            # Settings page
│   └── options.js              # Save/load API base URL + token
├── content/
│   └── toast-inject.js         # On-demand toast injected into active page
├── lib/
│   ├── storage.js              # chrome.storage.local wrapper + sync migration
│   └── validate.js             # URL validation helpers
└── assets/icons/
```

**Background service worker** — all API calls are centralised here. Reads base URL and token from storage, applies timeouts, and maps errors. Registers context menus on install/activate.

**Message types handled by the service worker:**

| Type | Action |
|---|---|
| `fetchInitialData` | Gets active tab info + `GET /subcategories` + `GET /tags` |
| `createTag` | `POST /tags` |
| `createSubcategory` | `POST /subcategories` |
| `createSubSubcategory` | `POST /subSubcategories` |
| `createBookmark` | `POST /bookmarks` |
| `searchTags` | `GET /tags?query=...` |

**Storage** — settings are written to `chrome.storage.local`. A one-time migration from `chrome.storage.sync` runs on first read to move any previously synced values to local storage.

---

[↑ Table of Contents](#table-of-contents)

## Permissions

| Permission | Purpose |
|---|---|
| `tabs` | Read active tab URL and title |
| `activeTab` | Access current tab |
| `contextMenus` | Add right-click menu items |
| `storage` | Save extension settings |
| `notifications` | Fallback when toast injection is unavailable (e.g. `chrome://` pages) |
| `scripting` | On-demand toast injection into the active page |
| `host_permissions` | `http://localhost:11650/*` — configurable via Options |

---

[↑ Table of Contents](#table-of-contents)

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Very long title/URL | Truncated in UI display; full value sent to API |
| Duplicate URL | `409` → popup shows existing bookmarks → review without creating a duplicate |
| Large tag set | Top N matches fetched; paginated via `limit` param |
| API not configured | User prompted to open Options |
| API failure / timeout | Error shown; `POST` is not retried |
| Extension icon on `chrome://` page | `activeTab` unavailable; graceful error shown |
| Quick Save on `chrome://` page | Toast injection fails; falls back to OS notification |

[↑ Table of Contents](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-NC-SA 4.0
