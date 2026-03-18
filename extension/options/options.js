/**
 * Options Page Controller
 *
 * Handles the extension's options/settings page functionality including:
 * - Loading current API base URL and API token configuration
 * - Saving updated settings to Chrome storage
 * - Providing user feedback for configuration changes
 */
import { getApiBaseUrl, setApiBaseUrl, getApiToken, setApiToken } from '../lib/storage.js';

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
  el('apiBaseUrl').value = await getApiBaseUrl();
  el('apiToken').value = await getApiToken();
});

/**
 * Settings Save Handler
 *
 * Saves the updated API base URL and API token to Chrome storage and provides
 * visual feedback to the user.
 */
el('save').addEventListener('click', async () => {
  try {
    await setApiBaseUrl(el('apiBaseUrl').value);
    el('apiBaseUrl').value = await getApiBaseUrl();

    await setApiToken(el('apiToken').value.trim());

    showStatus('Saved');
  } catch (error) {
    showStatus(error?.message || 'Failed to save settings.', {
      success: false,
      timeoutMs: 4000,
    });
  }
});
