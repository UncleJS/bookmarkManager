/**
 * DOM Manipulation Utilities
 *
 * Provides lightweight helper functions for DOM operations and event handling.
 * These utilities simplify common tasks in the popup interface without requiring
 * external libraries like React or jQuery.
 */

/**
 * Create HTML Element Helper (hyperscript-style)
 *
 * Creates DOM elements with attributes and children in a functional style.
 * Supports event listeners, CSS classes, and nested element structures.
 *
 * @param {string} tag - HTML tag name (e.g., 'div', 'button', 'span')
 * @param {Object} [attrs={}] - Element attributes and properties
 * @param {string} [attrs.class] - CSS class names
 * @param {Function} [attrs.on*] - Event listeners (e.g., onclick, onchange)
 * @param {...(Node|string|Array)} children - Child elements or text content
 * @returns {HTMLElement} Created DOM element
 *
 * @example
 * // Create a button with click handler
 * const btn = h('button', {
 *   class: 'primary',
 *   onclick: () => console.log('clicked')
 * }, 'Click Me');
 *
 * @example
 * // Create nested structure
 * const card = h('div', { class: 'card' },
 *   h('h2', {}, 'Title'),
 *   h('p', {}, 'Content')
 * );
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  // Process attributes and properties
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') {
      el.className = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      // Convert onclick -> click, onchange -> change, etc.
      el.addEventListener(k.substring(2), v);
    } else if (v != null) {
      el.setAttribute(k, v);
    }
  }

  // Add children (elements or text nodes)
  for (const ch of children.flat()) {
    if (ch == null) continue;
    el.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  }

  return el;
}

/**
 * Debounce Function Utility
 *
 * Creates a debounced version of a function that delays execution until after
 * the specified wait time has passed since the last invocation. Useful for
 * limiting API calls during user input like search/autocomplete.
 *
 * @param {Function} fn - Function to debounce
 * @param {number} [wait=250] - Delay in milliseconds
 * @returns {Function} Debounced function
 *
 * @example
 * // Debounce search input to avoid excessive API calls
 * const debouncedSearch = debounce((query) => {
 *   searchAPI(query);
 * }, 300);
 *
 * input.addEventListener('input', (e) => {
 *   debouncedSearch(e.target.value);
 * });
 */
export function debounce(fn, wait = 250) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}
