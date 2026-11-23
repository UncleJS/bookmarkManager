// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

/**
 * The one date/time formatter for the extension.
 *
 * The API sends UTC timestamps (ISO 8601). They are shown in the viewer's
 * local time as `yyyy-MM-dd HH:mm:ss` (24-hour), never in a locale format.
 * The web UI has the same helper in api/src/ui/datetime.js; keep them in sync
 * (extension/lib/datetime.test.js checks that they agree).
 */

const pad = (n) => String(n).padStart(2, '0');

/** Parse an API timestamp. A value without a zone is taken as UTC. */
export function parseUtc(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (typeof value !== 'string' || value.trim() === '') return new Date(NaN);
  let s = value.trim();
  // "2026-11-08 14:05:09" (MariaDB style) -> ISO, and assume UTC when no zone.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  return new Date(s);
}

/** `yyyy-MM-dd HH:mm:ss` in local time, or '' for a missing/invalid value. */
export function formatDateTime(value) {
  const d = parseUtc(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `yyyy-MM-dd` in local time, or '' for a missing/invalid value. */
export function formatDate(value) {
  return formatDateTime(value).slice(0, 10);
}
