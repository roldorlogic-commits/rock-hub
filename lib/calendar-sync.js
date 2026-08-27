'use strict';

// Syncs Hub event records to the shared ROCK Google Calendar.
// Reuses the existing lib/calendar client (DWD / service account impersonation).
// All functions are fire-and-forget safe: callers should .catch() and log.

const sheets   = require('./sheets');
const calendar = require('./calendar');

// ── Column bootstrap ──────────────────────────────────────────────────────────
// Run once per process to ensure the Events sheet has a CalendarEventID column.

let _columnReady = false;
async function ensureColumn() {
  if (_columnReady) return;
  await sheets.ensureColumn('Events', 'CalendarEventID');
  _columnReady = true;
}

// ── Field mapping ─────────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function toCalendarData(ev) {
  const locationParts = [ev.Location, ev.Address].filter(Boolean);
  const location = locationParts.join(', ');

  let desc = stripHtml(ev.Description);
  if (ev.CoordinatorName) {
    const coord = [ev.CoordinatorName, ev.CoordinatorEmail].filter(Boolean).join(' — ');
    desc = [desc, `Coordinator: ${coord}`].filter(Boolean).join('\n\n');
  }

  const allDay = !ev.StartTime;
  let start, end;

  if (allDay) {
    start = ev.StartDate;
    // Google Calendar all-day end is exclusive — advance one day past the last day
    const d = new Date((ev.EndDate || ev.StartDate) + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    end = d.toISOString().slice(0, 10);
  } else {
    start = `${ev.StartDate}T${ev.StartTime}:00`;
    const endDate = ev.EndDate || ev.StartDate;
    const endTime = ev.EndTime  || ev.StartTime;
    end = `${endDate}T${endTime}:00`;
  }

  return { title: ev.EventName, description: desc, location, start, end, allDay };
}

// ── Core sync ─────────────────────────────────────────────────────────────────

// Create or update the Google Calendar entry for `ev`.
// Writes the returned calendar event ID back to the Events sheet.
// Returns the calendar event ID.
async function syncEventToCalendar(ev) {
  await ensureColumn();

  const data    = toCalendarData(ev);
  const existId = (ev.CalendarEventID || '').trim();

  let calId;
  if (existId) {
    // Update existing entry
    await calendar.updateEvent(existId, data);
    calId = existId;
  } else {
    // Create new entry and store the returned ID
    const created = await calendar.createEvent(data);
    calId = created.id;
    await sheets.updateRowFields('Events', 'EventID', ev.EventID, { CalendarEventID: calId });
  }

  console.log(`[calendar-sync] synced ${ev.EventID} → cal:${calId}`);
  return calId;
}

// Remove the Google Calendar entry for `ev` (when event is deleted/cancelled).
async function removeEventFromCalendar(ev) {
  const calId = (ev.CalendarEventID || '').trim();
  if (!calId) return; // nothing to remove
  await calendar.deleteEvent(calId);
  await sheets.updateRowFields('Events', 'EventID', ev.EventID, { CalendarEventID: '' });
  console.log(`[calendar-sync] removed cal:${calId} for ${ev.EventID}`);
}

// ── Backfill ──────────────────────────────────────────────────────────────────

// Sync all events that don't yet have a CalendarEventID.
// Returns a summary { synced, skipped, failed }.
async function backfillAll() {
  await ensureColumn();
  const events = await sheets.getEvents();

  const results = { synced: [], skipped: [], failed: [] };

  for (const ev of events) {
    if ((ev.CalendarEventID || '').trim()) {
      results.skipped.push(ev.EventID);
      continue;
    }
    try {
      await syncEventToCalendar(ev);
      results.synced.push(ev.EventID);
    } catch (err) {
      console.error(`[calendar-sync] backfill ${ev.EventID}:`, err.message);
      results.failed.push({ id: ev.EventID, error: err.message });
    }
  }

  console.log('[calendar-sync] backfill complete:', results);
  return results;
}

module.exports = { syncEventToCalendar, removeEventFromCalendar, backfillAll };
