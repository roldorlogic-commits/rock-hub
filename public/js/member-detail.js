/* Member Detail Page */

const MEMBER_FIELD_LABELS = {
  MemberID: 'Member ID', MembershipType: 'Membership Type', JoinDate: 'Join Date',
  RenewalDate: 'Renewal Date', Address: 'Address', City: 'City', State: 'State', Zip: 'ZIP',
  EmergencyContact: 'Emergency Contact', EmergencyPhone: 'Emergency Phone', Notes: 'Notes'
};
const MEMBER_FIELD_ORDER = ['MemberID', 'MembershipType', 'JoinDate', 'RenewalDate', 'Address', 'City', 'State', 'Zip', 'EmergencyContact', 'EmergencyPhone', 'Notes'];
const MEMBER_DATE_FIELDS = new Set(['JoinDate', 'RenewalDate']);
const MEMBER_FULL_SPAN   = new Set(['Address', 'Notes']);

(async () => {
  await initUser();
  await loadMemberDetail();
})();

function memberIdFromPath() {
  return decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
}

async function loadMemberDetail() {
  const el = document.getElementById('memberDetail');
  const id = memberIdFromPath();
  try {
    const m = await apiFetch(`/api/members/${encodeURIComponent(id)}`);
    el.innerHTML = renderMemberDetail(m);
  } catch (e) {
    el.innerHTML = `<div class="card">${emptyState('Could not find that member. They may have been removed from the Members sheet.')}</div>`;
  }
}

function renewalBanner(m) {
  if (!m.RenewalDate) return '';
  const renewal = new Date(m.RenewalDate + 'T00:00:00');
  if (isNaN(renewal)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((renewal - today) / 86400000);

  if (daysUntil < 0) {
    return `
      <div class="renewal-banner overdue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Renewal overdue — was due ${fmtDate(m.RenewalDate)}.
      </div>`;
  }
  if (daysUntil <= 30) {
    return `
      <div class="renewal-banner due">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Renewal due ${fmtDate(m.RenewalDate)} (${daysUntil} day${daysUntil === 1 ? '' : 's'} away).
      </div>`;
  }
  return '';
}

function renderMemberDetail(m) {
  const name = [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email || 'Unnamed Member';
  const statusCls = (m.MembershipStatus || '').toLowerCase() === 'active' ? 'active' : 'inactive';

  const fields = MEMBER_FIELD_ORDER
    .filter(k => m[k] !== undefined)
    .map(k => {
      const raw = m[k];
      const value = raw ? (MEMBER_DATE_FIELDS.has(k) ? fmtDate(raw) : raw) : '';
      return `
        <div class="detail-field${MEMBER_FULL_SPAN.has(k) ? ' full-span' : ''}">
          <div class="detail-field-label">${MEMBER_FIELD_LABELS[k] || k}</div>
          <div class="detail-field-value${value ? '' : ' empty'}">${value || '—'}</div>
        </div>`;
    }).join('');

  return `
    ${renewalBanner(m)}
    <div class="card detail-header-card">
      ${avatarHtml(name, null)}
      <div>
        <div class="detail-header-name">${name}</div>
        <div class="detail-header-meta">
          <span class="status-pill ${statusCls}">${m.MembershipStatus || 'Unknown'}</span>
          ${m.MembershipType ? `<span class="role-badge">${m.MembershipType}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Contact Info</span></div>
      <div class="detail-field-grid">
        <div class="detail-field">
          <div class="detail-field-label">Email</div>
          <div class="detail-field-value${m.Email ? '' : ' empty'}">${m.Email ? `<a href="mailto:${m.Email}">${m.Email}</a>` : '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-field-label">Phone</div>
          <div class="detail-field-value${m.Phone ? '' : ' empty'}">${m.Phone || '—'}</div>
        </div>
      </div>
    </div>

    ${fields ? `
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Membership Details</span></div>
      <div class="detail-field-grid">${fields}</div>
    </div>` : ''}
  `;
}
