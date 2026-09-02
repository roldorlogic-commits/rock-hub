'use strict';

// Central Communications layer: settings, branding, opt-outs, templates.
// All other send layers (lib/sms.js, routes/agent.js, routes/api.js) read from here
// so branding and compliance rules apply automatically everywhere.

const sheets = require('./sheets');

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  sms_prefix:    'The ROCK Association:',
  sms_signoff:   '',
  email_from_name: 'The ROCK Association',
  email_signature: '',
  sms_stop_reply:  'You have been unsubscribed from The ROCK Association messages. Reply START to resubscribe.',
  sms_help_reply:  'The ROCK Association: For help contact us at info@gorock.org. Reply STOP to opt out.',
  sms_start_reply: 'You have been resubscribed to The ROCK Association messages. Reply STOP at any time to opt out.'
};

// ── Settings cache (5-minute TTL) ─────────────────────────────────────────────

let _settingsCache   = null;
let _settingsCacheTs = 0;
const SETTINGS_TTL   = 5 * 60 * 1000;

async function loadSettings() {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTs < SETTINGS_TTL) return _settingsCache;
  const rows = await sheets.getCommSettings();
  const obj = { ...DEFAULTS };
  for (const row of rows) {
    if (row.Key && row.Key in DEFAULTS) obj[row.Key] = row.Value;
  }
  _settingsCache   = obj;
  _settingsCacheTs = now;
  return obj;
}

function invalidateSettingsCache() {
  _settingsCache   = null;
  _settingsCacheTs = 0;
}

async function getSetting(key) {
  const s = await loadSettings();
  return s[key] !== undefined ? s[key] : (DEFAULTS[key] ?? null);
}

async function updateSetting(key, value, userEmail) {
  const rows  = await sheets.getCommSettings();
  const match = rows.find(r => r.Key === key);
  const now   = new Date().toISOString();
  if (match) {
    await sheets.updateRowFields('CommSettings', 'Key', key, { Value: value, UpdatedAt: now, UpdatedBy: userEmail || '' });
  } else {
    await sheets.appendRow('CommSettings', { Key: key, Value: value, UpdatedAt: now, UpdatedBy: userEmail || '' });
  }
  invalidateSettingsCache();
}

async function updateSettings(obj, userEmail) {
  for (const [key, value] of Object.entries(obj)) {
    if (key in DEFAULTS) await updateSetting(key, value, userEmail);
  }
}

// ── SMS Branding ──────────────────────────────────────────────────────────────

function getSegmentInfo(text) {
  const len = text ? text.length : 0;
  const hasUnicode = text ? [...text].some(c => c.charCodeAt(0) > 127) : false;
  const singleMax  = hasUnicode ? 70 : 160;
  const multiMax   = hasUnicode ? 67 : 153;
  if (len === 0) return { chars: 0, segments: 1, maxPerSeg: singleMax };
  if (len <= singleMax) return { chars: len, segments: 1, maxPerSeg: singleMax };
  return { chars: len, segments: Math.ceil(len / multiMax), maxPerSeg: multiMax };
}

async function applySmsBranding(body, settingsOverride) {
  const s      = settingsOverride || await loadSettings();
  const prefix = (s.sms_prefix || '').trim();
  const signoff = (s.sms_signoff || '').trim();
  let final = (body || '').trim();
  if (prefix) final = `${prefix} ${final}`;
  if (signoff) final = `${final}\n${signoff}`;
  return { finalMessage: final, ...getSegmentInfo(final) };
}

// ── Opt-out management ────────────────────────────────────────────────────────

// Opt-out cache — short TTL since compliance is critical
let _optoutCache   = null;
let _optoutCacheTs = 0;
const OPTOUT_TTL   = 60 * 1000; // 1 minute

async function _loadOptoutSet() {
  const now = Date.now();
  if (_optoutCache && now - _optoutCacheTs < OPTOUT_TTL) return _optoutCache;
  const rows = await sheets.getSmsOptOuts();
  // Build set of E.164 phones that are currently opted out
  const set = new Set(rows.filter(r => r.Status === 'opted-out').map(r => r.Phone));
  _optoutCache   = set;
  _optoutCacheTs = now;
  return set;
}

function _invalidateOptoutCache() {
  _optoutCache   = null;
  _optoutCacheTs = 0;
}

async function isOptedOut(phone) {
  if (!phone) return false;
  const set = await _loadOptoutSet();
  return set.has(phone);
}

async function getOptOuts() {
  return sheets.getSmsOptOuts();
}

async function markOptOut(phone, changedBy) {
  if (!phone) return;
  const rows  = await sheets.getSmsOptOuts();
  const match = rows.find(r => r.Phone === phone);
  const now   = new Date().toISOString();
  if (match) {
    await sheets.updateRowFields('SmsOptOuts', 'Phone', phone, { Status: 'opted-out', ChangedAt: now, ChangedBy: changedBy || '' });
  } else {
    await sheets.appendRow('SmsOptOuts', { Phone: phone, Status: 'opted-out', ChangedAt: now, ChangedBy: changedBy || 'inbound-sms' });
  }
  _invalidateOptoutCache();
}

async function markOptIn(phone, changedBy) {
  if (!phone) return;
  const rows  = await sheets.getSmsOptOuts();
  const match = rows.find(r => r.Phone === phone);
  const now   = new Date().toISOString();
  if (match) {
    await sheets.updateRowFields('SmsOptOuts', 'Phone', phone, { Status: 'active', ChangedAt: now, ChangedBy: changedBy || '' });
  } else {
    await sheets.appendRow('SmsOptOuts', { Phone: phone, Status: 'active', ChangedAt: now, ChangedBy: changedBy || '' });
  }
  _invalidateOptoutCache();
}

// ── Template management ───────────────────────────────────────────────────────

async function getTemplates() {
  return sheets.getMessageTemplates();
}

async function getTemplateById(id) {
  const all = await getTemplates();
  return all.find(t => t.TemplateID === id) || null;
}

async function createTemplate({ name, channel, subject, body, variables, createdBy }) {
  const id  = `TPL-${Date.now()}`;
  const now = new Date().toISOString();
  await sheets.appendRow('MessageTemplates', {
    TemplateID: id, Name: name || '', Channel: channel || 'Both',
    Subject: subject || '', Body: body || '', Variables: variables || '',
    CreatedAt: now, CreatedBy: createdBy || ''
  });
  return id;
}

async function updateTemplate(id, fields, userEmail) {
  const allowed = { Name: 1, Channel: 1, Subject: 1, Body: 1, Variables: 1 };
  const update  = {};
  for (const [k, v] of Object.entries(fields)) { if (allowed[k]) update[k] = v; }
  if (!Object.keys(update).length) return null;
  return sheets.updateRowFields('MessageTemplates', 'TemplateID', id, update);
}

async function deleteTemplate(id) {
  return sheets.deleteRow('MessageTemplates', 'TemplateID', id);
}

module.exports = {
  DEFAULTS,
  loadSettings,
  getSetting,
  updateSetting,
  updateSettings,
  invalidateSettingsCache,
  applySmsBranding,
  getSegmentInfo,
  isOptedOut,
  getOptOuts,
  markOptOut,
  markOptIn,
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate
};
