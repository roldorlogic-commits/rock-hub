/* Youth Group address autocomplete — Photon (photon.komoot.io) via server proxy.
   Attaches to #yg_address inside the YG create/edit modal.
   Exports ygAcSetStatus() for board.js to call when the modal opens. */

(function () {
  'use strict';

  // ── DOM refs (resolved lazily so the module can load before DOM is ready) ──
  function el(id) { return document.getElementById(id); }

  // ── State ──
  let _debounceTimer = null;
  let _selectionMade = false;  // true after user picks from dropdown

  // ── Status indicator ─────────────────────────────────────────────────────
  // loc_type: '' | 'exact' | 'approximate'
  function setStatus(locType) {
    const wrap = el('yg_loc_status');
    if (!wrap) return;
    if (!locType) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    if (locType === 'exact') {
      wrap.style.display = '';
      wrap.innerHTML = '<span class="loc-exact-badge">&#x1F4CD; Exact location captured</span>';
    } else {
      wrap.style.display = '';
      wrap.innerHTML = '<span class="loc-approx-badge">~ Approximate — address not found in map database</span>';
    }
  }

  // Exposed so board.js can call ygAcSetStatus(g.location_type) on modal open.
  window.ygAcSetStatus = setStatus;

  // ── Clear coords (called when user types freely after a selection) ────────
  function clearSelection() {
    if (!_selectionMade) return;
    _selectionMade = false;
    const lat = el('yg_lat'); if (lat) lat.value = '';
    const lng = el('yg_lng'); if (lng) lng.value = '';
    const lt  = el('yg_location_type'); if (lt) lt.value = '';
    setStatus('');
  }

  // ── Dropdown helpers ──────────────────────────────────────────────────────
  function showDropdown(suggestions) {
    const dd = el('ygAddressDropdown');
    if (!dd) return;
    if (!suggestions.length) { dd.innerHTML = ''; dd.classList.remove('open'); return; }

    dd.innerHTML = suggestions.map((s, i) =>
      `<div class="ac-item" data-idx="${i}" role="option" tabindex="-1">${escHtml(s.label)}</div>`
    ).join('');

    // Attach click handlers
    dd.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus on the input
        selectSuggestion(suggestions[Number(item.dataset.idx)]);
      });
    });

    dd.classList.add('open');
    _currentSuggestions = suggestions;
    _focused = -1;
  }

  function closeDropdown() {
    const dd = el('ygAddressDropdown');
    if (dd) { dd.innerHTML = ''; dd.classList.remove('open'); }
    _currentSuggestions = [];
    _focused = -1;
  }

  // ── Select a suggestion ───────────────────────────────────────────────────
  function selectSuggestion(s) {
    _selectionMade = true;

    const addr = el('yg_address'); if (addr) addr.value = s.address || '';
    const city = el('yg_city');    if (city) city.value = s.city    || '';
    const state= el('yg_state');   if (state) state.value = s.state  || '';
    const zip  = el('yg_zip');     if (zip)  zip.value  = s.zip    || '';
    const lat  = el('yg_lat');     if (lat)  lat.value  = s.lat    || '';
    const lng  = el('yg_lng');     if (lng)  lng.value  = s.lng    || '';
    const lt   = el('yg_location_type'); if (lt) lt.value = 'exact';

    setStatus('exact');
    closeDropdown();
  }

  // ── Keyboard navigation inside dropdown ──────────────────────────────────
  let _currentSuggestions = [];
  let _focused = -1;

  function moveFocus(dir) {
    const dd = el('ygAddressDropdown');
    if (!dd) return;
    const items = dd.querySelectorAll('.ac-item');
    if (!items.length) return;
    _focused = Math.max(0, Math.min(items.length - 1, _focused + dir));
    items.forEach((it, i) => it.classList.toggle('focused', i === _focused));
  }

  // ── Fetch suggestions from server proxy ──────────────────────────────────
  async function fetchSuggestions(q) {
    try {
      const r = await fetch(`/api/youth-groups/photon?q=${encodeURIComponent(q)}`);
      if (!r.ok) return [];
      return await r.json();
    } catch (_) { return []; }
  }

  // ── Attach to the address input ───────────────────────────────────────────
  function attach() {
    const input = el('yg_address');
    if (!input || input._acAttached) return;
    input._acAttached = true;

    input.addEventListener('input', () => {
      clearSelection();
      const q = input.value.trim();
      clearTimeout(_debounceTimer);
      if (q.length < 3) { closeDropdown(); return; }
      _debounceTimer = setTimeout(async () => {
        const suggestions = await fetchSuggestions(q);
        // Only render if input value still matches (user may have kept typing)
        if (input.value.trim() === q) showDropdown(suggestions);
      }, 300);
    });

    input.addEventListener('keydown', (e) => {
      const dd = el('ygAddressDropdown');
      const isOpen = dd?.classList.contains('open');
      if (e.key === 'ArrowDown')  { e.preventDefault(); if (isOpen) moveFocus(1);  else if (input.value.trim().length >= 3) fetchSuggestions(input.value.trim()).then(showDropdown); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); moveFocus(-1); }
      if (e.key === 'Enter' && isOpen && _focused >= 0) {
        e.preventDefault();
        selectSuggestion(_currentSuggestions[_focused]);
      }
      if (e.key === 'Escape')     { closeDropdown(); }
    });

    input.addEventListener('blur', () => {
      // Small delay so mousedown on an item fires before blur closes the list
      setTimeout(closeDropdown, 150);
    });
  }

  // ── Re-attach whenever the modal opens (DOM already ready by then) ────────
  // board.js calls openYGModal() which re-focuses #yg_name; we piggyback on
  // the same timing by observing the modal's open class.
  const observer = new MutationObserver(() => { attach(); });
  const modal = document.getElementById('ygModal');
  if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

  // Also try immediately (modal may already be in DOM but not yet open)
  if (document.readyState !== 'loading') attach();
  else document.addEventListener('DOMContentLoaded', attach);

  // Use the shared escHtml from api.js (loaded before this script)
  const escHtml = window.escHtml || (s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
})();
