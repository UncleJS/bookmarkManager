// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

import { describe, expect, test } from 'bun:test';

import { normalizeStoredApiBaseUrl, validateApiBaseUrl } from './validate.js';

describe('validateApiBaseUrl', () => {
  test('accepts http for localhost', () => {
    expect(validateApiBaseUrl('http://localhost:11650')).toEqual({
      ok: true,
      value: 'http://localhost:11650',
    });
  });

  test('accepts valid https urls and trims whitespace', () => {
    expect(validateApiBaseUrl('  https://api.example.com/v1/  ')).toEqual({
      ok: true,
      value: 'https://api.example.com/v1',
    });
  });

  test('normalizes trailing slashes', () => {
    expect(validateApiBaseUrl('http://localhost:11650///')).toEqual({
      ok: true,
      value: 'http://localhost:11650',
    });
  });

  test('accepts http for loopback addresses', () => {
    expect(validateApiBaseUrl('http://127.0.0.1:14650').ok).toBe(true);
    expect(validateApiBaseUrl('http://[::1]:11650').ok).toBe(true);
  });

  test('rejects plain http for remote hosts', () => {
    expect(validateApiBaseUrl('http://bookmarks.example.com')).toEqual({
      ok: false,
      error: 'Use https:// for a remote API. Plain http:// is only allowed for localhost.',
    });
    expect(validateApiBaseUrl('http://192.168.1.10:11650').ok).toBe(false);
    expect(validateApiBaseUrl('http://localhost.example.com').ok).toBe(false);
  });

  test('rejects credentials in the url', () => {
    expect(validateApiBaseUrl('https://user:pw@api.example.com').ok).toBe(false);
  });

  test('rejects empty values', () => {
    expect(validateApiBaseUrl('   ')).toEqual({
      ok: false,
      error: 'API Base URL is required.',
    });
  });

  test('rejects invalid urls', () => {
    expect(validateApiBaseUrl('not-a-url')).toEqual({
      ok: false,
      error: 'Enter a valid URL, for example http://localhost:11650.',
    });
  });

  test('rejects unsupported schemes', () => {
    expect(validateApiBaseUrl('ftp://example.com')).toEqual({
      ok: false,
      error: 'Only http:// and https:// URLs are supported.',
    });
  });
});

describe('normalizeStoredApiBaseUrl', () => {
  test('returns null for invalid stored values', () => {
    expect(normalizeStoredApiBaseUrl('example.com')).toBeNull();
  });
});
