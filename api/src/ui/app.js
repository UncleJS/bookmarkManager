// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

// apiFetch, registerActions: see common.js

// ── Backup ─────────────────────────────────────────────────────────────────
function triggerBackup() {
  const token = window.prompt('Enter backup token:');
  if (token === null || token.trim() === '') return; // cancelled or empty

  fetch('/backup', {
    headers: { 'Authorization': 'Bearer ' + token.trim() },
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        alert('Backup failed: ' + (body.error ?? res.statusText));
        return;
      }
      // Derive filename from Content-Disposition or use a sensible default
      const disp  = res.headers.get('Content-Disposition') ?? '';
      const match = disp.match(/filename="?([^"]+)"?/);
      const fname = match ? match[1] : 'backup.sql.gz';

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch((err) => alert('Backup error: ' + err.message));
}

// ── State ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
let state = {
  subcategoryId: null,   // null = all
  subSubcategoryId: null,
  categoryId: null,
  filterTagId:      null,   // null = all
  filterFlag:       null,   // null | 'readLater' | 'hotTopic' | 'cheatsheets' | 'forReview'
  categoryLabel: 'All bookmarks',
  sortBy: 'newest',
  showArchived: false,
  page: 0,
  total: 0,
  lastItems: [],            // cached for edit modal
  tagSortOrder: 'count',    // 'count' | 'alpha'
  openCategories: new Set(), // set of top-level category IDs that are expanded
  openSubcategories: new Set(), // set of level-2 category IDs that are expanded
  searchQuery: '',          // full-text search term
};

// ── Boot ───────────────────────────────────────────────────────────────────
loadSidebar();
fetchBookmarks();

function syncOpenAncestorHeights(startEl) {
  let el = startEl?.parentElement || null;
  while (el) {
    if (
      el.classList &&
      el.classList.contains('open') &&
      (el.classList.contains('nav-category-items') || el.classList.contains('nav-subcategory-children'))
    ) {
      el.style.maxHeight = `${el.scrollHeight}px`;
    }
    el = el.parentElement;
  }
}

function setCollapsibleOpen(itemsContainer, open) {
  itemsContainer.classList.toggle('open', open);
  itemsContainer.style.maxHeight = open ? `${itemsContainer.scrollHeight}px` : '0px';
  syncOpenAncestorHeights(itemsContainer);
}

function isAllBookmarksActive() {
  return state.categoryId == null && state.subcategoryId == null && state.subSubcategoryId == null && state.filterTagId == null && state.filterFlag == null;
}

// ── Sidebar ────────────────────────────────────────────────────────────────
async function loadSidebar() {
  try {
    const [classRes, tagRes, flagRes] = await Promise.all([
      apiFetch('/subcategories'),
      apiFetch(`/tags?limit=100&sort=${state.tagSortOrder}`),
      apiFetch('/flag-counts'),
    ]);
    if (!classRes.ok) throw new Error(classRes.statusText);
    const { categories } = await classRes.json();
    const { items: tagItems } = tagRes.ok ? await tagRes.json() : { items: [] };
    const flagCounts = flagRes.ok ? await flagRes.json() : {};

    const nav = document.getElementById('sidebar-nav');
    const allBookmarksBtn = nav.querySelector('.nav-item[data-id=""]');
    Array.from(nav.children).forEach(child => {
      if (child !== allBookmarksBtn) child.remove();
    });
    if (allBookmarksBtn) allBookmarksBtn.classList.toggle('active', isAllBookmarksActive());

    // ── subtitle ─────────────────────────────────────────────────────────
    let totalCats = 0;
    categories.forEach(g => {
      g.subcategories.forEach(subcategory => {
        totalCats += 1;
        totalCats += (subcategory.subSubcategories || []).length;
      });
    });
    document.getElementById('sidebar-subtitle').textContent =
      `${totalCats} categories · ${tagItems.length} tags`;

    // ── Flags ─────────────────────────────────────────────────────────────
    const flagHeading = document.createElement('div');
    flagHeading.className = 'nav-category-heading';
    flagHeading.textContent = 'Flags';
    nav.appendChild(flagHeading);

    const flagDefs = [
      { key: 'readLater',   label: 'Read Later',  cls: 'flag-read' },
      { key: 'hotTopic',    label: 'Hot Topic',   cls: 'flag-hot'  },
      { key: 'cheatsheets', label: 'Cheatsheet',  cls: 'flag-cs'   },
      { key: 'forReview',   label: 'For Review',  cls: 'flag-rev'  },
    ];
    flagDefs.forEach(({ key, label, cls }) => {
      const btn = document.createElement('button');
      btn.className = `nav-item flag-dot ${cls}`;
      btn.title = label;
      if (state.filterFlag === key) btn.classList.add('active');
      btn.onclick = () => selectFlag(key, label, btn);

      const lbl = document.createElement('span');
      lbl.className = 'nav-item-label';
      lbl.textContent = label;

      const cnt = document.createElement('span');
      cnt.className = 'nav-item-count';
      cnt.textContent = String(flagCounts[key] ?? 0);

      btn.appendChild(lbl);
      btn.appendChild(cnt);
      nav.appendChild(btn);
    });

    // ── Categories ───────────────────────────────────────────────────────
    const catHeading = document.createElement('div');
    catHeading.className = 'nav-category-heading';
    catHeading.textContent = 'Categories';
    nav.appendChild(catHeading);

    categories.forEach(category => {
      const categoryDomId = `cat-category-${category.id}`;
      const childItems = category.subcategories || [];
      const categoryHasSelection = state.categoryId === category.id || childItems.some(c =>
        state.subcategoryId === c.id || (c.subSubcategories || []).some(ssc => state.subSubcategoryId === ssc.id)
      );
      const isOpen = (state.openCategories && state.openCategories.has(categoryDomId)) || categoryHasSelection;
      if (categoryHasSelection && childItems.length > 0) state.openCategories.add(categoryDomId);

      const heading = document.createElement('div');
      heading.className = 'nav-section-label' + (isOpen ? ' open' : '') + (state.categoryId === category.id ? ' active' : '');
      heading.dataset.categoryId = categoryDomId;

      const labelButton = document.createElement('button');
      labelButton.type = 'button';
      labelButton.className = 'nav-section-name';
      labelButton.textContent = category.name;
      labelButton.onclick = (event) => {
        event.stopPropagation();
        selectCategory(category.id, category.name);
      };
      heading.appendChild(labelButton);

      let itemsContainer = null;
      if (childItems.length > 0) {
        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.className = 'nav-section-chevron';
        chevron.textContent = '▶';
        chevron.setAttribute('aria-label', `Toggle ${category.name}`);
        chevron.onclick = (event) => {
          event.stopPropagation();
          const open = heading.classList.toggle('open');
          setCollapsibleOpen(itemsContainer, open);
          if (!state.openCategories) state.openCategories = new Set();
          if (open) state.openCategories.add(categoryDomId);
          else state.openCategories.delete(categoryDomId);
        };
        heading.appendChild(chevron);
      }
      nav.appendChild(heading);

      if (childItems.length === 0) return;

      itemsContainer = document.createElement('div');
      itemsContainer.className = 'nav-category-items' + (isOpen ? ' open' : '');
      itemsContainer.dataset.categoryId = categoryDomId;

      childItems.forEach(c => {
        const branch = document.createElement('div');
        branch.className = 'nav-subcategory-branch';

        const row = document.createElement('div');
        row.className = 'nav-subcategory-row';

        const btn = document.createElement('button');
        btn.className = 'nav-item cat-item';
        btn.dataset.id = String(c.id);
        btn.title = c.description || c.name;
        if (state.subcategoryId === c.id) btn.classList.add('active');
        btn.onclick = () => selectSubcategory(c.id, `${category.name} > ${c.name}`, btn);

        const label = document.createElement('span');
        label.className = 'nav-item-label';
        label.textContent = c.name;

        const count = document.createElement('span');
        count.className = 'nav-item-count';
        count.textContent = String(c.bookmarkCount ?? 0);

        btn.appendChild(label);
        btn.appendChild(count);
        row.appendChild(btn);

        const childItems = c.subSubcategories || [];
        const branchId = `cat-subcategory-${c.id}`;
        const branchHasSelection = childItems.some(ssc => state.subSubcategoryId === ssc.id);
        const isBranchOpen = childItems.length > 0 && ((state.openSubcategories && state.openSubcategories.has(branchId)) || branchHasSelection);
        if (branchHasSelection) state.openSubcategories.add(branchId);

        if (childItems.length > 0) {
          row.classList.add('has-children');

          const branchHint = document.createElement('span');
          branchHint.className = 'nav-item-branch-hint';
          branchHint.textContent = `${childItems.length} sub`;
          btn.insertBefore(branchHint, count);

          const branchToggle = document.createElement('button');
          branchToggle.type = 'button';
          branchToggle.className = 'nav-branch-toggle' + (isBranchOpen ? ' open' : '');
          branchToggle.dataset.subcategoryBranchId = branchId;
          branchToggle.title = isBranchOpen ? 'Collapse nested categories' : 'Expand nested categories';

          const branchChevron = document.createElement('span');
          branchChevron.className = 'nav-section-chevron';
          branchChevron.textContent = '▶';
          branchToggle.appendChild(branchChevron);
          branchToggle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const open = !branchToggle.classList.contains('open');
            branchToggle.classList.toggle('open', open);
            branchToggle.title = open ? 'Collapse nested categories' : 'Expand nested categories';
            setCollapsibleOpen(childContainer, open);
            if (!state.openSubcategories) state.openSubcategories = new Set();
            if (open) state.openSubcategories.add(branchId);
            else state.openSubcategories.delete(branchId);
          };
          row.appendChild(branchToggle);
        }

        branch.appendChild(row);

        const childContainer = document.createElement('div');
        childContainer.className = 'nav-subcategory-children' + (isBranchOpen ? ' open' : '');
        childContainer.dataset.subcategoryBranchId = branchId;

        childItems.forEach(ssc => {
          const childBtn = document.createElement('button');
          childBtn.className = 'nav-item cat-item sub-sub-item';
          childBtn.dataset.subSubId = String(ssc.id);
          childBtn.title = ssc.description || `${c.name} > ${ssc.name}`;
          if (state.subSubcategoryId === ssc.id) childBtn.classList.add('active');
          childBtn.onclick = () => selectSubSubcategory(ssc.id, `${category.name} > ${c.name} > ${ssc.name}`, childBtn);

          const childLabel = document.createElement('span');
          childLabel.className = 'nav-item-label';
          childLabel.textContent = `- ${ssc.name}`;

          const childCount = document.createElement('span');
          childCount.className = 'nav-item-count';
          childCount.textContent = String(ssc.bookmarkCount ?? 0);

          childBtn.appendChild(childLabel);
          childBtn.appendChild(childCount);
          childContainer.appendChild(childBtn);
        });

        branch.appendChild(childContainer);
        if (childItems.length > 0) setCollapsibleOpen(childContainer, isBranchOpen);

        itemsContainer.appendChild(branch);
      });

      nav.appendChild(itemsContainer);
      setCollapsibleOpen(itemsContainer, isOpen);
    });

    // ── Tags ──────────────────────────────────────────────────────────────
    if (tagItems.length > 0) {
      const tagHeading = document.createElement('div');
      tagHeading.className = 'nav-category-heading';
      tagHeading.id = 'tag-section-heading';

      const headingLabel = document.createElement('span');
      headingLabel.className = 'nav-category-heading-label';
      headingLabel.textContent = 'Tags';

      const sortToggle = document.createElement('div');
      sortToggle.className = 'tag-sort-toggle';

      const btnCount = document.createElement('button');
      btnCount.className = 'tag-sort-btn' + (state.tagSortOrder === 'count' ? ' active' : '');
      btnCount.textContent = '#';
      btnCount.title = 'Sort by count';

      const btnAlpha = document.createElement('button');
      btnAlpha.className = 'tag-sort-btn' + (state.tagSortOrder === 'alpha' ? ' active' : '');
      btnAlpha.textContent = 'A';
      btnAlpha.title = 'Sort alphabetically';

      btnCount.onclick = (e) => { e.stopPropagation(); setTagSort('count'); };
      btnAlpha.onclick = (e) => { e.stopPropagation(); setTagSort('alpha'); };

      sortToggle.appendChild(btnCount);
      sortToggle.appendChild(btnAlpha);
      tagHeading.appendChild(headingLabel);
      tagHeading.appendChild(sortToggle);
      nav.appendChild(tagHeading);

      renderTagList(tagItems);
    }

  } catch (e) {
    document.getElementById('sidebar-subtitle').textContent = 'Failed to load';
    console.error('loadSidebar:', e);
  }
}

function renderTagList(tagItems) {
  // Remove existing tag nav-items (but not the heading)
  document.querySelectorAll('.nav-item[data-tag-id]').forEach(el => el.remove());

  const nav = document.getElementById('sidebar-nav');

  tagItems.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.tagId = String(tag.id);
    btn.title = tag.name;
    if (state.filterTagId === tag.id) btn.classList.add('active');
    btn.onclick = () => selectTag(tag.id, `#${tag.name}`, btn);

    const lbl = document.createElement('span');
    lbl.className = 'nav-item-label';
    lbl.textContent = `#${tag.name}`;

    const cnt = document.createElement('span');
    cnt.className = 'nav-item-count';
    cnt.textContent = String(tag.bookmarkCount ?? 0);

    btn.appendChild(lbl);
    btn.appendChild(cnt);
    nav.appendChild(btn);
  });
}

async function setTagSort(order) {
  if (state.tagSortOrder === order) return;
  state.tagSortOrder = order;

  // Update toggle button appearance
  document.querySelectorAll('.tag-sort-btn').forEach(b => b.classList.remove('active'));
  const target = order === 'count'
    ? document.querySelector('.tag-sort-btn[title="Sort by count"]')
    : document.querySelector('.tag-sort-btn[title="Sort alphabetically"]');
  if (target) target.classList.add('active');

  // Fetch sorted tags and re-render
  try {
    const res = await apiFetch(`/tags?limit=200&sort=${order}`);
    if (!res.ok) return;
    const { items } = await res.json();
    renderTagList(items);
  } catch (e) {
    console.error('setTagSort:', e);
  }
}

// Refresh sidebar counts after any mutation (edit, archive, restore)
async function refreshCounts() {
  try {
    await loadSidebar();
  } catch (e) {
    console.error('refreshCounts:', e);
  }
}

function clearNavActive() {
  document.querySelectorAll('.nav-item, .nav-section-label').forEach(el => el.classList.remove('active'));
}

function selectSubcategory(id, label, btnEl) {
  clearNavActive();
  if (btnEl) btnEl.classList.add('active');
  state.categoryId = null;
  state.subcategoryId = id;
  state.subSubcategoryId = null;
  state.filterTagId      = null;
  state.filterFlag       = null;
  state.categoryLabel    = label;
  state.page = 0;
  document.getElementById('topbar-title').textContent = label;
  fetchBookmarks();
}

function selectSubSubcategory(id, label, btnEl) {
  clearNavActive();
  btnEl.classList.add('active');
  state.categoryId = null;
  state.subcategoryId = null;
  state.subSubcategoryId = id;
  state.filterTagId = null;
  state.filterFlag = null;
  state.categoryLabel = label;
  state.page = 0;
  document.getElementById('topbar-title').textContent = label;
  fetchBookmarks();
}

function selectFlag(flag, label, btnEl) {
  clearNavActive();
  btnEl.classList.add('active');
  state.categoryId = null;
  state.subcategoryId = null;
  state.subSubcategoryId = null;
  state.filterTagId      = null;
  state.filterFlag       = flag;
  state.categoryLabel    = label;
  state.page = 0;
  document.getElementById('topbar-title').textContent = label;
  fetchBookmarks();
}

function selectTag(id, label, btnEl) {
  clearNavActive();
  btnEl.classList.add('active');
  state.categoryId = null;
  state.subcategoryId = null;
  state.subSubcategoryId = null;
  state.filterTagId      = id;
  state.filterFlag       = null;
  state.categoryLabel    = label;
  state.page = 0;
  document.getElementById('topbar-title').textContent = label;
  fetchBookmarks();
}

function selectCategory(id, label) {
  clearNavActive();
  const categoryDomId = `cat-category-${id}`;
  const heading = document.querySelector(`.nav-section-label[data-category-id="${categoryDomId}"]`);
  if (heading) heading.classList.add('active');
  // Selecting a category also expands it, as the sidebar does when it re-renders.
  const items = document.querySelector(`.nav-category-items[data-category-id="${categoryDomId}"]`);
  if (heading && items && !heading.classList.contains('open')) {
    heading.classList.add('open');
    setCollapsibleOpen(items, true);
    state.openCategories.add(categoryDomId);
  }
  state.categoryId = id;
  state.subcategoryId = null;
  state.subSubcategoryId = null;
  state.filterTagId = null;
  state.filterFlag = null;
  state.categoryLabel = label;
  state.page = 0;
  document.getElementById('topbar-title').textContent = label;
  fetchBookmarks();
}

// ── Sort ───────────────────────────────────────────────────────────────────
function setSort(dir) {
  state.sortBy = dir;
  state.page = 0;
  document.getElementById('btn-newest').classList.toggle('active', dir === 'newest');
  document.getElementById('btn-oldest').classList.toggle('active', dir === 'oldest');
  fetchBookmarks();
}

// ── Archived toggle ────────────────────────────────────────────────────────
function setArchived(archived) {
  state.showArchived = archived;
  state.page = 0;
  document.getElementById('btn-active').classList.toggle('active', !archived);
  document.getElementById('btn-archived').classList.toggle('active', archived);
  fetchBookmarks();
}

// ── Pagination ─────────────────────────────────────────────────────────────
function changePage(delta) {
  const maxPage = Math.ceil(state.total / PAGE_SIZE) - 1;
  state.page = Math.max(0, Math.min(maxPage, state.page + delta));
  fetchBookmarks();
}

// ── Search ─────────────────────────────────────────────────────────────────
let searchTimer = null;

document.getElementById('search-q').addEventListener('input', (e) => {
  const val = e.target.value;
  e.target.classList.toggle('has-value', val.length > 0);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = val.trim();
    state.page = 0;
    fetchBookmarks();
  }, 300);
});

function clearSearch() {
  const input = document.getElementById('search-q');
  input.value = '';
  input.classList.remove('has-value');
  state.searchQuery = '';
  state.page = 0;
  input.focus();
  fetchBookmarks();
}

// ── Fetch & render bookmarks ───────────────────────────────────────────────
async function fetchBookmarks() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="state-box"><div class="icon">⏳</div>Loading…</div>';
  document.getElementById('pagination').style.display = 'none';

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(state.page * PAGE_SIZE),
    sortBy: state.sortBy,
  });
  if (state.searchQuery)      params.set('q', state.searchQuery);
  if (state.categoryId)       params.set('categoryId', String(state.categoryId));
  if (state.subcategoryId) params.set('subcategoryId', String(state.subcategoryId));
  if (state.subSubcategoryId) params.set('subSubcategoryId', String(state.subSubcategoryId));
  if (state.filterTagId)      params.set('tagId', String(state.filterTagId));
  if (state.filterFlag)       params.set('flag', state.filterFlag);
  if (state.showArchived)     params.set('archived', 'true');

  try {
    const res = await apiFetch('/bookmarks?' + params);
    if (!res.ok) throw new Error(res.statusText);
    const { items, total } = await res.json();

    state.total = total;
    state.lastItems = items;
    document.getElementById('topbar-count').textContent =
      total === 0 ? 'No bookmarks' : `${total} bookmark${total === 1 ? '' : 's'}`;

    if (items.length === 0) {
      content.innerHTML = '<div class="state-box"><div class="icon">🔍</div>No bookmarks here yet.</div>';
      return;
    }

    content.innerHTML = items.map(renderCard).join('');

    // Pagination
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages > 1) {
      const pg = document.getElementById('pagination');
      pg.style.display = 'flex';
      document.getElementById('btn-prev').disabled = state.page === 0;
      document.getElementById('btn-next').disabled = state.page >= totalPages - 1;
      document.getElementById('page-info').textContent =
        `Page ${state.page + 1} of ${totalPages}`;
    }

  } catch (e) {
    content.innerHTML = `<div class="state-box"><div class="icon">⚠️</div>Failed to load bookmarks.<br><small>${esc(e.message)}</small></div>`;
    console.error('fetchBookmarks:', e);
  }
}

// ── Card renderer ──────────────────────────────────────────────────────────
function renderCard(b) {
  const safeHttp = (() => {
    try {
      const parsed = new URL(b.url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
  })();
  const domain = safeHttp ? new URL(b.url).hostname : '';

  // Only http(s) and data:image favicons are rendered; there is no third-party
  // fallback, so bookmarked domains are never sent to an outside service.
  const favicon = safeHttp && isSafeFaviconUrl(b.faviconUrl)
    ? `<img class="card-favicon" src="${esc(b.faviconUrl)}" alt="" referrerpolicy="no-referrer" />`
    : `<span class="card-favicon card-favicon-placeholder" aria-hidden="true">${esc((domain[0] || '•').toUpperCase())}</span>`;

  const description = b.description
    ? `<div class="card-description">${esc(b.description)}</div>`
    : '';

  const tags = (b.tags || [])
    .map(t => `<span class="tag">#${esc(t.name)}</span>`)
    .join('');

  const classes = [
    ...(b.categories || []).map(c => ({ label: c.name })),
    ...(b.subcategories || []).map(c => ({ label: c.categoryName ? `${c.categoryName} > ${c.name}` : c.name })),
    ...(b.subSubcategories || []).map(c => ({ label: [c.categoryName, c.subcategoryName, c.name].filter(Boolean).join(' > ') })),
  ]
    .map(c => {
      const parts = c.label.split(' > ');
      if (parts.length === 1) return `<span class="subcategory-badge">${esc(c.label)}</span>`;
      return `<span class="subcategory-badge"><span class="subcategory-category">${esc(parts.slice(0, -1).join(' > '))} ›</span>${esc(parts[parts.length - 1])}</span>`;
    })
    .join('');

  const flagsHtml = [
    b.readLater  ? `<span class="flag flag-read">READ LATER</span>` : '',
    b.hotTopic   ? `<span class="flag flag-hot">HOT TOPIC</span>`   : '',
    b.cheatsheets? `<span class="flag flag-cs">CHEATSHEET</span>`   : '',
    b.forReview  ? `<span class="flag flag-rev">FOR REVIEW</span>`  : '',
    b.archivedAt ? `<span class="flag flag-archived">ARCHIVED</span>` : '',
  ].filter(Boolean).join('');

  const dateStr = BMDate.formatDateTime(b.createdAt);

  const flagsRow = flagsHtml
    ? `<div class="card-meta-row"><span class="card-meta-label">Flags</span>${flagsHtml}</div>` : '';
  const classesRow = classes
    ? `<div class="card-meta-row"><span class="card-meta-label">Categories</span>${classes}</div>` : '';
  const tagsRow = tags
    ? `<div class="card-meta-row"><span class="card-meta-label">Tags</span>${tags}</div>` : '';
  const dateRow = dateStr
    ? `<div class="card-meta-row"><span class="card-meta-label">Saved</span><span class="card-meta-date">${dateStr}</span></div>` : '';

  const actionBtn = state.showArchived
    ? `<button class="btn-restore" data-id="${b.id}" title="Restore bookmark">↩ Restore</button>`
    : `<button class="btn-edit" data-id="${b.id}" title="Edit bookmark">✎ Edit</button><button class="btn-archive" data-id="${b.id}" title="Archive bookmark">Archive</button>`;

  return `
  <div class="card" data-bookmark-id="${b.id}">
    <div class="card-title-row">
      ${favicon}
      <div class="card-title">
        ${safeHttp
          ? `<a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.title)}</a>`
          : `<span>${esc(b.title)}</span>`}
      </div>
    </div>
    <div class="card-url">${esc(b.url)}</div>
    ${description}
    <div class="card-meta">
      ${flagsRow}${classesRow}${tagsRow}${dateRow}
    </div>
    <div class="card-actions">${actionBtn}</div>
  </div>`;
}

// ── Archive / Restore actions (delegated) ──────────────────────────────────
document.getElementById('content').addEventListener('click', async (e) => {
  const editBtn    = e.target.closest('.btn-edit');
  const archiveBtn = e.target.closest('.btn-archive');
  const restoreBtn = e.target.closest('.btn-restore');
  if (!editBtn && !archiveBtn && !restoreBtn) return;

  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    const card = editBtn.closest('.card');
    // Read current data from the rendered card's bookmark data
    const bm = state.lastItems?.find(b => b.id === id);
    if (bm) openModal(bm);
    return;
  }

  const btn = archiveBtn || restoreBtn;
  const id = btn.dataset.id;
  const action = archiveBtn ? 'archive' : 'restore';

  if (archiveBtn) {
    const bm = state.lastItems?.find(b => String(b.id) === id);
    const label = bm?.title ? `"${bm.title}"` : 'this bookmark';
    if (!confirm(`Archive ${label}?`)) return;
  }

  btn.disabled = true;
  btn.textContent = action === 'archive' ? 'Archiving…' : 'Restoring…';

  try {
    const res = await apiFetch(`/bookmarks/${id}/${action}`, { method: 'PATCH' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `Failed to ${action}`);
      btn.disabled = false;
      btn.textContent = action === 'archive' ? 'Archive' : '↩ Restore';
      return;
    }
    // Remove the card from the current view immediately
    const card = btn.closest('.card');
    card.style.transition = 'opacity 0.2s';
    card.style.opacity = '0';
    setTimeout(() => {
      card.remove();
      // Update the count
      state.total = Math.max(0, state.total - 1);
      document.getElementById('topbar-count').textContent =
        state.total === 0 ? 'No bookmarks' :
        `${state.total} bookmark${state.total === 1 ? '' : 's'}`;
      if (document.querySelectorAll('.card').length === 0) {
        document.getElementById('content').innerHTML =
          `<div class="state-box"><div class="icon">🔍</div>No bookmarks here yet.</div>`;
      }
      refreshCounts();   // update sidebar counts
    }, 200);
  } catch (err) {
    alert(`Failed to ${action}: ${err.message}`);
    btn.disabled = false;
    btn.textContent = action === 'archive' ? 'Archive' : '↩ Restore';
  }
});

// ── Edit modal ─────────────────────────────────────────────────────────────
let modalState = {
  bookmarkId: null,
  taxonomyTree: [],
  allTaxonomyItems: [],
  allCategories:  [],   // [{id, name}]  — for the create-subcategory sub-modal
  allTags:    [],   // [{id, name}]
  selCategoryIds: new Set(),
  selSubcategoryIds: new Set(),
  selSubSubcategoryIds: new Set(),
  selTagIds:   new Set(),
  cascadeCategoryId: '',
  cascadeSubcategoryId: '',
  cascadeSubSubcategoryId: '',
};

function compareTagNames(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

// Pre-load subcategories & tags for the modal (shared data, refreshed on open)
async function loadModalData() {
  const [cRes, tRes] = await Promise.all([
    apiFetch('/subcategories'),
    apiFetch('/tags?limit=200'),
  ]);
  const { categories } = await cRes.json();
  const { items: tagItems } = await tRes.json();

  // Flatten all active subcategories and sub-sub-categories with breadcrumb info
  const flatTaxonomyItems = [];
  const flatCategories = [];
  categories.forEach(category => {
    if (category.name !== 'Uncategorized') {
      const categoryItem = { id: category.id, name: category.name, kind: 'category', label: category.name, categoryId: category.id, categoryName: category.name, subcategoryName: null, parentSubcategoryId: null };
      flatCategories.push({ id: category.id, name: category.name });
      flatTaxonomyItems.push(categoryItem);
    }
    category.subcategories.forEach(subcategory => {
      flatTaxonomyItems.push({
        id: subcategory.id,
        name: subcategory.name,
        kind: 'subcategory',
        categoryId: category.name !== 'Uncategorized' ? category.id : null,
        label: category.name !== 'Uncategorized' ? `${category.name} > ${subcategory.name}` : subcategory.name,
        categoryName: category.name !== 'Uncategorized' ? category.name : null,
        subcategoryName: null,
        parentSubcategoryId: null,
      });
      (subcategory.subSubcategories || []).forEach(subSubcategory => {
        flatTaxonomyItems.push({
          id: subSubcategory.id,
          name: subSubcategory.name,
          kind: 'subSubcategory',
          categoryId: category.name !== 'Uncategorized' ? category.id : null,
          label: [category.name !== 'Uncategorized' ? category.name : null, subcategory.name, subSubcategory.name].filter(Boolean).join(' > '),
          categoryName: category.name !== 'Uncategorized' ? category.name : null,
          subcategoryName: subcategory.name,
          parentSubcategoryId: subcategory.id,
        });
      });
    });
  });
  modalState.taxonomyTree = categories.map(category => ({
    id: category.id,
    name: category.name,
    subcategories: (category.subcategories || []).map(subcategory => ({
      id: subcategory.id,
      name: subcategory.name,
      subSubcategories: (subcategory.subSubcategories || []).map(subSubcategory => ({
        id: subSubcategory.id,
        name: subSubcategory.name,
      })),
    })),
  }));
  modalState.allTaxonomyItems = flatTaxonomyItems;
  modalState.allCategories  = flatCategories;
  modalState.allTags = [...tagItems].sort(compareTagNames);
}

async function openModal(bm) {
  await loadModalData();

  modalState.bookmarkId = bm.id;
  modalState.selCategoryIds = new Set((bm.categories || []).map(c => c.id));
  modalState.selSubcategoryIds = new Set((bm.subcategories || []).map(c => c.id));
  modalState.selSubSubcategoryIds = new Set((bm.subSubcategories || []).map(c => c.id));
  modalState.selTagIds   = new Set((bm.tags || []).map(t => t.id));

  modalState.allTaxonomyItems.forEach(item => {
    if (item.kind === 'subSubcategory' && modalState.selSubSubcategoryIds.has(item.id) && item.parentSubcategoryId != null) {
      modalState.selSubcategoryIds.delete(item.parentSubcategoryId);
    }
  });

  document.getElementById('edit-title').value = bm.title || '';
  document.getElementById('edit-url').value = bm.url || '';
  document.getElementById('edit-description').value = bm.description || '';
  document.getElementById('flag-readLater').checked   = !!bm.readLater;
  document.getElementById('flag-hotTopic').checked    = !!bm.hotTopic;
  document.getElementById('flag-cheatsheets').checked = !!bm.cheatsheets;
  document.getElementById('flag-forReview').checked   = !!bm.forReview;

  document.getElementById('tag-search').value   = '';
  resetTaxonomyCascade();
  renderSelectedTaxonomy();
  renderTaxonomyCascade();
  renderChips('tag');

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('edit-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// Close on overlay click (outside modal box)
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// Close on Escape — but if tag-search has content, just clear it first
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const tagSearch = document.getElementById('tag-search');
  if (tagSearch && tagSearch.value) {
    tagSearch.value = '';
    renderChips('tag');
  } else {
    closeModal();
  }
});

function filterChips(type) { renderChips(type); }

function normalizeTaxonomyCategoryId(value) {
  if (value === '' || value == null) return '';
  return String(value);
}

function getSelectedTaxonomyItems() {
  return modalState.allTaxonomyItems.filter(item => {
    if (item.kind === 'category') return modalState.selCategoryIds.has(item.id);
    if (item.kind === 'subSubcategory') return modalState.selSubSubcategoryIds.has(item.id);
    return modalState.selSubcategoryIds.has(item.id);
  }).sort((a, b) => a.label.localeCompare(b.label));
}

function renderSelectedTaxonomy() {
  const container = document.getElementById('selected-taxonomy');
  const items = getSelectedTaxonomyItems();
  if (!items.length) {
    container.innerHTML = '<span class="taxonomy-empty">No categories selected.</span>';
    return;
  }

  container.innerHTML = items.map(item => (
    `<span class="taxonomy-chip" data-id="${item.id}" data-kind="${item.kind}">` +
    `${esc(item.label)}` +
    `<button type="button" title="Remove ${esc(item.label)}" aria-label="Remove ${esc(item.label)}">x</button>` +
    `</span>`
  )).join('');
}

function getCascadeCategoryOptions() {
  return modalState.taxonomyTree.filter(category => category.name !== 'Uncategorized');
}

function getCascadeSelectedCategory() {
  return getCascadeCategoryOptions().find(category => normalizeTaxonomyCategoryId(category.id) === modalState.cascadeCategoryId) || null;
}

function getCascadeSelectedSubcategory() {
  const category = getCascadeSelectedCategory();
  if (!category) return null;
  return (category.subcategories || []).find(subcategory => String(subcategory.id) === modalState.cascadeSubcategoryId) || null;
}

function getPendingTaxonomySelection() {
  const subSubcategory = getCascadeSelectedSubcategory()?.subSubcategories?.find(item => String(item.id) === modalState.cascadeSubSubcategoryId) || null;
  if (subSubcategory) {
    return {
      kind: 'subSubcategory',
      id: subSubcategory.id,
      alreadySelected: modalState.selSubSubcategoryIds.has(subSubcategory.id),
    };
  }

  const subcategory = getCascadeSelectedSubcategory();
  if (subcategory) {
    return {
      kind: 'subcategory',
      id: subcategory.id,
      alreadySelected: modalState.selSubcategoryIds.has(subcategory.id),
    };
  }

  const category = getCascadeSelectedCategory();
  if (category) {
    return {
      kind: 'category',
      id: category.id,
      alreadySelected: modalState.selCategoryIds.has(category.id),
    };
  }

  return null;
}

function updateTaxonomyAddButton() {
  const btn = document.getElementById('taxonomy-add-btn');
  const pending = getPendingTaxonomySelection();
  if (!pending) {
    btn.disabled = true;
    btn.textContent = 'Add selection';
    return;
  }

  btn.disabled = pending.alreadySelected;
  btn.textContent = pending.kind === 'subSubcategory'
    ? 'Add sub-sub-category'
    : pending.kind === 'subcategory'
      ? 'Add sub-category'
      : 'Add category';
}

function renderTaxonomyCascade() {
  const categorySelect = document.getElementById('taxonomy-category-select');
  const subcategorySelect = document.getElementById('taxonomy-subcategory-select');
  const subSubcategorySelect = document.getElementById('taxonomy-subsubcategory-select');

  const categories = getCascadeCategoryOptions();
  categorySelect.innerHTML = '<option value="">Select category</option>' + categories.map(category => (
    `<option value="${category.id}">${esc(category.name)}</option>`
  )).join('');
  categorySelect.value = modalState.cascadeCategoryId;

  const selectedCategory = getCascadeSelectedCategory();
  const subcategories = selectedCategory?.subcategories || [];
  subcategorySelect.innerHTML = '<option value="">Select sub-category</option>' + subcategories.map(subcategory => (
    `<option value="${subcategory.id}">${esc(subcategory.name)}</option>`
  )).join('');
  subcategorySelect.disabled = !selectedCategory || subcategories.length === 0;
  subcategorySelect.value = modalState.cascadeSubcategoryId;

  const selectedSubcategory = getCascadeSelectedSubcategory();
  const subSubcategories = selectedSubcategory?.subSubcategories || [];
  subSubcategorySelect.innerHTML = '<option value="">Select sub-sub-category (optional)</option>' + subSubcategories.map(subSubcategory => (
    `<option value="${subSubcategory.id}">${esc(subSubcategory.name)}</option>`
  )).join('');
  subSubcategorySelect.disabled = !selectedSubcategory || subSubcategories.length === 0;
  if (subSubcategorySelect.disabled) {
    modalState.cascadeSubSubcategoryId = '';
    subSubcategorySelect.value = '';
  } else {
    subSubcategorySelect.value = modalState.cascadeSubSubcategoryId;
  }

  updateTaxonomyAddButton();
}

function resetTaxonomyCascade() {
  modalState.cascadeCategoryId = '';
  modalState.cascadeSubcategoryId = '';
  modalState.cascadeSubSubcategoryId = '';
}

function onTaxonomyCategoryChange() {
  modalState.cascadeCategoryId = document.getElementById('taxonomy-category-select').value;
  modalState.cascadeSubcategoryId = '';
  modalState.cascadeSubSubcategoryId = '';
  renderTaxonomyCascade();
}

function onTaxonomySubcategoryChange() {
  modalState.cascadeSubcategoryId = document.getElementById('taxonomy-subcategory-select').value;
  modalState.cascadeSubSubcategoryId = '';
  renderTaxonomyCascade();
}

function onTaxonomySubSubcategoryChange() {
  modalState.cascadeSubSubcategoryId = document.getElementById('taxonomy-subsubcategory-select').value;
  updateTaxonomyAddButton();
}

function addSelectedTaxonomy() {
  const pending = getPendingTaxonomySelection();
  if (!pending || pending.alreadySelected) return;

  if (pending.kind === 'category') {
    modalState.selCategoryIds.add(pending.id);
    modalState.allTaxonomyItems.forEach(item => {
      if (item.categoryId === pending.id) {
        if (item.kind === 'subcategory') modalState.selSubcategoryIds.delete(item.id);
        if (item.kind === 'subSubcategory') modalState.selSubSubcategoryIds.delete(item.id);
      }
    });
  } else if (pending.kind === 'subSubcategory') {
    modalState.selSubSubcategoryIds.add(pending.id);
    const parentSubcategoryId = modalState.allTaxonomyItems.find(item => item.kind === 'subSubcategory' && item.id === pending.id)?.parentSubcategoryId;
    if (parentSubcategoryId != null) modalState.selSubcategoryIds.delete(parentSubcategoryId);
    const categoryId = modalState.allTaxonomyItems.find(item => item.kind === 'subSubcategory' && item.id === pending.id)?.categoryId;
    if (categoryId != null) modalState.selCategoryIds.delete(categoryId);
  } else {
    modalState.selSubcategoryIds.add(pending.id);
    const categoryId = modalState.allTaxonomyItems.find(item => item.kind === 'subcategory' && item.id === pending.id)?.categoryId;
    if (categoryId != null) modalState.selCategoryIds.delete(categoryId);
    modalState.allTaxonomyItems.forEach(item => {
      if (item.kind === 'subSubcategory' && item.parentSubcategoryId === pending.id) {
        modalState.selSubSubcategoryIds.delete(item.id);
      }
    });
  }

  renderSelectedTaxonomy();
  resetTaxonomyCascade();
  renderTaxonomyCascade();
}

document.getElementById('selected-taxonomy').addEventListener('click', e => {
  const chip = e.target.closest('.taxonomy-chip');
  if (!chip) return;
  const id = Number(chip.dataset.id);
  if (chip.dataset.kind === 'category') modalState.selCategoryIds.delete(id);
  else if (chip.dataset.kind === 'subSubcategory') modalState.selSubSubcategoryIds.delete(id);
  else modalState.selSubcategoryIds.delete(id);
  renderSelectedTaxonomy();
  updateTaxonomyAddButton();
});

function renderChips(type) {
  const isClass = type === 'class';
  if (isClass) return;

  const query = (document.getElementById('tag-search').value || '').toLowerCase();
  const list  = document.getElementById('tag-chips');
  const items = modalState.allTags;
  const filtered = items
    .filter(item => item.name.toLowerCase().includes(query))
    .sort(compareTagNames);

  list.innerHTML = filtered.map(item => {
    const sel = modalState.selTagIds.has(item.id);
    return `<span class="picker-chip${sel ? ' selected' : ''}" data-id="${item.id}" data-kind="${item.kind || ''}" data-type="${type}">${esc(item.name)}</span>`;
  }).join('');

  // Show "create" chip for tags if no exact match
  if (!isClass && query && !items.some(t => t.name.toLowerCase() === query)) {
    list.innerHTML += `<span class="picker-chip" data-type="tag-create" data-name="${esc(query)}">+ "${esc(query)}"</span>`;
  }
}

// ── Create-subcategory sub-modal ────────────────────────────────────────
function openCreateSubcategoryModal() {
  // Reset form
  document.getElementById('cc-name').value = '';
  document.getElementById('cc-description').value = '';
  document.getElementById('cc-new-category-name').value = '';
  document.getElementById('create-class-error').textContent = '';
  document.querySelector('input[name="cc-category-option"][value="none"]').checked = true;
  updateCCCategorySections();

  // Populate existing-categories dropdown
  const sel = document.getElementById('cc-existing-select');
  sel.innerHTML = '<option value="">— choose —</option>';
  const existingRadioLabel = document.getElementById('cc-existing-radio-label');
  if (modalState.allCategories.length === 0) {
    existingRadioLabel.style.opacity = '0.4';
    existingRadioLabel.querySelector('input').disabled = true;
  } else {
    existingRadioLabel.style.opacity = '1';
    existingRadioLabel.querySelector('input').disabled = false;
    modalState.allCategories.forEach(g => {
      const opt = document.createElement('option');
      opt.value = String(g.id);
      opt.textContent = g.name;
      sel.appendChild(opt);
    });
  }

  document.getElementById('create-class-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cc-name').focus(), 60);
}

function closeCreateClassModal() {
  document.getElementById('create-class-overlay').classList.remove('open');
}

function updateCCCategorySections() {
  const val = document.querySelector('input[name="cc-category-option"]:checked')?.value;
  document.getElementById('cc-existing-section').hidden = val !== 'existing';
  document.getElementById('cc-new-section').hidden      = val !== 'new';
}

async function handleCreateSubcategory() {
  const errEl  = document.getElementById('create-class-error');
  const btn    = document.getElementById('cc-create-btn');
  const name   = document.getElementById('cc-name').value.trim();

  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Sub-category name is required.'; return; }

  const categoryOption = document.querySelector('input[name="cc-category-option"]:checked')?.value;
  let categoryId   = null;
  let categoryName = null;

  if (categoryOption === 'existing') {
    const v = document.getElementById('cc-existing-select').value;
    categoryId = v ? Number(v) : null;
    if (!categoryId) { errEl.textContent = 'Please select an existing category.'; return; }
  } else if (categoryOption === 'new') {
    categoryName = document.getElementById('cc-new-category-name').value.trim() || null;
    if (!categoryName) { errEl.textContent = 'Please enter a name for the new category.'; return; }
  }

  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const description = (document.getElementById('cc-description').value || '').trim();
    const payload = { name };
    if (categoryId   != null) payload.categoryId   = categoryId;
    if (categoryName != null) payload.categoryName = categoryName;
    if (description)       payload.description = description;

    const res  = await apiFetch('/subcategories', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to create sub-category.';
      return;
    }

    // Resolve the category name for display
    let resolvedCategoryName = null;
    if (categoryOption === 'existing') {
      resolvedCategoryName = modalState.allCategories.find(g => g.id === categoryId)?.name ?? null;
    } else if (categoryOption === 'new') {
      resolvedCategoryName = categoryName;
      // If the API returned a new categoryId, add it to allCategories so the dropdown stays current
      if (data.categoryId) {
        const already = modalState.allCategories.some(g => g.id === data.categoryId);
        if (!already) modalState.allCategories.push({ id: data.categoryId, name: categoryName });
      }
    }

    // Add to local state and auto-select
    const newClass = {
      id: data.id,
      name: data.name,
      kind: 'subcategory',
      label: resolvedCategoryName ? `${resolvedCategoryName} > ${data.name}` : data.name,
      categoryName: resolvedCategoryName,
      subcategoryName: null,
    };
    modalState.allTaxonomyItems.push(newClass);
    modalState.selSubcategoryIds.add(data.id);
    if (data.categoryId != null) modalState.selCategoryIds.delete(data.categoryId);
    const targetCategoryId = data.categoryId == null ? 0 : data.categoryId;
    const targetCategoryName = resolvedCategoryName || 'Uncategorized';
    let didUpdateTree = false;
    modalState.taxonomyTree = modalState.taxonomyTree.map(category => {
      if (normalizeTaxonomyCategoryId(category.id) !== normalizeTaxonomyCategoryId(targetCategoryId)) return category;
      didUpdateTree = true;
      return {
        ...category,
        subcategories: [...category.subcategories, { id: data.id, name: data.name, subSubcategories: [] }]
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    if (!didUpdateTree) {
      modalState.taxonomyTree.push({
        id: targetCategoryId,
        name: targetCategoryName,
        subcategories: [{ id: data.id, name: data.name, subSubcategories: [] }],
      });
      modalState.taxonomyTree.sort((a, b) => a.name.localeCompare(b.name));
    }

    closeCreateClassModal();
    renderSelectedTaxonomy();
    resetTaxonomyCascade();
    renderTaxonomyCascade();
  } catch (err) {
    errEl.textContent = 'Failed to create sub-category: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create';
  }
}

// Close sub-modal on overlay click
document.getElementById('create-class-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('create-class-overlay')) closeCreateClassModal();
});

// Enter in cc-name submits the form
document.getElementById('cc-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); handleCreateSubcategory(); }
});

async function createOrSelectTag(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  // If an exact match exists, just select it
  const existing = modalState.allTags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    modalState.selTagIds.add(existing.id);
    document.getElementById('tag-search').value = '';
    renderChips('tag');
    return;
  }

  // Otherwise create it
  try {
    const res = await apiFetch('/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to create tag'); return; }
    modalState.allTags.push({ id: data.id, name: data.name });
    modalState.allTags.sort(compareTagNames);
    modalState.selTagIds.add(data.id);
    document.getElementById('tag-search').value = '';
    renderChips('tag');
  } catch (err) { alert('Failed to create tag: ' + err.message); }
}

// Enter in tag search → create/select immediately
document.getElementById('tag-search').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  await createOrSelectTag(document.getElementById('tag-search').value);
});

document.getElementById('tag-chips').addEventListener('click', async e => {
  const chip = e.target.closest('.picker-chip');
  if (!chip) return;

  if (chip.dataset.type === 'tag-create') {
    await createOrSelectTag(chip.dataset.name);
    return;
  }

  const id = Number(chip.dataset.id);
  if (modalState.selTagIds.has(id)) modalState.selTagIds.delete(id);
  else modalState.selTagIds.add(id);
  renderChips('tag');
});

async function saveEdit() {
  const saveBtn = document.getElementById('modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const body = {
    title:             document.getElementById('edit-title').value.trim(),
    url:               document.getElementById('edit-url').value.trim() || undefined,
    description:       document.getElementById('edit-description').value.trim() || null,
    categoryIds:       [...modalState.selCategoryIds],
    subcategoryIds: [...modalState.selSubcategoryIds],
    subSubcategoryIds: [...modalState.selSubSubcategoryIds],
    tagIds:            [...modalState.selTagIds],
    flags: {
      readLater:   document.getElementById('flag-readLater').checked,
      hotTopic:    document.getElementById('flag-hotTopic').checked,
      cheatsheets: document.getElementById('flag-cheatsheets').checked,
      forReview:   document.getElementById('flag-forReview').checked,
    },
  };

  try {
    const res = await apiFetch(`/bookmarks/${modalState.bookmarkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to save');
      return;
    }
    closeModal();
    await fetchBookmarks();    // reload to show updated card
    await refreshCounts();     // update sidebar counts
  } catch (err) {
    alert('Failed to save: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
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
registerActions({
  selectAll:                     (el) => selectSubcategory(null, 'All bookmarks', el),
  clearSearch:                   () => clearSearch(),
  triggerBackup:                 () => triggerBackup(),
  setArchived:                   (el) => setArchived(el.dataset.arg === 'true'),
  setSort:                       (el) => setSort(el.dataset.arg),
  changePage:                    (el) => changePage(Number(el.dataset.arg)),
  onTaxonomyCategoryChange:      () => onTaxonomyCategoryChange(),
  onTaxonomySubcategoryChange:   () => onTaxonomySubcategoryChange(),
  onTaxonomySubSubcategoryChange:() => onTaxonomySubSubcategoryChange(),
  addSelectedTaxonomy:           () => addSelectedTaxonomy(),
  openCreateSubcategoryModal:    () => openCreateSubcategoryModal(),
  filterChips:                   (el) => filterChips(el.dataset.arg),
  closeModal:                    () => closeModal(),
  saveEdit:                      () => saveEdit(),
  updateCCCategorySections:      () => updateCCCategorySections(),
  closeCreateClassModal:         () => closeCreateClassModal(),
  handleCreateSubcategory:       () => handleCreateSubcategory(),
});
