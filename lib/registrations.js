'use strict';

// Registration data access — thin layer over the EventRegistrations sheet.
// Split out from routes/events.js so the volunteer library can upsert a
// registrant when a signup is approved without pulling in the whole route
// file. Keeps the Volunteers → Registrants sync in one place.

const sheets = require('./sheets');

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function getByEvent(eventId) {
  const regs = await sheets.getEventRegistrations();
  return regs.filter(r => r.EventID === eventId);
}

// Case-insensitive email match within a single event.
async function findByEmail(eventId, emailAddr) {
  const needle = (emailAddr || '').toLowerCase();
  if (!needle) return null;
  const regs = await sheets.getEventRegistrations();
  return regs.find(r => r.EventID === eventId && (r.Email || '').toLowerCase() === needle) || null;
}

// Ensures a Confirmed registrant exists for a volunteer. If a registration
// with the same email already exists for the event it's tagged as a volunteer
// (so the VOLUNTEER badge shows) and returned unchanged otherwise; if none
// exists one is created with source='volunteer', status='confirmed'.
async function upsertVolunteerRegistrant({ eventId, firstName, lastName, email, phone }) {
  const existing = await findByEmail(eventId, email);
  if (existing) {
    if (existing.Source !== 'volunteer') {
      return sheets.updateRowFields('EventRegistrations', 'RegistrationID', existing.RegistrationID, {
        Source: 'volunteer', Category: 'Volunteer'
      });
    }
    return existing;
  }
  return sheets.appendRow('EventRegistrations', {
    RegistrationID: `REG${Date.now()}`, EventID: eventId,
    FirstName: firstName || '', LastName: lastName || '',
    Email: email || '', Phone: phone || '',
    Status: 'Confirmed', Category: 'Volunteer', Source: 'volunteer',
    SignUpDate: todayStr(), ConfirmedDate: todayStr(),
    CheckedIn: 'FALSE', CreatedAt: todayStr()
  });
}

// Updates a registrant row. When the registrant originated from a volunteer
// signup (Source === 'volunteer'), any name/email/phone change is mirrored
// back onto the matching VolunteerSignup row so the two stay in sync. The
// signup is matched by the registrant's *previous* email, since the update
// may itself be changing the email.
async function updateRegistrant(regId, fields) {
  const before = await sheets.findRow('EventRegistrations', 'RegistrationID', regId);
  if (!before) return null;

  const updated = await sheets.updateRowFields('EventRegistrations', 'RegistrationID', regId, fields);
  if (!updated) return null;

  if (before.Source === 'volunteer') {
    const touchesIdentity = ['FirstName', 'LastName', 'Email', 'Phone'].some(k => fields[k] !== undefined);
    if (touchesIdentity) {
      const signups = await sheets.getVolunteerSignups();
      const oldEmail = (before.Email || '').toLowerCase();
      const match = signups.find(s => s.EventID === before.EventID && (s.Email || '').toLowerCase() === oldEmail);
      if (match) {
        const signupFields = {};
        if (fields.FirstName !== undefined || fields.LastName !== undefined) {
          signupFields.ContactName = [updated.FirstName, updated.LastName].filter(Boolean).join(' ');
        }
        if (fields.Email !== undefined) signupFields.Email = updated.Email;
        if (fields.Phone !== undefined) signupFields.Phone = updated.Phone;
        if (Object.keys(signupFields).length) {
          await sheets.updateRowFields('VolunteerSignups', 'SignupID', match.SignupID, signupFields);
        }
      }
    }
  }

  return updated;
}

module.exports = { getByEvent, findByEmail, upsertVolunteerRegistrant, updateRegistrant };
