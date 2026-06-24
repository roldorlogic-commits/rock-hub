'use strict';

const express    = require('express');
const router     = express.Router();
const sheets     = require('../lib/sheets');
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

module.exports = router;
