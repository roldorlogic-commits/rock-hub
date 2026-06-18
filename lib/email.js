'use strict';

// Email sending via SendGrid. If SENDGRID_API_KEY is not set, every call is
// mocked: the message is logged to the console and appended to a local log
// file so nothing is silently lost while the env var is missing.
//
// To enable real sending, set in Railway environment variables:
//   SENDGRID_API_KEY  — your SendGrid API key (starts with "SG.")
//   SMTP_FROM         — optional sender override (default: "ROCK Hub <info@gorock.org>")

const fs      = require('fs');
const path    = require('path');
const sgMail  = require('@sendgrid/mail');

const LOG_FILE = path.join(__dirname, '../config/sent-emails.log');
const FROM     = process.env.SMTP_FROM || 'ROCK Hub <info@gorock.org>';

let _configured = null;

function isConfigured() {
  if (_configured !== null) return _configured;
  _configured = !!process.env.SENDGRID_API_KEY;
  if (_configured) sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  return _configured;
}

function logMock(to, subject, body) {
  const entry = `\n[${new Date().toISOString()}] MOCK EMAIL (no SENDGRID_API_KEY)\nTo: ${to}\nSubject: ${subject}\n${body}\n${'-'.repeat(60)}\n`;
  console.log(entry);
  try { fs.appendFileSync(LOG_FILE, entry); } catch (_) {}
}

// Returns { sent, mocked?, error? } — never throws.
async function send(to, subject, body) {
  if (!isConfigured()) {
    logMock(to, subject, body);
    return { sent: false, mocked: true };
  }
  try {
    await sgMail.send({ to, from: FROM, subject, text: body });
    return { sent: true, mocked: false };
  } catch (err) {
    const msg = err.response?.body?.errors?.[0]?.message || err.message;
    console.error('SendGrid send failed, falling back to mock log:', msg);
    logMock(to, subject, `[SEND FAILED: ${msg}]\n\n${body}`);
    return { sent: false, mocked: true, error: msg };
  }
}

module.exports = { send, isConfigured };
