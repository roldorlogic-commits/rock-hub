'use strict';

// Event Management System endpoints (Part 1) — event detail, registrations,
// checklist, budget, documents, announcements, attendance, and event
// creation. Mounted at /api alongside routes/api.js.

const express = require('express');
const router  = express.Router();
const sheets  = require('../lib/sheets');
const drive   = require('../lib/drive');
const email   = require('../lib/email');
const sms     = require('../lib/sms');
const { requireAuth, requireBoard } = require('../middleware/auth');

router.use(requireAuth);

function todayStr() { return new Date().toISOString().slice(0, 10); }
function nowStr()   { return new Date().toISOString(); }

function canEditTask(task, user) {
  if (user.role === 'Board') return true;
  const assignee = (task.AssignedTo || '').toLowerCase();
  return assignee === (user.email || '').toLowerCase() || assignee === (user.name || '').toLowerCase();
}

// ── My Sign-Ups (volunteer dashboard widget) ────────────────────────────────
router.get('/my-registrations', async (req, res) => {
  try {
    const [regs, events] = await Promise.all([sheets.getEventRegistrations(), sheets.getEvents()]);
    const myEmail = (req.user.email || '').toLowerCase();
    const mine = regs.filter(r => r.Email?.toLowerCase() === myEmail);
    const withEvent = mine.map(r => {
      const ev = events.find(e => e.EventID === r.EventID) || {};
      return { ...r, EventName: ev.EventName || r.EventID, StartDate: ev.StartDate || '', Location: ev.Location || '' };
    });
    res.json(withEvent);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── My Hours ─────────────────────────────────────────────────────────────────
router.get('/my-hours', async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase();
    const log = await sheets.getHoursLog();
    const mine = log
      .filter(h => h.Email?.toLowerCase() === email)
      .sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));
    res.json(mine);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/my-hours', async (req, res) => {
  try {
    const b = req.body || {};
    const hours = parseFloat(b.Hours);
    if (!hours || hours <= 0) return res.status(400).json({ error: 'Please enter a valid number of hours.' });
    if (!b.Date) return res.status(400).json({ error: 'Date is required.' });
    if (!(b.Activity || '').trim()) return res.status(400).json({ error: 'Activity description is required.' });

    const email = (req.user.email || '').toLowerCase();
    const vols = await sheets.getVolunteers();
    const vol = vols.find(v => v.Email?.toLowerCase() === email);
    if (!vol) return res.status(404).json({ error: 'No volunteer profile found for your account.' });

    let eventName = (b.EventName || '').trim();
    if (b.EventID && !eventName) {
      const ev = await sheets.getEventById(b.EventID);
      eventName = ev?.EventName || '';
    }

    const row = await sheets.appendRow('HoursLog', {
      HoursID: `HRS${Date.now()}`,
      VolunteerID: vol.VolunteerID,
      Email: email,
      EventID: b.EventID || '',
      EventName: eventName,
      Hours: String(hours),
      Activity: b.Activity.trim(),
      Date: b.Date,
      Notes: (b.Notes || '').trim(),
      LoggedAt: todayStr()
    });

    const currentTotal = parseFloat(vol.HoursLogged || '0') || 0;
    const newTotal = Math.round((currentTotal + hours) * 100) / 100;
    await sheets.updateRowFields('Volunteers', 'VolunteerID', vol.VolunteerID, {
      HoursLogged: String(newTotal)
    });

    res.json({ ok: true, entry: row, newTotal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── My volunteer profile (editable: phone, church, availability, skills) ───
router.patch('/volunteers/me', async (req, res) => {
  try {
    const volunteers = await sheets.getVolunteers();
    const vol = volunteers.find(v => v.Email?.toLowerCase() === (req.user.email || '').toLowerCase());
    if (!vol) return res.status(404).json({ error: 'No volunteer profile found for your account.' });

    const fields = {};
    if (req.body.Phone !== undefined)            fields.Phone = req.body.Phone;
    if (req.body.AvailabilityDays !== undefined)  fields.AvailabilityDays = req.body.AvailabilityDays;
    if (req.body.Skills !== undefined)            fields.Skills = req.body.Skills;
    if (req.body.Church !== undefined) {
      const existing = vol.Notes || '';
      const hasChurch = /Church\/Org:\s*[^.]+\.?/.test(existing);
      fields.Notes = hasChurch
        ? existing.replace(/Church\/Org:\s*[^.]+\.?/, `Church/Org: ${req.body.Church}.`)
        : `${existing}${existing ? ' ' : ''}Church/Org: ${req.body.Church}.`;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });

    const updated = await sheets.updateRowFields('Volunteers', 'VolunteerID', vol.VolunteerID, fields);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Default checklist template (spec'd in 1C / 1D) ──────────────────────────
const DEFAULT_CHECKLIST = [
  ['Logistics', 'Confirm venue/location'],
  ['Logistics', 'Arrange transportation'],
  ['Logistics', 'Confirm headcount'],
  ['Marketing', 'Create flyer'],
  ['Marketing', 'Post on social media'],
  ['Marketing', 'Send announcement to members'],
  ['Volunteers', 'Recruit volunteers'],
  ['Volunteers', 'Confirm volunteer roles'],
  ['Volunteers', 'Send volunteer brief'],
  ['Day-Of', 'Set up venue'],
  ['Day-Of', 'Volunteer check-in'],
  ['Day-Of', 'Attendance sign-in'],
  ['Day-Of', 'Post-event cleanup'],
  ['Follow-Up', 'Send thank-you emails'],
  ['Follow-Up', 'Log attendance'],
  ['Follow-Up', 'Update budget actuals'],
  ['Follow-Up', 'Write event recap']
];

async function createDefaultChecklist(eventId) {
  let seq = 0;
  for (const [category, item] of DEFAULT_CHECKLIST) {
    seq += 1;
    await sheets.appendRow('EventChecklist', {
      ChecklistID: `CHK${eventId}-${String(seq).padStart(2, '0')}`,
      EventID: eventId, Category: category, Item: item,
      Status: 'Pending', Priority: 'Medium', CreatedAt: todayStr()
    });
  }
}

// ── Create Event (Board only) ───────────────────────────────────────────────
router.post('/events', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.EventName || !b.StartDate) return res.status(400).json({ error: 'Event name and start date are required.' });

    const eventId = `EVT${Date.now()}`;
    const fields = {
      EventID: eventId, EventName: b.EventName, EventType: b.EventType || '',
      Description: b.Description || '', StartDate: b.StartDate, EndDate: b.EndDate || b.StartDate,
      StartTime: b.StartTime || '', EndTime: b.EndTime || '', Location: b.Location || '',
      Address: b.Address || '', RegistrationDeadline: b.RegistrationDeadline || '',
      Capacity: b.Capacity || '0', Status: 'Planning',
      CoordinatorName: b.CoordinatorName || '', CoordinatorEmail: b.CoordinatorEmail || '',
      RegisteredCount: '0', RegistrationInfo: b.RegistrationInfo || '',
      VolunteersNeeded: b.VolunteersNeeded || '0', Cost: b.Cost || '0',
      CreatedAt: todayStr(), UpdatedAt: todayStr()
    };
    await sheets.appendRow('Events', fields);
    await createDefaultChecklist(eventId);
    res.json({ ok: true, EventID: eventId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Event detail (status stepper, edit) ─────────────────────────────────────
router.get('/events/:id', async (req, res) => {
  try {
    const ev = await sheets.getEventById(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Event not found.' });
    res.json(ev);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/events/:id', requireBoard, async (req, res) => {
  try {
    const updated = await sheets.updateRowFields('Events', 'EventID', req.params.id, { ...req.body, UpdatedAt: todayStr() });
    if (!updated) return res.status(404).json({ error: 'Event not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const STATUS_ORDER = ['Planning', 'Active', 'In Progress', 'Completed'];
router.post('/events/:id/advance-status', requireBoard, async (req, res) => {
  try {
    const ev = await sheets.getEventById(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Event not found.' });
    const idx = STATUS_ORDER.indexOf(ev.Status);
    const next = req.body?.status || STATUS_ORDER[Math.min(idx + 1, STATUS_ORDER.length - 1)];
    const updated = await sheets.updateRowFields('Events', 'EventID', req.params.id, { Status: next, UpdatedAt: todayStr() });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tab 1: Overview stats ────────────────────────────────────────────────────
router.get('/events/:id/stats', async (req, res) => {
  try {
    const [ev, regs] = await Promise.all([sheets.getEventById(req.params.id), sheets.getEventRegistrations()]);
    if (!ev) return res.status(404).json({ error: 'Event not found.' });
    const mine = regs.filter(r => r.EventID === req.params.id);
    res.json({
      totalRegistered: mine.length,
      confirmed:  mine.filter(r => r.Status === 'Confirmed').length,
      pending:    mine.filter(r => r.Status === 'Pending').length,
      waitlisted: mine.filter(r => r.Status === 'Waitlisted').length,
      checkedIn:  mine.filter(r => r.CheckedIn === 'TRUE' || r.CheckedIn === 'true').length,
      capacity:   parseInt(ev.Capacity, 10) || 0,
      volunteersNeeded: parseInt(ev.VolunteersNeeded, 10) || 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tab 2: Registrations / Volunteers ───────────────────────────────────────
router.get('/events/:id/registrations', async (req, res) => {
  try {
    const regs = await sheets.getEventRegistrations();
    res.json(regs.filter(r => r.EventID === req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Shared by both the volunteer "Sign Up" flow and the Board "Add Volunteer
// manually" form — auto-waitlists once Capacity is reached.
async function addRegistration(eventId, fields, defaultStatus) {
  const [ev, existingRegs] = await Promise.all([sheets.getEventById(eventId), sheets.getEventRegistrations()]);
  if (!ev) throw Object.assign(new Error('Event not found.'), { status: 404 });

  const eventRegs = existingRegs.filter(r => r.EventID === eventId);
  const capacity  = parseInt(ev.Capacity, 10) || 0;
  const confirmedOrPending = eventRegs.filter(r => ['Confirmed', 'Pending'].includes(r.Status)).length;
  const status = capacity > 0 && confirmedOrPending >= capacity ? 'Waitlisted' : defaultStatus;

  const regId = `REG${Date.now()}`;
  const row = await sheets.appendRow('EventRegistrations', {
    RegistrationID: regId, EventID: eventId, Status: status,
    SignUpDate: todayStr(), CheckedIn: 'FALSE', CreatedAt: todayStr(), ...fields
  });
  return { row, waitlisted: status === 'Waitlisted' };
}

router.post('/events/:id/registrations', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.FirstName || !b.Email) return res.status(400).json({ error: 'Name and email are required.' });
    const { row, waitlisted } = await addRegistration(req.params.id, {
      FirstName: b.FirstName, LastName: b.LastName || '', Email: b.Email,
      Phone: b.Phone || '', Role: b.Role || '', Notes: b.Notes || '',
      Category: b.Category || (b.Role ? 'Volunteer' : 'Attendee')
    }, 'Confirmed');
    res.json({ ok: true, registration: row, waitlisted });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/events/:eventId/registrations/:regId', requireBoard, async (req, res) => {
  try {
    const fields = {};
    if (req.body.Status) {
      fields.Status = req.body.Status;
      if (req.body.Status === 'Confirmed') fields.ConfirmedDate = todayStr();
    }
    if (req.body.Notes !== undefined) fields.Notes = req.body.Notes;
    const updated = await sheets.updateRowFields('EventRegistrations', 'RegistrationID', req.params.regId, fields);
    if (!updated) return res.status(404).json({ error: 'Registration not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:eventId/registrations/:regId/checkin', requireBoard, async (req, res) => {
  try {
    const checkedIn = req.body?.checkedIn !== false;
    const updated = await sheets.updateRowFields('EventRegistrations', 'RegistrationID', req.params.regId, {
      CheckedIn: checkedIn ? 'TRUE' : 'FALSE',
      CheckInTime: checkedIn ? nowStr() : ''
    });
    if (!updated) return res.status(404).json({ error: 'Registration not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/registrations/confirm-all-pending', requireBoard, async (req, res) => {
  try {
    const regs = (await sheets.getEventRegistrations()).filter(r => r.EventID === req.params.id && r.Status === 'Pending');
    for (const r of regs) {
      await sheets.updateRowFields('EventRegistrations', 'RegistrationID', r.RegistrationID, { Status: 'Confirmed', ConfirmedDate: todayStr() });
    }
    res.json({ ok: true, confirmed: regs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/registrations/checkin-all', requireBoard, async (req, res) => {
  try {
    const regs = (await sheets.getEventRegistrations()).filter(r => r.EventID === req.params.id && r.CheckedIn !== 'TRUE');
    for (const r of regs) {
      await sheets.updateRowFields('EventRegistrations', 'RegistrationID', r.RegistrationID, { CheckedIn: 'TRUE', CheckInTime: nowStr() });
    }
    res.json({ ok: true, checkedIn: regs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Volunteer-facing sign-up: writes a Pending registration for themselves.
router.post('/events/:id/signup', async (req, res) => {
  try {
    const b = req.body || {};
    const email_ = req.user.role === 'Board' ? (b.Email || req.user.email) : req.user.email;
    const existing = (await sheets.getEventRegistrations())
      .filter(r => r.EventID === req.params.id && r.Email?.toLowerCase() === (email_ || '').toLowerCase());
    if (existing.length) return res.json({ ok: true, alreadyRegistered: true, registration: existing[0] });

    const [first, ...rest] = (req.user.name || b.FirstName || '').split(/\s+/);
    const { row, waitlisted } = await addRegistration(req.params.id, {
      FirstName: b.FirstName || first || '', LastName: b.LastName || rest.join(' '),
      Email: email_, Phone: b.Phone || '', Role: b.Role || '', Notes: b.Notes || '',
      Category: 'Volunteer'
    }, 'Pending');
    res.json({ ok: true, registration: row, waitlisted, message: "You're signed up! We'll be in touch with more details." });

    // Fire-and-forget enrollment notifications — don't fail the signup on error.
    setImmediate(async () => {
      try {
        const [ev, allPrefs] = await Promise.all([
          sheets.getEventById(req.params.id),
          sheets.getNotificationPrefs()
        ]);
        if (!ev) return;

        const volPrefs     = allPrefs.find(p => p.UserEmail?.toLowerCase() === (email_ || '').toLowerCase());
        const emailEnabled = !volPrefs || volPrefs.EmailEvents !== 'false';
        const smsEnabled   = volPrefs?.SMSEvents === 'true';
        const phone        = b.Phone || volPrefs?.Phone || '';
        const volName      = [row.FirstName, row.LastName].filter(Boolean).join(' ') || email_;
        const dateStr      = ev.StartDate ? ` on ${ev.StartDate}` : '';

        if (emailEnabled && email_) {
          await email.send(email_, `You're signed up: ${ev.EventName}`,
            `Hi ${row.FirstName || 'there'},\n\nYou're registered for ${ev.EventName}${dateStr}!\n\nThank you for serving. We'll be in touch with more details.\n\n— The ROCK Team`
          ).catch(() => {});
        }
        if (smsEnabled && phone) {
          await sms.send(phone, `ROCK Hub: You're signed up for ${ev.EventName}${dateStr}. Thank you for serving!`).catch(() => {});
        }

        // Alert board regardless of preferences.
        await email.send('info@gorock.org,vicepresident@gorock.org',
          `New volunteer sign-up: ${ev.EventName}`,
          `New volunteer registration:\n\nName:  ${volName}\nEmail: ${email_}\nPhone: ${b.Phone || 'not provided'}\nRole:  ${b.Role || 'not specified'}\nEvent: ${ev.EventName}${dateStr}\nStatus: ${waitlisted ? 'Waitlisted' : 'Pending'}\n\nView at hub.gorock.org`
        ).catch(() => {});
      } catch (notifErr) {
        console.error('Signup notification error:', notifErr.message);
      }
    });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Tab 3: Checklist ─────────────────────────────────────────────────────────
router.get('/events/:id/checklist', async (req, res) => {
  try {
    const items = await sheets.getEventChecklist();
    res.json(items.filter(c => c.EventID === req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/checklist', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.Item) return res.status(400).json({ error: 'Item name is required.' });
    const row = await sheets.appendRow('EventChecklist', {
      ChecklistID: `CHK${Date.now()}`, EventID: req.params.id,
      Category: b.Category || 'Logistics', Item: b.Item, AssignedTo: b.AssignedTo || '',
      DueDate: b.DueDate || '', Status: 'Pending', Priority: b.Priority || 'Medium',
      Notes: b.Notes || '', CreatedAt: todayStr()
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/checklist/:id', requireBoard, async (req, res) => {
  try {
    const ok = await sheets.deleteRow('EventChecklist', 'ChecklistID', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Checklist item not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/checklist/:id', async (req, res) => {
  try {
    const items = await sheets.getEventChecklist();
    const item = items.find(c => c.ChecklistID === req.params.id);
    if (!item) return res.status(404).json({ error: 'Checklist item not found.' });
    if (!canEditTask({ AssignedTo: item.AssignedTo }, req.user)) {
      return res.status(403).json({ error: 'You can only update checklist items assigned to you.' });
    }
    const fields = {};
    if (req.body.Status) { fields.Status = req.body.Status; fields.CompletedDate = req.body.Status === 'Completed' ? todayStr() : ''; }
    if (req.body.AssignedTo !== undefined) fields.AssignedTo = req.body.AssignedTo;
    if (req.body.DueDate !== undefined)    fields.DueDate = req.body.DueDate;
    if (req.body.Notes !== undefined)      fields.Notes = req.body.Notes;
    if (req.user.role === 'Board') {
      if (req.body.Item     !== undefined) fields.Item     = req.body.Item;
      if (req.body.Category !== undefined) fields.Category = req.body.Category;
      if (req.body.Priority !== undefined) fields.Priority = req.body.Priority;
    }
    const updated = await sheets.updateRowFields('EventChecklist', 'ChecklistID', req.params.id, fields);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tab 4: Budget ────────────────────────────────────────────────────────────
router.get('/events/:id/budget', async (req, res) => {
  try {
    const items = await sheets.getEventBudget();
    res.json(items.filter(b => b.EventID === req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/budget', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.Item) return res.status(400).json({ error: 'Item name is required.' });
    const row = await sheets.appendRow('EventBudget', {
      BudgetID: `BUD${Date.now()}`, EventID: req.params.id,
      Category: b.Category || 'Other', Item: b.Item,
      EstimatedCost: b.EstimatedCost || '0', ActualCost: b.ActualCost || '',
      PaidBy: b.PaidBy || '', ReceiptURL: b.ReceiptURL || '', Status: b.Status || 'Planned',
      Notes: b.Notes || '', CreatedAt: todayStr()
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/budget/:id', requireBoard, async (req, res) => {
  try {
    const ok = await sheets.deleteRow('EventBudget', 'BudgetID', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Budget item not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/budget/:id', requireBoard, async (req, res) => {
  try {
    const updated = await sheets.updateRowFields('EventBudget', 'BudgetID', req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Budget item not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tab 5: Documents (filtered by Tags containing the EventID/name) ────────
router.get('/events/:id/documents', async (req, res) => {
  try {
    const [ev, docs] = await Promise.all([sheets.getEventById(req.params.id), sheets.getDocuments()]);
    const needle = [req.params.id, ev?.EventName].filter(Boolean).map(s => s.toLowerCase());
    res.json(docs.filter(d => needle.some(n => (d.Tags || '').toLowerCase().includes(n))));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/documents', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.Title || (!b.FileURL && !b.DocumentID)) {
      return res.status(400).json({ error: 'Provide a title and either a Drive link or an existing document to attach.' });
    }
    if (b.DocumentID) {
      const docs = await sheets.getDocuments();
      const doc = docs.find(d => d.DocumentID === b.DocumentID);
      if (!doc) return res.status(404).json({ error: 'Document not found.' });
      const tags = [doc.Tags, req.params.id].filter(Boolean).join(',');
      const updated = await sheets.updateRowFields('Documents', 'DocumentID', b.DocumentID, { Tags: tags });
      return res.json(updated);
    }
    const ev = await sheets.getEventById(req.params.id);
    const row = await sheets.appendRow('Documents', {
      DocumentID: `DOC${Date.now()}`, Title: b.Title, Category: 'Events',
      FileURL: b.FileURL || '', FileType: 'Link', UploadDate: todayStr(),
      Status: 'Active', AccessLevel: b.AccessLevel || 'All',
      Tags: `events,${req.params.id}${ev ? ',' + ev.EventName : ''}`,
      UploadedBy: req.user.name || req.user.email,
      Source: 'drive'
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload a file and attach it as a document to this event.
router.post('/events/:id/documents/upload', requireBoard, async (req, res) => {
  try {
    const { name, base64, mimeType, accessLevel } = req.body || {};
    if (!name || !base64 || !mimeType) {
      return res.status(400).json({ error: 'name, base64, and mimeType are required.' });
    }
    const buffer = Buffer.from(base64, 'base64');
    const folderId = process.env.DOCUMENTS_FOLDER_ID || null;
    const { fileId, url } = await drive.uploadFile(name, mimeType, buffer, folderId);
    const ev = await sheets.getEventById(req.params.id);
    const row = await sheets.appendRow('Documents', {
      DocumentID: `DOC${Date.now()}`, Title: name, Category: 'Events',
      FileType: (mimeType.split('/').pop() || 'file').toUpperCase(),
      FileURL: url, DriveFileID: fileId, UploadDate: todayStr(),
      Status: 'Active', AccessLevel: accessLevel || 'All',
      Tags: `events,${req.params.id}${ev ? ',' + ev.EventName : ''}`,
      UploadedBy: req.user.name || req.user.email,
      Source: 'upload'
    });
    res.json({ ok: true, doc: row, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload event flyer/photo to Drive, return URL (never store bytes in the sheet).
router.post('/events/:id/photo', requireBoard, async (req, res) => {
  try {
    const { base64, mimeType } = req.body || {};
    if (!base64 || !mimeType) return res.status(400).json({ error: 'base64 and mimeType are required.' });
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED.includes(mimeType)) return res.status(400).json({ error: 'File must be a JPEG, PNG, WebP, or GIF image.' });
    const buffer = Buffer.from(base64, 'base64');
    const MAX_BYTES = 5 * 1024 * 1024;
    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Image must be under 5 MB.' });
    const ext = mimeType.split('/')[1] || 'jpg';
    const folderId = process.env.EVENT_PHOTOS_FOLDER_ID || null;
    const { url } = await drive.uploadFile(`event-${req.params.id}-${Date.now()}.${ext}`, mimeType, buffer, folderId);
    const updated = await sheets.updateRowFields('Events', 'EventID', req.params.id, { PhotoURL: url, UpdatedAt: todayStr() });
    if (!updated) return res.status(404).json({ error: 'Event not found.' });
    res.json({ ok: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tab 6: Announcements ─────────────────────────────────────────────────────
router.get('/events/:id/announcements', async (req, res) => {
  try {
    const items = await sheets.getEventAnnouncements();
    res.json(items.filter(a => a.EventID === req.params.id).reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/announcements', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.Subject || !b.Body) return res.status(400).json({ error: 'Subject and body are required.' });

    const [ev, regs] = await Promise.all([sheets.getEventById(req.params.id), sheets.getEventRegistrations()]);
    if (!ev) return res.status(404).json({ error: 'Event not found.' });

    const eventRegs = regs.filter(r => r.EventID === req.params.id);
    const recipientsFilter = b.Recipients || 'All Registrants';

    let targets;
    if (recipientsFilter === 'Confirmed Only') {
      targets = eventRegs.filter(r => r.Status === 'Confirmed');
    } else if (recipientsFilter === 'Volunteers Only') {
      targets = eventRegs.filter(r => r.Category === 'Volunteer' || r.Role);
    } else if (recipientsFilter.startsWith('Role:')) {
      const role = recipientsFilter.slice(5).trim().toLowerCase();
      targets = eventRegs.filter(r => r.Role?.toLowerCase() === role);
    } else {
      targets = eventRegs;
    }

    const channel    = b.Channel || 'Email';
    const sendSMS_   = b.SendSMS === true;
    let smsSentCount = 0;

    if (channel !== 'In-App') {
      for (const r of targets) {
        if (r.Email) await email.send(r.Email, b.Subject, b.Body).catch(() => {});
      }
    }

    if (sendSMS_) {
      const allPrefs = await sheets.getNotificationPrefs().catch(() => []);
      const snippet  = b.Body.replace(/<[^>]+>/g, '').slice(0, 120);
      const smsBody  = `${ev.EventName}: ${b.Subject}\n\n${snippet}${b.Body.length > 120 ? '…' : ''}`;
      for (const r of targets) {
        const rPrefs    = allPrefs.find(p => p.UserEmail?.toLowerCase() === r.Email?.toLowerCase());
        const smsOptIn  = rPrefs?.SMSAnnouncements === 'true';
        const phone     = r.Phone || rPrefs?.Phone;
        if (smsOptIn && phone) {
          await sms.send(phone, smsBody).catch(() => {});
          smsSentCount++;
        }
      }
    }

    const channelLabel = sendSMS_ ? `${channel} + SMS` : channel;
    await sheets.appendRow('EventAnnouncements', {
      AnnouncementID: `EAN${Date.now()}`, EventID: req.params.id, Subject: b.Subject, Body: b.Body,
      SentBy: req.user.name || req.user.email, SentAt: nowStr(),
      Recipients: `${recipientsFilter} (${targets.length})`, Channel: channelLabel
    });

    // Mirror into the main Announcements feed for Volunteers.
    await sheets.appendRow('Announcements', {
      AnnouncementID: `ANN${Date.now()}`, Title: `${ev.EventName}: ${b.Subject}`, Body: b.Body,
      Category: 'Event', Priority: 'Medium', PublishedBy: req.user.name || req.user.email,
      PublishDate: todayStr(), TargetAudience: 'Volunteers', Status: 'Active', Pinned: 'FALSE',
      CreatedAt: todayStr(), UpdatedAt: todayStr()
    });

    res.json({ ok: true, sentTo: targets.length, smsSentTo: smsSentCount, mocked: !email.isConfigured() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tab 7: Attendance (day-of check-in) ─────────────────────────────────────
router.post('/events/:id/walkin', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.FirstName || !b.Email) return res.status(400).json({ error: 'Name and email are required.' });
    const row = await sheets.appendRow('EventRegistrations', {
      RegistrationID: `REG${Date.now()}`, EventID: req.params.id,
      FirstName: b.FirstName, LastName: b.LastName || '', Email: b.Email,
      Status: 'Confirmed', SignUpDate: todayStr(), ConfirmedDate: todayStr(),
      CheckedIn: 'TRUE', CheckInTime: nowStr(), Notes: 'Walk-in', CreatedAt: todayStr(),
      Category: 'Attendee'
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Itinerary ────────────────────────────────────────────────────────────────
router.get('/events/:id/itinerary', async (req, res) => {
  try {
    const items = await sheets.getEventItinerary();
    const filtered = items
      .filter(i => i.EventID === req.params.id)
      .sort((a, b) => (a.Time || '').localeCompare(b.Time || ''));
    res.json(filtered);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/itinerary', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!(b.Title || '').trim()) return res.status(400).json({ error: 'Title is required.' });
    const row = await sheets.appendRow('EventItinerary', {
      ItineraryID: `ITN${Date.now()}`,
      EventID: req.params.id,
      Time: b.Time || '',
      Title: b.Title.trim(),
      Notes: (b.Notes || '').trim(),
      CreatedBy: req.user.name || req.user.email
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/itinerary/:id', requireBoard, async (req, res) => {
  try {
    const fields = {};
    if (req.body.Time  !== undefined) fields.Time  = req.body.Time;
    if (req.body.Title !== undefined) fields.Title = req.body.Title;
    if (req.body.Notes !== undefined) fields.Notes = req.body.Notes;
    const updated = await sheets.updateRowFields('EventItinerary', 'ItineraryID', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Itinerary item not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/itinerary/:id', requireBoard, async (req, res) => {
  try {
    const ok = await sheets.deleteRow('EventItinerary', 'ItineraryID', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Itinerary item not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
