'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const sheets  = require('../lib/sheets');
const { requireAuth, requireBoard } = require('../middleware/auth');

router.use(requireAuth);

router.get('/me', (req, res) => res.json(req.user));

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

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

// ── Member detail (role-filtered) ───────────────────────────────────────────
// Board sees every field; Volunteers see only the non-sensitive subset.
const MEMBER_PUBLIC_FIELDS = ['MemberID', 'FirstName', 'LastName', 'Email', 'Phone', 'MembershipType', 'MembershipStatus'];

function filterMemberForRole(member, role) {
  if (!member || role === 'Board') return member;
  return Object.fromEntries(MEMBER_PUBLIC_FIELDS.map(k => [k, member[k] ?? '']));
}

router.get('/members/:id', async (req, res) => {
  try {
    const member = await sheets.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    res.json(filterMemberForRole(member, req.user.role));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Volunteer detail ─────────────────────────────────────────────────────────
router.get('/volunteers/:id', async (req, res) => {
  try {
    const vol = await sheets.getVolunteerById(req.params.id);
    if (!vol) return res.status(404).json({ error: 'Volunteer not found.' });
    res.json(vol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tasks: interactive status/notes updates, written straight to the sheet ──
function canEditTask(task, user) {
  if (user.role === 'Board') return true;
  const assignee = (task.AssignedTo || '').toLowerCase();
  return assignee === (user.email || '').toLowerCase() || assignee === (user.name || '').toLowerCase();
}

router.patch('/tasks/:id', async (req, res) => {
  try {
    const task = await sheets.findRow('Tasks', 'TaskID', req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (!canEditTask(task, req.user)) {
      return res.status(403).json({ error: 'You can only update tasks assigned to you.' });
    }

    const fields = {};
    if (req.body.Status) {
      fields.Status = req.body.Status;
      fields.CompletedDate = req.body.Status === 'Completed' ? todayStr() : '';
    }
    if (req.body.Note && req.body.Note.trim()) {
      const stamped = `[${todayStr()}] ${req.body.Note.trim()}.`;
      fields.Notes = task.Notes ? `${stamped} | ${task.Notes}` : stamped;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });

    const updated = await sheets.updateRowFields('Tasks', 'TaskID', req.params.id, fields);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Event sign-up ────────────────────────────────────────────────────────────
// Lightweight local store tracking which (event, email) pairs have signed up,
// so the UI can show a "You're registered" badge and avoid double-counting
// RegisteredCount. New volunteers are also written into the Volunteers sheet.
const SIGNUPS_FILE = path.join(__dirname, '../config/event-signups.json');

function readSignups() {
  try { return JSON.parse(fs.readFileSync(SIGNUPS_FILE, 'utf8')); } catch { return {}; }
}
function writeSignups(data) {
  fs.writeFileSync(SIGNUPS_FILE, JSON.stringify(data, null, 2));
}

router.post('/event-signups/:eventId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const { FirstName, LastName, Email, Phone, AvailabilityDays, PreferredRole, Notes } = req.body || {};
    if (!Email || !FirstName) return res.status(400).json({ error: 'Name and email are required.' });

    const event = await sheets.findRow('Events', 'EventID', eventId);
    if (!event) return res.status(404).json({ error: 'Event not found.' });

    const signups = readSignups();
    const list = signups[eventId] || [];
    const alreadyRegistered = list.some(s => s.email.toLowerCase() === Email.toLowerCase());

    if (!alreadyRegistered) {
      const volunteers  = await sheets.getVolunteers();
      const existingVol = volunteers.find(v => v.Email?.toLowerCase() === Email.toLowerCase());

      if (!existingVol) {
        const volunteerId = `VOL${String(volunteers.length + 1).padStart(3, '0')}`;
        const note = `Signed up via ${event.EventName} event registration.${Notes ? ' ' + Notes : ''}`;
        await sheets.appendRow('Volunteers', {
          VolunteerID: volunteerId,
          FirstName, LastName: LastName || '', Email, Phone: Phone || '',
          AvailabilityDays: AvailabilityDays || '',
          Skills: PreferredRole || '',
          BackgroundCheckStatus: 'Not Started',
          HoursLogged: '0',
          PreferredRole: PreferredRole || '',
          Status: 'Active',
          JoinDate: todayStr(),
          Notes: note
        });
      }

      const newCount = (parseInt(event.RegisteredCount, 10) || 0) + 1;
      await sheets.updateRowFields('Events', 'EventID', eventId, { RegisteredCount: newCount });

      list.push({ email: Email, name: `${FirstName} ${LastName || ''}`.trim(), date: todayStr() });
      signups[eventId] = list;
      writeSignups(signups);
    }

    res.json({ ok: true, alreadyRegistered, message: "You're signed up! We'll be in touch with more details." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/event-signups/mine', (req, res) => {
  const signups = readSignups();
  const email = (req.user.email || '').toLowerCase();
  const eventIds = Object.keys(signups).filter(id => (signups[id] || []).some(s => s.email.toLowerCase() === email));
  res.json({ eventIds });
});

// ── Global search ────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ members: [], events: [], volunteers: [], documents: [] });
  try {
    const [members, events, volunteers, documents] = await Promise.all([
      sheets.getMembers(), sheets.getEvents(), sheets.getVolunteers(), sheets.getDocuments()
    ]);
    const fullName  = (a, b) => `${a || ''} ${b || ''}`.toLowerCase();
    const nameMatch = (a, b) => fullName(a, b).includes(q);

    res.json({
      members: members
        .filter(m => nameMatch(m.FirstName, m.LastName) || m.Email?.toLowerCase().includes(q))
        .slice(0, 8)
        .map(m => ({ id: m.MemberID, label: [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email, type: 'member' })),
      events: events
        .filter(e => e.EventName?.toLowerCase().includes(q))
        .slice(0, 8)
        .map(e => ({ id: e.EventID, label: e.EventName, type: 'event' })),
      volunteers: volunteers
        .filter(v => nameMatch(v.FirstName, v.LastName) || v.Email?.toLowerCase().includes(q))
        .slice(0, 8)
        .map(v => ({ id: v.VolunteerID, label: [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email, type: 'volunteer' })),
      documents: documents
        .filter(d => d.Title?.toLowerCase().includes(q))
        .slice(0, 8)
        .map(d => ({
          id: d.DocumentID,
          label: d.Title,
          type: 'document',
          href: d.FileURL || (d.DriveFileID ? `https://drive.google.com/file/d/${d.DriveFileID}/view` : null)
        }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CSV export (Board only) ──────────────────────────────────────────────────
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

router.get('/export/:type', requireBoard, async (req, res) => {
  const sources = { members: sheets.getMembers, volunteers: sheets.getVolunteers, tasks: sheets.getTasks };
  const fn = sources[req.params.type];
  if (!fn) return res.status(400).json({ error: 'Unknown export type. Use members, volunteers, or tasks.' });
  try {
    const csv = toCsv(await fn());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${todayStr()}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
