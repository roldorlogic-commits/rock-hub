'use strict';

const express = require('express');
const router  = express.Router();
const sheets  = require('../lib/sheets');
const { requireAuth, requireBoard } = require('../middleware/auth');

router.use(requireAuth);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Geocodio geocoder — returns { lat, lng } strings or null.
// Progressive fallback: full address → city/state/zip → zip only.
async function geocodeOnce(q) {
  const key = process.env.GEOCODIO_API_KEY;
  if (!key) return null;
  try {
    const url = `https://api.geocod.io/v1.7/geocode?q=${encodeURIComponent(q)}&country=US&limit=1&api_key=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const result = data?.results?.[0];
    if (result?.location) {
      return { lat: String(result.location.lat), lng: String(result.location.lng) };
    }
    return null;
  } catch { return null; }
}

async function geocode(address, city, state, zip) {
  const attempts = [
    [address, city, state, zip],
    [city, state, zip],
    [zip],
  ].map(parts => parts.filter(Boolean).join(', ')).filter(s => s.trim());

  for (let i = 0; i < attempts.length; i++) {
    const q = attempts[i];
    console.log(`[geocode] attempt ${i + 1}/${attempts.length}: "${q}"`);
    const result = await geocodeOnce(q);
    if (result) {
      if (i > 0) console.log(`[geocode] resolved at fallback level ${i + 1}: "${q}" → ${result.lat},${result.lng}`);
      return result;
    }
    console.warn(`[geocode] no result for: "${q}"`);
  }
  console.error(`[geocode] all attempts failed for address="${address}" city="${city}" state="${state}" zip="${zip}"`);
  return null;
}

// GET /api/youth-groups/geocodio?q=... — Geocodio autocomplete proxy.
// Must be registered before /:id to avoid capturing "geocodio" as an ID param.
router.get('/youth-groups/geocodio', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const key = process.env.GEOCODIO_API_KEY;
  if (!key) {
    console.warn('[geocodio] GEOCODIO_API_KEY not set — returning empty suggestions');
    return res.json([]);
  }
  try {
    const url = `https://api.geocod.io/v1.7/suggest?q=${encodeURIComponent(q)}&country=US&api_key=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.error(`[geocodio] suggest HTTP ${r.status}:`, err.slice(0, 300));
      return res.json([]);
    }
    const data = await r.json();

    // Log raw response to diagnose format (temporary)
    console.log('[geocodio] suggest raw:', JSON.stringify(data).slice(0, 500));

    const suggestions = (data?.suggestions || []).map(s => {
      // Handle both string suggestions and object suggestions
      if (typeof s === 'string') {
        return { label: s, address: '', city: '', state: '', zip: '', lat: '', lng: '' };
      }
      const ac    = s.addressComponents || {};
      const num   = ac.number || '';
      const pre   = ac.predirectional ? ac.predirectional + ' ' : '';
      const st    = ac.street || '';
      const sfx   = ac.suffix || '';
      const addr  = [num, (pre + st + (sfx ? ' ' + sfx : '')).trim()].filter(Boolean).join(' ').trim();
      const city  = ac.city  || '';
      const state = ac.state || '';
      const zip   = (ac.zip  || '').slice(0, 5);
      const label = s.value || [addr, city, state, zip].filter(Boolean).join(', ');
      return { label, address: addr, city, state, zip, lat: '', lng: '' };
    }).filter(s => s.label);

    res.json(suggestions);
  } catch (err) {
    console.error('[geocodio] suggest error:', err.message);
    res.json([]);
  }
});

// GET /api/youth-groups/geocode-point?q=... — single geocode for autocomplete selection.
// Called by the frontend when the user picks a suggestion (no coords in suggest results).
router.get('/youth-groups/geocode-point', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ lat: '', lng: '' });
  const coords = await geocodeOnce(q);
  res.json(coords || { lat: '', lng: '' });
});

// GET /api/youth-groups
router.get('/youth-groups', async (req, res) => {
  try {
    res.json(await sheets.getYouthGroups());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/youth-groups/:id — group detail + linked contacts (with resolved names)
router.get('/youth-groups/:id', async (req, res) => {
  try {
    const group = await sheets.getYouthGroupById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Youth group not found.' });
    const members  = await sheets.getMembers();
    const contacts = members.filter(m => m.youth_group_id === req.params.id);

    // Resolve primary_contact_id → display name so the UI never shows a raw M- ID
    let resolvedGroup = { ...group };
    if (group.primary_contact_id) {
      const pc = members.find(m => m.MemberID === group.primary_contact_id);
      if (pc) {
        const name = [pc.FirstName, pc.LastName].filter(Boolean).join(' ') || pc.Email || '';
        if (name) resolvedGroup.primary_contact_name = name;
      }
    }

    res.json({ ...resolvedGroup, contacts });
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

    let lat = '', lng = '', location_type = '';

    // Autocomplete path: form sent exact coords — skip geocoder entirely.
    const hasExactCoords = b.lat && b.lng &&
      !isNaN(parseFloat(b.lat)) && !isNaN(parseFloat(b.lng));

    if (hasExactCoords) {
      lat = String(b.lat); lng = String(b.lng);
      location_type = 'exact';
      console.log(`[youth-groups] create id=${id}: using autocomplete coords lat=${lat} lng=${lng}`);
    } else if (b.address || b.city || b.state || b.zip) {
      // Fallback: progressive Nominatim geocode
      console.log(`[youth-groups] geocoding on create: address="${b.address}" city="${b.city}" state="${b.state}" zip="${b.zip}"`);
      const coords = await geocode(b.address, b.city, b.state, b.zip);
      if (coords) {
        lat = coords.lat; lng = coords.lng;
        location_type = 'approximate';
        console.log(`[youth-groups] geocode result: lat=${lat} lng=${lng}`);
      } else {
        console.warn(`[youth-groups] geocode returned null on create — lat/lng blank for id=${id}`);
      }
    }

    const igHandle = (b.instagram_handle || '').replace(/^@/, '').trim();
    if (igHandle && !/^[\w.]+$/.test(igHandle)) {
      return res.status(400).json({ error: 'Instagram handle may only contain letters, numbers, periods, and underscores.' });
    }

    console.log(`[youth-groups] appending row id=${id} lat="${lat}" lng="${lng}" location_type="${location_type}"`);
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
      location_type,
      created_at: now,
      updated_at: now,
      instagram_handle:      igHandle
    });
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/youth-groups/:id
router.patch('/youth-groups/:id', requireBoard, async (req, res) => {
  try {
    const allowed = ['youth_group_name', 'church_name', 'address', 'city', 'state', 'zip',
                     'category', 'primary_contact_id', 'primary_contact_name',
                     'primary_contact_phone', 'primary_contact_email', 'tags', 'notes',
                     'instagram_handle'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update.' });
    if (fields.category && !['Prospect', 'Partner'].includes(fields.category)) {
      return res.status(400).json({ error: 'category must be Prospect or Partner.' });
    }
    if (fields.instagram_handle !== undefined) {
      fields.instagram_handle = (fields.instagram_handle || '').replace(/^@/, '').trim();
      if (fields.instagram_handle && !/^[\w.]+$/.test(fields.instagram_handle)) {
        return res.status(400).json({ error: 'Instagram handle may only contain letters, numbers, periods, and underscores.' });
      }
    }

    // Autocomplete path: form sent exact coords — write them directly, skip geocoder.
    const hasExactCoords = req.body.lat && req.body.lng &&
      !isNaN(parseFloat(req.body.lat)) && !isNaN(parseFloat(req.body.lng));

    if (hasExactCoords) {
      fields.lat = String(req.body.lat);
      fields.lng = String(req.body.lng);
      fields.location_type = 'exact';
      console.log(`[youth-groups] edit ${req.params.id}: using autocomplete coords lat=${fields.lat} lng=${fields.lng}`);
    } else {
      // Fallback: re-geocode when any address field changed
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
              fields.location_type = 'approximate';
              console.log(`[youth-groups] geocode result on edit: lat=${fields.lat} lng=${fields.lng}`);
            } else {
              console.warn(`[youth-groups] geocode returned null on edit ${req.params.id}`);
            }
          }
        }
      }
    }

    fields.updated_at = todayStr();

    // Before updating, read the current group to detect primary_contact_id changes.
    const existing = await sheets.getYouthGroupById(req.params.id).catch(() => null);

    const updated = await sheets.updateRowFields('YouthGroups', 'id', req.params.id, fields);
    if (!updated) return res.status(404).json({ error: 'Youth group not found.' });

    // ── Sync primary_contact_id ↔ Members.youth_group_id ─────────────────────
    if (fields.primary_contact_id !== undefined) {
      const newContactId = fields.primary_contact_id || '';
      const oldContactId = existing?.primary_contact_id || '';

      // Unlink the old primary contact (clear their youth_group_id if it points here)
      if (oldContactId && oldContactId !== newContactId) {
        const oldMember = await sheets.getMemberById(oldContactId).catch(() => null);
        if (oldMember && oldMember.youth_group_id === req.params.id) {
          await sheets.updateRowFields('Members', 'MemberID', oldContactId, { youth_group_id: '' });
        }
      }
      // Link the new primary contact
      if (newContactId) {
        await sheets.updateRowFields('Members', 'MemberID', newContactId, { youth_group_id: req.params.id });
      }
    }

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
    for (const g of missing) {
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
