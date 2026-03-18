/**
 * Chrome Storage Utilities
 *
 * Provides Promise-based wrappers around Chrome's storage APIs for managing
 * extension settings and configuration. Stores local machine configuration in
 * local storage and avoids syncing localhost-specific values across devices.
 */

import { normalizeStoredApiBaseUrl, validateApiBaseUrl } from './validate.js';

/**
 * Storage key for API base URL configuration
 */
const KEY = 'apiBaseUrl';
const DEFAULT_API_BASE_URL = 'http://localhost:11650';

function setLocalValue(value) {
  return new Promise((resolve) => chrome.storage.local.set({ [KEY]: value }, resolve));
}

function removeSyncValue() {
  return new Promise((resolve) => chrome.storage.sync.remove(KEY, resolve));
}

async function persistLocalValue(value) {
  await setLocalValue(value);
  await removeSyncValue();
}

/**
 * Get API Base URL from Storage
 *
 * Retrieves the configured API base URL from Chrome local storage.
 * Falls back to a one-time migration from sync storage before defaulting to localhost.
 *
 * @returns {Promise<string>} Promise resolving to the API base URL
 */
export async function getApiBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEY], async (localItems) => {
      const localUrl = normalizeStoredApiBaseUrl(localItems[KEY]);

      if (localUrl) {
        if (localItems[KEY] !== localUrl) {
          await persistLocalValue(localUrl);
        }
        resolve(localUrl);
        return;
      }

      chrome.storage.sync.get([KEY], async (syncItems) => {
        const syncedUrl = normalizeStoredApiBaseUrl(syncItems[KEY]);

        if (syncedUrl) {
          await persistLocalValue(syncedUrl);
          resolve(syncedUrl);
          return;
        }

        await persistLocalValue(DEFAULT_API_BASE_URL);
        resolve(DEFAULT_API_BASE_URL);
      });
    });
  });
}

/**
 * Set API Base URL in Storage
 *
 * Saves a custom API base URL to Chrome local storage.
 * This allows users to configure the extension to connect to different API endpoints.
 *
 * @param {string} url - The API base URL to save
 * @returns {Promise<void>} Promise that resolves when the URL is saved
 */
export async function setApiBaseUrl(url) {
  const result = validateApiBaseUrl(url);

  if (!result.ok) {
    throw new Error(result.error);
  }

  await persistLocalValue(result.value);
}

/**
 * Get Values from Local Storage
 *
 * Generic helper to retrieve multiple values from Chrome local storage.
 *
 * @param {string|string[]|Object} keys - Keys to retrieve from storage
 * @returns {Promise<Object>} Promise resolving to object with requested key-value pairs
 *
 * @example
 * // Get single key
 * const data = await getSync('myKey');
 *
 * @example
 * // Get multiple keys
 * const data = await getSync(['key1', 'key2']);
 */
export async function getSync(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

/**
 * Set Values in Local Storage
 *
 * Generic helper to save multiple key-value pairs to Chrome local storage.
 *
 * @param {Object} obj - Object with key-value pairs to save
 * @returns {Promise<void>} Promise that resolves when data is saved
 *
 * @example
 * // Save configuration
 * await setSync({
 *   theme: 'dark',
 *   autoSave: true
 * });
 */
export async function setSync(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
