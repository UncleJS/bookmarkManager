// apiFetch, registerActions: see common.js

// ── State ──────────────────────────────────────────────────────────────────
let viewMode = 'active'; // 'active' | 'archived'
let categories = [];         // [{id, name, archivedAt, subcategories:[{..., subSubcategories:[]}]}]
const openCategoryIds = new Set();
const openSubcategoryIds = new Set();
const seenCategoryIds = new Set();
const seenSubcategoryIds = new Set();

function syncCollapseState() {
  for (const category of categories) {
    if (!seenCategoryIds.has(category.id)) {
      seenCategoryIds.add(category.id);
    }

    for (const subcategory of (category.subcategories || [])) {
      if (!seenSubcategoryIds.has(subcategory.id)) {
        seenSubcategoryIds.add(subcategory.id);
      }
    }
  }
}

function toggleCategorySection(categoryId, e) {
  if (e) e.stopPropagation();
  if (openCategoryIds.has(categoryId)) openCategoryIds.delete(categoryId);
  else openCategoryIds.add(categoryId);
  renderCategories();
}

function toggleSubcategorySection(subcategoryId, e) {
  if (e) e.stopPropagation();
  if (openSubcategoryIds.has(subcategoryId)) openSubcategoryIds.delete(subcategoryId);
  else openSubcategoryIds.add(subcategoryId);
  renderCategories();
}

// ── Boot ───────────────────────────────────────────────────────────────────
loadAll();

// ── View toggle ────────────────────────────────────────────────────────────
function setView(mode) {
  viewMode = mode;
  document.getElementById('btn-active').classList.toggle('active', mode === 'active');
  document.getElementById('btn-archived').classList.toggle('active', mode === 'archived');
  document.getElementById('add-category-section').style.display = mode === 'active' ? 'flex' : 'none';
  renderCategories();
}

// ── Load all data ──────────────────────────────────────────────────────────
async function loadAll() {
  try {
    // GET /categories?archived=true returns all categories with their
    // subcategories (active + archived) and bookmarkCount already embedded.
    const res = await apiFetch('/categories?archived=true');
    if (!res.ok) throw new Error('Failed to fetch');
    const { items: allCategories } = await res.json();

    // Attach uncategorized subcategories (categoryId === null) as a virtual category
    // They come embedded in categories where id matches; collect those with no category
    // by fetching active subcategories separately only for the uncategorized case.
    const clsRes = await apiFetch('/subcategories');
    if (!clsRes.ok) throw new Error('Failed to fetch sub-categories');
    const { categories: activeCategoryed } = await clsRes.json();
    const uncategorizedCategory = activeCategoryed.find(g => g.id === 0);

    categories = allCategories.map(g => ({
      ...g,
      // subcategories already include bookmarkCount from the categories endpoint
      subcategories: g.subcategories || [],
    }));

    if (uncategorizedCategory && uncategorizedCategory.subcategories.length > 0) {
      categories.push({
        id: 0,
        name: 'Uncategorized',
        archivedAt: null,
        subcategories: uncategorizedCategory.subcategories,
      });
    }

    renderCategories();
    document.getElementById('add-category-section').style.display = viewMode === 'active' ? 'flex' : 'none';

  } catch (e) {
    document.getElementById('categories-container').innerHTML =
      `<div class="state-box">⚠️ Failed to load categories.<br><small>${esc(e.message)}</small></div>`;
    console.error(e);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderCategories() {
  const container = document.getElementById('categories-container');
  syncCollapseState();

  const visible = viewMode === 'archived'
    ? categories.filter(g => g.archivedAt || g.subcategories.some(c => c.archivedAt))
    : categories.filter(g => !g.archivedAt);

  if (visible.length === 0) {
    container.innerHTML = viewMode === 'archived'
      ? '<div class="state-box">📭 No archived categories.</div>'
      : '<div class="state-box">📂 No categories yet. Add one below.</div>';
    return;
  }

  container.innerHTML = visible.map((g) => renderCategoryCard(g)).join('');
}

function renderCategoryCard(g) {
  const isVirtual = g.id === 0; // uncategorized pseudo-category
  const isArchived = !!g.archivedAt;
  const isOpen = openCategoryIds.has(g.id);
  const toggleBtn = `
    <button
      type="button"
      class="collapse-toggle ${isOpen ? 'open' : ''}"
      title="${isOpen ? 'Collapse' : 'Expand'} category"
      data-category-toggle-id="${g.id}"
      data-action="toggleCategorySection" data-id="${g.id}">
      <span class="toggle-chevron">▶</span>
    </button>`;

  const nameSection = `
    <div class="category-name-wrap">
      <span class="category-name">${esc(g.name)}</span>
      ${g.description ? `<span class="category-desc">${esc(g.description)}</span>` : ''}
    </div>`;

  const archivedBadge = isArchived ? `<span class="badge-archived">ARCHIVED</span>` : '';

  let actionBtns = '';
  if (!isVirtual) {
    if (isArchived) {
      actionBtns = `<button class="btn-icon success" data-action="restoreCategory" data-id="${g.id}">↩ Restore</button>`;
    } else {
      actionBtns = `
        <button class="btn-icon" data-action="startRenameCategory" data-id="${g.id}">Rename</button>
        <button class="btn-icon danger" data-action="archiveCategory" data-id="${g.id}">Archive</button>`;
    }
  }

  // Sub-categories within this category
  const visibleClasses = viewMode === 'archived'
    ? g.subcategories.filter(c => c.archivedAt)
    : g.subcategories.filter(c => !c.archivedAt);

  const classRows = visibleClasses.map((c) => renderSubcategoryRow(c)).join('');

  const addClassRow = (!isArchived && viewMode === 'active') ? `
    <div class="add-subcategory-row">
      <div class="add-class-inputs">
        <input class="add-input" type="text" placeholder="New sub-category…" maxlength="255"
               data-category-id="${g.id}"
               data-enter="addSubcategoryFromInput" data-id="${g.id}" />
        <button class="btn-add" data-action="addSubcategoryFromButton" data-id="${g.id}">+ Add</button>
      </div>
      <textarea class="add-desc-input" rows="1" placeholder="Description (optional)…" maxlength="1000"
                data-desc-for="${g.id}"></textarea>
    </div>` : '';

  return `
  <div class="category-card ${isArchived ? 'archived-row' : ''}" data-category-id="${g.id}">
    <div class="category-header" id="category-header-${g.id}">
      ${toggleBtn}
      ${nameSection}
      ${archivedBadge}
      ${actionBtns}
    </div>
    <div class="subcategory-list" data-category-body-id="${g.id}" ${isOpen ? '' : 'hidden'}>
      ${classRows || (viewMode === 'archived' ? '' : '<div class="empty-note">No sub-categories yet.</div>')}
      ${addClassRow}
    </div>
  </div>`;
}

function renderSubcategoryRow(c) {
  const isArchived = !!c.archivedAt;
  const isOpen = openSubcategoryIds.has(c.id);
  const toggleBtn = `
    <button
      type="button"
      class="collapse-toggle ${isOpen ? 'open' : ''}"
      title="${isOpen ? 'Collapse' : 'Expand'} sub-category"
      data-subcategory-toggle-id="${c.id}"
      data-action="toggleSubcategorySection" data-id="${c.id}">
      <span class="toggle-chevron">▶</span>
    </button>`;

  const archivedBadge = isArchived ? `<span class="badge-archived">ARCHIVED</span>` : '';

  const count = c.bookmarkCount ?? 0;
  const countBadge = `<span class="count-badge" title="${count} active bookmark${count === 1 ? '' : 's'}">${count}</span>`;

  let actionBtns = '';
  if (isArchived) {
    actionBtns = `<button class="btn-icon success" data-action="restoreSubcategory" data-id="${c.id}">↩ Restore</button>`;
  } else {
    actionBtns = `
      <button class="btn-icon" data-action="startRenameSubcategory" data-id="${c.id}">Rename</button>
      <button class="btn-icon danger" data-action="archiveSubcategory" data-id="${c.id}">Archive</button>`;
  }

  const visibleChildren = viewMode === 'archived'
    ? (c.subSubcategories || []).filter(item => item.archivedAt)
    : (c.subSubcategories || []).filter(item => !item.archivedAt);

  const childRows = visibleChildren.map((item) => renderSubSubcategoryRow(item)).join('');

  const addChildRow = (!isArchived && viewMode === 'active') ? `
    <div class="add-subcategory-row add-sub-subcategory-row">
      <div class="add-class-inputs">
        <input class="add-input" type="text" placeholder="New sub-sub-category…" maxlength="255"
               data-subcategory-id="${c.id}"
               data-enter="addSubSubcategoryFromInput" data-id="${c.id}" />
        <button class="btn-add" data-action="addSubSubcategoryFromButton" data-id="${c.id}">+ Add</button>
      </div>
      <textarea class="add-desc-input" rows="1" placeholder="Description (optional)…" maxlength="1000"></textarea>
    </div>` : '';

  return `
  <div class="subcategory-row ${isArchived ? 'archived-row' : ''}" data-class-id="${c.id}" id="subcategory-row-${c.id}">
    ${toggleBtn}
    <div class="subcategory-name-wrap">
      <span class="subcategory-name">${esc(c.name)}</span>
      ${c.description ? `<span class="subcategory-desc">${esc(c.description)}</span>` : ''}
    </div>
    ${countBadge}
    ${archivedBadge}
    ${actionBtns}
  </div>
  <div class="subcategory-children" data-subcategory-body-id="${c.id}" ${isOpen ? '' : 'hidden'}>
    ${childRows || (viewMode === 'archived' ? '' : '<div class="empty-subcategory-note">No sub-sub-categories yet.</div>')}
    ${addChildRow}
  </div>`;
}

function renderSubSubcategoryRow(c) {
  const isArchived = !!c.archivedAt;
  const archivedBadge = isArchived ? `<span class="badge-archived">ARCHIVED</span>` : '';
  const count = c.bookmarkCount ?? 0;
  const countBadge = `<span class="count-badge" title="${count} active bookmark${count === 1 ? '' : 's'}">${count}</span>`;
  const actionBtns = isArchived
    ? `<button class="btn-icon success" data-action="restoreSubSubcategory" data-id="${c.id}">↩ Restore</button>`
    : `<button class="btn-icon" data-action="startRenameSubSubcategory" data-id="${c.id}">Rename</button><button class="btn-icon danger" data-action="archiveSubSubcategory" data-id="${c.id}">Archive</button>`;

  return `
  <div class="subcategory-row ${isArchived ? 'archived-row' : ''}" data-sub-sub-id="${c.id}" id="sub-subcategory-row-${c.id}">
    <span class="row-indent"></span>
    <div class="subcategory-name-wrap">
      <span class="subcategory-name">${esc(c.name)}</span>
      ${c.description ? `<span class="subcategory-desc">${esc(c.description)}</span>` : ''}
    </div>
    ${countBadge}
    ${archivedBadge}
    ${actionBtns}
  </div>`;
}

// ── Add Category ──────────────────────────────────────────────────────────────
async function addCategory() {
  const input = document.getElementById('add-category-input');
  const descInput = document.getElementById('add-category-desc');
  const name = input.value.trim();
  if (!name) return;
  const description = descInput ? descInput.value.trim() : '';
  const btn = document.getElementById('btn-add-category');
  btn.disabled = true;
  try {
    const body = { name };
    if (description) body.description = description;
    const res = await apiFetch('/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to add category', 'error'); return; }
    input.value = '';
    if (descInput) descInput.value = '';
    toast(`Category "${name}" created`, 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Add Sub-category ─────────────────────────────────────────────────────
async function addSubcategory(categoryId, inputEl) {
  const name = inputEl.value.trim();
  if (!name) return;
  const addRow = inputEl.closest('.add-subcategory-row');
  const descEl = addRow ? addRow.querySelector('.add-desc-input') : null;
  const description = descEl ? descEl.value.trim() : '';
  const btn = addRow ? addRow.querySelector('.btn-add') : inputEl.nextElementSibling;
  btn.disabled = true;
  try {
    const body = { name };
    if (categoryId !== 0) body.categoryId = categoryId;
    if (description) body.description = description;
    const res = await apiFetch('/subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to add sub-category', 'error'); return; }
    inputEl.value = '';
    if (descEl) descEl.value = '';
    toast(`"${name}" added`, 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function addSubSubcategory(subcategoryId, inputEl) {
  const name = inputEl.value.trim();
  if (!name) return;
  const addRow = inputEl.closest('.add-subcategory-row');
  const descEl = addRow ? addRow.querySelector('.add-desc-input') : null;
  const description = descEl ? descEl.value.trim() : '';
  const btn = addRow ? addRow.querySelector('.btn-add') : inputEl.nextElementSibling;
  btn.disabled = true;
  try {
    const body = { name, subcategoryId };
    if (description) body.description = description;
    const res = await apiFetch('/subSubcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to add sub-sub-category', 'error'); return; }
    inputEl.value = '';
    if (descEl) descEl.value = '';
    toast(`"${name}" added`, 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Rename Category ───────────────────────────────────────────────────────────
function startRenameCategory(categoryId, e) {
  e.stopPropagation();
  const header = document.getElementById(`category-header-${categoryId}`);
  const nameWrap = header.querySelector('.category-name-wrap');
  const nameSpan = nameWrap.querySelector('.category-name');
  const descSpan = nameWrap.querySelector('.category-desc');
  const currentName = nameSpan.textContent;
  const currentDesc = descSpan ? descSpan.textContent : '';

  // Build inline edit container replacing the name-wrap
  const editWrap = document.createElement('div');
  editWrap.style.flex = '1';
  editWrap.style.display = 'flex';
  editWrap.style.flexDirection = 'column';
  editWrap.style.gap = '4px';

  const inp = document.createElement('input');
  inp.className = 'inline-input';
  inp.value = currentName;
  inp.maxLength = 255;

  const descInp = document.createElement('textarea');
  descInp.className = 'inline-desc-input';
  descInp.value = currentDesc;
  descInp.maxLength = 1000;
  descInp.rows = 2;
  descInp.placeholder = 'Description (optional)…';

  editWrap.appendChild(inp);
  editWrap.appendChild(descInp);
  nameWrap.replaceWith(editWrap);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-icon confirm';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-icon cancel';
  cancelBtn.textContent = 'Cancel';

  // Remove existing action buttons (Rename, Archive)
  const existingBtns = header.querySelectorAll('.btn-icon');
  existingBtns.forEach(b => b.remove());
  header.appendChild(saveBtn);
  header.appendChild(cancelBtn);

  inp.focus();
  inp.select();

  saveBtn.onclick = () => commitRenameCategory(categoryId, inp.value, descInp.value);
  cancelBtn.onclick = () => renderCategories();
  inp.onkeydown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitRenameCategory(categoryId, inp.value, descInp.value); }
    if (ev.key === 'Escape') renderCategories();
  };
}

async function commitRenameCategory(categoryId, newName, newDesc) {
  newName = newName.trim();
  if (!newName) return;
  newDesc = (newDesc || '').trim();
  try {
    const body = { name: newName, description: newDesc || null };
    const res = await apiFetch(`/categories/${categoryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to rename', 'error'); renderCategories(); return; }
    toast(`Renamed to "${newName}"`, 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
    renderCategories();
  }
}

// ── Rename Sub-category ──────────────────────────────────────────────────
function startRenameSubcategory(subcategoryId, e) {
  e.stopPropagation();
  const row = document.getElementById(`subcategory-row-${subcategoryId}`);
  const nameWrap = row.querySelector('.subcategory-name-wrap');
  const nameSpan = nameWrap.querySelector('.subcategory-name');
  const descSpan = nameWrap.querySelector('.subcategory-desc');
  const currentName = nameSpan.textContent;
  const currentDesc = descSpan ? descSpan.textContent : '';

  // Build inline edit container
  const editWrap = document.createElement('div');
  editWrap.style.flex = '1';
  editWrap.style.display = 'flex';
  editWrap.style.flexDirection = 'column';
  editWrap.style.gap = '4px';

  const inp = document.createElement('input');
  inp.className = 'inline-input';
  inp.value = currentName;
  inp.maxLength = 255;

  const descInp = document.createElement('textarea');
  descInp.className = 'inline-desc-input';
  descInp.value = currentDesc;
  descInp.maxLength = 1000;
  descInp.rows = 2;
  descInp.placeholder = 'Description (optional)…';

  editWrap.appendChild(inp);
  editWrap.appendChild(descInp);
  nameWrap.replaceWith(editWrap);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-icon confirm';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-icon cancel';
  cancelBtn.textContent = 'Cancel';

  // Remove existing action buttons
  const existingBtns = row.querySelectorAll('.btn-icon');
  existingBtns.forEach(b => b.remove());
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);

  inp.focus();
  inp.select();

  saveBtn.onclick = () => commitRenameSubcategory(subcategoryId, inp.value, descInp.value);
  cancelBtn.onclick = () => renderCategories();
  inp.onkeydown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitRenameSubcategory(subcategoryId, inp.value, descInp.value); }
    if (ev.key === 'Escape') renderCategories();
  };
}

async function commitRenameSubcategory(subcategoryId, newName, newDesc) {
  newName = newName.trim();
  if (!newName) return;
  newDesc = (newDesc || '').trim();
  try {
    const body = { name: newName };
    if (newDesc !== '') body.description = newDesc;
    else body.description = null; // explicitly clear if emptied
    const res = await apiFetch(`/subcategories/${subcategoryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to rename', 'error'); renderCategories(); return; }
    toast(`Renamed to "${newName}"`, 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
    renderCategories();
  }
}

function startRenameSubSubcategory(subSubcategoryId, e) {
  e.stopPropagation();
  const row = document.getElementById(`sub-subcategory-row-${subSubcategoryId}`);
  const nameWrap = row.querySelector('.subcategory-name-wrap');
  const nameSpan = nameWrap.querySelector('.subcategory-name');
  const descSpan = nameWrap.querySelector('.subcategory-desc');
  const currentName = nameSpan.textContent;
  const currentDesc = descSpan ? descSpan.textContent : '';

  const editWrap = document.createElement('div');
  editWrap.style.flex = '1';
  editWrap.style.display = 'flex';
  editWrap.style.flexDirection = 'column';
  editWrap.style.gap = '4px';

  const inp = document.createElement('input');
  inp.className = 'inline-input';
  inp.value = currentName;
  inp.maxLength = 255;

  const descInp = document.createElement('textarea');
  descInp.className = 'inline-desc-input';
  descInp.value = currentDesc;
  descInp.maxLength = 1000;
  descInp.rows = 2;
  descInp.placeholder = 'Description (optional)…';

  editWrap.appendChild(inp);
  editWrap.appendChild(descInp);
  nameWrap.replaceWith(editWrap);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-icon confirm';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-icon cancel';
  cancelBtn.textContent = 'Cancel';

  const existingBtns = row.querySelectorAll('.btn-icon');
  existingBtns.forEach(b => b.remove());
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);

  inp.focus();
  inp.select();

  saveBtn.onclick = () => commitRenameSubSubcategory(subSubcategoryId, inp.value, descInp.value);
  cancelBtn.onclick = () => renderCategories();
  inp.onkeydown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitRenameSubSubcategory(subSubcategoryId, inp.value, descInp.value); }
    if (ev.key === 'Escape') renderCategories();
  };
}

async function commitRenameSubSubcategory(subSubcategoryId, newName, newDesc) {
  newName = newName.trim();
  if (!newName) return;
  newDesc = (newDesc || '').trim();
  try {
    const body = { name: newName, description: newDesc || null };
    const res = await apiFetch(`/subSubcategories/${subSubcategoryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to rename', 'error'); renderCategories(); return; }
    toast(`Renamed to "${newName}"`, 'ok');
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
    renderCategories();
  }
}

// ── Archive / Restore Category ────────────────────────────────────────────────
async function archiveCategory(categoryId, e) {
  e.stopPropagation();
  if (!confirm('Archive this category? Its sub-categories will still exist but the category will be hidden.')) return;
  try {
    const res = await apiFetch(`/categories/${categoryId}/archive`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Category archived', 'ok');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function restoreCategory(categoryId, e) {
  e.stopPropagation();
  try {
    const res = await apiFetch(`/categories/${categoryId}/restore`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Category restored', 'ok');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Archive / Restore Sub-category ──────────────────────────────────────
async function archiveSubcategory(subcategoryId, e) {
  e.stopPropagation();
  if (!confirm('Archive this sub-category?')) return;
  try {
    const res = await apiFetch(`/subcategories/${subcategoryId}/archive`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Sub-category archived', 'ok');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function restoreSubcategory(subcategoryId, e) {
  e.stopPropagation();
  try {
    const res = await apiFetch(`/subcategories/${subcategoryId}/restore`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Sub-category restored', 'ok');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function archiveSubSubcategory(subSubcategoryId, e) {
  e.stopPropagation();
  if (!confirm('Archive this sub-sub-category?')) return;
  try {
    const res = await apiFetch(`/subSubcategories/${subSubcategoryId}/archive`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Sub-sub-category archived', 'ok');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function restoreSubSubcategory(subSubcategoryId, e) {
  e.stopPropagation();
  try {
    const res = await apiFetch(`/subSubcategories/${subSubcategoryId}/restore`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Sub-sub-category restored', 'ok');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Event wiring (no inline handlers, see common.js) ──────────────────────────
function rowInput(el) {
  return el.closest('.add-subcategory-row').querySelector('.add-input');
}
const byId = (fn) => (el, e) => fn(Number(el.dataset.id), e);
registerActions({
  setView:                     (el) => setView(el.dataset.arg),
  addCategory:                 () => addCategory(),
  toggleCategorySection:       byId(toggleCategorySection),
  restoreCategory:             byId(restoreCategory),
  startRenameCategory:         byId(startRenameCategory),
  archiveCategory:             byId(archiveCategory),
  addSubcategoryFromInput:     (el) => addSubcategory(Number(el.dataset.id), el),
  addSubcategoryFromButton:    (el) => addSubcategory(Number(el.dataset.id), rowInput(el)),
  toggleSubcategorySection:    byId(toggleSubcategorySection),
  restoreSubcategory:          byId(restoreSubcategory),
  startRenameSubcategory:      byId(startRenameSubcategory),
  archiveSubcategory:          byId(archiveSubcategory),
  addSubSubcategoryFromInput:  (el) => addSubSubcategory(Number(el.dataset.id), el),
  addSubSubcategoryFromButton: (el) => addSubSubcategory(Number(el.dataset.id), rowInput(el)),
  restoreSubSubcategory:       byId(restoreSubSubcategory),
  startRenameSubSubcategory:   byId(startRenameSubSubcategory),
  archiveSubSubcategory:       byId(archiveSubSubcategory),
});
