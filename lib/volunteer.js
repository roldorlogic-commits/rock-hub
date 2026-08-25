'use strict';

// Event volunteer positions & signups — data access over the
// VolunteerPositions and VolunteerSignups sheets. Approving a signup fills a
// slot and (via lib/registrations) auto-enrolls the volunteer as a confirmed
// registrant for the event.

const sheets        = require('./sheets');
const registrations = require('./registrations');

function todayStr() { return new Date().toISOString().slice(0, 10); }
function nowStr()   { return new Date().toISOString(); }

// IDs include a short random suffix on top of the timestamp: positions and
// their seeded signups can be created within the same millisecond (Assign To),
// which a bare Date.now() would collide on.
function uid(prefix) { return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`; }

// Position status is stored lowercase ('open' / 'filled' / 'closed'); the UI
// upper-cases it for display.
function splitName(name) {
  const [first, ...rest] = (name || '').trim().split(/\s+/);
  return { firstName: first || '', lastName: rest.join(' ') };
}

// ── Positions ────────────────────────────────────────────────────────────────

async function getPositionsByEvent(eventId) {
  const rows = await sheets.getVolunteerPositions();
  return rows.filter(p => p.EventID === eventId);
}

async function createPosition(eventId, fields) {
  const slots = Math.max(1, parseInt(fields.SlotsTotal, 10) || 1);
  return sheets.appendRow('VolunteerPositions', {
    PositionID: uid('POS'), EventID: eventId,
    Title: fields.Title || '', Description: fields.Description || '',
    SlotsTotal: String(slots), SlotsFilled: '0',
    Status: 'open', CreatedAt: todayStr()
  });
}

async function updatePosition(posId, fields) {
  const allowed = {};
  if (fields.Title       !== undefined) allowed.Title = fields.Title;
  if (fields.Description !== undefined) allowed.Description = fields.Description;
  if (fields.SlotsTotal  !== undefined) allowed.SlotsTotal = String(Math.max(1, parseInt(fields.SlotsTotal, 10) || 1));
  if (fields.Status      !== undefined) allowed.Status = fields.Status;
  return sheets.updateRowFields('VolunteerPositions', 'PositionID', posId, allowed);
}

async function deletePosition(posId) {
  return sheets.deleteRow('VolunteerPositions', 'PositionID', posId);
}

// ── Signups ──────────────────────────────────────────────────────────────────

async function getSignupsByPosition(posId) {
  const rows = await sheets.getVolunteerSignups();
  return rows.filter(s => s.PositionID === posId);
}

async function getSignupsByEvent(eventId) {
  const rows = await sheets.getVolunteerSignups();
  return rows.filter(s => s.EventID === eventId);
}

async function createSignup(eventId, posId, fields) {
  const pos = await sheets.findRow('VolunteerPositions', 'PositionID', posId);
  if (!pos) throw Object.assign(new Error('Position not found.'), { status: 404 });
  return sheets.appendRow('VolunteerSignups', {
    SignupID: uid('SIG'), PositionID: posId, EventID: eventId,
    MemberID: fields.MemberID || '',
    ContactName: fields.ContactName || '', Email: fields.Email || '',
    Phone: fields.Phone || '', PositionTitle: pos.Title || '',
    Status: fields.Status || 'pending', Notes: fields.Notes || '',
    SignedUpAt: nowStr(),
    ApprovedAt: fields.Status === 'approved' ? nowStr() : '',
    ApprovedBy: fields.Status === 'approved' ? (fields.ApprovedBy || '') : ''
  });
}

// Board-direct assignment: creates a pre-approved signup for a known contact,
// auto-enrolls them as a confirmed registrant, and recomputes slot counts.
async function assignMember(eventId, posId, member, approvedBy, notes) {
  const signup = await createSignup(eventId, posId, {
    MemberID: member.MemberID,
    ContactName: [member.FirstName, member.LastName].filter(Boolean).join(' '),
    Email: member.Email || '', Phone: member.Phone || '',
    Status: 'approved', ApprovedBy: approvedBy || '', Notes: notes || ''
  });
  await registrations.upsertVolunteerRegistrant({
    eventId, firstName: member.FirstName, lastName: member.LastName,
    email: member.Email, phone: member.Phone, memberID: member.MemberID
  });
  await _syncPositionSlots(posId);
  return signup;
}

// Recomputes a position's SlotsFilled by counting approved signups, and flips
// Status between 'open' and 'filled' accordingly (a manual 'closed' is left
// untouched). Returns the updated position.
async function _syncPositionSlots(posId) {
  const pos = await sheets.findRow('VolunteerPositions', 'PositionID', posId);
  if (!pos) return null;
  const signups  = await getSignupsByPosition(posId);
  const filled   = signups.filter(s => s.Status === 'approved').length;
  const total    = parseInt(pos.SlotsTotal, 10) || 0;
  let status     = pos.Status;
  if (status !== 'closed') status = total > 0 && filled >= total ? 'filled' : 'open';
  return sheets.updateRowFields('VolunteerPositions', 'PositionID', posId, {
    SlotsFilled: String(filled), Status: status
  });
}

// Approve or reject a signup. On approval the volunteer is upserted as a
// confirmed registrant for the event; the owning position's filled-count and
// status are always recomputed afterward.
async function updateSignupStatus(signupId, status, approvedBy) {
  const signup = await sheets.findRow('VolunteerSignups', 'SignupID', signupId);
  if (!signup) return null;

  const fields = { Status: status };
  if (status === 'approved') {
    fields.ApprovedAt = nowStr();
    fields.ApprovedBy = approvedBy || '';
  } else {
    fields.ApprovedAt = '';
    fields.ApprovedBy = '';
  }

  const updated = await sheets.updateRowFields('VolunteerSignups', 'SignupID', signupId, fields);

  if (status === 'approved') {
    const { firstName, lastName } = splitName(signup.ContactName);
    await registrations.upsertVolunteerRegistrant({
      eventId: signup.EventID, firstName, lastName,
      email: signup.Email, phone: signup.Phone,
      memberID: signup.MemberID || ''
    });
  }

  await _syncPositionSlots(signup.PositionID);
  return updated;
}

module.exports = {
  getPositionsByEvent, createPosition, updatePosition, deletePosition,
  getSignupsByPosition, getSignupsByEvent, createSignup, assignMember, updateSignupStatus
};
