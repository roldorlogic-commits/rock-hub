/* Board Dashboard */

(async () => {
  await initUser();
  await Promise.all([loadStats(), loadEvents(), loadTasks(), loadContacts(), loadFiles()]);
})();

async function loadStats() {
  try {
    const s = await apiFetch('/api/stats');
    document.getElementById('mMembers').textContent   = s.totalMembers     || '0';
    document.getElementById('mEvents').textContent    = s.activeEvents      || '0';
    document.getElementById('mVolunteers').textContent= s.activeVolunteers  || '0';
    document.getElementById('mTasks').textContent     = s.openTasks         || '0';
  } catch (e) { console.error('Stats:', e); }
}

// ── Events ───────────────────────────────────────────────────────────────────
async function loadEvents() {
  try {
    const events = await apiFetch('/api/events');
    renderEventsPreview(events);
    renderEventsFull(events);
    renderProgress(events);
  } catch (e) {
    document.getElementById('eventsPreview').innerHTML = emptyState('Could not load events.');
  }
}

function eventRow(ev) {
  const db = fmtDateBlock(ev.StartDate);
  return `
    <div class="event-row">
      <div class="date-block">
        <span class="month">${db.month}</span>
        <span class="day">${db.day}</span>
      </div>
      <div class="event-info">
        <div class="event-name">${ev.EventName || 'Untitled Event'}</div>
        <div class="event-meta">
          ${ev.EventType ? `<span>${ev.EventType}</span><span class="event-meta-sep">·</span>` : ''}
          ${ev.Location  ? `<span>${ev.Location}</span>` : ''}
          ${ev.Status    ? `<span class="event-meta-sep">·</span>${statusPill(ev.Status)}` : ''}
        </div>
      </div>
    </div>`;
}

function renderEventsPreview(events) {
  const el = document.getElementById('eventsPreview');
  const upcoming = events.filter(e => e.EventName).slice(0, 5);
  el.innerHTML = upcoming.length
    ? upcoming.map(eventRow).join('')
    : emptyState('No upcoming events. Add them to the Events sheet.');
}

function renderEventsFull(events) {
  const el = document.getElementById('eventsFull');
  el.innerHTML = events.length
    ? events.map(ev => `
        <div class="event-row">
          <div class="date-block">
            <span class="month">${fmtDateBlock(ev.StartDate).month}</span>
            <span class="day">${fmtDateBlock(ev.StartDate).day}</span>
          </div>
          <div class="event-info">
            <div class="event-name">${ev.EventName || '—'}</div>
            <div class="event-meta">
              ${ev.EventType ? `<span>${ev.EventType}</span>` : ''}
              ${ev.Location  ? `<span class="event-meta-sep">·</span><span>${ev.Location}</span>` : ''}
              ${ev.Capacity  ? `<span class="event-meta-sep">·</span><span>Cap: ${ev.Capacity}</span>` : ''}
            </div>
          </div>
          <div style="flex-shrink:0;text-align:right;">
            ${statusPill(ev.Status || 'Upcoming')}
            ${ev.CoordinatorName ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${ev.CoordinatorName}</div>` : ''}
          </div>
        </div>`).join('')
    : emptyState('No events yet. Add rows to the Events sheet in Google Sheets.');
}

function renderProgress(events) {
  const el = document.getElementById('progressSection');
  const withCap = events.filter(e => e.EventName && e.Capacity && parseInt(e.Capacity) > 0);
  if (!withCap.length) {
    el.innerHTML = emptyState('Add Capacity to events to see registration progress.');
    return;
  }
  el.innerHTML = withCap.slice(0,6).map((ev, i) => {
    const pct = Math.min(100, Math.round(Math.random() * 80 + 10)); // placeholder — replace with actual registration count
    const opacities = [1, 0.85, 0.7, 0.55, 0.4, 0.25];
    return `
      <div class="progress-item">
        <div class="progress-name">${ev.EventName}</div>
        <div class="progress-wrap">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%;opacity:${opacities[i] ?? 0.5}"></div>
          </div>
        </div>
        <div class="progress-pct">${pct}%</div>
      </div>`;
  }).join('');
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

function taskRow(t) {
  const done = t.Status === 'Completed';
  return `
    <div class="task-row">
      <div class="check-circle${done ? ' done' : ''}"></div>
      <div style="flex:1;min-width:0;">
        <div class="task-title" style="${done ? 'opacity:.5;text-decoration:line-through;' : ''}">${t.Title || '—'}</div>
        <div class="task-meta">
          ${t.AssignedTo ? `${t.AssignedTo}` : ''}
          ${t.DueDate    ? `<span style="margin:0 4px;color:var(--gold-line);">·</span>${fmtDate(t.DueDate)}` : ''}
        </div>
      </div>
      ${priorityPill(t.Priority)}
    </div>`;
}

function renderTasksPreview(tasks) {
  const el = document.getElementById('tasksPreview');
  const open = tasks.filter(t => t.Title && t.Status !== 'Completed').slice(0, 5);
  el.innerHTML = open.length ? open.map(taskRow).join('') : emptyState('No open action items.');
}

function renderTasksFull(tasks) {
  const el = document.getElementById('tasksFull');
  el.innerHTML = tasks.length
    ? tasks.map(taskRow).join('')
    : emptyState('No tasks yet. Add rows to the Tasks sheet.');
}

// ── Contacts ─────────────────────────────────────────────────────────────────
async function loadContacts() {
  try {
    const roles = await apiFetch('/api/userroles');
    renderContactsPreview(roles);
    renderContactsFull(roles);
  } catch (e) {
    document.getElementById('contactsPreview').innerHTML = emptyState('Could not load contacts.');
  }
}

function contactRow(r) {
  const name = [r.FirstName, r.LastName].filter(Boolean).join(' ') || r.Email || '—';
  return `
    <div class="contact-row">
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
  el.innerHTML = board.length ? board.map(contactRow).join('') : emptyState('No contacts yet.');
}

function renderContactsFull(roles) {
  const el = document.getElementById('contactsFull');
  el.innerHTML = roles.length
    ? roles.map(contactRow).join('')
    : emptyState('No contacts yet. Add rows to the UserRoles sheet.');
}

// ── Files ─────────────────────────────────────────────────────────────────────
async function loadFiles() {
  try {
    const docs = await apiFetch('/api/documents');
    renderFilesPreview(docs);
    renderFilesFull(docs);
    renderMinutes(docs);
    renderReports(docs);
  } catch (e) {
    document.getElementById('filesPreview').innerHTML = emptyState('Could not load files.');
  }
}

function fileRow(d) {
  const href = d.FileURL ? `href="${d.FileURL}" target="_blank" rel="noopener"` : '';
  return `
    <div class="list-item">
      <div class="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="item-info">
        <div class="item-title"><a ${href} style="color:var(--text-white);">${d.Title || '—'}</a></div>
        <div class="item-sub">${d.Category || d.FileType || '—'} · ${fmtDate(d.UploadDate)}</div>
      </div>
      ${statusPill(d.Status)}
    </div>`;
}

function renderFilesPreview(docs) {
  const el = document.getElementById('filesPreview');
  const recent = docs.filter(d => d.Title).slice(0, 5);
  el.innerHTML = recent.length ? recent.map(fileRow).join('') : emptyState('No documents yet.');
}

function renderFilesFull(docs) {
  const el = document.getElementById('filesFull');
  el.innerHTML = docs.length ? docs.map(fileRow).join('') : emptyState('No documents yet. Add rows to the Documents sheet.');
}

function renderMinutes(docs) {
  const el = document.getElementById('minutesFull');
  const mins = docs.filter(d => d.Category?.toLowerCase().includes('minute'));
  el.innerHTML = mins.length ? mins.map(fileRow).join('') : emptyState('No meeting minutes yet. Tag documents with Category "Minutes".');
}

function renderReports(docs) {
  const el = document.getElementById('reportsFull');
  const rpts = docs.filter(d => d.Category?.toLowerCase().includes('report'));
  el.innerHTML = rpts.length ? rpts.map(fileRow).join('') : emptyState('No reports yet. Tag documents with Category "Report".');
}
