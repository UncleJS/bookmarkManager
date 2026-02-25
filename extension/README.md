# Bookmark Manager Chrome Extension

A Chrome Manifest V3 extension that captures bookmarks and sends them to a local API for storage and organization.

## Features

### Bookmark Capture
- **Quick Save**: Right-click context menu for instant bookmark saving
- **Full Save**: Detailed form with tags, classifications, and metadata
- **Auto-fill**: Automatically captures page title, URL, and favicon
- **Duplicate Detection**: Highlights existing bookmarks with the same URL and lets you cancel or proceed with saving another copy

### Organisation
- **Classifications**: Hierarchical categorisation system with groups
- **Tags**: Flexible tagging with autocomplete and search
- **Flags**: Boolean properties — `readLater`, `hotTopic`, `cheatsheets`, `forReview`

### User Interface
- **Popup**: Main bookmark capture form
- **Context Menus**: Quick access from right-click menu
- **Options Page**: API base URL configuration
- **Notifications**: Success/error feedback

---

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

### Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` directory from this repo
5. The extension icon appears in the toolbar

### Configure API URL (if needed)

The extension defaults to `http://localhost:11650`. To change it:

1. Right-click the extension icon → **Options**
2. Update the **API Base URL** field
3. Click **Save**

---

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
│   └── storage.js          # chrome.storage.sync wrapper
└── assets/
    └── icons/              # Extension icons
```

### Key Components

#### Service Worker (`background.js`)
- Registers context menus on install/activate
- **Quick Save**: captures active tab → POST `/bookmarks` → notification
- **Full Save**: opens popup programmatically (fallback to window if blocked)
- Centralises all API calls (reads base URL from storage, fetch with timeouts, error mapping)
- Message types: `getInitialData`, `createTag`, `createClassification`, `saveBookmark`, `searchTags`

#### Popup (`popup.js`)
- On load: reads active tab, fetches classifications + tag suggestions, populates form
- Tags multi-select: input + listbox, debounced API calls (250 ms), removable chips, create new on the fly
- Classification creation: inline affordance → POST `/classifications` → refresh dropdown
- Submission: validate → send via background message → disable button + loader → show success/error

#### API Library (`api.js`)
- HTTP request handling
- Error management and timeout handling
- Base URL configuration via `chrome.storage.sync`

---

## Permissions

| Permission | Purpose |
|---|---|
| `tabs` | Read active tab URL and title |
| `activeTab` | Access current tab information |
| `contextMenus` | Add right-click menu items |
| `storage` | Save extension settings |
| `notifications` | Show success/error messages |
| `host_permissions` | Access API at `http://localhost:11650/*` |

---

## Data Flow

### Quick Save

```
Right-click page
  → "Quick Save Bookmark" selected
  → background.js captures tab URL + title
  → POST /bookmarks with default flags
  → success/error notification
```

### Full Save (popup)

```
Click extension icon
  → popup.html opens
  → background.js fetches /classifications + /tags
  → user fills form and submits
  → popup sends message to background.js
  → background.js POSTs to /bookmarks
  → success/error shown in popup
```

### Tag Autocomplete

```
User types in tag field
  → 250 ms debounce
  → background.js queries GET /tags?query=...
  → results populate dropdown
```

### Duplicate Detection

```
POST /bookmarks → API returns 409 with duplicates array
  → popup shows existing bookmarks
  → user cancels or confirms
  → if confirmed: re-POST with allowDuplicate: true
```

---

## API Endpoints Used

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/classifications` | Fetch classification groups for dropdown |
| `GET` | `/tags?query=...` | Search tags with autocomplete |
| `POST` | `/tags` | Create a new tag on the fly |
| `POST` | `/classifications` | Create a new classification on the fly |
| `POST` | `/bookmarks` | Save a bookmark |

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Very long title/URL | Truncated in UI display; full value sent to API |
| Duplicate URL | `409` response → UI shows existing bookmarks → cancel or proceed with `allowDuplicate: true` |
| Large tag set | Top N matches fetched; paginated suggestions |
| API not configured | User prompted to open Options page |
| API failure / timeout | Error shown in popup; POST is not retried |
| Extension icon clicked on `chrome://` page | `activeTab` not available; graceful error shown |

---

## Security Considerations

- No authentication (single-user local deployment on trusted network)
- No content scripts — page content is never read beyond URL and title
- No sensitive data stored in `chrome.storage`
- Input validation on both popup and API side

---

© 2026 Jaco Steyn — Licensed under CC BY-SA 4.0
