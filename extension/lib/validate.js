/**
 * API Base URL validation helpers.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

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
