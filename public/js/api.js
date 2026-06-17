/* Shared API helpers */

async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ── Quill rich text editor helpers ────────────────────────────────────────────
const _quills = {};
const _QUILL_OPTS = {
  modules: { toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ color: [] }]
  ]},
  theme: 'snow'
};

function _initQuill(id, placeholder) {
  if (_quills[id]) { delete _quills[id]; }
  const el = document.getElementById(id);
  if (!el) return null;
  el.innerHTML = '';
  const q = new Quill(el, { ..._QUILL_OPTS, placeholder: placeholder || '' });
  _quills[id] = q;
  return q;
}

function _quillVal(id) {
  const q = _quills[id];
  if (!q) return '';
  const html = q.root.innerHTML;
  return html === '<p><br></p>' ? '' : html;
}

function _quillSet(id, html) {
  const q = _quills[id];
  if (!q) return;
  if (html) q.clipboard.dangerouslyPasteHTML(html);
  else q.setContents([]);
}

// ── Section switching ────────────────────────────────────────────────────────
function showSection(id, navEl) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard:'Dashboard', events:'Events & Programs', tasks:'Action Items',
    contacts:'Board Directory', files:'Files & Docs', minutes:'Meeting Minutes',
    reports:'Reports', settings:'Settings', members:'Contacts', volunteers:'Volunteers',
    mytasks:'My Tasks', mysignups:'My Sign-Ups', resources:'Resources', myteam:'My Team'
  };
  const pt = document.getElementById('pageTitle');
  if (pt) pt.textContent = titles[id] || id;

  closeMobileSidebar();
}

// Convenience wrapper used by clickable stat cards: jumps to the matching
// sidebar section without needing a reference to the nav button element.
function goToSection(id) {
  showSection(id, document.querySelector(`[data-section="${id}"]`));
}

// ── Mobile sidebar (hamburger) ──────────────────────────────────────────────
function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}

(function wireMobileSidebar() {
  const btn     = document.getElementById('hamburgerBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn || !sidebar) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    sidebar.classList.toggle('mobile-open');
    overlay?.classList.toggle('open');
  });
  overlay?.addEventListener('click', closeMobileSidebar);
})();

// ── Formatting helpers ───────────────────────────────────────────────────────
function fmtDate(str) {
  if (!str) return '—';
  // Plain YYYY-MM-DD strings are parsed by `Date` as UTC midnight; without
  // forcing local midnight here, users west of UTC see the previous day.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? str + 'T00:00:00' : str);
  return isNaN(d) ? str : d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function fmtDateBlock(str) {
  if (!str) return { month:'—', day:'—' };
  const d = new Date(str + 'T00:00:00');
  return {
    month: d.toLocaleDateString('en-US', { month:'short' }).toUpperCase(),
    day:   d.getDate()
  };
}

function statusPill(status) {
  if (!status) return '';
  const cls = status.toLowerCase().replace(/[^a-z]/g,'');
  return `<span class="status-pill ${cls}">${status}</span>`;
}

function priorityPill(p) {
  if (!p) return '';
  const cls = p.toLowerCase() === 'high' ? 'high' : p.toLowerCase() === 'medium' ? 'pending' : 'completed';
  return `<span class="status-pill ${cls}">${p}</span>`;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

function avatarHtml(name, photo) {
  if (photo) return `<img class="avatar" src="${photo}" alt="${name}">`;
  return `<div class="avatar-initials">${initials(name)}</div>`;
}

function emptyState(msg) {
  return `<div class="empty-state"><p>${msg}</p></div>`;
}

// ── Document links ───────────────────────────────────────────────────────────
// Resolution order: FileURL → DriveFileID (build a Drive view link) → no link.
function docLinkInfo(d) {
  if (d.FileURL) return { href: d.FileURL };
  if (d.DriveFileID) return { href: `https://drive.google.com/file/d/${d.DriveFileID}/view` };
  return { href: null };
}

const NO_LINK_TOOLTIP = 'No link available — update in the Database sheet';

function docTitleHtml(d) {
  const title = d.Title || '—';
  const { href } = docLinkInfo(d);
  if (href) return `<a href="${href}" target="_blank" rel="noopener" style="color:var(--text-white);">${title}</a>`;
  return `<span title="${NO_LINK_TOOLTIP}" style="color:var(--text-dim);cursor:help;">${title}</span>`;
}

// Shared row renderer used by the Documents page, Recent Files widget, and
// volunteer Resources — the whole row opens the link (not just the title),
// Board-only documents get a 🔒, and rows with no link show a disabled
// tooltip instead of a dead link.
function documentRow(d) {
  const { href } = docLinkInfo(d);
  const isBoardOnly = (d.AccessLevel || '').toLowerCase() === 'board';
  const rowAttrs = href
    ? ` class="list-item clickable" role="button" tabindex="0" onclick="window.open('${href}','_blank','noopener')" onkeydown="if(event.key==='Enter')window.open('${href}','_blank','noopener')"`
    : ` class="list-item" title="${NO_LINK_TOOLTIP}" style="cursor:help;"`;
  return `
    <div${rowAttrs}>
      <div class="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="item-info">
        <div class="item-title">${d.Title || '—'}${isBoardOnly ? `<span class="doc-lock" title="Board only — restricted to the gorock.org Workspace domain">🔒</span>` : ''}</div>
        <div class="item-sub">${d.Category || d.FileType || '—'} · ${fmtDate(d.UploadDate)}</div>
      </div>
      ${statusPill(d.Status)}
    </div>`;
}

// ── Events ───────────────────────────────────────────────────────────────────
// "Upcoming" = Active or Planning status, with a start date today or later
// (events with no StartDate are still considered upcoming).
function isUpcomingEvent(ev) {
  if (!ev.EventName) return false;
  if (!['Active', 'Planning'].includes(ev.Status)) return false;
  if (!ev.StartDate) return true;
  const start = new Date(ev.StartDate + 'T00:00:00');
  if (isNaN(start)) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return start >= today;
}

function sortByStartDate(events) {
  return [...events].sort((a, b) => new Date(a.StartDate || 0) - new Date(b.StartDate || 0));
}

// ── Announcements ────────────────────────────────────────────────────────────
function isPinned(a) {
  return a.Pinned === 'TRUE' || a.Pinned === 'true' || a.Pinned === '1' || a.Pinned === true;
}

function audienceBadge(aud) {
  if (aud === 'Board')      return `<span class="audience-badge board">BOARD</span>`;
  if (aud === 'Volunteers') return `<span class="audience-badge volunteers">VOLUNTEERS</span>`;
  return `<span class="audience-badge all">ALL</span>`;
}

// Filters announcements to the audiences allowed for the current dashboard,
// then sorts pinned items first, newest next.
function filterAnnouncements(items, allowedAudiences) {
  return items
    .filter(a => a.Title && (!a.Status || a.Status !== 'Archived'))
    .filter(a => allowedAudiences.includes(a.TargetAudience || 'All'))
    .sort((a, b) => {
      const pinDiff = (isPinned(b) ? 1 : 0) - (isPinned(a) ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return new Date(b.PublishDate || 0) - new Date(a.PublishDate || 0);
    });
}

function renderAnnouncementItem(a) {
  return `
    <div class="announcement-item${isPinned(a) ? ' pinned' : ''}">
      <div class="announcement-title">${isPinned(a) ? '📌 ' : ''}${a.Title}${audienceBadge(a.TargetAudience)}</div>
      <div class="announcement-body">${a.Body || ''}</div>
      <div class="announcement-meta">${a.PublishedBy ? `By ${a.PublishedBy}` : ''}${a.PublishDate ? ` · ${fmtDate(a.PublishDate)}` : ''}</div>
    </div>`;
}

// ── Interactive task rows ────────────────────────────────────────────────────
// Shared by the board "Action Items" list and the volunteer "My Tasks" list.
// `eventsById` (optional) resolves RelatedEventID to a clickable event name.
function interactiveTaskRow(t, eventsById) {
  const done  = t.Status === 'Completed';
  const event = eventsById && eventsById[t.RelatedEventID];
  const eventLink = t.RelatedEventID
    ? (event
        ? `<a href="#" class="task-event-link" onclick="goToSection('events');return false;">📅 ${event.EventName}</a>`
        : `<span class="task-event-link" style="opacity:.5;">📅 ${t.RelatedEventID}</span>`)
    : '';

  return `
    <div class="task-row interactive" data-task-id="${t.TaskID}">
      <div class="check-circle${done ? ' done' : ''}" role="button" tabindex="0"
           title="${done ? 'Mark as pending' : 'Mark as complete'}"
           onclick="toggleTaskComplete('${t.TaskID}', ${done})"
           onkeydown="if(event.key==='Enter')toggleTaskComplete('${t.TaskID}', ${done})"></div>
      <div style="flex:1;min-width:0;">
        <div class="task-title" style="${done ? 'opacity:.5;text-decoration:line-through;' : ''}">${t.Title || '—'}</div>
        <div class="task-meta">
          ${t.AssignedTo ? `${t.AssignedTo}` : ''}
          ${t.DueDate ? `<span style="margin:0 4px;color:var(--gold-line);">·</span>${fmtDate(t.DueDate)}` : ''}
          ${eventLink ? `<span style="margin:0 4px;color:var(--gold-line);">·</span>${eventLink}` : ''}
        </div>
        ${t.Notes ? `<div class="task-notes">${t.Notes}</div>` : ''}
        <div class="task-controls">
          <select class="task-status-select" onchange="updateTaskStatus('${t.TaskID}', this.value)">
            <option value="Pending" ${t.Status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="In Progress" ${t.Status === 'In Progress' ? 'selected' : ''}>In Progress</option>
            <option value="Completed" ${t.Status === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
          <button class="btn btn-ghost btn-sm" onclick="toggleNoteInput('${t.TaskID}')">+ Note</button>
        </div>
        <div class="task-note-input" id="noteInput-${t.TaskID}" style="display:none;">
          <div id="noteQuill-${t.TaskID}" class="quill-field quill-inline"></div>
          <button class="btn btn-outline btn-sm" onclick="submitTaskNote('${t.TaskID}')">Save</button>
        </div>
      </div>
      ${priorityPill(t.Priority)}
    </div>`;
}

// Open/in-progress tasks first, completed tasks below a divider.
function renderTaskListHtml(tasks, eventsById) {
  const open = tasks.filter(t => t.Status !== 'Completed');
  const done = tasks.filter(t => t.Status === 'Completed');
  let html = open.map(t => interactiveTaskRow(t, eventsById)).join('');
  if (done.length) {
    html += `<div class="task-section-divider">Completed</div>`;
    html += done.map(t => interactiveTaskRow(t, eventsById)).join('');
  }
  return html;
}

function toggleTaskComplete(taskId, currentlyDone) {
  return patchTask(taskId, { Status: currentlyDone ? 'Pending' : 'Completed' });
}

function updateTaskStatus(taskId, status) {
  return patchTask(taskId, { Status: status });
}

function toggleNoteInput(taskId) {
  const el = document.getElementById(`noteInput-${taskId}`);
  if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? 'flex' : 'none';
  if (show) _initQuill(`noteQuill-${taskId}`, 'Add a note…');
}

function submitTaskNote(taskId) {
  const val = _quillVal(`noteQuill-${taskId}`);
  if (!val) return;
  return patchTask(taskId, { Note: val });
}

// Writes the change straight to the Tasks sheet, then re-runs whichever
// task-loading function exists on the current page so the UI reflects it
// immediately (board.js defines loadTasks, volunteer.js defines loadVTasks).
async function patchTask(taskId, body) {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Could not update that task.');
      return;
    }
    if (typeof loadTasks === 'function')  await loadTasks();
    if (typeof loadVTasks === 'function') await loadVTasks();
  } catch (e) {
    alert('Network error — could not update that task. Please try again.');
  }
}

// ── Global search (topbar) ──────────────────────────────────────────────────
let searchDebounceTimer;

function handleGlobalSearch(q) {
  clearTimeout(searchDebounceTimer);
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  if (!q || q.trim().length < 2) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; return; }
  searchDebounceTimer = setTimeout(() => runGlobalSearch(q.trim()), 250);
}

async function runGlobalSearch(q) {
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;
  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    const groups = [
      { key: 'members', label: 'Contacts' },
      { key: 'volunteers', label: 'Volunteers' },
      { key: 'events', label: 'Events' },
      { key: 'documents', label: 'Documents' }
    ];
    resultsEl.innerHTML = '';
    let any = false;
    groups.forEach(g => {
      const items = data[g.key] || [];
      if (!items.length) return;
      any = true;
      const labelEl = document.createElement('div');
      labelEl.className = 'search-result-group-label';
      labelEl.textContent = g.label;
      resultsEl.appendChild(labelEl);
      items.forEach(it => {
        const row = document.createElement('div');
        row.className = 'search-result-item';
        row.textContent = it.label;
        row.addEventListener('click', () => {
          resultsEl.classList.remove('open');
          if (g.key === 'members') location.href = `/members/${encodeURIComponent(it.id)}`;
          else if (g.key === 'volunteers') location.href = `/volunteers/${encodeURIComponent(it.id)}`;
          else if (g.key === 'events') goToSection('events');
          else if (g.key === 'documents') it.href ? window.open(it.href, '_blank', 'noopener') : goToSection('files');
        });
        resultsEl.appendChild(row);
      });
    });
    if (!any) resultsEl.innerHTML = `<div class="search-empty">No matches for "${q}".</div>`;
    resultsEl.classList.add('open');
  } catch (e) {
    resultsEl.innerHTML = `<div class="search-empty">Search unavailable right now.</div>`;
    resultsEl.classList.add('open');
  }
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('topbarSearch');
  if (wrap && !wrap.contains(e.target)) document.getElementById('searchResults')?.classList.remove('open');
});

// ── Notifications bell ──────────────────────────────────────────────────────
// "Unread" is tracked client-side (per-browser) since there's no per-user
// read-state column in the Announcements sheet to persist it server-side.
const SEEN_ANNOUNCEMENTS_KEY = 'rock_seen_announcements';
let notifCache = [];

function getSeenAnnouncementIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_ANNOUNCEMENTS_KEY) || '[]')); }
  catch { return new Set(); }
}
function markAnnouncementsSeen(ids) {
  const seen = getSeenAnnouncementIds();
  ids.forEach(id => seen.add(id));
  localStorage.setItem(SEEN_ANNOUNCEMENTS_KEY, JSON.stringify([...seen]));
}

async function initNotifications(allowedAudiences) {
  try {
    const items = await apiFetch('/api/announcements');
    notifCache = filterAnnouncements(items, allowedAudiences).slice(0, 5);
    const seen = getSeenAnnouncementIds();
    const unread = notifCache.filter(a => a.AnnouncementID && !seen.has(a.AnnouncementID));
    const badge = document.getElementById('notifBadge');
    if (badge) {
      badge.style.display = unread.length ? 'flex' : 'none';
      badge.textContent = unread.length > 9 ? '9+' : String(unread.length);
    }
  } catch (e) { /* bell just shows no badge if announcements can't be fetched */ }
}

function toggleNotifDropdown() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  const opening = !dd.classList.contains('open');
  if (opening) {
    dd.innerHTML = notifCache.length
      ? `<div class="notif-dropdown-header">Recent Announcements</div>` + notifCache.map(a => `
          <div class="notif-item">
            <div class="notif-item-title">${isPinned(a) ? '📌 ' : ''}${a.Title}${audienceBadge(a.TargetAudience)}</div>
            <div class="notif-item-meta">${a.PublishDate ? fmtDate(a.PublishDate) : ''}</div>
          </div>`).join('')
      : `<div class="search-empty">No announcements yet.</div>`;
    markAnnouncementsSeen(notifCache.map(a => a.AnnouncementID).filter(Boolean));
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
  }
  dd.classList.toggle('open');
}

document.addEventListener('click', e => {
  const wrap = document.querySelector('.notif-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('notifDropdown')?.classList.remove('open');
});

// ── User chip setup ──────────────────────────────────────────────────────────
async function initUser() {
  try {
    const user = await apiFetch('/api/me');
    const nm = document.getElementById('userName');
    const em = document.getElementById('userEmail');
    const av = document.getElementById('userAvatar');
    if (nm) nm.textContent = user.firstName || user.name;
    if (em) em.textContent = user.email;
    if (av) {
      if (user.photo) { av.src = user.photo; }
      else { av.outerHTML = `<div class="avatar-initials" style="width:28px;height:28px;font-size:10px;">${initials(user.name)}</div>`; }
    }
    // User dropdown toggle
    const chip = document.getElementById('userChip');
    const drop = document.getElementById('userDropdown');
    if (chip && drop) {
      chip.addEventListener('click', e => { e.stopPropagation(); drop.classList.toggle('open'); });
      document.addEventListener('click', () => drop.classList.remove('open'));
    }
    return user;
  } catch (e) {
    console.error('Could not load user:', e);
    return null;
  }
}
