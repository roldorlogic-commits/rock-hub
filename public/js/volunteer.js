/* Volunteer Dashboard */

let currentUser = null;
// Populated by loadVEvents() so task rows can resolve RelatedEventID -> name.
let eventsById = {};
// EventIDs the signed-in volunteer has already registered for (drives the
// "You're registered" badge and hides the Sign Up button for those events).
let mySignupEventIds = [];

(async () => {
  currentUser = await initUser();
  if (currentUser) fillWelcome(currentUser);
  await loadMySignups();
  await loadVEvents(); // populates eventsById before tasks render
  await Promise.all([
    loadVStats(), loadVTasks(),
    loadAnnouncements(), loadResources(), loadTeam(),
    initNotifications(['All', 'Volunteers'])
  ]);
})();

async function loadMySignups() {
  try {
    const { eventIds } = await apiFetch('/api/event-signups/mine');
    mySignupEventIds = eventIds || [];
  } catch (e) { mySignupEventIds = []; }
}

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
    eventsById = Object.fromEntries(events.filter(e => e.EventID).map(e => [e.EventID, e]));
    renderVEventsPreview(events);
    renderVEventsFull(events);
  } catch (e) {
    document.getElementById('vEventsPreview').innerHTML = emptyState('Could not load events right now. Please try again shortly.');
  }
}

function vEventRow(ev, withSignup = false) {
  const db = fmtDateBlock(ev.StartDate);
  const eventId    = ev.EventID || ev.EventName;
  const registered = mySignupEventIds.includes(eventId);
  const action = withSignup
    ? (registered
        ? `<span class="status-pill active">You're registered</span>`
        : `<button class="btn btn-outline btn-sm" onclick="signUp('${eventId}')">Sign Up</button>`)
    : statusPill(ev.Status || 'Upcoming');

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
      ${action}
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
  const ev = eventsById[eventId];
  document.getElementById('signupEventName').textContent = ev ? `${ev.EventName} · ${fmtDate(ev.StartDate)}${ev.Location ? ' · ' + ev.Location : ''}` : '';
  document.getElementById('signupForm').dataset.eventId = eventId;
  document.getElementById('signupName').value  = currentUser?.name  || '';
  document.getElementById('signupEmail').value = currentUser?.email || '';
  document.getElementById('signupPhone').value = '';
  document.getElementById('signupRole').value  = '';
  document.getElementById('signupNotes').value = '';
  document.getElementById('signupAvailability').checked = false;
  document.getElementById('signupForm').style.display = 'flex';
  document.getElementById('signupSuccess').style.display = 'none';
  document.getElementById('signupOverlay').classList.add('open');
  document.getElementById('signupModal').classList.add('open');
}

function closeSignupModal() {
  document.getElementById('signupOverlay')?.classList.remove('open');
  document.getElementById('signupModal')?.classList.remove('open');
}

async function submitSignup(e) {
  e.preventDefault();
  const form    = document.getElementById('signupForm');
  const eventId = form.dataset.eventId;
  const [first, ...rest] = (document.getElementById('signupName').value || '').trim().split(/\s+/);

  const body = {
    FirstName: first || '',
    LastName: rest.join(' '),
    Email: document.getElementById('signupEmail').value.trim(),
    Phone: document.getElementById('signupPhone').value.trim(),
    PreferredRole: document.getElementById('signupRole').value.trim(),
    Notes: document.getElementById('signupNotes').value.trim()
  };

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res  = await fetch(`/api/event-signups/${encodeURIComponent(eventId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not sign up for this event.'); return; }

    form.style.display = 'none';
    const successEl = document.getElementById('signupSuccess');
    successEl.style.display = 'block';
    successEl.innerHTML = `<p>✅ ${data.message}</p>`;

    if (!mySignupEventIds.includes(eventId)) mySignupEventIds.push(eventId);
    await loadVEvents(); // refresh badges + registration progress
  } catch (err) {
    alert('Network error — could not sign up. Please try again.');
  } finally {
    btn.disabled = false;
  }
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

function renderVTasksPreview(tasks) {
  const el = document.getElementById('vTasksPreview');
  const open = tasks.filter(t => t.Status !== 'Completed').slice(0, 4);
  el.innerHTML = open.length ? open.map(t => interactiveTaskRow(t, eventsById)).join('') : emptyState('No open tasks assigned to you right now.');
}

function renderVTasksFull(tasks) {
  const el = document.getElementById('vTasksFull');
  el.innerHTML = tasks.length ? renderTaskListHtml(tasks, eventsById) : emptyState('No tasks assigned to you yet — check back after your next event sign-up.');
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

async function loadResources() {
  try {
    const docs = await apiFetch('/api/documents');
    const pub = docs.filter(d => d.Title && (!d.AccessLevel || d.AccessLevel === 'All' || d.AccessLevel === 'Public'));

    document.getElementById('vResources').innerHTML = pub.length
      ? pub.slice(0, 5).map(documentRow).join('')
      : emptyState('No public resources yet.');

    document.getElementById('vResourcesFull').innerHTML = pub.length
      ? pub.map(documentRow).join('')
      : emptyState('No resources yet — check back soon, or ask a board member to add one.');
  } catch (e) {
    document.getElementById('vResources').innerHTML = emptyState('Could not load resources right now. Please try again shortly.');
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
            <div class="contact-row clickable" role="button" tabindex="0"
                 onclick="location.href='/volunteers/${encodeURIComponent(v.VolunteerID)}'"
                 onkeydown="if(event.key==='Enter')location.href='/volunteers/${encodeURIComponent(v.VolunteerID)}'">
              ${avatarHtml(name, null)}
              <div class="contact-info">
                <div class="contact-name">${name}</div>
                <div class="contact-email">${v.PreferredRole || v.Skills || '—'}</div>
              </div>
              <span class="status-pill ${v.Status?.toLowerCase() === 'active' ? 'active' : 'inactive'}">${v.Status || 'Active'}</span>
            </div>`;
        }).join('')
      : emptyState('No team members yet — volunteers will show up here once they join.');
  } catch (e) {
    document.getElementById('vTeam').innerHTML = emptyState('Could not load your team right now. Please try again shortly.');
  }
}
