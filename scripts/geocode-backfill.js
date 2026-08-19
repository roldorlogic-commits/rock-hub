#!/usr/bin/env node
'use strict';

// One-shot script: geocode YouthGroup rows that have an address but no lat/lng.
// Run from the project root:  node scripts/geocode-backfill.js
// Respects Nominatim's 1 req/sec policy (sleeps 1.1s between calls).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https  = require('https');
const sheets = require('../lib/sheets');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocode(address, city, state, zip) {
  const parts = [address, city, state, zip].filter(Boolean).join(', ');
  if (!parts.trim()) return null;
  await sleep(1100);
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
          } else { resolve(null); }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const groups  = await sheets.getYouthGroups();
  const missing = groups.filter(g => !g.lat && !g.lng && (g.address || g.city || g.state));
  console.log(`${groups.length} total youth groups — ${missing.length} need geocoding.\n`);
  if (!missing.length) { console.log('Nothing to do.'); process.exit(0); }

  let ok = 0, fail = 0;
  for (const g of missing) {
    const name = g.youth_group_name || g.church_name || g.id;
    process.stdout.write(`  Geocoding "${name}"... `);
    const coords = await geocode(g.address, g.city, g.state, g.zip);
    if (coords) {
      await sheets.updateRowFields('YouthGroups', 'id', g.id, {
        lat: coords.lat,
        lng: coords.lng,
        updated_at: new Date().toISOString().slice(0, 10)
      });
      console.log(`✓  ${coords.lat}, ${coords.lng}`);
      ok++;
    } else {
      console.log('✗  not found');
      fail++;
    }
  }
  console.log(`\nDone. ${ok} geocoded, ${fail} not found.`);
  process.exit(0);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
