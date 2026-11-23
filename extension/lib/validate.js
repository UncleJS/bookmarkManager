// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

/**
 * API Base URL validation helpers.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Plain http is only allowed to the local machine: the API token travels in
// every request, so remote APIs must use https.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @param {URL} url
 * @returns {boolean}
 */
export function isLoopbackUrl(url) {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Validates and normalizes an API base URL.
 *
 * @param {string} input
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateApiBaseUrl(input) {
  const trimmed = String(input ?? '').trim();

  if (!trimmed) {
    return { ok: false, error: 'API Base URL is required.' };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: 'Enter a valid URL, for example http://localhost:11650.',
    };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      error: 'Only http:// and https:// URLs are supported.',
    };
  }

  if (url.protocol === 'http:' && !isLoopbackUrl(url)) {
    return {
      ok: false,
      error: 'Use https:// for a remote API. Plain http:// is only allowed for localhost.',
    };
  }

  if (url.username || url.password) {
    return { ok: false, error: 'Do not put credentials in the API Base URL.' };
  }

  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');

  return { ok: true, value: url.toString().replace(/\/$/, '') };
}

/**
 * Normalizes a stored API base URL, returning null for invalid values.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeStoredApiBaseUrl(input) {
  const result = validateApiBaseUrl(input);
  return result.ok ? result.value : null;
}
