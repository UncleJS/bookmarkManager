// apiFetch, registerActions: see common.js

let viewMode = 'active';
let tags = [];

function setView(mode) {
  viewMode = mode;
  document.getElementById('btn-active').classList.toggle('active', mode === 'active');
  document.getElementById('btn-archived').classList.toggle('active', mode === 'archived');
  document.getElementById('add-tag-section').style.display = mode === 'active' ? 'flex' : 'none';
  loadAll();
}

async function fetchAllTags() {
  const items = [];
  let offset = 0;
  let total = 0;

  do {
    const params = new URLSearchParams({
      limit: '100',
      offset: String(offset),
      sort: 'alpha',
    });
    if (viewMode === 'archived') params.set('archived', 'true');

    const res = await apiFetch('/tags?' + params.toString());
    if (!res.ok) throw new Error('Failed to fetch tags');
    const data = await res.json();
    items.push(...(data.items || []));
    total = Number(data.total || 0);
    offset += data.items.length;
    if (!data.items.length) break;
  } while (items.length < total);

  return items;
}

async function loadAll() {
  const container = document.getElementById('tags-container');
  container.innerHTML = '<div class="state-box">Loading...</div>';

  try {
    tags = await fetchAllTags();
    renderTags();
  } catch (e) {
    container.innerHTML = '<div class="state-box">Failed to load tags.<br><small>' + esc(e.message) + '</small></div>';
  }
}

function renderTags() {
  const container = document.getElementById('tags-container');
  if (!tags.length) {
    container.innerHTML = viewMode === 'archived'
      ? '<div class="state-box">No archived tags.</div>'
      : '<div class="state-box">No tags yet. Add one above.</div>';
    return;
  }

  container.innerHTML = tags.map(renderTagRow).join('');
}

function renderTagRow(tag) {
  const count = Number(tag.bookmarkCount || 0);
  const isArchived = !!tag.archivedAt;
  const countLabel = count + ' active bookmark' + (count === 1 ? '' : 's');
  const actions = isArchived
    ? '<button class="btn-icon success" data-action="restoreTag" data-id="' + tag.id + '">Restore</button>'
    : '<button class="btn-icon" data-action="startRenameTag" data-id="' + tag.id + '">Rename</button><button class="btn-icon danger" data-action="archiveTag" data-id="' + tag.id + '">Archive</button>';

  return '<div class="tag-row ' + (isArchived ? 'archived-row' : '') + '" id="tag-row-' + tag.id + '">' +
    '<div class="tag-name-wrap">' +
    '<span class="tag-name">' + esc(tag.name) + '</span>' +
    '<span class="tag-meta">Alphabetical order. Archive blocked while linked to active bookmarks.</span>' +
    '</div>' +
    '<span class="count-badge" title="' + countLabel + '">' + count + '</span>' +
    (isArchived ? '<span class="badge-archived">ARCHIVED</span>' : '') +
    actions +
    '</div>';
}

async function addTag() {
  const input = document.getElementById('add-tag-input');
  const button = document.getElementById('btn-add-tag');
  const name = input.value.trim();
  if (!name) return;

  button.disabled = true;
  try {
    const res = await apiFetch('/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Failed to add tag', 'error');
      return;
    }

    input.value = '';
    toast('Tag "' + name + '" created', 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function startRenameTag(tagId) {
  const row = document.getElementById('tag-row-' + tagId);
  const tag = tags.find(function(item) { return item.id === tagId; });
  if (!row || !tag) return;

  row.innerHTML = '';

  const input = document.createElement('input');
  input.className = 'inline-input';
  input.maxLength = 255;
  input.value = tag.name;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-icon confirm';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-icon';
  cancelBtn.textContent = 'Cancel';

  const nameWrap = document.createElement('div');
  nameWrap.className = 'tag-name-wrap';
  nameWrap.appendChild(input);

  row.appendChild(nameWrap);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);

  input.focus();
  input.select();

  saveBtn.onclick = function() { commitRenameTag(tagId, input.value); };
  cancelBtn.onclick = renderTags;
  input.onkeydown = function(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRenameTag(tagId, input.value);
    }
    if (event.key === 'Escape') renderTags();
  };
}

async function commitRenameTag(tagId, newName) {
  const name = (newName || '').trim();
  if (!name) return;

  try {
    const res = await apiFetch('/tags/' + tagId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Failed to rename tag', 'error');
      renderTags();
      return;
    }

    toast('Renamed to "' + name + '"', 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
    renderTags();
  }
}

async function archiveTag(tagId) {
  if (!confirm('Archive this tag? This is blocked while active bookmarks still use it.')) return;

  try {
    const res = await apiFetch('/tags/' + tagId + '/archive', { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Failed to archive tag', 'error');
      return;
    }

    toast('Tag archived', 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function restoreTag(tagId) {
  try {
    const res = await apiFetch('/tags/' + tagId + '/restore', { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Failed to restore tag', 'error');
      return;
    }

    toast('Tag restored', 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

var toastTimer = null;
function toast(message, type) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'show ' + (type || 'ok');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.className = ''; }, 3000);
}

loadAll();

// ── Event wiring (no inline handlers, see common.js) ──────────────────────────
registerActions({
  setView:        (el) => setView(el.dataset.arg),
  addTag:         () => addTag(),
  restoreTag:     (el) => restoreTag(Number(el.dataset.id)),
  startRenameTag: (el) => startRenameTag(Number(el.dataset.id)),
  archiveTag:     (el) => archiveTag(Number(el.dataset.id)),
});
