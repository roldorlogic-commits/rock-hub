/* Social Feed Page */

const SCHEDULED_KEY = 'rock_scheduled_posts';

(async () => {
  await initUser();
  wireComposer();
  loadScheduled();
  await loadInstagram();
  await loadPartnerFeed();
})();

// ── Composer ─────────────────────────────────────────────────────────────────
function wireComposer() {
  const ta  = document.getElementById('postText');
  const cnt = document.getElementById('charCount');
  if (ta) {
    ta.addEventListener('input', () => {
      const n = ta.value.length;
      cnt.textContent = `${n} / 2200`;
      cnt.className   = 'char-count' + (n > 2100 ? ' over' : n > 1800 ? ' warn' : '');
    });
  }
  // Platform toggles
  ['FB','IG'].forEach(p => {
    const t = document.getElementById(`toggle${p}`);
    if (!t) return;
    t.addEventListener('click', () => t.classList.toggle('active'));
  });
}

function handleMedia(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('mediaImg').src = e.target.result;
    document.getElementById('mediaPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function clearMedia() {
  document.getElementById('mediaInput').value = '';
  document.getElementById('mediaImg').src     = '';
  document.getElementById('mediaPreview').style.display = 'none';
}

function getPostData() {
  return {
    text:      document.getElementById('postText').value.trim(),
    schedTime: document.getElementById('scheduleTime').value,
    fb:        document.getElementById('toggleFB')?.classList.contains('active'),
    ig:        document.getElementById('toggleIG')?.classList.contains('active'),
    mediaUrl:  document.getElementById('mediaImg').src || null
  };
}

async function publishPost() {
  const { text, fb, ig } = getPostData();
  if (!text) { alert('Please write something first.'); return; }

  // If Meta API configured, try to post
  try {
    const res = await fetch('/social/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, facebook: fb, instagram: ig })
    });
    if (res.ok) { alert('Post published!'); clearComposer(); return; }
  } catch (_) {}

  // Fallback: show alert
  alert(`Post ready to publish!\n\nPlatforms: ${[fb&&'Facebook', ig&&'Instagram'].filter(Boolean).join(', ') || 'None selected'}\n\nConnect META_ACCESS_TOKEN + META_PAGE_ID in .env to enable live publishing.`);
}

function schedulePost() {
  const { text, schedTime } = getPostData();
  if (!text)      { alert('Please write something.'); return; }
  if (!schedTime) { alert('Please pick a date/time to schedule.'); return; }

  const posts = JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '[]');
  posts.push({
    id: Date.now(),
    text,
    schedTime,
    fb: document.getElementById('toggleFB')?.classList.contains('active'),
    ig: document.getElementById('toggleIG')?.classList.contains('active'),
    status: 'Scheduled',
    created: new Date().toISOString()
  });
  localStorage.setItem(SCHEDULED_KEY, JSON.stringify(posts));
  clearComposer();
  loadScheduled();
}

function clearComposer() {
  document.getElementById('postText').value = '';
  document.getElementById('charCount').textContent = '0 / 2200';
  document.getElementById('scheduleTime').value = '';
  clearMedia();
}

// ── Scheduled Posts ───────────────────────────────────────────────────────────
function loadScheduled() {
  const grid  = document.getElementById('scheduledGrid');
  const posts = JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '[]');

  if (!posts.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:24px;height:24px;margin:0 auto 8px;display:block;color:var(--gold-line)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>No scheduled posts. Use the composer above to schedule a post.</p>
      </div>`;
    return;
  }

  grid.innerHTML = posts.map(p => {
    const platforms = [p.fb&&'Facebook', p.ig&&'Instagram'].filter(Boolean).join(' · ') || 'No platform';
    const dt = p.schedTime ? new Date(p.schedTime).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
    return `
      <div class="scheduled-card">
        <div class="scheduled-platform">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:14px;height:14px;color:var(--gold)"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          <span class="scheduled-time">${platforms}</span>
        </div>
        <div class="scheduled-preview">${p.text}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
          <div class="scheduled-status">
            <span class="status-dot"></span>
            ${p.status}
          </div>
          <span style="font-size:10px;color:var(--text-muted);">${dt}</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="deletePost(${p.id})" style="padding:4px 8px;font-size:10px;">Remove</button>
        </div>
      </div>`;
  }).join('');
}

function deletePost(id) {
  const posts = JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '[]').filter(p => p.id !== id);
  localStorage.setItem(SCHEDULED_KEY, JSON.stringify(posts));
  loadScheduled();
}

// ── Instagram Feed ────────────────────────────────────────────────────────────
async function loadInstagram() {
  const grid    = document.getElementById('igGrid');
  const notice  = document.getElementById('apiNotice');

  try {
    const data = await apiFetch('/social/instagram');

    if (!data.configured) {
      if (notice) notice.style.display = 'block';
      grid.innerHTML = `<div class="ig-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:24px;height:24px;margin:0 auto 8px;display:block;color:var(--gold-line)"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
        <p>Add INSTAGRAM_ACCESS_TOKEN to .env to display your Instagram feed.</p>
      </div>`;
      return;
    }

    const posts = data.data || [];
    const acctEl = document.getElementById('igAccount');
    if (acctEl && data.username) acctEl.textContent = `@${data.username}`;

    if (!posts.length) {
      grid.innerHTML = '<div class="ig-empty"><p>No Instagram posts found.</p></div>';
      return;
    }

    grid.innerHTML = posts.slice(0, 9).map(p => {
      const thumb = p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url;
      const cap   = (p.caption || '').slice(0, 120);
      return `
        <a class="ig-post" href="${p.permalink}" target="_blank" rel="noopener">
          <img src="${thumb}" alt="Instagram post" loading="lazy">
          <div class="ig-overlay"><p>${cap}</p></div>
        </a>`;
    }).join('');

  } catch (e) {
    grid.innerHTML = '<div class="ig-empty"><p>Could not load Instagram feed.</p></div>';
  }
}

// ── Partner Feed ──────────────────────────────────────────────────────────────

async function loadPartnerFeed() {
  const grid    = document.getElementById('partnerGrid');
  const countEl = document.getElementById('partnerCount');
  try {
    const raw = await apiFetch('/social/partners');
    // Sort: partners with posts first (most posts → fewest), then alphabetically
    const partners = [...raw].sort((a, b) => {
      if (!!a.posts.length !== !!b.posts.length) return b.posts.length - a.posts.length;
      return (a.name || a.handle).localeCompare(b.name || b.handle);
    });
    if (countEl) countEl.textContent = `${partners.length} partners`;
    grid.innerHTML = partners.map(p => renderPartnerCard(p)).join('');
  } catch (e) {
    grid.innerHTML = '<div style="grid-column:1/-1;color:var(--text-muted);font-size:12px;padding:16px;">Could not load partners.</div>';
  }
}

function renderPartnerCard(partner) {
  const initial    = (partner.name || partner.handle || '?')[0].toUpperCase();
  const igUrl      = `https://www.instagram.com/${partner.handle}/`;
  const supportUrl = partner.posts[0] || igUrl;

  const postsHtml = partner.posts.length
    ? `<div class="partner-posts">
        <div class="partner-posts-scroll">
          ${partner.posts.map(url => postEmbedHtml(partner.id, url)).join('')}
        </div>
       </div>`
    : `<div class="partner-posts">
        <div class="partner-preview-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          No post added yet
        </div>
       </div>`;

  return `
    <div class="partner-card" id="partner-${partner.id}">
      <div class="partner-card-head">
        <div class="partner-avatar">${initial}</div>
        <div class="partner-info">
          <div class="partner-name">${partner.name}</div>
          <div class="partner-handle">
            <a href="${igUrl}" target="_blank" rel="noopener">@${partner.handle}</a>
          </div>
          ${partner.location ? `<div class="partner-location">${partner.location}</div>` : ''}
        </div>
        <a href="${igUrl}" target="_blank" rel="noopener" class="icon-btn" title="Open Instagram profile" style="flex-shrink:0;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:14px;height:14px;"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
        </a>
      </div>
      ${partner.description ? `<div class="partner-desc">${partner.description}</div>` : ''}
      ${postsHtml}
      <div class="partner-card-footer">
        <a href="${supportUrl}" target="_blank" rel="noopener" class="partner-support-btn">Support ↗</a>
        <div class="partner-add-row">
          <input
            class="partner-add-input"
            id="input-${partner.id}"
            type="url"
            placeholder="https://www.instagram.com/p/…  or  /reel/…"
            onkeydown="if(event.key==='Enter') addPartnerPost('${partner.id}')"
          >
          <button class="partner-add-btn" onclick="addPartnerPost('${partner.id}')">+ Add</button>
        </div>
      </div>
    </div>`;
}

// Render an embedded post iframe (Instagram's native embed URL — no API needed)
function postEmbedHtml(partnerId, postUrl) {
  // Extract shortcode from URL patterns:
  //   /p/SHORTCODE/   /reel/SHORTCODE/   /tv/SHORTCODE/
  const match = postUrl.match(/instagram\.com\/(p|reel|tv)\/([^/?#]+)/);
  if (!match) return '';
  const shortcode = match[2];
  const embedSrc  = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

  return `
    <div class="partner-post-wrap">
      <div class="partner-post-iframe">
        <iframe
          src="${embedSrc}"
          scrolling="no"
          allowtransparency="true"
          loading="lazy"
          title="Instagram post"
        ></iframe>
      </div>
      <button
        class="partner-post-remove"
        onclick="removePartnerPost('${partnerId}', '${postUrl}')"
        title="Remove post"
      >✕</button>
    </div>`;
}

async function addPartnerPost(partnerId) {
  const input = document.getElementById(`input-${partnerId}`);
  const url   = input?.value?.trim();
  if (!url) return;

  if (!/instagram\.com\/(p|reel|tv)\//.test(url)) {
    alert('Please paste a full Instagram post, reel, or TV URL.\nExample: https://www.instagram.com/p/SHORTCODE/');
    return;
  }

  input.disabled = true;
  try {
    const res = await fetch(`/social/partners/${partnerId}/posts`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url })
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Could not add post.');
      return;
    }
    input.value = '';
    await loadPartnerFeed(); // re-render all cards
  } catch (e) {
    alert('Network error — could not save post.');
  } finally {
    input.disabled = false;
  }
}

async function removePartnerPost(partnerId, postUrl) {
  if (!confirm('Remove this post from the partner feed?')) return;
  try {
    await fetch(`/social/partners/${partnerId}/posts?url=${encodeURIComponent(postUrl)}`, {
      method: 'DELETE'
    });
    await loadPartnerFeed();
  } catch (e) {
    alert('Could not remove post.');
  }
}
