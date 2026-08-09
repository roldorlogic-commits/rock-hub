'use strict';

const { google } = require('googleapis');
const { Readable } = require('stream');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

let _drive = null;

// Uses the full `drive` scope so the service account can read/write inside the
// shared drive it has been added to. (The old `drive.file` scope only granted
// access to files the app itself created, which is why uploads that targeted a
// shared-drive folder failed.)
async function getDrive() {
  if (_drive) return _drive;
  let authClient;
  const scopes = ['https://www.googleapis.com/auth/drive'];
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    authClient = google.auth.fromJSON(creds);
    authClient.scopes = scopes;
  } else {
    const auth = new google.auth.GoogleAuth({ scopes });
    authClient = await auth.getClient();
  }
  _drive = google.drive({ version: 'v3', auth: authClient });
  return _drive;
}

// The shared drive that hub files live in. Photos and documents share one
// drive (different top-level folders), so any of these env vars resolves it.
function sharedDriveId() {
  return process.env.PHOTOS_DRIVE_ID
      || process.env.DOCS_DRIVE_ID
      || process.env.GOOGLE_DRIVE_ID
      || null;
}

// Find-or-create a folder named `name` under `parentId` (which may be the
// shared drive id itself for a top-level folder). Memoized per parent+name so
// repeated uploads don't re-query Drive every time.
const _folderCache = new Map();
async function ensureFolder(name, parentId) {
  const key = `${parentId}::${name}`;
  if (_folderCache.has(key)) return _folderCache.get(key);

  const drive = await getDrive();
  const safe = String(name).replace(/'/g, "\\'");
  const q = `name='${safe}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`;
  const res = await drive.files.list({
    q,
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id,name)',
    pageSize: 1
  });

  let id;
  if (res.data.files && res.data.files.length) {
    id = res.data.files[0].id;
  } else {
    const created = await drive.files.create({
      requestBody: { name: String(name), mimeType: FOLDER_MIME, parents: [parentId] },
      supportsAllDrives: true,
      fields: 'id'
    });
    id = created.data.id;
  }
  _folderCache.set(key, id);
  return id;
}

// Resolve (creating if needed) a top-level hub folder, e.g. "Hub Event Photos".
async function ensureRootFolder(name, driveId) {
  const d = driveId || sharedDriveId();
  if (!d) throw new Error('No Shared Drive configured (set PHOTOS_DRIVE_ID / DOCS_DRIVE_ID).');
  return ensureFolder(name, d);
}

// Resolve (creating if needed) the per-event subfolder, e.g.
// "Hub Event Photos/Annual Beach Trip". Falls back to an "Unsorted" folder
// when the event name is missing.
async function ensureEventFolder(rootName, eventName, driveId) {
  const root = await ensureRootFolder(rootName, driveId);
  const safeEvent = (eventName || '').trim() || 'Unsorted';
  return ensureFolder(safeEvent, root);
}

// Uploads a Buffer to Drive under the given name/mimeType inside `folderId`
// (which should be a shared-drive folder). Returns id + links. No public
// permission is granted — files are served through the app's own proxy route.
async function uploadFile(name, mimeType, buffer, folderId) {
  const drive = await getDrive();
  const requestBody = { name };
  if (folderId) requestBody.parents = [folderId];
  const res = await drive.files.create({
    requestBody,
    media: { mimeType, body: Readable.from(buffer) },
    supportsAllDrives: true,
    fields: 'id,name,mimeType,size,modifiedTime,webViewLink,webContentLink'
  });
  const f = res.data;
  return {
    fileId: f.id,
    url: `https://drive.google.com/file/d/${f.id}/view`,
    webViewLink: f.webViewLink || null,
    webContentLink: f.webContentLink || null,
    meta: f
  };
}

async function getFileMeta(fileId) {
  const drive = await getDrive();
  const res = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: 'id,name,mimeType,size,modifiedTime,webViewLink'
  });
  return res.data;
}

// Returns a readable stream of the file's bytes (for the proxy route).
async function getFileStream(fileId) {
  const drive = await getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return res.data;
}

// Lists direct children of the given parent folder ids. `foldersOnly` toggles
// between listing subfolders and listing (non-folder) files.
async function listChildren(parentIds, opts = {}) {
  if (!parentIds || !parentIds.length) return [];
  const drive = await getDrive();
  const parentClause = '(' + parentIds.map(id => `'${id}' in parents`).join(' or ') + ')';
  const mimeClause = opts.foldersOnly
    ? `mimeType='${FOLDER_MIME}'`
    : `mimeType!='${FOLDER_MIME}'`;
  const q = `${parentClause} and ${mimeClause} and trashed=false`;

  let files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1000,
      pageToken,
      orderBy: 'folder,name',
      fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,parents)'
    });
    files = files.concat(res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

module.exports = {
  getDrive,
  sharedDriveId,
  ensureFolder,
  ensureRootFolder,
  ensureEventFolder,
  uploadFile,
  getFileMeta,
  getFileStream,
  listChildren,
  FOLDER_MIME
};
