'use strict';

// Email sending via SendGrid. If SENDGRID_API_KEY is not set, every call is
// mocked: logged to console and appended to config/sent-emails.log.
//
// Set in Railway environment variables:
//   SENDGRID_API_KEY  — API key starting with "SG."

const fs     = require('fs');
const path   = require('path');
const sgMail = require('@sendgrid/mail');

const LOG_FILE = path.join(__dirname, '../config/sent-emails.log');

function isConfigured() {
  return !!process.env.SENDGRID_API_KEY;
}

function logMock(to, subject, body) {
  const entry = `\n[${new Date().toISOString()}] MOCK EMAIL (no SENDGRID_API_KEY)\nTo: ${to}\nSubject: ${subject}\n${body}\n${'-'.repeat(60)}\n`;
  console.log(entry);
  try { fs.appendFileSync(LOG_FILE, entry); } catch (_) {}
}

// Returns { sent, mocked?, error? } — never throws.
async function send(to, subject, text, html) {
  if (!isConfigured()) {
    logMock(to, subject, text || '');
    return { sent: false, mocked: true };
  }
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = { to, from: 'info@gorock.org', subject, text: text || '' };
    if (html) msg.html = html;
    await sgMail.send(msg);
    return { sent: true, mocked: false };
  } catch (err) {
    const errMsg = err.response?.body?.errors?.[0]?.message || err.message;
    console.error('SendGrid send failed:', errMsg);
    logMock(to, subject, `[SEND FAILED: ${errMsg}]\n\n${text || ''}`);
    return { sent: false, mocked: true, error: errMsg };
  }
}

module.exports = { send, isConfigured };
