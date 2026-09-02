'use strict';

// Receives inbound SMS from Twilio and handles keyword compliance.
//
// Configure in Twilio console → Phone Numbers → Your number → Messaging:
//   Webhook (when a message comes in) = https://hub.gorock.org/webhooks/sms-inbound
//   HTTP POST
//
// Keywords handled (case-insensitive, after trimming):
//   STOP / UNSUBSCRIBE / CANCEL / QUIT / END → opt-out + branded confirmation
//   HELP / INFO                              → help reply
//   START / UNSTOP / YES                     → re-subscribe + confirmation
//   (anything else)                          → empty TwiML (no reply)
//
// Note: Twilio A2P 10DLC handles STOP at the carrier level automatically.
// This webhook also records opt-outs in the Hub so they're visible in the UI
// and respected by all send paths before they even reach Twilio.

const express = require('express');
const comms   = require('../lib/comms');
const sms     = require('../lib/sms');

const router = express.Router();

const STOP_WORDS  = new Set(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END']);
const HELP_WORDS  = new Set(['HELP', 'INFO']);
const START_WORDS = new Set(['START', 'UNSTOP', 'YES']);

// Simple AccountSid validation — not a full Twilio signature check, but blocks
// random POST requests to this endpoint without a valid SID header.
function isTwilioRequest(req) {
  const sid = req.body?.AccountSid || '';
  return sid === process.env.TWILIO_ACCOUNT_SID;
}

function twiml(message) {
  if (!message) return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

router.post('/sms-inbound', express.urlencoded({ extended: false }), async (req, res) => {
  // Accept and ack immediately — Twilio retries on non-2xx
  if (!isTwilioRequest(req)) {
    return res.status(200).send(twiml()); // silent drop
  }

  const from    = sms.normalizePhone(req.body?.From || '');
  const rawBody = (req.body?.Body || '').trim().toUpperCase();
  const keyword = rawBody.split(/\s+/)[0]; // first word only

  console.log(`[SMS-IN] from=${from} keyword=${keyword}`);

  try {
    if (STOP_WORDS.has(keyword)) {
      await comms.markOptOut(from, 'inbound-sms');
      const reply = await comms.getSetting('sms_stop_reply');
      res.type('text/xml').send(twiml(reply));

    } else if (HELP_WORDS.has(keyword)) {
      const reply = await comms.getSetting('sms_help_reply');
      res.type('text/xml').send(twiml(reply));

    } else if (START_WORDS.has(keyword)) {
      await comms.markOptIn(from, 'inbound-sms');
      const reply = await comms.getSetting('sms_start_reply');
      res.type('text/xml').send(twiml(reply));

    } else {
      // No Hub action for other inbound messages; return empty TwiML
      res.type('text/xml').send(twiml());
    }
  } catch (err) {
    console.error('[SMS-IN] Error handling inbound SMS:', err.message);
    res.type('text/xml').send(twiml());
  }
});

module.exports = router;
