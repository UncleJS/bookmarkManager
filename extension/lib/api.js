/**
 * API Communication Utility
 *
 * Provides a simple wrapper around Chrome extension messaging for communication
 * between popup and background script. This abstraction layer handles the
 * message passing required for API calls in Manifest V3 extensions.
 */

/**
 * Send Message to Background Script
 *
 * Sends a message to the background service worker and waits for a response.
 * This is the primary method for popup to request API operations, as the
 * background script handles all external HTTP requests.
 *
 * @param {string} type - Message type identifier (e.g., 'getInitialData', 'saveBookmark')
 * @param {any} [payload] - Optional message payload data
 * @returns {Promise<Object>} Promise resolving to background script response
 *
 * @example
 * // Get initial popup data
 * const response = await send('getInitialData');
 *
 * @example
 * // Save a bookmark
 * const response = await send('saveBookmark', {
 *   url: 'https://example.com',
 *   title: 'Example Site'
 * });
 */
export async function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      // Always read lastError to suppress Chrome's "unchecked runtime.lastError" warning.
      // If there's an error (e.g. no listener, background crashed), surface it as ok:false.
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message || 'Extension messaging error' });
        return;
      }
      resolve(res);
    });
  });
}
