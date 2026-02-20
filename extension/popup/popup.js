/**
 * Popup Interface Controller
 *
 * Main user interface for the bookmark manager extension popup.
 * Handles the complete bookmark capture workflow including:
 * - Form initialization and data loading
 * - Tag and classification management with autocomplete
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

/**
 * Application State Management
 *
 * Centralized state object that tracks all dynamic data in the popup interface.
 * This includes selected items, available options, UI state flags, and cached data.
 */
let state = {
  selectedTags: [], // Array of selected tag objects: { id, name }
  selectedClassifications: [], // Array of selected classification objects: { id, name, groupName }
  allClassifications: [], // All available classifications with groups from API
  filteredClassifications: [], // Filtered classifications for display in search
  tagSuggestions: [], // Tag suggestions for autocomplete dropdown
  existingGroups: [], // Available classification groups for modal: { id, name }
  prefetchedTags: [], // Cache for prefetched tag results
  hasClassificationsPrefetched: false, // Track if classifications are loaded
  hasTagsPrefetched: false, // Track if initial tags are loaded
  pendingDuplicate: null, // Store duplicate entries requiring confirmation
};

/**
 * Create Chip Component
 *
 * Creates a removable chip UI element for displaying selected tags/classifications.
 * Chips show the selected item name and include a remove button with click handler.
 *
 * @param {string} text - Display text for the chip
 * @param {Function} onRemove - Callback function when remove button is clicked
 * @param {boolean} [isClassification=false] - Whether this is a classification chip (affects styling)
 * @returns {HTMLElement} Chip DOM element with remove functionality
 */
function createChip(text, onRemove, isClassification = false) {
  const chip = document.createElement('span');
  chip.className = `chip ${isClassification ? 'chip-classification' : ''}`;
  chip.innerHTML = `
    ${text}
    <button type="button" class="chip-remove" title="Remove">
      <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
      </svg>
    </button>
  `;
  chip.querySelector('.chip-remove').addEventListener('click', onRemove);
  return chip;
}

/**
 * Render Selected Classifications
 *
 * Updates the DOM to display all currently selected classifications as chips.
 * Each chip shows the group name and classification name in hierarchical format.
 * Clears existing chips and rebuilds the entire list.
 */
function renderSelectedClassifications() {
  const container = el('selected-classifications');
  container.innerHTML = '';

  state.selectedClassifications.forEach(classification => {
    // Format display text with group hierarchy if available
    const chipText = classification.groupName
      ? `${classification.groupName} → ${classification.name}`
      : classification.name;

    const chip = createChip(chipText, () => removeClassification(classification.id), true);
    container.appendChild(chip);
  });
}

/**
 * Remove Classification Handler
 *
 * Removes a classification from the selected list and updates the UI.
 *
 * @param {number} id - Classification ID to remove
 */
function removeClassification(id) {
  state.selectedClassifications = state.selectedClassifications.filter(c => c.id !== id);
  renderSelectedClassifications();
}

/**
 * Add Classification Handler
 *
 * Adds a classification to the selected list and updates the UI.
 * Ensures no duplicates are added.
 *
 * @param {Object} classification - Classification object to add
 */
function addClassification(classification) {
  if (!state.selectedClassifications.some(c => c.id === classification.id)) {
    state.selectedClassifications.push(classification);
    renderSelectedClassifications();
  }
  el('classification-search').value = '';
  hideClassificationSuggestions();
}

/**
 * Render Classification Suggestions
 *
 * Displays a dropdown of classification suggestions based on user search input.
 * Suggestions are grouped by their classification group with headers.
 *
 * @param {Array} classifications - Array of classification objects to display
 */
function renderClassificationSuggestions(classifications) {
  const container = el('classification-suggestions');
  container.innerHTML = '';

  if (classifications.length === 0) {
    hideClassificationSuggestions();
    return;
  }

  // Group classifications by group name
  const grouped = {};
  classifications.forEach(c => {
    const groupName = c.groupName || 'Ungrouped';
    if (!grouped[groupName]) grouped[groupName] = [];
    grouped[groupName].push(c);
  });

  // Render groups
  Object.entries(grouped).forEach(([groupName, items]) => {
    // Add group header
    const header = document.createElement('div');
    header.className = 'group-header';
    header.textContent = groupName;
    container.appendChild(header);

    // Add group items
    items.forEach(classification => {
      const item = document.createElement('div');
      item.className = 'suggestion';
      item.textContent = classification.name;
      item.addEventListener('click', () => addClassification(classification));
      container.appendChild(item);
    });
  });

  showClassificationSuggestions();
}

/**
 * Show Classification Suggestions
 *
 * Reveals the classification suggestions dropdown.
 */
function showClassificationSuggestions() {
  el('classification-suggestions').classList.remove('hidden');
}

/**
 * Hide Classification Suggestions
 *
 * Hides the classification suggestions dropdown and resets the prefetched state.
 */
function hideClassificationSuggestions() {
  el('classification-suggestions').classList.add('hidden');
  state.hasClassificationsPrefetched = false;
}

/**
 * Filter Classifications
 *
 * Filters the available classifications based on user search query.
 * Excludes already selected classifications from the results.
 *
 * @param {string} query - Search query string
 */
function filterClassifications(query) {
  const filtered = state.allClassifications.filter(c => {
    const nameMatch = c.name.toLowerCase().includes(query.toLowerCase());
    const groupMatch = c.groupName && c.groupName.toLowerCase().includes(query.toLowerCase());
    const notSelected = !state.selectedClassifications.some(selected => selected.id === c.id);
    return (nameMatch || groupMatch) && notSelected;
  });

  state.filteredClassifications = filtered;
  renderClassificationSuggestions(filtered.slice(0, 20)); // Limit to 20 results
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
  container.innerHTML = '';

  if (tags.length === 0) {
    container.classList.add('hidden');
    return;
  }

  tags.forEach(tag => {
    const li = document.createElement('li');
    li.className = 'suggestion';
    li.textContent = tag.name;
    li.addEventListener('click', () => addTag(tag));
    container.appendChild(li);
  });

  container.classList.remove('hidden');
}

/**
 * Modal functions
 */

/**
 * Show Modal
 *
 * Displays the modal dialog for creating a new classification.
 * Populates existing groups dropdown and sets up event handlers.
 */
function showModal() {
  const modal = el('classification-modal');
  modal.classList.remove('hidden');

  // Populate existing groups dropdown
  const groupsSelect = el('modal-existing-groups');
  groupsSelect.innerHTML = '<option value="">Select a group</option>';
  state.existingGroups.forEach(group => {
    const option = document.createElement('option');
    option.value = String(group.id);
    option.textContent = group.name;
    groupsSelect.appendChild(option);
  });

  // Focus on the name input
  setTimeout(() => el('modal-classification-name').focus(), 100);

  // Show/hide existing groups option based on availability
  const existingRadio = document.querySelector('input[name="group-option"][value="existing"]');
  const existingLabel = existingRadio.closest('.radio-label');
  if (state.existingGroups.length === 0) {
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
  const modal = el('classification-modal');
  modal.classList.add('hidden');

  // Reset form
  el('modal-classification-name').value = '';
  el('modal-new-group-name').value = '';
  document.querySelector('input[name="group-option"][value="none"]').checked = true;
  el('existing-groups-section').classList.add('hidden');
  el('new-group-section').classList.add('hidden');
}

/**
 * Update Group Sections
 *
 * Shows or hides the existing/new group sections in the modal based on user selection.
 */
function updateGroupSections() {
  const groupOption = document.querySelector('input[name="group-option"]:checked')?.value;
  const existingSection = el('existing-groups-section');
  const newSection = el('new-group-section');

  if (groupOption === 'existing') {
    existingSection.classList.remove('hidden');
    newSection.classList.add('hidden');
  } else if (groupOption === 'new') {
    existingSection.classList.add('hidden');
    newSection.classList.remove('hidden');
  } else {
    existingSection.classList.add('hidden');
    newSection.classList.add('hidden');
  }
}

/**
 * Handle Create Classification
 *
 * Validates and submits the new classification form in the modal.
 * Displays success or error messages based on the result.
 */
async function handleCreateClassification() {
  const name = el('modal-classification-name').value.trim();
  if (!name) {
    setStatus('Classification name is required', false);
    return;
  }

  const groupOption = document.querySelector('input[name="group-option"]:checked')?.value;
  let groupId = null;
  let groupName = null;
  let resolvedGroupName = null;

  if (groupOption === 'existing') {
    const selected = el('modal-existing-groups').value;
    groupId = selected ? Number(selected) : null;
    if (Number.isNaN(groupId)) groupId = null;
    resolvedGroupName = state.existingGroups.find(g => g.id === groupId)?.name || null;
  } else if (groupOption === 'new') {
    groupName = el('modal-new-group-name').value.trim() || null;
    resolvedGroupName = groupName || null;
  }

  try {
  const payload = {
    name,
    ...(groupId != null ? { groupId } : {}),
    ...(groupName != null ? { groupName } : {}),
  };
  const res = await send('createClassification', payload);
    if (!res?.ok) {
      setStatus(res.error || 'Failed to create classification', false);
      return;
    }

    // Add to local state
    const newClassification = {
      id: res.data.id,
      name: res.data.name,
      groupId: res.data.groupId ?? groupId ?? null,
      groupName: resolvedGroupName
    };
    state.allClassifications.push(newClassification);

    // Update existing groups if we created a new one
    if (groupName && res.data.groupId) {
      const hasGroup = state.existingGroups.some(group => group.id === res.data.groupId);
      if (!hasGroup) {
        state.existingGroups.push({ id: res.data.groupId, name: groupName });
      }
    }

    // Auto-select the newly created classification
    addClassification(newClassification);

    hideModal();
    setStatus('Classification created!', true);
    setTimeout(() => setStatus(''), 2000);
  } catch (error) {
    setStatus('Failed to create classification', false);
  }
}

/**
 * Load Initial Data
 *
 * Fetches and loads the initial data for the popup including existing bookmarks,
 * classifications, and tags. Populates the form fields and updates the UI state.
 */
async function loadInitial() {
  try {
    const res = await send('getInitialData');
    if (!res?.ok) {
      setStatus(res?.error || 'Failed to load initial data', false);
      return;
    }

    const { tab, classifications, tags } = res.data;
    el('url').value = tab.url || '';
    el('title').value = tab.title || '';

    // Process classifications data
    state.allClassifications = [];
    state.existingGroups = [];
    if (classifications.groups) {
      classifications.groups.forEach(group => {
        if (group?.id && group?.name) {
          const hasGroup = state.existingGroups.some(existing => existing.id === group.id);
          if (!hasGroup) state.existingGroups.push({ id: group.id, name: group.name });
        }
        if (group.classifications) {
          group.classifications.forEach(c => {
            state.allClassifications.push({
              id: c.id,
              name: c.name,
              groupId: group.id,
              groupName: group.name
            });
          });
        }
      });
    }

    // Store tag suggestions
    state.tagSuggestions = tags.items || [];
  } catch (error) {
    setStatus('Failed to load initial data', false);
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
  s.textContent = text || '';
  s.className = `status-text ${success ? 'success' : (text ? 'error' : '')}`;
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
  }
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Save Duplicate';
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
    confirmBtn.textContent = 'Save Duplicate';
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
  const saveBtn = el('save');
  if (saveBtn) saveBtn.disabled = false;
  setStatus('Duplicate save cancelled');
  setTimeout(() => setStatus(''), 2000);
}

/**
 * Confirm duplicate save flow
 */
async function onDuplicateConfirm() {
  if (!state.pendingDuplicate) return;

  const url = el('url').value.trim();
  const title = el('title').value.trim();
  if (!url) {
    setStatus('Missing URL', false);
    return;
  }
  if (!title) {
    setStatus('Missing title', false);
    return;
  }

  const confirmBtn = el('duplicate-confirm');
  const cancelBtn = el('duplicate-cancel');
  const saveBtn = el('save');

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving…';
  }
  if (cancelBtn) cancelBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;

  setStatus('Saving duplicate…');

  const payload = { ...buildBookmarkPayload(url, title), allowDuplicate: true };

  try {
    const res = await send('saveBookmark', payload);
    if (res?.ok) {
      hideDuplicateWarning();
      setStatus('Bookmark saved!', true);
      setTimeout(() => window.close(), 1200);
      return;
    }

    if (res?.status === 409 && res?.data?.duplicates?.length) {
      showDuplicateWarning(res.data.duplicates);
      setStatus('Bookmark already exists. Review duplicates below.', false);
    } else {
      setStatus(res?.error || 'Failed to save bookmark', false);
    }
  } catch (error) {
    setStatus('Failed to save bookmark', false);
  } finally {
    const pending = !!state.pendingDuplicate;
    if (pending && confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Save Duplicate';
    }
    if (pending && cancelBtn) {
      cancelBtn.disabled = false;
    }
    if (pending && saveBtn) {
      saveBtn.disabled = false;
    }
  }
}

/**
 * On Create Classification Button Click
 *
 * Event handler for the "Add Classification" button.
 * Shows the modal for creating a new classification.
 */
async function onCreateClassification() {
  showModal();
}

// Debounced search handlers to limit API calls
const debouncedClassificationSearch = debounce((query) => {
  if (!query.trim()) {
    hideClassificationSuggestions();
    return;
  }
  filterClassifications(query);
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
 * On Classification Search Input
 *
 * Event handler for the classification search input field.
 * Triggers filtering of classifications based on user query.
 *
 * @param {Event} e - Input event
 */
function onClassificationSearch(e) {
  const query = e.target.value;
  if (!query.trim()) {
    // Show prefetched results when clearing search
    prefetchClassifications();
    return;
  }
  debouncedClassificationSearch(query);
}

/**
 * On Classification Focus
 *
 * Event handler for focusing on the classification search input.
 * Prefetches classifications to show initial suggestions.
 */
function onClassificationFocus() {
  prefetchClassifications();
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

/**
 * Add prefetching for classifications on focus/click
 */

/**
 * Prefetch Classifications
 *
 * Loads and displays a set of classifications to suggest to the user before they start typing.
 * Typically shows the first 10 available classifications that are not already selected.
 */
async function prefetchClassifications() {
  if (state.hasClassificationsPrefetched) return;

  // Show first 10 available classifications (not already selected)
  const availableClassifications = state.allClassifications.filter(c =>
    !state.selectedClassifications.some(selected => selected.id === c.id)
  ).slice(0, 10);

  if (availableClassifications.length > 0) {
    state.hasClassificationsPrefetched = true;
    renderClassificationSuggestions(availableClassifications);
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
  if (!e.target.closest('#classification-search') && !e.target.closest('#classification-suggestions')) {
    hideClassificationSuggestions();
  }
  if (!e.target.closest('#tag-input') && !e.target.closest('#tag-suggestions')) {
    renderTagSuggestions([]);
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
  el('add-classification').addEventListener('click', onCreateClassification);
  el('classification-search').addEventListener('input', onClassificationSearch);
  el('classification-search').addEventListener('focus', onClassificationFocus);
  el('classification-search').addEventListener('click', onClassificationFocus);
  el('tag-input').addEventListener('input', onTagInput);
  el('tag-input').addEventListener('focus', onTagFocus);
  el('tag-input').addEventListener('click', onTagFocus);
  el('tag-input').addEventListener('keydown', onTagEnterCreateIfNeeded);
  el('form').addEventListener('submit', onSubmit);
  el('duplicate-cancel').addEventListener('click', onDuplicateCancel);
  el('duplicate-confirm').addEventListener('click', onDuplicateConfirm);

  // Modal events
  el('modal-cancel').addEventListener('click', hideModal);
  el('modal-create').addEventListener('click', handleCreateClassification);

  // Group option radio buttons
  document.querySelectorAll('input[name="group-option"]').forEach(radio => {
    radio.addEventListener('change', updateGroupSections);
  });

  // Close modal when clicking backdrop
  el('classification-modal').addEventListener('click', (e) => {
    if (e.target === el('classification-modal')) {
      hideModal();
    }
  });

  // Enter key handling in modal
  el('modal-classification-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateClassification();
    }
  });

  el('modal-new-group-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateClassification();
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

  // Check if tag exists in current suggestions
  const suggestions = el('tag-suggestions');
  if (!suggestions.classList.contains('hidden')) {
    const firstSuggestion = suggestions.querySelector('.suggestion');
    if (firstSuggestion && firstSuggestion.textContent.toLowerCase() === name.toLowerCase()) {
      firstSuggestion.click();
      return;
    }
  }

  try {
    const res = await send('createTag', { name });
    if (res?.ok) {
      addTag(res.data);
      setStatus('Tag created!', true);
      setTimeout(() => setStatus(''), 2000);
    } else {
      setStatus(res?.error || 'Failed to create tag', false);
    }
  } catch (error) {
    setStatus('Failed to create tag', false);
  }
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
    classificationIds: state.selectedClassifications.map(c => c.id),
    tags: state.selectedTags.map(t => t.id),
    flags: {
      forReview: el('flag-forReview').checked,
      readLater: el('flag-readLater').checked,
      hotTopic: el('flag-hotTopic').checked,
      cheatsheets: el('flag-cheatsheets').checked,
      archived: el('flag-archived').checked,
    },
    faviconUrl: '',
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

  if (!url) return setStatus('Missing URL', false);
  if (!title) return setStatus('Missing title', false);

  const payload = buildBookmarkPayload(url, title);

  const saveBtn = el('save');
  saveBtn.disabled = true;
  setStatus('Saving…');

  try {
    const res = await send('saveBookmark', payload);
    if (res?.ok) {
      setStatus('Bookmark saved!', true);
      setTimeout(() => window.close(), 1200);
    } else if (res?.status === 409 && res?.data?.duplicates?.length) {
      saveBtn.disabled = false;
      showDuplicateWarning(res.data.duplicates);
      setStatus('Bookmark already exists. Review duplicates below.', false);
    } else {
      saveBtn.disabled = false;
      setStatus(res?.error || 'Failed to save bookmark', false);
    }
  } catch (error) {
    saveBtn.disabled = false;
    setStatus('Failed to save bookmark', false);
  }
}
