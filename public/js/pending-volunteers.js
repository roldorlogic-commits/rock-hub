/* Pending Volunteers (Board approval) */

let pendingCache = [];

(async () => {
  await initUser();
  await loadPending();
})();

async function loadPending() {
  const el = document.getElementById('pendingList');
  try {
    pendingCache = await apiFetch('/api/volunteers/pending');
    renderPending();
  } catch (e) {
    el.innerHTML = emptyState('Could not load pending volunteers right now. Please try again shortly.');
  }
}

function renderPending() {
  const el = document.getElementById('pendingList');
  if (!pendingCache.length) {
    el.innerHTML = emptyState('No pending volunteer registrations right now — new sign-ups will show up here.');
    return;
  }
  el.innerHTML = pendingCache.map(p => {
    const name = [p.FirstName, p.LastName].filter(Boolean).join(' ') || p.Email;
    return `
      <div class="list-item" id="pending-${p.VolunteerID}">
        ${avatarHtml(name, null)}
        <div class="item-info">
          <div class="item-title">${name}</div>
          <div class="item-sub">
            ${p.Email} ${p.Phone ? `· ${p.Phone}` : ''} ${p.Church ? `· ${p.Church}` : ''}
            ${p.RegisteredAt ? `· Registered ${fmtDate(p.RegisteredAt)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button class="btn btn-outline btn-sm" onclick="declineVolunteer('${p.VolunteerID}')">Decline</button>
          <button class="btn btn-gold btn-sm" onclick="confirmVolunteer('${p.VolunteerID}')">Confirm</button>
        </div>
      </div>`;
  }).join('');
}

async function confirmVolunteer(id) {
  await actOnVolunteer(id, 'confirm', 'Confirm this volunteer? They will receive an approval email.');
}
async function declineVolunteer(id) {
  await actOnVolunteer(id, 'decline', 'Decline this volunteer registration? They will receive a notice email.');
}

async function actOnVolunteer(id, action, confirmMsg) {
  if (!confirm(confirmMsg)) return;
  const row = document.getElementById(`pending-${id}`);
  row?.style.setProperty('opacity', '.5');
  try {
    const res = await fetch(`/api/volunteers/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not complete that action.'); row?.style.setProperty('opacity', '1'); return; }
    pendingCache = pendingCache.filter(p => p.VolunteerID !== id);
    renderPending();
  } catch (e) {
    alert('Network error — please try again.');
    row?.style.setProperty('opacity', '1');
  }
}
