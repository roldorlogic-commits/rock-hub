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
  let lastDayLabel = null;

  for (const item of items) {
    // Use the stored ItemDate when present; fall back to startDate
    const dateStr = (item.ItemDate && item.ItemDate.length === 10) ? item.ItemDate : startDate;
    const dayLabel = dateStr
      ? new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        })
      : null;

    if (dayLabel && dayLabel !== lastDayLabel) {
      lastDayLabel = dayLabel;
      rows.push({ isDayHeader: true, label: dayLabel });
    }
    rows.push({ isDayHeader: false, item });
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
  const rows = grouped.map(row => {
    if (row.isDayHeader) {
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

/* ── Page header — position:fixed repeats on every printed page ── */
.ph {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.ph-band {
  height: 62px; background-color: #14203a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 36px; box-sizing: border-box;
}
.ph-text {
  font-family: Georgia, 'Times New Roman', serif; color: #ffffff;
  font-size: 11px; font-weight: bold; letter-spacing: 0.09em;
  text-transform: uppercase; line-height: 1.4; flex: 1;
}
.ph-sub {
  display: block; font-size: 7.5px; font-weight: normal; color: #C9A96E;
  letter-spacing: 0.18em; margin-top: 3px;
}
.ph-logo { height: 46px; width: auto; display: block; flex-shrink: 0; }
.ph-rule { height: 3px; background-color: #C9A96E; }

/* ── Page footer — position:fixed at bottom ── */
.pf {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
  height: 50px; background-color: #14203a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 28px; box-sizing: border-box;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.pf-logo { height: 30px; width: auto; display: block; flex-shrink: 0; }
.pf-text {
  color: #ffffff; font-family: Georgia, 'Times New Roman', serif;
  font-size: 7px; letter-spacing: 0.05em; text-align: center;
  flex: 1; padding: 0 18px; line-height: 1.4;
}

/* ── Watermark — position:fixed repeats centered on every printed page ── */
.wm {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 54%; opacity: 0.09; z-index: 0; pointer-events: none;
}

/* ── Body content — push text below fixed header and above fixed footer ── */
.content {
  position: relative; z-index: 1;
  /* top: header band (65px) + breathing room; bottom: footer band (50px) + breathing room */
  padding: 75px 40px 60px;
}

.event-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 21px; font-weight: 700; color: #14203a; line-height: 1.2;
  margin-bottom: 7px;
}
.event-meta {
  font-size: 11px; color: #5a6474; margin-bottom: 22px; line-height: 1.6;
}
.section-label {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.2em;
  text-transform: uppercase; color: #C9A96E;
  border-bottom: 1.5px solid #ddd3bf; padding-bottom: 5px; margin-bottom: 2px;
}

/* ── Day header ── */
.day-header {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: #14203a;
  background: #f5f0e8;
  padding: 5px 10px; margin-top: 12px;
  border-left: 3px solid #C9A96E;
  page-break-after: avoid; break-after: avoid;
}

/* ── Itinerary rows ── */
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

<!-- Header band (position:fixed — renders flush at top of EVERY page) -->
<div class="ph">
  <div class="ph-band">
    <div class="ph-text">
      The ROCK Association
      <span class="ph-sub">Recruiting &nbsp;&middot;&nbsp; Training &nbsp;&middot;&nbsp; Empowering</span>
    </div>
    <img class="ph-logo" src="${logoSrc}" alt="ROCK">
  </div>
  <div class="ph-rule"></div>
</div>

<!-- Footer band (position:fixed — renders flush at bottom of EVERY page) -->
<div class="pf">
  <img class="pf-logo" src="${logoSrc}" alt="ROCK">
  <div class="pf-text">The Recruiters Of Christ&rsquo;s Kingdom Association</div>
</div>

<!-- Watermark -->
<img class="wm" src="${logoSrc}" alt="">

<!-- Content -->
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

// Transparent spacer — just reserves the top margin area (visual header is in the body).
function buildHeaderTemplate() {
  return '<div style="width:100%;height:65px;font-size:0;background:transparent !important;"></div>';
}

// Transparent overlay — only injects the page number into the footer margin area.
function buildFooterTemplate() {
  return `<div style="width:100%;height:50px;font-size:0;background:transparent !important;
                      -webkit-print-color-adjust:exact;print-color-adjust:exact;position:relative;">
  <span style="font-size:8px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;
               position:absolute;right:28px;top:50%;transform:translateY(-50%);white-space:nowrap;">
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </span>
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

// ── Volunteer Roster HTML template ───────────────────────────────────────────

function buildVolRosterHtml(ev, positions) {
  const logoSrc = getLogoB64();

  const dateStr  = fmtDate(ev.StartDate);
  const timeStr  = ev.StartTime ? fmtTime(ev.StartTime) : '';
  const metaBits = [dateStr, timeStr, ev.Location, ev.Address].filter(Boolean);
  const metaLine = metaBits.map(escHtml).join(' &nbsp;·&nbsp; ');

  const posBlocks = positions.map(p => {
    const total    = parseInt(p.SlotsTotal, 10) || 0;
    const filled   = parseInt(p.SlotsFilled, 10) || 0;
    const approved = (p.signups || []).filter(s => (s.Status || '').toLowerCase() === 'approved');
    const names    = approved.length
      ? approved.map(s => `<div class="vol-name">${escHtml(s.ContactName || '—')}</div>`).join('')
      : `<div class="vol-none">None yet</div>`;
    return `<div class="pos-block">
      <div class="pos-head">
        <span class="pos-title">${escHtml(p.Title)}</span>
        <span class="pos-count">${filled} of ${total} filled</span>
      </div>
      ${names}
    </div>`;
  }).join('');

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

.ph {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.ph-band {
  height: 62px; background-color: #14203a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 36px; box-sizing: border-box;
}
.ph-text {
  font-family: Georgia, 'Times New Roman', serif; color: #ffffff;
  font-size: 11px; font-weight: bold; letter-spacing: 0.09em;
  text-transform: uppercase; line-height: 1.4; flex: 1;
}
.ph-sub {
  display: block; font-size: 7.5px; font-weight: normal; color: #C9A96E;
  letter-spacing: 0.18em; margin-top: 3px;
}
.ph-logo { height: 46px; width: auto; display: block; flex-shrink: 0; }
.ph-rule { height: 3px; background-color: #C9A96E; }

.pf {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
  height: 50px; background-color: #14203a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 28px; box-sizing: border-box;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.pf-logo { height: 30px; width: auto; display: block; flex-shrink: 0; }
.pf-text {
  color: #ffffff; font-family: Georgia, 'Times New Roman', serif;
  font-size: 7px; letter-spacing: 0.05em; text-align: center;
  flex: 1; padding: 0 18px; line-height: 1.4;
}

.wm {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 54%; opacity: 0.09; z-index: 0; pointer-events: none;
}

.content {
  position: relative; z-index: 1;
  padding: 75px 40px 60px;
}

.event-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 21px; font-weight: 700; color: #14203a; line-height: 1.2;
  margin-bottom: 7px;
}
.event-meta { font-size: 11px; color: #5a6474; margin-bottom: 22px; line-height: 1.6; }
.section-label {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.2em;
  text-transform: uppercase; color: #C9A96E;
  border-bottom: 1.5px solid #ddd3bf; padding-bottom: 5px; margin-bottom: 18px;
}

.pos-block {
  margin-bottom: 18px;
  page-break-inside: avoid; break-inside: avoid;
}
.pos-head {
  display: flex; justify-content: space-between; align-items: baseline;
  border-left: 3px solid #C9A96E;
  padding: 5px 10px; background: #f5f0e8; margin-bottom: 6px;
}
.pos-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: #14203a;
}
.pos-count { font-size: 9px; color: #7a8494; font-style: italic; }

.vol-name {
  font-size: 12px; color: #14203a;
  padding: 4px 13px; border-bottom: 1px solid #ede8de;
}
.vol-name:last-child { border-bottom: none; }
.vol-none { font-size: 11px; color: #9ca3af; font-style: italic; padding: 4px 13px; }
</style>
</head>
<body>

<div class="ph">
  <div class="ph-band">
    <div class="ph-text">
      The ROCK Association
      <span class="ph-sub">Recruiting &nbsp;&middot;&nbsp; Training &nbsp;&middot;&nbsp; Empowering</span>
    </div>
    <img class="ph-logo" src="${logoSrc}" alt="ROCK">
  </div>
  <div class="ph-rule"></div>
</div>

<div class="pf">
  <img class="pf-logo" src="${logoSrc}" alt="ROCK">
  <div class="pf-text">The Recruiters Of Christ&rsquo;s Kingdom Association</div>
</div>

<img class="wm" src="${logoSrc}" alt="">

<div class="content">
  <h1 class="event-title">${escHtml(ev.EventName || 'Event')}</h1>
  ${metaLine ? `<p class="event-meta">${metaLine}</p>` : ''}
  <div class="section-label">Volunteer Roster</div>
  ${posBlocks || '<p style="font-size:11px;color:#6b7280;">No volunteer positions.</p>'}
</div>

</body>
</html>`;
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
      displayHeaderFooter: false,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await page.close();
  }
}

async function generateVolunteerRosterPdf(ev, positions) {
  const html    = buildVolRosterHtml(ev, positions);
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
      displayHeaderFooter: false,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await page.close();
  }
}

module.exports = { generateItineraryPdf, generateVolunteerRosterPdf };
