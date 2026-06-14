/* Shared API helpers */

async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
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
    contacts:'Contacts', files:'Files & Docs', minutes:'Meeting Minutes',
    reports:'Reports', settings:'Settings',
    mytasks:'My Tasks', resources:'Resources', myteam:'My Team'
  };
  const pt = document.getElementById('pageTitle');
  if (pt) pt.textContent = titles[id] || id;
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str);
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
