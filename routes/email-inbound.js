'use strict';

// Receives inbound email replies via SendGrid's Inbound Parse webhook, so
// recipients of ROCK Hub emails (event confirmations, task assignments,
// announcements) can reply and have that reply go somewhere instead of
// bouncing or vanishing.
//
// How it fits together:
//   - Outgoing mail (lib/email.js) sets Reply-To to INBOUND_REPLY_TO, e.g.
//     reply@reply.gorock.org — a dedicated subdomain, NOT gorock.org itself,
//     so this never touches the real info@gorock.org inbox/MX records.
//   - SendGrid's Inbound Parse is configured (in the SendGrid dashboard,
//     Settings > Inbound Parse) with Host = reply.gorock.org and
//     URL = https://<app host>/webhooks/inbound-email/<INBOUND_PARSE_TOKEN>
//   - That subdomain needs its own MX record pointing at mx.sendgrid.net —
//     see the DNS instructions given alongside this change.
//
// Set in Railway environment variables:
//   INBOUND_PARSE_TOKEN — long random string; must match the token segment
//                         in the URL registered with SendGrid. Requests with
//                         a missing/wrong token are rejected with 404 so the
//                         endpoint doesn't advertise its own existence.
//   INBOUND_NOTIFY_TO   — optional, comma-separated addresses to alert when a
//                         reply comes in (defaults to the board address pair
//                         used elsewhere in this app).

const express = require('express');
const multer  = require('multer');
const crypto  = require('crypto');
const sheetsLib = require('../lib/sheets');
const emailLib  = require('../lib/email');

const router = express.Router();

// Inbound Parse POSTs multipart/form-data (always, even without attachments).
// Attachments are accepted so the request doesn't fail, but not persisted —
// only the message fields are stored today.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }
});

// Splits a raw "From" header like `"Jane Doe" <jane@example.com>` into parts.
// Falls back gracefully for bare addresses or malformed input.
function parseFrom(raw) {
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  return { name: '', email: raw.trim().toLowerCase() };
}

router.post('/inbound-email/:token', upload.any(), async (req, res) => {
  const expected = process.env.INBOUND_PARSE_TOKEN;
  if (!expected || req.params.token !== expected) {
    return res.status(404).end(); // don't reveal the route exists
  }

  // Always ack quickly — SendGrid retries on non-2xx and a storm of retries
  // for e.g. a transient Sheets error is worse than losing one log entry.
  res.status(200).end();

  try {
    const { name, email: fromEmail } = parseFrom(req.body.from);
    const replyId = crypto.randomUUID();

    await sheetsLib.appendRow('EmailReplies', {
      ReplyID:    replyId,
      FromEmail:  fromEmail,
      FromName:   name,
      ToEmail:    req.body.to || '',
      Subject:    req.body.subject || '',
      BodyText:   (req.body.text || '').slice(0, 10000),
      ReceivedAt: new Date().toISOString(),
      SpamScore:  req.body.spam_score || ''
    });

    const notifyTo = process.env.INBOUND_NOTIFY_TO || 'info@gorock.org,vicepresident@gorock.org';
    const preview = (req.body.text || '').slice(0, 500);
    await emailLib.send(
      notifyTo,
      `Reply received: ${req.body.subject || '(no subject)'}`,
      `${name || fromEmail} <${fromEmail}> replied:\n\n${preview}`,
      null,
      { replyTo: null } // this notification goes to the real inbox, not back through the parse loop
    );
  } catch (err) {
    console.error('Inbound Parse handling failed:', err.message);
  }
});

module.exports = router;
