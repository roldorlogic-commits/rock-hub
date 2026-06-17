/* Volunteer Dashboard */

let currentUser = null;
// Populated by loadVEvents() so task rows can resolve RelatedEventID -> name.
let eventsById = {};
// Full EventRegistrations rows for the signed-in volunteer (drives the
// "Pending"/"Confirmed" badge on event cards and the My Sign-Ups page).
let mySignups = [];

(async () => {
  currentUser = await initUser();
  if (currentUser) fillWelcome(currentUser);
  await loadMySignups();
  renderMySignupsPreview();
  renderMySignupsFull();
  await loadVEvents(); // populates eventsById before tasks render
  await Promise.all([
    loadVStats(), loadVTasks(),
    loadAnnouncements(), loadResources(), loadTeam(),
    loadVHours(),
    initNotifications(['All', 'Volunteers'])
  ]);
})();

async function loadMySignups() {
  try {
    mySignups = await apiFetch('/api/my-registrations');
  } catch (e) { mySignups = []; }
}

function mySignupFor(eventId) {
  return mySignups.find(r => r.EventID === eventId);
}

function renderMySignupsList(signups) {
  if (!signups.length) return emptyState('No sign-ups yet — browse Events to find something to get involved with.');
  return signups.map(r => {
    const cls = r.Status === 'Confirmed' ? 'active' : r.Status === 'Waitlisted' ? 'pending' : 'pending';
    return `
      <div class="event-row">
        <div class="date-block">
          <span class="month">${fmtDateBlock(r.StartDate).month}</span>
          <span class="day">${fmtDateBlock(r.StartDate).day}</span>
        </div>
        <div class="event-info">
          <div class="event-name">${r.EventName || r.EventID}</div>
          <div class="event-meta">
            <span>${fmtDate(r.StartDate)}</span>
            ${r.Location ? `<span class="event-meta-sep">·</span><span>${r.Location}</span>` : ''}
            ${r.Role ? `<span class="event-meta-sep">·</span><span>${r.Role}</span>` : ''}
          </div>
        </div>
        <span class="status-pill ${cls}">${r.Status}</span>
      </div>`;
  }).join('');
}

function renderMySignupsPreview() {
  document.getElementById('mySignupsPreview').innerHTML = renderMySignupsList(mySignups.slice(0, 4));
}
function renderMySignupsFull() {
  document.getElementById('mySignupsFull').innerHTML = renderMySignupsList(mySignups);
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
    const [events, tasks, vol] = await Promise.all([
      apiFetch('/api/events'),
      apiFetch('/api/tasks'),
      apiFetch('/api/volunteers/me').catch(() => null)
    ]);
    document.getElementById('vEvents').textContent = events.filter(isUpcomingEvent).length || '0';

    const myEmail = (currentUser?.email ?? '').toLowerCase();
    const myName  = (currentUser?.name ?? '').toLowerCase();
    const myTasks = tasks.filter(t => {
      const assignee = t.AssignedTo?.toLowerCase() ?? '';
      return (assignee === myEmail || assignee === myName) && t.Status !== 'Completed';
    });
    document.getElementById('vTasks').textContent = myTasks.length || '0';
    document.getElementById('vHours').textContent = vol?.HoursLogged || '0';

    const pd = document.getElementById('profileDept');
    if (pd && vol?.PreferredRole) pd.textContent = vol.PreferredRole;
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
  const db      = fmtDateBlock(ev.StartDate);
  const eventId = ev.EventID || ev.EventName;
  const mine    = mySignupFor(eventId);

  // The whole row navigates to the detail page; the Sign Up button stops
  // propagation so it opens the modal instead.
  const href = ev.EventID ? `/events/${encodeURIComponent(ev.EventID)}` : null;
  const row  = href
    ? `class="event-row clickable" role="button" tabindex="0" onclick="location.href='${href}'" onkeydown="if(event.key==='Enter')location.href='${href}'"`
    : `class="event-row"`;

  const action = withSignup
    ? (mine
        ? `<span class="status-pill ${mine.Status === 'Confirmed' ? 'active' : 'pending'}">${mine.Status}</span>`
        : `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();signUp('${eventId}')">Sign Up</button>`)
    : statusPill(ev.Status || 'Upcoming');

  return `
    <div ${row}>
      ${ev.PhotoURL ? `<img src="${ev.PhotoURL}" alt="" class="event-row-photo">` : ''}
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
  const photoEl = document.getElementById('signupEventPhoto');
  if (photoEl) {
    if (ev?.PhotoURL) {
      photoEl.src = ev.PhotoURL;
      photoEl.style.display = '';
    } else {
      photoEl.style.display = 'none';
    }
  }
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
    Role: document.getElementById('signupRole').value.trim(),
    Notes: document.getElementById('signupNotes').value.trim()
  };

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res  = await fetch(`/api/events/${encodeURIComponent(eventId)}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not sign up for this event.'); return; }

    form.style.display = 'none';
    const successEl = document.getElementById('signupSuccess');
    successEl.style.display = 'block';
    successEl.innerHTML = `<p>✅ ${data.waitlisted ? "You've been added to the waitlist — we'll reach out if a spot opens up." : data.message}</p>`;

    await loadMySignups();
    renderMySignupsPreview();
    renderMySignupsFull();
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

// ── Editable profile (phone, church, availability, skills) ─────────────────
let myVolunteerCache = null;

async function openProfileEdit() {
  try {
    const vols = await apiFetch('/api/volunteers');
    const myEmail = (currentUser?.email ?? '').toLowerCase();
    myVolunteerCache = vols.find(v => v.Email?.toLowerCase() === myEmail) || null;
  } catch (e) { myVolunteerCache = null; }

  const churchMatch = (myVolunteerCache?.Notes || '').match(/Church\/Org:\s*([^.]+)\.?/);
  document.getElementById('profilePhone').value        = myVolunteerCache?.Phone || '';
  document.getElementById('profileChurch').value        = churchMatch ? churchMatch[1].trim() : '';
  document.getElementById('profileAvailability').value  = myVolunteerCache?.AvailabilityDays || '';
  document.getElementById('profileSkills').value        = myVolunteerCache?.Skills || '';

  document.getElementById('profileForm').style.display = 'flex';
  document.getElementById('profileSuccess').style.display = 'none';
  document.getElementById('profileOverlay').classList.add('open');
  document.getElementById('profileModal').classList.add('open');
}

function closeProfileEdit() {
  document.getElementById('profileOverlay')?.classList.remove('open');
  document.getElementById('profileModal')?.classList.remove('open');
}

async function submitProfileEdit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch('/api/volunteers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Phone: document.getElementById('profilePhone').value.trim(),
        Church: document.getElementById('profileChurch').value.trim(),
        AvailabilityDays: document.getElementById('profileAvailability').value.trim(),
        Skills: document.getElementById('profileSkills').value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not save your profile.'); return; }

    document.getElementById('profileForm').style.display = 'none';
    const successEl = document.getElementById('profileSuccess');
    successEl.style.display = 'block';
    successEl.innerHTML = '<p>✅ Your profile has been updated.</p>';
    setTimeout(closeProfileEdit, 1200);
  } catch (err) {
    alert('Network error — could not save your profile. Please try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── My Hours ────────────────────────────────────────────────────────────────

async function loadVHours() {
  const el = document.getElementById('vHoursFull');
  if (!el) return;
  try {
    const log = await apiFetch('/api/my-hours');
    if (!log.length) {
      el.innerHTML = emptyState('No hours logged yet — use the "Log Hours" button above to record your volunteer time.');
      return;
    }
    const totalHours = log.reduce((sum, h) => sum + (parseFloat(h.Hours) || 0), 0);
    el.innerHTML = `
      <div class="metrics-row three" style="margin-bottom:16px;">
        <div class="metric-card"><div class="metric-label">Total Hours</div><div class="metric-value">${totalHours}</div></div>
        <div class="metric-card"><div class="metric-label">Sessions</div><div class="metric-value">${log.length}</div></div>
        <div class="metric-card"><div class="metric-label">Most Recent</div><div class="metric-value" style="font-size:14px;">${fmtDate(log[0]?.Date)}</div></div>
      </div>
      ${log.map(h => {
        const hrs = parseFloat(h.Hours) || 0;
        return `
          <div class="task-row">
            <div style="flex:1;min-width:0;">
              <div class="task-title">${h.Activity || '—'}</div>
              <div class="task-meta">
                ${fmtDate(h.Date)}
                ${h.EventName ? `<span style="margin:0 4px;color:var(--gold-line);">·</span>${h.EventName}` : ''}
                ${h.Notes ? `<span style="margin:0 4px;color:var(--gold-line);">·</span>${h.Notes}` : ''}
              </div>
            </div>
            <span class="status-pill active">${hrs} hr${hrs !== 1 ? 's' : ''}</span>
          </div>`;
      }).join('')}`;
  } catch (e) {
    el.innerHTML = emptyState('Could not load hours right now. Please try again shortly.');
  }
}

function openLogHoursModal() {
  document.getElementById('logHoursDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('logHoursHours').value = '';
  document.getElementById('logHoursActivity').value = '';
  document.getElementById('logHoursNotes').value = '';

  const sel = document.getElementById('logHoursEvent');
  if (sel) {
    const opts = Object.values(eventsById)
      .filter(isUpcomingEvent)
      .sort((a, b) => new Date(a.StartDate || 0) - new Date(b.StartDate || 0))
      .map(e => `<option value="${e.EventID}">${e.EventName}${e.StartDate ? ' · ' + fmtDate(e.StartDate) : ''}</option>`)
      .join('');
    sel.innerHTML = '<option value="">— No specific event —</option>' + opts;
  }

  document.getElementById('logHoursForm').style.display = 'flex';
  document.getElementById('logHoursSuccess').style.display = 'none';
  document.getElementById('logHoursOverlay').classList.add('open');
  document.getElementById('logHoursModal').classList.add('open');
}

function closeLogHoursModal() {
  document.getElementById('logHoursOverlay')?.classList.remove('open');
  document.getElementById('logHoursModal')?.classList.remove('open');
}

async function submitLogHours(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const hrs = parseFloat(document.getElementById('logHoursHours').value);
    const body = {
      Hours: hrs,
      Date: document.getElementById('logHoursDate').value,
      Activity: document.getElementById('logHoursActivity').value.trim(),
      EventID: document.getElementById('logHoursEvent').value,
      Notes: document.getElementById('logHoursNotes').value.trim()
    };
    const res = await fetch('/api/my-hours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not log hours.'); return; }

    document.getElementById('logHoursForm').style.display = 'none';
    const successEl = document.getElementById('logHoursSuccess');
    successEl.style.display = 'block';
    successEl.innerHTML = `<p>✅ ${hrs} hour${hrs !== 1 ? 's' : ''} logged! Running total: ${data.newTotal} hrs.</p>`;

    document.getElementById('vHours').textContent = data.newTotal;
    await loadVHours();
    setTimeout(closeLogHoursModal, 1800);
  } catch (err) {
    alert('Network error — could not log hours. Please try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── Notification preferences ──────────────────────────────────────────────────

async function openNotifPrefs() {
  document.getElementById('npError').style.display    = 'none';
  document.getElementById('npSuccess').style.display  = 'none';
  document.getElementById('notifOverlay').classList.add('open');
  document.getElementById('notifModal').classList.add('open');
  try {
    const prefs = await apiFetch('/api/notification-prefs');
    document.getElementById('np_EmailEvents').checked        = prefs.EmailEvents        !== 'false';
    document.getElementById('np_EmailTasks').checked         = prefs.EmailTasks         !== 'false';
    document.getElementById('np_EmailAnnouncements').checked = prefs.EmailAnnouncements !== 'false';
    document.getElementById('np_SMSEvents').checked          = prefs.SMSEvents          === 'true';
    document.getElementById('np_SMSTasks').checked           = prefs.SMSTasks           === 'true';
    document.getElementById('np_SMSAnnouncements').checked   = prefs.SMSAnnouncements   === 'true';
    document.getElementById('np_Phone').value                = prefs.Phone || '';
  } catch (_) {}
}

function closeNotifPrefs() {
  document.getElementById('notifOverlay').classList.remove('open');
  document.getElementById('notifModal').classList.remove('open');
}

async function saveNotifPrefs() {
  const errEl = document.getElementById('npError');
  const btn   = document.getElementById('npSubmitBtn');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/notification-prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        EmailEvents:        document.getElementById('np_EmailEvents').checked,
        EmailTasks:         document.getElementById('np_EmailTasks').checked,
        EmailAnnouncements: document.getElementById('np_EmailAnnouncements').checked,
        SMSEvents:          document.getElementById('np_SMSEvents').checked,
        SMSTasks:           document.getElementById('np_SMSTasks').checked,
        SMSAnnouncements:   document.getElementById('np_SMSAnnouncements').checked,
        Phone:              document.getElementById('np_Phone').value.trim()
      })
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); errEl.textContent = d.error || 'Save failed.'; errEl.style.display = 'block'; return; }
    document.getElementById('npSuccess').style.display = 'block';
    setTimeout(closeNotifPrefs, 1500);
  } catch (_) {
    errEl.textContent = 'Network error — please try again.'; errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Preferences';
  }
}
