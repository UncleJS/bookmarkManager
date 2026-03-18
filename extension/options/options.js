/**
 * Options Page Controller
 *
 * Handles the extension's options/settings page functionality including:
 * - Loading current API base URL configuration
 * - Saving updated API base URL settings
 * - Providing user feedback for configuration changes
 */
import { getApiBaseUrl, setApiBaseUrl } from '../lib/storage.js';

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
 * Populates the API URL input field with the stored value.
 */
window.addEventListener('DOMContentLoaded', async () => {
  // Load and display current API base URL
  el('apiBaseUrl').value = await getApiBaseUrl();
});

/**
 * Settings Save Handler
 *
 * Saves the updated API base URL to Chrome storage and provides
 * visual feedback to the user. Includes basic validation to ensure
 * the URL field is not empty.
 */
el('save').addEventListener('click', async () => {
  const input = el('apiBaseUrl');

  try {
    await setApiBaseUrl(input.value);
    input.value = await getApiBaseUrl();
    showStatus('Saved');
  } catch (error) {
    showStatus(error?.message || 'Failed to save API Base URL.', {
      success: false,
      timeoutMs: 4000,
    });
  }
});
