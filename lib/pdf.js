'use strict';

const puppeteer = require('puppeteer-core');
const fs        = require('fs');
const path      = require('path');

// ── Asset caching ─────────────────────────────────────────────────────────────

let _logoB64 = null;
function getLogoB64() {
  if (!_logoB64) {
    const buf = fs.readFileSync(path.join(__dirname, '../public/img/rock-logo.png'));
    _logoB64 = `data:image/png;base64,${buf.toString('base64')}`;
  }
  return _logoB64;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T12:00:00');
  if (isNaN(d)) return str;
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(ev, items) {
  const logoSrc = getLogoB64();

  const dateStr = fmtDate(ev.StartDate);
  const timeStr = ev.StartTime ? fmtTime(ev.StartTime) : '';
  const metaParts = [dateStr, timeStr].filter(Boolean).join(' · ');
  const loc = ev.Location ? ` &nbsp;·&nbsp; ${escHtml(ev.Location)}` : '';

  const rows = items.map(item => {
    const t = item.Time ? fmtTime(item.Time) : '';
    return `<div class="itn-row">
      <div class="itn-time">${escHtml(t)}</div>
      <div class="itn-body">
        <div class="itn-title">${escHtml(item.Title)}</div>
        ${item.Notes ? `<div class="itn-notes">${escHtml(item.Notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Lato:ital,wght@0,300;0,400;0,700;1,300&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #fff; color: #14203a; font-family: 'Lato', Georgia, serif; }

/* ── Repeating fixed header ─────────────────────────────── */
.page-header {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  height: 62px; background: #14203a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 34px;
}
.header-brand {
  font-family: 'Cinzel', Georgia, serif; color: #fff;
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.12em;
  text-transform: uppercase; line-height: 1.35;
}
.header-brand .sub {
  display: block; font-size: 8.5px; font-weight: 400;
  color: #C9A96E; letter-spacing: 0.22em; margin-top: 2px;
}
.header-logo { height: 46px; width: auto; }
.header-rule {
  position: fixed; top: 62px; left: 0; right: 0; z-index: 100;
  height: 3px; background: #C9A96E;
}

/* ── Repeating fixed footer ─────────────────────────────── */
.page-footer {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
  height: 48px; background: #14203a;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 0 34px;
}
.footer-mark { height: 34px; width: auto; flex-shrink: 0; opacity: 0.88; }
.footer-tagline {
  color: #C9A96E; font-size: 7.5px; font-weight: 300;
  letter-spacing: 0.04em; text-align: center; line-height: 1.5;
  max-width: 380px;
}

/* ── ROCK logo watermark (centered in body, repeats per page) */
.watermark-logo {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 54%;
  opacity: 0.09;
  z-index: 0;
  pointer-events: none;
}

/* ── Content ────────────────────────────────────────────── */
.content {
  position: relative; z-index: 1;
  margin-top: 81px;   /* 62px header + 3px rule + 16px gap */
  margin-bottom: 60px; /* 48px footer + 12px gap */
  padding: 24px 40px 28px;
}

.event-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 21px; font-weight: 700; color: #14203a; line-height: 1.2;
  margin-bottom: 7px;
}
.event-meta { font-size: 11.5px; color: #5a6474; margin-bottom: 24px; line-height: 1.5; }

.section-label {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.2em;
  text-transform: uppercase; color: #C9A96E;
  border-bottom: 1.5px solid #ddd3bf; padding-bottom: 5px; margin-bottom: 2px;
}

/* ── Itinerary row ──────────────────────────────────────── */
.itn-row {
  display: flex; align-items: flex-start;
  padding: 9px 0; border-bottom: 1px solid #ede8de;
  page-break-inside: avoid; break-inside: avoid;
}
.itn-time {
  color: #C9A96E; font-weight: 700; font-size: 11px;
  min-width: 80px; padding-top: 2px; flex-shrink: 0; letter-spacing: 0.01em;
}
.itn-body { flex: 1; }
.itn-title { font-weight: 700; font-size: 12.5px; color: #14203a; line-height: 1.3; }
.itn-notes { font-size: 10.5px; color: #6b7280; font-style: italic; margin-top: 3px; line-height: 1.4; }
.empty { color: #6b7280; font-size: 11px; padding-top: 14px; }
</style>
</head>
<body>

<!-- Fixed header -->
<div class="page-header">
  <div class="header-brand">
    The ROCK Association
    <span class="sub">Recruiting &nbsp;·&nbsp; Training &nbsp;·&nbsp; Empowering</span>
  </div>
  <img class="header-logo" src="${logoSrc}" alt="The ROCK Association">
</div>
<div class="header-rule"></div>

<!-- Fixed footer -->
<div class="page-footer">
  <img class="footer-mark" src="${logoSrc}" alt="">
  <div class="footer-tagline">Recruiting, Training and empowering ambassadors for Christ to lead with faith and transform their communities.</div>
</div>

<!-- ROCK logo watermark centered in body -->
<img class="watermark-logo" src="${logoSrc}" alt="">

<!-- Content -->
<div class="content">
  <h1 class="event-title">${escHtml(ev.EventName || 'Event Itinerary')}</h1>
  ${metaParts || loc ? `<p class="event-meta">${metaParts}${loc}</p>` : ''}
  <div class="section-label">Run of Show</div>
  ${rows || '<p class="empty">No itinerary items.</p>'}
</div>

</body>
</html>`;
}

// ── Browser lifecycle ─────────────────────────────────────────────────────────

let _browser = null;

async function getBrowser() {
  if (_browser?.connected) return _browser;

  // Resolve Chrome/Chromium executable
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH
    || (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : '/usr/bin/chromium-browser');

  _browser = await puppeteer.launch({
    executablePath: execPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function generateItineraryPdf(ev, items) {
  const html    = buildHtml(ev, items);
  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    // Wait for web fonts to finish loading (max 8s — fall back to system fonts if CDN is slow)
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise(r => setTimeout(r, 8000)),
    ]);
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await page.close();
  }
}

module.exports = { generateItineraryPdf };
