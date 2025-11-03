/**
 * Background Service Worker (Manifest V3)
 *
 * Handles core extension functionality including:
 * - Context menu management and interaction
 * - Tab information capture and processing
 * - API communication and error handling
 * - Notification management
 * - Inter-component messaging
 */

// Background service worker (MV3)
// Responsibilities: context menus, central API calls, messaging, notifications

import { getApiBaseUrl } from '../lib/storage.js';

/**
 * Context menu item identifiers
 * Used to distinguish between different menu actions
 */
const MENU_IDS = {
  QUICK: 'quick_save_bookmark',
  FULL: 'full_save_bookmark',
};

/**
 * Extension Installation/Update Handler
 *
 * Sets up context menus when the extension is installed or updated.
 * Clears any existing menus to prevent duplicates.
 */
chrome.runtime.onInstalled.addListener(async () => {
  // Clear existing context menus to prevent duplicates
  await chrome.contextMenus.removeAll().catch(() => {});

  // Create context menu items for bookmark saving
  chrome.contextMenus.create({
    id: MENU_IDS.QUICK,
    title: 'Quick Save Bookmark',
    contexts: ['page', 'selection', 'link']
  });
  chrome.contextMenus.create({
    id: MENU_IDS.FULL,
    title: 'Full Save Bookmark…',
    contexts: ['page', 'selection', 'link']
  });
});

/**
 * Context Menu Click Handler
 *
 * Processes context menu selections and triggers appropriate bookmark actions.
 * Handles both quick save (immediate) and full save (opens popup) operations.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_IDS.QUICK) {
    await handleQuickSave(tab);
  } else if (info.menuItemId === MENU_IDS.FULL) {
    await openFullSavePopup();
  }
});

/**
 * Quick Save Handler
 *
 * Immediately saves the current tab as a bookmark with default settings.
 * Used for rapid bookmark capture without user interaction.
 *
 * @param {chrome.tabs.Tab} tab - Current active tab information
 */
async function handleQuickSave(tab) {
  try {
    const t = tab || (await getActiveTab());

    // Prepare bookmark payload with default values
    const payload = {
      url: t.url,
      title: t.title || t.url,
      description: '',
      classificationIds: [],
      tags: [],
      flags: {
        forReview: true,      // Mark for later review
        readLater: false,
        hotTopic: false,
        cheatsheets: false,
        archived: false
      },
      faviconUrl: t.favIconUrl || null,
    };

    // Send bookmark to API with timeout
    await apiPost('/bookmarks', payload, { timeoutMs: 8000 });
    await notify('Bookmark saved', t.title || t.url, 'success');
  } catch (e) {
    await notify('Quick save failed', e.message || String(e), 'error');
  }
}

/**
 * Full Save Popup Handler
 *
 * Opens the extension popup for detailed bookmark capture.
 * Falls back to new tab if popup API is unavailable.
 */
async function openFullSavePopup() {
  try {
    // Try to open popup programmatically (preferred method)
    if (chrome.action && chrome.action.openPopup) {
      await chrome.action.openPopup();
      return;
    }
  } catch (e) {
    // Fallback: User must click the extension icon manually
    // Could implement tab-based fallback here if needed
  }
  const url = chrome.runtime.getURL('popup/popup.html');
  await chrome.windows.create({ url, type: 'popup', width: 420, height: 640 });
}

/**
 * Active Tab Retrieval
 *
 * Gets the currently active tab in the focused window.
 *
 * @returns {Promise<chrome.tabs.Tab>} - Promise resolving to the active tab object
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Notification Manager
 *
 * Displays simple notifications to the user.
 * Currently uses a fixed icon (blue square) for all notifications.
 *
 * @param {string} title - Notification title
 * @param {string} message - Notification message/body
 * @param {'info'|'success'|'warning'|'error'} type - Notification type (for styling or icons)
 */
async function notify(title, message, type) {
  // 48x48 blue square PNG base64
  const iconUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAQAAABz0wA9AAAAM0lEQVR4Ae3OIQEAMAgAsE/4/5lQw3Dg2wQ8f3gK2kJAAACg2bqUoQAAACg2bqUoQAAACg2bqUoQAA0c0D7o3kC0T2fQAAAABJRU5ErkJggg==';
  await chrome.notifications.create({
    type: 'basic',
    iconUrl,
    title,
    message,
  });
}

/**
 * Centralized API calls
 *
 * Provides a unified interface for making API requests to the backend service.
 * Handles common tasks like URL construction, error handling, and response parsing.
 */
async function apiBase() {
  const base = await getApiBaseUrl();
  return base?.replace(/\/$/, '') || 'http://localhost:3000';
}

async function apiFetch(path, { method = 'GET', body, headers = {}, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const url = (await apiBase()) + path;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  }).catch(err => {
    clearTimeout(id);
    throw err;
  });
  clearTimeout(id);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let data;
    try {
      data = await res.json();
      if (data && data.error) msg = data.error;
    } catch {}
    const e = new Error(msg);
    e.status = res.status;
    if (data !== undefined) e.data = data;
    throw e;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function apiGet(path, opts) { return apiFetch(path, { method: 'GET', ...(opts||{}) }); }
function apiPost(path, body, opts) { return apiFetch(path, { method: 'POST', body, ...(opts||{}) }); }

/**
 * Messaging API for popup
 *
 * Listens for messages from other parts of the extension (e.g., popup).
 * Handles various requests like fetching initial data, creating tags/classifications, and saving bookmarks.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'getInitialData': {
          const [tab, classifications, tags] = await Promise.all([
            getActiveTab(),
            apiGet('/classifications', { timeoutMs: 5000 }),
            apiGet('/tags?limit=20', { timeoutMs: 5000 }),
          ]);
          sendResponse({ ok: true, data: {
            tab: { url: tab?.url || '', title: tab?.title || '', faviconUrl: tab?.favIconUrl || '' },
            classifications,
            tags,
          }});
          break;
        }
        case 'createTag': {
          const res = await apiPost('/tags', { name: message.payload.name }, { timeoutMs: 8000 });
          sendResponse({ ok: true, data: res });
          break;
        }
        case 'createClassification': {
          const res = await apiPost('/classifications', message.payload, { timeoutMs: 8000 });
          sendResponse({ ok: true, data: res });
          break;
        }
        case 'saveBookmark': {
          const res = await apiPost('/bookmarks', message.payload, { timeoutMs: 8000 });
          sendResponse({ ok: true, data: res });
          break;
        }
        case 'searchTags': {
          const q = encodeURIComponent(message.payload.query || '');
          const limit = Math.min(50, Math.max(1, message.payload.limit || 20));
          const res = await apiGet(`/tags?query=${q}&limit=${limit}`, { timeoutMs: 5000 });
          sendResponse({ ok: true, data: res });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({
        ok: false,
        error: err?.message || String(err),
        status: err?.status,
        data: err?.data
      });
    }
  })();
  return true; // keep the channel open for async
});
