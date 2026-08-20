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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Nominatim geocoder — no key needed, rate-limit: 1 req/sec.
// Returns { lat, lng } strings or null. Retries once after 1.5s on failure.
async function geocodeOnce(parts) {
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

async function geocode(address, city, state, zip) {
  // Try progressively less specific queries so we always get at least a
  // city/zip-level pin even when OSM hasn't indexed the exact street.
  const attempts = [
    [address, city, state, zip],  // full address
    [city, state, zip],            // city + state + zip  (drops street)
    [zip],                         // zip only
  ].map(parts => parts.filter(Boolean).join(', ')).filter(s => s.trim());

  for (let i = 0; i < attempts.length; i++) {
    const q = attempts[i];
    if (i > 0) await sleep(1100); // respect Nominatim 1 req/sec
    console.log(`[geocode] attempt ${i + 1}/${attempts.length}: "${q}"`);
    const result = await geocodeOnce(q);
    if (result) {
      if (i > 0) console.log(`[geocode] resolved at fallback level ${i + 1}: "${q}" → ${result.lat},${result.lng}`);
      return result;
    }
    // Retry the same query once on failure before moving to next fallback
    await sleep(1100);
    const retry = await geocodeOnce(q);
    if (retry) {
      console.log(`[geocode] resolved on retry at level ${i + 1}: "${q}" → ${retry.lat},${retry.lng}`);
      return retry;
    }
    console.warn(`[geocode] no result for: "${q}"`);
  }
  console.error(`[geocode] all attempts failed for address="${address}" city="${city}" state="${state}" zip="${zip}"`);
  return null;
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
    if (b.address || b.city || b.state || b.zip) {
      console.log(`[youth-groups] geocoding on create: address="${b.address}" city="${b.city}" state="${b.state}" zip="${b.zip}"`);
      const coords = await geocode(b.address, b.city, b.state, b.zip);
      if (coords) {
        lat = coords.lat; lng = coords.lng;
        console.log(`[youth-groups] geocode result: lat=${lat} lng=${lng}`);
      } else {
        console.warn(`[youth-groups] geocode returned null on create — lat/lng will be blank for id=${id}`);
      }
    }
    console.log(`[youth-groups] appending row id=${id} lat="${lat}" lng="${lng}"`);
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
        if (addr || city || state || zip) {
          console.log(`[youth-groups] geocoding on edit ${req.params.id}: address="${addr}" city="${city}" state="${state}" zip="${zip}"`);
          const coords = await geocode(addr, city, state, zip);
          if (coords) {
            fields.lat = coords.lat; fields.lng = coords.lng;
            console.log(`[youth-groups] geocode result on edit: lat=${fields.lat} lng=${fields.lng}`);
          } else {
            console.warn(`[youth-groups] geocode returned null on edit ${req.params.id} — lat/lng not updated`);
          }
        }
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

// POST /api/youth-groups/geocode-backfill — Board only.
// Geocodes any YouthGroups rows that have an address but missing lat/lng.
// Respects Nominatim's 1 req/sec policy.
router.post('/youth-groups/geocode-backfill', requireBoard, async (req, res) => {
  try {
    const groups = await sheets.getYouthGroups();
    const missing = groups.filter(g =>
      (g.address || g.city || g.state || g.zip) && (!g.lat || !g.lng)
    );
    let filled = 0, failed = 0;
    for (const g of missing) {
      if (filled + failed > 0) await sleep(1100); // 1 req/sec Nominatim policy
      const coords = await geocode(g.address, g.city, g.state, g.zip);
      if (coords) {
        await sheets.updateRowFields('YouthGroups', 'id', g.id, {
          lat: coords.lat,
          lng: coords.lng,
          updated_at: todayStr()
        });
        console.log(`[geocode-backfill] OK: ${g.id} → ${coords.lat},${coords.lng}`);
        filled++;
      } else {
        console.warn(`[geocode-backfill] FAILED: ${g.id} (${g.address}, ${g.city}, ${g.state} ${g.zip})`);
        failed++;
      }
    }
    res.json({ total: missing.length, filled, failed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Exported for boot-time use (server.js can call this without HTTP).
async function runGeocodeBackfill() {
  try {
    const groups = await sheets.getYouthGroups();
    const missing = groups.filter(g =>
      (g.address || g.city || g.state || g.zip) && (!g.lat || !g.lng)
    );
    if (!missing.length) return;
    console.log(`[geocode-backfill] ${missing.length} group(s) need geocoding…`);
    for (let i = 0; i < missing.length; i++) {
      const g = missing[i];
      if (i > 0) await sleep(1100);
      const coords = await geocode(g.address, g.city, g.state, g.zip);
      if (coords) {
        await sheets.updateRowFields('YouthGroups', 'id', g.id, {
          lat: coords.lat, lng: coords.lng, updated_at: todayStr()
        });
        console.log(`[geocode-backfill] ${g.id} → ${coords.lat},${coords.lng}`);
      } else {
        console.warn(`[geocode-backfill] no result for ${g.id}`);
      }
    }
  } catch (err) {
    console.error('[geocode-backfill] error:', err.message);
  }
}

module.exports = router;
module.exports.runGeocodeBackfill = runGeocodeBackfill;
