/**
 * Chrome Storage Utilities
 *
 * Provides Promise-based wrappers around Chrome's storage APIs for managing
 * extension settings and configuration. Uses sync storage to persist data
 * across Chrome installations when the user is signed in.
 */

/**
 * Storage key for API base URL configuration
 */
const KEY = 'apiBaseUrl';

/**
 * Get API Base URL from Storage
 *
 * Retrieves the configured API base URL from Chrome sync storage.
 * Falls back to localhost if no custom URL is configured.
 *
 * @returns {Promise<string>} Promise resolving to the API base URL
 */
export async function getApiBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([KEY], (items) => {
      resolve(items[KEY] || 'http://localhost:3000');
    });
  });
}

/**
 * Set API Base URL in Storage
 *
 * Saves a custom API base URL to Chrome sync storage.
 * This allows users to configure the extension to connect to different API endpoints.
 *
 * @param {string} url - The API base URL to save
 * @returns {Promise<void>} Promise that resolves when the URL is saved
 */
export async function setApiBaseUrl(url) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [KEY]: url }, () => resolve());
  });
}

/**
 * Get Values from Sync Storage
 *
 * Generic helper to retrieve multiple values from Chrome sync storage.
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
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

/**
 * Set Values in Sync Storage
 *
 * Generic helper to save multiple key-value pairs to Chrome sync storage.
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
  return new Promise((resolve) => chrome.storage.sync.set(obj, resolve));
}
