'use strict';

const { google } = require('googleapis');

// All three values come from Railway env vars — never hardcoded.
// GOOGLE_CALENDAR_SUBJECT is the in-domain user the service account impersonates
// via Domain-Wide Delegation (DWD must be configured in the Admin console, which
// it already is for client ID 117164506729420522839 with the calendar scope).
function calendarId()  { return process.env.GOOGLE_CALENDAR_ID; }
function subject()     { return process.env.GOOGLE_CALENDAR_SUBJECT; }

let _client = null;

function buildClient() {
  if (_client) return _client;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set.');

  const creds = JSON.parse(raw);
  const sub   = subject();
  if (!sub) throw new Error('GOOGLE_CALENDAR_SUBJECT is not set.');

  // JWT with subject impersonation — the app acts AS sub, which has edit rights
  // on the shared calendar. DWD in Admin console grants this service account
  // the right to impersonate any @gorock.org user for the calendar scope.
  const auth = new google.auth.JWT({
    email:   creds.client_email,
    key:     creds.private_key,
    scopes:  ['https://www.googleapis.com/auth/calendar'],
    subject: sub
  });

  _client = google.calendar({ version: 'v3', auth });
  return _client;
}

// List events in [timeMin, timeMax). Both are ISO strings.
async function listEvents(timeMin, timeMax) {
  const cal = buildClient();
  const id  = calendarId();
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not set.');

  const res = await cal.events.list({
    calendarId:   id,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   250
  });
  return (res.data.items || []).map(ev => ({
    id:          ev.id,
    title:       ev.summary || '(No title)',
    description: ev.description || '',
    location:    ev.location || '',
    start:       ev.start?.dateTime || ev.start?.date || '',
    end:         ev.end?.dateTime   || ev.end?.date   || '',
    allDay:      !ev.start?.dateTime,
    htmlLink:    ev.htmlLink || ''
  }));
}

// Create an event. eventData: { title, description, location, start, end, allDay }
// start/end are ISO strings (date-only for allDay, dateTime otherwise).
async function createEvent({ title, description, location, start, end, allDay }) {
  const cal = buildClient();
  const id  = calendarId();
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not set.');

  const body = {
    summary:     title       || '(No title)',
    description: description || '',
    location:    location    || ''
  };
  if (allDay) {
    body.start = { date: start.slice(0, 10) };
    body.end   = { date: end ? end.slice(0, 10) : start.slice(0, 10) };
  } else {
    body.start = { dateTime: start, timeZone: 'America/New_York' };
    body.end   = { dateTime: end,   timeZone: 'America/New_York' };
  }

  const res = await cal.events.insert({ calendarId: id, requestBody: body });
  const ev  = res.data;
  return {
    id:       ev.id,
    title:    ev.summary,
    start:    ev.start?.dateTime || ev.start?.date || '',
    end:      ev.end?.dateTime   || ev.end?.date   || '',
    allDay:   !ev.start?.dateTime,
    htmlLink: ev.htmlLink || ''
  };
}

module.exports = { listEvents, createEvent };
