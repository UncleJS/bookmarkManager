import { describe, expect, test } from 'bun:test';

import { normalizeStoredApiBaseUrl, validateApiBaseUrl } from './validate.js';

describe('validateApiBaseUrl', () => {
  test('accepts valid http urls', () => {
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
