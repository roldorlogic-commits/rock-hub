/* Board Dashboard */

// Populated by loadEvents() so task rows can resolve RelatedEventID -> name.
let eventsById = {};

(async () => {
  const user = await initUser();
  if (user?.email === 'vicepresident@gorock.org') {
    const adminLink = document.getElementById('adminUsageLink');
    if (adminLink) adminLink.style.display = '';
  }
  await loadEvents(); // populates eventsById before tasks render
  await Promise.all([
    loadStats(), loadTasks(), loadContacts(), loadFiles(), loadDriveDocs(),
    loadMembers(), loadYouthGroups(), loadVolunteersFull(), loadPendingQueue(), loadAnnouncements(),
    initNotifications(['All', 'Board']), loadPendingVolunteerBadge(),
    loadNotifSummary(), loadMetricsTile()
  ]);
})();

async function loadStats() {
  try {
    const s = await apiFetch('/api/stats');
    document.getElementById('mPartners').textContent  = s.partners          || '0';
    document.getElementById('mProspects').textContent = s.prospects         || '0';
    document.getElementById('mVolunteers').textContent= s.activeVolunteers  || '0';
    document.getElementById('mTasks').textContent     = s.openTasks         || '0';
  } catch (e) { console.error('Stats:', e); }
}

// ── Events ───────────────────────────────────────────────────────────────────
async function loadEvents() {
  try {
    const events = await apiFetch('/api/events');
    eventsById = Object.fromEntries(events.filter(e => e.EventID).map(e => [e.EventID, e]));
    renderEventsPreview(events);
    renderEventsFull(events);
  } catch (e) {
    document.getElementById('eventsPreview').innerHTML = emptyState('Could not load events right now. Please try again shortly.');
  }
}

function eventRow(ev) {
  const db   = fmtDateBlock(ev.StartDate);
  const href = ev.EventID ? `/events/${encodeURIComponent(ev.EventID)}` : null;
  const clickAttrs = href
    ? `role="button" tabindex="0" onclick="location.href='${href}'" onkeydown="if(event.key==='Enter')location.href='${href}'"`
    : '';
  return `
    <div class="event-item${href ? ' clickable' : ''}" ${clickAttrs}>
      <div class="event-row">
        <div class="date-block">
          <span class="month">${db.month}</span>
          <span class="day">${db.day}</span>
        </div>
        <div class="event-info">
          <div class="event-name">${ev.EventName || 'Untitled Event'}</div>
          <div class="event-meta">
            <span>${fmtDate(ev.StartDate)}</span>
            ${ev.Location  ? `<span class="event-meta-sep">·</span><span>${ev.Location}</span>` : ''}
            ${ev.Status    ? `<span class="event-meta-sep">·</span>${statusPill(ev.Status)}` : ''}
          </div>
          ${ev.CoordinatorName ? `<div class="event-meta" style="margin-top:2px;">Coordinator: ${ev.CoordinatorName}</div>` : ''}
        </div>
      </div>
    </div>`;
}

function renderEventsPreview(events) {
  const el = document.getElementById('eventsPreview');
  const upcoming = sortByStartDate(events.filter(isUpcomingEvent)).slice(0, 3);
  el.innerHTML = upcoming.length
    ? upcoming.map(eventRow).join('')
    : emptyState('No upcoming events. Add them to the Events sheet.');
}

function renderEventsFull(events) {
  const el = document.getElementById('eventsFull');
  const sorted = sortByStartDate(events);
  el.innerHTML = sorted.length
    ? sorted.map(ev => {
        const href = ev.EventID ? `/events/${encodeURIComponent(ev.EventID)}` : null;
        const clickAttrs = href
          ? `role="button" tabindex="0" onclick="location.href='${href}'" onkeydown="if(event.key==='Enter')location.href='${href}'"`
          : '';
        return `
          <div class="event-item${href ? ' clickable' : ''}" ${clickAttrs}>
            <div class="event-row">
              <div class="date-block">
                <span class="month">${fmtDateBlock(ev.StartDate).month}</span>
                <span class="day">${fmtDateBlock(ev.StartDate).day}</span>
              </div>
              <div class="event-info">
                <div class="event-name">${ev.EventName || '—'}</div>
                <div class="event-meta">
                  <span>${fmtDate(ev.StartDate)}</span>
                  ${ev.Location ? `<span class="event-meta-sep">·</span><span>${ev.Location}</span>` : ''}
                  ${ev.Capacity ? `<span class="event-meta-sep">·</span><span>Cap: ${ev.Capacity}</span>` : ''}
                </div>
              </div>
              <div style="flex-shrink:0;text-align:right;">
                ${statusPill(ev.Status || 'Upcoming')}
                ${ev.CoordinatorName ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${ev.CoordinatorName}</div>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')
    : emptyState('No events yet. Add rows to the Events sheet in Google Sheets.');
}

// ── Tasks ────────────────────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const tasks = await apiFetch('/api/tasks');
    renderTasksPreview(tasks);
    renderTasksFull(tasks);
  } catch (e) {
    document.getElementById('tasksPreview').innerHTML = emptyState('Could not load tasks.');
  }
}

function renderTasksPreview(tasks) {
  const el = document.getElementById('tasksPreview');
  const open = tasks.filter(t => t.Title && t.Status !== 'Completed').slice(0, 5);
  el.innerHTML = open.length ? open.map(t => interactiveTaskRow(t, eventsById)).join('') : emptyState('No open action items right now.');
}

function renderTasksFull(tasks) {
  const el = document.getElementById('tasksFull');
  el.innerHTML = tasks.length
    ? renderTaskListHtml(tasks, eventsById)
    : emptyState('No tasks yet — use "+ Create Task" to add your first action item.');
}

// ── Create Task modal ────────────────────────────────────────────────────────
let _assigneesCache = [];

async function openCreateTaskModal() {
  document.getElementById('ct_title').value    = '';
  document.getElementById('ct_desc').value     = '';
  document.getElementById('ct_due').value      = '';
  document.getElementById('ct_priority').value = 'Medium';
  document.getElementById('createTaskSuccess').style.display = 'none';
  document.getElementById('createTaskNav').style.display     = 'flex';
  document.getElementById('createTaskSubmit').disabled = false;
  document.getElementById('createTaskSubmit').textContent = 'Create Task';
  document.getElementById('createTaskOverlay').classList.add('open');
  document.getElementById('createTaskModal').classList.add('open');

  const sel = document.getElementById('ct_assignee');
  sel.innerHTML = '<option value="">— Unassigned —</option>';
  try {
    _assigneesCache = await apiFetch('/api/assignees');
    const groups = { Board: [], Volunteer: [] };
    for (const a of _assigneesCache) {
      (groups[a.role] || groups['Volunteer']).push(a);
    }
    for (const [group, people] of Object.entries(groups)) {
      if (!people.length) continue;
      const og = document.createElement('optgroup');
      og.label = group === 'Board' ? 'Board Members' : 'Volunteers';
      for (const p of people) {
        const opt = document.createElement('option');
        opt.value = p.email;
        opt.dataset.name = p.name;
        opt.textContent = p.name;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  } catch (_) {}

  setTimeout(() => document.getElementById('ct_title').focus(), 80);
}

function closeCreateTaskModal() {
  document.getElementById('createTaskOverlay')?.classList.remove('open');
  document.getElementById('createTaskModal')?.classList.remove('open');
}

async function submitCreateTask() {
  const title = document.getElementById('ct_title').value.trim();
  if (!title) { alert('Title is required.'); return; }

  const sel   = document.getElementById('ct_assignee');
  const email = sel.value;
  const name  = sel.selectedOptions[0]?.dataset.name || '';
  const btn   = document.getElementById('createTaskSubmit');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Title:         title,
        Description:   document.getElementById('ct_desc').value.trim(),
        AssignedTo:    name,
        AssigneeEmail: email,
        DueDate:       document.getElementById('ct_due').value,
        Priority:      document.getElementById('ct_priority').value
      })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not create task.'); return; }

    const ok = document.getElementById('createTaskSuccess');
    ok.style.display = 'block'; ok.textContent = 'Task created.';
    document.getElementById('createTaskNav').style.display = 'none';
    await Promise.all([loadTasks(), loadStats()]);
    setTimeout(() => closeCreateTaskModal(), 1200);
  } catch (err) {
    alert('Network error — could not create task.');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Task';
  }
}

// ── Contacts ─────────────────────────────────────────────────────────────────
// Cached so the slide-out panel can look a contact back up by index when a
// card is clicked, without a second round-trip to the sheet.
let contactsCache = [];

async function loadContacts() {
  try {
    const roles = await apiFetch('/api/userroles');
    contactsCache = roles;
    renderContactsPreview(roles);
    renderContactsFull(roles);
  } catch (e) {
    document.getElementById('contactsPreview').innerHTML = emptyState('Could not load contacts right now. Please try again shortly.');
  }
}

function contactRow(r) {
  const idx  = contactsCache.indexOf(r);
  const name = [r.FirstName, r.LastName].filter(Boolean).join(' ') || r.Email || '—';
  return `
    <div class="contact-row clickable" role="button" tabindex="0"
         onclick="openContactPanel(${idx})" onkeydown="if(event.key==='Enter')openContactPanel(${idx})">
      ${avatarHtml(name, null)}
      <div class="contact-info">
        <div class="contact-name">${name}</div>
        <div class="contact-email">${r.Email || '—'}</div>
      </div>
      <span class="role-badge${r.Role === 'Board' ? ' board' : ''}">${r.Role || 'Volunteer'}</span>
    </div>`;
}

function renderContactsPreview(roles) {
  const el = document.getElementById('contactsPreview');
  const board = roles.filter(r => r.Role === 'Board' || r.Email).slice(0, 4);
  el.innerHTML = board.length ? board.map(contactRow).join('') : emptyState('No contacts yet — add board or staff members to the UserRoles sheet.');
}

function renderContactsFull(roles) {
  const el = document.getElementById('contactsFull');
  el.innerHTML = roles.length
    ? roles.map(contactRow).join('')
    : emptyState('No contacts yet — add board or staff members to the UserRoles sheet.');
}

// ── Contact detail slide-out panel ──────────────────────────────────────────
function openContactPanel(idx) {
  const r = contactsCache[idx];
  if (!r) return;
  const name = [r.FirstName, r.LastName].filter(Boolean).join(' ') || r.Email || '—';
  document.querySelector('#contactPanel .slide-panel-body').innerHTML = `
    <div class="detail-header-card" style="padding:0 0 16px;border:none;margin-bottom:16px;background:none;">
      ${avatarHtml(name, null)}
      <div>
        <div class="detail-header-name" style="font-size:16px;">${name}</div>
        <span class="role-badge${r.Role === 'Board' ? ' board' : ''}">${r.Role || 'Volunteer'}</span>
      </div>
    </div>
    <div class="detail-field-grid" style="grid-template-columns:1fr;">
      <div class="detail-field">
        <div class="detail-field-label">Email</div>
        <div class="detail-field-value${r.Email ? '' : ' empty'}">${r.Email ? `<a href="mailto:${r.Email}">${r.Email}</a>` : '—'}</div>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Department</div>
        <div class="detail-field-value${r.Department ? '' : ' empty'}">${r.Department || '—'}</div>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Status</div>
        <div class="detail-field-value">${statusPill(r.Status || 'Active')}</div>
      </div>
      <div class="detail-field">
        <div class="detail-field-label">Last Login</div>
        <div class="detail-field-value${r.LastLogin ? '' : ' empty'}">${r.LastLogin ? fmtDate(r.LastLogin) : 'Never logged in'}</div>
      </div>
    </div>
    <a class="btn btn-gold btn-sm" style="margin-top:20px;width:100%;justify-content:center;" href="mailto:${r.Email || ''}">Send Email</a>
  `;
  document.getElementById('contactPanel').classList.add('open');
  document.getElementById('contactPanelOverlay').classList.add('open');
}

function closeContactPanel() {
  document.getElementById('contactPanel')?.classList.remove('open');
  document.getElementById('contactPanelOverlay')?.classList.remove('open');
}

// ── Files ─────────────────────────────────────────────────────────────────────
let _docsCache = [];

async function loadFiles() {
  try {
    const docs = await apiFetch('/api/documents');
    _docsCache = docs;
    renderFilesPreview(docs);
    renderMinutes(docs);
    renderReports(docs);
  } catch (e) {
    document.getElementById('filesPreview').innerHTML = emptyState('Could not load files.');
  }
}

// ── Documents tab (Shared Drive backed) ─────────────────────────────────────
let _driveDocs = [];

function _docEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

async function loadDriveDocs() {
  const el = document.getElementById('filesFull');
  try {
    _driveDocs = await apiFetch('/api/drive/documents');
    populateDocFilters();
    renderDriveDocs();
  } catch (e) {
    if (el) el.innerHTML = emptyState('Could not load files from the Shared Drive.');
  }
}

// Fill the event + file-type dropdowns from whatever's actually in the drive.
function populateDocFilters() {
  const events = [...new Set(_driveDocs.map(d => d.event).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const types  = [...new Set(_driveDocs.map(d => d.fileType).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const evSel = document.getElementById('docFilterEvent');
  const tySel = document.getElementById('docFilterType');
  if (evSel) {
    const cur = evSel.value;
    evSel.innerHTML = '<option value="">All events</option>' +
      events.map(e => `<option value="${_docEsc(e)}">${_docEsc(e)}</option>`).join('');
    evSel.value = cur;
  }
  if (tySel) {
    const cur = tySel.value;
    tySel.innerHTML = '<option value="">All types</option>' +
      types.map(t => `<option value="${_docEsc(t)}">${_docEsc(t)}</option>`).join('');
    tySel.value = cur;
  }
}

function renderDriveDocs() {
  const el = document.getElementById('filesFull');
  if (!el) return;
  const q       = (document.getElementById('docSearch')?.value || '').trim().toLowerCase();
  const fEvent  = document.getElementById('docFilterEvent')?.value || '';
  const fType   = document.getElementById('docFilterType')?.value || '';
  const fSection = document.getElementById('docFilterSection')?.value || '';

  let docs = _driveDocs.filter(d => {
    if (q && !d.name.toLowerCase().includes(q) && !(d.event || '').toLowerCase().includes(q)) return false;
    if (fEvent && d.event !== fEvent) return false;
    if (fType && d.fileType !== fType) return false;
    if (fSection && d.section !== fSection) return false;
    return true;
  });

  if (!docs.length) {
    el.innerHTML = emptyState(_driveDocs.length
      ? 'No files match these filters.'
      : 'No files in the Shared Drive yet — upload one, or upload a photo/document from an event.');
    return;
  }

  // Group by event, then a "General / No event" bucket last.
  const groups = new Map();
  for (const d of docs) {
    const key = d.event || (d.section === 'General' ? 'General' : 'Unsorted');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    for (const last of ['General', 'Unsorted']) {
      if (a === last) return 1;
      if (b === last) return -1;
    }
    return a.localeCompare(b);
  });

  el.innerHTML = keys.map(k => {
    const rows = groups.get(k).map(driveDocRow).join('');
    return `<div class="doc-group">
      <div class="doc-group-title">${_docEsc(k)} <span class="doc-group-count">${groups.get(k).length}</span></div>
      ${rows}
    </div>`;
  }).join('');
}

function driveDocRow(d) {
  const isImg = (d.mimeType || '').startsWith('image/');
  const icon = isImg
    ? `<img class="doc-thumb" src="${_docEsc(d.proxyUrl)}" alt="" loading="lazy">`
    : `<div class="file-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`;
  const sub = [d.fileType, fmtBytes(d.size), fmtDate(d.modifiedTime)].filter(Boolean).join(' · ');
  const view = _docEsc(d.proxyUrl);
  const dl   = _docEsc(d.downloadUrl);
  return `
    <div class="list-item clickable" role="button" tabindex="0"
         onclick="window.open('${view}','_blank','noopener')"
         onkeydown="if(event.key==='Enter')window.open('${view}','_blank','noopener')">
      ${icon}
      <div class="item-info">
        <div class="item-title">${_docEsc(d.name)}</div>
        <div class="doc-file-meta">${_docEsc(sub)}</div>
      </div>
      <div class="doc-file-actions">
        <a class="btn btn-ghost btn-sm" href="${dl}" onclick="event.stopPropagation()" title="Download">Download</a>
      </div>
    </div>`;
}

function renderFilesPreview(docs) {
  const el = document.getElementById('filesPreview');
  const recent = docs.filter(d => d.Title).slice(0, 5);
  el.innerHTML = recent.length ? recent.map(documentRow).join('') : emptyState('No documents yet — add your first document to the Documents sheet.');
}

// Board-only document row with an Edit button. Uses _docsCache index to look
// up the document when the edit modal is opened.
function boardDocumentRow(d) {
  const idx = _docsCache.indexOf(d);
  const { href } = docLinkInfo(d);
  const isBoardOnly = (d.AccessLevel || '').toLowerCase().includes('board');
  const rowAttrs = href
    ? ` class="list-item clickable" role="button" tabindex="0" onclick="window.open('${href}','_blank','noopener')" onkeydown="if(event.key==='Enter')window.open('${href}','_blank','noopener')"`
    : ` class="list-item" title="No link available — update in the Database sheet" style="cursor:help;"`;
  return `
    <div${rowAttrs}>
      <div class="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="item-info">
        <div class="item-title">${d.Title || '—'}${isBoardOnly ? ' <span title="Board only — restricted access" style="font-size:11px;opacity:.8;">🔒</span>' : ''}</div>
        <div class="item-sub">${d.Category || d.FileType || '—'} · ${fmtDate(d.UploadDate)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;">
        ${statusPill(d.Status)}
        ${d.DocumentID ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditDocModal(${idx})" title="Edit document">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;margin-right:2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>` : ''}
      </div>
    </div>`;
}

function renderMinutes(docs) {
  const el = document.getElementById('minutesFull');
  const mins = docs.filter(d => d.Category?.toLowerCase().includes('minute'));
  el.innerHTML = mins.length ? mins.map(boardDocumentRow).join('') : emptyState('No meeting minutes yet. Tag documents with Category "Minutes".');
}

function renderReports(docs) {
  const el = document.getElementById('reportsFull');
  const rpts = docs.filter(d => d.Category?.toLowerCase().includes('report'));
  el.innerHTML = rpts.length ? rpts.map(boardDocumentRow).join('') : emptyState('No reports yet. Tag documents with Category "Report".');
}

// ── Document upload modal ────────────────────────────────────────────────────
let _docTab = 'upload';

function switchDocTab(tab) {
  _docTab = tab;
  document.getElementById('ud_pane_upload').style.display = tab === 'upload' ? '' : 'none';
  document.getElementById('ud_pane_link').style.display   = tab === 'link'   ? '' : 'none';
  const active = 'background:var(--gold-faint);color:var(--gold);';
  document.getElementById('ud_tab_upload').setAttribute('style', `flex:1;border-radius:0;border:none;font-size:12px;${tab==='upload'?active:''}`);
  document.getElementById('ud_tab_link').setAttribute('style',   `flex:1;border-radius:0;border:none;border-left:1px solid var(--gold-line);font-size:12px;${tab==='link'?active:''}`);
  document.getElementById('ud_submit').textContent = tab === 'upload' ? 'Upload' : 'Add Link';
}

function openUploadDocModal() {
  const fileInput = document.getElementById('ud_file');
  if (fileInput) fileInput.value = '';
  document.getElementById('ud_link_url').value   = '';
  document.getElementById('ud_name').value       = '';
  document.getElementById('ud_category').value   = 'General';
  document.getElementById('ud_access').value     = 'Board Only';
  document.getElementById('ud_progress').style.display     = 'none';
  document.getElementById('uploadDocSuccess').style.display = 'none';
  document.getElementById('uploadDocNav').style.display    = 'flex';
  document.getElementById('ud_submit').disabled = false;
  switchDocTab('upload');
  document.getElementById('uploadDocOverlay').classList.add('open');
  document.getElementById('uploadDocModal').classList.add('open');
}

function closeUploadDocModal() {
  document.getElementById('uploadDocOverlay')?.classList.remove('open');
  document.getElementById('uploadDocModal')?.classList.remove('open');
}

function onUploadFileChange(input) {
  if (input.files[0] && !document.getElementById('ud_name').value.trim()) {
    document.getElementById('ud_name').value = input.files[0].name.replace(/\.[^.]+$/, '');
  }
}

async function submitDocUpload() {
  const name        = document.getElementById('ud_name').value.trim();
  const category    = document.getElementById('ud_category').value;
  const accessLevel = document.getElementById('ud_access').value;
  if (!name) { alert('Please enter a document name.'); return; }

  if (_docTab === 'link') {
    const url = document.getElementById('ud_link_url').value.trim();
    if (!url) { alert('Please enter a Drive URL.'); return; }
    const btn = document.getElementById('ud_submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res  = await fetch('/api/documents/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, category, accessLevel })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Failed to save link.'); return; }
      document.getElementById('uploadDocNav').style.display = 'none';
      document.getElementById('uploadDocSuccess').style.display = 'block';
      document.getElementById('uploadDocSuccess').textContent = `"${name}" added successfully.`;
      await Promise.all([loadFiles(), loadDriveDocs()]);
      setTimeout(() => closeUploadDocModal(), 1500);
    } catch (err) {
      alert('Network error. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Add Link';
    }
    return;
  }

  const file = document.getElementById('ud_file').files[0];
  if (!file) { alert('Please select a file to upload.'); return; }
  const MAX_BYTES = 7 * 1024 * 1024;
  if (file.size > MAX_BYTES) { alert('File is too large. Maximum size is 7 MB.'); return; }

  const btn = document.getElementById('ud_submit');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  document.getElementById('ud_progress').style.display = 'block';
  document.getElementById('ud_status').textContent = 'Reading file…';
  document.getElementById('ud_bar').style.width = '20%';

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    document.getElementById('ud_status').textContent = 'Uploading to Google Drive…';
    document.getElementById('ud_bar').style.width = '55%';

    const res  = await fetch('/api/documents/upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, base64, mimeType: file.type || 'application/octet-stream', category, accessLevel })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Upload failed. Please try again.'); return; }

    document.getElementById('ud_bar').style.width = '100%';
    document.getElementById('ud_status').textContent = 'Done!';
    document.getElementById('uploadDocNav').style.display = 'none';
    document.getElementById('uploadDocSuccess').style.display = 'block';
    document.getElementById('uploadDocSuccess').textContent = `"${name}" uploaded successfully.`;

    await Promise.all([loadFiles(), loadDriveDocs()]);
    setTimeout(() => closeUploadDocModal(), 1500);
  } catch (err) {
    alert('Upload failed. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

// ── Edit Document modal ──────────────────────────────────────────────────────
function openEditDocModal(idx) {
  const d = _docsCache[idx];
  if (!d) return;
  document.getElementById('ed_docId').value    = d.DocumentID  || '';
  document.getElementById('ed_name').value     = d.Title       || '';
  document.getElementById('ed_category').value = d.Category    || 'General';
  document.getElementById('ed_access').value   = d.AccessLevel || 'Board Only';
  document.getElementById('ed_submit').disabled = false;
  document.getElementById('ed_submit').textContent = 'Save Changes';
  document.getElementById('editDocOverlay').classList.add('open');
  document.getElementById('editDocModal').classList.add('open');
  setTimeout(() => document.getElementById('ed_name').focus(), 80);
}

function closeEditDocModal() {
  document.getElementById('editDocOverlay')?.classList.remove('open');
  document.getElementById('editDocModal')?.classList.remove('open');
}

async function submitEditDoc() {
  const docId       = document.getElementById('ed_docId').value;
  const title       = document.getElementById('ed_name').value.trim();
  const category    = document.getElementById('ed_category').value;
  const accessLevel = document.getElementById('ed_access').value;
  if (!title) { alert('Document name is required.'); return; }

  const btn = document.getElementById('ed_submit');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const res  = await fetch(`/api/documents/${encodeURIComponent(docId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ Title: title, Category: category, AccessLevel: accessLevel })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not update document.'); return; }
    closeEditDocModal();
    await Promise.all([loadFiles(), loadDriveDocs()]);
  } catch (err) {
    alert('Network error — could not update document.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

// ── Contacts (formerly Members) ───────────────────────────────────────────────
let _activeMemberTag = null;
let _allMembersCache = [];

async function loadMembers() {
  try {
    const members = await apiFetch('/api/members');
    _allMembersCache = members;
    _activeMemberTag = null;
    renderMembersFull(members);
    _populateContactYGDropdown();
  } catch (e) {
    document.getElementById('membersFull').innerHTML = emptyState('Could not load contacts.');
  }
}

function filterMembersByTag(tag) {
  _activeMemberTag = (_activeMemberTag === tag) ? null : tag;
  renderMembersFull(_allMembersCache);
}

let _selectedMemberIds = new Set();

function _updateBulkBar() {
  const bar = document.getElementById('membersBulkBar');
  const count = _selectedMemberIds.size;
  if (count === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    document.getElementById('membersBulkCount').textContent = `${count} contact${count === 1 ? '' : 's'} selected`;
  }
}

function toggleMemberSelect(id, checked) {
  if (checked) _selectedMemberIds.add(id);
  else _selectedMemberIds.delete(id);
  _updateBulkBar();
}

function toggleSelectAllMembers(checked) {
  const checkboxes = document.querySelectorAll('.member-chk');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    if (checked) _selectedMemberIds.add(cb.dataset.id);
    else _selectedMemberIds.delete(cb.dataset.id);
  });
  _updateBulkBar();
}

function clearBulkSelection() {
  _selectedMemberIds.clear();
  document.querySelectorAll('.member-chk').forEach(cb => cb.checked = false);
  const allChk = document.getElementById('membersSelectAll');
  if (allChk) allChk.checked = false;
  _updateBulkBar();
}

function renderMembersFull(members) {
  const el = document.getElementById('membersFull');
  if (!members.length) {
    el.innerHTML = emptyState('No contacts yet — use "+ Add Contact" to create your first contact.');
    _updateBulkBar();
    return;
  }

  const allTags = new Set();
  members.forEach(m => {
    if (m.Tags) m.Tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => allTags.add(t));
  });

  const tagBar = allTags.size > 0 ? `
    <div class="tag-filter-bar">
      <span class="tag-filter-label">Filter:</span>
      ${[...allTags].sort().map(tag => `
        <button class="tag-chip${_activeMemberTag === tag ? ' active' : ''}" onclick="filterMembersByTag('${tag.replace(/'/g,"\\'")}')">
          ${tag}
        </button>`).join('')}
      ${_activeMemberTag ? `<button class="tag-chip clear" onclick="filterMembersByTag(null)">✕ Clear</button>` : ''}
    </div>` : '';

  const filtered = _activeMemberTag
    ? members.filter(m => m.Tags && m.Tags.split(',').map(t => t.trim()).includes(_activeMemberTag))
    : members;

  const selectAllBar = `<div style="padding:6px 20px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim);border-bottom:1px solid var(--gold-line);">
    <input type="checkbox" id="membersSelectAll" style="cursor:pointer;" onchange="toggleSelectAllMembers(this.checked)">
    <label for="membersSelectAll" style="cursor:pointer;margin:0;">Select all</label>
  </div>`;

  const rows = filtered.length
    ? filtered.map(m => {
        const cacheIdx = _allMembersCache.indexOf(m);
        const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || '—';
        const tags = m.Tags ? m.Tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const checked = _selectedMemberIds.has(m.MemberID) ? 'checked' : '';
        return `
          <div class="contact-row" style="cursor:default;">
            <input type="checkbox" class="member-chk" data-id="${m.MemberID}" ${checked} style="flex-shrink:0;cursor:pointer;margin-right:4px;"
              onchange="toggleMemberSelect('${m.MemberID}',this.checked)" onclick="event.stopPropagation()">
            <div role="button" tabindex="0" style="display:flex;align-items:center;gap:12px;flex:1;cursor:pointer;min-width:0;"
                 onclick="location.href='/members/${encodeURIComponent(m.MemberID)}'"
                 onkeydown="if(event.key==='Enter')location.href='/members/${encodeURIComponent(m.MemberID)}'">
              ${avatarHtml(name, null)}
              <div class="contact-info">
                <div class="contact-name">${name}</div>
                <div class="contact-email">${m.Email || '—'}</div>
                ${tags.length ? `<div class="contact-tags">${tags.map(t => `<span class="tag-chip-sm">${t}</span>`).join('')}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span class="status-pill ${m.MembershipStatus?.toLowerCase() === 'active' ? 'active' : 'inactive'}">${m.MembershipStatus || '—'}</span>
              ${m.is_volunteer === 'true'
                ? `<span class="status-pill" style="background:var(--navy-faint,#e8ecf5);color:var(--gold);border-color:var(--gold-line);font-size:10px;padding:2px 7px;">Volunteer</span>`
                : `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();makeContactVolunteer('${m.MemberID}',this)" title="Upgrade to volunteer">+ Volunteer</button>`}
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openContactModal(_allMembersCache[${cacheIdx}])" title="Edit contact">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;margin-right:2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit
              </button>
            </div>
          </div>`;
      }).join('')
    : emptyState('No contacts match the selected tag.');

  el.innerHTML = tagBar + selectAllBar + rows;
  _updateBulkBar();
}

// ── Bulk actions ─────────────────────────────────────────────────────────────
let _pendingBulkAction = null;

function updateBulkNotifyFields() {
  const ch = document.getElementById('bulk_Channel')?.value || 'email';
  const showSubject = ch === 'email' || ch === 'both';
  document.getElementById('bulk_SubjectWrap').style.display = showSubject ? '' : 'none';
  document.getElementById('bulk_Body').placeholder = ch === 'sms' ? 'Text message body…' : 'Message…';
  const label = ch === 'email' ? 'Send Email' : ch === 'sms' ? 'Send SMS' : 'Send Email + SMS';
  document.getElementById('bulkConfirmBtn').textContent = label;
  const listEl = document.getElementById('bulk_RecipientList');
  if (listEl) { listEl.innerHTML = _buildBulkRecipientList(ch); }
}

function _buildBulkRecipientList(channel) {
  const members = _allMembersCache || [];
  const list = [..._selectedMemberIds].map(id => members.find(m => m.MemberID === id)).filter(Boolean);
  if (!list.length) return '';

  const rows = list.map(m => {
    const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || m.MemberID;
    const parts = [];
    if (channel === 'email' || channel === 'both') parts.push(m.Email || '<span style="color:#ff6363">no email</span>');
    if (channel === 'sms'   || channel === 'both') parts.push(m.Phone || '<span style="color:#ff6363">no phone</span>');
    return `<div style="padding:2px 0;">${name} — ${parts.join(' · ')}</div>`;
  });
  return rows.join('');
}

function openBulkAction(action) {
  const count = _selectedMemberIds.size;
  if (!count) { alert('Select at least one contact first.'); return; }
  _pendingBulkAction = action;
  document.getElementById('bulkConfirmError').style.display = 'none';
  document.getElementById('bulkNotifyFields').style.display = action === 'notify' ? '' : 'none';
  document.getElementById('bulkTagFields').style.display    = action === 'tag'    ? '' : 'none';
  if (action === 'notify') {
    document.getElementById('bulk_Channel').value = 'email';
    document.getElementById('bulk_Subject').value = '';
    document.getElementById('bulk_Body').value    = '';
    updateBulkNotifyFields();
    const listEl = document.getElementById('bulk_RecipientList');
    listEl.innerHTML = _buildBulkRecipientList('email');
    listEl.style.display = '';
  }
  if (action === 'tag') document.getElementById('bulk_Tag').value = '';

  const labels = { delete: 'Delete Contacts', tag: 'Apply Tag', notify: 'Send Email' };
  const msgs   = {
    delete: `Permanently delete ${count} contact${count===1?'':'s'}? This cannot be undone.`,
    tag:    `Apply a tag to ${count} contact${count===1?'':'s'}.`,
    notify: ''
  };
  document.getElementById('bulkConfirmTitle').textContent = labels[action] || 'Confirm';
  document.getElementById('bulkConfirmMsg').textContent   = msgs[action]   || '';
  document.getElementById('bulkConfirmBtn').textContent   = labels[action] || 'Confirm';
  document.getElementById('bulkConfirmOverlay').classList.add('open');
  document.getElementById('bulkConfirmModal').classList.add('open');
}

function closeBulkConfirm() {
  document.getElementById('bulkConfirmOverlay')?.classList.remove('open');
  document.getElementById('bulkConfirmModal')?.classList.remove('open');
  _pendingBulkAction = null;
}

async function executeBulkAction() {
  const action = _pendingBulkAction;
  if (!action) return;
  const ids = [..._selectedMemberIds];
  const errEl = document.getElementById('bulkConfirmError');
  errEl.style.display = 'none';
  const btn = document.getElementById('bulkConfirmBtn');
  btn.disabled = true; btn.textContent = 'Working…';

  const body = { action, ids };
  if (action === 'tag') {
    body.tag = document.getElementById('bulk_Tag').value.trim();
    if (!body.tag) { errEl.textContent = 'Tag is required.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Apply Tag'; return; }
  }
  let notifyChannel = 'email';
  if (action === 'notify') {
    notifyChannel    = document.getElementById('bulk_Channel').value || 'email';
    body.channel     = notifyChannel;
    body.body        = document.getElementById('bulk_Body').value.trim();
    body.subject     = document.getElementById('bulk_Subject').value.trim();
    if (!body.body) { errEl.textContent = 'Message is required.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = btn.dataset.label || 'Send'; return; }
    if ((notifyChannel === 'email' || notifyChannel === 'both') && !body.subject) {
      errEl.textContent = 'Subject is required for email.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = btn.dataset.label || 'Send'; return;
    }
  }

  try {
    const res  = await fetch('/api/members/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Action failed.'; errEl.style.display = 'block'; return; }

    closeBulkConfirm();
    _selectedMemberIds.clear();
    await loadMembers();

    if (action === 'notify') {
      const parts = [];
      if (notifyChannel === 'email' || notifyChannel === 'both') parts.push(`${data.emailSent} email${data.emailSent !== 1 ? 's' : ''}`);
      if (notifyChannel === 'sms'   || notifyChannel === 'both') parts.push(`${data.smsSent} SMS`);
      const failed = data.results?.filter(r => {
        if (notifyChannel === 'sms'  && !r.sms?.sent)   return true;
        if (notifyChannel === 'email' && !r.email?.sent) return true;
        if (notifyChannel === 'both' && !r.sms?.sent && !r.email?.sent) return true;
        return false;
      }) || [];
      let msg = `Sent: ${parts.join(' + ')} (of ${data.total} contacts).`;
      if (failed.length) {
        const names = failed.map(r => r.name).join(', ');
        msg += `\nCould not reach: ${names}`;
      }
      alert(msg);
    } else if (action === 'delete') {
      alert(`${data.affected} contact${data.affected===1?'':'s'} deleted.`);
    } else if (action === 'tag') {
      alert(`Tag applied to ${data.affected} contact${data.affected===1?'':'s'}.`);
    }
  } catch (err) {
    errEl.textContent = 'Network error — please try again.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    const channelLabels = { email: 'Send Email', sms: 'Send SMS', both: 'Send Email + SMS' };
    btn.textContent = action === 'notify' ? (channelLabels[notifyChannel] || 'Send') : ({ delete: 'Delete Contacts', tag: 'Apply Tag' }[action] || 'Confirm');
  }
}

// ── Bulk: Assign to Youth Group ──────────────────────────────────────────────

let _bulkYGConflicts = []; // [{ memberID, name, currentGroupID, currentGroupName, action: 'reassign'|'skip' }]
let _bulkYGNoConflict = []; // memberIDs with no current group (assigned directly)

function openBulkYGModal() {
  if (!_selectedMemberIds.size) { alert('Select at least one contact first.'); return; }
  // Reset
  _bulkYGConflicts = [];
  _bulkYGNoConflict = [];
  document.getElementById('bulkYG_Search').value = '';
  document.getElementById('bulkYG_ID').value = '';
  document.getElementById('bulkYG_Role').value = '';
  document.getElementById('bulkYG_Suggest').style.display = 'none';
  document.getElementById('bulkYGStep1').style.display = '';
  document.getElementById('bulkYGStep2').style.display = 'none';
  document.getElementById('bulkYGSuccess').style.display = 'none';
  document.getElementById('bulkYGStep1Error').style.display = 'none';
  document.getElementById('bulkYGOverlay').classList.add('open');
  document.getElementById('bulkYGModal').classList.add('open');
  setTimeout(() => document.getElementById('bulkYG_Search').focus(), 80);
}

function closeBulkYGModal() {
  document.getElementById('bulkYGOverlay')?.classList.remove('open');
  document.getElementById('bulkYGModal')?.classList.remove('open');
}

function bulkYGSearch() {
  const q = (document.getElementById('bulkYG_Search').value || '').toLowerCase().trim();
  const sug = document.getElementById('bulkYG_Suggest');
  const groups = _youthGroupsCache || [];
  const hits = q.length < 1
    ? groups.slice(0, 10)
    : groups.filter(g => {
        const name = (g.youth_group_name || g.church_name || '').toLowerCase();
        const church = (g.church_name || '').toLowerCase();
        return name.includes(q) || church.includes(q);
      }).slice(0, 10);
  if (!hits.length) { sug.style.display = 'none'; return; }
  sug.innerHTML = hits.map(g => {
    const label = g.youth_group_name || g.church_name || g.id;
    const sub   = g.youth_group_name && g.church_name ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">${escHtml(g.church_name)}</span>` : '';
    return `<div style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--gold-line);"
      onclick="bulkYGPick('${g.id}')"
      onmousedown="event.preventDefault()">
      ${escHtml(label)}${sub}
    </div>`;
  }).join('');
  sug.style.display = 'block';
}

function bulkYGPick(id) {
  const grp   = (_youthGroupsCache || []).find(g => g.id === id);
  const label = grp ? (grp.youth_group_name || grp.church_name || id) : id;
  document.getElementById('bulkYG_ID').value = id;
  document.getElementById('bulkYG_Search').value = label;
  document.getElementById('bulkYG_Suggest').style.display = 'none';
  document.getElementById('bulkYGStep1Error').style.display = 'none';
}

function bulkYGContinue() {
  const groupID = document.getElementById('bulkYG_ID').value.trim();
  const errEl   = document.getElementById('bulkYGStep1Error');
  if (!groupID) {
    errEl.textContent = 'Please select a youth group.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const role     = document.getElementById('bulkYG_Role').value;
  const ids      = [..._selectedMemberIds];
  const members  = _allMembersCache || [];

  // Partition: no conflict vs. conflict (already in a DIFFERENT group)
  _bulkYGNoConflict = [];
  _bulkYGConflicts  = [];

  for (const id of ids) {
    const m = members.find(x => x.MemberID === id);
    if (!m) continue;
    const currentGID = (m.youth_group_id || '').trim();
    if (!currentGID || currentGID === groupID) {
      _bulkYGNoConflict.push(id);
    } else {
      const grp = (_youthGroupsCache || []).find(g => g.id === currentGID);
      const currentGroupName = grp ? (grp.youth_group_name || grp.church_name || currentGID) : currentGID;
      const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || m.MemberID;
      _bulkYGConflicts.push({ memberID: id, name, currentGroupID: currentGID, currentGroupName, action: 'reassign' });
    }
  }

  if (!_bulkYGConflicts.length) {
    // No conflicts — go straight to apply
    _bulkYGExecute(groupID, role, [..._bulkYGNoConflict]);
    return;
  }

  // Show conflict step
  _bulkYGRenderConflicts(groupID, role);
}

function _bulkYGRenderConflicts(groupID, role) {
  const grp  = (_youthGroupsCache || []).find(g => g.id === groupID);
  const dest = grp ? (grp.youth_group_name || grp.church_name || groupID) : groupID;
  const n    = _bulkYGConflicts.length;
  document.getElementById('bulkYGConflictIntro').textContent =
    `${n} selected contact${n === 1 ? ' is' : 's are'} already in another youth group. Choose what to do for each:`;

  document.getElementById('bulkYGConflictList').innerHTML = _bulkYGConflicts.map((c, i) =>
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(201,169,110,.1);" id="bulkYGCR_${i}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text-white);">${escHtml(c.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">Currently in: ${escHtml(c.currentGroupName)}</div>
      </div>
      <button class="btn btn-sm btn-gold" id="bulkYGCRbtn_${i}_reassign"
        onclick="bulkYGConflictOne(${i},'reassign')">Reassign</button>
      <button class="btn btn-sm btn-outline" id="bulkYGCRbtn_${i}_skip"
        onclick="bulkYGConflictOne(${i},'skip')" style="opacity:.55;">Skip</button>
    </div>`
  ).join('');

  const total = _bulkYGNoConflict.length + _bulkYGConflicts.filter(c => c.action === 'reassign').length;
  document.getElementById('bulkYGApplyBtn').textContent = `Assign ${total} contact${total === 1 ? '' : 's'}`;
  document.getElementById('bulkYGStep2Error').style.display = 'none';
  document.getElementById('bulkYGStep1').style.display = 'none';
  document.getElementById('bulkYGStep2').style.display = '';

  // Store current groupID/role on the modal for apply step
  document.getElementById('bulkYGModal').dataset.groupId = groupID;
  document.getElementById('bulkYGModal').dataset.role    = role;
}

function bulkYGConflictOne(i, action) {
  _bulkYGConflicts[i].action = action;
  const reassignBtn = document.getElementById(`bulkYGCRbtn_${i}_reassign`);
  const skipBtn     = document.getElementById(`bulkYGCRbtn_${i}_skip`);
  if (reassignBtn) { reassignBtn.classList.toggle('btn-gold', action === 'reassign'); reassignBtn.style.opacity = action === 'reassign' ? '1' : '.45'; }
  if (skipBtn)     { skipBtn.classList.toggle('btn-outline', true); skipBtn.style.opacity = action === 'skip' ? '1' : '.45'; }
  const total = _bulkYGNoConflict.length + _bulkYGConflicts.filter(c => c.action === 'reassign').length;
  document.getElementById('bulkYGApplyBtn').textContent = `Assign ${total} contact${total === 1 ? '' : 's'}`;
}

function bulkYGConflictAll(action) {
  _bulkYGConflicts.forEach((_, i) => bulkYGConflictOne(i, action));
}

function bulkYGBack() {
  document.getElementById('bulkYGStep2').style.display = 'none';
  document.getElementById('bulkYGStep1').style.display = '';
}

async function bulkYGApply() {
  const modal   = document.getElementById('bulkYGModal');
  const groupID = modal.dataset.groupId;
  const role    = modal.dataset.role;
  const ids     = [
    ..._bulkYGNoConflict,
    ..._bulkYGConflicts.filter(c => c.action === 'reassign').map(c => c.memberID)
  ];
  if (!ids.length) {
    document.getElementById('bulkYGStep2Error').textContent = 'No contacts to assign — mark at least one conflict as Reassign.';
    document.getElementById('bulkYGStep2Error').style.display = 'block';
    return;
  }
  await _bulkYGExecute(groupID, role, ids);
}

async function _bulkYGExecute(groupID, role, ids) {
  const btn = document.getElementById('bulkYGApplyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Assigning…'; }
  const step1Btn = document.querySelector('#bulkYGStep1 .btn-gold');
  if (step1Btn) { step1Btn.disabled = true; step1Btn.textContent = 'Assigning…'; }
  try {
    const res  = await fetch('/api/members/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign-youth-group', ids, youth_group_id: groupID, youth_group_role: role })
    });
    const data = await res.json();
    if (!res.ok) {
      const errId = document.getElementById('bulkYGStep2').style.display !== 'none' ? 'bulkYGStep2Error' : 'bulkYGStep1Error';
      document.getElementById(errId).textContent = data.error || 'Assignment failed.';
      document.getElementById(errId).style.display = 'block';
      return;
    }
    // Show success then close
    document.getElementById('bulkYGStep1').style.display = 'none';
    document.getElementById('bulkYGStep2').style.display = 'none';
    const ok = document.getElementById('bulkYGSuccess');
    ok.style.display = 'block';
    ok.textContent = `${data.affected} contact${data.affected === 1 ? '' : 's'} assigned.`;
    _selectedMemberIds.clear();
    await Promise.all([loadMembers(), loadYouthGroups()]);
    setTimeout(() => closeBulkYGModal(), 1200);
  } catch (err) {
    const errId = document.getElementById('bulkYGStep2').style.display !== 'none' ? 'bulkYGStep2Error' : 'bulkYGStep1Error';
    document.getElementById(errId).textContent = 'Network error — please try again.';
    document.getElementById(errId).style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; }
    if (step1Btn) { step1Btn.disabled = false; step1Btn.textContent = 'Continue →'; }
  }
}

// ── Contact create / edit modal ──────────────────────────────────────────────
let _contactModalMember = null;

function openContactModal(m) {
  _contactModalMember = m || null;
  const isEdit = !!m;
  document.getElementById('contactModalTitle').textContent     = isEdit ? 'Edit Contact' : 'Add Contact';
  document.getElementById('contactModalSubmit').textContent    = isEdit ? 'Save Changes' : 'Add Contact';
  document.getElementById('cm_first').value   = m?.FirstName         || '';
  document.getElementById('cm_last').value    = m?.LastName          || '';
  document.getElementById('cm_email').value   = m?.Email             || '';
  document.getElementById('cm_phone').value   = m?.Phone             || '';
  document.getElementById('cm_tags').value    = m?.Tags              || '';
  document.getElementById('cm_type').value    = m?.MembershipType    || '';
  document.getElementById('cm_status').value  = m?.MembershipStatus  || 'Active';
  document.getElementById('cm_notes').value   = m?.Notes             || '';
  document.getElementById('cm_youth_group').value = m?.youth_group_id || '';
  document.getElementById('contactModalSuccess').style.display = 'none';
  document.getElementById('contactModalNav').style.display    = 'flex';
  document.getElementById('contactModalOverlay').classList.add('open');
  document.getElementById('contactModal').classList.add('open');
  setTimeout(() => document.getElementById('cm_first').focus(), 80);
}

function closeContactModal() {
  document.getElementById('contactModalOverlay')?.classList.remove('open');
  document.getElementById('contactModal')?.classList.remove('open');
}

async function submitContactForm() {
  const firstName = document.getElementById('cm_first').value.trim();
  const lastName  = document.getElementById('cm_last').value.trim();
  const email     = document.getElementById('cm_email').value.trim();
  if (!firstName && !lastName && !email) {
    alert('Please fill in at least a name or email.');
    return;
  }

  const btn = document.getElementById('contactModalSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const body = {
      FirstName:        firstName,
      LastName:         lastName,
      Email:            email,
      Phone:            document.getElementById('cm_phone').value.trim(),
      Tags:             document.getElementById('cm_tags').value.trim(),
      MembershipType:   document.getElementById('cm_type').value,
      MembershipStatus: document.getElementById('cm_status').value,
      Notes:            document.getElementById('cm_notes').value.trim(),
      youth_group_id:   document.getElementById('cm_youth_group').value
    };
    const isEdit = !!_contactModalMember;
    const url    = isEdit ? `/api/members/${encodeURIComponent(_contactModalMember.MemberID)}` : '/api/members';
    const res    = await fetch(url, {
      method:  isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not save contact.'); return; }

    const ok = document.getElementById('contactModalSuccess');
    ok.style.display = 'block';
    ok.textContent   = isEdit ? 'Contact updated.' : 'Contact added.';
    document.getElementById('contactModalNav').style.display = 'none';
    await loadMembers();
    setTimeout(() => closeContactModal(), 1200);
  } catch (err) {
    alert('Network error — could not save contact.');
  } finally {
    btn.disabled    = false;
    btn.textContent = _contactModalMember ? 'Save Changes' : 'Add Contact';
    if (document.getElementById('contactModalSuccess').style.display === 'none') {
      document.getElementById('contactModalNav').style.display = 'flex';
    }
  }
}

// ── Volunteers (full list) ──────────────────────────────────────────────────
async function loadVolunteersFull() {
  try {
    const vols = await apiFetch('/api/volunteers');
    renderVolunteersFull(vols);
  } catch (e) {
    document.getElementById('volunteersFull').innerHTML = emptyState('Could not load volunteers.');
  }
}

let _volunteersCache = [];

function renderVolunteersFull(vols) {
  _volunteersCache = vols;
  const el = document.getElementById('volunteersFull');
  el.innerHTML = vols.length
    ? vols.map((v, idx) => {
        const name = [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email || '—';
        return `
          <div class="contact-row clickable" role="button" tabindex="0"
               onclick="location.href='/volunteers/${encodeURIComponent(v.VolunteerID)}'"
               onkeydown="if(event.key==='Enter')location.href='/volunteers/${encodeURIComponent(v.VolunteerID)}'">
            ${avatarHtml(name, null)}
            <div class="contact-info">
              <div class="contact-name">${name}</div>
              <div class="contact-email">${v.PreferredRole || v.Email || '—'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span class="status-pill ${v.Status?.toLowerCase() === 'active' ? 'active' : 'inactive'}">${v.Status || '—'}</span>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openVolEditModal(${idx})" title="Edit volunteer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;margin-right:2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit
              </button>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();confirmDeleteVol(${idx})" title="Delete volunteer" style="color:#ff6363;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;margin-right:2px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Del
              </button>
            </div>
          </div>`;
      }).join('')
    : emptyState('No volunteers yet — add your first volunteer to the Volunteers sheet to see them here.');
}

// ── Volunteer edit / delete ───────────────────────────────────────────────────
function openVolEditModal(idx) {
  const v = _volunteersCache[idx];
  if (!v) return;
  document.getElementById('vol_id').value     = v.VolunteerID  || '';
  document.getElementById('vol_first').value  = v.FirstName    || '';
  document.getElementById('vol_last').value   = v.LastName     || '';
  document.getElementById('vol_email').value  = v.Email        || '';
  document.getElementById('vol_phone').value  = v.Phone        || '';
  document.getElementById('vol_role').value   = v.PreferredRole || '';
  document.getElementById('vol_avail').value  = v.AvailabilityDays || '';
  document.getElementById('vol_status').value = v.Status       || 'Active';
  document.getElementById('vol_notes').value  = v.Notes        || '';
  document.getElementById('volEditSuccess').style.display = 'none';
  document.getElementById('volEditNav').style.display    = 'flex';
  document.getElementById('volEditOverlay').classList.add('open');
  document.getElementById('volEditModal').classList.add('open');
  setTimeout(() => document.getElementById('vol_first').focus(), 80);
}

function closeVolEditModal() {
  document.getElementById('volEditOverlay')?.classList.remove('open');
  document.getElementById('volEditModal')?.classList.remove('open');
}

async function submitVolEdit() {
  const id  = document.getElementById('vol_id').value;
  const btn = document.getElementById('vol_submit');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/volunteers/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        FirstName:        document.getElementById('vol_first').value.trim(),
        LastName:         document.getElementById('vol_last').value.trim(),
        Email:            document.getElementById('vol_email').value.trim(),
        Phone:            document.getElementById('vol_phone').value.trim(),
        PreferredRole:    document.getElementById('vol_role').value.trim(),
        AvailabilityDays: document.getElementById('vol_avail').value.trim(),
        Status:           document.getElementById('vol_status').value,
        Notes:            document.getElementById('vol_notes').value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not update volunteer.'); return; }
    const ok = document.getElementById('volEditSuccess');
    ok.style.display = 'block'; ok.textContent = 'Volunteer updated.';
    document.getElementById('volEditNav').style.display = 'none';
    await loadVolunteersFull();
    setTimeout(() => closeVolEditModal(), 1200);
  } catch (err) {
    alert('Network error — could not update volunteer.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

async function confirmDeleteVol(idx) {
  const v = _volunteersCache[idx];
  if (!v) return;
  const name = [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email || 'this volunteer';
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/volunteers/${encodeURIComponent(v.VolunteerID)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not delete volunteer.'); return; }
    await loadVolunteersFull();
  } catch (err) {
    alert('Network error — could not delete volunteer.');
  }
}

// ── Add Volunteer (board-initiated, with dedupe) ─────────────────────────────
function openAddVolModal() {
  ['av_first','av_last','av_email','av_phone','av_role','av_avail','av_notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('addVolExact').style.display   = 'none';
  document.getElementById('addVolNav').style.display     = 'flex';
  document.getElementById('addVolSuccess').style.display = 'none';
  document.getElementById('addVolOverlay').classList.add('open');
  document.getElementById('addVolModal').classList.add('open');
  setTimeout(() => document.getElementById('av_first').focus(), 80);
}

function closeAddVolModal() {
  document.getElementById('addVolOverlay')?.classList.remove('open');
  document.getElementById('addVolModal')?.classList.remove('open');
}

function _addVolPayload() {
  return {
    FirstName: document.getElementById('av_first').value.trim(),
    LastName:  document.getElementById('av_last').value.trim(),
    Email:     document.getElementById('av_email').value.trim(),
    Phone:     document.getElementById('av_phone').value.trim(),
    PreferredRole:    document.getElementById('av_role').value.trim(),
    AvailabilityDays: document.getElementById('av_avail').value.trim(),
    Notes:     document.getElementById('av_notes').value.trim()
  };
}

async function submitAddVol(action, linkMemberID) {
  const payload = _addVolPayload();
  if (!payload.FirstName || !payload.LastName) {
    alert('First and last name are required.');
    return;
  }
  if (action) payload.action = action;
  if (linkMemberID) payload.linkMemberID = linkMemberID;

  const btn = document.getElementById('addVolSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

  try {
    const res  = await fetch('/api/volunteers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.status === 409 && data.code === 'exact_match') {
      _showAddVolExact(data.matches);
      return;
    }
    if (!res.ok) {
      alert(data.error || 'Could not add volunteer.');
      return;
    }

    const ok = document.getElementById('addVolSuccess');
    ok.style.display = 'block';
    ok.textContent   = data.action === 'linked' ? 'Contact upgraded to volunteer.' : 'Volunteer added.';
    document.getElementById('addVolNav').style.display   = 'none';
    document.getElementById('addVolExact').style.display = 'none';
    await Promise.all([loadVolunteersFull(), loadMembers(), loadStats()]);
    setTimeout(() => closeAddVolModal(), 1400);
  } catch (err) {
    alert('Network error — could not add volunteer.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add Volunteer'; }
  }
}

function _showAddVolExact(matches) {
  document.getElementById('addVolNav').style.display  = 'none';
  const msgEl  = document.getElementById('addVolExactMsg');
  const btnsEl = document.getElementById('addVolExactBtns');
  msgEl.innerHTML = matches.slice(0, 3).map(m => {
    const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || '—';
    return `<div style="margin-bottom:4px;">• ${name}${m.Email ? ` · ${m.Email}` : ''}${m.is_volunteer === 'true' ? ' <em>(already a volunteer)</em>' : ''}</div>`;
  }).join('') + '<div style="margin-top:6px;">What would you like to do?</div>';

  btnsEl.innerHTML = [
    `<div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-outline btn-sm" onclick="closeAddVolModal()">Cancel</button>
      ${matches.map(m => {
        const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.MemberID;
        const alreadyVol = m.is_volunteer === 'true';
        return alreadyVol
          ? `<button class="btn btn-ghost btn-sm" disabled title="Already a volunteer">Link "${name}" (already volunteer)</button>`
          : `<button class="btn btn-outline btn-sm" onclick="submitAddVol('link','${m.MemberID}')">Link "${name}"</button>`;
      }).join('')}
      <button class="btn btn-gold btn-sm" onclick="submitAddVol('create')">Create New</button>
    </div>`
  ].join('');
  document.getElementById('addVolExact').style.display = '';
}

// ── Make contact a volunteer (from Contacts list) ────────────────────────────
async function makeContactVolunteer(memberID, btn) {
  if (!confirm('Upgrade this contact to a volunteer? They will appear in the Volunteers section.')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Upgrading…'; }
  try {
    const res  = await fetch(`/api/members/${encodeURIComponent(memberID)}/make-volunteer`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not upgrade contact.'); return; }
    await Promise.all([loadMembers(), loadVolunteersFull(), loadStats()]);
  } catch (err) {
    alert('Network error — could not upgrade contact.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '+ Volunteer'; }
  }
}

// ── Pending volunteers sidebar badge ─────────────────────────────────────────
async function loadPendingVolunteerBadge() {
  const badge = document.getElementById('pendingVolunteersBadge');
  if (!badge) return;
  try {
    const pending = await apiFetch('/api/volunteers/pending');
    if (pending.length) { badge.textContent = pending.length; badge.style.display = 'flex'; }
  } catch (e) { /* badge just stays hidden if this fails */ }
}

// ── Pending queue (in Volunteers tab) ────────────────────────────────────────
let _pendingQueueCache = [];

async function loadPendingQueue() {
  try {
    _pendingQueueCache = await apiFetch('/api/volunteers/pending');
  } catch (e) {
    _pendingQueueCache = [];
  }
  renderPendingQueue();
}

function renderPendingQueue() {
  const card   = document.getElementById('pendingQueueCard');
  const listEl = document.getElementById('pendingQueueList');
  const countEl= document.getElementById('pendingQueueCount');
  if (!card) return;

  if (!_pendingQueueCache.length) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  if (countEl) countEl.textContent = _pendingQueueCache.length;

  listEl.innerHTML = _pendingQueueCache.map(p => {
    const name = [p.FirstName, p.LastName].filter(Boolean).join(' ') || p.Email;
    const sub  = [p.Email, p.Phone, p.Church].filter(Boolean).join(' · ');
    const since = p.RegisteredAt ? ` · Registered ${fmtDate(p.RegisteredAt)}` : '';
    return `
      <div class="list-item" id="pq-${p.VolunteerID}">
        ${avatarHtml(name, null)}
        <div class="item-info" style="flex:1;min-width:0;">
          <div class="item-title">${name}</div>
          <div class="item-sub">${sub}${since}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button class="btn btn-outline btn-sm" onclick="declinePending('${p.VolunteerID}')">Decline</button>
          <button class="btn btn-gold btn-sm" onclick="openConfirmVolModal('${p.VolunteerID}')">Review &amp; Approve</button>
        </div>
      </div>`;
  }).join('');
}

// ── Confirm Volunteer modal ───────────────────────────────────────────────────
let _confirmVolID = null;

function openConfirmVolModal(volID) {
  _confirmVolID = volID;
  const p = _pendingQueueCache.find(x => x.VolunteerID === volID);
  if (!p) return;

  const name = [p.FirstName, p.LastName].filter(Boolean).join(' ') || p.Email;
  const info = document.getElementById('confirmVolInfo');
  if (info) {
    info.innerHTML = `
      <strong style="color:var(--navy);font-size:14px;">${name}</strong><br>
      ${p.Email ? `<span>${p.Email}</span>` : ''}
      ${p.Phone ? ` &middot; <span>${p.Phone}</span>` : ''}
      ${p.Church ? ` &middot; <span>${p.Church}</span>` : ''}`;
  }

  document.getElementById('confirmVolWarn').style.display    = 'none';
  document.getElementById('confirmVolExact').style.display   = 'none';
  document.getElementById('confirmVolNav').style.display     = 'flex';
  document.getElementById('confirmVolSuccess').style.display = 'none';
  document.getElementById('confirmVolSubmit').disabled = false;
  document.getElementById('confirmVolSubmit').textContent = 'Approve';
  document.getElementById('confirmVolOverlay').classList.add('open');
  document.getElementById('confirmVolModal').classList.add('open');
}

function closeConfirmVolModal() {
  document.getElementById('confirmVolOverlay')?.classList.remove('open');
  document.getElementById('confirmVolModal')?.classList.remove('open');
  _confirmVolID = null;
}

async function submitConfirmVol(action, linkMemberID) {
  if (!_confirmVolID) return;
  const btn = document.getElementById('confirmVolSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

  const body = {};
  if (action)       body.action       = action;
  if (linkMemberID) body.linkMemberID = linkMemberID;

  try {
    const res  = await fetch(`/api/volunteers/${encodeURIComponent(_confirmVolID)}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (res.status === 409 && data.code === 'exact_match') {
      _showConfirmExact(data.matches);
      return;
    }
    if (!res.ok) {
      alert(data.error || 'Could not confirm volunteer.');
      return;
    }

    const ok = document.getElementById('confirmVolSuccess');
    ok.style.display = 'block';
    ok.textContent   = 'Volunteer approved!';
    document.getElementById('confirmVolNav').style.display   = 'none';
    document.getElementById('confirmVolExact').style.display = 'none';
    await Promise.all([loadPendingQueue(), loadVolunteersFull(), loadStats(), loadPendingVolunteerBadge()]);
    setTimeout(() => closeConfirmVolModal(), 1400);
  } catch (err) {
    alert('Network error — could not confirm volunteer.');
  } finally {
    if (btn && document.getElementById('confirmVolSuccess')?.style.display === 'none') {
      btn.disabled = false; btn.textContent = 'Approve';
    }
  }
}

function _showConfirmExact(matches) {
  document.getElementById('confirmVolNav').style.display  = 'none';
  document.getElementById('confirmVolWarn').style.display = 'none';
  const msgEl  = document.getElementById('confirmVolExactMsg');
  const btnsEl = document.getElementById('confirmVolExactBtns');
  msgEl.innerHTML = matches.slice(0, 3).map(m => {
    const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || '—';
    return `<div style="margin-bottom:4px;">• ${name}${m.Email ? ` · ${m.Email}` : ''}${m.is_volunteer === 'true' ? ' <em>(already volunteer)</em>' : ''}</div>`;
  }).join('') + '<div style="margin-top:6px;">What would you like to do?</div>';
  btnsEl.innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="closeConfirmVolModal()">Cancel</button>
    ${matches.map(m => {
      const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.MemberID;
      const alreadyVol = m.is_volunteer === 'true';
      return alreadyVol
        ? `<button class="btn btn-ghost btn-sm" disabled>Link "${name}" (already volunteer)</button>`
        : `<button class="btn btn-outline btn-sm" onclick="submitConfirmVol('link','${m.MemberID}')">Link "${name}"</button>`;
    }).join('')}
    <button class="btn btn-gold btn-sm" onclick="submitConfirmVol('create')">Create New</button>`;
  document.getElementById('confirmVolExact').style.display = '';
}

async function declinePending(volID) {
  if (!confirm('Decline this volunteer registration? They will receive a notice email.')) return;
  const row = document.getElementById(`pq-${volID}`);
  if (row) row.style.opacity = '0.5';
  try {
    const res  = await fetch(`/api/volunteers/${encodeURIComponent(volID)}/decline`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not decline volunteer.'); if (row) row.style.opacity = ''; return; }
    await Promise.all([loadPendingQueue(), loadPendingVolunteerBadge()]);
  } catch (err) {
    alert('Network error — could not decline.');
    if (row) row.style.opacity = '';
  }
}

// ── Announcements ────────────────────────────────────────────────────────────
async function loadAnnouncements() {
  try {
    const items  = await apiFetch('/api/announcements');
    const active = filterAnnouncements(items, ['All', 'Board']);
    document.getElementById('announcementsPreview').innerHTML = active.length
      ? active.slice(0, 4).map(renderAnnouncementItem).join('')
      : emptyState('No announcements yet. Add them to the Announcements sheet.');
  } catch (e) {
    document.getElementById('announcementsPreview').innerHTML = emptyState('Could not load announcements.');
  }
}

// ── Create Event modal ───────────────────────────────────────────────────────
let _ceStep = 1;
const _CE_STEPS = 3;

function openCreateEventModal(prefillDate) {
  _ceStep = 1;
  const fields = [
    'ce_name','ce_type','ce_desc',
    'ce_startDate','ce_endDate','ce_startTime','ce_endTime','ce_location','ce_address',
    'ce_capacity','ce_volunteers','ce_regDeadline','ce_cost','ce_coordName','ce_coordEmail'
  ];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Pre-fill date when launched from the calendar tile
  if (prefillDate) {
    const sd = document.getElementById('ce_startDate');
    if (sd) sd.value = prefillDate;
  }
  document.getElementById('createEventSuccess').style.display = 'none';
  document.getElementById('createStepForm').style.display    = 'flex';
  document.getElementById('createEventNav').style.display    = 'flex';
  document.getElementById('createStepIndicator').style.display = 'flex';
  _syncCeStep();
  document.getElementById('createEventOverlay').classList.add('open');
  document.getElementById('createEventModal').classList.add('open');
}

function closeCreateEventModal() {
  document.getElementById('createEventOverlay')?.classList.remove('open');
  document.getElementById('createEventModal')?.classList.remove('open');
}

function _syncCeStep() {
  for (let i = 1; i <= _CE_STEPS; i++) {
    const pane = document.getElementById(`createPane${i}`);
    const dot  = document.getElementById(`createDot${i}`);
    if (pane) pane.style.display = i === _ceStep ? 'flex' : 'none';
    if (dot)  dot.className = 'step-dot' + (i === _ceStep ? ' active' : i < _ceStep ? ' done' : '');
  }
  const prev = document.getElementById('createPrevBtn');
  const next = document.getElementById('createNextBtn');
  const sub  = document.getElementById('createSubmitBtn');
  if (prev) prev.style.display = _ceStep > 1 ? '' : 'none';
  if (next) next.style.display = _ceStep < _CE_STEPS ? '' : 'none';
  if (sub)  sub.style.display  = _ceStep === _CE_STEPS ? '' : 'none';
}

function createEventNext() {
  if (_ceStep === 1 && !document.getElementById('ce_name').value.trim()) {
    alert('Event name is required before continuing.');
    document.getElementById('ce_name').focus();
    return;
  }
  if (_ceStep === 2 && !document.getElementById('ce_startDate').value) {
    alert('Start date is required before continuing.');
    document.getElementById('ce_startDate').focus();
    return;
  }
  if (_ceStep < _CE_STEPS) { _ceStep++; _syncCeStep(); }
}

function createEventPrev() {
  if (_ceStep > 1) { _ceStep--; _syncCeStep(); }
}

async function submitCreateEvent() {
  const name      = document.getElementById('ce_name').value.trim();
  const startDate = document.getElementById('ce_startDate').value;
  if (!name || !startDate) { alert('Event name and start date are required.'); return; }

  const btn = document.getElementById('createSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const body = {
      EventName:            name,
      EventType:            document.getElementById('ce_type').value,
      Description:          document.getElementById('ce_desc').value.trim(),
      StartDate:            startDate,
      EndDate:              document.getElementById('ce_endDate').value || startDate,
      StartTime:            document.getElementById('ce_startTime').value,
      EndTime:              document.getElementById('ce_endTime').value,
      Location:             document.getElementById('ce_location').value.trim(),
      Address:              document.getElementById('ce_address').value.trim(),
      Capacity:             document.getElementById('ce_capacity').value || '0',
      VolunteersNeeded:     document.getElementById('ce_volunteers').value || '0',
      RegistrationDeadline: document.getElementById('ce_regDeadline').value,
      Cost:                 document.getElementById('ce_cost').value || '0',
      CoordinatorName:      document.getElementById('ce_coordName').value.trim(),
      CoordinatorEmail:     document.getElementById('ce_coordEmail').value.trim()
    };
    const res  = await fetch('/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not create event.'); return; }

    document.getElementById('createStepForm').style.display     = 'none';
    document.getElementById('createEventNav').style.display     = 'none';
    document.getElementById('createStepIndicator').style.display = 'none';
    const ok = document.getElementById('createEventSuccess');
    ok.style.display = 'block';
    ok.innerHTML = `
      <p>✅ <strong>${name}</strong> created with Planning status.</p>
      <a class="btn btn-gold btn-sm" style="margin-top:12px;display:inline-flex;" href="/events/${encodeURIComponent(data.EventID)}">Open Event →</a>`;

    await loadEvents();
  } catch (err) {
    alert('Network error — could not create event. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Event';
  }
}

// ── Notification preferences ──────────────────────────────────────────────────

async function loadNotifSummary() {
  const el = document.getElementById('boardNotifSummary');
  if (!el) return;
  try {
    const prefs = await apiFetch('/api/notification-prefs');
    const on  = (v) => v !== 'false' ? '✓' : '—';
    el.innerHTML = `<table style="border-collapse:collapse;font-size:13px;">
      <tr><th style="text-align:left;padding:2px 12px 2px 0;color:var(--text-dim);">Category</th><th style="padding:2px 8px;color:var(--text-dim);">Email</th><th style="padding:2px 8px;color:var(--text-dim);">SMS</th></tr>
      <tr><td>Event sign-up confirmations</td><td style="text-align:center;">${on(prefs.EmailEvents)}</td><td style="text-align:center;">${on(prefs.SMSEvents)}</td></tr>
      <tr><td>Task assignments</td><td style="text-align:center;">${on(prefs.EmailTasks)}</td><td style="text-align:center;">${on(prefs.SMSTasks)}</td></tr>
      <tr><td>Announcements</td><td style="text-align:center;">${on(prefs.EmailAnnouncements)}</td><td style="text-align:center;">${on(prefs.SMSAnnouncements)}</td></tr>
    </table>${prefs.Phone ? `<div style="margin-top:8px;">SMS to: ${prefs.Phone}</div>` : ''}`;
  } catch (_) { el.textContent = 'Could not load notification preferences.'; }
}

async function openNotifPrefs() {
  document.getElementById('npError').style.display    = 'none';
  document.getElementById('npSuccess').style.display  = 'none';
  document.getElementById('notifOverlay').classList.add('open');
  document.getElementById('notifModal').classList.add('open');
  try {
    const prefs = await apiFetch('/api/notification-prefs');
    document.getElementById('np_EmailEvents').checked        = prefs.EmailEvents        !== 'false';
    document.getElementById('np_EmailTasks').checked         = prefs.EmailTasks         !== 'false';
    document.getElementById('np_EmailAnnouncements').checked = prefs.EmailAnnouncements !== 'false';
    document.getElementById('np_SMSEvents').checked          = prefs.SMSEvents          === 'true';
    document.getElementById('np_SMSTasks').checked           = prefs.SMSTasks           === 'true';
    document.getElementById('np_SMSAnnouncements').checked   = prefs.SMSAnnouncements   === 'true';
    document.getElementById('np_Phone').value                = prefs.Phone || '';
  } catch (_) {}
}

function closeNotifPrefs() {
  document.getElementById('notifOverlay').classList.remove('open');
  document.getElementById('notifModal').classList.remove('open');
}

async function saveNotifPrefs() {
  const errEl = document.getElementById('npError');
  const btn   = document.getElementById('npSubmitBtn');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/notification-prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        EmailEvents:        document.getElementById('np_EmailEvents').checked,
        EmailTasks:         document.getElementById('np_EmailTasks').checked,
        EmailAnnouncements: document.getElementById('np_EmailAnnouncements').checked,
        SMSEvents:          document.getElementById('np_SMSEvents').checked,
        SMSTasks:           document.getElementById('np_SMSTasks').checked,
        SMSAnnouncements:   document.getElementById('np_SMSAnnouncements').checked,
        Phone:              document.getElementById('np_Phone').value.trim()
      })
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); errEl.textContent = d.error || 'Save failed.'; errEl.style.display = 'block'; return; }
    document.getElementById('npSuccess').style.display = 'block';
    await loadNotifSummary();
    setTimeout(closeNotifPrefs, 1500);
  } catch (_) {
    errEl.textContent = 'Network error — please try again.'; errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Preferences';
  }
}

// ── Youth Groups ──────────────────────────────────────────────────────────────
let _youthGroupsCache = [];
let _activeContactsView = 'contacts'; // 'contacts' | 'youthgroups'

async function loadYouthGroups() {
  try {
    _youthGroupsCache = await apiFetch('/api/youth-groups');
    if (_activeContactsView === 'youthgroups') renderYouthGroupsFull();
    _populateContactYGDropdown();
    _populateYGContactDropdown();
  } catch (e) {
    document.getElementById('youthGroupsFull').innerHTML = emptyState('Could not load youth groups.');
  }
}

// Populate the Youth Group dropdown inside the contact create/edit modal
function _populateContactYGDropdown() {
  const sel = document.getElementById('cm_youth_group');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Unassigned —</option>' +
    _youthGroupsCache.map(g => {
      const name = g.youth_group_name || g.church_name || g.id;
      return `<option value="${g.id}">${name}</option>`;
    }).join('');
  if (current) sel.value = current;
}

// Populate the "Link an existing contact" dropdown in the YG modal.
// Excludes contacts already in _ygLinkedContacts (not removed).
function _populateYGContactDropdown() {
  const sel = document.getElementById('yg_contact_id');
  if (!sel) return;
  const linked = new Set(
    (_ygLinkedContacts || []).filter(c => c._status !== 'removed').map(c => c.id)
  );
  sel.innerHTML = '<option value="">— Link an existing contact… —</option>' +
    _allMembersCache
      .filter(m => !linked.has(m.MemberID))
      .map(m => {
        const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || m.MemberID;
        return `<option value="${m.MemberID}">${escHtml(name)}</option>`;
      }).join('');
}

// ── View switcher ─────────────────────────────────────────────────────────────
function switchContactsView(view) {
  _activeContactsView = view;
  const isContacts = view === 'contacts';
  document.getElementById('membersFull').style.display       = isContacts ? '' : 'none';
  document.getElementById('membersBulkBar').style.display    = isContacts ? '' : 'none';
  document.getElementById('youthGroupsFull').style.display   = isContacts ? 'none' : '';
  document.getElementById('addContactBtn').style.display     = isContacts ? '' : 'none';
  document.getElementById('addYGBtn').style.display          = isContacts ? 'none' : '';
  document.getElementById('exportContactsBtn').style.display = isContacts ? '' : 'none';
  document.getElementById('vswContacts').classList.toggle('active', isContacts);
  document.getElementById('vswYouthGroups').classList.toggle('active', !isContacts);
  if (!isContacts) renderYouthGroupsFull();
}

// ── Youth Group list ─────────────────────────────────────────────────────────
function _ygDisplayName(g) {
  return g.youth_group_name || g.church_name || '—';
}

function renderYouthGroupsFull() {
  const el = document.getElementById('youthGroupsFull');
  if (!el) return;
  if (!_youthGroupsCache.length) {
    el.innerHTML = `<div style="padding:20px;">${emptyState('No youth groups yet — use "+ Add Group" to create your first one.')}</div>`;
    return;
  }
  el.innerHTML = `<div class="yg-grid">${_youthGroupsCache.map((g, idx) => ygCard(g, idx)).join('')}</div>`;
}

function ygCard(g, idx) {
  const name   = _ygDisplayName(g);
  const loc    = [g.city, g.state].filter(Boolean).join(', ');
  const tags   = g.tags ? g.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const isPartner = g.category === 'Partner';
  // Resolve primary contact name from members cache when stored value looks like a raw ID
  let pc = g.primary_contact_name || '';
  if (g.primary_contact_id && (!pc || /^M-/.test(pc))) {
    const m = (_allMembersCache || []).find(x => x.MemberID === g.primary_contact_id);
    if (m) pc = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || '';
  }
  return `
    <div class="yg-card" role="button" tabindex="0"
         onclick="openYGPanel(_youthGroupsCache[${idx}])"
         onkeydown="if(event.key==='Enter')openYGPanel(_youthGroupsCache[${idx}])">
      <div class="yg-card-header">
        <div class="yg-card-name">${name}</div>
        <span class="yg-cat-badge ${isPartner ? 'partner' : 'prospect'}">${g.category || 'Prospect'}</span>
      </div>
      ${g.church_name && g.youth_group_name ? `<div class="yg-card-church">${g.church_name}</div>` : ''}
      ${loc ? `<div class="yg-card-loc">${loc}</div>` : ''}
      ${pc  ? `<div class="yg-card-pc">Contact: ${pc}</div>` : ''}
      ${tags.length ? `<div class="yg-card-tags">${tags.map(t => `<span class="tag-chip-sm">${t}</span>`).join('')}</div>` : ''}
      ${g.instagram_handle ? `<div class="yg-card-ig" title="@${g.instagram_handle}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:10px;height:10px;"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> @${g.instagram_handle}</div>` : ''}
    </div>`;
}

// ── Youth Group slide panel ───────────────────────────────────────────────────
let _currentYG = null;

async function openYGPanel(g) {
  _currentYG = g;
  const panel = document.getElementById('ygPanel');
  const body  = document.getElementById('ygPanelBody');
  body.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
  panel.classList.add('open');
  document.getElementById('ygPanelOverlay').classList.add('open');

  try {
    const detail = await apiFetch(`/api/youth-groups/${encodeURIComponent(g.id)}`);
    _currentYG = detail;
    const name    = _ygDisplayName(detail);
    const loc     = [detail.address, detail.city, detail.state, detail.zip].filter(Boolean).join(', ');
    const tags    = detail.tags ? detail.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const isPartner = detail.category === 'Partner';
    const contacts  = detail.contacts || [];

    // primary_contact_name is server-resolved, but guard against raw M- IDs stored in old records
    let pcName = detail.primary_contact_name || '';
    if (detail.primary_contact_id && (!pcName || /^M-/.test(pcName))) {
      const linked = (detail.contacts || []).find(m => m.MemberID === detail.primary_contact_id);
      if (linked) pcName = [linked.FirstName, linked.LastName].filter(Boolean).join(' ') || linked.Email || '';
    }
    const pcHtml = detail.primary_contact_id
      ? `<a href="/members/${encodeURIComponent(detail.primary_contact_id)}">${pcName || detail.primary_contact_id}</a>`
      : (pcName || '—');

    body.innerHTML = `
      <div class="yg-panel-title">
        <div>
          <div style="font-size:17px;font-weight:700;color:var(--text-white);">${name}</div>
          ${detail.church_name && detail.youth_group_name ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px;">${detail.church_name}</div>` : ''}
        </div>
        <span class="yg-cat-badge ${isPartner ? 'partner' : 'prospect'}" style="flex-shrink:0;">${detail.category || 'Prospect'}</span>
      </div>
      <div class="detail-field-grid" style="grid-template-columns:1fr;margin-top:12px;">
        <div class="detail-field">
          <div class="detail-field-label">Address</div>
          <div class="detail-field-value${loc ? '' : ' empty'}">${loc || '—'}</div>
          ${detail.location_type === 'approximate' ? '<div class="loc-approx-badge">~ Approximate location</div>' : ''}
          ${detail.location_type === 'exact'       ? '<div class="loc-exact-badge">&#x1F4CD; Exact location</div>' : ''}
        </div>
        <div class="detail-field">
          <div class="detail-field-label">Primary Contact</div>
          <div class="detail-field-value">${pcHtml}</div>
          ${detail.primary_contact_phone ? `<div class="detail-field-value" style="font-size:12px;">${detail.primary_contact_phone}</div>` : ''}
          ${detail.primary_contact_email ? `<div class="detail-field-value" style="font-size:12px;"><a href="mailto:${detail.primary_contact_email}">${detail.primary_contact_email}</a></div>` : ''}
        </div>
        ${tags.length ? `<div class="detail-field"><div class="detail-field-label">Tags</div><div class="contact-tags">${tags.map(t => `<span class="tag-chip-sm">${t}</span>`).join('')}</div></div>` : ''}
        ${detail.notes ? `<div class="detail-field"><div class="detail-field-label">Notes</div><div class="detail-field-value">${detail.notes}</div></div>` : ''}
      </div>

      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-dim);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px;">
          Linked Contacts (${contacts.length})
        </div>
        ${contacts.length ? contacts.map(m => {
          const cname = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || '—';
          const isPrimary = m.MemberID === detail.primary_contact_id;
          const roleLabel = m.youth_group_role ? `<span style="font-size:10.5px;color:var(--text-dim);">${escHtml(m.youth_group_role)}</span>` : '';
          const primaryBadge = isPrimary ? `<span class="yg-lc-primary-badge">Primary</span>` : '';
          return `<a href="/members/${encodeURIComponent(m.MemberID)}" class="yg-contact-row">
            ${avatarHtml(cname, null)}
            <div class="contact-info">
              <div class="contact-name">${escHtml(cname)}</div>
              <div class="contact-email">${m.Email || '—'} ${roleLabel}</div>
            </div>
            ${primaryBadge}
          </a>`;
        }).join('') : `<div style="color:var(--text-muted);font-size:13px;">No contacts linked yet. Use "Edit Group" to add contacts.</div>`}
      </div>

      ${detail.instagram_handle ? `
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
        <a class="btn btn-outline btn-sm" style="flex:1;justify-content:center;"
           href="https://instagram.com/${encodeURIComponent(detail.instagram_handle)}" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;margin-right:5px;"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          View on Instagram
        </a>
        <a class="btn btn-outline btn-sm" style="flex:1;justify-content:center;"
           href="https://ig.me/m/${encodeURIComponent(detail.instagram_handle)}" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;margin-right:5px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Message on Instagram
        </a>
      </div>` : ''}

      <div style="display:flex;gap:8px;margin-top:${detail.instagram_handle ? '8px' : '20px'};flex-wrap:wrap;">
        <button class="btn btn-gold btn-sm" style="flex:1;" onclick="openYGModal(_currentYG)">Edit Group</button>
        <button class="btn btn-outline btn-sm" style="color:#ff6363;border-color:#ff636344;" onclick="confirmDeleteYG()">Delete</button>
      </div>`;
  } catch (e) {
    body.innerHTML = emptyState('Could not load youth group details.');
  }
}

function closeYGPanel() {
  document.getElementById('ygPanel')?.classList.remove('open');
  document.getElementById('ygPanelOverlay')?.classList.remove('open');
}

// ── Youth Group create / edit modal ───────────────────────────────────────────
let _ygModalGroup = null;

// Linked contacts state for the modal.
// Each entry: { id, name, email, role, isPrimary, _status: 'original'|'added'|'removed', _origRole }
let _ygLinkedContacts = [];

function openYGModal(g) {
  _ygModalGroup = g || null;
  const isEdit = !!g;
  document.getElementById('ygModalTitle').textContent   = isEdit ? 'Edit Youth Group' : 'Add Youth Group';
  document.getElementById('ygModalSubmit').textContent  = isEdit ? 'Save Changes' : 'Add Group';
  document.getElementById('yg_name').value       = g?.youth_group_name      || '';
  document.getElementById('yg_church').value     = g?.church_name           || '';
  document.getElementById('yg_category').value   = g?.category              || 'Prospect';
  document.getElementById('yg_address').value    = g?.address               || '';
  document.getElementById('yg_city').value       = g?.city                  || '';
  document.getElementById('yg_state').value      = g?.state                 || '';
  document.getElementById('yg_zip').value        = g?.zip                   || '';
  document.getElementById('yg_instagram').value  = g?.instagram_handle      || '';
  document.getElementById('yg_tags').value       = g?.tags                  || '';
  document.getElementById('yg_notes').value      = g?.notes                 || '';

  // ── Initialise linked contacts from the group's contact list ─────────────
  if (isEdit && Array.isArray(g.contacts)) {
    _ygLinkedContacts = g.contacts.map(m => ({
      id:       m.MemberID,
      name:     [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || m.MemberID,
      email:    m.Email || '',
      role:     m.youth_group_role || '',
      isPrimary: m.MemberID === (g.primary_contact_id || ''),
      _status:  'original',
      _origRole: m.youth_group_role || ''
    }));
    // Ensure exactly one primary (the stored primary_contact_id wins)
    const hasPrimary = _ygLinkedContacts.some(c => c.isPrimary);
    if (!hasPrimary && g.primary_contact_id) {
      // primary_contact_id not in contacts list — could be a dangling ref; keep it tracked
      _ygLinkedContacts.push({
        id: g.primary_contact_id,
        name: g.primary_contact_name || g.primary_contact_id,
        email: g.primary_contact_email || '',
        role: '',
        isPrimary: true,
        _status: 'original',
        _origRole: ''
      });
    }
  } else {
    _ygLinkedContacts = [];
  }

  // Reset free-text new contact section
  document.getElementById('yg_pc_name').value    = '';
  document.getElementById('yg_pc_phone').value   = '';
  document.getElementById('yg_pc_email').value   = '';
  document.getElementById('yg_pc_role_new').value = '';
  document.getElementById('yg_pc_new_is_primary').checked = false;
  document.getElementById('yg_new_contact_fields').style.display = 'none';

  // Restore autocomplete hidden state for existing groups
  document.getElementById('yg_lat').value           = g?.lat           || '';
  document.getElementById('yg_lng').value           = g?.lng           || '';
  document.getElementById('yg_location_type').value = g?.location_type || '';
  if (typeof ygAcReset     === 'function') ygAcReset();
  if (typeof ygAcSetStatus === 'function') ygAcSetStatus(g?.location_type || '');

  _populateYGContactDropdown();
  ygRenderLinkedList();

  document.getElementById('ygModalSuccess').style.display = 'none';
  document.getElementById('ygModalNav').style.display    = 'flex';
  document.getElementById('ygModalOverlay').classList.add('open');
  document.getElementById('ygModal').classList.add('open');
  setTimeout(() => document.getElementById('yg_name').focus(), 80);
}

// ── Linked contacts list rendering ───────────────────────────────────────────
const YG_ROLES = ['', 'Member', 'Leader', 'Youth Pastor', 'Parent', 'Other'];

function ygRenderLinkedList() {
  const container = document.getElementById('yg_linked_list');
  if (!container) return;
  const visible = _ygLinkedContacts.filter(c => c._status !== 'removed');
  if (!visible.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">No contacts linked yet.</div>`;
    return;
  }
  container.innerHTML = visible.map(c => {
    // Orphan: name fell back to the raw MemberID (no resolved display name)
    const isOrphan = !c.name || c.name === c.id;
    if (isOrphan) {
      return `<div class="yg-lc-row yg-lc-row-orphan" id="yglc-${c.id}">
        <span class="yg-lc-orphan-label">Unknown contact</span>
        <button type="button" class="btn btn-outline btn-sm yg-lc-remove" onclick="ygRemoveLinked('${c.id}')" title="Unlink">Unlink</button>
      </div>`;
    }
    const roleOpts = YG_ROLES.map(r =>
      `<option value="${r}" ${c.role === r ? 'selected' : ''}>${r || '— Role —'}</option>`
    ).join('');
    return `<div class="yg-lc-row" id="yglc-${c.id}">
      <input type="radio" class="yg-lc-primary-radio" name="yg_primary" value="${c.id}"
             title="Make primary contact" ${c.isPrimary ? 'checked' : ''}
             onchange="ygSetPrimary('${c.id}')">
      <div class="yg-lc-info">
        <span class="yg-lc-name">${escHtml(c.name)}</span>
        ${c.email ? `<span class="yg-lc-email">${escHtml(c.email)}</span>` : ''}
      </div>
      ${c.isPrimary ? `<span class="yg-lc-primary-badge">Primary</span>` : ''}
      <select class="yg-lc-role-sel" onchange="ygChangeRole('${c.id}', this.value)">${roleOpts}</select>
      <button type="button" class="btn btn-outline btn-sm yg-lc-remove" onclick="ygRemoveLinked('${c.id}')" title="Unlink">✕</button>
    </div>`;
  }).join('');
}

function ygSetPrimary(id) {
  _ygLinkedContacts.forEach(c => { c.isPrimary = c.id === id; });
  ygRenderLinkedList();
}

function ygChangeRole(id, role) {
  const c = _ygLinkedContacts.find(x => x.id === id);
  if (c) c.role = role;
}

function ygRemoveLinked(id) {
  const c = _ygLinkedContacts.find(x => x.id === id);
  if (!c) return;
  if (c._status === 'added') {
    _ygLinkedContacts = _ygLinkedContacts.filter(x => x.id !== id);
  } else {
    c._status = 'removed';
  }
  // If we removed the primary, clear the primary flag
  if (c.isPrimary) {
    c.isPrimary = false;
    const first = _ygLinkedContacts.find(x => x._status !== 'removed');
    if (first) first.isPrimary = true;
  }
  _populateYGContactDropdown();
  ygRenderLinkedList();
}

function ygAddLinkedContact() {
  const sel = document.getElementById('yg_contact_id');
  const id  = sel?.value;
  if (!id) return;
  if (_ygLinkedContacts.some(c => c.id === id && c._status !== 'removed')) return;

  const m = (_allMembersCache || []).find(x => x.MemberID === id);
  if (!m) return;

  const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || id;
  const noPrimary = !_ygLinkedContacts.some(c => c._status !== 'removed' && c.isPrimary);

  _ygLinkedContacts.push({
    id, name, email: m.Email || '', role: '', isPrimary: noPrimary,
    _status: 'added', _origRole: ''
  });

  sel.value = '';
  _populateYGContactDropdown();
  ygRenderLinkedList();
}

function ygToggleNewContact() {
  const fields = document.getElementById('yg_new_contact_fields');
  if (!fields) return;
  const showing = fields.style.display !== 'none';
  fields.style.display = showing ? 'none' : 'flex';
}

function closeYGModal() {
  document.getElementById('ygModalOverlay')?.classList.remove('open');
  document.getElementById('ygModal')?.classList.remove('open');
}

async function submitYGForm() {
  const name   = document.getElementById('yg_name').value.trim();
  const church = document.getElementById('yg_church').value.trim();
  if (!name && !church) { alert('Please enter a Youth Group Name or Church Name.'); return; }

  const btn = document.getElementById('ygModalSubmit');
  btn.disabled = true; btn.textContent = 'Saving…';

  const igRaw = document.getElementById('yg_instagram').value.trim().replace(/^@/, '');
  if (igRaw && !/^[\w.]+$/.test(igRaw)) {
    alert('Instagram handle may only contain letters, numbers, periods, and underscores.');
    btn.disabled = false; btn.textContent = _ygModalGroup ? 'Save Changes' : 'Add Group';
    return;
  }

  // ── Determine primary contact from the linked list ────────────────────────
  const primaryEntry  = _ygLinkedContacts.find(c => c.isPrimary && c._status !== 'removed');
  const primaryId     = primaryEntry?.id || '';

  // ── Free-text new contact fields ─────────────────────────────────────────
  const newName   = document.getElementById('yg_pc_name').value.trim();
  const newPhone  = document.getElementById('yg_pc_phone').value.trim();
  const newEmail  = document.getElementById('yg_pc_email').value.trim();
  const newRole   = document.getElementById('yg_pc_role_new')?.value || '';
  const newIsPrimary = document.getElementById('yg_pc_new_is_primary')?.checked || false;

  try {
    const isEdit = !!_ygModalGroup;
    let groupId  = _ygModalGroup?.id || null;

    // ── 1. Create or update the youth group record ────────────────────────
    const body = {
      youth_group_name:      name,
      church_name:           church,
      category:              document.getElementById('yg_category').value,
      address:               document.getElementById('yg_address').value.trim(),
      city:                  document.getElementById('yg_city').value.trim(),
      state:                 document.getElementById('yg_state').value.trim(),
      zip:                   document.getElementById('yg_zip').value.trim(),
      primary_contact_id:    primaryId,
      // Clear legacy free-text fields when a linked contact is primary;
      // keep them only when there are no linked contacts (backwards-compat).
      primary_contact_name:  primaryId ? '' : (newName || ''),
      primary_contact_phone: primaryId ? '' : (newPhone || ''),
      primary_contact_email: primaryId ? '' : (newEmail || ''),
      instagram_handle:      igRaw,
      tags:                  document.getElementById('yg_tags').value.trim(),
      notes:                 document.getElementById('yg_notes').value.trim()
    };
    const acLat = document.getElementById('yg_lat').value;
    const acLng = document.getElementById('yg_lng').value;
    if (acLat && acLng) {
      body.lat           = acLat;
      body.lng           = acLng;
      body.location_type = document.getElementById('yg_location_type').value || 'exact';
    }

    const url = isEdit ? `/api/youth-groups/${encodeURIComponent(groupId)}` : '/api/youth-groups';
    const res = await fetch(url, {
      method:  isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not save youth group.'); return; }
    if (!isEdit) groupId = data.id;

    // ── 2. Apply linked contact changes ───────────────────────────────────
    const memberPatch = (memberId, fields) =>
      fetch(`/api/members/${encodeURIComponent(memberId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });

    for (const c of _ygLinkedContacts) {
      if (c._status === 'removed') {
        await memberPatch(c.id, { youth_group_id: '', youth_group_role: '' });
      } else if (c._status === 'added') {
        await memberPatch(c.id, { youth_group_id: groupId, youth_group_role: c.role });
      } else if (c._status === 'original' && c.role !== c._origRole) {
        await memberPatch(c.id, { youth_group_role: c.role });
      }
    }

    // ── 3. Create a new contact from free-text and link them ──────────────
    if (newName || newEmail) {
      const [firstName, ...rest] = newName.split(' ');
      const createRes = await fetch('/api/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FirstName: firstName || '', LastName: rest.join(' ') || '',
          Email: newEmail, Phone: newPhone
        })
      });
      if (createRes.ok) {
        const newMember = await createRes.json();
        await memberPatch(newMember.MemberID, {
          youth_group_id:   groupId,
          youth_group_role: newRole
        });
        // If this new contact is marked as primary, update the group
        if (newIsPrimary) {
          await fetch(`/api/youth-groups/${encodeURIComponent(groupId)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ primary_contact_id: newMember.MemberID, primary_contact_name: '', primary_contact_phone: '', primary_contact_email: '' })
          });
        }
      }
    }

    const ok = document.getElementById('ygModalSuccess');
    ok.style.display = 'block';
    ok.textContent   = isEdit ? 'Youth group updated.' : 'Youth group added.';
    document.getElementById('ygModalNav').style.display = 'none';
    await Promise.all([loadYouthGroups(), loadMembers()]);
    setTimeout(() => {
      closeYGModal();
      if (isEdit) { closeYGPanel(); openYGPanel(data); }
    }, 1200);
  } catch (err) {
    alert('Network error — could not save youth group.');
  } finally {
    btn.disabled    = false;
    btn.textContent = _ygModalGroup ? 'Save Changes' : 'Add Group';
    if (document.getElementById('ygModalSuccess').style.display === 'none') {
      document.getElementById('ygModalNav').style.display = 'flex';
    }
  }
}

async function confirmDeleteYG() {
  const g = _currentYG;
  if (!g) return;
  const name = _ygDisplayName(g);
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    const res  = await fetch(`/api/youth-groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not delete youth group.'); return; }
    closeYGPanel();
    await loadYouthGroups();
  } catch (err) {
    alert('Network error — could not delete youth group.');
  }
}

// ── Contact Merge Modal ───────────────────────────────────────────────────────

let _mergeSelA = null; // selected member object for A
let _mergeSelB = null; // selected member object for B
let _mergePreview = null; // { a, b, aHasLogin, bHasLogin }

function openMergeModal() {
  _mergeSelA = _mergeSelB = _mergePreview = null;
  ['mergeSearchA','mergeSearchB'].forEach(id => { document.getElementById(id).value = ''; });
  ['mergeSuggestA','mergeSuggestB','mergeSelectedA','mergeSelectedB'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('mergeStep1').style.display = '';
  document.getElementById('mergeStep2').style.display = 'none';
  document.getElementById('mergePreviewBtn').disabled = true;
  document.getElementById('mergeSuccess').style.display = 'none';
  document.getElementById('mergeOverlay').classList.add('open');
  document.getElementById('mergeModal').classList.add('open');
}

function closeMergeModal() {
  document.getElementById('mergeOverlay').classList.remove('open');
  document.getElementById('mergeModal').classList.remove('open');
}

function mergeSuggest(side) {
  const inputId   = `mergeSearch${side}`;
  const suggestId = `mergeSuggest${side}`;
  const query = document.getElementById(inputId).value.trim().toLowerCase();
  const box   = document.getElementById(suggestId);

  if (query.length < 2) { box.style.display = 'none'; return; }
  const results = (_allMembersCache || []).filter(m => {
    const name  = `${m.FirstName || ''} ${m.LastName || ''}`.toLowerCase();
    const email = (m.Email || '').toLowerCase();
    return name.includes(query) || email.includes(query);
  }).slice(0, 8);

  if (!results.length) { box.style.display = 'none'; return; }
  box.innerHTML = results.map(m => {
    const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || '—';
    return `<div class="merge-suggest-row" onclick="mergeSelect('${side}','${m.MemberID}')"
      style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--gold-line);"
      onmouseover="this.style.background='var(--gold-faint)'" onmouseout="this.style.background=''">
      <strong>${name}</strong>${m.Email ? ` <span style="color:var(--text-dim);font-size:11px;">${m.Email}</span>` : ''}
    </div>`;
  }).join('');
  box.style.display = 'block';
}

function mergeSelect(side, memberId) {
  const m = (_allMembersCache || []).find(x => x.MemberID === memberId);
  if (!m) return;
  if (side === 'A') _mergeSelA = m; else _mergeSelB = m;

  const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || '—';
  document.getElementById(`mergeSearch${side}`).value   = '';
  document.getElementById(`mergeSuggest${side}`).style.display = 'none';
  const selEl = document.getElementById(`mergeSelected${side}`);
  selEl.innerHTML = `<strong>${name}</strong>${m.Email ? ` · ${m.Email}` : ''} <button onclick="mergeClear('${side}')" style="float:right;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px;">✕ Clear</button>`;
  selEl.style.display = 'block';

  document.getElementById('mergePreviewBtn').disabled = !(_mergeSelA && _mergeSelB);
}

function mergeClear(side) {
  if (side === 'A') _mergeSelA = null; else _mergeSelB = null;
  document.getElementById(`mergeSelected${side}`).style.display = 'none';
  document.getElementById('mergePreviewBtn').disabled = true;
}

async function loadMergePreview() {
  if (!_mergeSelA || !_mergeSelB) return;
  if (_mergeSelA.MemberID === _mergeSelB.MemberID) {
    alert('Please select two different contacts.');
    return;
  }
  document.getElementById('mergePreviewBtn').disabled = true;
  document.getElementById('mergePreviewBtn').textContent = 'Loading…';
  try {
    const data = await apiFetch(
      `/api/members/merge-preview?a=${encodeURIComponent(_mergeSelA.MemberID)}&b=${encodeURIComponent(_mergeSelB.MemberID)}`
    );
    _mergePreview = data;
    _renderMergeCompare(data);
    document.getElementById('mergeStep1').style.display = 'none';
    document.getElementById('mergeStep2').style.display = '';
    document.getElementById('mergeError').style.display   = 'none';
    document.getElementById('mergeWarning').style.display = 'none';
    document.getElementById('mergeSuccess').style.display = 'none';
    document.getElementById('mergePrimaryA').checked = false;
    document.getElementById('mergePrimaryB').checked = false;
    document.getElementById('mergeExecuteBtn').disabled = true;
    const nameA = [data.a.FirstName, data.a.LastName].filter(Boolean).join(' ') || data.a.Email || 'Contact A';
    const nameB = [data.b.FirstName, data.b.LastName].filter(Boolean).join(' ') || data.b.Email || 'Contact B';
    document.getElementById('mergePrimaryLabelA').textContent = nameA;
    document.getElementById('mergePrimaryLabelB').textContent = nameB;
  } catch (e) {
    alert(e.message || 'Could not load preview.');
  } finally {
    document.getElementById('mergePreviewBtn').disabled = false;
    document.getElementById('mergePreviewBtn').textContent = 'Preview Merge →';
  }
}

function _renderMergeCompare(data) {
  const FIELDS = [
    ['FirstName','First Name'],['LastName','Last Name'],['Email','Email'],
    ['Phone','Phone'],['MembershipType','Membership Type'],['MembershipStatus','Membership Status'],
    ['Tags','Tags'],['Notes','Notes'],['is_volunteer','Volunteer'],['youth_group_id','Youth Group']
  ];
  const colStyle = 'padding:10px 12px;background:var(--surface-raised,#1c1c2e);border-radius:8px;';
  function card(m, hasLogin, label) {
    const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || '—';
    let rows = FIELDS.map(([k, lbl]) => {
      const val = m[k] || '';
      return `<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--gold-line)11;">
        <span style="width:110px;font-size:11px;color:var(--text-dim);flex-shrink:0;">${lbl}</span>
        <span style="font-size:12px;word-break:break-word;">${val || '<em style="color:var(--text-dim);">—</em>'}</span>
      </div>`;
    }).join('');
    const loginNote = hasLogin
      ? `<div style="margin-top:8px;font-size:11px;color:var(--gold);">Has login account</div>`
      : `<div style="margin-top:8px;font-size:11px;color:var(--text-dim);">No login account</div>`;
    return `<div style="${colStyle}"><div style="font-size:13px;font-weight:700;margin-bottom:10px;">${label}: ${name}</div>${rows}${loginNote}</div>`;
  }
  document.getElementById('mergeCompare').innerHTML =
    card(data.a, data.aHasLogin, 'Contact A') + card(data.b, data.bHasLogin, 'Contact B');
}

function updateMergeWarning() {
  const choice = document.querySelector('input[name="mergePrimary"]:checked')?.value;
  document.getElementById('mergeExecuteBtn').disabled = !choice;
  const warn = document.getElementById('mergeWarning');
  if (!choice || !_mergePreview) { warn.style.display = 'none'; return; }
  const secondary = choice === 'a' ? _mergePreview.b : _mergePreview.a;
  const msg = `The "${[secondary.FirstName, secondary.LastName].filter(Boolean).join(' ') || secondary.Email}" record will be permanently deleted after all history is transferred.`;
  warn.textContent = msg;
  warn.style.display = '';
}

function mergeGoBack() {
  document.getElementById('mergeStep1').style.display = '';
  document.getElementById('mergeStep2').style.display = 'none';
  document.getElementById('mergePreviewBtn').disabled = !(_mergeSelA && _mergeSelB);
}

async function executeMerge() {
  const choice = document.querySelector('input[name="mergePrimary"]:checked')?.value;
  if (!choice || !_mergePreview) return;
  const primaryId   = choice === 'a' ? _mergePreview.a.MemberID : _mergePreview.b.MemberID;
  const secondaryId = choice === 'a' ? _mergePreview.b.MemberID : _mergePreview.a.MemberID;

  const btn = document.getElementById('mergeExecuteBtn');
  btn.disabled = true; btn.textContent = 'Merging…';
  document.getElementById('mergeError').style.display = 'none';

  try {
    const data = await apiFetch('/api/members/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId, secondaryId })
    });
    document.getElementById('mergeStep2').style.display = 'none';
    const ok = document.getElementById('mergeSuccess');
    ok.textContent = `Merge complete — ${data.transferred} record${data.transferred === 1 ? '' : 's'} transferred.`;
    ok.style.display = 'block';
    await Promise.all([loadMembers(), loadVolunteersFull(), loadStats()]);
    setTimeout(() => closeMergeModal(), 2000);
  } catch (e) {
    const errEl = document.getElementById('mergeError');
    errEl.textContent = e.message || 'Merge failed. Please try again.';
    errEl.style.display = '';
    btn.disabled = false; btn.textContent = 'Execute Merge';
  }
}

async function markNotDuplicate() {
  if (!_mergePreview) return;
  try {
    await apiFetch('/api/members/not-duplicate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIdA: _mergePreview.a.MemberID, memberIdB: _mergePreview.b.MemberID })
    });
    const ok = document.getElementById('mergeSuccess');
    ok.textContent = 'Marked as "not a duplicate" — this pair will be noted for review.';
    ok.style.display = 'block';
    document.getElementById('mergeStep2').style.display = 'none';
    setTimeout(() => closeMergeModal(), 2000);
  } catch (e) {
    alert(e.message || 'Could not save review.');
  }
}
