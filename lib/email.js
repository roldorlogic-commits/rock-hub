'use strict';

// Email sending via SendGrid. If SENDGRID_API_KEY is not set, every call is
// mocked: logged to console and appended to config/sent-emails.log.
//
// Set in Railway environment variables:
//   SENDGRID_API_KEY   — API key starting with "SG."
//   INBOUND_REPLY_TO   — optional. When set, every outgoing email carries this
//                        as its Reply-To header instead of the From address,
//                        so replies land on the Inbound Parse webhook (see
//                        routes/email-inbound.js) instead of the real
//                        info@gorock.org inbox. e.g. reply@reply.gorock.org

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
// opts.replyTo overrides the default Reply-To for this one message; pass
// opts.replyTo: null to force no Reply-To even if INBOUND_REPLY_TO is set.
async function send(to, subject, text, html, opts) {
  if (!isConfigured()) {
    logMock(to, subject, text || '');
    return { sent: false, mocked: true };
  }
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = { to, from: process.env.SENDGRID_FROM || 'info@gorock.org', subject, text: text || '' };
    if (html) msg.html = html;
    const replyTo = opts && 'replyTo' in opts ? opts.replyTo : process.env.INBOUND_REPLY_TO;
    if (replyTo) msg.replyTo = replyTo;
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
