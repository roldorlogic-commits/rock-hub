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

function timeToMinutes(t) {
  if (!t) return -1;
  const [h, m] = t.split(':').map(Number);
  return isNaN(h) ? -1 : h * 60 + (m || 0);
}

// ── Day-grouping ──────────────────────────────────────────────────────────────
// Inserts a day-header row whenever itinerary items cross midnight.
// dayOffset tracks how many midnight boundaries have been passed.

function groupItemsByDay(items, startDate) {
  if (!items.length) return [];

  const rows = [];
  let prevMins    = -1;
  let dayOffset   = 0;
  let lastDayLabel = null;

  for (const item of items) {
    const mins = timeToMinutes(item.Time);

    // Midnight rollover: time jumped backward AND landed in early-AM hours
    if (prevMins >= 0 && mins >= 0 && mins < prevMins && mins < 360) {
      dayOffset++;
    }

    const d = new Date(startDate + 'T12:00:00');
    d.setDate(d.getDate() + dayOffset);
    const dayLabel = d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    if (dayLabel !== lastDayLabel) {
      lastDayLabel = dayLabel;
      rows.push({ isDayHeader: true, label: dayLabel });
    }
    rows.push({ isDayHeader: false, item });

    if (mins >= 0) prevMins = mins;
  }

  return rows;
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(ev, items) {
  const logoSrc = getLogoB64();

  // Subtitle: date · time · venue · address
  const dateStr = fmtDate(ev.StartDate);
  const timeStr = ev.StartTime ? fmtTime(ev.StartTime) : '';
  const metaBits = [dateStr, timeStr, ev.Location, ev.Address].filter(Boolean);
  const metaLine = metaBits.map(escHtml).join(' &nbsp;·&nbsp; ');

  // Grouped rows (inserts day-header rows at day boundaries)
  const grouped = groupItemsByDay(items, ev.StartDate || '');
  const rows = grouped.map((row, i) => {
    if (row.isDayHeader) {
      // Keep day header glued to the item that follows it
      return `<div class="day-header">${escHtml(row.label)}</div>`;
    }
    const { item } = row;
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

/* ── ROCK logo watermark — position:fixed repeats it on every printed page ─ */
.watermark-logo {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 54%;
  opacity: 0.09;
  z-index: 0;
  pointer-events: none;
}

/* ── Content — no top/bottom margin here; puppeteer margins handle page space */
.content {
  position: relative; z-index: 1;
  padding: 22px 40px 20px;
}

.event-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 21px; font-weight: 700; color: #14203a; line-height: 1.2;
  margin-bottom: 7px;
}
.event-meta {
  font-size: 11px; color: #5a6474; margin-bottom: 22px;
  line-height: 1.6;
}

.section-label {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.2em;
  text-transform: uppercase; color: #C9A96E;
  border-bottom: 1.5px solid #ddd3bf; padding-bottom: 5px; margin-bottom: 2px;
}

/* ── Day header (inserted at midnight boundary) ───────── */
.day-header {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: #14203a;
  background: #f5f0e8;
  padding: 5px 10px; margin-top: 12px;
  border-left: 3px solid #C9A96E;
  page-break-after: avoid; break-after: avoid;
}

/* ── Itinerary row ─────────────────────────────────────── */
.itn-row {
  display: flex; align-items: flex-start;
  padding: 8px 0; border-bottom: 1px solid #ede8de;
  page-break-inside: avoid; break-inside: avoid;
}
.itn-time {
  color: #C9A96E; font-weight: 700; font-size: 11px;
  min-width: 78px; padding-top: 2px; flex-shrink: 0;
}
.itn-body { flex: 1; }
.itn-title { font-weight: 700; font-size: 12.5px; color: #14203a; line-height: 1.3; }
.itn-notes { font-size: 10.5px; color: #6b7280; font-style: italic; margin-top: 3px; line-height: 1.4; }
.empty { color: #6b7280; font-size: 11px; padding-top: 14px; }
</style>
</head>
<body>

<!-- ROCK logo watermark (position:fixed → repeats centered on every printed page) -->
<img class="watermark-logo" src="${logoSrc}" alt="">

<!-- Content (flows between puppeteer header/footer margins — no fixed overlays needed) -->
<div class="content">
  <h1 class="event-title">${escHtml(ev.EventName || 'Event Itinerary')}</h1>
  ${metaLine ? `<p class="event-meta">${metaLine}</p>` : ''}
  <div class="section-label">Run of Show</div>
  ${rows || '<p class="empty">No itinerary items.</p>'}
</div>

</body>
</html>`;
}

// ── Puppeteer header / footer templates ───────────────────────────────────────
// These render in an isolated Chrome context with no access to the page's CSS.
// All styling must be inline. Fonts fall back to system (Georgia).
// <span class="pageNumber"> and <span class="totalPages"> are injected by Chrome.

function buildHeaderTemplate(logoSrc) {
  return `<div style="width:100%;margin:0;padding:0;font-size:0;-webkit-print-color-adjust:exact;">
  <div style="height:62px;background:#14203a;display:flex;align-items:center;
              justify-content:space-between;padding:0 34px;width:100%;box-sizing:border-box;">
    <div style="font-family:Georgia,'Times New Roman',serif;color:#fff;font-size:11px;
                font-weight:bold;letter-spacing:0.1em;text-transform:uppercase;line-height:1.35;">
      The ROCK Association
      <span style="display:block;font-size:8px;font-weight:normal;color:#C9A96E;
                   letter-spacing:0.2em;margin-top:2px;">
        Recruiting &nbsp;&middot;&nbsp; Training &nbsp;&middot;&nbsp; Empowering
      </span>
    </div>
    <img style="height:44px;width:auto;" src="${logoSrc}">
  </div>
  <div style="height:3px;background:#C9A96E;width:100%;"></div>
</div>`;
}

function buildFooterTemplate(logoSrc) {
  return `<div style="width:100%;margin:0;padding:0;font-size:0;-webkit-print-color-adjust:exact;">
  <div style="height:50px;background:#14203a;display:flex;align-items:center;justify-content:center;
              gap:12px;padding:0 28px;box-sizing:border-box;width:100%;">
    <img style="height:32px;width:auto;opacity:0.85;flex-shrink:0;" src="${logoSrc}">
    <div style="color:#C9A96E;font-family:Georgia,'Times New Roman',serif;font-size:7px;
                font-weight:normal;letter-spacing:0.04em;text-align:center;line-height:1.5;
                max-width:320px;flex:1;">
      Recruiting, Training and empowering ambassadors for Christ to lead with faith
      and transform their communities.
    </div>
    <div style="color:#C9A96E;font-family:Georgia,'Times New Roman',serif;font-size:8px;
                white-space:nowrap;flex-shrink:0;">
      Page <span class="pageNumber" style="color:#C9A96E;"></span>
      &nbsp;of&nbsp;
      <span class="totalPages" style="color:#C9A96E;"></span>
    </div>
  </div>
</div>`;
}

// ── Browser lifecycle ─────────────────────────────────────────────────────────

let _browser = null;

async function getBrowser() {
  if (_browser?.connected) return _browser;

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
  const logoSrc = getLogoB64();
  const html    = buildHtml(ev, items);

  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise(r => setTimeout(r, 8000)),
    ]);
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: buildHeaderTemplate(logoSrc),
      footerTemplate: buildFooterTemplate(logoSrc),
      // Top margin = 62px header + 3px gold rule + 5px breathing room
      // Bottom margin = 50px footer + 4px breathing room
      margin: { top: '70px', bottom: '54px', left: '0', right: '0' },
    });
  } finally {
    await page.close();
  }
}

module.exports = { generateItineraryPdf };
