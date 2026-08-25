/* Volunteer Detail Page */

const VOL_FIELD_LABELS = {
  VolunteerID: 'Volunteer ID', AvailabilityDays: 'Availability', Skills: 'Skills',
  BackgroundCheckDate: 'Background Check Date', PreferredRole: 'Preferred Role',
  JoinDate: 'Join Date', Notes: 'Notes'
};
const VOL_FIELD_ORDER = ['VolunteerID', 'PreferredRole', 'AvailabilityDays', 'Skills', 'BackgroundCheckDate', 'JoinDate', 'Notes'];
const VOL_DATE_FIELDS = new Set(['BackgroundCheckDate', 'JoinDate']);
const VOL_FULL_SPAN   = new Set(['Skills', 'Notes']);

const BG_CHECK_STATUSES = ['Not Started', 'Pending', 'Cleared'];

function bgCheckClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'cleared') return 'cleared';
  if (s === 'pending') return 'pending';
  return 'notstarted';
}

let currentUser = null;

(async () => {
  currentUser = await initUser();
  await loadVolunteerDetail();
  if (currentUser?.role === 'Board') {
    loadAccessManagement(volunteerIdFromPath());
  }
})();

function volunteerIdFromPath() {
  return decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
}

async function loadVolunteerDetail() {
  const el = document.getElementById('volunteerDetail');
  const id = volunteerIdFromPath();
  try {
    const v = await apiFetch(`/api/volunteers/${encodeURIComponent(id)}`);
    el.innerHTML = renderVolunteerDetail(v);
    if (currentUser?.role === 'Board') {
      appendEmergencyContactCard(id, v);
      appendBackgroundCheckCard(id, v);
    }
  } catch (e) {
    el.innerHTML = `<div class="card">${emptyState('Could not find that volunteer. They may have been removed from the Volunteers sheet.')}</div>`;
  }
}

// ── Access Management (Board only) ───────────────────────────────────────────

async function loadAccessManagement(volId) {
  const container = document.getElementById('volunteerDetail');
  const card = document.createElement('div');
  card.id = 'accessManagementCard';
  card.className = 'card';
  card.style.marginTop = '16px';
  card.innerHTML = '<div class="card-header"><span class="card-title">Login Access</span></div><div id="amBody" style="padding:12px 16px 16px;color:var(--text-muted);font-size:13px;">Loading…</div>';
  container.appendChild(card);

  try {
    const ls = await apiFetch(`/api/volunteers/${encodeURIComponent(volId)}/login-status`);
    renderAccessPanel(volId, ls);
  } catch (e) {
    document.getElementById('amBody').textContent = 'Could not load login status.';
  }
}

function renderAccessPanel(volId, ls) {
  const body = document.getElementById('amBody');
  if (!body) return;

  const statusLabels = {
    Active:     ['active',   'Active'],
    Pending:    ['warning',  'Pending Approval'],
    Disabled:   ['inactive', 'Disabled'],
    no_account: ['inactive', 'No Account'],
    Unknown:    ['inactive', 'Unknown']
  };
  const [cls, label] = statusLabels[ls.status] || ['inactive', ls.status];
  const pill = `<span class="status-pill ${cls}" style="font-size:12px;">${label}</span>`;
  const mustResetNote = ls.mustReset ? '<span style="font-size:12px;color:var(--gold);margin-left:8px;">⚠ Must reset password on next login</span>' : '';

  let actions = '';
  if (ls.noEmail) {
    actions = '<p style="color:var(--text-muted);font-size:13px;">This volunteer has no email address. Add an email to enable login access.</p>';
  } else if (ls.status === 'no_account') {
    actions = `<button class="btn-action btn-primary" onclick="amSetTempPassword('${volId}')">Set Temporary Password</button>`;
  } else if (ls.status === 'Disabled') {
    actions = `
      <button class="btn-action btn-primary" onclick="amSetTempPassword('${volId}')">Reset Temporary Password</button>
      <button class="btn-action btn-secondary" onclick="amEnableLogin('${volId}')">Re-enable Access</button>`;
  } else {
    actions = `
      <button class="btn-action btn-secondary" onclick="amSetTempPassword('${volId}')">Set Temporary Password</button>
      <button class="btn-action btn-danger"  onclick="amDisableLogin('${volId}')">Disable Access</button>`;
  }

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      ${pill}${mustResetNote}
      ${ls.email ? `<span style="font-size:12px;color:var(--text-muted);">${ls.email}</span>` : ''}
    </div>
    <div id="amActions" style="display:flex;gap:8px;flex-wrap:wrap;">${actions}</div>
    <div id="amTempPasswordBox" style="display:none;margin-top:14px;padding:12px;background:var(--surface-raised,#1e1e2e);border:1px solid var(--gold);border-radius:8px;">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Temporary password (shown once — share this with the volunteer):</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <code id="amTempPw" style="font-size:15px;letter-spacing:2px;color:var(--gold);flex:1;"></code>
        <button class="btn-action btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="amCopyTempPw()">Copy</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">The volunteer must change this password on first login.</div>
    </div>
    <div id="amError" style="display:none;color:var(--red,#e74c3c);font-size:13px;margin-top:8px;"></div>`;
}

async function amSetTempPassword(volId) {
  const errEl = document.getElementById('amError');
  errEl.style.display = 'none';
  const btns = document.querySelectorAll('#amActions button');
  btns.forEach(b => b.disabled = true);
  try {
    const [data, ls] = await Promise.all([
      apiFetch(`/api/volunteers/${encodeURIComponent(volId)}/temp-password`, { method: 'POST' }),
      apiFetch(`/api/volunteers/${encodeURIComponent(volId)}/login-status`)
    ]);
    // Re-render the panel (refreshes status pill), then reveal the temp password.
    renderAccessPanel(volId, ls);
    document.getElementById('amTempPw').textContent = data.tempPassword;
    document.getElementById('amTempPasswordBox').style.display = 'block';
  } catch (e) {
    errEl.textContent = e.message || 'Could not generate temp password.';
    errEl.style.display = 'block';
    btns.forEach(b => b.disabled = false);
  }
}

async function amEnableLogin(volId) {
  await _amToggle(volId, 'enable-login');
}

async function amDisableLogin(volId) {
  if (!confirm('Disable login access for this volunteer? Their current session will be revoked within 30 seconds.')) return;
  await _amToggle(volId, 'disable-login');
}

async function _amToggle(volId, action) {
  document.getElementById('amError').style.display = 'none';
  const btns = document.querySelectorAll('#amActions button');
  btns.forEach(b => b.disabled = true);
  try {
    await apiFetch(`/api/volunteers/${encodeURIComponent(volId)}/${action}`, { method: 'POST' });
    const ls = await apiFetch(`/api/volunteers/${encodeURIComponent(volId)}/login-status`);
    renderAccessPanel(volId, ls);
  } catch (e) {
    const errEl = document.getElementById('amError');
    errEl.textContent = e.message || 'Action failed. Please try again.';
    errEl.style.display = 'block';
    btns.forEach(b => b.disabled = false);
  }
}

function amCopyTempPw() {
  const pw = document.getElementById('amTempPw')?.textContent || '';
  navigator.clipboard.writeText(pw).then(() => {
    const btn = event.target;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

// ── Emergency Contact card (Board only) ──────────────────────────────────────

function appendEmergencyContactCard(volId, v) {
  const container = document.getElementById('volunteerDetail');
  const card = document.createElement('div');
  card.id = 'emergencyContactCard';
  card.className = 'card';
  card.style.marginTop = '16px';

  const name = v.EmergencyContactName || '';
  const phone = v.EmergencyContactPhone || '';
  const rel   = v.EmergencyContactRelationship || '';
  const hasData = name || phone || rel;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">Emergency Contact</span>
      <button class="btn btn-ghost btn-sm" onclick="toggleEcEdit()">Edit</button>
    </div>
    <div id="ecDisplay" style="padding:12px 16px 16px;">
      ${hasData ? `
        <div class="detail-field-grid">
          <div class="detail-field"><div class="detail-field-label">Name</div><div class="detail-field-value${name ? '' : ' empty'}">${_esc(name) || '—'}</div></div>
          <div class="detail-field"><div class="detail-field-label">Phone</div><div class="detail-field-value${phone ? '' : ' empty'}">${_esc(phone) || '—'}</div></div>
          <div class="detail-field"><div class="detail-field-label">Relationship</div><div class="detail-field-value${rel ? '' : ' empty'}">${_esc(rel) || '—'}</div></div>
        </div>` :
        `<p style="color:var(--text-muted);font-size:13px;">No emergency contact on file. Click Edit to add one.</p>`}
    </div>
    <div id="ecForm" style="display:none;padding:0 16px 16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <label style="grid-column:1/-1;">Name
          <input type="text" id="ec_Name" value="${_esc(name)}" placeholder="Full name">
        </label>
        <label>Phone
          <input type="tel" id="ec_Phone" value="${_esc(phone)}" placeholder="(555) 000-0000">
        </label>
        <label>Relationship
          <input type="text" id="ec_Rel" value="${_esc(rel)}" placeholder="e.g. Spouse, Parent">
        </label>
      </div>
      <p class="form-error" id="ecError" style="display:none;margin-bottom:8px;"></p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-gold btn-sm" onclick="saveEmergencyContact('${volId}')">Save</button>
        <button class="btn btn-outline btn-sm" onclick="toggleEcEdit()">Cancel</button>
      </div>
    </div>`;
  container.appendChild(card);
}

function toggleEcEdit() {
  const display = document.getElementById('ecDisplay');
  const form    = document.getElementById('ecForm');
  if (!display || !form) return;
  const editing = form.style.display !== 'none';
  display.style.display = editing ? '' : 'none';
  form.style.display    = editing ? 'none' : '';
  if (!editing) document.getElementById('ec_Name')?.focus();
}

async function saveEmergencyContact(volId) {
  const errEl = document.getElementById('ecError');
  errEl.style.display = 'none';
  const btn = document.querySelector('#ecForm .btn-gold');
  btn.disabled = true;
  try {
    const body = {
      EmergencyContactName:         (document.getElementById('ec_Name')?.value ?? '').trim(),
      EmergencyContactPhone:        (document.getElementById('ec_Phone')?.value ?? '').trim(),
      EmergencyContactRelationship: (document.getElementById('ec_Rel')?.value ?? '').trim()
    };
    const res = await fetch(`/api/volunteers/${encodeURIComponent(volId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Save failed.'; errEl.style.display = 'block'; return; }
    // Refresh the card display
    const display = document.getElementById('ecDisplay');
    const hasData = body.EmergencyContactName || body.EmergencyContactPhone || body.EmergencyContactRelationship;
    display.innerHTML = hasData ? `
      <div class="detail-field-grid">
        <div class="detail-field"><div class="detail-field-label">Name</div><div class="detail-field-value">${_esc(body.EmergencyContactName) || '—'}</div></div>
        <div class="detail-field"><div class="detail-field-label">Phone</div><div class="detail-field-value">${_esc(body.EmergencyContactPhone) || '—'}</div></div>
        <div class="detail-field"><div class="detail-field-label">Relationship</div><div class="detail-field-value">${_esc(body.EmergencyContactRelationship) || '—'}</div></div>
      </div>` : `<p style="color:var(--text-muted);font-size:13px;">No emergency contact on file.</p>`;
    toggleEcEdit();
  } catch (err) {
    errEl.textContent = 'Network error — please try again.'; errEl.style.display = 'block';
  } finally { btn.disabled = false; }
}

// ── Background Check card (Board only) ───────────────────────────────────────

function appendBackgroundCheckCard(volId, v) {
  const container = document.getElementById('volunteerDetail');
  const card = document.createElement('div');
  card.id = 'bgCheckCard';
  card.className = 'card';
  card.style.marginTop = '16px';

  const status  = v.BackgroundCheckStatus || 'Not Started';
  const date    = v.BackgroundCheckDate   || '';
  const statusOptions = BG_CHECK_STATUSES
    .map(s => `<option value="${s}"${s === status ? ' selected' : ''}>${s}</option>`).join('');

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">Background Check</span>
      <span class="status-pill ${bgCheckClass(status)}">${_esc(status)}</span>
    </div>
    <div style="padding:12px 16px 16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <label>Status
          <select id="bgStatus">${statusOptions}</select>
        </label>
        <label>Date
          <input type="date" id="bgDate" value="${_esc(date)}">
        </label>
      </div>
      <p class="form-error" id="bgError" style="display:none;margin-bottom:8px;"></p>
      <button class="btn btn-gold btn-sm" id="bgSaveBtn" onclick="saveBackgroundCheck('${volId}')">Save</button>
    </div>`;
  container.appendChild(card);
}

async function saveBackgroundCheck(volId) {
  const errEl = document.getElementById('bgError');
  const btn   = document.getElementById('bgSaveBtn');
  const hdr   = document.querySelector('#bgCheckCard .card-header .status-pill');
  errEl.style.display = 'none';
  btn.disabled = true;
  try {
    const status = document.getElementById('bgStatus').value;
    const date   = document.getElementById('bgDate').value;
    const res = await fetch(`/api/volunteers/${encodeURIComponent(volId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ BackgroundCheckStatus: status, BackgroundCheckDate: date })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Save failed.'; errEl.style.display = 'block'; return; }
    // Update the status pill in the card header and in the main detail header
    if (hdr) { hdr.className = `status-pill ${bgCheckClass(status)}`; hdr.textContent = status; }
    const mainPill = document.querySelector('.detail-header-meta .status-pill:nth-child(2)');
    if (mainPill) { mainPill.className = `status-pill ${bgCheckClass(status)}`; mainPill.textContent = status; }
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = 'Save'; }, 2000);
  } catch (err) {
    errEl.textContent = 'Network error — please try again.'; errEl.style.display = 'block';
  } finally { btn.disabled = false; }
}

function renderVolunteerDetail(v) {
  const name = [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email || 'Unnamed Volunteer';
  const statusCls = (v.Status || '').toLowerCase() === 'active' ? 'active' : 'inactive';
  const hours = parseInt(v.HoursLogged, 10) || 0;

  const fields = VOL_FIELD_ORDER
    .filter(k => v[k] !== undefined)
    .map(k => {
      const raw = v[k];
      const value = raw ? (VOL_DATE_FIELDS.has(k) ? fmtDate(raw) : raw) : '';
      return `
        <div class="detail-field${VOL_FULL_SPAN.has(k) ? ' full-span' : ''}">
          <div class="detail-field-label">${VOL_FIELD_LABELS[k] || k}</div>
          <div class="detail-field-value${value ? '' : ' empty'}">${value || '—'}</div>
        </div>`;
    }).join('');

  const linkedMember = v.LinkedMemberID
    ? `<a href="/members/${encodeURIComponent(v.LinkedMemberID)}" class="card-action">View linked member profile →</a>`
    : '';

  return `
    <div class="card detail-header-card">
      ${avatarHtml(name, null)}
      <div>
        <div class="detail-header-name">${name}</div>
        <div class="detail-header-meta">
          <span class="status-pill ${statusCls}">${v.Status || 'Unknown'}</span>
          <span class="status-pill ${bgCheckClass(v.BackgroundCheckStatus)}">${v.BackgroundCheckStatus || 'Not Started'}</span>
        </div>
      </div>
    </div>

    <div class="hours-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:24px;height:24px;color:var(--gold);flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div>
        <span class="hours-number">${hours}</span>
        <span class="hours-label"> hours contributed</span>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Contact Info</span></div>
      <div class="detail-field-grid">
        <div class="detail-field">
          <div class="detail-field-label">Email</div>
          <div class="detail-field-value${v.Email ? '' : ' empty'}">${v.Email ? `<a href="mailto:${v.Email}">${v.Email}</a>` : '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-field-label">Phone</div>
          <div class="detail-field-value${v.Phone ? '' : ' empty'}">${v.Phone || '—'}</div>
        </div>
      </div>
    </div>

    ${fields ? `
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Volunteer Details</span>
        ${linkedMember}
      </div>
      <div class="detail-field-grid">${fields}</div>
    </div>` : ''}
  `;
}
