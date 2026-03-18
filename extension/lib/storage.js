/**
 * Chrome Storage Utilities
 *
 * Provides Promise-based wrappers around Chrome's storage APIs for managing
 * extension settings and configuration. Stores local machine configuration in
 * local storage and avoids syncing localhost-specific values across devices.
 */

/**
 * Storage key for API base URL configuration
 */
const KEY = 'apiBaseUrl';

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
    chrome.storage.local.get([KEY], (localItems) => {
      if (localItems[KEY]) {
        resolve(localItems[KEY]);
        return;
      }

      chrome.storage.sync.get([KEY], (syncItems) => {
        const syncedUrl = syncItems[KEY];

        if (!syncedUrl) {
          resolve('http://localhost:11650');
          return;
        }

        chrome.storage.local.set({ [KEY]: syncedUrl }, () => {
          chrome.storage.sync.remove(KEY, () => resolve(syncedUrl));
        });
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
  return new Promise((resolve) => {
    chrome.storage.local.set({ [KEY]: url }, () => {
      chrome.storage.sync.remove(KEY, () => resolve());
    });
  });
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
