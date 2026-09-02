'use strict';

// Twilio SMS integration — mirrors lib/email.js's graceful-degradation pattern.
// If TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are not set,
// every call is mocked to a local log file. No third-party SDK needed — uses
// Node's built-in https module.
//
// Branding is applied automatically from CommSettings (prefix + signoff).
// Opt-out compliance is enforced: opted-out numbers are silently skipped.
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

function twilioPost(accountSid, authToken, from, to, body) {
  const postData = new URLSearchParams({ To: to, From: from, Body: body }).toString();
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

// opts:
//   skipBranding      — don't prepend prefix / signoff (used for compliance auto-replies)
//   skipOptOutCheck   — bypass opt-out gate (used for STOP confirmation reply)
//   settingsCache     — pre-loaded settings object to avoid a second Sheets call
//
// Returns { sent, sid?, mocked?, error?, skippedOptOut?, finalMessage, chars, segments }
async function send(to, body, opts = {}) {
  const normalized = normalizePhone(to);
  if (!normalized) return { sent: false, error: 'Invalid or missing phone number' };

  const comms = require('./comms');

  // Compliance: skip opted-out numbers
  if (!opts.skipOptOutCheck) {
    const opted = await comms.isOptedOut(normalized);
    if (opted) {
      console.log(`[SMS] Skipped opted-out number: ${normalized}`);
      return { sent: false, skippedOptOut: true };
    }
  }

  // Apply branding
  let finalMessage = body;
  let segInfo = { chars: (body || '').length, segments: 1 };
  if (!opts.skipBranding) {
    const branded = await comms.applySmsBranding(body, opts.settingsCache);
    finalMessage  = branded.finalMessage;
    segInfo       = { chars: branded.chars, segments: branded.segments };
  }

  if (!isConfigured()) {
    logMock(normalized, finalMessage);
    return { sent: false, mocked: true, finalMessage, ...segInfo };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE_NUMBER;
  console.log(`[SMS] from=${from} to=${normalized} segments=${segInfo.segments}`);

  const result = await twilioPost(accountSid, authToken, from, normalized, finalMessage);
  return { ...result, finalMessage, ...segInfo };
}

// Send a raw string to a number with no branding, no opt-out check — for compliance replies only.
async function sendRaw(to, body) {
  return send(to, body, { skipBranding: true, skipOptOutCheck: true });
}

module.exports = { send, sendRaw, isConfigured, normalizePhone };
