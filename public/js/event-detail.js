/* Event Detail Page — all 7 tabs */

const STATUS_STEPS = ['Planning', 'Active', 'In Progress', 'Completed'];

let currentEvent    = null;
let currentUser     = null;
const _tabLoaded    = {};
let _attendanceRegs = []; // cache for client-side attendance search

(async () => {
  currentUser = await initUser();
  wireNavLinks(currentUser);
  await loadEvent();
})();

function eventIdFromPath() {
  return decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
}

function wireNavLinks(user) {
  const home = user?.role === 'Board' ? '/board' : '/volunteer';
  const homeEl = document.getElementById('topbarHome');
  if (homeEl) homeEl.href = home;
  document.getElementById('backBtn')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else location.href = home;
  });
}

// ── Event load ────────────────────────────────────────────────────────────────

async function loadEvent() {
  const id = eventIdFromPath();
  try {
    currentEvent = await apiFetch(`/api/events/${encodeURIComponent(id)}`);
    renderEventHero(currentEvent);
    renderOverview(currentEvent);
    _tabLoaded.overview = true;
  } catch (e) {
    document.getElementById('eventHeroLoading').innerHTML =
      `<p style="color:var(--text-muted);font-size:12px;">Could not load event. <a href="javascript:history.back()">Go back</a></p>`;
    document.getElementById('overviewContent').innerHTML = '';
  }
}

// ── Event hero ────────────────────────────────────────────────────────────────

function renderEventHero(ev) {
  document.title = `ROCK Hub — ${ev.EventName || 'Event'}`;
  document.getElementById('pageTitle').textContent = ev.EventName || 'Event';

  const calIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  const pinIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const meta = [];
  if (ev.StartDate) {
    const timePart = ev.StartTime ? ` · ${ev.StartTime}` : '';
    meta.push(`<span>${calIcon}${fmtDate(ev.StartDate)}${timePart}</span>`);
  }
  if (ev.Location) meta.push(`<span>${pinIcon}${_esc(ev.Location)}</span>`);
  if (ev.EventType) meta.push(statusPill(ev.EventType));
  document.getElementById('eventMeta').innerHTML = meta.join('');

  const actionsEl = document.getElementById('eventHeroActions');
  if (currentUser?.role === 'Board') {
    const idx  = STATUS_STEPS.indexOf(ev.Status);
    const next = STATUS_STEPS[idx + 1];
    actionsEl.innerHTML = next
      ? `<button class="btn btn-gold btn-sm" onclick="setStatus('${next}')">→ Mark ${next}</button>`
      : `<span class="status-pill completed" style="font-size:11px;">Completed</span>`;
  } else {
    actionsEl.innerHTML = '';
  }

  const currentIdx = STATUS_STEPS.indexOf(ev.Status);
  const isBoard = currentUser?.role === 'Board';
  document.getElementById('eventStepper').innerHTML = STATUS_STEPS.map((step, i) => {
    const cls  = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
    const line = i < STATUS_STEPS.length - 1 ? `<div class="stepper-line"></div>` : '';
    const clickable = isBoard && step !== ev.Status;
    return `<div class="stepper-step ${cls}${clickable ? ' stepper-clickable' : ''}" title="${clickable ? 'Set to ' + step : ''}"
                 ${clickable ? `onclick="setStatus('${step}')"` : ''}>
      <div class="stepper-dot"></div><span>${step}</span>
    </div>${line}`;
  }).join('');

  const thumbEl = document.getElementById('eventHeroThumb');
  const photoEl = document.getElementById('eventHeroPhoto');
  if (thumbEl) {
    if (ev.PhotoURL) {
      thumbEl.innerHTML = `<img src="${_esc(ev.PhotoURL)}" alt="" class="event-hero-thumb-img">`;
      thumbEl.style.display = '';
    } else {
      thumbEl.style.display = 'none';
    }
  }
  if (photoEl) {
    if (ev.PhotoURL) {
      photoEl.style.backgroundImage = `url('${ev.PhotoURL.replace(/'/g, "\\'")}')`;
      photoEl.style.display = '';
    } else {
      photoEl.style.display = 'none';
    }
  }

  renderCountdown(ev.StartDate);
  document.getElementById('eventHeroLoading').style.display = 'none';
  document.getElementById('eventHeroContent').style.display = 'block';
  requestAnimationFrame(() => syncTabBarTop());
}

function syncTabBarTop() {
  const hero   = document.getElementById('eventHero');
  const tabBar = document.getElementById('eventTabsBar');
  if (hero && tabBar) tabBar.style.top = (hero.offsetHeight + 56) + 'px';
}

function renderCountdown(startDate) {
  const el = document.getElementById('eventCountdown');
  if (!startDate) { el.style.display = 'none'; return; }
  const start = new Date(startDate + 'T00:00:00');
  if (isNaN(start)) { el.style.display = 'none'; return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((start - today) / 86400000);
  const clockIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const checkIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`;
  let cls, content;
  if (diff === 0)    { cls = 'today'; content = `${clockIco}Today!`; }
  else if (diff > 0) { cls = '';      content = `${clockIco}${diff} day${diff === 1 ? '' : 's'} away`; }
  else               { cls = 'past';  content = `${checkIco}${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} ago`; }
  el.className = `event-countdown${cls ? ' ' + cls : ''}`;
  el.innerHTML = content;
  el.style.display = '';
}

// ── Tab switching — lazy-loads each tab on first open ─────────────────────────

function switchTab(tabName, el) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.event-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tabName}`)?.classList.add('active');
  el.classList.add('active');

  if (!_tabLoaded[tabName]) {
    _tabLoaded[tabName] = true;
    const loaders = {
      itinerary:     loadItinerary,
      registrations: loadRegistrations,
      checklist:     loadChecklist,
      budget:        loadBudget,
      documents:     loadDocuments,
      announcements: loadAnnouncements,
      attendance:    loadAttendance,
    };
    loaders[tabName]?.();
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function _esc(v) {
  return (v == null ? '' : String(v))
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _setStatus(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error' ? '#CF6E6E' : type === 'ok' ? '#6ECFA0' : 'var(--text-dim)';
}

function _tabLoad(id, fn) {
  const el = document.getElementById(id);
  if (!el || !currentEvent) return;
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div></div>`;
  fn(el).catch(() => { el.innerHTML = emptyState('Could not load data. Try refreshing.'); });
}

function _openModal(overlayId, modalId) {
  document.getElementById(overlayId)?.classList.add('open');
  document.getElementById(modalId)?.classList.add('open');
}

function _closeModal(overlayId, modalId) {
  document.getElementById(overlayId)?.classList.remove('open');
  document.getElementById(modalId)?.classList.remove('open');
}

function _modalError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function _btnLoading(id, loading, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '…' : label;
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function renderOverview(ev) {
  const el = document.getElementById('overviewContent');
  if (currentUser?.role === 'Board') {
    _renderOverviewEdit(el, ev);
    _initQuill('edit_Description', 'Event description…');
    _quillSet('edit_Description', ev.Description || '');
    _initQuill('edit_RegistrationInfo', 'Extra info shown to registrants…');
    _quillSet('edit_RegistrationInfo', ev.RegistrationInfo || '');
  } else {
    _renderOverviewReadOnly(el, ev);
  }
}

function _roField(label, value, fullSpan) {
  const v = value && value !== '0' ? value : '';
  return `<div class="detail-field${fullSpan ? ' full-span' : ''}">
    <div class="detail-field-label">${label}</div>
    <div class="detail-field-value${v ? '' : ' empty'}">${v || '—'}</div>
  </div>`;
}

function _renderOverviewReadOnly(el, ev) {
  const registered = parseInt(ev.RegisteredCount) || 0;
  const capacity   = parseInt(ev.Capacity) || 0;
  const pct        = capacity > 0 ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;
  el.innerHTML = `
    <div class="overview-grid">
      <div class="card span-full">
        <div class="card-header"><span class="card-title">Event Details</span></div>
        ${ev.PhotoURL ? `<div class="overview-photo"><img src="${_esc(ev.PhotoURL)}" alt="Event photo"></div>` : ''}
        <div class="detail-field-grid">
          ${_roField('Start Date', fmtDate(ev.StartDate))}
          ${_roField('End Date', ev.EndDate && ev.EndDate !== ev.StartDate ? fmtDate(ev.EndDate) : '')}
          ${_roField('Start Time', ev.StartTime)} ${_roField('End Time', ev.EndTime)}
          ${_roField('Location', ev.Location)} ${_roField('Address', ev.Address)}
          ${_roField('Event Type', ev.EventType)}
          ${_roField('Status', statusPill(ev.Status || 'Planning'))}
          ${_roField('Registration Deadline', fmtDate(ev.RegistrationDeadline))}
          ${_roField('Cost', ev.Cost && ev.Cost !== '0' ? '$' + parseFloat(ev.Cost).toFixed(2) : '')}
          ${ev.Description ? _roField('Description', ev.Description, true) : ''}
          ${ev.RegistrationInfo ? _roField('Registration Info', ev.RegistrationInfo, true) : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Coordinator</span></div>
        <div class="detail-field-grid" style="grid-template-columns:1fr;">
          ${_roField('Name', ev.CoordinatorName)}
          <div class="detail-field"><div class="detail-field-label">Email</div>
            <div class="detail-field-value${ev.CoordinatorEmail ? '' : ' empty'}">
              ${ev.CoordinatorEmail ? `<a href="mailto:${_esc(ev.CoordinatorEmail)}">${_esc(ev.CoordinatorEmail)}</a>` : '—'}
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Registration</span></div>
        <div class="detail-field-grid">
          ${_roField('Registered', String(registered))}
          ${_roField('Capacity', capacity > 0 ? String(capacity) : 'Unlimited')}
          ${_roField('Volunteers Needed', ev.VolunteersNeeded && ev.VolunteersNeeded !== '0' ? ev.VolunteersNeeded : '')}
        </div>
        ${capacity > 0 ? `<div style="margin-top:14px;">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-align:right;">${pct}% full</div>
        </div>` : ''}
      </div>
    </div>`;
}

const EVENT_TYPES = ['Community Service', 'Worship', 'Training', 'Social', 'Fundraiser', 'Meeting', 'Other'];

function _renderOverviewEdit(el, ev) {
  const typeOpts = EVENT_TYPES.map(t =>
    `<option value="${t}"${t === ev.EventType ? ' selected' : ''}>${t}</option>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Event Details</span>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="edit-save-status" id="overviewSaveStatus"></span>
          <button class="btn btn-gold btn-sm" onclick="saveOverview()">Save Changes</button>
        </div>
      </div>
      <div class="edit-field-grid">
        <div class="edit-field span-full"><label>Event Name <span class="req">*</span></label>
          <input type="text" id="edit_EventName" value="${_esc(ev.EventName)}"></div>
        <div class="edit-field"><label>Event Type</label>
          <select id="edit_EventType"><option value="">— Select —</option>${typeOpts}</select></div>
        <div class="edit-field"><label>Status</label>
          <div style="padding:8px 0;">${statusPill(ev.Status || 'Planning')}</div></div>
        <div class="edit-field"><label>Start Date</label>
          <input type="date" id="edit_StartDate" value="${_esc(ev.StartDate)}"></div>
        <div class="edit-field"><label>End Date</label>
          <input type="date" id="edit_EndDate" value="${_esc(ev.EndDate)}"></div>
        <div class="edit-field"><label>Start Time</label>
          <input type="time" id="edit_StartTime" value="${_esc(ev.StartTime)}"></div>
        <div class="edit-field"><label>End Time</label>
          <input type="time" id="edit_EndTime" value="${_esc(ev.EndTime)}"></div>
        <div class="edit-field"><label>Location</label>
          <input type="text" id="edit_Location" value="${_esc(ev.Location)}" placeholder="Venue name"></div>
        <div class="edit-field"><label>Address</label>
          <input type="text" id="edit_Address" value="${_esc(ev.Address)}" placeholder="Street address"></div>
        <div class="edit-field"><label>Capacity <span style="font-size:9px;font-weight:500;color:var(--text-muted);">(0 = unlimited)</span></label>
          <input type="number" id="edit_Capacity" value="${_esc(ev.Capacity)}" min="0"></div>
        <div class="edit-field"><label>Volunteers Needed</label>
          <input type="number" id="edit_VolunteersNeeded" value="${_esc(ev.VolunteersNeeded)}" min="0"></div>
        <div class="edit-field"><label>Registration Deadline</label>
          <input type="date" id="edit_RegistrationDeadline" value="${_esc(ev.RegistrationDeadline)}"></div>
        <div class="edit-field"><label>Cost ($)</label>
          <input type="number" id="edit_Cost" value="${_esc(ev.Cost)}" step="0.01" min="0"></div>
        <div class="edit-field"><label>Coordinator Name</label>
          <input type="text" id="edit_CoordinatorName" value="${_esc(ev.CoordinatorName)}"></div>
        <div class="edit-field"><label>Coordinator Email</label>
          <input type="email" id="edit_CoordinatorEmail" value="${_esc(ev.CoordinatorEmail)}"></div>
        <div class="edit-field span-full"><label style="margin-bottom:4px;">Description</label>
          <div id="edit_Description" class="quill-field quill-tall"></div></div>
        <div class="edit-field span-full"><label style="margin-bottom:4px;">Registration Info</label>
          <div id="edit_RegistrationInfo" class="quill-field"></div></div>
        <div class="edit-field span-full">
          <label style="margin-bottom:6px;">Event Photo</label>
          <div id="edit_PhotoPreview" class="photo-preview-box">
            ${ev.PhotoURL ? `<img src="${_esc(ev.PhotoURL)}" alt="Event photo">
              <button type="button" class="btn btn-outline btn-sm" style="margin-top:6px;" onclick="clearEventPhoto()">Remove Photo</button>` : ''}
          </div>
          <label class="btn btn-outline btn-sm photo-upload-btn">
            ${ev.PhotoURL ? 'Change Photo' : 'Upload Photo'}
            <input type="file" id="edit_PhotoFile" accept="image/*" style="display:none;" onchange="handlePhotoUpload(this)">
          </label>
        </div>
      </div>
    </div>`;
}

let _overviewSaving = false;
let _pendingPhotoURL = null; // null = no change, '' = remove, string URL = new photo

function handlePhotoUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(file.type)) {
    alert('Please select a JPEG, PNG, WebP, or GIF image.');
    input.value = '';
    return;
  }
  const MAX_MB = 5;
  if (file.size > MAX_MB * 1024 * 1024) {
    alert(`Image is too large. Maximum size is ${MAX_MB} MB.`);
    input.value = '';
    return;
  }

  const preview = document.getElementById('edit_PhotoPreview');
  if (preview) preview.innerHTML = '<div class="spinner" style="margin:12px auto;"></div>';

  const reader = new FileReader();
  reader.onload = async function(e) {
    const img = new Image();
    img.onload = async function() {
      const MAX_W = 1200;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const base64 = dataUrl.split(',')[1];

      try {
        const res = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType: 'image/jpeg' })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Photo upload failed.'); if (preview) preview.innerHTML = ''; return; }

        _pendingPhotoURL = data.url;
        currentEvent.PhotoURL = data.url;
        renderEventHero(currentEvent);
        if (preview) {
          preview.innerHTML = `<img src="${data.url}" alt="Event photo" style="max-width:100%;border-radius:6px;">
            <button type="button" class="btn btn-outline btn-sm" style="margin-top:6px;" onclick="clearEventPhoto()">Remove Photo</button>`;
        }
        const uploadBtn = input.closest('label');
        if (uploadBtn) uploadBtn.childNodes[0].textContent = 'Change Photo';
      } catch (err) {
        alert('Network error uploading photo. Please try again.');
        if (preview) preview.innerHTML = '';
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearEventPhoto() {
  _pendingPhotoURL = '';
  const preview = document.getElementById('edit_PhotoPreview');
  if (preview) preview.innerHTML = '';
  const fileInput = document.getElementById('edit_PhotoFile');
  if (fileInput) {
    fileInput.value = '';
    const uploadLabel = fileInput.closest('label');
    if (uploadLabel) uploadLabel.childNodes[0].textContent = 'Upload Photo';
  }
}

async function saveOverview() {
  if (_overviewSaving || !currentEvent) return;
  _overviewSaving = true;
  const statusEl = document.getElementById('overviewSaveStatus');
  const g = id => (document.getElementById(id)?.value ?? '').trim();
  const fields = {
    EventName: g('edit_EventName'), EventType: g('edit_EventType'),
    StartDate: g('edit_StartDate'), EndDate: g('edit_EndDate'),
    StartTime: g('edit_StartTime'), EndTime: g('edit_EndTime'),
    Location: g('edit_Location'), Address: g('edit_Address'),
    Capacity: g('edit_Capacity'), VolunteersNeeded: g('edit_VolunteersNeeded'),
    RegistrationDeadline: g('edit_RegistrationDeadline'), Cost: g('edit_Cost'),
    CoordinatorName: g('edit_CoordinatorName'), CoordinatorEmail: g('edit_CoordinatorEmail'),
    Description: _quillVal('edit_Description'),
    RegistrationInfo: _quillVal('edit_RegistrationInfo'),
  };
  // Photo uploads now go directly to Drive via /events/:id/photo and are
  // already persisted on the server, so we only need to handle explicit removal.
  if (_pendingPhotoURL === '') {
    fields.PhotoURL = '';
    _pendingPhotoURL = null;
  } else {
    _pendingPhotoURL = null;
  }
  if (!fields.EventName) {
    _setStatus(statusEl, 'Event name is required.', 'error');
    _overviewSaving = false; return;
  }
  _setStatus(statusEl, 'Saving…', '');
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
    });
    const data = await res.json();
    if (!res.ok) { _setStatus(statusEl, data.error || 'Save failed.', 'error'); return; }
    Object.assign(currentEvent, data);
    renderEventHero(currentEvent);
    _setStatus(statusEl, 'Saved ✓', 'ok');
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  } catch (err) {
    _setStatus(statusEl, 'Network error.', 'error');
  } finally {
    _overviewSaving = false;
  }
}

// ── Registrations tab ─────────────────────────────────────────────────────────

async function loadRegistrations() {
  _tabLoad('registrationsContent', async (el) => {
    const regs = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/registrations`);
    renderRegistrationsTab(regs, el);
  });
}

let _regCategoryFilter = 'All';

function renderRegistrationsTab(regs, el) {
  el = el || document.getElementById('registrationsContent');
  const isBoard = currentUser?.role === 'Board';
  const cap     = parseInt(currentEvent?.Capacity, 10) || 0;
  const total      = regs.length;
  const confirmed  = regs.filter(r => r.Status === 'Confirmed').length;
  const pending    = regs.filter(r => r.Status === 'Pending').length;
  const waitlisted = regs.filter(r => r.Status === 'Waitlisted').length;
  const checkedIn  = regs.filter(r => r.CheckedIn === 'TRUE' || r.CheckedIn === 'true').length;
  const capPct     = cap > 0 ? Math.min(100, Math.round(((confirmed + pending) / cap) * 100)) : 0;
  const volunteers = regs.filter(r => r.Category === 'Volunteer' || (r.Category === '' && r.Role)).length;
  const attendees  = total - volunteers;

  const stats = `<div class="reg-stats-bar">
    <div class="reg-stat"><span class="reg-stat-num">${total}</span><span class="reg-stat-label">Total</span></div>
    <div class="reg-stat-divider"></div>
    <div class="reg-stat"><span class="reg-stat-num" style="color:#6ECFA0;">${confirmed}</span><span class="reg-stat-label">Confirmed</span></div>
    <div class="reg-stat"><span class="reg-stat-num" style="color:var(--gold);">${pending}</span><span class="reg-stat-label">Pending</span></div>
    <div class="reg-stat"><span class="reg-stat-num" style="color:#CF6E6E;">${waitlisted}</span><span class="reg-stat-label">Waitlisted</span></div>
    <div class="reg-stat-divider"></div>
    <div class="reg-stat"><span class="reg-stat-num">${checkedIn}</span><span class="reg-stat-label">Checked In</span></div>
    ${cap > 0 ? `<div class="reg-stat reg-capacity">
      <div class="progress-track" style="width:110px;margin:0 0 4px;">
        <div class="progress-fill" style="width:${capPct}%"></div>
      </div>
      <span class="reg-stat-label">${confirmed + pending} / ${cap} capacity</span>
    </div>` : ''}
  </div>`;

  const catFilter = `<div class="reg-cat-filter">
    ${[['All', total], ['Attendees', attendees], ['Volunteers', volunteers]].map(([lbl, cnt]) =>
      `<button class="btn btn-sm ${_regCategoryFilter === lbl ? 'btn-gold' : 'btn-outline'}"
               onclick="setRegCatFilter('${lbl}')">${lbl} (${cnt})</button>`
    ).join('')}
  </div>`;

  const boardActions = isBoard ? `<div class="reg-actions">
    ${pending > 0 ? `<button class="btn btn-outline btn-sm" onclick="confirmAllPending()">✓ Confirm All Pending (${pending})</button>` : ''}
    <button class="btn btn-gold btn-sm" onclick="openAddRegModal()">+ Add Registrant</button>
  </div>` : '';

  let filtered = [...regs];
  if (_regCategoryFilter === 'Volunteers') {
    filtered = regs.filter(r => r.Category === 'Volunteer' || (r.Category === '' && r.Role));
  } else if (_regCategoryFilter === 'Attendees') {
    filtered = regs.filter(r => r.Category === 'Attendee' || (r.Category === '' && !r.Role));
  }
  const sorted = filtered.sort((a, b) => {
    const ord = { Confirmed: 0, Pending: 1, Waitlisted: 2, Cancelled: 3 };
    return (ord[a.Status] ?? 9) - (ord[b.Status] ?? 9);
  });

  el.innerHTML = stats + catFilter + boardActions + `<div class="reg-list">${
    sorted.length ? sorted.map(r => _regRow(r, isBoard)).join('') : emptyState('No registrations match this filter.')
  }</div>`;
}

function setRegCatFilter(filter) {
  _regCategoryFilter = filter;
  loadRegistrations();
}

function _regRow(r, isBoard) {
  const name = [r.FirstName, r.LastName].filter(Boolean).join(' ') || r.Email || '—';
  const ci   = r.CheckedIn === 'TRUE' || r.CheckedIn === 'true';
  const isVol = r.Category === 'Volunteer' || (r.Category === '' && r.Role);
  const catBadge = isVol
    ? `<span class="status-pill active" style="font-size:10px;padding:1px 6px;margin-left:4px;">Volunteer</span>`
    : `<span class="status-pill" style="font-size:10px;padding:1px 6px;margin-left:4px;opacity:0.6;">Attendee</span>`;
  const statusCell = isBoard
    ? `<select class="reg-status-sel status-${(r.Status || '').toLowerCase()}"
               onchange="updateRegStatus('${r.RegistrationID}', this.value, this)">
         <option value="Pending"    ${r.Status === 'Pending'    ? 'selected' : ''}>Pending</option>
         <option value="Confirmed"  ${r.Status === 'Confirmed'  ? 'selected' : ''}>Confirmed</option>
         <option value="Waitlisted" ${r.Status === 'Waitlisted' ? 'selected' : ''}>Waitlisted</option>
         <option value="Cancelled"  ${r.Status === 'Cancelled'  ? 'selected' : ''}>Cancelled</option>
       </select>`
    : statusPill(r.Status);
  const checkinCell = isBoard
    ? `<button class="btn btn-sm ${ci ? 'btn-checkin-done' : 'btn-outline'}"
               onclick="toggleCheckin('${r.RegistrationID}', ${ci}, this)">
         ${ci ? '✓ In' : 'Check In'}
       </button>`
    : (ci ? `<span class="status-pill active" style="font-size:10px;">✓ In</span>` : '');
  return `<div class="reg-row" data-reg-id="${r.RegistrationID}">
    <div class="reg-person">
      <div class="avatar-initials" style="width:30px;height:30px;font-size:10px;flex-shrink:0;">${initials(name)}</div>
      <div style="min-width:0;">
        <div class="reg-person-name" style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;">${_esc(name)}${catBadge}</div>
        <div class="reg-person-sub">${_esc(r.Email || '')}${r.Role ? ` · ${_esc(r.Role)}` : ''}</div>
      </div>
    </div>
    <div class="reg-meta">
      ${r.SignUpDate ? `<span class="reg-date">${fmtDate(r.SignUpDate)}</span>` : ''}
      ${r.Notes ? `<span class="reg-notes" title="${_esc(r.Notes)}">📝</span>` : ''}
    </div>
    <div class="reg-controls">${statusCell}${checkinCell}</div>
  </div>`;
}

async function updateRegStatus(regId, status, selectEl) {
  try {
    const res = await fetch(
      `/api/events/${encodeURIComponent(currentEvent.EventID)}/registrations/${encodeURIComponent(regId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Status: status }) }
    );
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not update.'); return; }
    if (selectEl) selectEl.className = `reg-status-sel status-${status.toLowerCase()}`;
    await loadRegistrations();
  } catch (err) { alert('Network error — please try again.'); }
}

async function _doCheckin(regId, currentlyIn, btn, refreshFn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(
      `/api/events/${encodeURIComponent(currentEvent.EventID)}/registrations/${encodeURIComponent(regId)}/checkin`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkedIn: !currentlyIn }) }
    );
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not update.'); return; }
    await refreshFn();
  } catch (err) {
    alert('Network error — please try again.');
    if (btn) { btn.disabled = false; btn.textContent = currentlyIn ? '✓ In' : 'Check In'; }
  }
}

function toggleCheckin(regId, currentlyIn, btn) {
  return _doCheckin(regId, currentlyIn, btn, loadRegistrations);
}

async function confirmAllPending() {
  if (!confirm('Confirm all pending registrations?')) return;
  try {
    const res = await fetch(
      `/api/events/${encodeURIComponent(currentEvent.EventID)}/registrations/confirm-all-pending`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    if (!res.ok) { alert('Could not confirm registrations.'); return; }
    await loadRegistrations();
  } catch (err) { alert('Network error — please try again.'); }
}

function openAddRegModal()  { document.getElementById('addRegForm')?.reset(); _modalError('addRegError',''); _openModal('addRegOverlay','addRegModal'); }
function closeAddRegModal() { _closeModal('addRegOverlay','addRegModal'); }

async function submitAddReg() {
  const g = id => (document.getElementById(id)?.value ?? '').trim();
  const first = g('addReg_FirstName'), email_ = g('addReg_Email');
  if (!first || !email_) { _modalError('addRegError','First name and email are required.'); return; }
  _modalError('addRegError','');
  _btnLoading('addRegSubmitBtn', true, 'Add Registrant');
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/registrations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ FirstName: first, LastName: g('addReg_LastName'), Email: email_,
        Phone: g('addReg_Phone'), Role: g('addReg_Role'), Notes: g('addReg_Notes'),
        Category: g('addReg_Category') || 'Attendee' })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('addRegError', data.error || 'Failed.'); return; }
    closeAddRegModal();
    await loadRegistrations();
  } catch (err) {
    _modalError('addRegError','Network error — please try again.');
  } finally {
    _btnLoading('addRegSubmitBtn', false, 'Add Registrant');
  }
}

// ── Checklist tab ─────────────────────────────────────────────────────────────

let _chkItemCache = {};

async function loadChecklist() {
  _tabLoad('checklistContent', async (el) => {
    const items = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/checklist`);
    renderChecklistTab(items, el);
  });
}

function renderChecklistTab(items, el) {
  el = el || document.getElementById('checklistContent');
  const isBoard = currentUser?.role === 'Board';
  const total   = items.length;
  const done    = items.filter(i => i.Status === 'Completed').length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;

  const progressHtml = total > 0
    ? `<div class="chk-progress">
        <span>${done}/${total}</span>
        <div class="progress-track" style="flex:1;max-width:120px;">
          <div class="progress-fill" style="width:${pct}%;${pct===100?'background:#6ECFA0;':''}"></div>
        </div>
        <span style="color:${pct===100?'#6ECFA0':'var(--gold)'};">${pct}%</span>
      </div>` : '';

  const header = `<div class="tab-inner-header">
    <div style="display:flex;align-items:center;gap:12px;flex:1;">${progressHtml}</div>
    ${isBoard ? `<button class="btn btn-gold btn-sm" onclick="openAddChecklistModal()">+ Add Item</button>` : ''}
  </div>`;

  if (!items.length) { el.innerHTML = header + emptyState('No checklist items yet.'); return; }

  _chkItemCache = {};
  for (const item of items) _chkItemCache[item.ChecklistID] = item;

  const CAT_ORDER = ['Logistics','Marketing','Volunteers','Day-Of','Follow-Up'];
  const groups = {};
  for (const item of items) {
    const cat = item.Category || 'Other';
    (groups[cat] = groups[cat] || []).push(item);
  }
  const cats = [...CAT_ORDER.filter(c => groups[c]), ...Object.keys(groups).filter(c => !CAT_ORDER.includes(c))];

  const groupsHtml = cats.map(cat => `
    <div class="chk-group">
      <div class="chk-group-header">${_esc(cat)}</div>
      ${groups[cat].map(item => _checklistRow(item, isBoard)).join('')}
    </div>`).join('');

  el.innerHTML = header + groupsHtml;
}

const CHK_ICONS = {
  Pending: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="8" cy="8" r="6" stroke-width="1.5"/></svg>`,
  'In Progress': `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="8" cy="8" r="6" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/></svg>`,
  Completed: `<svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><circle cx="8" cy="8" r="7"/><path stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M5 8l2 2 4-4"/></svg>`,
};
const CHK_NEXT = { Pending: 'In Progress', 'In Progress': 'Completed', Completed: 'Pending' };

function _checklistRow(item, isBoard) {
  const status   = item.Status || 'Pending';
  const next     = CHK_NEXT[status] || 'Pending';
  const cls      = status === 'Completed' ? 'done' : status === 'In Progress' ? 'inprogress' : '';
  const trashIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const editIco  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  return `<div class="chk-row${status === 'Completed' ? ' chk-done' : ''}${isBoard ? ' chk-clickable' : ''}"
              ${isBoard ? `onclick="openEditChkModal('${_esc(item.ChecklistID)}')"` : ''}>
    <button class="chk-toggle ${cls}" title="Mark ${next}"
            onclick="event.stopPropagation(); cycleChecklistStatus('${item.ChecklistID}','${next}')">
      ${CHK_ICONS[status] || CHK_ICONS.Pending}
    </button>
    <div class="chk-body">
      <div class="chk-item-title">${_esc(item.Item)}</div>
      <div class="chk-item-meta">
        ${item.AssignedTo ? `<span>→ ${_esc(item.AssignedTo)}</span>` : ''}
        ${item.DueDate    ? `<span>Due ${fmtDate(item.DueDate)}</span>` : ''}
        ${item.Notes      ? `<span title="Has notes">📝</span>` : ''}
      </div>
    </div>
    ${priorityPill(item.Priority)}
    ${isBoard ? `<button class="chk-delete icon-btn" title="Delete item"
                         onclick="event.stopPropagation(); deleteChecklistItem('${item.ChecklistID}')">${trashIco}</button>` : ''}
  </div>`;
}

async function cycleChecklistStatus(id, nextStatus) {
  try {
    const res = await fetch(`/api/checklist/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Status: nextStatus })
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not update.'); return; }
    await loadChecklist();
  } catch (e) { alert('Network error.'); }
}

async function deleteChecklistItem(id) {
  if (!confirm('Delete this checklist item?')) return;
  try {
    const res = await fetch(`/api/checklist/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not delete.'); return; }
    await loadChecklist();
  } catch (e) { alert('Network error.'); }
}

function openAddChecklistModal()  {
  document.getElementById('addChkForm')?.reset();
  _modalError('addChkError','');
  _openModal('addChkOverlay','addChkModal');
  _initQuill('addChk_Notes', 'Optional notes…');
}
function closeAddChecklistModal() { _closeModal('addChkOverlay','addChkModal'); }

function openEditChkModal(checklistId) {
  const item = _chkItemCache[checklistId];
  if (!item) return;
  document.getElementById('editChk_ID').value         = checklistId;
  document.getElementById('editChk_Item').value        = item.Item || '';
  document.getElementById('editChk_Category').value    = item.Category || 'Logistics';
  document.getElementById('editChk_Priority').value    = item.Priority || 'Medium';
  document.getElementById('editChk_AssignedTo').value  = item.AssignedTo || '';
  document.getElementById('editChk_DueDate').value     = item.DueDate || '';
  _modalError('editChkError', '');
  _openModal('editChkOverlay', 'editChkModal');
  _initQuill('editChk_Notes', 'Optional notes…');
  _quillSet('editChk_Notes', item.Notes || '');
}

function closeEditChkModal() { _closeModal('editChkOverlay', 'editChkModal'); }

async function submitEditChecklist() {
  const id   = document.getElementById('editChk_ID')?.value;
  const item = (document.getElementById('editChk_Item')?.value ?? '').trim();
  if (!item) { _modalError('editChkError', 'Item description is required.'); return; }
  _modalError('editChkError', '');
  _btnLoading('editChkSubmitBtn', true, 'Save Changes');
  try {
    const res = await fetch(`/api/checklist/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Item:       item,
        Category:   document.getElementById('editChk_Category')?.value  || 'Logistics',
        Priority:   document.getElementById('editChk_Priority')?.value   || 'Medium',
        AssignedTo: (document.getElementById('editChk_AssignedTo')?.value ?? '').trim(),
        DueDate:    document.getElementById('editChk_DueDate')?.value    || '',
        Notes:      _quillVal('editChk_Notes')
      })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('editChkError', data.error || 'Failed.'); return; }
    closeEditChkModal();
    await loadChecklist();
  } catch (err) {
    _modalError('editChkError', 'Network error — please try again.');
  } finally {
    _btnLoading('editChkSubmitBtn', false, 'Save Changes');
  }
}

async function submitAddChecklist() {
  const g    = id => (document.getElementById(id)?.value ?? '').trim();
  const item = g('addChk_Item');
  if (!item) { _modalError('addChkError','Item description is required.'); return; }
  _modalError('addChkError','');
  _btnLoading('addChkSubmitBtn', true, 'Add Item');
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/checklist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Item: item, Category: g('addChk_Category'),
        AssignedTo: g('addChk_AssignedTo'), DueDate: g('addChk_DueDate'),
        Priority: g('addChk_Priority'), Notes: _quillVal('addChk_Notes') })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('addChkError', data.error || 'Failed.'); return; }
    closeAddChecklistModal();
    await loadChecklist();
  } catch (err) {
    _modalError('addChkError','Network error — please try again.');
  } finally {
    _btnLoading('addChkSubmitBtn', false, 'Add Item');
  }
}

// ── Budget tab ────────────────────────────────────────────────────────────────

async function loadBudget() {
  _tabLoad('budgetContent', async (el) => {
    const items = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/budget`);
    renderBudgetTab(items, el);
  });
}

function renderBudgetTab(items, el) {
  el = el || document.getElementById('budgetContent');
  const isBoard = currentUser?.role === 'Board';

  const income   = items.filter(i => i.Category === 'Income');
  const expenses = items.filter(i => i.Category !== 'Income');

  function sumField(arr, field) {
    return arr.reduce((s, i) => s + (parseFloat(i[field]) || 0), 0);
  }
  const incEst  = sumField(income, 'EstimatedCost');
  const incAct  = sumField(income, 'ActualCost');
  const expEst  = sumField(expenses, 'EstimatedCost');
  const expAct  = sumField(expenses, 'ActualCost');
  const netEst  = incEst - expEst;
  const netAct  = incAct - expAct;
  function fmt(n) { return n === 0 ? '—' : (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(2); }
  function fmtAbs(n) { return n === 0 ? '—' : '$' + Math.abs(n).toFixed(2); }

  const summary = items.length ? `<div class="budget-summary">
    <div class="budget-stat">
      <span class="budget-stat-label">Est. Income</span>
      <span class="budget-stat-value" style="color:#6ECFA0;">${fmtAbs(incEst)}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Est. Expenses</span>
      <span class="budget-stat-value" style="color:#CF6E6E;">${fmtAbs(expEst)}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Net (Est.)</span>
      <span class="budget-stat-value ${netEst >= 0 ? 'under' : 'over'}">${fmt(netEst)}</span>
    </div>
    ${incAct || expAct ? `
    <div class="budget-divider"></div>
    <div class="budget-stat">
      <span class="budget-stat-label">Actual Income</span>
      <span class="budget-stat-value" style="color:#6ECFA0;">${fmtAbs(incAct)}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Actual Expenses</span>
      <span class="budget-stat-value" style="color:#CF6E6E;">${fmtAbs(expAct)}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Net (Actual)</span>
      <span class="budget-stat-value ${netAct >= 0 ? 'under' : 'over'}">${fmt(netAct)}</span>
    </div>` : ''}
  </div>` : '';

  const header = `<div class="tab-inner-header">
    <div></div>
    ${isBoard ? `<button class="btn btn-gold btn-sm" onclick="openAddBudgetModal()">+ Add Item</button>` : ''}
  </div>`;

  if (!items.length) { el.innerHTML = header + emptyState('No budget items yet.'); return; }

  function section(title, rows, cls) {
    if (!rows.length) return '';
    return `<div class="budget-group-header ${cls}">${title}</div>
      ${rows.map(i => _budgetRow(i, isBoard)).join('')}`;
  }

  el.innerHTML = summary + header + `<div class="budget-list">
    ${section('Income', income, 'income')}
    ${section('Expenses', expenses, 'expense')}
  </div>`;
}

function _budgetRow(item, isBoard) {
  const est  = parseFloat(item.EstimatedCost) || 0;
  const act  = parseFloat(item.ActualCost) || 0;
  const over = act > 0 && est > 0 && act > est;
  const trashIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  return `<div class="budget-row">
    <div class="budget-item-name" title="${_esc(item.Notes || '')}">${_esc(item.Item)}</div>
    <div class="budget-amount budget-est" title="Estimated">${est ? '$' + est.toFixed(2) : '—'}</div>
    <div class="budget-amount budget-act ${over ? 'over' : ''}" title="Actual">${act ? '$' + act.toFixed(2) : '—'}</div>
    ${statusPill(item.Status || 'Planned')}
    <div style="flex-shrink:0;font-size:11px;color:var(--text-muted);">${_esc(item.PaidBy || '')}</div>
    ${item.ReceiptURL ? `<a class="budget-receipt-link" href="${_esc(item.ReceiptURL)}" target="_blank" rel="noopener" title="View receipt">🔗</a>` : '<span style="width:18px;"></span>'}
    ${isBoard ? `<button class="budget-delete icon-btn" title="Delete" onclick="deleteBudgetItem('${item.BudgetID}')">${trashIco}</button>` : ''}
  </div>`;
}

async function deleteBudgetItem(id) {
  if (!confirm('Delete this budget item?')) return;
  try {
    const res = await fetch(`/api/budget/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not delete.'); return; }
    await loadBudget();
  } catch (e) { alert('Network error.'); }
}

function openAddBudgetModal()  { document.getElementById('addBudgetForm')?.reset(); _modalError('addBudgetError',''); _openModal('addBudgetOverlay','addBudgetModal'); }
function closeAddBudgetModal() { _closeModal('addBudgetOverlay','addBudgetModal'); }

async function submitAddBudget() {
  const g    = id => (document.getElementById(id)?.value ?? '').trim();
  const item = g('addBudget_Item');
  if (!item) { _modalError('addBudgetError','Item name is required.'); return; }
  _modalError('addBudgetError','');
  _btnLoading('addBudgetSubmitBtn', true, 'Add Item');
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/budget`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Item: item, Category: g('addBudget_Category'),
        EstimatedCost: g('addBudget_Estimated'), ActualCost: g('addBudget_Actual'),
        Status: g('addBudget_Status'), PaidBy: g('addBudget_PaidBy'),
        ReceiptURL: g('addBudget_ReceiptURL'), Notes: g('addBudget_Notes') })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('addBudgetError', data.error || 'Failed.'); return; }
    closeAddBudgetModal();
    await loadBudget();
  } catch (err) {
    _modalError('addBudgetError','Network error — please try again.');
  } finally {
    _btnLoading('addBudgetSubmitBtn', false, 'Add Item');
  }
}

// ── Documents tab ─────────────────────────────────────────────────────────────

async function loadDocuments() {
  _tabLoad('documentsContent', async (el) => {
    const docs = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/documents`);
    renderDocumentsTab(docs, el);
  });
}

function renderDocumentsTab(docs, el) {
  el = el || document.getElementById('documentsContent');
  const isBoard = currentUser?.role === 'Board';
  const header  = `<div class="tab-inner-header">
    <div></div>
    ${isBoard ? `<button class="btn btn-gold btn-sm" onclick="openAddDocModal()">+ Attach Document</button>` : ''}
  </div>`;
  el.innerHTML = header + (docs.length
    ? `<div class="list-items">${docs.map(d => documentRow(d)).join('')}</div>`
    : emptyState('No documents linked to this event yet.'));
}

let _addDocTab = 'url';

function switchAddDocTab(tab) {
  _addDocTab = tab;
  document.getElementById('addDocPane_url').style.display  = tab === 'url'  ? '' : 'none';
  document.getElementById('addDocPane_file').style.display = tab === 'file' ? '' : 'none';
  const activeStyle = 'background:var(--gold-faint);color:var(--gold);';
  document.getElementById('addDocTab_url').setAttribute('style',  `flex:1;border-radius:0;border:none;font-size:12px;${tab==='url'?activeStyle:''}`);
  document.getElementById('addDocTab_file').setAttribute('style', `flex:1;border-radius:0;border:none;border-left:1px solid var(--gold-line);font-size:12px;${tab==='file'?activeStyle:''}`);
}

function onAddDocFileChange(input) {
  if (input.files[0] && !document.getElementById('addDoc_Title').value.trim()) {
    document.getElementById('addDoc_Title').value = input.files[0].name.replace(/\.[^.]+$/, '');
  }
}

function openAddDocModal() {
  document.getElementById('addDocForm')?.reset();
  _modalError('addDocError','');
  document.getElementById('addDoc_UploadProgress').style.display = 'none';
  switchAddDocTab('url');
  _openModal('addDocOverlay','addDocModal');
}
function closeAddDocModal() { _closeModal('addDocOverlay','addDocModal'); }

async function submitAddDoc() {
  const g     = id => (document.getElementById(id)?.value ?? '').trim();
  const title = g('addDoc_Title');
  if (!title) { _modalError('addDocError','Title is required.'); return; }
  _modalError('addDocError','');

  if (_addDocTab === 'url') {
    const url = g('addDoc_URL');
    if (!url) { _modalError('addDocError','Drive URL is required.'); return; }
    _btnLoading('addDocSubmitBtn', true, 'Attach');
    try {
      const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Title: title, FileURL: url, AccessLevel: g('addDoc_Access') })
      });
      const data = await res.json();
      if (!res.ok) { _modalError('addDocError', data.error || 'Failed.'); return; }
      closeAddDocModal();
      await loadDocuments();
    } catch (err) {
      _modalError('addDocError','Network error — please try again.');
    } finally {
      _btnLoading('addDocSubmitBtn', false, 'Attach');
    }
    return;
  }

  // File upload mode
  const fileInput = document.getElementById('addDoc_File');
  const file = fileInput.files[0];
  if (!file) { _modalError('addDocError','Please select a file.'); return; }
  const MAX_BYTES = 7 * 1024 * 1024;
  if (file.size > MAX_BYTES) { _modalError('addDocError','File is too large. Maximum size is 7 MB.'); return; }

  _btnLoading('addDocSubmitBtn', true, 'Uploading…');
  document.getElementById('addDoc_UploadProgress').style.display = 'block';
  document.getElementById('addDoc_UploadStatus').textContent = 'Reading file…';
  document.getElementById('addDoc_UploadBar').style.width = '20%';

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    document.getElementById('addDoc_UploadStatus').textContent = 'Uploading to Drive…';
    document.getElementById('addDoc_UploadBar').style.width = '60%';

    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/documents/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: title, base64, mimeType: file.type || 'application/octet-stream', accessLevel: g('addDoc_Access') })
    });
    const data = await res.json();
    document.getElementById('addDoc_UploadBar').style.width = '100%';
    if (!res.ok) { _modalError('addDocError', data.error || 'Upload failed.'); return; }
    closeAddDocModal();
    await loadDocuments();
  } catch (err) {
    _modalError('addDocError','Upload failed — please try again.');
  } finally {
    _btnLoading('addDocSubmitBtn', false, 'Attach');
    document.getElementById('addDoc_UploadProgress').style.display = 'none';
  }
}

// ── Announcements tab ─────────────────────────────────────────────────────────

async function loadAnnouncements() {
  _tabLoad('announcementsContent', async (el) => {
    const items = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/announcements`);
    renderAnnouncementsTab(items, el);
  });
}

function renderAnnouncementsTab(items, el) {
  el = el || document.getElementById('announcementsContent');
  const isBoard = currentUser?.role === 'Board';

  const composeHtml = isBoard ? `
    <div class="compose-box">
      <div class="compose-box-title">New Announcement</div>
      <input type="text" id="ann_Subject" placeholder="Subject *">
      <div id="ann_Body" class="quill-field" style="margin-bottom:2px;"></div>
      <div class="compose-row">
        <select id="ann_Recipients" style="flex:1;" onchange="onAnnRecipientsChange(this)">
          <option value="All Registrants">All Registrants</option>
          <option value="Confirmed Only">Confirmed Only</option>
          <option value="Volunteers Only">Volunteers Only</option>
          <option value="Role:">By Volunteer Role…</option>
        </select>
        <select id="ann_Channel">
          <option value="Email">via Email</option>
          <option value="In-App">In-App only</option>
        </select>
        <button class="btn btn-gold btn-sm" onclick="submitAnnouncement()">Send</button>
      </div>
      <div id="ann_RoleRow" style="display:none;margin-top:6px;">
        <input type="text" id="ann_Role" placeholder="Volunteer role (e.g. Setup Crew)" style="width:100%;">
      </div>
      <label class="checkbox-label" style="margin-top:6px;font-size:13px;">
        <input type="checkbox" id="ann_SendSMS"> Also send via SMS (to opted-in registrants)
      </label>
      <p class="form-error" id="annError" style="display:none;"></p>
    </div>` : '';

  const listHtml = items.length
    ? items.map(a => _annRow(a)).join('')
    : emptyState('No announcements sent for this event yet.');

  el.innerHTML = composeHtml + `<div class="ann-list">${listHtml}</div>`;
  if (isBoard) _initQuill('ann_Body', 'Message…');
}

function _annRow(a) {
  const byLine = [a.SentBy, a.SentAt ? fmtDate(a.SentAt) : '', a.Recipients].filter(Boolean).join(' · ');
  return `<div class="ann-item">
    <div class="ann-item-subject">${_esc(a.Subject || '(no subject)')}</div>
    <div class="ann-item-meta">${_esc(byLine)}</div>
    <div class="ann-item-body">${a.Body || ''}</div>
  </div>`;
}

function onAnnRecipientsChange(sel) {
  const roleRow = document.getElementById('ann_RoleRow');
  if (roleRow) roleRow.style.display = sel.value === 'Role:' ? 'block' : 'none';
}

async function submitAnnouncement() {
  const g       = id => (document.getElementById(id)?.value ?? '').trim();
  const subject = g('ann_Subject');
  const body    = _quillVal('ann_Body');
  const errEl   = document.getElementById('annError');
  if (!subject || !body) {
    errEl.textContent = 'Subject and message body are required.';
    errEl.style.display = 'block'; return;
  }
  errEl.style.display = 'none';
  const btn = document.querySelector('.compose-box .btn-gold');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  let recipients = g('ann_Recipients');
  if (recipients === 'Role:') {
    const role = g('ann_Role');
    if (!role) { errEl.textContent = 'Enter a volunteer role to filter by.'; errEl.style.display = 'block'; if (btn) { btn.disabled = false; btn.textContent = 'Send'; } return; }
    recipients = `Role:${role}`;
  }
  const sendSMS = document.getElementById('ann_SendSMS')?.checked ?? false;

  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/announcements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Subject: subject, Body: body,
        Recipients: recipients, Channel: g('ann_Channel'), SendSMS: sendSMS })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Could not send.'; errEl.style.display = 'block'; return; }
    document.getElementById('ann_Subject').value = '';
    errEl.style.display = 'none';
    _tabLoaded.announcements = false;
    await loadAnnouncements();
  } catch (err) {
    errEl.textContent = 'Network error — please try again.'; errEl.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
}

// ── Attendance tab ────────────────────────────────────────────────────────────

async function loadAttendance() {
  _tabLoad('attendanceContent', async (el) => {
    const regs = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/registrations`);
    renderAttendanceTab(regs, el);
  });
}

function renderAttendanceTab(regs, el) {
  el = el || document.getElementById('attendanceContent');
  const isBoard   = currentUser?.role === 'Board';
  const total     = regs.length;
  const checkedIn = regs.filter(r => r.CheckedIn === 'TRUE' || r.CheckedIn === 'true').length;
  const remaining = total - checkedIn;

  const summary = `<div class="reg-stats-bar" style="margin-bottom:12px;">
    <div class="reg-stat"><span class="reg-stat-num">${total}</span><span class="reg-stat-label">Registered</span></div>
    <div class="reg-stat-divider"></div>
    <div class="reg-stat"><span class="reg-stat-num" style="color:#6ECFA0;">${checkedIn}</span><span class="reg-stat-label">Checked In</span></div>
    <div class="reg-stat"><span class="reg-stat-num" style="color:var(--gold);">${remaining}</span><span class="reg-stat-label">Still Out</span></div>
  </div>`;

  const header = `<div class="tab-inner-header" style="margin-bottom:10px;">
    <input type="search" class="attendance-search" id="attendanceSearch"
           placeholder="Search name or email…" oninput="_filterAttendance(this.value)">
    ${isBoard ? `<button class="btn btn-gold btn-sm" onclick="openWalkinModal()">+ Walk-In</button>` : ''}
  </div>`;

  // Sort: not-checked-in first, then alphabetically
  _attendanceRegs = [...regs].sort((a, b) => {
    const aIn = a.CheckedIn === 'TRUE' || a.CheckedIn === 'true';
    const bIn = b.CheckedIn === 'TRUE' || b.CheckedIn === 'true';
    if (aIn !== bIn) return aIn ? 1 : -1;
    const aName = [a.FirstName, a.LastName].filter(Boolean).join(' ');
    const bName = [b.FirstName, b.LastName].filter(Boolean).join(' ');
    return aName.localeCompare(bName);
  });

  el.innerHTML = summary + header + `<div id="attendanceList" class="attendance-list">${
    _attendanceRegs.length
      ? _attendanceRegs.map(r => _attendanceRow(r, isBoard)).join('')
      : emptyState('No registrations yet.')
  }</div>`;
}

function _filterAttendance(q) {
  const ql      = q.toLowerCase();
  const isBoard = currentUser?.role === 'Board';
  const filtered = ql
    ? _attendanceRegs.filter(r => {
        const name = [r.FirstName, r.LastName].filter(Boolean).join(' ').toLowerCase();
        return name.includes(ql) || (r.Email || '').toLowerCase().includes(ql);
      })
    : _attendanceRegs;
  const listEl = document.getElementById('attendanceList');
  if (listEl) listEl.innerHTML = filtered.map(r => _attendanceRow(r, isBoard)).join('') ||
    `<div class="empty-state"><p>No matches for "${_esc(q)}".</p></div>`;
}

function _attendanceRow(r, isBoard) {
  const name  = [r.FirstName, r.LastName].filter(Boolean).join(' ') || r.Email || '—';
  const ci    = r.CheckedIn === 'TRUE' || r.CheckedIn === 'true';
  const btn   = isBoard
    ? `<button class="btn btn-sm ${ci ? 'btn-checkin-done' : 'btn-gold'}"
               onclick="_doCheckin('${r.RegistrationID}', ${ci}, this, loadAttendance)">
         ${ci ? '✓ Checked In' : 'Check In'}
       </button>`
    : (ci ? `<span class="status-pill active" style="font-size:10px;">✓ In</span>` : statusPill(r.Status));
  return `<div class="attendance-row${ci ? ' checked-in' : ''}">
    <div class="avatar-initials" style="width:30px;height:30px;font-size:10px;flex-shrink:0;">${initials(name)}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:600;color:var(--text-white);">${_esc(name)}</div>
      <div style="font-size:11px;color:var(--text-muted);">${_esc(r.Email || '')}${r.Role ? ` · ${_esc(r.Role)}` : ''}</div>
    </div>
    ${r.CheckInTime ? `<span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${new Date(r.CheckInTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span>` : ''}
    <div style="flex-shrink:0;">${btn}</div>
  </div>`;
}

function openWalkinModal()  { document.getElementById('walkinForm')?.reset(); _modalError('walkinError',''); _openModal('walkinOverlay','walkinModal'); }
function closeWalkinModal() { _closeModal('walkinOverlay','walkinModal'); }

async function submitWalkin() {
  const g     = id => (document.getElementById(id)?.value ?? '').trim();
  const first = g('walkin_FirstName'), email_ = g('walkin_Email');
  if (!first || !email_) { _modalError('walkinError','First name and email are required.'); return; }
  _modalError('walkinError','');
  _btnLoading('walkinSubmitBtn', true, 'Check In');
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/walkin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ FirstName: first, LastName: g('walkin_LastName'), Email: email_ })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('walkinError', data.error || 'Failed.'); return; }
    closeWalkinModal();
    _tabLoaded.attendance = false;
    await loadAttendance();
  } catch (err) {
    _modalError('walkinError','Network error — please try again.');
  } finally {
    _btnLoading('walkinSubmitBtn', false, 'Check In');
  }
}

// ── Status (set to any step, forward or backward) ────────────────────────────

async function setStatus(status) {
  if (!currentEvent) return;
  document.querySelectorAll('.stepper-clickable').forEach(el => el.style.pointerEvents = 'none');
  const btn = document.querySelector('#eventHeroActions .btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/advance-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not update status.'); return; }
    currentEvent.Status = data.Status || status;
    renderEventHero(currentEvent);
    if (_tabLoaded.overview) renderOverview(currentEvent);
  } catch (err) {
    alert('Network error — could not update status. Please try again.');
  } finally {
    document.querySelectorAll('.stepper-clickable').forEach(el => el.style.pointerEvents = '');
    if (btn) btn.disabled = false;
  }
}

// ── Itinerary tab ─────────────────────────────────────────────────────────────

let _itnItemCache = {};

async function loadItinerary() {
  _tabLoad('itineraryContent', async (el) => {
    const items = await apiFetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/itinerary`);
    renderItineraryTab(items, el);
  });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

function renderItineraryTab(items, el) {
  el = el || document.getElementById('itineraryContent');
  const isBoard = currentUser?.role === 'Board';
  const header = `<div class="tab-inner-header">
    <div></div>
    ${isBoard ? `<button class="btn btn-gold btn-sm" onclick="openAddItnModal()">+ Add Item</button>` : ''}
  </div>`;

  _itnItemCache = {};
  for (const item of items) _itnItemCache[item.ItineraryID] = item;

  if (!items.length) { el.innerHTML = header + emptyState('No itinerary items yet.'); return; }

  const rows = items.map(item => _itnRow(item, isBoard)).join('');
  el.innerHTML = header + `<div class="itn-list">${rows}</div>`;
}

function _itnRow(item, isBoard) {
  const timeDisplay = item.Time ? fmtTime(item.Time) : '';
  const trashIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  return `<div class="itn-row${isBoard ? ' itn-clickable' : ''}"
               ${isBoard ? `onclick="openEditItnModal('${_esc(item.ItineraryID)}')"` : ''}>
    <div class="itn-time">${_esc(timeDisplay)}</div>
    <div class="itn-body">
      <div class="itn-title">${_esc(item.Title)}</div>
      ${item.Notes ? `<div class="itn-notes">${_esc(item.Notes)}</div>` : ''}
    </div>
    ${isBoard ? `<button class="icon-btn" title="Delete" style="flex-shrink:0;"
                         onclick="event.stopPropagation(); deleteItnItem('${_esc(item.ItineraryID)}')">${trashIco}</button>` : ''}
  </div>`;
}

function openAddItnModal() {
  document.getElementById('addItnForm')?.reset();
  _modalError('addItnError', '');
  _openModal('addItnOverlay', 'addItnModal');
}
function closeAddItnModal() { _closeModal('addItnOverlay', 'addItnModal'); }

async function submitAddItn() {
  const g = id => (document.getElementById(id)?.value ?? '').trim();
  const title = g('addItn_Title');
  if (!title) { _modalError('addItnError', 'Title is required.'); return; }
  _modalError('addItnError', '');
  _btnLoading('addItnSubmitBtn', true, 'Add Item');
  try {
    const res = await fetch(`/api/events/${encodeURIComponent(currentEvent.EventID)}/itinerary`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Time: g('addItn_Time'), Title: title, Notes: g('addItn_Notes') })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('addItnError', data.error || 'Failed.'); return; }
    closeAddItnModal();
    _tabLoaded.itinerary = false;
    await loadItinerary();
  } catch (err) {
    _modalError('addItnError', 'Network error — please try again.');
  } finally {
    _btnLoading('addItnSubmitBtn', false, 'Add Item');
  }
}

function openEditItnModal(id) {
  const item = _itnItemCache[id];
  if (!item) return;
  document.getElementById('editItn_ID').value    = id;
  document.getElementById('editItn_Time').value  = item.Time  || '';
  document.getElementById('editItn_Title').value = item.Title || '';
  document.getElementById('editItn_Notes').value = item.Notes || '';
  _modalError('editItnError', '');
  _openModal('editItnOverlay', 'editItnModal');
}
function closeEditItnModal() { _closeModal('editItnOverlay', 'editItnModal'); }

async function submitEditItn() {
  const g = id => (document.getElementById(id)?.value ?? '').trim();
  const id = document.getElementById('editItn_ID')?.value;
  const title = g('editItn_Title');
  if (!title) { _modalError('editItnError', 'Title is required.'); return; }
  _modalError('editItnError', '');
  _btnLoading('editItnSubmitBtn', true, 'Save Changes');
  try {
    const res = await fetch(`/api/itinerary/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Time: g('editItn_Time'), Title: title, Notes: g('editItn_Notes') })
    });
    const data = await res.json();
    if (!res.ok) { _modalError('editItnError', data.error || 'Failed.'); return; }
    closeEditItnModal();
    _tabLoaded.itinerary = false;
    await loadItinerary();
  } catch (err) {
    _modalError('editItnError', 'Network error — please try again.');
  } finally {
    _btnLoading('editItnSubmitBtn', false, 'Save Changes');
  }
}

async function deleteItnItem(id) {
  if (!confirm('Delete this itinerary item?')) return;
  try {
    const res = await fetch(`/api/itinerary/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not delete.'); return; }
    _tabLoaded.itinerary = false;
    await loadItinerary();
  } catch (e) { alert('Network error.'); }
}
