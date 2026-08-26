'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const sheets   = require('../lib/sheets');
const drive    = require('../lib/drive');
const documents = require('../lib/documents');
const email    = require('../lib/email');
const sms      = require('../lib/sms');
const { requireAuth, requireBoard, requireBoardOrAdmin } = require('../middleware/auth');
const dedupe   = require('../lib/dedupe');

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
    const [volunteers, tasks, youthGroups] = await Promise.all([
      sheets.getVolunteers(),
      sheets.getTasks(),
      sheets.getYouthGroups()
    ]);
    res.json({
      partners:         youthGroups.filter(g => g.category === 'Partner').length,
      prospects:        youthGroups.filter(g => g.category === 'Prospect').length,
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

// ── Shared Drive documents (Documents tab) ──────────────────────────────────
// Lists every hub-managed file from the shared drive, tagged with its section
// and event. Powers the Documents tab's list, filters, and event grouping.
router.get('/drive/documents', async (req, res) => {
  try {
    res.json(await documents.listAll());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Streams a shared-drive file back through the app so it works for any logged-in
// user regardless of their own Drive access. Used for event photos (<img src>)
// and for viewing/downloading documents. `?download=1` forces a download.
router.get('/drive/file/:id', async (req, res) => {
  try {
    const meta = await drive.getFileMeta(req.params.id);
    // Google-native files (Docs/Sheets/Slides) can't be streamed as bytes —
    // send the viewer to Drive instead.
    if (meta.mimeType && meta.mimeType.startsWith('application/vnd.google-apps')) {
      return res.redirect(meta.webViewLink || `https://drive.google.com/file/d/${req.params.id}/view`);
    }
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const disp = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disp}; filename="${encodeURIComponent(meta.name || 'file')}"`);
    const stream = await drive.getFileStream(req.params.id);
    stream.on('error', err => { if (!res.headersSent) res.status(502).json({ error: err.message }); });
    stream.pipe(res);
  } catch (e) {
    const code = e.code === 404 ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});
router.get('/userroles',     async (req, res) => { try { res.json(await sheets.getUserRoles());     } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Assignee picker — board members + active volunteers, deduplicated by email ─
router.get('/assignees', requireBoard, async (req, res) => {
  try {
    const [roles, volunteers] = await Promise.all([
      sheets.getUserRoles(),
      sheets.getVolunteers()
    ]);
    const seen = new Set();
    const list = [];
    for (const r of roles) {
      if (!r.Email) continue;
      const em = r.Email.toLowerCase();
      if (seen.has(em)) continue;
      seen.add(em);
      const name = [r.FirstName, r.LastName].filter(Boolean).join(' ') || r.Email;
      list.push({ name, email: r.Email, role: r.Role || 'Board' });
    }
    for (const v of volunteers) {
      if (v.Status !== 'Active' || !v.Email) continue;
      const em = v.Email.toLowerCase();
      if (seen.has(em)) continue;
      seen.add(em);
      const name = [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email;
      list.push({ name, email: v.Email, role: 'Volunteer' });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// ── Contact merge tool (Board only) ──────────────────────────────────────────
// Must be defined before /members/:id to avoid :id catching 'merge-preview'.

router.get('/members/merge-preview', requireBoard, async (req, res) => {
  const { a, b } = req.query;
  if (!a || !b) return res.status(400).json({ error: 'Both a and b member IDs are required.' });
  try {
    const [memberA, memberB] = await Promise.all([sheets.getMemberById(a), sheets.getMemberById(b)]);
    if (!memberA) return res.status(404).json({ error: 'Contact A not found.' });
    if (!memberB) return res.status(404).json({ error: 'Contact B not found.' });
    const [authA, authB] = await Promise.all([
      memberA.Email ? sheets.findVolunteerAuthByEmail(memberA.Email) : null,
      memberB.Email ? sheets.findVolunteerAuthByEmail(memberB.Email) : null
    ]);
    res.json({ a: memberA, b: memberB, aHasLogin: !!authA, bHasLogin: !!authB });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/members/merge', requireBoard, async (req, res) => {
  const { primaryId, secondaryId } = req.body || {};
  if (!primaryId || !secondaryId) return res.status(400).json({ error: 'primaryId and secondaryId are required.' });
  if (primaryId === secondaryId) return res.status(400).json({ error: 'Cannot merge a record with itself.' });
  try {
    const [primary, secondary] = await Promise.all([
      sheets.getMemberById(primaryId), sheets.getMemberById(secondaryId)
    ]);
    if (!primary)   return res.status(404).json({ error: 'Primary contact not found.' });
    if (!secondary) return res.status(404).json({ error: 'Secondary contact not found.' });

    // Field merge: primary wins on non-empty; secondary fills blanks.
    const SCALAR_FIELDS = ['FirstName', 'LastName', 'Email', 'Phone', 'MembershipType', 'MembershipStatus', 'JoinDate', 'youth_group_id'];
    const merged = {};
    for (const f of SCALAR_FIELDS) merged[f] = primary[f] || secondary[f] || '';
    // Tags: union of both tag sets.
    const tagsA = (primary.Tags   || '').split(',').map(t => t.trim()).filter(Boolean);
    const tagsB = (secondary.Tags || '').split(',').map(t => t.trim()).filter(Boolean);
    merged.Tags = [...new Set([...tagsA, ...tagsB])].join(',');
    // Notes: concatenate if distinct.
    const noteA = (primary.Notes   || '').trim();
    const noteB = (secondary.Notes || '').trim();
    merged.Notes = (noteA && noteB && noteA !== noteB)
      ? `${noteA}\n[Merged from ${secondary.Email || secondary.MemberID}]: ${noteB}`
      : (noteA || noteB);
    // Volunteer flag: either true → true.
    if (primary.is_volunteer === 'true' || secondary.is_volunteer === 'true') merged.is_volunteer = 'true';

    const transferred = [];

    // Re-point related records from secondary email to primary email.
    if (secondary.Email && primary.Email &&
        secondary.Email.toLowerCase() !== primary.Email.toLowerCase()) {
      const secEmail = secondary.Email.toLowerCase();
      const primEmail = primary.Email;

      const [regs, signups, hoursRows, allVols] = await Promise.all([
        sheets.getEventRegistrations(),
        sheets.getVolunteerSignups(),
        sheets.getHoursLog(),
        sheets.getVolunteers()
      ]);
      for (const r of regs) {
        if (r.Email?.toLowerCase() === secEmail) {
          await sheets.updateRowFields('EventRegistrations', 'RegistrationID', r.RegistrationID, { Email: primEmail });
          transferred.push(`Reg:${r.RegistrationID}`);
        }
      }
      for (const s of signups) {
        if (s.Email?.toLowerCase() === secEmail) {
          await sheets.updateRowFields('VolunteerSignups', 'SignupID', s.SignupID, { Email: primEmail });
          transferred.push(`Signup:${s.SignupID}`);
        }
      }
      for (const h of hoursRows) {
        if (h.Email?.toLowerCase() === secEmail) {
          await sheets.updateRowFields('HoursLog', 'HoursID', h.HoursID, { Email: primEmail });
        }
      }

      // Volunteers row: reparent or merge hours.
      const secVol  = allVols.find(v => v.Email?.toLowerCase() === secEmail);
      const primVol = allVols.find(v => v.Email?.toLowerCase() === primary.Email.toLowerCase());
      if (secVol && !primVol) {
        await sheets.updateRowFields('Volunteers', 'VolunteerID', secVol.VolunteerID, { Email: primEmail });
        transferred.push(`VolRow:${secVol.VolunteerID}`);
      } else if (secVol && primVol) {
        const addHours = parseFloat(secVol.HoursLogged) || 0;
        if (addHours > 0) {
          const newHours = (parseFloat(primVol.HoursLogged) || 0) + addHours;
          await sheets.updateRowFields('Volunteers', 'VolunteerID', primVol.VolunteerID, { HoursLogged: String(newHours) });
        }
        await sheets.deleteRow('Volunteers', 'VolunteerID', secVol.VolunteerID);
        transferred.push(`VolMerge:${secVol.VolunteerID}`);
      }

      // VolunteerAuth: give primary the auth row if they don't have one.
      const [secAuth, primAuth] = await Promise.all([
        sheets.findVolunteerAuthByEmail(secEmail),
        sheets.findVolunteerAuthByEmail(primary.Email.toLowerCase())
      ]);
      if (secAuth && !primAuth) {
        await sheets.updateRowFields('VolunteerAuth', 'Email', secAuth.Email, { Email: primEmail });
        transferred.push('VolunteerAuth');
      }
    }

    await sheets.updateRowFields('Members', 'MemberID', primaryId, merged);
    await sheets.deleteRow('Members', 'MemberID', secondaryId);
    await sheets.appendRow('MergeLog', {
      MergeID: `MERGE-${Date.now()}`,
      PrimaryMemberID: primaryId, SecondaryMemberID: secondaryId,
      MergedBy: req.user.email, MergedAt: todayStr(),
      FieldsTransferred: transferred.join('; '), Notes: ''
    });

    res.json({ ok: true, primaryId, transferred: transferred.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/members/not-duplicate', requireBoard, async (req, res) => {
  const { memberIdA, memberIdB, note } = req.body || {};
  if (!memberIdA || !memberIdB) return res.status(400).json({ error: 'memberIdA and memberIdB are required.' });
  try {
    await sheets.appendRow('DedupeReviews', {
      PairID: `PAIR-${Date.now()}`, MemberID_A: memberIdA, MemberID_B: memberIdB,
      ReviewedBy: req.user.email, ReviewedAt: todayStr(), Note: note || ''
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/members/:id', requireBoard, async (req, res) => {
  try {
    const allowed = ['FirstName', 'LastName', 'Email', 'Phone', 'Tags', 'MembershipType', 'MembershipStatus', 'Notes', 'youth_group_id'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });

    // Read before so we know the old email (needed for cross-sheet sync).
    const before = await sheets.getMemberById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Member not found.' });

    const updated = await sheets.updateRowFields('Members', 'MemberID', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Member not found.' });

    // ── Propagate identity changes to Volunteers / VolunteerAuth ─────────────
    const identityKeys = ['FirstName', 'LastName', 'Email', 'Phone'];
    const hasIdentity  = identityKeys.some(k => fields[k] !== undefined);
    if (hasIdentity) {
      const oldEmail  = (before.Email  || '').toLowerCase();
      const newEmail  = (fields.Email  !== undefined ? fields.Email : before.Email || '').toLowerCase();

      const vols = await sheets.getVolunteers();
      const volRow = oldEmail ? vols.find(v => (v.Email || '').toLowerCase() === oldEmail) : null;
      if (volRow) {
        const volFields = {};
        if (fields.FirstName !== undefined) volFields.FirstName = fields.FirstName;
        if (fields.LastName  !== undefined) volFields.LastName  = fields.LastName;
        if (fields.Email     !== undefined) volFields.Email     = fields.Email;
        if (fields.Phone     !== undefined) volFields.Phone     = fields.Phone;
        await sheets.updateRowFields('Volunteers', 'VolunteerID', volRow.VolunteerID, volFields);
      }

      if (fields.Email && oldEmail && oldEmail !== newEmail) {
        // Update VolunteerAuth login email
        const authRow = await sheets.findVolunteerAuthByEmail(oldEmail);
        if (authRow) {
          await sheets.updateRowFields('VolunteerAuth', 'Email', authRow.Email, { Email: newEmail });
        }
        // Re-point all EventRegistrations from old to new email
        const allRegs = await sheets.getEventRegistrations();
        for (const r of allRegs) {
          if ((r.Email || '').toLowerCase() === oldEmail) {
            await sheets.updateRowFields('EventRegistrations', 'RegistrationID', r.RegistrationID, { Email: fields.Email });
          }
        }
        // Re-point VolunteerSignups
        const allSigs = await sheets.getVolunteerSignups();
        for (const s of allSigs) {
          if ((s.Email || '').toLowerCase() === oldEmail) {
            await sheets.updateRowFields('VolunteerSignups', 'SignupID', s.SignupID, { Email: fields.Email });
          }
        }
      }
    }

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

// Approval flow — three modes via `action` body param:
//   (none)   → run dedupe; if match found, return without activating so board can choose
//   'create' → skip dedupe gate; create a new Members row + activate
//   'link'   → link linkMemberID contact as volunteer + activate
router.post('/volunteers/:id/confirm', requireBoardOrAdmin, async (req, res) => {
  try {
    const { action, linkMemberID } = req.body || {};
    const [authRow, volRow] = await Promise.all([
      sheets.findRow('VolunteerAuth', 'VolunteerID', req.params.id),
      sheets.getVolunteerById(req.params.id)
    ]);
    if (!authRow) return res.status(404).json({ error: 'Volunteer registration not found.' });
    if (!volRow)  return res.status(404).json({ error: 'Volunteer record not found.' });

    if (action === 'link') {
      if (!linkMemberID) return res.status(400).json({ error: 'linkMemberID is required.' });
      const member = await sheets.getMemberById(linkMemberID);
      if (!member) return res.status(404).json({ error: 'Contact not found.' });
      await sheets.updateRowFields('Members', 'MemberID', linkMemberID, { is_volunteer: 'true' });
    } else {
      // Run dedupe unless the board explicitly chose to create
      if (action !== 'create') {
        const dupeResult = await dedupe.checkDupe(
          volRow.FirstName, volRow.LastName, authRow.Email, volRow.Phone
        );
        if (dupeResult.type === 'exact') {
          return res.status(409).json({ code: 'exact_match', matches: dupeResult.matches });
        }
        if (dupeResult.type === 'partial') {
          return res.json({ code: 'partial_match', matches: dupeResult.matches });
        }
      }
      // Create Members row for this volunteer
      await sheets.appendRow('Members', {
        MemberID: `M-${Date.now()}`,
        FirstName: volRow.FirstName, LastName: volRow.LastName,
        Email: authRow.Email, Phone: volRow.Phone || '',
        Tags: '', MembershipType: '', MembershipStatus: 'Active',
        JoinDate: todayStr(), Notes: volRow.Notes || '', is_volunteer: 'true'
      });
    }

    // Activate both rows and notify the volunteer
    await Promise.all([
      sheets.updateRowFields('Volunteers', 'VolunteerID', req.params.id, { Status: 'Active' }),
      sheets.updateRowFields('VolunteerAuth', 'Email', authRow.Email, { Status: 'Active', UpdatedAt: todayStr() })
    ]);
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

// ── Volunteer self-edit — must precede /:id ──────────────────────────────────
router.patch('/volunteers/me', async (req, res) => {
  try {
    const user = req.user;
    const vol = user.volunteerId
      ? await sheets.getVolunteerById(user.volunteerId)
      : (await sheets.getVolunteers()).find(v => v.Email?.toLowerCase() === (user.email || '').toLowerCase());
    if (!vol) return res.status(404).json({ error: 'No volunteer profile found.' });

    const allowed = ['Phone', 'PreferredRole', 'AvailabilityDays', 'Skills',
                     'EmergencyContactName', 'EmergencyContactPhone', 'EmergencyContactRelationship'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (req.body.Church !== undefined) {
      const withoutChurch = (vol.Notes || '').replace(/Church\/Org:\s*[^.]+\.?\s*/g, '').trim();
      fields.Notes = req.body.Church ? `Church/Org: ${req.body.Church}. ${withoutChurch}`.trim() : withoutChurch;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });
    const updated = await sheets.updateRowFields('Volunteers', 'VolunteerID', vol.VolunteerID, fields);
    if (!updated) return res.status(404).json({ error: 'Volunteer not found.' });
    res.json(updated);
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
    const allowed = ['FirstName', 'LastName', 'Email', 'Phone', 'PreferredRole', 'AvailabilityDays', 'Skills', 'Status', 'Notes',
                     'BackgroundCheckStatus', 'BackgroundCheckDate',
                     'EmergencyContactName', 'EmergencyContactPhone', 'EmergencyContactRelationship'];
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

// ── Board-initiated volunteer creation (with dedupe) ─────────────────────────
// action not set  → run dedupe; block on exact, warn on partial (no record created)
// action='create' → skip dedupe gate; create both Members+Volunteers rows
// action='link'   → upgrade an existing contact (linkMemberID) to is_volunteer=true
router.post('/volunteers', requireBoard, async (req, res) => {
  try {
    const { FirstName, LastName, Email, Phone, PreferredRole, AvailabilityDays, Skills, Notes, action, linkMemberID } = req.body || {};
    if (!FirstName || !LastName) return res.status(400).json({ error: 'First and last name are required.' });

    if (action === 'link') {
      if (!linkMemberID) return res.status(400).json({ error: 'linkMemberID is required for link action.' });
      const member = await sheets.getMemberById(linkMemberID);
      if (!member) return res.status(404).json({ error: 'Contact not found.' });
      if (member.is_volunteer === 'true') return res.status(400).json({ error: 'Contact is already flagged as a volunteer.' });
      const volID = `VOL${Date.now()}`;
      await Promise.all([
        sheets.updateRowFields('Members', 'MemberID', linkMemberID, { is_volunteer: 'true' }),
        sheets.appendRow('Volunteers', {
          VolunteerID: volID, FirstName: member.FirstName, LastName: member.LastName,
          Email: member.Email, Phone: member.Phone, Status: 'Active', JoinDate: todayStr(), HoursLogged: '0', Notes: Notes || ''
        })
      ]);
      return res.json({ ok: true, action: 'linked', memberID: linkMemberID, volID });
    }

    if (action !== 'create') {
      const dupeResult = await dedupe.checkDupe(FirstName, LastName, Email, Phone);
      if (dupeResult.type === 'exact') {
        return res.status(409).json({ code: 'exact_match', matches: dupeResult.matches });
      }
      if (dupeResult.type === 'partial') {
        return res.json({ code: 'partial_match', matches: dupeResult.matches });
      }
    }

    const memberID = `M-${Date.now()}`;
    const volID    = `VOL${Date.now() + 1}`;
    await Promise.all([
      sheets.appendRow('Members', {
        MemberID: memberID, FirstName, LastName, Email: Email || '', Phone: Phone || '',
        Tags: '', MembershipType: '', MembershipStatus: 'Active',
        JoinDate: todayStr(), Notes: Notes || '', is_volunteer: 'true'
      }),
      sheets.appendRow('Volunteers', {
        VolunteerID: volID, FirstName, LastName, Email: Email || '', Phone: Phone || '',
        Status: 'Active', JoinDate: todayStr(), HoursLogged: '0',
        PreferredRole: PreferredRole || '', AvailabilityDays: AvailabilityDays || '',
        Skills: Skills || '', Notes: Notes || ''
      })
    ]);
    res.json({ ok: true, action: 'created', memberID, volID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Upgrade an existing contact to volunteer ─────────────────────────────────
router.post('/members/:id/make-volunteer', requireBoard, async (req, res) => {
  try {
    const member = await sheets.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Contact not found.' });
    if (member.is_volunteer === 'true') return res.status(400).json({ error: 'Contact is already a volunteer.' });

    const volID = `VOL${Date.now()}`;
    const existingVol = (await sheets.getVolunteers())
      .find(v => v.Email?.toLowerCase() === member.Email?.toLowerCase());

    await sheets.updateRowFields('Members', 'MemberID', req.params.id, { is_volunteer: 'true' });
    if (!existingVol) {
      await sheets.appendRow('Volunteers', {
        VolunteerID: volID, FirstName: member.FirstName, LastName: member.LastName,
        Email: member.Email || '', Phone: member.Phone || '',
        Status: 'Active', JoinDate: todayStr(), HoursLogged: '0', Notes: ''
      });
    }
    res.json({ ok: true, memberID: req.params.id });
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
  const userEmail = (user.email || '').toLowerCase();
  if (task.AssigneeEmail && task.AssigneeEmail.toLowerCase() === userEmail) return true;
  const assignee = (task.AssignedTo || '').toLowerCase();
  return assignee === userEmail || assignee === (user.name || '').toLowerCase();
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
      Description:  b.Description  || '',
      AssignedTo:   b.AssignedTo   || '',
      AssigneeEmail:b.AssigneeEmail || '',
      DueDate:      b.DueDate      || '',
      Priority:     b.Priority     || 'Medium',
      Status:       b.Status       || 'Pending',
      Notes:        b.Notes        || '',
      Category:     b.Category     || '',
      CreatedAt:    todayStr()
    });
    const notifyEmail = b.AssigneeEmail || b.AssignedTo;
    if (notifyEmail) setImmediate(() => notifyTaskAssignment(row, notifyEmail));
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
    // Board can reassign and update description.
    if (req.user.role === 'Board') {
      if (req.body.Description !== undefined) fields.Description = req.body.Description;
      if (req.body.AssignedTo !== undefined) {
        fields.AssignedTo = req.body.AssignedTo;
        fields.AssigneeEmail = req.body.AssigneeEmail || '';
        const notifyEmail = req.body.AssigneeEmail || req.body.AssignedTo;
        if (notifyEmail && notifyEmail !== (task.AssigneeEmail || task.AssignedTo)) {
          setImmediate(() => notifyTaskAssignment({ ...task, ...fields }, notifyEmail));
        }
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
    // Direct (non-event) uploads land in the shared drive's General/ folder.
    const folderId = await drive.ensureRootFolder('General', process.env.DOCS_DRIVE_ID);
    const { fileId } = await drive.uploadFile(name, mimeType, buffer, folderId);
    const url = `/api/drive/file/${fileId}`;
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
// ── Volunteer login / access management (Board only) ─────────────────────────

router.get('/volunteers/:id/login-status', requireBoard, async (req, res) => {
  try {
    const vol = await sheets.getVolunteerById(req.params.id);
    if (!vol) return res.status(404).json({ error: 'Volunteer not found.' });
    if (!vol.Email) return res.json({ status: 'no_account', email: null, noEmail: true });
    const authRow = await sheets.findVolunteerAuthByEmail(vol.Email);
    if (!authRow) return res.json({ status: 'no_account', email: vol.Email });
    res.json({
      status:    authRow.Status || 'Unknown',
      email:     authRow.Email,
      mustReset: authRow.MustReset === 'true',
      createdAt: authRow.CreatedAt,
      updatedAt: authRow.UpdatedAt
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generate a temporary password (creates or replaces the auth record).
// Returns the plaintext temp password exactly once — it is never stored or logged.
router.post('/volunteers/:id/temp-password', requireBoard, async (req, res) => {
  try {
    const vol = await sheets.getVolunteerById(req.params.id);
    if (!vol) return res.status(404).json({ error: 'Volunteer not found.' });
    if (!vol.Email) return res.status(400).json({ error: 'This volunteer has no email address — add one before setting up login access.' });

    const tempPassword = crypto.randomBytes(9).toString('base64url'); // 12 URL-safe chars, 72 bits of entropy
    const hash = await bcrypt.hash(tempPassword, 10);
    const now  = todayStr();

    const existing = await sheets.findVolunteerAuthByEmail(vol.Email);
    if (existing) {
      await sheets.updateRowFields('VolunteerAuth', 'Email', vol.Email, {
        PasswordHash: hash, MustReset: 'true', Status: 'Active',
        ResetToken: '', ResetTokenExpiry: '', UpdatedAt: now
      });
    } else {
      await sheets.appendRow('VolunteerAuth', {
        Email: vol.Email.toLowerCase(), PasswordHash: hash,
        VolunteerID: req.params.id, Status: 'Active',
        MustReset: 'true', ResetToken: '', ResetTokenExpiry: '',
        CreatedAt: now, UpdatedAt: now
      });
    }
    res.json({ ok: true, tempPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/volunteers/:id/enable-login', requireBoard, async (req, res) => {
  try {
    const vol = await sheets.getVolunteerById(req.params.id);
    if (!vol) return res.status(404).json({ error: 'Volunteer not found.' });
    if (!vol.Email) return res.status(400).json({ error: 'This volunteer has no email address.' });
    const authRow = await sheets.findVolunteerAuthByEmail(vol.Email);
    if (!authRow) return res.status(404).json({ error: 'No login account found. Use "Set Temporary Password" to create one.' });
    await sheets.updateRowFields('VolunteerAuth', 'Email', vol.Email, { Status: 'Active', UpdatedAt: todayStr() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/volunteers/:id/disable-login', requireBoard, async (req, res) => {
  try {
    const vol = await sheets.getVolunteerById(req.params.id);
    if (!vol) return res.status(404).json({ error: 'Volunteer not found.' });
    if (!vol.Email) return res.status(400).json({ error: 'This volunteer has no email address.' });
    const authRow = await sheets.findVolunteerAuthByEmail(vol.Email);
    if (!authRow) return res.status(404).json({ error: 'No login account found.' });
    await sheets.updateRowFields('VolunteerAuth', 'Email', vol.Email, { Status: 'Disabled', UpdatedAt: todayStr() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
