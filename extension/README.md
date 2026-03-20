# Bookmark Manager Chrome Extension

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Chrome Extension](https://img.shields.io/badge/Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![JavaScript](https://img.shields.io/badge/Language-JavaScript-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Bun](https://img.shields.io/badge/API%20Runtime-Bun-black?logo=bun)](https://bun.sh)

A Chrome Manifest V3 extension that captures bookmarks and sends them to a local API for storage and organization.

---

## Table of Contents

- [Features](#features)
  - [Bookmark Capture](#bookmark-capture)
  - [Organisation](#organisation)
  - [User Interface](#user-interface)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Load the extension in Chrome](#load-the-extension-in-chrome)
  - [Configure API URL](#configure-api-url-if-needed)
- [Architecture](#architecture)
  - [File/Folder Structure](#filefolder-structure)
  - [Key Components](#key-components)
- [Permissions](#permissions)
- [Data Flow](#data-flow)
  - [Quick Save](#quick-save)
  - [Full Save](#full-save-popup)
  - [Tag Autocomplete](#tag-autocomplete)
  - [Duplicate Detection](#duplicate-detection)
- [API Endpoints Used](#api-endpoints-used)
- [Edge Cases](#edge-cases)
- [Security Considerations](#security-considerations)

---

## Features

### Bookmark Capture

- **Quick Save**: Right-click context menu for instant bookmark saving
- **Full Save**: Detailed form with tags, subcategories, and metadata
- **Auto-fill**: Automatically captures page title, URL, and favicon
- **Duplicate Detection**: Highlights existing bookmarks with the same URL and prevents saving a second active bookmark with that URL

[↑ Table of Contents](#table-of-contents)

### Organisation

- **Sub-categories**: Hierarchical categorisation system with categories; each subcategory can have an optional description
- **Tags**: Flexible tagging with autocomplete and search
- **Flags**: Boolean properties — `readLater`, `hotTopic`, `cheatsheets`, `forReview`

[↑ Table of Contents](#table-of-contents)

### User Interface

- **Popup**: Main bookmark capture form
- **Context Menus**: Quick access from right-click menu
- **Options Page**: API base URL configuration
- **Notifications**: Success/error feedback

---

[↑ Table of Contents](#table-of-contents)

## Installation

### Prerequisites

The API pod must be running. From the repo root:

```bash
./scripts/install.sh   # first time
# or
./scripts/start.sh     # if already installed
```

Verify the API is up:

```bash
curl http://localhost:11650/health
# → {"status":"ok"}
```

[↑ Table of Contents](#table-of-contents)

### Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` directory from this repo
5. The extension icon appears in the toolbar

[↑ Table of Contents](#table-of-contents)

### Configure API URL (if needed)

The extension defaults to `http://localhost:11650`. To change it:

1. Right-click the extension icon → **Options**
2. Update the **API Base URL** field
3. Click **Save**

The configured API base URL is stored in `chrome.storage.local`, so it stays on the current machine instead of syncing across Chrome profiles or devices. Existing synced values are migrated the next time the extension reads the setting.

---

[↑ Table of Contents](#table-of-contents)

## Architecture

### File/Folder Structure

```
extension/
├── manifest.json           # Extension configuration (Manifest V3)
├── popup/
│   ├── popup.html          # Main capture form UI
│   ├── popup.js            # Form logic and API communication
│   └── popup.css           # Styling
├── background/
│   └── background.js       # Service worker — context menus, API calls, messaging
├── options/
│   ├── options.html        # Settings page
│   └── options.js          # Configuration management
├── lib/
│   ├── api.js              # fetch wrapper + error mapping
│   ├── dom.js              # DOM helpers
│   └── storage.js          # chrome.storage.local wrapper + migration
└── assets/
    └── icons/              # Extension icons
```

[↑ Table of Contents](#table-of-contents)

### Key Components

#### Service Worker (`background.js`)
- Registers context menus on install/activate
- **Quick Save**: captures active tab → POST `/bookmarks` → notification
- **Full Save**: opens popup programmatically (fallback to window if blocked)
- Centralises all API calls (reads base URL from storage, fetch with timeouts, error mapping)
- Message types: `fetchInitialData`, `createTag`, `createSubcategory`, `createBookmark`, `searchTags`

#### Popup (`popup.js`)
- On load: reads active tab, fetches subcategories + tag suggestions, populates form
- Sub-categories multi-select: category-grouped suggestions, removable chips, create new on the fly
- Tags multi-select: input + listbox, debounced API calls (250 ms), removable chips, create new on the fly
- Sub-category creation: inline affordance → name + optional description inputs → POST `/subcategories` → refresh dropdown
- Submission: validate → send via background message → disable button + loader → show success/error

#### API Library (`api.js`)
- HTTP request handling
- Error management and timeout handling
- Base URL configuration via `chrome.storage.local` with one-time migration from `chrome.storage.sync`

---

[↑ Table of Contents](#table-of-contents)

## Permissions

| Permission | Purpose |
|---|---|
| `tabs` | Read active tab URL and title |
| `activeTab` | Access current tab information |
| `contextMenus` | Add right-click menu items |
| `storage` | Save extension settings |
| `notifications` | Show success/error messages |
| `scripting` | Inject toast UI on demand in the active page |
| `host_permissions` | Access API at `http://localhost:11650/*` |

---

[↑ Table of Contents](#table-of-contents)

## Data Flow

### Quick Save

```
Right-click page
  → "Quick Save Bookmark" selected
  → background.js captures tab URL + title
  → POST /bookmarks with default flags
  → success/error notification
```

[↑ Table of Contents](#table-of-contents)

### Full Save (popup)

```
Click extension icon
  → popup.html opens
  → background.js fetches /subcategories + /tags
  → user fills form and submits
  → popup sends message to background.js
  → background.js POSTs to /bookmarks
  → success/error shown in popup
```

[↑ Table of Contents](#table-of-contents)

### Tag Autocomplete

```
User types in tag field
  → 250 ms debounce
  → background.js queries GET /tags?query=...
  → results populate dropdown
```

[↑ Table of Contents](#table-of-contents)

### Duplicate Detection

```
POST /bookmarks → API returns 409 with duplicates array
  → popup shows existing bookmarks
  → user reviews and closes the warning
  → UI prevents saving a second active bookmark with the same URL
```

---

[↑ Table of Contents](#table-of-contents)

## API Endpoints Used

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/subcategories` | Fetch categories with nested sub-categories for the dropdown |
| `GET` | `/tags?query=...` | Search tags with autocomplete |
| `POST` | `/tags` | Create a new tag on the fly |
| `POST` | `/subcategories` | Create a new subcategory on the fly (name + optional description) |
| `POST` | `/bookmarks` | Save a bookmark |

---

[↑ Table of Contents](#table-of-contents)

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Very long title/URL | Truncated in UI display; full value sent to API |
| Duplicate URL | `409` response → UI shows existing bookmarks → review and close the warning without creating another active bookmark |
| Large tag set | Top N matches fetched; paginated suggestions |
| API not configured | User prompted to open Options page |
| API failure / timeout | Error shown in popup; POST is not retried |
| Extension icon clicked on `chrome://` page | `activeTab` not available; graceful error shown |

---

[↑ Table of Contents](#table-of-contents)

## Security Considerations

- No authentication (single-user local deployment on trusted network)
- No always-on content scripts — toast UI is injected on demand only when needed
- No sensitive data stored in `chrome.storage`
- Input validation on both popup and API side

[↑ Table of Contents](#table-of-contents)

---

© 2026 Jaco Steyn — Licensed under CC BY-NC-SA 4.0
