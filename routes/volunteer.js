'use strict';

// Event volunteer positions & signups API. Mounted at /api alongside
// routes/events.js. Board-only routes use requireBoard; the sign-up route and
// position listings are open to any authenticated user (volunteers included).

const express   = require('express');
const router    = express.Router();
const volunteer = require('../lib/volunteer');
const sheets    = require('../lib/sheets');
const { requireAuth, requireBoard } = require('../middleware/auth');

router.use(requireAuth);

// ── Positions ────────────────────────────────────────────────────────────────

router.get('/events/:id/positions', async (req, res) => {
  try {
    res.json(await volunteer.getPositionsByEvent(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/positions', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!(b.Title || '').trim()) return res.status(400).json({ error: 'Position title is required.' });
    const pos = await volunteer.createPosition(req.params.id, b);
    const approvedBy = req.user.name || req.user.email;

    if (b.AssignMemberID) {
      const member = await sheets.getMemberById(b.AssignMemberID);
      if (member) {
        await volunteer.assignMember(req.params.id, pos.PositionID, member, approvedBy, '');
        const [refreshed] = (await volunteer.getPositionsByEvent(req.params.id))
          .filter(p => p.PositionID === pos.PositionID);
        return res.json(refreshed || pos);
      }
    }
    res.json(pos);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/events/:id/positions/:posId', requireBoard, async (req, res) => {
  try {
    const updated = await volunteer.updatePosition(req.params.posId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Position not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/events/:id/positions/:posId', requireBoard, async (req, res) => {
  try {
    const ok = await volunteer.deletePosition(req.params.posId);
    if (!ok) return res.status(404).json({ error: 'Position not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Board manually assigns an existing contact to a position — creates a
// pre-approved signup and auto-enrolls them as a confirmed registrant.
router.post('/events/:id/positions/:posId/assign', requireBoard, async (req, res) => {
  try {
    const { MemberID, Notes } = req.body || {};
    if (!MemberID) return res.status(400).json({ error: 'MemberID is required.' });
    const member = await sheets.getMemberById(MemberID);
    if (!member) return res.status(404).json({ error: 'Contact not found.' });
    const signup = await volunteer.assignMember(
      req.params.id, req.params.posId, member,
      req.user.name || req.user.email, Notes || ''
    );
    const [position] = (await volunteer.getPositionsByEvent(req.params.id))
      .filter(p => p.PositionID === req.params.posId);
    res.json({ ok: true, signup, position });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Signups ──────────────────────────────────────────────────────────────────

// All signups for an event — used by the registrations edit panel to show a
// registrant's volunteer role.
router.get('/events/:id/signups', requireBoard, async (req, res) => {
  try {
    res.json(await volunteer.getSignupsByEvent(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/events/:id/positions/:posId/signups', requireBoard, async (req, res) => {
  try {
    res.json(await volunteer.getSignupsByPosition(req.params.posId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Volunteer/member self sign-up (or Board signing someone up). Writes a
// pending signup; name pre-fills from the logged-in user when not supplied.
router.post('/events/:id/positions/:posId/signup', async (req, res) => {
  try {
    const b = req.body || {};
    const name  = (b.ContactName || req.user.name || '').trim();
    const email = (b.Email || req.user.email || '').trim();
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
    const row = await volunteer.createSignup(req.params.id, req.params.posId, {
      ContactName: name, Email: email, Phone: b.Phone || '', Notes: b.Notes || '', Status: 'pending'
    });
    res.json({ ok: true, signup: row });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/events/:id/positions/:posId/signups/:signupId', requireBoard, async (req, res) => {
  try {
    const status = (req.body || {}).Status;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved, rejected, or pending.' });
    }
    const updated = await volunteer.updateSignupStatus(req.params.signupId, status, req.user.name || req.user.email);
    if (!updated) return res.status(404).json({ error: 'Signup not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
