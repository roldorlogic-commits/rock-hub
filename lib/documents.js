'use strict';

// Drive-backed listing for the Documents tab. Reads every hub-managed file out
// of the shared drive, tagging each with the section (which top-level folder it
// lives under) and the event (the immediate subfolder name, when present).
//
// Folder layout in the shared drive:
//   Hub Event Photos/     {EventName}/  photo.jpg     -> section Photos,    event {EventName}
//   Hub Event Documents/  {EventName}/  agenda.pdf    -> section Documents, event {EventName}
//   General/              report.pdf                  -> section General,   event ''

const drive = require('./drive');

const ROOTS = [
  { name: 'Hub Event Photos',    section: 'Photos' },
  { name: 'Hub Event Documents', section: 'Documents' },
  { name: 'General',             section: 'General' }
];

function prettyType(name, mimeType) {
  const ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1];
  if (ext) return ext.toUpperCase();
  if (mimeType && mimeType.includes('/')) return mimeType.split('/').pop().toUpperCase();
  return 'FILE';
}

// Ensures the three top-level folders exist and returns [{name,section,id}].
async function ensureRoots(driveId) {
  const roots = [];
  for (const r of ROOTS) {
    const id = await drive.ensureRootFolder(r.name, driveId);
    roots.push({ ...r, id });
  }
  return roots;
}

async function listAll() {
  const driveId = drive.sharedDriveId();
  if (!driveId) return [];

  const roots = await ensureRoots(driveId);
  const rootIds = roots.map(r => r.id);
  const rootById = new Map(roots.map(r => [r.id, r]));

  // Event subfolders that live directly under a root folder.
  const eventFolders = await drive.listChildren(rootIds, { foldersOnly: true });
  const eventById = new Map();
  for (const f of eventFolders) {
    const parent = (f.parents || [])[0];
    eventById.set(f.id, { name: f.name, root: rootById.get(parent) });
  }

  // Files live either directly in a root (General/) or inside an event folder.
  const fileParents = rootIds.concat(eventFolders.map(f => f.id));
  const files = await drive.listChildren(fileParents, { foldersOnly: false });

  return files.map(f => {
    const parent = (f.parents || [])[0];
    let section = 'Documents';
    let event = '';
    if (rootById.has(parent)) {
      section = rootById.get(parent).section;
    } else if (eventById.has(parent)) {
      const ev = eventById.get(parent);
      event = ev.name;
      section = ev.root ? ev.root.section : 'Documents';
    }
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      fileType: prettyType(f.name, f.mimeType),
      size: f.size != null ? Number(f.size) : null,
      modifiedTime: f.modifiedTime || null,
      event,
      section,
      webViewLink: f.webViewLink || null,
      webContentLink: f.webContentLink || null,
      proxyUrl: `/api/drive/file/${f.id}`,
      downloadUrl: `/api/drive/file/${f.id}?download=1`
    };
  });
}

module.exports = { listAll, ensureRoots };
