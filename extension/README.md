# Bookmark Manager Chrome Extension

A Chrome Manifest V3 extension that captures bookmarks and sends them to a local API for storage and organization.

## Features

### Bookmark Capture
- **Quick Save**: Right-click context menu for instant bookmark saving
- **Full Save**: Detailed form with tags, classifications, and metadata
- **Auto-fill**: Automatically captures page title, URL, and favicon
- **Duplicate Detection**: Highlights existing bookmarks with the same URL and lets you cancel or proceed with saving another copy

### Organization System
- **Classifications**: Hierarchical categorization system with groups
- **Tags**: Flexible tagging with autocomplete and search
- **Flags**: Boolean properties (read later, hot topic, cheatsheets, archived, for review)

### User Interface
- **Popup**: Main bookmark capture form
- **Context Menus**: Quick access from right-click menu
- **Options Page**: API configuration and settings
- **Notifications**: Success/error feedback

## Architecture

### Manifest V3 Structure
```
extension/
├── manifest.json           # Extension configuration
├── popup/
│   ├── popup.html         # Main capture form UI
│   ├── popup.js           # Form logic and API communication
│   └── popup.css          # Styling
├── background/
│   └── background.js      # Service worker for context menus and API calls
├── options/
│   ├── options.html       # Settings page
│   └── options.js         # Configuration management
├── lib/
│   ├── api.js            # API communication utilities
│   ├── dom.js            # DOM manipulation helpers
│   └── storage.js        # Chrome storage utilities
└── assets/
    └── icons/            # Extension icons
```

### Key Components

#### Service Worker (background.js)
- Manages context menus
- Handles tab information capture
- Performs API calls
- Shows notifications
- Manages inter-component messaging

#### Popup Interface (popup.js)
- Form validation and submission
- Dynamic UI updates
- Tag and classification management
- Real-time search and autocomplete

#### API Library (api.js)
- HTTP request handling
- Error management
- Timeout handling
- Base URL configuration

## Permissions

- `tabs`: Access current tab URL and title
- `activeTab`: Read active tab information
- `contextMenus`: Add right-click menu items
- `storage`: Save extension settings
- `notifications`: Show success/error messages
- `host_permissions`: Access to API endpoint (localhost:3000)

## Data Flow

### Quick Save Flow
1. User right-clicks → Context menu appears
2. "Quick Save" selected → Background script captures tab info
3. Background script sends bookmark to API with default flags
4. API response triggers success/error notification

### Full Save Flow
1. User clicks extension icon → Popup opens
2. Popup requests classifications/tags from background script
3. Background script fetches data from API
4. User fills form and submits
5. Popup sends data to background script
6. Background script posts to API and shows result

### Auto-complete Flow
1. User types in tag/classification field
2. Popup debounces input and requests filtered data
3. Background script queries API with search term
4. Results populate dropdown for selection

## API Integration

The extension communicates with the Node.js API via:
- `GET /classifications` - Fetch classification groups
- `GET /tags?query=...` - Search tags with autocomplete
- `POST /bookmarks` - Create new bookmark
- `POST /tags` - Create new tag
- `POST /classifications` - Create new classification

## Installation

1. Open Chrome Extensions page (`chrome://extensions/`)
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` directory
5. Configure API URL in extension options if needed

## Configuration

### API Base URL
The extension defaults to `http://localhost:3000` but can be configured:
1. Right-click extension icon → "Options"
2. Update "API Base URL" field
3. Save changes

### Development
- Uses `console.log` for debugging (visible in extension popup DevTools)
- Error handling with user-friendly messages
- Graceful degradation when API is unavailable

## Security Considerations

- No authentication implemented (single-user local deployment)
- CORS handling managed by API configuration
- Input validation on both client and server side
- No sensitive data stored in extension storage
