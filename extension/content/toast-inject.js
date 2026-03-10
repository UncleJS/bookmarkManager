/**
 * Toast Inject Content Script
 *
 * Listens for messages from the background service worker and displays
 * a floating toast notification on the current webpage.
 * Uses Shadow DOM to isolate styles from the host page.
 * Guarded against duplicate injection via window flag.
 */
if (!window.__bmToastInjected) {
  window.__bmToastInjected = true;

  (() => {
    'use strict';

    let hostEl = null;
    let shadowRoot = null;
    let hideTimer = null;

    const TOAST_DURATION = 2500;

    const STYLE = `
      :host {
        all: initial;
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: none;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 20px;
        border-radius: 8px;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: auto;
        opacity: 0;
        transform: translateX(40px);
        transition: opacity 0.25s ease, transform 0.25s ease;
        max-width: 360px;
        word-break: break-word;
      }
      .toast.show {
        opacity: 1;
        transform: translateX(0);
      }
      .toast.ok  { background: #059669; }
      .toast.err { background: #dc2626; }
    `;

    function ensureHost() {
      if (hostEl && document.body.contains(hostEl)) return;
      hostEl = document.createElement('bm-toast-host');
      shadowRoot = hostEl.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      shadowRoot.appendChild(style);
      document.body.appendChild(hostEl);
    }

    function showToast(message, ok) {
      ensureHost();

      // Clear any existing toast
      if (hideTimer) clearTimeout(hideTimer);
      const existing = shadowRoot.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast ' + (ok ? 'ok' : 'err');
      toast.textContent = message;
      shadowRoot.appendChild(toast);

      // Trigger reflow then animate in
      toast.offsetHeight; // eslint-disable-line no-unused-expressions
      toast.classList.add('show');

      hideTimer = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, TOAST_DURATION);
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'showToast') {
        showToast(msg.message, msg.ok);
      }
    });
  })();
}
