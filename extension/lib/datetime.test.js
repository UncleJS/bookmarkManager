// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

// Run with a non-UTC zone and the en-US locale, e.g.
//   TZ=America/New_York LANG=en_US.UTF-8 bun test lib/datetime.test.js
import { describe, expect, test } from 'bun:test';

import { formatDate, formatDateTime, parseUtc } from './datetime.js';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('formatDateTime', () => {
  test('shows UTC input as local yyyy-MM-dd HH:mm:ss', () => {
    const iso = '2026-11-08T14:05:09Z';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    expect(formatDateTime(iso)).toBe(expected);
    expect(formatDateTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test.skipIf(ZONE !== 'America/New_York')('converts to the local zone (run with TZ=America/New_York)', () => {
    expect(formatDateTime('2026-11-08T14:05:09Z')).toBe('2026-11-08 09:05:09');
    expect(formatDateTime('2026-07-01T23:30:00Z')).toBe('2026-07-01 19:30:00');
    expect(formatDateTime('2026-11-08T02:00:00Z')).toBe('2026-11-07 21:00:00');
  });

  test('uses a 24-hour clock without AM/PM or locale separators', () => {
    const out = formatDateTime('2026-11-08T22:05:09Z');
    expect(out).not.toMatch(/AM|PM|\//i);
  });

  test('treats zone-less and MariaDB-style values as UTC', () => {
    expect(parseUtc('2026-11-08 14:05:09').toISOString()).toBe('2026-11-08T14:05:09.000Z');
    expect(parseUtc('2026-11-08T14:05:09').toISOString()).toBe('2026-11-08T14:05:09.000Z');
    expect(parseUtc('2026-11-08T14:05:09.123Z').toISOString()).toBe('2026-11-08T14:05:09.123Z');
    expect(parseUtc('2026-11-08T16:05:09+02:00').toISOString()).toBe('2026-11-08T14:05:09.000Z');
  });

  test('returns empty for missing or invalid values', () => {
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('');
    expect(formatDate(null)).toBe('');
  });

  test('formatDate gives yyyy-MM-dd', () => {
    expect(formatDate('2026-11-08T12:00:00Z')).toMatch(/^2026-11-0[78]$/);
  });
});

// The web UI keeps a classic-script copy of this helper. Load it and check
// that both give the same output.
describe('web UI copy (api/src/ui/datetime.js)', () => {
  const path = new URL('../../api/src/ui/datetime.js', import.meta.url);
  const file = Bun.file(path);

  test('formats exactly like the extension helper', async () => {
    expect(await file.exists()).toBe(true);
    const src = await file.text();
    const BMDate = new Function(`${src}\nreturn BMDate;`)();
    const samples = [
      '2026-11-08T14:05:09Z', '2026-07-01T23:30:00Z', '2026-11-08 14:05:09',
      '2026-11-08T16:05:09+02:00', '2026-03-08T07:00:00.000Z', '', 'bad', null, undefined,
    ];
    for (const s of samples) {
      expect(BMDate.formatDateTime(s)).toBe(formatDateTime(s));
      expect(BMDate.formatDate(s)).toBe(formatDate(s));
    }
  });
});
