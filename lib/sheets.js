'use strict';

const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID || '1xaXzWMe69gAZHtZg6YtscKhuAB6YRUWoS85Qf8-kWSs';

let _client = null;

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
  const c   = await client();
  const res = await c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A1:ZZ` });
  const [headers, ...rows] = res.data.values ?? [[]];
  if (!headers?.length) return [];
  return rows
    .filter(r => r.some(Boolean))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

async function getHeaders(name) {
  const c   = await client();
  const res = await c.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${name}!A1:ZZ1` });
  return (res.data.values && res.data.values[0]) || [];
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
  return Object.fromEntries(headers.map((h, i) => [h, merged[i]]));
}

async function getUserRole(email) {
  const rows = await getSheet('UserRoles');
  const match = rows.find(r => r.Email?.toLowerCase() === email.toLowerCase());
  return match?.Role ?? 'Volunteer';
}

module.exports = {
  getUserRole,
  getSheet,
  findRow,
  appendRow,
  updateRowFields,
  getMembers:       () => getSheet('Members'),
  getEvents:        () => getSheet('Events'),
  getVolunteers:    () => getSheet('Volunteers'),
  getTasks:         () => getSheet('Tasks'),
  getAnnouncements: () => getSheet('Announcements'),
  getDocuments:     () => getSheet('Documents'),
  getUserRoles:     () => getSheet('UserRoles'),
  getMemberById:    (id) => findRow('Members', 'MemberID', id),
  getVolunteerById: (id) => findRow('Volunteers', 'VolunteerID', id)
};
