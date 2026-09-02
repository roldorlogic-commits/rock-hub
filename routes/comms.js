'use strict';

const express = require('express');
const comms   = require('../lib/comms');
const sms     = require('../lib/sms');
const { requireBoard } = require('../middleware/auth');

const router = express.Router();
router.use(requireBoard);

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const settings = await comms.loadSettings();
    // Include read-only sender info
    res.json({
      ...settings,
      _senderPhone: process.env.TWILIO_PHONE_NUMBER || null,
      _senderEmail: process.env.SENDGRID_FROM_EMAIL || 'info@gorock.org'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = Object.keys(comms.DEFAULTS);
    const update  = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = String(req.body[key]);
    }
    await comms.updateSettings(update, req.user.email);
    const settings = await comms.loadSettings();
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview: given a body string, return the final branded SMS
router.post('/settings/preview-sms', async (req, res) => {
  try {
    const body     = String(req.body.body || 'Sample message text.');
    const settings = await comms.loadSettings();
    const result   = await comms.applySmsBranding(body, settings);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Templates ─────────────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  try {
    const templates = await comms.getTemplates();
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, channel, subject, body, variables } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
    const id = await comms.createTemplate({ name, channel, subject, body, variables, createdBy: req.user.email });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const { name, channel, subject, body, variables } = req.body;
    const result = await comms.updateTemplate(req.params.id, { Name: name, Channel: channel, Subject: subject, Body: body, Variables: variables }, req.user.email);
    if (!result) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const deleted = await comms.deleteTemplate(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Opt-outs ──────────────────────────────────────────────────────────────────

router.get('/optouts', async (req, res) => {
  try {
    const rows = await comms.getOptOuts();
    // Enrich with member name if available
    const sheets = require('../lib/sheets');
    const members = await sheets.getMembers();
    const byPhone = new Map(members.filter(m => m.Phone).map(m => [sms.normalizePhone(m.Phone), `${m.FirstName || ''} ${m.LastName || ''}`.trim()]));
    const enriched = rows.map(r => ({ ...r, contactName: byPhone.get(r.Phone) || null }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/optouts/:phone/resubscribe', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    await comms.markOptIn(phone, req.user.email);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
