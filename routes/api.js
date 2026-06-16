'use strict';

const express = require('express');
const router  = express.Router();
const sheets  = require('../lib/sheets');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/me', (req, res) => res.json(req.user));

// "Upcoming" mirrors the front-end definition: Active or Planning status,
// with a start date today or later (events missing a StartDate still count).
function isUpcomingEvent(e) {
  if (!e.EventName) return false;
  if (!['Active', 'Planning'].includes(e.Status)) return false;
  if (!e.StartDate) return true;
  const start = new Date(e.StartDate + 'T00:00:00');
  if (isNaN(start)) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return start >= today;
}

router.get('/stats', async (req, res) => {
  try {
    const [members, events, volunteers, tasks] = await Promise.all([
      sheets.getMembers(),
      sheets.getEvents(),
      sheets.getVolunteers(),
      sheets.getTasks()
    ]);
    res.json({
      totalMembers:     members.length,
      activeEvents:     events.filter(isUpcomingEvent).length,
      activeVolunteers: volunteers.filter(v => v.Status === 'Active').length,
      openTasks:        tasks.filter(t => t.Status !== 'Completed').length
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/members',       async (req, res) => { try { res.json(await sheets.getMembers());       } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/events',        async (req, res) => { try { res.json(await sheets.getEvents());        } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/volunteers',    async (req, res) => { try { res.json(await sheets.getVolunteers());    } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/tasks',         async (req, res) => { try { res.json(await sheets.getTasks());         } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/announcements', async (req, res) => { try { res.json(await sheets.getAnnouncements()); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/documents',     async (req, res) => { try { res.json(await sheets.getDocuments());     } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/userroles',     async (req, res) => { try { res.json(await sheets.getUserRoles());     } catch (e) { res.status(500).json({ error: e.message }); } });

module.exports = router;
