/* ROCK Hub — Communications Settings
   Handles branding, templates, opt-out/compliance, and sender-info tabs.
   Loaded on board.html; relies on apiFetch() from api.js. */

(function () {
  'use strict';

  let _settings = null;
  let _templates = [];
  let _commsLoaded = false;

  // ── Tab switching ────────────────────────────────────────────────────────────

  window.switchCommsTab = function (tab) {
    document.querySelectorAll('.comms-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.comms-tab-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById(`commsTab-${tab}`);
    if (panel) panel.style.display = '';

    if (tab === 'templates' && !_commsLoaded) return;
    if (tab === 'templates')  loadTemplates();
    if (tab === 'compliance') loadOptouts();
  };

  // ── Init (called by showSection hook below) ──────────────────────────────────

  window.initCommunications = async function () {
    if (_commsLoaded) return;
    _commsLoaded = true;
    try {
      _settings = await apiFetch('/api/comms/settings');
      populateBrandingForm(_settings);
      populateSenderRef(_settings);
      populateComplianceForm(_settings);
      wireSmsPreview();
      updateSmsPreview();
    } catch (e) {
      console.error('initCommunications error:', e);
    }
  };

  // ── Branding tab ─────────────────────────────────────────────────────────────

  function populateBrandingForm(s) {
    setVal('cs_sms_prefix',      s.sms_prefix     ?? '');
    setVal('cs_sms_signoff',     s.sms_signoff    ?? '');
    setVal('cs_email_from_name', s.email_from_name ?? '');
    setVal('cs_email_signature', s.email_signature ?? '');
  }

  function wireSmsPreview() {
    ['cs_sms_prefix', 'cs_sms_signoff'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateSmsPreview);
    });
  }

  function updateSmsPreview() {
    const prefix  = (getVal('cs_sms_prefix') || '').trim();
    const signoff = (getVal('cs_sms_signoff') || '').trim();
    let body = 'Your message text goes here.';
    if (prefix)  body = `${prefix} ${body}`;
    if (signoff) body = `${body}\n${signoff}`;
    const previewEl = document.getElementById('cs_sms_preview');
    const segEl     = document.getElementById('cs_sms_seginfo');
    if (previewEl) previewEl.textContent = body;
    if (segEl) {
      const { chars, segments, maxPerSeg } = segmentInfo(body);
      const warn = segments > 1 ? ' ⚠️ multi-segment' : '';
      segEl.textContent = `${chars} chars · ${segments} segment${segments > 1 ? 's' : ''} (max ${maxPerSeg}/seg)${warn}`;
    }
  }

  window.saveBrandingSettings = async function () {
    const btn = document.querySelector('[onclick="saveBrandingSettings()"]');
    const statusEl = document.getElementById('cs_save_status');
    if (btn) btn.disabled = true;
    try {
      await apiFetch('/api/comms/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sms_prefix:     getVal('cs_sms_prefix'),
          sms_signoff:    getVal('cs_sms_signoff'),
          email_from_name: getVal('cs_email_from_name'),
          email_signature: getVal('cs_email_signature')
        })
      });
      if (statusEl) { statusEl.textContent = 'Saved!'; statusEl.style.color = '#6fcf97'; setTimeout(() => { statusEl.textContent = ''; }, 2500); }
    } catch (e) {
      if (statusEl) { statusEl.textContent = 'Error saving'; statusEl.style.color = '#ff6363'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // ── Compliance tab ───────────────────────────────────────────────────────────

  function populateComplianceForm(s) {
    setVal('cs_sms_stop_reply',  s.sms_stop_reply  ?? '');
    setVal('cs_sms_help_reply',  s.sms_help_reply  ?? '');
    setVal('cs_sms_start_reply', s.sms_start_reply ?? '');
  }

  window.saveComplianceSettings = async function () {
    const btn = document.querySelector('[onclick="saveComplianceSettings()"]');
    const statusEl = document.getElementById('cs_compliance_status');
    if (btn) btn.disabled = true;
    try {
      await apiFetch('/api/comms/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sms_stop_reply:  getVal('cs_sms_stop_reply'),
          sms_help_reply:  getVal('cs_sms_help_reply'),
          sms_start_reply: getVal('cs_sms_start_reply')
        })
      });
      if (statusEl) { statusEl.textContent = 'Saved!'; statusEl.style.color = '#6fcf97'; setTimeout(() => { statusEl.textContent = ''; }, 2500); }
    } catch (e) {
      if (statusEl) { statusEl.textContent = 'Error saving'; statusEl.style.color = '#ff6363'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // ── Opt-out list ─────────────────────────────────────────────────────────────

  window.loadOptouts = async function () {
    const el = document.getElementById('commsOptoutList');
    if (!el) return;
    el.textContent = 'Loading…';
    try {
      const rows = await apiFetch('/api/comms/optouts');
      const optedOut = rows.filter(r => r.Status === 'opted-out');
      if (!optedOut.length) {
        el.innerHTML = '<div style="padding:12px 0;color:var(--text-dim);font-size:13px;">No opted-out numbers.</div>';
        return;
      }
      el.innerHTML = optedOut.map(r => `
        <div class="optout-row">
          <div style="flex:1;">
            <div style="font-weight:600;color:var(--text-primary);">${escHtml(r.Phone)}</div>
            ${r.contactName ? `<div style="font-size:11px;color:var(--text-dim);">${escHtml(r.contactName)}</div>` : ''}
            <div style="font-size:11px;color:var(--text-dim);">Opted out ${r.ChangedAt ? new Date(r.ChangedAt).toLocaleDateString() : '—'}</div>
          </div>
          <button class="btn btn-sm" style="font-size:11px;" onclick="resubscribe('${escHtml(r.Phone)}')">Re-subscribe</button>
        </div>`).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:#ff6363;font-size:12px;">Error loading opt-outs: ${escHtml(e.message)}</div>`;
    }
  };

  window.resubscribe = async function (phone) {
    if (!confirm(`Re-subscribe ${phone} to receive texts again? Only do this if the contact has explicitly agreed.`)) return;
    try {
      await apiFetch(`/api/comms/optouts/${encodeURIComponent(phone)}/resubscribe`, { method: 'POST' });
      loadOptouts();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // ── Sender reference tab ─────────────────────────────────────────────────────

  function populateSenderRef(s) {
    const phoneEl = document.getElementById('cs_sender_phone');
    const emailEl = document.getElementById('cs_sender_email');
    if (phoneEl) phoneEl.textContent = s._senderPhone || '(not configured)';
    if (emailEl) emailEl.textContent = s._senderEmail || '(not configured)';
  }

  // ── Template tab ─────────────────────────────────────────────────────────────

  async function loadTemplates() {
    const el = document.getElementById('commsTplList');
    if (!el) return;
    el.textContent = 'Loading…';
    try {
      _templates = await apiFetch('/api/comms/templates');
      renderTemplateList();
    } catch (e) {
      el.innerHTML = `<div style="color:#ff6363;font-size:12px;">Error: ${escHtml(e.message)}</div>`;
    }
  }

  function renderTemplateList() {
    const el = document.getElementById('commsTplList');
    if (!el) return;
    if (!_templates.length) {
      el.innerHTML = '<div style="padding:12px 0;color:var(--text-dim);font-size:13px;">No templates yet. Click "+ New Template" to create one.</div>';
      return;
    }
    el.innerHTML = _templates.map(t => {
      const ch = (t.Channel || 'Both').toLowerCase();
      return `
        <div class="tpl-row">
          <span class="tpl-badge ${ch}">${escHtml(t.Channel || 'Both')}</span>
          <div style="flex:1;">
            <div style="font-weight:600;color:var(--text-primary);font-size:14px;">${escHtml(t.Name)}</div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:1px;">${escHtml((t.Body || '').slice(0, 80))}${(t.Body || '').length > 80 ? '…' : ''}</div>
          </div>
          <button class="btn btn-sm" onclick="openTemplateModal('${escHtml(t.TemplateID)}')">Edit</button>
        </div>`;
    }).join('');
  }

  window.openTemplateModal = function (id) {
    const t = id ? _templates.find(x => x.TemplateID === id) : null;
    setVal('tpl_editing_id', id || '');
    setVal('tpl_name',    t ? t.Name    : '');
    setVal('tpl_channel', t ? t.Channel : 'Both');
    setVal('tpl_subject', t ? t.Subject : '');
    setVal('tpl_body',    t ? t.Body    : '');
    document.getElementById('tplModalTitle').textContent = id ? 'Edit Template' : 'New Template';
    document.getElementById('tplDeleteBtn').style.display = id ? '' : 'none';
    document.getElementById('tpl_charcount').textContent = `${(t ? t.Body : '').length} chars`;
    document.getElementById('tplModal').style.display = 'flex';
    // Wire char counter
    const bodyEl = document.getElementById('tpl_body');
    if (bodyEl) {
      bodyEl.oninput = () => {
        document.getElementById('tpl_charcount').textContent = `${bodyEl.value.length} chars`;
      };
    }
  };

  window.closeTemplateModal = function () {
    document.getElementById('tplModal').style.display = 'none';
  };

  window.saveTemplate = async function () {
    const id      = getVal('tpl_editing_id');
    const payload = {
      name:    getVal('tpl_name'),
      channel: getVal('tpl_channel'),
      subject: getVal('tpl_subject'),
      body:    getVal('tpl_body')
    };
    if (!payload.name || !payload.body) { alert('Name and body are required.'); return; }
    try {
      if (id) {
        await apiFetch(`/api/comms/templates/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: payload.name, Channel: payload.channel, Subject: payload.subject, Body: payload.body }) });
      } else {
        await apiFetch('/api/comms/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      closeTemplateModal();
      loadTemplates();
    } catch (e) {
      alert('Error saving template: ' + e.message);
    }
  };

  window.deleteTemplate = async function () {
    const id = getVal('tpl_editing_id');
    if (!id) return;
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/comms/templates/${id}`, { method: 'DELETE' });
      closeTemplateModal();
      loadTemplates();
    } catch (e) {
      alert('Error deleting template: ' + e.message);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  function getVal(id) {
    return (document.getElementById(id)?.value || '').trim();
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function segmentInfo(text) {
    const len = (text || '').length;
    const hasUni = [...(text || '')].some(c => c.charCodeAt(0) > 127);
    const singleMax = hasUni ? 70 : 160;
    const multiMax  = hasUni ? 67 : 153;
    if (len <= singleMax) return { chars: len, segments: 1, maxPerSeg: singleMax };
    return { chars: len, segments: Math.ceil(len / multiMax), maxPerSeg: multiMax };
  }

  // ── Hook into showSection ────────────────────────────────────────────────────
  // Intercept showSection so initCommunications() fires the first time the
  // section is opened, without patching api.js.
  const _originalShowSection = window.showSection;
  if (typeof _originalShowSection === 'function') {
    window.showSection = function (id, navEl) {
      _originalShowSection(id, navEl);
      if (id === 'communications') initCommunications();
    };
  }
})();
