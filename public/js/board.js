/* Board Dashboard */

// Populated by loadEvents() so task rows can resolve RelatedEventID -> name.
let eventsById = {};

(async () => {
  await initUser();
  await loadEvents(); // populates eventsById before tasks render
  await Promise.all([
    loadStats(), loadTasks(), loadContacts(), loadFiles(),
    loadMembers(), loadVolunteersFull(), loadAnnouncements(),
    initNotifications(['All', 'Board']), loadPendingVolunteerBadge()
  ]);
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
    eventsById = Object.fromEntries(events.filter(e => e.EventID).map(e => [e.EventID, e]));
    renderEventsPreview(events);
    renderEventsFull(events);
    renderProgress(events);
  } catch (e) {
    document.getElementById('eventsPreview').innerHTML = emptyState('Could not load events right now. Please try again shortly.');
  }
}

function eventRow(ev) {
  const db  = fmtDateBlock(ev.StartDate);
  const href = ev.EventID ? `/events/${encodeURIComponent(ev.EventID)}` : null;
  const row  = href
    ? `class="event-row clickable" role="button" tabindex="0" onclick="location.href='${href}'" onkeydown="if(event.key==='Enter')location.href='${href}'"`
    : `class="event-row"`;
  return `
    <div ${row}>
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
    </div>`;
}

function renderEventsPreview(events) {
  const el = document.getElementById('eventsPreview');
  const upcoming = sortByStartDate(events.filter(isUpcomingEvent)).slice(0, 5);
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
        const row  = href
          ? `class="event-row clickable" role="button" tabindex="0" onclick="location.href='${href}'" onkeydown="if(event.key==='Enter')location.href='${href}'"`
          : `class="event-row"`;
        return `
          <div ${row}>
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
          </div>`;
      }).join('')
    : emptyState('No events yet. Add rows to the Events sheet in Google Sheets.');
}

function renderProgress(events) {
  const el = document.getElementById('progressSection');
  const withCap = events.filter(e => e.EventName && parseInt(e.Capacity) > 0);
  if (!withCap.length) {
    el.innerHTML = emptyState('Add Capacity to events to see registration progress.');
    return;
  }
  el.innerHTML = withCap.slice(0, 6).map(ev => {
    const capacity   = parseInt(ev.Capacity) || 0;
    const registered = parseInt(ev.RegisteredCount) || 0;
    const pct = capacity > 0 ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;
    return `
      <div class="progress-item">
        <div class="progress-name">${ev.EventName}</div>
        <div class="progress-wrap">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="progress-pct">${registered} / ${capacity} registered</div>
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

function renderTasksPreview(tasks) {
  const el = document.getElementById('tasksPreview');
  const open = tasks.filter(t => t.Title && t.Status !== 'Completed').slice(0, 5);
  el.innerHTML = open.length ? open.map(t => interactiveTaskRow(t, eventsById)).join('') : emptyState('No open action items right now.');
}

function renderTasksFull(tasks) {
  const el = document.getElementById('tasksFull');
  el.innerHTML = tasks.length
    ? renderTaskListHtml(tasks, eventsById)
    : emptyState('No tasks yet — add your first action item to the Tasks sheet.');
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

function renderFilesPreview(docs) {
  const el = document.getElementById('filesPreview');
  const recent = docs.filter(d => d.Title).slice(0, 5);
  el.innerHTML = recent.length ? recent.map(documentRow).join('') : emptyState('No documents yet — add your first document to the Documents sheet.');
}

function renderFilesFull(docs) {
  const el = document.getElementById('filesFull');
  el.innerHTML = docs.length ? docs.map(documentRow).join('') : emptyState('No documents yet — add your first document to the Documents sheet.');
}

function renderMinutes(docs) {
  const el = document.getElementById('minutesFull');
  const mins = docs.filter(d => d.Category?.toLowerCase().includes('minute'));
  el.innerHTML = mins.length ? mins.map(documentRow).join('') : emptyState('No meeting minutes yet. Tag documents with Category "Minutes".');
}

function renderReports(docs) {
  const el = document.getElementById('reportsFull');
  const rpts = docs.filter(d => d.Category?.toLowerCase().includes('report'));
  el.innerHTML = rpts.length ? rpts.map(documentRow).join('') : emptyState('No reports yet. Tag documents with Category "Report".');
}

// ── Members ──────────────────────────────────────────────────────────────────
async function loadMembers() {
  try {
    const members = await apiFetch('/api/members');
    renderMembersFull(members);
  } catch (e) {
    document.getElementById('membersFull').innerHTML = emptyState('Could not load members.');
  }
}

function renderMembersFull(members) {
  const el = document.getElementById('membersFull');
  el.innerHTML = members.length
    ? members.map(m => {
        const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || '—';
        return `
          <div class="contact-row clickable" role="button" tabindex="0"
               onclick="location.href='/members/${encodeURIComponent(m.MemberID)}'"
               onkeydown="if(event.key==='Enter')location.href='/members/${encodeURIComponent(m.MemberID)}'">
            ${avatarHtml(name, null)}
            <div class="contact-info">
              <div class="contact-name">${name}</div>
              <div class="contact-email">${m.Email || '—'}</div>
            </div>
            <span class="status-pill ${m.MembershipStatus?.toLowerCase() === 'active' ? 'active' : 'inactive'}">${m.MembershipStatus || '—'}</span>
          </div>`;
      }).join('')
    : emptyState('No members yet — add your first member to the Members sheet to see them here.');
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

function renderVolunteersFull(vols) {
  const el = document.getElementById('volunteersFull');
  el.innerHTML = vols.length
    ? vols.map(v => {
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
            <span class="status-pill ${v.Status?.toLowerCase() === 'active' ? 'active' : 'inactive'}">${v.Status || '—'}</span>
          </div>`;
      }).join('')
    : emptyState('No volunteers yet — add your first volunteer to the Volunteers sheet to see them here.');
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

function openCreateEventModal() {
  _ceStep = 1;
  const fields = [
    'ce_name','ce_type','ce_desc',
    'ce_startDate','ce_endDate','ce_startTime','ce_endTime','ce_location','ce_address',
    'ce_capacity','ce_volunteers','ce_regDeadline','ce_cost','ce_coordName','ce_coordEmail'
  ];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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
