'use strict';

const express    = require('express');
const router     = express.Router();
const sheets     = require('../lib/sheets');
const calSync    = require('../lib/calendar-sync');
const { requireVP } = require('../middleware/auth');

router.use(requireVP);

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = ['Timestamp', 'Email', 'Action', 'Route', 'Method', 'IP', 'UserAgent'];
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

// GET /api/admin/activity[?email=&from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv]
router.get('/activity', async (req, res) => {
  try {
    let rows = await sheets.getActivityLog();

    // Filters
    if (req.query.email) {
      const q = req.query.email.toLowerCase();
      rows = rows.filter(r => (r.Email || '').toLowerCase().includes(q));
    }
    if (req.query.from) {
      rows = rows.filter(r => r.Timestamp >= req.query.from);
    }
    if (req.query.to) {
      const to = req.query.to + 'T23:59:59.999Z';
      rows = rows.filter(r => r.Timestamp <= to);
    }

    // Newest first
    rows.sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''));

    if (req.query.format === 'csv') {
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="activity-log-${date}.csv"`);
      return res.send(toCsv(rows));
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/calendar-backfill — sync all events that don't yet have a CalendarEventID
router.post('/calendar-backfill', async (req, res) => {
  try {
    const results = await calSync.backfillAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/sheet-reads — which tabs/operations generate the most actual
// Sheets read requests (cache misses) since boot or last reset. Lets us see at
// a glance where read-quota pressure is coming from. ?reset=1 zeroes counters.
router.get('/sheet-reads', (req, res) => {
  const stats = sheets.getReadStats();
  if (req.query.reset === '1') sheets.resetReadStats();
  res.json({ total: stats.reduce((n, s) => n + s.count, 0), byTab: stats });
});

module.exports = router;
