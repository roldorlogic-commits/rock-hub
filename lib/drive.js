'use strict';

const { google } = require('googleapis');
const { Readable } = require('stream');

let _drive = null;

async function getDrive() {
  if (_drive) return _drive;
  let authClient;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    authClient = google.auth.fromJSON(creds);
    authClient.scopes = ['https://www.googleapis.com/auth/drive.file'];
  } else {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    authClient = await auth.getClient();
  }
  _drive = google.drive({ version: 'v3', auth: authClient });
  return _drive;
}

// Uploads a Buffer to Drive under the given name/mimeType, sets anyoneWithLink
// reader permission, and returns { fileId, url }.
// Pass an optional folderId (Drive folder ID) to place the file in a specific folder.
async function uploadFile(name, mimeType, buffer, folderId) {
  const drive = await getDrive();
  const requestBody = { name };
  if (folderId) requestBody.parents = [folderId];
  const res = await drive.files.create({
    requestBody,
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,webViewLink'
  });
  const fileId = res.data.id;
  await drive.permissions.create({
    fileId,
    requestBody: { type: 'anyone', role: 'reader' }
  });
  return { fileId, url: `https://drive.google.com/file/d/${fileId}/view` };
}

module.exports = { uploadFile };
