/**
 * Popup Interface Controller
 *
 * Main user interface for the bookmark manager extension popup.
 * Handles the complete bookmark capture workflow including:
 * - Form initialization and data loading
 * - Tag and sub-category management with autocomplete
 * - Dynamic UI updates and chip-based selection display
 * - Real-time search and filtering
 * - Form validation and submission
 * - Modal dialogs for creating new items
 */
import { send } from '../lib/api.js';
import { h, debounce } from '../lib/dom.js';

/**
 * Quick DOM element selector helper
 * @param {string} id - Element ID to select
 * @returns {HTMLElement} DOM element with the specified ID
 */
const el = (id) => document.getElementById(id);

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Application State Management
 *
 * Centralized state object that tracks all dynamic data in the popup interface.
 * This includes selected items, available options, UI state flags, and cached data.
 */
let state = {
  selectedTags: [], // Array of selected tag objects: { id, name }
  selectedSubcategories: [], // Array of selected taxonomy objects: { id, name, kind, categoryName, subcategoryName }
  allSubcategories: [], // All available sub-categories with categories from API
  filteredSubcategories: [], // Filtered sub-categories for display in search
  tagSuggestions: [], // Tag suggestions for autocomplete dropdown
  existingCategories: [], // Available categories for the sub-category modal: { id, name }
  existingParentSubcategories: [], // Available parent sub-categories for creating sub-sub-categories
  prefetchedTags: [], // Cache for prefetched tag results
  hasSubcategoriesPrefetched: false, // Track if sub-categories are loaded
  hasTagsPrefetched: false, // Track if initial tags are loaded
  pendingDuplicate: null, // Store duplicate entries requiring confirmation
  faviconUrl: '', // Active tab favicon for full-save payload
  visibleSubcategories: [], // Currently rendered sub-category suggestions
  activeSubcategoryIndex: -1, // Keyboard-selected sub-category suggestion
  activeTagIndex: -1, // Keyboard-selected tag suggestion
  lastFocusedElement: null, // Previously focused element before modal open
};

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((node) => {
    return !node.hasAttribute('hidden') && !node.closest('.hidden');
  });
}

function queueLiveRegionText(node, text) {
  if (!node) return;
  node.textContent = '';
  if (!text) return;
  window.setTimeout(() => {
    node.textContent = text;
  }, 0);
}

function getSuggestionId(type, index) {
  return `${type}-suggestion-${index}`;
}

function updateListboxState(inputId, containerId, activeIndex) {
  const input = el(inputId);
  const container = el(containerId);
  if (!input || !container) return;

  const isExpanded = !container.classList.contains('hidden');
  input.setAttribute('aria-expanded', String(isExpanded));

  const activeId = activeIndex >= 0 ? getSuggestionId(containerId, activeIndex) : '';
  if (activeId) {
    input.setAttribute('aria-activedescendant', activeId);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function updateActiveSuggestion(containerId, activeIndex) {
  const options = Array.from(el(containerId)?.querySelectorAll('[role="option"]') || []);
  options.forEach((option, index) => {
    const isActive = index === activeIndex;
    option.classList.toggle('active', isActive);
    option.setAttribute('aria-selected', String(isActive));
    if (isActive) {
      option.scrollIntoView({ block: 'nearest' });
    }
  });
}

/**
 * Create Chip Component
 *
 * Creates a removable chip UI element for displaying selected tags/sub-categories.
 * Chips show the selected item name and include a remove button with click handler.
 *
 * @param {string} text - Display text for the chip
 * @param {Function} onRemove - Callback function when remove button is clicked
 * @param {boolean} [isSubcategory=false] - Whether this is a sub-category chip (affects styling)
 * @returns {HTMLElement} Chip DOM element with remove functionality
 */
function createChip(text, onRemove, isSubcategory = false) {
  const chip = document.createElement('span');
  chip.className = `chip ${isSubcategory ? 'chip-subcategory' : ''}`;
  chip.innerHTML = `
    ${text}
    <button type="button" class="chip-remove" title="Remove">
      <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
      </svg>
    </button>
  `;
  const removeButton = chip.querySelector('.chip-remove');
  removeButton.setAttribute('aria-label', `Remove ${text}`);
  removeButton.addEventListener('click', onRemove);
  return chip;
}

/**
 * Render Selected Sub-categories
 *
 * Updates the DOM to display all currently selected sub-categories as chips.
 * Each chip shows the category name and sub-category name in hierarchical format.
 * Clears existing chips and rebuilds the entire list.
 */
function renderSelectedSubcategories() {
  const container = el('selected-subcategories');
  container.innerHTML = '';

  state.selectedSubcategories.forEach(subcategory => {
    // Format display text with category hierarchy if available
    const chipText = [subcategory.categoryName, subcategory.subcategoryName, subcategory.name]
      .filter(Boolean)
      .join(' → ');

    const chip = createChip(chipText, () => removeSubcategory(`${subcategory.kind}:${subcategory.id}`), true);
    container.appendChild(chip);
  });
}

/**
 * Remove Sub-category Handler
 *
 * Removes a sub-category from the selected list and updates the UI.
 *
 * @param {number} id - Sub-category ID to remove
 */
function removeSubcategory(id) {
  state.selectedSubcategories = state.selectedSubcategories.filter(c => `${c.kind}:${c.id}` !== id);
  renderSelectedSubcategories();
}

/**
 * Add Sub-category Handler
 *
 * Adds a sub-category to the selected list and updates the UI.
 * Ensures no duplicates are added.
 *
 * @param {Object} subcategory - Sub-category object to add
 */
function addSubcategory(subcategory) {
  if (!state.selectedSubcategories.some(c => `${c.kind}:${c.id}` === `${subcategory.kind}:${subcategory.id}`)) {
    state.selectedSubcategories.push(subcategory);
    renderSelectedSubcategories();
  }
  el('subcategory-search').value = '';
  hideSubcategorySuggestions();
}

/**
 * Render Sub-category Suggestions
 *
 * Displays a dropdown of subcategory suggestions based on user search input.
 * Suggestions are grouped by category with headers.
 *
 * @param {Array} subcategories - Array of subcategory objects to display
 */
function renderSubcategorySuggestions(subcategories) {
  const container = el('subcategory-suggestions');
  container.innerHTML = '';
  state.visibleSubcategories = subcategories;
  state.activeSubcategoryIndex = -1;

  if (subcategories.length === 0) {
    hideSubcategorySuggestions();
    return;
  }

  // Group sub-categories by category name
  const groupedByCategory = {};
  subcategories.forEach(c => {
    const categoryName = c.subcategoryName
      ? `${c.categoryName || 'Uncategorized'} → ${c.subcategoryName}`
      : (c.categoryName || 'Uncategorized');
    if (!groupedByCategory[categoryName]) groupedByCategory[categoryName] = [];
    groupedByCategory[categoryName].push(c);
  });

  // Render categories
  let optionIndex = 0;
  Object.entries(groupedByCategory).forEach(([categoryName, items]) => {
    // Add category header
    const header = document.createElement('div');
    header.className = 'category-header';
    header.textContent = categoryName;
    container.appendChild(header);

    // Add category items
    items.forEach(subcategory => {
      const item = document.createElement('div');
      item.className = 'suggestion';
      item.textContent = subcategory.subcategoryName ? `→ ${subcategory.name}` : subcategory.name;
      item.id = getSuggestionId('subcategory-suggestions', optionIndex);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.addEventListener('click', () => addSubcategory(subcategory));
      container.appendChild(item);
      optionIndex += 1;
    });
  });

  showSubcategorySuggestions();
}

/**
 * Show Sub-category Suggestions
 *
 * Reveals the subcategory suggestions dropdown.
 */
function showSubcategorySuggestions() {
  el('subcategory-suggestions').classList.remove('hidden');
  updateListboxState('subcategory-search', 'subcategory-suggestions', state.activeSubcategoryIndex);
}

/**
 * Hide Sub-category Suggestions
 *
 * Hides the subcategory suggestions dropdown and resets the prefetched state.
 */
function hideSubcategorySuggestions() {
  el('subcategory-suggestions').classList.add('hidden');
  state.hasSubcategoriesPrefetched = false;
  state.visibleSubcategories = [];
  state.activeSubcategoryIndex = -1;
  updateListboxState('subcategory-search', 'subcategory-suggestions', state.activeSubcategoryIndex);
}

/**
 * Filter Sub-categories
 *
 * Filters the available subcategories based on user search query.
 * Excludes already selected subcategories from the results.
 *
 * @param {string} query - Search query string
 */
function filterSubcategories(query) {
  const filtered = state.allSubcategories.filter(c => {
    const lower = query.toLowerCase();
    const nameMatch = c.name.toLowerCase().includes(lower);
    const categoryMatch = c.categoryName && c.categoryName.toLowerCase().includes(lower);
    const subcategoryMatch = c.subcategoryName && c.subcategoryName.toLowerCase().includes(lower);
    const notSelected = !state.selectedSubcategories.some(selected => `${selected.kind}:${selected.id}` === `${c.kind}:${c.id}`);
    return (nameMatch || categoryMatch || subcategoryMatch) && notSelected;
  });

  state.filteredSubcategories = filtered;
  renderSubcategorySuggestions(filtered.slice(0, 20)); // Limit to 20 results
}

/**
 * Render Selected Tags
 *
 * Updates the DOM to display all currently selected tags as chips.
 * Clears existing chips and rebuilds the entire list.
 */
function renderSelectedTags() {
  const container = el('selected-tags');
  container.innerHTML = '';

  state.selectedTags.forEach(tag => {
    const chip = createChip(tag.name, () => removeTag(tag.id));
    container.appendChild(chip);
  });
}

/**
 * Remove Tag Handler
 *
 * Removes a tag from the selected list and updates the UI.
 *
 * @param {number} id - Tag ID to remove
 */
function removeTag(id) {
  state.selectedTags = state.selectedTags.filter(t => t.id !== id);
  renderSelectedTags();
}

/**
 * Add Tag Handler
 *
 * Adds a tag to the selected list and updates the UI.
 * Ensures no duplicates are added.
 *
 * @param {Object} tag - Tag object to add
 */
function addTag(tag) {
  if (!state.selectedTags.some(t => t.id === tag.id)) {
    state.selectedTags.push(tag);
    renderSelectedTags();
  }
  el('tag-input').value = '';
  renderTagSuggestions([]);
}

/**
 * Render Tag Suggestions
 *
 * Displays a dropdown of tag suggestions based on user input.
 *
 * @param {Array} tags - Array of tag objects to display
 */
function renderTagSuggestions(tags) {
  const container = el('tag-suggestions');
  state.tagSuggestions = tags;
  state.activeTagIndex = -1;
  container.innerHTML = '';

  if (tags.length === 0) {
    hideTagSuggestions();
    return;
  }

  tags.forEach((tag, index) => {
    const li = document.createElement('li');
    li.className = 'suggestion';
    li.textContent = tag.name;
    li.id = getSuggestionId('tag-suggestions', index);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.addEventListener('click', () => addTag(tag));
    container.appendChild(li);
  });

  container.classList.remove('hidden');
  updateListboxState('tag-input', 'tag-suggestions', state.activeTagIndex);
}

function hideTagSuggestions() {
  const container = el('tag-suggestions');
  if (!container) return;
  container.classList.add('hidden');
  state.activeTagIndex = -1;
  updateListboxState('tag-input', 'tag-suggestions', state.activeTagIndex);
}

/**
 * Modal functions
 */

/**
 * Show Modal
 *
 * Displays the modal dialog for creating a new sub-category.
 * Populates existing categories dropdown and sets up event handlers.
 */
function showModal() {
  const modal = el('subcategory-modal');
  state.lastFocusedElement = document.activeElement;
  modal.classList.remove('hidden');

  // Populate existing categories dropdown
  const categoriesSelect = el('modal-existing-categories');
  categoriesSelect.innerHTML = '<option value="">Select a category</option>';
  state.existingCategories.forEach(category => {
    const option = document.createElement('option');
    option.value = String(category.id);
    option.textContent = category.name;
    categoriesSelect.appendChild(option);
  });

  const parentSelect = el('modal-parent-subcategory');
  parentSelect.innerHTML = '<option value="">Select a parent sub-category</option>';
  state.existingParentSubcategories.forEach(item => {
    const option = document.createElement('option');
    option.value = String(item.id);
    option.textContent = item.label;
    parentSelect.appendChild(option);
  });

  document.addEventListener('keydown', onModalKeydown);

  // Focus on the name input
  setTimeout(() => el('modal-subcategory-name').focus(), 100);

  // Show/hide existing categories option based on availability
  const existingRadio = document.querySelector('input[name="category-option"][value="existing"]');
  const existingLabel = existingRadio.closest('.radio-label');
  if (state.existingCategories.length === 0) {
    existingRadio.disabled = true;
    existingLabel.style.opacity = '0.5';
  } else {
    existingRadio.disabled = false;
    existingLabel.style.opacity = '1';
  }
}

/**
 * Hide Modal
 *
 * Hides the modal dialog and resets its form fields.
 */
function hideModal() {
  const modal = el('subcategory-modal');
  modal.classList.add('hidden');
  document.removeEventListener('keydown', onModalKeydown);

  // Reset form
  el('modal-subcategory-name').value = '';
  el('modal-subcategory-description').value = '';
  el('modal-new-category-name').value = '';
  el('modal-parent-subcategory').value = '';
  document.querySelector('input[name="category-option"][value="none"]').checked = true;
  document.querySelector('input[name="level-option"][value="subcategory"]').checked = true;
  el('existing-categories-section').classList.add('hidden');
  el('new-category-section').classList.add('hidden');
  el('parent-subcategory-section').classList.add('hidden');

  if (state.lastFocusedElement instanceof HTMLElement) {
    state.lastFocusedElement.focus();
  }
}

function onModalKeydown(e) {
  const modal = el('subcategory-modal');
  if (!modal || modal.classList.contains('hidden')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    hideModal();
    return;
  }

  if (e.key !== 'Tab') return;

  const dialog = modal.querySelector('.modal-content');
  const focusable = getFocusableElements(dialog);

  if (focusable.length === 0) {
    e.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Update Category Sections
 *
 * Shows or hides the existing/new category sections in the modal based on user selection.
 */
function updateCategorySections() {
  const levelOption = document.querySelector('input[name="level-option"]:checked')?.value;
  const parentSection = el('parent-subcategory-section');
  const categoryOption = document.querySelector('input[name="category-option"]:checked')?.value;
  const existingSection = el('existing-categories-section');
  const newSection = el('new-category-section');

  if (levelOption === 'subSubcategory') {
    parentSection.classList.remove('hidden');
    existingSection.classList.add('hidden');
    newSection.classList.add('hidden');
    return;
  }

  parentSection.classList.add('hidden');

  if (categoryOption === 'existing') {
    existingSection.classList.remove('hidden');
    newSection.classList.add('hidden');
  } else if (categoryOption === 'new') {
    existingSection.classList.add('hidden');
    newSection.classList.remove('hidden');
  } else {
    existingSection.classList.add('hidden');
    newSection.classList.add('hidden');
  }
}

/**
 * Handle Create Sub-category
 *
 * Validates and submits the new sub-category form in the modal.
 * Displays success or error messages based on the result.
 */
async function handleCreateSubcategory() {
  const name = el('modal-subcategory-name').value.trim();
  if (!name) {
    setStatus('Sub-category name is required', false);
    return;
  }

  const description = el('modal-subcategory-description').value.trim() || null;
  const levelOption = document.querySelector('input[name="level-option"]:checked')?.value || 'subcategory';

  if (levelOption === 'subSubcategory') {
    const selectedParent = el('modal-parent-subcategory').value;
    const subcategoryId = selectedParent ? Number(selectedParent) : null;
    if (!subcategoryId || Number.isNaN(subcategoryId)) {
      setStatus('Parent sub-category is required', false);
      return;
    }

    try {
      const payload = {
        name,
        ...(description != null ? { description } : {}),
        subcategoryId,
      };
      const res = await send('createSubSubcategory', payload);
      if (!res?.ok) {
        setStatus(res.error || 'Could not create sub-sub-category.', false);
        return;
      }

      const parent = state.existingParentSubcategories.find(item => item.id === subcategoryId);
      const newSubcategory = {
        id: res.data.id,
        name: res.data.name,
        kind: 'subSubcategory',
        description: res.data.description ?? null,
        categoryId: parent?.categoryId ?? null,
        categoryName: parent?.categoryName ?? null,
        subcategoryName: parent?.name ?? null,
      };
      state.allSubcategories.push(newSubcategory);
      addSubcategory(newSubcategory);
      hideModal();
      setStatus('Sub-sub-category created.', true);
      setTimeout(() => setStatus(''), 2000);
      return;
    } catch {
      setStatus('Could not create sub-sub-category.', false);
      return;
    }
  }

  const categoryOption = document.querySelector('input[name="category-option"]:checked')?.value;
  let categoryId = null;
  let categoryName = null;
  let resolvedCategoryName = null;

  if (categoryOption === 'existing') {
    const selected = el('modal-existing-categories').value;
    categoryId = selected ? Number(selected) : null;
    if (Number.isNaN(categoryId)) categoryId = null;
    resolvedCategoryName = state.existingCategories.find(g => g.id === categoryId)?.name || null;
  } else if (categoryOption === 'new') {
    categoryName = el('modal-new-category-name').value.trim() || null;
    resolvedCategoryName = categoryName || null;
  }

  try {
  const payload = {
    name,
    ...(description != null ? { description } : {}),
    ...(categoryId != null ? { categoryId } : {}),
    ...(categoryName != null ? { categoryName } : {}),
  };
  const res = await send('createSubcategory', payload);
    if (!res?.ok) {
      setStatus(res.error || 'Could not create sub-category.', false);
      return;
    }

    // Add to local state
    const newSubcategory = {
      id: res.data.id,
      name: res.data.name,
      description: res.data.description ?? null,
      categoryId: res.data.categoryId ?? categoryId ?? null,
      categoryName: resolvedCategoryName
    };
    state.allSubcategories.push(newSubcategory);

    // Update existing categories if we created a new one
    if (categoryName && res.data.categoryId) {
      const hasCategory = state.existingCategories.some(category => category.id === res.data.categoryId);
      if (!hasCategory) {
        state.existingCategories.push({ id: res.data.categoryId, name: categoryName });
      }
    }

    // Auto-select the newly created subcategory
    addSubcategory(newSubcategory);

    hideModal();
    setStatus('Sub-category created.', true);
    setTimeout(() => setStatus(''), 2000);
  } catch (error) {
    setStatus('Could not create sub-category.', false);
  }
}

/**
 * Load Initial Data
 *
 * Fetches and loads the initial data for the popup including existing bookmarks,
 * sub-categories, and tags. Populates the form fields and updates the UI state.
 */
async function loadInitial() {
  try {
    const res = await send('fetchInitialData');
    if (!res?.ok) {
      setStatus(res?.error || 'Could not load bookmark details.', false);
      return;
    }

    const { tab, subcategories, tags } = res.data;
    el('url').value = tab.url || '';
    el('title').value = tab.title || '';
    state.faviconUrl = tab.faviconUrl || '';

    // Process sub-category data
    state.allSubcategories = [];
    state.existingCategories = [];
    state.existingParentSubcategories = [];
    if (subcategories.categories) {
      subcategories.categories.forEach(category => {
        if (category?.id && category?.name) {
          const hasCategory = state.existingCategories.some(existing => existing.id === category.id);
          if (!hasCategory) state.existingCategories.push({ id: category.id, name: category.name });
        }
        if (category.subcategories) {
          category.subcategories.forEach(c => {
            state.existingParentSubcategories.push({
              id: c.id,
              name: c.name,
              label: [category.name, c.name].filter(Boolean).join(' -> '),
              categoryId: category.id,
              categoryName: category.name,
            });
            state.allSubcategories.push({
              id: c.id,
              name: c.name,
              kind: 'subcategory',
              description: c.description ?? null,
              categoryId: category.id,
              categoryName: category.name,
              subcategoryName: null,
            });
            (c.subSubcategories || []).forEach(ssc => {
              state.allSubcategories.push({
                id: ssc.id,
                name: ssc.name,
                kind: 'subSubcategory',
                description: ssc.description ?? null,
                categoryId: category.id,
                categoryName: category.name,
                subcategoryName: c.name,
              });
            });
          });
        }
      });
    }

    // Store tag suggestions
    state.tagSuggestions = tags.items || [];
  } catch (error) {
    setStatus('Could not load bookmark details.', false);
  }
}

/**
 * Set Status Message
 *
 * Updates the status message displayed to the user, with optional success styling.
 *
 * @param {string} text - Status message text
 * @param {boolean} [success=false] - Whether the message indicates success
 */
function setStatus(text, success = false) {
  const s = el('status');
  s.className = `status-text ${success ? 'success' : (text ? 'error' : '')}`;
  queueLiveRegionText(s, text || '');
}

function showSaveToast(msg, ok) {
  var t = document.getElementById('save-toast');
  if (!t) return;
  t.className = 'save-toast ' + (ok ? 'ok' : 'err');
  queueLiveRegionText(t, msg);
}

function setSubmitPending(isPending) {
  const saveBtn = el('save');
  if (saveBtn) {
    saveBtn.disabled = isPending;
  }
}

/**
 * Render duplicate warning list
 *
 * Populates the duplicate list container with any existing bookmark matches.
 */
function renderDuplicateWarning() {
  const list = el('duplicate-list');
  if (!list) return;
  list.innerHTML = '';

  const duplicates = state.pendingDuplicate?.duplicates || [];
  duplicates.forEach((duplicate) => {
    const item = document.createElement('li');
    item.className = 'duplicate-item';

    const title = document.createElement('span');
    title.className = 'duplicate-item-title';
    title.textContent = duplicate.title || '(Untitled bookmark)';
    item.appendChild(title);

    if (duplicate.url) {
      const urlLine = document.createElement('span');
      urlLine.className = 'duplicate-item-meta';
      urlLine.textContent = duplicate.url;
      item.appendChild(urlLine);
    }

    if (duplicate.createdAt) {
      const date = new Date(duplicate.createdAt);
      if (!Number.isNaN(date.getTime())) {
        const dateLine = document.createElement('span');
        dateLine.className = 'duplicate-item-meta';
        dateLine.textContent = `Saved ${date.toLocaleString()}`;
        item.appendChild(dateLine);
      }
    }

    list.appendChild(item);
  });
}

/**
 * Show duplicate warning panel
 *
 * @param {Array} duplicates - Duplicate bookmark entries from API
 */
function showDuplicateWarning(duplicates) {
  const container = el('duplicate-warning');
  const confirmBtn = el('duplicate-confirm');
  const cancelBtn = el('duplicate-cancel');

  state.pendingDuplicate = {
    duplicates: Array.isArray(duplicates) ? duplicates : []
  };

  renderDuplicateWarning();

  if (container) {
    container.classList.remove('hidden');
    window.setTimeout(() => container.focus(), 0);
  }
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Close';
  }
  if (cancelBtn) {
    cancelBtn.disabled = false;
  }
}

/**
 * Hide duplicate warning panel and reset state
 */
function hideDuplicateWarning() {
  const container = el('duplicate-warning');
  const list = el('duplicate-list');
  const confirmBtn = el('duplicate-confirm');
  const cancelBtn = el('duplicate-cancel');

  if (container) {
    container.classList.add('hidden');
  }
  if (list) {
    list.innerHTML = '';
  }
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Close';
  }
  if (cancelBtn) {
    cancelBtn.disabled = false;
  }
  state.pendingDuplicate = null;
}

/**
 * Cancel duplicate save flow
 */
function onDuplicateCancel() {
  hideDuplicateWarning();
  setSubmitPending(false);
  setStatus('Duplicate save cancelled');
  setTimeout(() => setStatus(''), 2000);
}

/**
 * Dismiss duplicate save flow
 */
async function onDuplicateConfirm() {
  if (!state.pendingDuplicate) return;

  const confirmBtn = el('duplicate-confirm');

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Closing…';
  }

  hideDuplicateWarning();
  setSubmitPending(false);
  setStatus('Bookmark already exists.', false);
}

/**
 * On Create Sub-category Button Click
 *
 * Event handler for the "Add Sub-category" button.
 * Shows the modal for creating a new sub-category.
 */
async function onCreateSubcategory() {
  showModal();
}

// Debounced search handlers to limit API calls
const debouncedSubcategorySearch = debounce((query) => {
  if (!query.trim()) {
    hideSubcategorySuggestions();
    return;
  }
  filterSubcategories(query);
}, 250);

const debouncedTagSearch = debounce(async (q) => {
  try {
    const res = await send('searchTags', { query: q, limit: 20 });
    if (res?.ok) {
      const availableTags = res.data.items.filter(tag =>
        !state.selectedTags.some(selected => selected.id === tag.id)
      );
      renderTagSuggestions(availableTags);
    }
  } catch (error) {
    console.error('Tag search failed:', error);
  }
}, 250);

/**
 * On Sub-category Search Input
 *
 * Event handler for the sub-category search input field.
 * Triggers filtering of sub-categories based on user query.
 *
 * @param {Event} e - Input event
 */
function onSubcategorySearch(e) {
  const query = e.target.value;
  if (!query.trim()) {
    // Show prefetched results when clearing search
    prefetchSubcategories();
    return;
  }
  debouncedSubcategorySearch(query);
}

/**
 * On Sub-category Focus
 *
 * Event handler for focusing on the sub-category search input.
 * Prefetches sub-categories to show initial suggestions.
 */
function onSubcategoryFocus() {
  prefetchSubcategories();
}

function setActiveSubcategoryIndex(index) {
  if (state.visibleSubcategories.length === 0) return;
  state.activeSubcategoryIndex = index;
  updateActiveSuggestion('subcategory-suggestions', index);
  updateListboxState('subcategory-search', 'subcategory-suggestions', index);
}

function moveSubcategoryActive(delta) {
  if (state.visibleSubcategories.length === 0) return;
  const nextIndex = state.activeSubcategoryIndex < 0
    ? (delta > 0 ? 0 : state.visibleSubcategories.length - 1)
    : (state.activeSubcategoryIndex + delta + state.visibleSubcategories.length) % state.visibleSubcategories.length;
  setActiveSubcategoryIndex(nextIndex);
}

function onSubcategoryKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (el('subcategory-suggestions').classList.contains('hidden')) {
      prefetchSubcategories();
      return;
    }
    moveSubcategoryActive(1);
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!el('subcategory-suggestions').classList.contains('hidden')) {
      moveSubcategoryActive(-1);
    }
    return;
  }

  if (e.key === 'Escape' && !el('subcategory-suggestions').classList.contains('hidden')) {
    e.preventDefault();
    hideSubcategorySuggestions();
    return;
  }

  if (e.key === 'Enter' && state.activeSubcategoryIndex >= 0) {
    const activeSubcategory = state.visibleSubcategories[state.activeSubcategoryIndex];
    if (activeSubcategory) {
      e.preventDefault();
      addSubcategory(activeSubcategory);
    }
  }
}

/**
 * On Tag Input
 *
 * Event handler for the tag input field.
 * Triggers search for tag suggestions based on user input.
 *
 * @param {Event} e - Input event
 */
function onTagInput(e) {
  const query = e.target.value.trim();
  if (!query) {
    // Show prefetched results when clearing search
    prefetchTags();
    return;
  }
  debouncedTagSearch(query);
}

/**
 * On Tag Focus
 *
 * Event handler for focusing on the tag input field.
 * Prefetches tags to show initial suggestions.
 */
function onTagFocus() {
  prefetchTags();
}

function setActiveTagIndex(index) {
  if (state.tagSuggestions.length === 0) return;
  state.activeTagIndex = index;
  updateActiveSuggestion('tag-suggestions', index);
  updateListboxState('tag-input', 'tag-suggestions', index);
}

function moveTagActive(delta) {
  if (state.tagSuggestions.length === 0) return;
  const nextIndex = state.activeTagIndex < 0
    ? (delta > 0 ? 0 : state.tagSuggestions.length - 1)
    : (state.activeTagIndex + delta + state.tagSuggestions.length) % state.tagSuggestions.length;
  setActiveTagIndex(nextIndex);
}

async function onTagKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (el('tag-suggestions').classList.contains('hidden')) {
      await prefetchTags();
      return;
    }
    moveTagActive(1);
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!el('tag-suggestions').classList.contains('hidden')) {
      moveTagActive(-1);
    }
    return;
  }

  if (e.key === 'Escape' && !el('tag-suggestions').classList.contains('hidden')) {
    e.preventDefault();
    hideTagSuggestions();
    state.hasTagsPrefetched = false;
    return;
  }

  if (e.key === 'Enter' && state.activeTagIndex >= 0) {
    const activeTag = state.tagSuggestions[state.activeTagIndex];
    if (activeTag) {
      e.preventDefault();
      addTag(activeTag);
      return;
    }
  }

  await onTagEnterCreateIfNeeded(e);
}

/**
 * Add prefetching for subcategories on focus/click
 */

/**
 * Prefetch Sub-categories
 *
 * Loads and displays a set of subcategories to suggest to the user before they start typing.
 * Typically shows the first 10 available subcategories that are not already selected.
 */
async function prefetchSubcategories() {
  if (state.hasSubcategoriesPrefetched) return;

  // Show first 10 available subcategories (not already selected)
  const availableSubcategories = state.allSubcategories.filter(c =>
    !state.selectedSubcategories.some(selected => `${selected.kind}:${selected.id}` === `${c.kind}:${c.id}`)
  ).slice(0, 10);

  if (availableSubcategories.length > 0) {
    state.hasSubcategoriesPrefetched = true;
    renderSubcategorySuggestions(availableSubcategories);
  }
}

/**
 * Add prefetching for tags on focus/click
 */

/**
 * Prefetch Tags
 *
 * Loads and displays a set of tags to suggest to the user before they start typing.
 * Typically shows the first 10 available tags that are not already selected.
 */
async function prefetchTags() {
  if (state.hasTagsPrefetched && state.prefetchedTags.length > 0) {
    const availableTags = state.prefetchedTags.filter(tag =>
      !state.selectedTags.some(selected => selected.id === tag.id)
    );
    renderTagSuggestions(availableTags.slice(0, 10));
    return;
  }

  try {
    const res = await send('searchTags', { query: '', limit: 10 });
    if (res?.ok && res.data?.items) {
      state.prefetchedTags = res.data.items;
      state.hasTagsPrefetched = true;

      const availableTags = state.prefetchedTags.filter(tag =>
        !state.selectedTags.some(selected => selected.id === tag.id)
      );
      renderTagSuggestions(availableTags.slice(0, 10));
    }
  } catch (error) {
    console.error('Failed to prefetch tags:', error);
  }
}

/**
 * Document Click Event
 *
 * Global click event listener to close dropdowns when clicking outside of them.
 *
 * @param {Event} e - Click event
 */
document.addEventListener('click', (e) => {
  if (!e.target.closest('#subcategory-search') && !e.target.closest('#subcategory-suggestions')) {
    hideSubcategorySuggestions();
  }
  if (!e.target.closest('#tag-input') && !e.target.closest('#tag-suggestions')) {
    hideTagSuggestions();
    state.hasTagsPrefetched = false;
  }
});

/**
 * Initialize Event Listeners
 *
 * Sets up all event listeners for the popup interface elements.
 * Binds actions to buttons, inputs, and modal events.
 */
function initEvents() {
  el('add-subcategory').addEventListener('click', onCreateSubcategory);
  el('subcategory-search').addEventListener('input', onSubcategorySearch);
  el('subcategory-search').addEventListener('focus', onSubcategoryFocus);
  el('subcategory-search').addEventListener('click', onSubcategoryFocus);
  el('subcategory-search').addEventListener('keydown', onSubcategoryKeydown);
  el('tag-input').addEventListener('input', onTagInput);
  el('tag-input').addEventListener('focus', onTagFocus);
  el('tag-input').addEventListener('click', onTagFocus);
  el('tag-input').addEventListener('keydown', onTagKeydown);
  el('form').addEventListener('submit', onSubmit);
  el('duplicate-cancel').addEventListener('click', onDuplicateCancel);
  el('duplicate-confirm').addEventListener('click', onDuplicateConfirm);

  // Modal events
  el('modal-cancel').addEventListener('click', hideModal);
  el('modal-create').addEventListener('click', handleCreateSubcategory);

  // Category option radio buttons
document.querySelectorAll('input[name="category-option"]').forEach(radio => {
  radio.addEventListener('change', updateCategorySections);
});
document.querySelectorAll('input[name="level-option"]').forEach(radio => {
  radio.addEventListener('change', updateCategorySections);
});

  // Close modal when clicking backdrop
  el('subcategory-modal').addEventListener('click', (e) => {
    if (e.target === el('subcategory-modal')) {
      hideModal();
    }
  });

  // Enter key handling in modal
  el('modal-subcategory-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateSubcategory();
    }
  });

  el('modal-new-category-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateSubcategory();
    }
  });
}

/**
 * DOMContentLoaded Event
 *
 * Initializes the popup interface events and loads the initial data
 * when the DOM content is fully loaded.
 */
window.addEventListener('DOMContentLoaded', async () => {
  initEvents();
  await loadInitial();
});

/**
 * On Tag Enter - Create If Needed
 *
 * Handles the Enter key press in the tag input field.
 * If the tag matches an existing suggestion, it selects the suggestion.
 * Otherwise, it attempts to create a new tag with the entered name.
 *
 * @param {Event} e - Keydown event
 */
async function onTagEnterCreateIfNeeded(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const name = el('tag-input').value.trim();
  if (!name) return;

  const exactLocalMatch = findExactExistingTag(name);
  if (exactLocalMatch) {
    addTag(exactLocalMatch);
    return;
  }

  try {
    const existingRes = await send('searchTags', { query: name, limit: 1, exact: true });
    if (existingRes?.ok && existingRes.data?.items?.length) {
      addTag(existingRes.data.items[0]);
      return;
    }
  } catch (error) {
    console.error('Exact tag lookup failed:', error);
  }

  try {
    const res = await send('createTag', { name });
    if (res?.ok) {
      addTag(res.data);
      setStatus('Tag created.', true);
      setTimeout(() => setStatus(''), 2000);
    } else if (res?.status === 409) {
      const existingRes = await send('searchTags', { query: name, limit: 1, exact: true });
      if (existingRes?.ok && existingRes.data?.items?.length) {
        addTag(existingRes.data.items[0]);
        return;
      }
      setStatus(res?.error || 'Could not create tag.', false);
    } else {
      setStatus(res?.error || 'Could not create tag.', false);
    }
  } catch (error) {
    setStatus('Could not create tag.', false);
  }
}

function findExactExistingTag(name) {
  const normalizedName = name.trim().toLowerCase();
  const candidates = [...state.tagSuggestions, ...state.prefetchedTags];

  return candidates.find(tag =>
    tag.name.trim().toLowerCase() === normalizedName &&
    !state.selectedTags.some(selected => selected.id === tag.id)
  ) || null;
}

/**
 * Build bookmark payload from current form state
 *
 * @param {string} url - Bookmark URL
 * @param {string} title - Bookmark title
 * @returns {Object} Payload for API submission
 */
function buildBookmarkPayload(url, title) {
  return {
    url,
    title,
    description: el('description').value || '',
      subcategoryIds: state.selectedSubcategories.filter(c => c.kind !== 'subSubcategory').map(c => c.id),
      subSubcategoryIds: state.selectedSubcategories.filter(c => c.kind === 'subSubcategory').map(c => c.id),
    tags: state.selectedTags.map(t => t.id),
    flags: {
      forReview: el('flag-forReview').checked,
      readLater: el('flag-readLater').checked,
      hotTopic: el('flag-hotTopic').checked,
      cheatsheets: el('flag-cheatsheets').checked,
      archived: el('flag-archived').checked,
    },
    faviconUrl: state.faviconUrl || '',
  };
}

/**
 * Form Submit Handler
 *
 * Gathers the form data and submits it to save a new or updated bookmark.
 * Validates required fields and shows status messages based on the result.
 *
 * @param {Event} e - Submit event
 */
async function onSubmit(e) {
  e.preventDefault();

  hideDuplicateWarning();

  const url = el('url').value.trim();
  const title = el('title').value.trim();

  if (!url) return setStatus('URL is required.', false);
  if (!title) return setStatus('Title is required.', false);

  const payload = buildBookmarkPayload(url, title);

  let shouldRestoreSubmitState = true;
  setSubmitPending(true);
  setStatus('Saving…');

  try {
    const res = await send('createBookmark', payload);
    if (res?.ok) {
      shouldRestoreSubmitState = false;
      showSaveToast('✓ Bookmark saved', true);
      setStatus('Bookmark saved.', true);
      setTimeout(() => window.close(), 2500);
    } else if (res?.status === 409 && res?.data?.duplicates?.length) {
      showDuplicateWarning(res.data.duplicates);
      showSaveToast('✕ Bookmark already exists', false);
      setStatus('Bookmark already exists. Review the existing entries below.', false);
    } else {
      showSaveToast('✕ ' + (res?.error || 'Could not save bookmark.'), false);
      setStatus(res?.error || 'Could not save bookmark.', false);
    }
  } catch (error) {
    showSaveToast('✕ Could not save bookmark', false);
    setStatus('Could not save bookmark.', false);
  } finally {
    if (shouldRestoreSubmitState) {
      setSubmitPending(false);
    }
  }
}
