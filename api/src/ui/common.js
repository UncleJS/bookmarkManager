// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

// Shared helpers for the browser UI pages (app, categories, tags).
//
// Auth: the pages are only served after login (POST /session). The browser
// then holds an HttpOnly bm_session cookie with a random session id; page
// scripts never see the API token. When the session ends (logout, expiry,
// server restart) the API answers 401 and the page reloads, which shows the
// login form again.

function apiFetch(url, opts = {}) {
  return fetch(url, Object.assign({}, opts, { credentials: 'same-origin' })).then((res) => {
    if (res.status === 401) window.location.reload();
    return res;
  });
}

// Favicons: only http(s) URLs and data:image URIs are shown.
function isSafeFaviconUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32768) return false;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Event dispatch ────────────────────────────────────────────────────────
// The CSP forbids inline handlers, so markup names an action instead:
//   data-action="name"  click        data-change="name"  change
//   data-input="name"   input        data-enter="name"   Enter key
// Each page registers its actions with registerActions({ name(el, event) {} }).
const UI_ACTIONS = Object.create(null);

function registerActions(map) {
  Object.assign(UI_ACTIONS, map);
}

function dispatchAction(attr, event) {
  const target = event.target;
  const el = target && target.closest ? target.closest('[' + attr + ']') : null;
  if (!el) return;
  const action = UI_ACTIONS[el.getAttribute(attr)];
  if (action) action(el, event);
}

document.addEventListener('click',  (event) => dispatchAction('data-action', event));
document.addEventListener('change', (event) => dispatchAction('data-change', event));
document.addEventListener('input',  (event) => dispatchAction('data-input', event));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') dispatchAction('data-enter', event);
});

// Hide favicons that fail to load ('error' does not bubble, so capture it).
document.addEventListener('error', (event) => {
  const el = event.target;
  if (el && el.tagName === 'IMG' && el.classList.contains('card-favicon')) el.style.display = 'none';
}, true);

registerActions({
  logout: async () => {
    try {
      await fetch('/session', { method: 'DELETE', credentials: 'same-origin' });
    } finally {
      window.location.reload();
    }
  },
});
