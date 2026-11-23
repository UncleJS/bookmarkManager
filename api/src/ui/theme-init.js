// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

// Loaded as a blocking <script> in <head>, before any stylesheet paints, so
// the saved theme applies on the first frame (no flash). The CSP allows only
// same-origin scripts, which is why this is a file and not inline code.
// Dark is the default; the choice is saved in localStorage under "bm-theme".
(function () {
  var KEY = 'bm-theme';
  var root = document.documentElement;

  function saved() {
    try {
      var v = window.localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var next = theme === 'dark' ? 'light' : 'dark';
      b.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
      b.setAttribute('title', 'Switch to the ' + next + ' theme');
      b.setAttribute('aria-label', 'Switch to the ' + next + ' theme');
      b.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    }
  }

  apply(saved() || 'dark');

  function toggle() {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try { window.localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    apply(next);
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme') || 'dark');
  });
  document.addEventListener('click', function (event) {
    var t = event.target;
    if (t && t.closest && t.closest('[data-theme-toggle]')) toggle();
  });
  // Keep several open tabs in step.
  window.addEventListener('storage', function (event) {
    if (event.key === KEY) apply(saved() || 'dark');
  });
})();
