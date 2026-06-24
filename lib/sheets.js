'use strict';

const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID || '1xaXzWMe69gAZHtZg6YtscKhuAB6YRUWoS85Qf8-kWSs';

let _client = null;

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

async function getSheet(name) {
  const cached = getCached(name);
  if (cached) return cached;
  const c   = await client();
  const res = await c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A1:ZZ` });
  const [headers, ...rows] = res.data.values ?? [[]];
  if (!headers?.length) return [];
  const data = rows
    .filter(r => r.some(Boolean))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  setCached(name, data);
  return data;
}

async function getHeaders(name) {
  const key = `${name}:headers`;
  const cached = getCached(key);
  if (cached) return cached;
  const c   = await client();
  const res = await c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A1:ZZ1` });
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
  await c.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${name}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
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

  const res = await c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A2:ZZ` });
  const rows = res.data.values || [];
  const offset = rows.findIndex(r => (r[idIdx] ?? '') === idValue);
  if (offset === -1) return null;

  const sheetRow = offset + 2; // +1 for the header row, +1 to go from 0- to 1-indexed
  const existing = rows[offset];
  const merged = headers.map((h, i) => (fields[h] !== undefined ? String(fields[h]) : (existing[i] ?? '')));

  await c.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${name}!A${sheetRow}:${colLetter(headers.length)}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [merged] }
  });
  invalidateSheet(name);
  return Object.fromEntries(headers.map((h, i) => [h, merged[i]]));
}

// Permanently removes the row in `name` where `idColumn` === `idValue`.
// Uses the Sheets batchUpdate deleteDimension API so the row is gone, not
// blanked. Returns true if a row was found and deleted, false otherwise.
async function deleteRow(name, idColumn, idValue) {
  const c       = await client();
  const headers = await getHeaders(name);
  const idIdx   = headers.indexOf(idColumn);
  if (idIdx === -1) throw new Error(`Column "${idColumn}" not found in "${name}".`);

  const res  = await c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A2:ZZ` });
  const rows = res.data.values || [];
  const offset = rows.findIndex(r => (r[idIdx] ?? '') === idValue);
  if (offset === -1) return false;

  const meta      = await c.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === name);
  if (!sheetMeta) throw new Error(`Sheet "${name}" not found.`);
  const sheetId = sheetMeta.properties.sheetId;

  // offset 0 among data rows maps to sheet index 1 (header is index 0).
  await c.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: offset + 1, endIndex: offset + 2 }
        }
      }]
    }
  });
  invalidateSheet(name);
  return true;
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
  EventRegistrations: ['RegistrationID', 'EventID', 'FirstName', 'LastName', 'Email', 'Phone', 'Role', 'Status', 'SignUpDate', 'ConfirmedDate', 'CheckedIn', 'CheckInTime', 'Notes', 'CreatedAt', 'Category'],
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
  EventItinerary:     ['ItineraryID', 'EventID', 'Time', 'Title', 'Notes', 'CreatedBy'],
  Documents:          ['DocumentID', 'Title', 'Category', 'FileType', 'AccessLevel', 'FileURL', 'DriveFileID', 'UploadDate', 'UploadedBy', 'Status', 'Tags', 'Source'],
  NotificationPrefs:  ['UserEmail', 'EmailEvents', 'EmailTasks', 'EmailAnnouncements', 'SMSEvents', 'SMSTasks', 'SMSAnnouncements', 'Phone'],
  ActivityLog:        ['Timestamp', 'Email', 'Action', 'Route', 'Method', 'IP', 'UserAgent']
};

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
  findRow,
  appendRow,
  updateRowFields,
  deleteRow,
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
  getNotificationPrefs:  () => getSheet('NotificationPrefs'),
  getActivityLog:        () => getSheet('ActivityLog'),
  logActivity
};
