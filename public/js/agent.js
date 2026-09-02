/* ── ROCK Hub AI Agent — frontend ───────────────────────────────────────────── */
/* Injected on all board pages via hub-nav.js.                                   */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _open    = false;
  let _busy    = false;
  let _history = []; // [{role:'user'|'model', parts:[{text}]}]

  // ── DOM bootstrap ─────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('rock-agent-css')) return;
    const link = document.createElement('link');
    link.id   = 'rock-agent-css';
    link.rel  = 'stylesheet';
    link.href = '/css/agent.css';
    document.head.appendChild(link);
  }

  function buildFab() {
    const btn = document.createElement('button');
    btn.id    = 'rock-agent-fab';
    btn.title = 'Hub AI Assistant';
    btn.setAttribute('aria-label', 'Open Hub AI Assistant');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.7">
        <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z"/>
        <path d="M8 10h.01M12 10h.01M16 10h.01" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M12 16s-4-1-4-4h8c0 3-4 4-4 4z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
    return btn;
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'rock-agent-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Hub AI Assistant');
    panel.innerHTML = `
      <div class="agent-header">
        <div class="agent-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.8">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 10h.01M12 10h.01M16 10h.01" stroke-width="2.2" stroke-linecap="round"/>
            <path d="M12 15s-3-.8-3-3h6c0 2.2-3 3-3 3z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <div class="agent-header-title">Hub Assistant</div>
          <div class="agent-header-sub">Gemini AI · Read-only + compose</div>
        </div>
        <button class="agent-header-close" onclick="window._agentClose()" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="agent-messages" id="agent-msg-list"></div>
      <div class="agent-status-bar" id="agent-status-bar"></div>
      <div class="agent-input-bar">
        <textarea id="agent-input" rows="1" placeholder="Ask anything about Hub data…" onkeydown="window._agentKeydown(event)"></textarea>
        <button id="agent-send-btn" onclick="window._agentSend()" title="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="#14203a" stroke-width="2.2">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>`;
    document.body.appendChild(panel);

    // Auto-resize textarea
    const ta = document.getElementById('agent-input');
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    });

    return panel;
  }

  function buildToast() {
    if (document.getElementById('agent-toast')) return;
    const t = document.createElement('div');
    t.id = 'agent-toast';
    document.body.appendChild(t);
  }

  // ── Panel open/close ───────────────────────────────────────────────────────

  function togglePanel() {
    _open = !_open;
    const panel = document.getElementById('rock-agent-panel');
    panel.classList.toggle('open', _open);
    if (_open) {
      if (_history.length === 0) showWelcome();
      setTimeout(() => document.getElementById('agent-input')?.focus(), 220);
    }
  }

  window._agentClose = () => {
    _open = false;
    document.getElementById('rock-agent-panel')?.classList.remove('open');
  };

  // ── Welcome message ────────────────────────────────────────────────────────

  function showWelcome() {
    addMessage('model', `Hello! I'm your Hub assistant. I can help you:\n\n• **Answer questions** about events, contacts, volunteers, youth groups, and tasks\n• **Pre-fill forms** — just describe what you want to create\n• **Draft documents** — letters, reports, summaries\n• **Compose messages** — email or SMS with a confirm gate\n\nWhat would you like to do?`);
  }

  // ── Message rendering ──────────────────────────────────────────────────────

  function mdToHtml(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g,     '<em>$1</em>')
      .replace(/`(.*?)`/g,       '<code style="background:#0c1828;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/\n/g, '<br>');
  }

  function addMessage(role, text, actionCard) {
    const list = document.getElementById('agent-msg-list');
    if (!list) return;
    const div = document.createElement('div');
    div.className = `agent-msg ${role}`;
    div.innerHTML = `<div class="agent-bubble">${mdToHtml(text)}</div>`;
    if (actionCard) div.appendChild(actionCard);
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  function showThinking() {
    const list = document.getElementById('agent-msg-list');
    if (!list) return null;
    const div = document.createElement('div');
    div.className = 'agent-msg model agent-thinking';
    div.id = 'agent-thinking-el';
    div.innerHTML = `<div class="agent-bubble"><span class="agent-dots"><span></span><span></span><span></span></span> Thinking…</div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  function removeThinking() {
    document.getElementById('agent-thinking-el')?.remove();
  }

  function setStatus(text) {
    const el = document.getElementById('agent-status-bar');
    if (el) el.textContent = text;
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg, isError) {
    const el = document.getElementById('agent-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'show' + (isError ? ' error' : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.className = ''; }, 3500);
  }

  // ── Input handling ─────────────────────────────────────────────────────────

  window._agentKeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window._agentSend();
    }
  };

  window._agentSend = async function () {
    if (_busy) return;
    const ta  = document.getElementById('agent-input');
    const txt = ta?.value.trim();
    if (!txt) return;

    ta.value = '';
    ta.style.height = 'auto';
    _busy = true;
    document.getElementById('agent-send-btn').disabled = true;

    addMessage('user', txt);
    _history.push({ role: 'user', parts: [{ text: txt }] });

    const thinking = showThinking();

    try {
      const res  = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: _history }),
      });
      const data = await res.json();
      removeThinking();

      if (!res.ok) {
        addMessage('model', `Sorry, I ran into an error: ${data.error || 'Unknown error'}`);
        setStatus('');
        return;
      }

      const replyText = data.reply || '';
      _history.push({ role: 'model', parts: [{ text: replyText || '[action]' }] });

      if (data.action) {
        handleAction(data.action, replyText);
      } else {
        addMessage('model', replyText);
      }
      setStatus(`Model: ${data.model || 'Gemini'}`);
    } catch (err) {
      removeThinking();
      addMessage('model', 'Network error — please try again.');
    } finally {
      _busy = false;
      document.getElementById('agent-send-btn').disabled = false;
    }
  };

  // ── Action handlers ────────────────────────────────────────────────────────

  function handleAction(action, replyText) {
    switch (action.type) {
      case 'prefill_form':    renderPrefillAction(action.payload, replyText); break;
      case 'draft_document':  renderDraftAction(action.payload, replyText);   break;
      case 'compose_message': renderComposeAction(action.payload, replyText); break;
      default: addMessage('model', replyText || 'Done.');
    }
  }

  // ── Pre-fill form ──────────────────────────────────────────────────────────

  function renderPrefillAction(payload, replyText) {
    const { form, fields, summary } = payload;
    const label = { event: 'Create Event', contact: 'Create Contact', volunteer: 'Add Volunteer',
                    task: 'Create Task', youth_group: 'Add Youth Group' }[form] || 'Open Form';

    const card = document.createElement('div');
    card.className = 'agent-action-card';
    card.innerHTML = `
      <div class="agent-action-card-title">Form Pre-fill</div>
      <div style="font-size:12px;color:#8a9ab5;margin-bottom:10px;">${escHtml(summary || `Ready to pre-fill the ${form} form.`)}</div>
      <div class="agent-prefill-badge">${escHtml(label)}</div>
      <div class="agent-action-btns">
        <button class="agent-btn gold" onclick="window._agentExecutePrefill(${JSON.stringify(form).replace(/"/g,'&quot;')},${escJson(fields)})">Open &amp; Pre-fill Form</button>
        <button class="agent-btn ghost" onclick="this.closest('.agent-action-card').remove()">Dismiss</button>
      </div>`;
    const msgDiv = addMessage('model', replyText || summary || 'I\'ll pre-fill the form for you.', card);
  }

  window._agentExecutePrefill = function (form, fields) {
    if (window.location.pathname !== '/board') {
      sessionStorage.setItem('agentPrefill', JSON.stringify({ form, fields }));
      window.location.href = '/board?s=members';
      return;
    }
    _executePrefill(form, fields);
    showToast('Form pre-filled — review and submit when ready.');
  };

  function _executePrefill(form, fields) {
    const fill = (id, val) => {
      const el = document.getElementById(id);
      if (!el || val == null || val === '') return;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    switch (form) {
      case 'event':
        if (typeof openCreateEventModal === 'function') openCreateEventModal('');
        setTimeout(() => {
          fill('ce_name',        fields.EventName   || fields.name);
          fill('ce_desc',        fields.Description || fields.description);
          fill('ce_startDate',   fields.StartDate   || fields.start_date);
          fill('ce_endDate',     fields.EndDate     || fields.end_date);
          fill('ce_startTime',   fields.StartTime   || fields.start_time);
          fill('ce_endTime',     fields.EndTime     || fields.end_time);
          fill('ce_location',    fields.Location    || fields.location);
          fill('ce_address',     fields.Address     || fields.address);
          fill('ce_capacity',    fields.MaxCapacity || fields.capacity);
          fill('ce_coordName',   fields.Coordinator || fields.coordinator);
          fill('ce_coordEmail',  fields.CoordinatorEmail || fields.coordinator_email);
          if (fields.EventType || fields.type) fill('ce_type', fields.EventType || fields.type);
        }, 120);
        break;

      case 'contact':
        if (typeof openContactModal === 'function') openContactModal(null);
        setTimeout(() => {
          fill('cm_first', fields.FirstName || fields.first_name);
          fill('cm_last',  fields.LastName  || fields.last_name);
          fill('cm_email', fields.Email     || fields.email);
          fill('cm_phone', fields.Phone     || fields.phone);
          fill('cm_tags',  fields.Tags      || fields.tags);
          fill('cm_notes', fields.Notes     || fields.notes);
          if (fields.MembershipType || fields.membership_type) fill('cm_type', fields.MembershipType || fields.membership_type);
        }, 120);
        break;

      case 'volunteer':
        if (typeof openAddVolModal === 'function') openAddVolModal();
        setTimeout(() => {
          fill('av_first', fields.FirstName || fields.first_name);
          fill('av_last',  fields.LastName  || fields.last_name);
          fill('av_email', fields.Email     || fields.email);
          fill('av_phone', fields.Phone     || fields.phone);
          fill('av_role',  fields.PreferredRole || fields.role);
          fill('av_avail', fields.Availability  || fields.availability);
          fill('av_notes', fields.Notes     || fields.notes);
        }, 120);
        break;

      case 'task':
        if (typeof openCreateTaskModal === 'function') openCreateTaskModal();
        setTimeout(() => {
          fill('ct_title', fields.Title    || fields.title);
          fill('ct_desc',  fields.Description || fields.description);
          fill('ct_due',   fields.DueDate  || fields.due_date);
          if (fields.Priority || fields.priority) fill('ct_priority', fields.Priority || fields.priority);
        }, 200);
        break;

      case 'youth_group':
        if (typeof openYGModal === 'function') openYGModal(null);
        setTimeout(() => {
          fill('yg_name',    fields.youth_group_name || fields.name);
          fill('yg_church',  fields.church_name      || fields.church);
          fill('yg_address', fields.address);
          fill('yg_city',    fields.city);
          fill('yg_state',   fields.state);
          fill('yg_zip',     fields.zip);
          if (fields.category) fill('yg_category', fields.category);
          fill('yg_instagram_handle', fields.instagram_handle || fields.instagram);
        }, 120);
        break;

      default:
        showToast('Unsupported form type: ' + form, true);
    }
  }

  // ── Draft document ─────────────────────────────────────────────────────────

  function renderDraftAction(payload, replyText) {
    const { title, content, summary } = payload;
    let editing = false;

    const card = document.createElement('div');
    card.className = 'agent-action-card';
    card.innerHTML = `
      <div class="agent-action-card-title">Draft Document</div>
      <div style="font-size:12px;font-weight:600;color:#c8d8ee;margin-bottom:6px;">${escHtml(title)}</div>
      <div class="agent-draft-body">${content}</div>
      <textarea class="agent-compose-edit" id="agent-draft-edit-${Date.now()}" style="display:none;">${stripHtml(content)}</textarea>
      <div class="agent-action-btns">
        <button class="agent-btn gold" onclick="window._agentExportPdf(this,${escJson(title)},${escJson(content)})">Export PDF</button>
        <button class="agent-btn ghost" onclick="window._agentToggleDraftEdit(this)">Edit</button>
        <button class="agent-btn ghost" onclick="window._agentCopyDraft(${escJson(content)})">Copy</button>
        <button class="agent-btn danger" onclick="this.closest('.agent-action-card').remove()">Dismiss</button>
      </div>`;
    addMessage('model', replyText || summary || `Here's your draft: ${title}`, card);
  }

  window._agentToggleDraftEdit = function (btn) {
    const card   = btn.closest('.agent-action-card');
    const view   = card.querySelector('.agent-draft-body');
    const editor = card.querySelector('.agent-compose-edit');
    if (!editor) return;
    if (editor.style.display === 'none') {
      editor.value = view.innerText;
      editor.style.display = 'block';
      view.style.display   = 'none';
      btn.textContent      = 'Preview';
    } else {
      view.innerHTML     = editor.value.replace(/\n/g, '<br>');
      editor.style.display = 'none';
      view.style.display   = 'block';
      btn.textContent      = 'Edit';
    }
  };

  window._agentExportPdf = async function (btn, title, content) {
    btn.disabled    = true;
    btn.textContent = 'Generating…';
    try {
      const res = await fetch('/api/agent/draft-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) { showToast('PDF error — ' + (await res.json()).error, true); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = (title || 'draft') + '.pdf'; a.click();
      URL.revokeObjectURL(url);
      showToast('PDF downloaded.');
    } catch (e) {
      showToast('PDF generation failed.', true);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Export PDF';
    }
  };

  window._agentCopyDraft = function (content) {
    navigator.clipboard?.writeText(stripHtml(content)).then(() => showToast('Copied to clipboard.'));
  };

  // ── Compose / confirm gate ─────────────────────────────────────────────────

  function renderComposeAction(payload, replyText) {
    const { channel, recipients, subject, body: msgBody, summary } = payload;
    const channelLabel = channel === 'sms' ? 'SMS' : 'Email';
    const subjectHtml  = (channel === 'email' && subject)
      ? `<div style="font-size:11px;color:#8a9ab5;margin-bottom:4px;">Subject: <strong style="color:#c8d8ee;">${escHtml(subject)}</strong></div>`
      : '';

    const recipientRows = (recipients || []).map(r =>
      `<div class="r-row">${escHtml(r.name)} <span style="color:#4a6a8a;">→ ${escHtml(r.to)}</span></div>`
    ).join('');

    const uniqueId = Date.now();

    const card = document.createElement('div');
    card.className = 'agent-action-card';
    card.innerHTML = `
      <div class="agent-action-card-title">Compose ${escHtml(channelLabel)} — Confirm Gate</div>
      ${subjectHtml}
      <div style="font-size:10px;color:#8a9ab5;margin-bottom:3px;text-transform:uppercase;letter-spacing:.06em;">${recipients.length} Recipient${recipients.length !== 1 ? 's' : ''}</div>
      <div class="agent-compose-recipients">${recipientRows}</div>
      <div style="font-size:10px;color:#8a9ab5;margin-bottom:3px;text-transform:uppercase;letter-spacing:.06em;">Message</div>
      <div class="agent-compose-body-preview" id="agent-compose-view-${uniqueId}">${escHtml(msgBody)}</div>
      <textarea class="agent-compose-edit" id="agent-compose-edit-${uniqueId}">${escHtml(msgBody)}</textarea>
      <div class="agent-action-btns">
        <button class="agent-btn gold" id="agent-send-confirm-${uniqueId}"
          onclick="window._agentConfirmSend(this,${escJson(channel)},${escJson(recipients)},${escJson(subject||'')},${escJson('view-'+uniqueId)})">
          Send ${escHtml(channelLabel)}
        </button>
        <button class="agent-btn ghost" onclick="window._agentToggleComposeEdit(${uniqueId})">Edit</button>
        <button class="agent-btn danger" onclick="this.closest('.agent-action-card').remove()">Cancel</button>
      </div>
      <div style="font-size:10px;color:#4a5a75;margin-top:8px;">⚠ This will send a real ${escHtml(channelLabel.toLowerCase())}. Confirm carefully.</div>`;
    addMessage('model', replyText || summary || `Ready to send ${channelLabel} to ${recipients.length} recipient(s).`, card);
  }

  window._agentToggleComposeEdit = function (uid) {
    const view   = document.getElementById(`agent-compose-view-${uid}`);
    const editor = document.getElementById(`agent-compose-edit-${uid}`);
    if (!view || !editor) return;
    if (editor.style.display === 'none' || !editor.style.display) {
      editor.style.display = 'block';
      view.style.display   = 'none';
    } else {
      view.textContent     = editor.value;
      editor.style.display = 'none';
      view.style.display   = 'block';
    }
  };

  window._agentConfirmSend = async function (btn, channel, recipients, subject, viewId) {
    const viewEl  = document.getElementById('agent-compose-' + viewId);
    const editEl  = viewEl?.nextElementSibling; // textarea
    const msgBody = (editEl && editEl.tagName === 'TEXTAREA' && editEl.style.display !== 'none')
      ? editEl.value.trim()
      : (viewEl?.textContent?.trim() || '');

    if (!msgBody) { showToast('Message body is empty.', true); return; }

    btn.disabled    = true;
    btn.textContent = 'Sending…';

    try {
      const res  = await fetch('/api/agent/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, recipients, subject, body: msgBody }),
      });
      const data = await res.json();

      if (!res.ok) { showToast(data.error || 'Send failed.', true); return; }

      const label = channel === 'sms' ? 'SMS' : 'email';
      let msg = `Sent ${data.sent} ${label}${data.sent !== 1 ? 's' : ''} of ${data.total}.`;
      if (data.failed?.length) {
        msg += ` Could not reach: ${data.failed.map(f => f.name).join(', ')}.`;
      }
      showToast(msg);

      // Add result to chat history
      _history.push({ role: 'user', parts: [{ text: `(User confirmed send) Result: ${msg}` }] });
      addMessage('model', msg);

      // Remove the compose card
      btn.closest('.agent-action-card').remove();
    } catch (e) {
      showToast('Network error — send failed.', true);
    } finally {
      if (btn.isConnected) {
        btn.disabled    = false;
        btn.textContent = 'Send ' + (channel === 'sms' ? 'SMS' : 'Email');
      }
    }
  };

  // ── Utilities ──────────────────────────────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function stripHtml(s) {
    return String(s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ');
  }
  function escJson(val) {
    return JSON.stringify(val).replace(/"/g, '&quot;');
  }

  // ── Pending prefill from cross-page navigation ─────────────────────────────

  function checkPendingPrefill() {
    const raw = sessionStorage.getItem('agentPrefill');
    if (!raw) return;
    sessionStorage.removeItem('agentPrefill');
    try {
      const { form, fields } = JSON.parse(raw);
      // Wait for board.js to finish loading its data
      setTimeout(() => {
        _executePrefill(form, fields);
        if (!_open) togglePanel();
        addMessage('model', `I've pre-filled the ${form} form — please review and submit.`);
        showToast('Form pre-filled from your request.');
      }, 2500);
    } catch (_) {}
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    injectStyles();
    buildToast();
    buildFab();
    buildPanel();
    checkPendingPrefill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
