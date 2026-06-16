/* Volunteer Dashboard */

let currentUser = null;

(async () => {
  currentUser = await initUser();
  if (currentUser) fillWelcome(currentUser);
  await Promise.all([
    loadVStats(), loadVEvents(), loadVTasks(),
    loadAnnouncements(), loadResources(), loadTeam()
  ]);
})();

function fillWelcome(user) {
  const h = document.getElementById('welcomeHeading');
  const r = document.getElementById('myRoleBanner');
  if (h) h.textContent = `Welcome back, ${user.firstName || user.name}!`;
  if (r) r.textContent = user.role || 'Volunteer';

  // Profile card
  const pi = document.getElementById('profileInitials');
  const pr = document.getElementById('profileRole');
  const pb = document.getElementById('profileBadge');
  if (pi) pi.textContent = initials(user.name);
  if (pr) pr.textContent = user.role || 'Volunteer';
  if (pb) { pb.textContent = user.role || 'Volunteer'; if (user.role === 'Board') pb.classList.add('board'); }
}

async function loadVStats() {
  try {
    const [events, tasks, vols] = await Promise.all([
      apiFetch('/api/events'), apiFetch('/api/tasks'), apiFetch('/api/volunteers')
    ]);
    document.getElementById('vEvents').textContent = events.filter(isUpcomingEvent).length || '0';

    const myEmail = (currentUser?.email ?? '').toLowerCase();
    const myName  = (currentUser?.name ?? '').toLowerCase();
    const myTasks = tasks.filter(t => {
      const assignee = t.AssignedTo?.toLowerCase() ?? '';
      return (assignee === myEmail || assignee === myName) && t.Status !== 'Completed';
    });
    document.getElementById('vTasks').textContent = myTasks.length || '0';

    // Hours logged from volunteers sheet
    const myVol = vols.find(v => v.Email?.toLowerCase() === myEmail.toLowerCase());
    document.getElementById('vHours').textContent = myVol?.HoursLogged || '0';

    // Update profile dept
    const pd = document.getElementById('profileDept');
    if (pd && myVol?.PreferredRole) pd.textContent = myVol.PreferredRole;
  } catch (e) { console.error('VStats:', e); }
}

async function loadVEvents() {
  try {
    const events = await apiFetch('/api/events');
    renderVEventsPreview(events);
    renderVEventsFull(events);
  } catch (e) {
    document.getElementById('vEventsPreview').innerHTML = emptyState('Could not load events.');
  }
}

function vEventRow(ev, withSignup = false) {
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
          <span>${fmtDate(ev.StartDate)}</span>
          ${ev.Location ? `<span class="event-meta-sep">·</span><span>${ev.Location}</span>` : ''}
        </div>
        ${ev.CoordinatorName ? `<div class="event-meta" style="margin-top:2px;">Coordinator: ${ev.CoordinatorName}</div>` : ''}
      </div>
      ${withSignup ? `<button class="btn btn-outline btn-sm" onclick="signUp('${ev.EventID || ev.EventName}')">Sign Up</button>` : statusPill(ev.Status || 'Upcoming')}
    </div>`;
}

function renderVEventsPreview(events) {
  const el = document.getElementById('vEventsPreview');
  const upcoming = sortByStartDate(events.filter(isUpcomingEvent)).slice(0, 4);
  el.innerHTML = upcoming.length ? upcoming.map(e => vEventRow(e)).join('') : emptyState('No upcoming events.');
}

function renderVEventsFull(events) {
  const el = document.getElementById('vEventsFull');
  const sorted = sortByStartDate(events);
  el.innerHTML = sorted.length
    ? sorted.map(e => vEventRow(e, true)).join('')
    : emptyState('No events yet. Check back soon!');
}

function signUp(eventId) {
  alert(`Sign-up noted for event: ${eventId}\n\n(Connect to a registration form or Sheets write endpoint to enable live sign-ups.)`);
}

async function loadVTasks() {
  try {
    const tasks = await apiFetch('/api/tasks');
    // Tasks sheet stores AssignedTo as a person's name, not an email — match either.
    const myEmail = (currentUser?.email ?? '').toLowerCase();
    const myName  = (currentUser?.name ?? '').toLowerCase();
    const mine = tasks.filter(t => {
      const assignee = t.AssignedTo?.toLowerCase() ?? '';
      return assignee === myEmail || assignee === myName;
    });
    renderVTasksPreview(mine);
    renderVTasksFull(mine);
  } catch (e) {
    document.getElementById('vTasksPreview').innerHTML = emptyState('Could not load tasks.');
  }
}

function vTaskRow(t) {
  const done = t.Status === 'Completed';
  return `
    <div class="task-row">
      <div class="check-circle${done ? ' done' : ''}"></div>
      <div style="flex:1;min-width:0;">
        <div class="task-title" style="${done ? 'opacity:.5;text-decoration:line-through;' : ''}">${t.Title || '—'}</div>
        <div class="task-meta">${t.DueDate ? `Due ${fmtDate(t.DueDate)}` : ''}</div>
      </div>
      ${priorityPill(t.Priority)}
    </div>`;
}

function renderVTasksPreview(tasks) {
  const el = document.getElementById('vTasksPreview');
  const open = tasks.filter(t => t.Status !== 'Completed').slice(0, 4);
  el.innerHTML = open.length ? open.map(vTaskRow).join('') : emptyState('No open tasks assigned to you.');
}

function renderVTasksFull(tasks) {
  const el = document.getElementById('vTasksFull');
  el.innerHTML = tasks.length ? tasks.map(vTaskRow).join('') : emptyState('No tasks assigned to you yet.');
}

async function loadAnnouncements() {
  try {
    const items  = await apiFetch('/api/announcements');
    const active = filterAnnouncements(items, ['All', 'Volunteers']);
    document.getElementById('vAnnouncements').innerHTML = active.length
      ? active.slice(0, 4).map(renderAnnouncementItem).join('')
      : emptyState('No announcements yet. Add them to the Announcements sheet.');
  } catch (e) {
    document.getElementById('vAnnouncements').innerHTML = emptyState('Could not load announcements.');
  }
}

function resourceRow(d) {
  return `
    <div class="list-item">
      <div class="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="item-info">
        <div class="item-title">${docTitleHtml(d)}</div>
        <div class="item-sub">${d.Category || d.FileType || '—'} · ${fmtDate(d.UploadDate)}</div>
      </div>
    </div>`;
}

async function loadResources() {
  try {
    const docs = await apiFetch('/api/documents');
    const pub = docs.filter(d => d.Title && (!d.AccessLevel || d.AccessLevel === 'All' || d.AccessLevel === 'Public'));

    document.getElementById('vResources').innerHTML = pub.length
      ? pub.slice(0, 5).map(resourceRow).join('')
      : emptyState('No public resources yet.');

    document.getElementById('vResourcesFull').innerHTML = pub.length
      ? pub.map(resourceRow).join('')
      : emptyState('No resources yet. Add documents to the Documents sheet with AccessLevel "All".');
  } catch (e) {
    document.getElementById('vResources').innerHTML = emptyState('Could not load resources.');
  }
}

async function loadTeam() {
  try {
    const vols = await apiFetch('/api/volunteers');
    const el   = document.getElementById('vTeam');
    el.innerHTML = vols.length
      ? vols.slice(0, 10).map(v => {
          const name = [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email || '—';
          return `
            <div class="contact-row">
              ${avatarHtml(name, null)}
              <div class="contact-info">
                <div class="contact-name">${name}</div>
                <div class="contact-email">${v.PreferredRole || v.Skills || '—'}</div>
              </div>
              <span class="status-pill ${v.Status?.toLowerCase() === 'active' ? 'active' : 'pending'}">${v.Status || 'Active'}</span>
            </div>`;
        }).join('')
      : emptyState('No team members yet. Add volunteers to the Volunteers sheet.');
  } catch (e) {
    document.getElementById('vTeam').innerHTML = emptyState('Could not load team.');
  }
}
