'use strict';

const https  = require('https');
const express = require('express');
const router  = express.Router();
const sheets  = require('../lib/sheets');
const { requireAuth, requireBoard } = require('../middleware/auth');

router.use(requireAuth);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Nominatim geocoder — no key needed, rate-limit: 1 req/sec.
// Returns { lat, lng } strings or null.
async function geocode(address, city, state, zip) {
  const parts = [address, city, state, zip].filter(Boolean).join(', ');
  if (!parts.trim()) return null;
  return new Promise((resolve) => {
    const q = encodeURIComponent(parts);
    const options = {
      hostname: 'nominatim.openstreetmap.org',
      path: `/search?q=${q}&format=json&limit=1&addressdetails=0`,
      headers: { 'User-Agent': 'ROCK-Hub/1.0 (hub.gorock.org; roldorlogic@gmail.com)' }
    };
    const req = https.get(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(raw);
          if (results && results[0]) {
            resolve({ lat: String(results[0].lat), lng: String(results[0].lon) });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// GET /api/youth-groups
router.get('/youth-groups', async (req, res) => {
  try {
    res.json(await sheets.getYouthGroups());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/youth-groups/:id — group detail + linked contacts
router.get('/youth-groups/:id', async (req, res) => {
  try {
    const group = await sheets.getYouthGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Youth group not found.' });
    const members  = await sheets.getMembers();
    const contacts = members.filter(m => m.youth_group_id === req.params.id);
    res.json({ ...group, contacts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/youth-groups
router.post('/youth-groups', requireBoard, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.youth_group_name && !b.church_name) {
      return res.status(400).json({ error: 'youth_group_name or church_name is required.' });
    }
    if (b.category && !['Prospect', 'Partner'].includes(b.category)) {
      return res.status(400).json({ error: 'category must be Prospect or Partner.' });
    }
    const now = todayStr();
    const id  = `YG-${Date.now()}`;

    let lat = '', lng = '';
    if (b.address || b.city || b.state) {
      const coords = await geocode(b.address, b.city, b.state, b.zip);
      if (coords) { lat = coords.lat; lng = coords.lng; }
    }

    const row = await sheets.appendRow('YouthGroups', {
      id,
      youth_group_name:      b.youth_group_name      || '',
      church_name:           b.church_name           || '',
      address:               b.address               || '',
      city:                  b.city                  || '',
      state:                 b.state                 || '',
      zip:                   b.zip                   || '',
      lat, lng,
      category:              b.category              || 'Prospect',
      primary_contact_id:    b.primary_contact_id    || '',
      primary_contact_name:  b.primary_contact_name  || '',
      primary_contact_phone: b.primary_contact_phone || '',
      primary_contact_email: b.primary_contact_email || '',
      tags:                  b.tags                  || '',
      notes:                 b.notes                 || '',
      created_at: now,
      updated_at: now
    });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/youth-groups/:id
router.patch('/youth-groups/:id', requireBoard, async (req, res) => {
  try {
    const allowed = ['youth_group_name', 'church_name', 'address', 'city', 'state', 'zip',
                     'category', 'primary_contact_id', 'primary_contact_name',
                     'primary_contact_phone', 'primary_contact_email', 'tags', 'notes'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });
    if (fields.category && !['Prospect', 'Partner'].includes(fields.category)) {
      return res.status(400).json({ error: 'category must be Prospect or Partner.' });
    }

    // Re-geocode when any address field changed
    const addrKeys = ['address', 'city', 'state', 'zip'];
    if (addrKeys.some(k => fields[k] !== undefined)) {
      const existing = await sheets.getYouthGroupById(req.params.id);
      if (existing) {
        const addr  = fields.address !== undefined ? fields.address : existing.address;
        const city  = fields.city    !== undefined ? fields.city    : existing.city;
        const state = fields.state   !== undefined ? fields.state   : existing.state;
        const zip   = fields.zip     !== undefined ? fields.zip     : existing.zip;
        const coords = await geocode(addr, city, state, zip);
        if (coords) { fields.lat = coords.lat; fields.lng = coords.lng; }
      }
    }

    fields.updated_at = todayStr();
    const updated = await sheets.updateRowFields('YouthGroups', 'id', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Youth group not found.' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/youth-groups/:id
router.delete('/youth-groups/:id', requireBoard, async (req, res) => {
  try {
    const ok = await sheets.deleteRow('YouthGroups', 'id', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Youth group not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
