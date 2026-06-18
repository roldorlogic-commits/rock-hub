'use strict';

// Twilio SMS integration — mirrors lib/email.js's graceful-degradation pattern.
// If TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are not set,
// every call is mocked to a local log file. No third-party SDK needed — uses
// Node's built-in https module.
//
// Set these in Railway environment variables:
//   TWILIO_ACCOUNT_SID    — your Twilio Account SID (starts with "AC")
//   TWILIO_AUTH_TOKEN     — your Twilio Auth Token
//   TWILIO_PHONE_NUMBER   — your Twilio phone number in E.164 format (e.g. +12025551234)

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const LOG_FILE = path.join(__dirname, '../config/sent-sms.log');

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

// Normalises to E.164. Returns null if the number can't be parsed.
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10)                        return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1')   return `+${digits}`;
  if (digits.length > 11)                          return `+${digits}`; // international
  return null;
}

function logMock(to, body) {
  const entry = `\n[${new Date().toISOString()}] MOCK SMS (Twilio not configured)\nTo: ${to}\n${body}\n${'-'.repeat(60)}\n`;
  console.log(entry);
  try { fs.appendFileSync(LOG_FILE, entry); } catch (_) {}
}

// Returns { sent, mocked?, error? } — never throws.
async function send(to, body) {
  const normalized = normalizePhone(to);
  if (!normalized) return { sent: false, error: 'Invalid or missing phone number' };

  if (!isConfigured()) {
    logMock(normalized, body);
    return { sent: false, mocked: true };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE_NUMBER;
  console.log(`[SMS] Sending from=${from} accountSid=${accountSid?.slice(0, 8)}... to=${normalized}`);
  const postData   = new URLSearchParams({ To: normalized, From: from, Body: body }).toString();

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: 'POST',
      auth: `${accountSid}:${authToken}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) resolve({ sent: false, error: parsed.message || 'Twilio error' });
          else resolve({ sent: true, sid: parsed.sid });
        } catch (_) {
          resolve({ sent: false, error: 'Invalid Twilio response' });
        }
      });
    });
    req.on('error', err => resolve({ sent: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

module.exports = { send, isConfigured, normalizePhone };
