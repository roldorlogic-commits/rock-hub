'use strict';

const express  = require('express');
const router   = express.Router();
const calendar = require('../lib/calendar');
const { requireAuth, requireBoard } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/calendar/events?month=YYYY-MM
// Returns events for the given month (defaults to current month).
router.get('/calendar/events', async (req, res) => {
  try {
    let { month } = req.query;
    const now = new Date();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [y, m] = month.split('-').map(Number);
    const timeMin = new Date(y, m - 1, 1).toISOString();
    const timeMax = new Date(y, m,     1).toISOString(); // first of next month
    const events  = await calendar.listEvents(timeMin, timeMax);
    res.json(events);
  } catch (err) {
    console.error('[calendar] listEvents error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/events — Board only
router.post('/calendar/events', requireBoard, async (req, res) => {
  try {
    const { title, description, location, start, end, allDay } = req.body || {};
    if (!title || !start) return res.status(400).json({ error: 'title and start are required.' });
    const ev = await calendar.createEvent({ title, description, location, start, end, allDay });
    res.status(201).json(ev);
  } catch (err) {
    console.error('[calendar] createEvent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
