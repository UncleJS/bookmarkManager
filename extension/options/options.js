// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

/**
 * Options Page Controller
 *
 * Handles the extension's options/settings page functionality including:
 * - Loading current API base URL and API token configuration
 * - Saving updated settings to Chrome storage
 * - Providing user feedback for configuration changes
 */
import { getApiBaseUrl, setApiBaseUrl, getApiToken, setApiToken, InvalidApiBaseUrlError } from '../lib/storage.js';
import { validateApiBaseUrl } from '../lib/validate.js';

/**
 * Quick DOM element selector helper
 * @param {string} id - Element ID to select
 * @returns {HTMLElement} DOM element with the specified ID
 */
const el = (id) => document.getElementById(id);

let statusTimer;

function showStatus(message, { success = true, timeoutMs = 1500 } = {}) {
  const statusEl = el('status');
  clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.dataset.state = message ? (success ? 'success' : 'error') : '';

  if (message && timeoutMs > 0) {
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
      statusEl.dataset.state = '';
    }, timeoutMs);
  }
}

/**
 * Page Initialization Handler
 *
 * Loads current settings when the options page is opened.
 * Populates the API URL and API token input fields with stored values.
 */
window.addEventListener('DOMContentLoaded', async () => {
  try {
    el('apiBaseUrl').value = await getApiBaseUrl();
  } catch (error) {
    if (!(error instanceof InvalidApiBaseUrlError)) throw error;
    el('apiBaseUrl').value = error.storedValue;
    showStatus(error.reason, { success: false, timeoutMs: 15000 });
  }
  el('apiToken').value = await getApiToken();
});

/**
 * Settings Save Handler
 *
 * Saves the updated API base URL and API token to Chrome storage and provides
 * visual feedback to the user. A non-default origin needs an optional host permission.
 */
function requestApiOrigin(baseUrl) {
  const pattern = `${new URL(baseUrl).origin}/*`;
  if (pattern === 'http://localhost:11650/*') return Promise.resolve();

  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!granted) {
        reject(new Error('Browser permission for that API origin was not granted.'));
        return;
      }
      resolve();
    });
  });
}

el('save').addEventListener('click', async () => {
  try {
    // Validate and ask for the host permission first, while the click still
    // counts as a user gesture. Nothing is saved unless the permission is granted.
    const result = validateApiBaseUrl(el('apiBaseUrl').value);
    if (!result.ok) throw new Error(result.error);
    await requestApiOrigin(result.value);

    await setApiBaseUrl(result.value);
    el('apiBaseUrl').value = await getApiBaseUrl();
    await setApiToken(el('apiToken').value.trim());

    showStatus('Settings saved.');
  } catch (error) {
    showStatus(error?.message || 'Could not save settings.', {
      success: false,
      timeoutMs: 4000,
    });
  }
});
