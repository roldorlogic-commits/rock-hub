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
    reports:'Reports', settings:'Settings', members:'Members', volunteers:'Volunteers',
    mytasks:'My Tasks', resources:'Resources', myteam:'My Team'
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

function docTitleHtml(d) {
  const title = d.Title || '—';
  const { href } = docLinkInfo(d);
  if (href) return `<a href="${href}" target="_blank" rel="noopener" style="color:var(--text-white);">${title}</a>`;
  return `<span title="No link available" style="color:var(--text-dim);cursor:help;">${title}</span>`;
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
