/* Volunteer Detail Page */

const VOL_FIELD_LABELS = {
  VolunteerID: 'Volunteer ID', AvailabilityDays: 'Availability', Skills: 'Skills',
  BackgroundCheckDate: 'Background Check Date', PreferredRole: 'Preferred Role',
  JoinDate: 'Join Date', Notes: 'Notes'
};
const VOL_FIELD_ORDER = ['VolunteerID', 'PreferredRole', 'AvailabilityDays', 'Skills', 'BackgroundCheckDate', 'JoinDate', 'Notes'];
const VOL_DATE_FIELDS = new Set(['BackgroundCheckDate', 'JoinDate']);
const VOL_FULL_SPAN   = new Set(['Skills', 'Notes']);

function bgCheckClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'cleared') return 'cleared';
  if (s === 'pending') return 'pending';
  return 'notstarted';
}

(async () => {
  await initUser();
  await loadVolunteerDetail();
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
  } catch (e) {
    el.innerHTML = `<div class="card">${emptyState('Could not find that volunteer. They may have been removed from the Volunteers sheet.')}</div>`;
  }
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
