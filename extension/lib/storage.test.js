import { beforeEach, describe, expect, it } from 'bun:test';

function area(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: (items, cb) => { Object.assign(data, items); cb?.(); },
    remove: (key, cb) => { delete data[key]; cb?.(); },
  };
}

let local;
let sync;
beforeEach(() => {
  local = area();
  sync = area();
  globalThis.chrome = { storage: { local, sync } };
});

const { getApiBaseUrl, InvalidApiBaseUrlError } = await import('./storage.js');

describe('getApiBaseUrl', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await getApiBaseUrl()).toBe('http://localhost:11650');
  });

  it('returns a valid stored https URL', async () => {
    local.data.apiBaseUrl = 'https://bm.example.com/';
    expect(await getApiBaseUrl()).toBe('https://bm.example.com');
  });

  it('keeps a no-longer-allowed http remote URL and rejects instead of using localhost', async () => {
    local.data.apiBaseUrl = 'http://nas.lan:11650';
    const error = await getApiBaseUrl().catch((e) => e);
    expect(error).toBeInstanceOf(InvalidApiBaseUrlError);
    expect(error.storedValue).toBe('http://nas.lan:11650');
    expect(local.data.apiBaseUrl).toBe('http://nas.lan:11650');
  });
});
