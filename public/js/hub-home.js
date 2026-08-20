/* Board dashboard — home widgets: Google Calendar tile + dashboard Reach Map.
   Loaded after board.js. */

// Board dropdown / task jumps
function selectBoard(id) {
  showSection(id, document.getElementById('boardNavBtn'));
}

// ── Dashboard Reach Map ───────────────────────────────────────────────────────
(function initDashMap() {
  const el = document.getElementById('dashReachMap');
  if (!el) return;

  const map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  const clusterGroup = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  map.addLayer(clusterGroup);

  function makeIcon(category) {
    const color = category === 'Partner' ? '#C9A84C' : '#6B7C9E';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="18" height="24">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z"
            fill="${color}" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
      <circle cx="12" cy="12" r="5" fill="#fff" opacity=".9"/>
    </svg>`;
    return L.divIcon({ html: svg, className: '', iconSize: [18, 24], iconAnchor: [9, 24], popupAnchor: [0, -26] });
  }

  fetch('/api/youth-groups').then(r => r.ok ? r.json() : []).then(groups => {
    const mapped = (groups || []).filter(g => g.lat && g.lng && !isNaN(parseFloat(g.lat)));
    if (!mapped.length) { map.setView([28.5, -81.4], 8); return; }
    for (const g of mapped) {
      const marker = L.marker([parseFloat(g.lat), parseFloat(g.lng)], {
        icon: makeIcon(g.category),
        title: g.youth_group_name || g.church_name || ''
      });
      clusterGroup.addLayer(marker);
    }
    try { map.fitBounds(clusterGroup.getBounds().pad(0.15)); } catch (_) {}
  }).catch(() => { map.setView([28.5, -81.4], 8); });
})();

// ── Interactive Google Calendar tile ─────────────────────────────────────────
(function initCalTile() {
  const gridEl   = document.getElementById('calTileGrid');
  const monthEl  = document.getElementById('calTileMonth');
  const prevBtn  = document.getElementById('calPrevBtn');
  const nextBtn  = document.getElementById('calNextBtn');
  if (!gridEl) return;

  const now = new Date();
  let viewYear  = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-indexed

  // Cache fetched events: key = "YYYY-MM", value = array
  const cache = {};

  async function fetchEvents(y, m) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    if (cache[key]) return cache[key];
    try {
      const evs = await fetch(`/api/calendar/events?month=${key}`).then(r => r.ok ? r.json() : []);
      cache[key] = evs || [];
    } catch (_) { cache[key] = []; }
    return cache[key];
  }

  // Returns "YYYY-MM-DD" local date string from an event's start field.
  function eventDate(start) {
    if (!start) return '';
    // dateTime: "2026-08-20T10:00:00-04:00" — take first 10 chars
    return start.slice(0, 10);
  }

  function fmtTime(iso) {
    if (!iso || iso.length === 10) return 'All day';
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (_) { return ''; }
  }

  async function render() {
    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
    monthEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    const events = await fetchEvents(viewYear, viewMonth);

    // Build a map: "YYYY-MM-DD" → [event, ...]
    const byDay = {};
    for (const ev of events) {
      const d = eventDate(ev.start);
      if (!d) continue;
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(ev);
    }

    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const firstDow   = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMon  = new Date(viewYear, viewMonth + 1, 0).getDate();
    const DOW = ['S','M','T','W','T','F','S'];

    let html = '<div class="cal-grid">';
    DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
    for (let i = 0; i < firstDow; i++) html += '<div class="cal-cell empty"></div>';

    for (let d = 1; d <= daysInMon; d++) {
      const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday    = dateStr === todayStr;
      const hasEvt     = !!byDay[dateStr]?.length;
      const classes    = ['cal-cell', isToday ? 'today' : '', hasEvt ? 'has-event' : ''].filter(Boolean).join(' ');
      html += `<div class="${classes}" data-date="${dateStr}" onclick="calDayClick('${dateStr}')">
        ${d}${hasEvt ? '<span class="cal-dot"></span>' : ''}
      </div>`;
    }
    html += '</div>';
    gridEl.innerHTML = html;
  }

  // Expose day-click globally so inline onclick works
  window.calDayClick = async function(dateStr) {
    const popover   = document.getElementById('calDayPopover');
    const dateLabel = document.getElementById('calPopoverDate');
    const eventsEl  = document.getElementById('calPopoverEvents');
    if (!popover) return;

    const events = await fetchEvents(viewYear, viewMonth);
    const dayEvs = events.filter(ev => eventDate(ev.start) === dateStr);

    const [y, m, d] = dateStr.split('-').map(Number);
    dateLabel.textContent = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    if (dayEvs.length) {
      eventsEl.innerHTML = dayEvs.map(ev => `
        <div class="cal-popover-event">
          <div>${ev.title}</div>
          <div class="cal-popover-event-time">${fmtTime(ev.start)}${ev.location ? ' · ' + ev.location : ''}</div>
        </div>`).join('');
    } else {
      eventsEl.innerHTML = '<div style="font-size:11px;color:#888;padding:4px 0;">No events this day.</div>';
    }

    // Store the date for the add-event modal
    window._calSelectedDate = dateStr;
    popover.style.display = 'block';
  };

  window.closeCalPopover = function() {
    const popover = document.getElementById('calDayPopover');
    if (popover) popover.style.display = 'none';
  };

  prevBtn.addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    closeCalPopover();
    render();
  });
  nextBtn.addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    closeCalPopover();
    render();
  });

  // Initial render
  render();
})();

// ── Add Calendar Event modal ──────────────────────────────────────────────────
window.openCalAddEvent = function() {
  const dateStr = window._calSelectedDate || '';
  const el = document.getElementById('cal_date');
  if (el && dateStr) el.value = dateStr;
  document.getElementById('calAddOverlay').classList.add('open');
  document.getElementById('calAddModal').classList.add('open');
  document.getElementById('calAddError').style.display = 'none';
  document.getElementById('calAddSuccess').style.display = 'none';
  document.getElementById('calAddSubmit').style.display = '';
};

window.closeCalAddEvent = function() {
  document.getElementById('calAddOverlay').classList.remove('open');
  document.getElementById('calAddModal').classList.remove('open');
};

window.toggleCalAllDay = function(cb) {
  const fields = document.getElementById('cal_time_fields');
  if (!fields) return;
  fields.style.display = cb.checked ? 'none' : 'grid';
};

window.submitCalAddEvent = async function() {
  const titleEl  = document.getElementById('cal_title');
  const dateEl   = document.getElementById('cal_date');
  const allDay   = document.getElementById('cal_allday').checked;
  const startT   = document.getElementById('cal_start_time')?.value;
  const endT     = document.getElementById('cal_end_time')?.value;
  const errorEl  = document.getElementById('calAddError');
  const successEl= document.getElementById('calAddSuccess');
  const submitBtn= document.getElementById('calAddSubmit');

  errorEl.style.display = 'none';
  if (!titleEl.value.trim()) { errorEl.textContent = 'Title is required.'; errorEl.style.display = ''; return; }
  if (!dateEl.value)         { errorEl.textContent = 'Date is required.';  errorEl.style.display = ''; return; }

  const date  = dateEl.value; // YYYY-MM-DD
  let start, end;
  if (allDay) {
    start = date;
    end   = date;
  } else {
    const tz = 'T' + (startT || '09:00') + ':00';
    start = date + tz;
    end   = date + 'T' + (endT || (startT ? (parseInt(startT.split(':')[0])+1).toString().padStart(2,'0') + ':' + startT.split(':')[1] : '10:00')) + ':00';
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Adding…';
  try {
    await apiFetch('/api/calendar/events', {
      method: 'POST',
      body: JSON.stringify({
        title:       titleEl.value.trim(),
        description: document.getElementById('cal_desc')?.value || '',
        location:    document.getElementById('cal_location')?.value || '',
        start, end, allDay
      })
    });
    // Clear cache for this month so the tile refreshes
    const monthKey = date.slice(0, 7);
    if (window._calCache) delete window._calCache[monthKey];
    successEl.style.display = '';
    submitBtn.style.display = 'none';
    setTimeout(closeCalAddEvent, 1800);
    // Trigger a re-render
    document.getElementById('calNextBtn')?.click();
    document.getElementById('calPrevBtn')?.click();
  } catch (err) {
    errorEl.textContent = err.message || 'Could not add event.';
    errorEl.style.display = '';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add to Calendar';
  }
};
