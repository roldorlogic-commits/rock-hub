'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const sheets  = require('../lib/sheets');
const drive   = require('../lib/drive');
const email   = require('../lib/email');
const sms     = require('../lib/sms');
const { requireAuth, requireBoard, requireBoardOrAdmin } = require('../middleware/auth');

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

// ── Member create / edit (Board only) ───────────────────────────────────────
router.post('/members', requireBoard, async (req, res) => {
  try {
    const { FirstName, LastName, Email, Phone, Tags, MembershipType, MembershipStatus, Notes } = req.body;
    if (!FirstName && !LastName && !Email) {
      return res.status(400).json({ error: 'At least one of First Name, Last Name, or Email is required.' });
    }
    const id = `M-${Date.now()}`;
    const row = await sheets.appendRow('Members', {
      MemberID: id,
      FirstName: FirstName || '', LastName: LastName || '',
      Email: Email || '', Phone: Phone || '',
      Tags: Tags || '', MembershipType: MembershipType || '',
      MembershipStatus: MembershipStatus || 'Active',
      JoinDate: todayStr(), Notes: Notes || ''
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk operations on contacts: delete, tag, or notify selected IDs.
router.post('/members/bulk', requireBoard, async (req, res) => {
  try {
    const { action, ids, tag, subject, body: msgBody } = req.body || {};
    if (!action || !Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'action and ids[] are required.' });
    }
    const members = await sheets.getMembers();
    const targets = members.filter(m => ids.includes(m.MemberID));
    if (!targets.length) return res.status(400).json({ error: 'No matching members found.' });

    if (action === 'delete') {
      for (const m of targets) {
        await sheets.deleteRow('Members', 'MemberID', m.MemberID);
      }
      return res.json({ ok: true, affected: targets.length });
    }

    if (action === 'tag') {
      if (!tag) return res.status(400).json({ error: 'tag is required for tag action.' });
      for (const m of targets) {
        const existing = (m.Tags || '').split(',').map(t => t.trim()).filter(Boolean);
        if (!existing.includes(tag)) {
          existing.push(tag);
          await sheets.updateRowFields('Members', 'MemberID', m.MemberID, { Tags: existing.join(',') });
        }
      }
      return res.json({ ok: true, affected: targets.length });
    }

    if (action === 'notify') {
      if (!subject || !msgBody) return res.status(400).json({ error: 'subject and body are required for notify action.' });
      let sent = 0;
      for (const m of targets) {
        if (m.Email) {
          await email.send(m.Email, subject, msgBody).catch(() => {});
          sent++;
        }
      }
      return res.json({ ok: true, sent, total: targets.length });
    }

    res.status(400).json({ error: 'Unknown action. Use delete, tag, or notify.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/members/:id', requireBoard, async (req, res) => {
  try {
    const allowed = ['FirstName', 'LastName', 'Email', 'Phone', 'Tags', 'MembershipType', 'MembershipStatus', 'Notes'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });
    const updated = await sheets.updateRowFields('Members', 'MemberID', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Member not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/members/:id', async (req, res) => {
  try {
    const member = await sheets.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    res.json(filterMemberForRole(member, req.user.role));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── My volunteer profile (GET) — must precede /:id ─────────────────────────
// Returns the Volunteers-sheet row for the currently signed-in volunteer.
// Board members (who may not have a VolunteerID) are looked up by email.
router.get('/volunteers/me', async (req, res) => {
  try {
    const vol = req.user.volunteerId
      ? await sheets.getVolunteerById(req.user.volunteerId)
      : (await sheets.getVolunteers()).find(v => v.Email?.toLowerCase() === (req.user.email || '').toLowerCase());
    if (!vol) return res.status(404).json({ error: 'No volunteer profile found.' });
    res.json(vol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Pending volunteer approvals (Board/Admin only) ──────────────────────────
// Registered before the /volunteers/:id route below so the literal path
// "pending" isn't swallowed as a :id value.
router.get('/volunteers/pending', requireBoardOrAdmin, async (req, res) => {
  try {
    const [authRows, volunteers] = await Promise.all([sheets.getVolunteerAuth(), sheets.getVolunteers()]);
    const pending = authRows.filter(a => a.Status === 'Pending').map(a => {
      const v = volunteers.find(x => x.VolunteerID === a.VolunteerID) || {};
      const churchMatch = (v.Notes || '').match(/Church\/Org:\s*([^.]+)\.?/);
      return {
        VolunteerID: a.VolunteerID,
        Email: a.Email,
        FirstName: v.FirstName || '',
        LastName: v.LastName || '',
        Phone: v.Phone || '',
        Church: churchMatch ? churchMatch[1].trim() : '',
        RegisteredAt: a.CreatedAt || v.JoinDate || ''
      };
    });
    res.json(pending);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/volunteers/:id/confirm', requireBoardOrAdmin, async (req, res) => {
  try {
    const authRow = await sheets.findRow('VolunteerAuth', 'VolunteerID', req.params.id);
    if (!authRow) return res.status(404).json({ error: 'Volunteer registration not found.' });

    await sheets.updateRowFields('Volunteers', 'VolunteerID', req.params.id, { Status: 'Active' });
    await sheets.updateRowFields('VolunteerAuth', 'Email', authRow.Email, { Status: 'Active', UpdatedAt: todayStr() });
    await email.send(authRow.Email, 'Your ROCK Hub account has been approved!',
      'Your account has been approved! Log in at hub.gorock.org to get started.');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/volunteers/:id/decline', requireBoardOrAdmin, async (req, res) => {
  try {
    const authRow = await sheets.findRow('VolunteerAuth', 'VolunteerID', req.params.id);
    if (!authRow) return res.status(404).json({ error: 'Volunteer registration not found.' });

    await sheets.updateRowFields('Volunteers', 'VolunteerID', req.params.id, { Status: 'Declined' });
    await sheets.updateRowFields('VolunteerAuth', 'Email', authRow.Email, { Status: 'Declined', UpdatedAt: todayStr() });
    await email.send(authRow.Email, 'ROCK Hub volunteer registration update',
      "Thank you for your interest. Unfortunately we're unable to confirm your volunteer registration at this time. Contact vicepresident@gorock.org for more information.");
    res.json({ ok: true });
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

router.patch('/volunteers/:id', requireBoard, async (req, res) => {
  try {
    const allowed = ['FirstName', 'LastName', 'Email', 'Phone', 'PreferredRole', 'AvailabilityDays', 'Skills', 'Status', 'Notes'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });
    const updated = await sheets.updateRowFields('Volunteers', 'VolunteerID', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Volunteer not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/volunteers/:id', requireBoard, async (req, res) => {
  try {
    const ok = await sheets.deleteRow('Volunteers', 'VolunteerID', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Volunteer not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Notification preferences ─────────────────────────────────────────────────
const DEFAULT_PREFS = { EmailEvents: 'true', EmailTasks: 'true', EmailAnnouncements: 'true', SMSEvents: 'false', SMSTasks: 'false', SMSAnnouncements: 'false', Phone: '' };

router.get('/notification-prefs', async (req, res) => {
  try {
    const rows = await sheets.getNotificationPrefs();
    const prefs = rows.find(r => r.UserEmail?.toLowerCase() === (req.user.email || '').toLowerCase());
    res.json(prefs ? { ...DEFAULT_PREFS, ...prefs } : { UserEmail: req.user.email, ...DEFAULT_PREFS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/notification-prefs', async (req, res) => {
  try {
    const b = req.body || {};
    const boolStr = v => (v === false || v === 'false') ? 'false' : 'true';
    const fields = {
      EmailEvents:        boolStr(b.EmailEvents),
      EmailTasks:         boolStr(b.EmailTasks),
      EmailAnnouncements: boolStr(b.EmailAnnouncements),
      SMSEvents:          b.SMSEvents  === true || b.SMSEvents  === 'true' ? 'true' : 'false',
      SMSTasks:           b.SMSTasks   === true || b.SMSTasks   === 'true' ? 'true' : 'false',
      SMSAnnouncements:   b.SMSAnnouncements === true || b.SMSAnnouncements === 'true' ? 'true' : 'false',
      Phone:              b.Phone || ''
    };
    const userEmail = req.user.email || '';
    const rows = await sheets.getNotificationPrefs();
    const existing = rows.find(r => r.UserEmail?.toLowerCase() === userEmail.toLowerCase());
    const saved = existing
      ? await sheets.updateRowFields('NotificationPrefs', 'UserEmail', existing.UserEmail, fields)
      : await sheets.appendRow('NotificationPrefs', { UserEmail: userEmail, ...fields });
    res.json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tasks: interactive status/notes updates, written straight to the sheet ──
function canEditTask(task, user) {
  if (user.role === 'Board') return true;
  const assignee = (task.AssignedTo || '').toLowerCase();
  return assignee === (user.email || '').toLowerCase() || assignee === (user.name || '').toLowerCase();
}

async function notifyTaskAssignment(task, assigneeEmail) {
  if (!assigneeEmail) return;
  try {
    const allPrefs = await sheets.getNotificationPrefs();
    const prefs    = allPrefs.find(p => p.UserEmail?.toLowerCase() === assigneeEmail.toLowerCase());
    const emailOk  = !prefs || prefs.EmailTasks !== 'false';
    const smsOk    = prefs?.SMSTasks === 'true';
    const phone    = prefs?.Phone || '';
    const dueStr   = task.DueDate ? ` · Due: ${task.DueDate}` : '';
    const title    = task.Title || task.Item || task.TaskID;
    if (emailOk) {
      await email.send(assigneeEmail, `Task assigned: ${title}`,
        `You've been assigned a task on ROCK Hub:\n\nTask: ${title}${dueStr}\n${task.Notes ? '\nNotes: ' + task.Notes + '\n' : ''}\nView at hub.gorock.org`
      ).catch(() => {});
    }
    if (smsOk && phone) {
      await sms.send(phone, `ROCK Hub: Task assigned — ${title}${dueStr}. View at hub.gorock.org`).catch(() => {});
    }
  } catch (_) {}
}

// Board can create tasks directly and notify the assignee.
router.post('/tasks', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.Title) return res.status(400).json({ error: 'Title is required.' });
    const row = await sheets.appendRow('Tasks', {
      TaskID:       `TSK-${Date.now()}`,
      Title:        b.Title,
      AssignedTo:   b.AssignedTo  || '',
      DueDate:      b.DueDate     || '',
      Priority:     b.Priority    || 'Medium',
      Status:       'Pending',
      Notes:        b.Notes       || '',
      Category:     b.Category    || '',
      CreatedAt:    todayStr()
    });
    if (b.AssignedTo) setImmediate(() => notifyTaskAssignment(row, b.AssignedTo));
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    // Board can reassign; notify new assignee when AssignedTo changes.
    const newAssignee = req.body.AssignedTo;
    if (newAssignee !== undefined && req.user.role === 'Board') {
      fields.AssignedTo = newAssignee;
      if (newAssignee && newAssignee !== task.AssignedTo) {
        setImmediate(() => notifyTaskAssignment({ ...task, ...fields }, newAssignee));
      }
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });

    const updated = await sheets.updateRowFields('Tasks', 'TaskID', req.params.id, fields);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Event sign-up now lives in routes/events.js, backed by the EventRegistrations
// sheet (POST /api/events/:id/signup, GET /api/my-registrations) rather than
// the local JSON file this used to use — see that file for the Part 1 / Part 2
// event-management + volunteer-auth work.

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

// ── Document upload (Board only) ────────────────────────────────────────────
// Client sends base64-encoded file content as JSON; server uploads to Drive
// and writes metadata to the Documents sheet. Drive API must be enabled in the
// Google Cloud project linked to the service account.
router.post('/documents/upload', requireBoard, async (req, res) => {
  try {
    const { name, base64, mimeType, accessLevel, category } = req.body;
    if (!name || !base64 || !mimeType) {
      return res.status(400).json({ error: 'name, base64, and mimeType are required.' });
    }
    const buffer = Buffer.from(base64, 'base64');
    const folderId = process.env.DOCUMENTS_FOLDER_ID || null;
    const { fileId, url } = await drive.uploadFile(name, mimeType, buffer, folderId);
    const docId = `DOC-${Date.now()}`;
    await sheets.appendRow('Documents', {
      DocumentID: docId,
      Title: name,
      Category: category || 'General',
      FileType: (mimeType.split('/').pop() || 'file').toUpperCase(),
      AccessLevel: accessLevel || 'Board Only',
      FileURL: url,
      DriveFileID: fileId,
      UploadDate: todayStr(),
      UploadedBy: req.user.name || req.user.email,
      Status: 'Active',
      Source: 'upload'
    });
    res.json({ ok: true, DocumentID: docId, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Paste an existing Drive link as a document (no file transfer; Source = 'drive').
router.post('/documents/link', requireBoard, async (req, res) => {
  try {
    const { name, url, accessLevel, category } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'name and url are required.' });
    const docId = `DOC-${Date.now()}`;
    await sheets.appendRow('Documents', {
      DocumentID: docId,
      Title: name,
      Category: category || 'General',
      FileType: 'Link',
      AccessLevel: accessLevel || 'Board Only',
      FileURL: url,
      DriveFileID: '',
      UploadDate: todayStr(),
      UploadedBy: req.user.name || req.user.email,
      Status: 'Active',
      Source: 'drive'
    });
    res.json({ ok: true, DocumentID: docId, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Document metadata edit (Board only) ─────────────────────────────────────
router.patch('/documents/:id', requireBoard, async (req, res) => {
  try {
    const fields = {};
    if (req.body.Title)       fields.Title       = req.body.Title;
    if (req.body.AccessLevel) fields.AccessLevel = req.body.AccessLevel;
    if (req.body.Category)    fields.Category    = req.body.Category;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });
    const updated = await sheets.updateRowFields('Documents', 'DocumentID', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    res.json(updated);
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

// ── Notification test route (Board only) ────────────────────────────────────
router.get('/test-notification', requireBoard, async (req, res) => {
  const [smsResult, emailResult] = await Promise.all([
    sms.send('+14078798972', 'ROCK Hub test SMS — notification system check.'),
    email.send('vicepresident@gorock.org', 'ROCK Hub test email', 'This is a test from ROCK Hub. If you received this, the email notification system is working.')
  ]);
  res.json({
    smsConfigured:   sms.isConfigured(),
    emailConfigured: email.isConfigured(),
    sms:   smsResult,
    email: emailResult
  });
});

module.exports = router;
