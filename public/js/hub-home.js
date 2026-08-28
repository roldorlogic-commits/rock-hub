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

  function makeIcon(category) {
    const color = category === 'Partner' ? '#C9A84C' : '#6B7C9E';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="18" height="24">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z"
            fill="${color}" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
      <circle cx="12" cy="12" r="5" fill="#fff" opacity=".9"/>
    </svg>`;
    return L.divIcon({ html: svg, className: '', iconSize: [18, 24], iconAnchor: [9, 24], popupAnchor: [0, -26] });
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function makePopupHtml(g) {
    const name    = esc(g.youth_group_name || g.church_name || '—');
    const church  = (g.church_name && g.youth_group_name) ? `<div class="rmap-popup-church">${esc(g.church_name)}</div>` : '';
    const isPart  = g.category === 'Partner';
    const badge   = `<span class="rmap-popup-badge yg-cat-badge ${isPart ? 'partner' : 'prospect'}">${esc(g.category || 'Prospect')}</span>`;
    const loc     = [g.address, g.city, g.state, g.zip].filter(Boolean).map(esc).join(', ');
    const pc      = g.primary_contact_name
      ? `<div class="rmap-popup-contact">${esc(g.primary_contact_name)}${g.primary_contact_phone ? ' · ' + esc(g.primary_contact_phone) : ''}</div>`
      : '';
    return `<div>
      <div class="rmap-popup-name">${name}</div>
      ${church}${badge}
      ${loc ? `<div class="rmap-popup-loc">${loc}</div>` : ''}
      ${pc}
      <a class="rmap-popup-link" href="/board?s=members"
         onclick="sessionStorage.setItem('openYG','${esc(g.id)}')">View full card →</a>
    </div>`;
  }

  fetch('/api/youth-groups').then(r => r.ok ? r.json() : []).then(groups => {
    const mapped = (groups || []).filter(g => g.lat && g.lng && !isNaN(parseFloat(g.lat)));
    if (!mapped.length) { map.setView([28.5, -81.4], 8); return; }
    const markers = [];
    for (const g of mapped) {
      const marker = L.marker([parseFloat(g.lat), parseFloat(g.lng)], {
        icon: makeIcon(g.category),
        title: g.youth_group_name || g.church_name || ''
      });
      marker.bindPopup(makePopupHtml(g), { maxWidth: 240, className: 'rmap-popup-wrap' });
      marker.addTo(map);
      markers.push(marker);
    }
    try {
      const fg = L.featureGroup(markers);
      map.fitBounds(fg.getBounds().pad(0.15));
    } catch (_) {}
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

// ── Calendar "Add Event" → hub event-create flow ─────────────────────────────
// Routes into the board's existing Create Event modal with the selected date
// pre-filled, so there's one creation path that auto-syncs to the calendar.
window.openCreateFromCal = function() {
  closeCalPopover();
  if (typeof openCreateEventModal === 'function') {
    openCreateEventModal(window._calSelectedDate || '');
  }
};

// ── Social Metrics Tile ───────────────────────────────────────────────────────
let _metricsPeriod = 7;
const _metricsDataCache = {};

function _fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function _changeChip(n) {
  if (n == null || isNaN(n)) return '';
  const cls  = n > 0 ? 'meti-up' : n < 0 ? 'meti-down' : 'meti-flat';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${_fmtNum(n)}</span>`;
}

function _metVal(label, fbVal, igVal, fbChange, igChange) {
  return `
    <div class="meti-row">
      <div class="meti-row-label">${label}</div>
      <div class="meti-pair">
        <div class="meti-col"><span class="meti-plat fb">FB</span><span class="meti-num">${_fmtNum(fbVal)}</span>${fbChange != null ? _changeChip(fbChange) : ''}</div>
        <div class="meti-col"><span class="meti-plat ig">IG</span><span class="meti-num">${_fmtNum(igVal)}</span>${igChange != null ? _changeChip(igChange) : ''}</div>
      </div>
    </div>`;
}

function _renderMetrics(d) {
  const el = document.getElementById('metricsBody');
  if (!el) return;

  if (!d.configured) {
    el.innerHTML = `<div class="meti-notice warn">Metrics unavailable — set <code>META_ACCESS_TOKEN</code> and <code>META_PAGE_ID</code> in Railway env vars.</div>`;
    return;
  }

  const { fb, ig } = d;
  const fbOk = !!fb?.ok;
  const igOk = !!ig?.ok;

  // Surface any permission gaps prominently
  const notices = [];
  if (!fbOk && fb?.error) notices.push(`Facebook error (${fb.error.code}): ${fb.error.message}`);
  if (fbOk && fb?.missingScopes) notices.push('Facebook Insights missing. Token needs: <strong>read_insights</strong>, <strong>pages_read_engagement</strong>');
  if (fbOk && fb?.insightsError && !fb.missingScopes) notices.push(`Facebook Insights: ${fb.insightsError.message}`);
  if (!igOk && ig?.notConfigured) notices.push('Instagram metrics disabled — add <strong>META_IG_BUSINESS_ID</strong> env var (IG Business Account ID from Meta Business Suite).');
  if (!igOk && ig?.error) notices.push(`Instagram error (${ig.error.code}): ${ig.error.message}`);
  if (igOk && ig?.missingScopes) notices.push('Instagram Insights missing. Token needs: <strong>instagram_manage_insights</strong>, <strong>instagram_basic</strong>');

  const noticeBand = notices.length
    ? `<div class="meti-notices">${notices.map(m => `<div class="meti-notice warn">⚠ ${m}</div>`).join('')}</div>`
    : '';

  // Only render groups if we have at least some data
  const hasAny = fbOk || igOk;
  if (!hasAny) {
    el.innerHTML = noticeBand || `<div class="meti-notice warn">No metrics available. Check Meta token configuration.</div>`;
    return;
  }

  const groups = `
    <div class="meti-groups">
      <div class="meti-group">
        <div class="meti-group-title">Followers</div>
        ${_metVal('Total', fbOk ? fb.followers : null, igOk ? ig.followers : null, fb?.fanAdds, ig?.followersGrowth)}
      </div>
      <div class="meti-group">
        <div class="meti-group-title">Reach &amp; Impressions</div>
        ${_metVal('Reach',       fbOk ? fb.reach       : null, igOk ? ig.reach       : null)}
        ${_metVal('Impressions', fbOk ? fb.impressions  : null, igOk ? ig.impressions  : null)}
      </div>
      <div class="meti-group">
        <div class="meti-group-title">Engagement</div>
        ${_metVal('Engaged', fbOk ? fb.engagement : null, null)}
      </div>
      <div class="meti-group">
        <div class="meti-group-title">Profile Activity</div>
        ${_metVal('Page Views',   fbOk ? fb.pageViews    : null, igOk ? ig.profileViews : null)}
      </div>
    </div>`;

  el.innerHTML = groups + noticeBand;
}

window.loadMetricsTile = async function(period) {
  if (period !== undefined) _metricsPeriod = period;
  const el = document.getElementById('metricsBody');
  if (!el) return;
  el.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
  try {
    const data = await fetch(`/api/meta/insights?period=${_metricsPeriod}`).then(r => r.json());
    _metricsDataCache[_metricsPeriod] = data;
    _renderMetrics(data);
  } catch (e) {
    el.innerHTML = '<div class="meti-notice warn">Could not reach metrics API — check server logs.</div>';
  }
};

window.setMetricsPeriod = function(p) {
  _metricsPeriod = p;
  document.getElementById('mpt7')?.classList.toggle('active', p === 7);
  document.getElementById('mpt30')?.classList.toggle('active', p === 30);
  if (_metricsDataCache[p]) {
    _renderMetrics(_metricsDataCache[p]);
  } else {
    loadMetricsTile(p);
  }
};
