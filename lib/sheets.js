'use strict';

const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID || '1xaXzWMe69gAZHtZg6YtscKhuAB6YRUWoS85Qf8-kWSs';

let _client = null;

// ── 429 / rate-limit retry with exponential backoff ─────────────────────────
// Google Sheets enforces a per-user "read/write requests per minute" quota.
// When it's exceeded the API throws HTTP 429 (RESOURCE_EXHAUSTED). We retry a
// few times with exponential backoff + jitter; if it still fails we throw a
// QuotaError so callers can show a friendly "busy, try again" message instead
// of leaking the raw Google error to the UI.
class QuotaError extends Error {
  constructor(cause) {
    super('The spreadsheet is busy right now. Please try again in a moment.');
    this.name = 'QuotaError';
    this.isQuota = true;
    this.status = 503;
    if (cause) this.cause = cause;
  }
}

function isRateLimitErr(err) {
  const code = err?.code || err?.response?.status;
  if (code === 429) return true;
  const reason = err?.errors?.[0]?.reason
    || err?.response?.data?.error?.status
    || err?.response?.data?.error?.errors?.[0]?.reason;
  if (reason === 'RESOURCE_EXHAUSTED' || reason === 'rateLimitExceeded'
      || reason === 'userRateLimitExceeded') return true;
  return /quota exceeded|rate limit|resource[_ ]exhausted/i.test(err?.message || '');
}

async function withRetry(fn, { tries = 5, base = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitErr(err) || attempt === tries - 1) break;
      const delay = base * 2 ** attempt + Math.floor(Math.random() * 250); // jitter
      console.warn(`[sheets] rate-limited (attempt ${attempt + 1}/${tries}), backing off ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  if (isRateLimitErr(lastErr)) throw new QuotaError(lastErr);
  throw lastErr;
}

// ── Read instrumentation ─────────────────────────────────────────────────────
// Counts every *actual* Sheets read request (cache misses only), keyed by tab.
// Lets us report which operations generate the most reads. A batchGet counts
// as ONE read regardless of how many tabs it pulls.
const _readStats = {};
function countRead(label) {
  _readStats[label] = (_readStats[label] || 0) + 1;
}
function getReadStats() {
  return Object.entries(_readStats)
    .sort((a, b) => b[1] - a[1])
    .map(([tab, count]) => ({ tab, count }));
}
function resetReadStats() { for (const k of Object.keys(_readStats)) delete _readStats[k]; }

// ── In-memory read cache (30-second TTL) ────────────────────────────────────
const _cache = {};
const CACHE_TTL = 30 * 1000;

function getCached(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { delete _cache[key]; return null; }
  return entry.data;
}

function setCached(key, data) {
  _cache[key] = { data, ts: Date.now() };
}

function invalidateSheet(name) {
  delete _cache[name];
  delete _cache[`${name}:headers`];
}

async function client() {
  if (_client) return _client;

  let authClient;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    // fromJSON handles both 'authorized_user' and 'service_account' credential types
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    authClient = google.auth.fromJSON(creds);
    authClient.scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  } else {
    // Local dev: use Application Default Credentials
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    authClient = await auth.getClient();
  }

  _client = google.sheets({ version: 'v4', auth: authClient });
  return _client;
}

// Parses a Sheets value matrix (headers + rows) into an array of row objects.
function _rowsToObjects(values) {
  const [headers, ...rows] = values ?? [[]];
  if (!headers?.length) return [];
  return rows
    .filter(r => r.some(Boolean))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

async function getSheet(name) {
  const cached = getCached(name);
  if (cached) return cached;
  const c   = await client();
  const res = await withRetry(() => c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A1:ZZ` }));
  countRead(name);
  const data = _rowsToObjects(res.data.values);
  setCached(name, data);
  return data;
}

// Reads several tabs at once. Cache-hits are served from memory; every tab that
// misses is pulled in a SINGLE batchGet request (one read against quota, not one
// per tab). Returns { tabName: rowObjects[] }. This is the main lever for
// collapsing read-amplified pages (dashboard, event detail, AI agent) down to a
// single Sheets call.
async function getSheets(names) {
  const out = {};
  const missing = [];
  for (const n of names) {
    const cached = getCached(n);
    if (cached) out[n] = cached;
    else if (!missing.includes(n)) missing.push(n);
  }
  if (missing.length === 1) {
    out[missing[0]] = await getSheet(missing[0]);
  } else if (missing.length > 1) {
    const c = await client();
    const res = await withRetry(() => c.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: missing.map(n => `${n}!A1:ZZ`),
    }));
    countRead(`batchGet(${missing.length}): ${missing.join(',')}`);
    const ranges = res.data.valueRanges || [];
    missing.forEach((n, i) => {
      const data = _rowsToObjects(ranges[i]?.values);
      setCached(n, data);
      out[n] = data;
    });
  }
  return out;
}

async function getHeaders(name) {
  const key = `${name}:headers`;
  const cached = getCached(key);
  if (cached) return cached;
  const c   = await client();
  const res = await withRetry(() => c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A1:ZZ1` }));
  countRead(key);
  const data = (res.data.values && res.data.values[0]) || [];
  setCached(key, data);
  return data;
}

// 1-indexed column number -> spreadsheet column letters (1 -> A, 27 -> AA).
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function findRow(name, idColumn, idValue) {
  const rows = await getSheet(name);
  return rows.find(r => r[idColumn] === idValue) ?? null;
}

// Appends a new row to `name`, mapping `fields` onto the sheet's existing
// header order (missing fields are left blank). Returns the row as written.
async function appendRow(name, fields) {
  const headers = await getHeaders(name);
  if (!headers.length) throw new Error(`Sheet "${name}" has no header row.`);
  const row = headers.map(h => (fields[h] !== undefined ? String(fields[h]) : ''));
  const c = await client();
  await withRetry(() => c.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${name}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  }));
  invalidateSheet(name);
  return Object.fromEntries(headers.map((h, i) => [h, row[i]]));
}

// Finds the row in `name` where `idColumn` === `idValue` and overwrites only
// the given `fields` (everything else in the row is preserved), writing the
// change straight back to the sheet. Returns the merged row, or null if no
// row matched.
async function updateRowFields(name, idColumn, idValue, fields) {
  const c = await client();
  const headers = await getHeaders(name);
  const idIdx = headers.indexOf(idColumn);
  if (idIdx === -1) throw new Error(`Column "${idColumn}" not found in "${name}".`);

  const res = await withRetry(() => c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A2:ZZ` }));
  countRead(`${name}!A2:ZZ`);
  const rows = res.data.values || [];
  const offset = rows.findIndex(r => (r[idIdx] ?? '') === idValue);
  if (offset === -1) return null;

  const sheetRow = offset + 2; // +1 for the header row, +1 to go from 0- to 1-indexed
  const existing = rows[offset];
  const merged = headers.map((h, i) => (fields[h] !== undefined ? String(fields[h]) : (existing[i] ?? '')));

  await withRetry(() => c.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${name}!A${sheetRow}:${colLetter(headers.length)}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [merged] }
  }));
  invalidateSheet(name);
  return Object.fromEntries(headers.map((h, i) => [h, merged[i]]));
}

// Updates specific fields on MANY rows in a single Sheets write.
//
// `updates` is [{ idValue, fields: { Col: value, ... } }]. Rows are located by
// `idColumn`, and only the named cells are written — each as its own A1 range
// in ONE `values.batchUpdate` call. So reordering N itinerary items costs
// exactly one read (to map ids → row numbers) and one write, instead of the
// N reads + N writes the old per-row loop generated. This is what makes a drag
// atomic: either every position lands or none do, so throttling can no longer
// leave the itinerary half-renumbered. Returns the number of rows matched.
async function batchUpdateRowFields(name, idColumn, updates) {
  if (!Array.isArray(updates) || !updates.length) return 0;
  const c = await client();
  const headers = await getHeaders(name);
  const idIdx = headers.indexOf(idColumn);
  if (idIdx === -1) throw new Error(`Column "${idColumn}" not found in "${name}".`);

  const res = await withRetry(() => c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A2:ZZ` }));
  countRead(`${name}!A2:ZZ`);
  const rows = res.data.values || [];
  const rowById = new Map();
  rows.forEach((r, off) => { if (!rowById.has(r[idIdx] ?? '')) rowById.set(r[idIdx] ?? '', off); });

  const data = [];
  let matched = 0;
  for (const u of updates) {
    const off = rowById.get(u.idValue);
    if (off === undefined) continue;
    matched++;
    const sheetRow = off + 2;
    for (const [col, val] of Object.entries(u.fields || {})) {
      const ci = headers.indexOf(col);
      if (ci === -1) continue;
      data.push({ range: `${name}!${colLetter(ci + 1)}${sheetRow}`, values: [[String(val ?? '')]] });
    }
  }
  if (!data.length) return matched;

  await withRetry(() => c.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data }
  }));
  invalidateSheet(name);
  return matched;
}

// Permanently removes the row in `name` where `idColumn` === `idValue`.
// Uses the Sheets batchUpdate deleteDimension API so the row is gone, not
// blanked. Returns true if a row was found and deleted, false otherwise.
async function deleteRow(name, idColumn, idValue) {
  const c       = await client();
  const headers = await getHeaders(name);
  const idIdx   = headers.indexOf(idColumn);
  if (idIdx === -1) throw new Error(`Column "${idColumn}" not found in "${name}".`);

  const res  = await withRetry(() => c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A2:ZZ` }));
  countRead(`${name}!A2:ZZ`);
  const rows = res.data.values || [];
  const offset = rows.findIndex(r => (r[idIdx] ?? '') === idValue);
  if (offset === -1) return false;

  const meta      = await withRetry(() => c.spreadsheets.get({ spreadsheetId: SHEET_ID }));
  countRead(`${name}:meta`);
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === name);
  if (!sheetMeta) throw new Error(`Sheet "${name}" not found.`);
  const sheetId = sheetMeta.properties.sheetId;

  // offset 0 among data rows maps to sheet index 1 (header is index 0).
  await withRetry(() => c.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: offset + 1, endIndex: offset + 2 }
        }
      }]
    }
  }));
  invalidateSheet(name);
  return true;
}

// Appends a new column header to `name` if it doesn't already exist.
// Safe to call repeatedly — no-op when the column is already present.
async function ensureColumn(name, column) {
  const headers = await getHeaders(name);
  if (headers.includes(column)) return;
  const c   = await client();
  const col = colLetter(headers.length + 1);
  await c.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${name}!${col}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[column]] }
  });
  invalidateSheet(name);
}

async function getUserRole(email) {
  const rows = await getSheet('UserRoles');
  const match = rows.find(r => r.Email?.toLowerCase() === email.toLowerCase());
  return match?.Role ?? 'Volunteer';
}

async function listSheetTitles() {
  const cached = getCached('__sheetTitles');
  if (cached) return cached;
  const c = await client();
  const meta = await c.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const data = meta.data.sheets.map(s => s.properties.title);
  setCached('__sheetTitles', data);
  return data;
}

// Creates `name` with a frozen header row of `headers` if it doesn't already
// exist. Returns true if it created the tab, false if it was already there.
async function ensureSheet(name, headers) {
  const titles = await listSheetTitles();
  if (titles.includes(name)) return false;

  const c = await client();
  await c.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } }] }
  });
  await c.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] }
  });
  return true;
}

// The full set of tabs this app depends on beyond the original 7. Safe to
// call on every boot — it's a no-op for tabs that already exist.
const APP_SHEET_SPECS = {
  EventRegistrations: ['RegistrationID', 'EventID', 'MemberID', 'FirstName', 'LastName', 'Email', 'Phone', 'Role', 'Status', 'SignUpDate', 'ConfirmedDate', 'CheckedIn', 'CheckInTime', 'Notes', 'CreatedAt', 'Category'],
  EventBudget:        ['BudgetID', 'EventID', 'Category', 'Item', 'EstimatedCost', 'ActualCost', 'PaidBy', 'ReceiptURL', 'Status', 'Notes', 'CreatedAt'],
  EventChecklist:     ['ChecklistID', 'EventID', 'Category', 'Item', 'AssignedTo', 'DueDate', 'CompletedDate', 'Status', 'Priority', 'Notes', 'CreatedAt'],
  EventAnnouncements: ['AnnouncementID', 'EventID', 'Subject', 'Body', 'SentBy', 'SentAt', 'Recipients', 'Channel'],
  // VolunteerAuth's header set isn't pinned down as exactly by the spec as the
  // other four — ResetToken/ResetTokenExpiry are added here to support the
  // password-reset flow, and UpdatedAt to match the convention every other
  // sheet in this database already uses.
  VolunteerAuth:      ['Email', 'PasswordHash', 'VolunteerID', 'Status', 'ResetToken', 'ResetTokenExpiry', 'CreatedAt', 'UpdatedAt'],
  // Individual hour-log entries. HoursLogged on the Volunteers row is kept in
  // sync as a running total so stats stay fast (no sheet scan needed).
  HoursLog:           ['HoursID', 'VolunteerID', 'Email', 'EventID', 'EventName', 'Hours', 'Activity', 'Date', 'Notes', 'LoggedAt'],
  EventItinerary:     ['ItineraryID', 'EventID', 'ItemDate', 'Time', 'Title', 'Notes', 'CreatedBy', 'SortOrder', 'ItemType'],
  VolunteerPositions: ['PositionID', 'EventID', 'Title', 'Description', 'SlotsTotal', 'SlotsFilled', 'Status', 'CreatedAt'],
  VolunteerSignups:   ['SignupID', 'PositionID', 'EventID', 'MemberID', 'ContactName', 'Email', 'Phone', 'PositionTitle', 'Status', 'Notes', 'SignedUpAt', 'ApprovedAt', 'ApprovedBy'],
  Documents:          ['DocumentID', 'Title', 'Category', 'FileType', 'AccessLevel', 'FileURL', 'DriveFileID', 'UploadDate', 'UploadedBy', 'Status', 'Tags', 'Source'],
  NotificationPrefs:  ['UserEmail', 'EmailEvents', 'EmailTasks', 'EmailAnnouncements', 'SMSEvents', 'SMSTasks', 'SMSAnnouncements', 'Phone'],
  ActivityLog:        ['Timestamp', 'Email', 'Action', 'Route', 'Method', 'IP', 'UserAgent'],
  YouthGroups:        ['id', 'youth_group_name', 'church_name', 'address', 'city', 'state', 'zip', 'lat', 'lng', 'category', 'primary_contact_id', 'primary_contact_name', 'primary_contact_phone', 'primary_contact_email', 'tags', 'notes', 'location_type', 'created_at', 'updated_at', 'instagram_handle'],
  // Inbound replies to ROCK Hub emails, captured by SendGrid Inbound Parse —
  // see routes/email-inbound.js. Board members can review replies here since
  // they land on reply@<parse subdomain>, not the real info@gorock.org inbox.
  EmailReplies:       ['ReplyID', 'FromEmail', 'FromName', 'ToEmail', 'Subject', 'BodyText', 'ReceivedAt', 'SpamScore'],
  MergeLog:           ['MergeID', 'PrimaryMemberID', 'SecondaryMemberID', 'MergedBy', 'MergedAt', 'FieldsTransferred', 'Notes'],
  DedupeReviews:      ['PairID', 'MemberID_A', 'MemberID_B', 'ReviewedBy', 'ReviewedAt', 'Note'],
  CommSettings:       ['Key', 'Value', 'UpdatedAt', 'UpdatedBy'],
  MessageTemplates:   ['TemplateID', 'Name', 'Channel', 'Subject', 'Body', 'Variables', 'CreatedAt', 'CreatedBy'],
  SmsOptOuts:         ['Phone', 'Status', 'ChangedAt', 'ChangedBy'],
  AgentHistory:       ['UserEmail', 'UpdatedAt', 'Messages'],
};

// ── Agent chat-history storage ────────────────────────────────────────────────
// One row per board user; Messages column holds a JSON array of Gemini-format
// message objects. Rolling window: last 50 messages, cleared if idle > 30 days.

const AGENT_HISTORY_MAX  = 50;
const AGENT_HISTORY_DAYS = 30;

async function getAgentHistory(userEmail) {
  try {
    const rows = await getSheet('AgentHistory');
    const row  = rows.find(r => r.UserEmail === userEmail);
    if (!row?.Messages) return [];
    const age = Date.now() - new Date(row.UpdatedAt).getTime();
    if (age > AGENT_HISTORY_DAYS * 24 * 60 * 60 * 1000) return [];
    return JSON.parse(row.Messages);
  } catch (err) {
    console.error('[sheets] getAgentHistory error:', err.message);
    return [];
  }
}

async function saveAgentHistory(userEmail, messages) {
  const trimmed = messages.slice(-AGENT_HISTORY_MAX);
  const payload = {
    UserEmail: userEmail,
    UpdatedAt: new Date().toISOString(),
    Messages:  JSON.stringify(trimmed),
  };
  try {
    const updated = await updateRowFields('AgentHistory', 'UserEmail', userEmail, payload);
    if (!updated) await appendRow('AgentHistory', payload);
    invalidateSheet('AgentHistory');
  } catch (err) {
    console.error('[sheets] saveAgentHistory error:', err.message);
  }
}

async function ensureAllAppSheets() {
  const created = [];
  for (const [name, headers] of Object.entries(APP_SHEET_SPECS)) {
    if (await ensureSheet(name, headers)) created.push(name);
  }
  return created;
}

// Adds any header columns in `newHeaders` that don't already exist in `name`.
// Safe to call on every boot — skips columns already present.
async function ensureColumns(name, newHeaders) {
  const existing = await getHeaders(name).catch(() => []);
  if (!existing.length) return;
  const missing = newHeaders.filter(h => !existing.includes(h));
  if (!missing.length) return;
  const c = await client();
  const startCol = colLetter(existing.length + 1);
  const endCol   = colLetter(existing.length + missing.length);
  await c.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${name}!${startCol}1:${endCol}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [missing] }
  });
  invalidateSheet(name);
}

// ── Activity log (batched writes to avoid Sheets API quota pressure) ──────────
// Rows are buffered in memory and flushed as a single multi-row append call
// every FLUSH_INTERVAL ms or when the buffer reaches FLUSH_MAX entries.
// Flush errors are logged to console but never surface to callers.
const _activityBuf = [];
let   _activityTimer = null;
const FLUSH_INTERVAL = 5_000;
const FLUSH_MAX      = 20;

async function _flushActivity() {
  if (_activityTimer) { clearTimeout(_activityTimer); _activityTimer = null; }
  if (!_activityBuf.length) return;
  const rows = _activityBuf.splice(0);
  try {
    const c = await client();
    await c.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'ActivityLog!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows }
    });
    invalidateSheet('ActivityLog');
  } catch (err) {
    console.error('ActivityLog flush failed:', err.message);
  }
}

function logActivity({ email, action, route, method, ip, userAgent }) {
  _activityBuf.push([
    new Date().toISOString(),
    email    || '',
    action   || '',
    route    || '',
    (method  || '').toUpperCase(),
    ip       || '',
    (userAgent || '').slice(0, 200)
  ]);
  if (_activityBuf.length >= FLUSH_MAX) {
    _flushActivity(); // fire and forget
  } else if (!_activityTimer) {
    _activityTimer = setTimeout(_flushActivity, FLUSH_INTERVAL);
  }
}

module.exports = {
  getUserRole,
  getSheet,
  getSheets,
  findRow,
  appendRow,
  updateRowFields,
  batchUpdateRowFields,
  ensureColumn,
  deleteRow,
  QuotaError,
  getReadStats,
  resetReadStats,
  ensureSheet,
  ensureAllAppSheets,
  ensureColumns,
  listSheetTitles,
  getMembers:       () => getSheet('Members'),
  getEvents:        () => getSheet('Events'),
  getVolunteers:    () => getSheet('Volunteers'),
  getTasks:         () => getSheet('Tasks'),
  getAnnouncements: () => getSheet('Announcements'),
  getDocuments:     () => getSheet('Documents'),
  getUserRoles:     () => getSheet('UserRoles'),
  getMemberById:    (id) => findRow('Members', 'MemberID', id),
  getVolunteerById: (id) => findRow('Volunteers', 'VolunteerID', id),
  getEventById:     (id) => findRow('Events', 'EventID', id),
  getEventRegistrations: () => getSheet('EventRegistrations'),
  getEventBudget:        () => getSheet('EventBudget'),
  getEventChecklist:     () => getSheet('EventChecklist'),
  getEventAnnouncements: () => getSheet('EventAnnouncements'),
  getVolunteerAuth:      () => getSheet('VolunteerAuth'),
  findVolunteerAuthByEmail: (email) => findRow('VolunteerAuth', 'Email', email.toLowerCase()),
  getHoursLog:           () => getSheet('HoursLog'),
  getEventItinerary:     () => getSheet('EventItinerary'),
  getVolunteerPositions: () => getSheet('VolunteerPositions'),
  getVolunteerSignups:   () => getSheet('VolunteerSignups'),
  getNotificationPrefs:  () => getSheet('NotificationPrefs'),
  getActivityLog:        () => getSheet('ActivityLog'),
  getYouthGroups:        () => getSheet('YouthGroups'),
  getYouthGroupById:     (id) => findRow('YouthGroups', 'id', id),
  getEmailReplies:       () => getSheet('EmailReplies'),
  getCommSettings:       () => getSheet('CommSettings'),
  getMessageTemplates:   () => getSheet('MessageTemplates'),
  getSmsOptOuts:         () => getSheet('SmsOptOuts'),
  getAgentHistory,
  saveAgentHistory,
  logActivity
};
