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

async function getUserRole(email) {
  const rows = await getSheet('UserRoles');
  const match = rows.find(r => r.Email?.toLowerCase() === email.toLowerCase());
  return match?.Role ?? 'Volunteer';
}

module.exports = {
  getUserRole,
  getMembers:       () => getSheet('Members'),
  getEvents:        () => getSheet('Events'),
  getVolunteers:    () => getSheet('Volunteers'),
  getTasks:         () => getSheet('Tasks'),
  getAnnouncements: () => getSheet('Announcements'),
  getDocuments:     () => getSheet('Documents'),
  getUserRoles:     () => getSheet('UserRoles')
};
