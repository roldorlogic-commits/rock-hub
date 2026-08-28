/* Reach Map — Leaflet + OpenStreetMap + Leaflet.markercluster */
'use strict';

(async () => {
  await initUser();

  // ── Initialize map ────────────────────────────────────────────────────────
  const map = L.map('reachMap', { zoomControl: true }).setView([39.5, -98.35], 4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  // ── HTML escape helper ────────────────────────────────────────────────────
  function escHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Custom pin icons by category ─────────────────────────────────────────
  function makeIcon(category) {
    const color = category === 'Partner' ? '#C9A84C' : '#6B7C9E';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z"
            fill="${color}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
      <circle cx="12" cy="12" r="5" fill="#fff" opacity=".9"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: '',
      iconSize:   [24, 32],
      iconAnchor: [12, 32],
      popupAnchor:[0, -34]
    });
  }

  // ── Load youth groups ─────────────────────────────────────────────────────
  let groups = [];
  try {
    groups = await apiFetch('/api/youth-groups');
  } catch (e) {
    console.error('Reach Map: could not load youth groups', e);
  }

  const mapped = groups.filter(g => g.lat && g.lng && !isNaN(parseFloat(g.lat)));

  if (!mapped.length) {
    document.getElementById('mapNoData').style.display = 'block';
  }

  // ── Build popup HTML ──────────────────────────────────────────────────────
  function makePopupHtml(g) {
    const name   = escHtml(g.youth_group_name || g.church_name || '—');
    const church = (g.church_name && g.youth_group_name) ? `<div class="rmap-popup-church">${escHtml(g.church_name)}</div>` : '';
    const isPart = g.category === 'Partner';
    const badge  = `<span class="rmap-popup-badge yg-cat-badge ${isPart ? 'partner' : 'prospect'}">${escHtml(g.category || 'Prospect')}</span>`;
    const loc    = [g.address, g.city, g.state, g.zip].filter(Boolean).map(escHtml).join(', ');
    const pc     = g.primary_contact_name
      ? `<div class="rmap-popup-contact">${escHtml(g.primary_contact_name)}${g.primary_contact_phone ? ' · ' + escHtml(g.primary_contact_phone) : ''}</div>`
      : '';
    return `<div>
      <div class="rmap-popup-name">${name}</div>
      ${church}${badge}
      ${loc ? `<div class="rmap-popup-loc">${loc}</div>` : ''}
      ${pc}
      <span class="rmap-popup-link" data-ygid="${escHtml(g.id)}">View full card →</span>
    </div>`;
  }

  // ── Place markers ─────────────────────────────────────────────────────────
  const markers = [];
  let _hoverTimer = null;

  for (const g of mapped) {
    const lat  = parseFloat(g.lat);
    const lng  = parseFloat(g.lng);
    const icon = makeIcon(g.category);
    const name = g.youth_group_name || g.church_name || '—';
    const marker = L.marker([lat, lng], { icon, title: name });
    marker.bindPopup(makePopupHtml(g), { maxWidth: 260, className: 'rmap-popup-wrap' });
    marker.on('mouseover', () => { clearTimeout(_hoverTimer); marker.openPopup(); });
    marker.on('mouseout',  () => { _hoverTimer = setTimeout(() => marker.closePopup(), 220); });
    marker.addTo(map);
    markers.push(marker);
  }

  // On popup open: wire "View full card" and keep popup open on hover.
  map.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    el.querySelectorAll('[data-ygid]').forEach(link => {
      link.addEventListener('click', () => {
        const g = mapped.find(x => x.id === link.dataset.ygid);
        if (g) { map.closePopup(); showGroupDetail(g); }
      });
    });
    el.addEventListener('mouseenter', () => clearTimeout(_hoverTimer));
    el.addEventListener('mouseleave', () => { _hoverTimer = setTimeout(() => map.closePopup(), 220); });
  });

  // Fit bounds to all markers if any
  if (mapped.length) {
    try { map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15)); } catch (_) {}
  }

  // ── Side panel ────────────────────────────────────────────────────────────
  const esc = escHtml;

  function showGroupDetail(g) {
    const panel   = document.getElementById('mapSidePanel');
    const def     = document.getElementById('mapSideDefault');
    const detail  = document.getElementById('mapSideDetail');
    const name    = esc(g.youth_group_name || g.church_name || '—');
    const loc     = [g.address, g.city, g.state, g.zip].filter(Boolean).map(esc).join(', ');
    const tags    = g.tags ? g.tags.split(',').map(t => `<span class="tag-chip-sm">${esc(t.trim())}</span>`).join('') : '';
    const pcName  = esc(g.primary_contact_name  || '');
    const pcPhone = esc(g.primary_contact_phone || '');
    const pcEmail = esc(g.primary_contact_email || '');
    const isPartner = g.category === 'Partner';

    detail.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px;">
        <div>
          <div class="map-group-name">${name}</div>
          ${g.church_name && g.youth_group_name ? `<div class="map-group-church">${esc(g.church_name)}</div>` : ''}
        </div>
        <span class="yg-cat-badge ${isPartner ? 'partner' : 'prospect'}" style="flex-shrink:0;">${esc(g.category || 'Prospect')}</span>
      </div>
      ${loc ? `<div class="map-group-loc">${loc}</div>` : ''}
      ${(pcName || pcPhone || pcEmail) ? `
        <div class="detail-field" style="margin-bottom:10px;">
          <div class="detail-field-label">Primary Contact</div>
          ${pcName  ? `<div class="detail-field-value">${pcName}</div>` : ''}
          ${pcPhone ? `<div class="detail-field-value" style="font-size:12px;">${pcPhone}</div>` : ''}
          ${pcEmail ? `<div class="detail-field-value" style="font-size:12px;"><a href="mailto:${pcEmail}">${pcEmail}</a></div>` : ''}
        </div>` : ''}
      ${tags ? `<div class="contact-tags" style="margin-bottom:12px;">${tags}</div>` : ''}
      ${g.notes ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:14px;">${esc(g.notes)}</div>` : ''}
      <a class="btn btn-gold btn-sm" style="width:100%;justify-content:center;"
         href="/board?s=members" onclick="sessionStorage.setItem('openYG','${esc(g.id)}')">
        View Full Group →
      </a>`;

    def.style.display    = 'none';
    detail.style.display = '';
    panel.classList.remove('collapsed');
  }

  // Store the group ID in sessionStorage so board.js can open the YG panel
  // when the user lands back on the Contacts tab from the map.
  window.addEventListener('pageshow', () => {
    const ygId = sessionStorage.getItem('openYG');
    if (ygId) {
      sessionStorage.removeItem('openYG');
      // handled in board.js on section load
    }
  });
})();
