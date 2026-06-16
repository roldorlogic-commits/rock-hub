'use strict';

// Thin email-sending abstraction. If SMTP_HOST/SMTP_USER/SMTP_PASS (or a
// SENDGRID_API_KEY) are configured in the environment, this sends real mail
// via nodemailer. Otherwise every call is mocked: the message is logged to
// the console and appended to a local log file so nothing is silently lost
// while the org doesn't have an email provider wired up yet.
//
// To enable real sending, set in the environment (Railway variables):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and optionally SMTP_FROM
//   (defaults to "ROCK Hub <no-reply@gorock.org>").

const fs   = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const LOG_FILE = path.join(__dirname, '../config/sent-emails.log');
const FROM = process.env.SMTP_FROM || 'ROCK Hub <no-reply@gorock.org>';

let _transport = null;
let _configured = null; // memoized after first check

function isConfigured() {
  if (_configured !== null) return _configured;
  _configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return _configured;
}

function transport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return _transport;
}

function logMock(to, subject, body) {
  const entry = `\n[${new Date().toISOString()}] MOCK EMAIL (no SMTP configured)\nTo: ${to}\nSubject: ${subject}\n${body}\n${'-'.repeat(60)}\n`;
  console.log(entry);
  try { fs.appendFileSync(LOG_FILE, entry); } catch (_) { /* best-effort */ }
}

// Returns { sent: boolean, mocked: boolean } so callers/routes can report
// accurately rather than silently pretending mail always goes out.
async function send(to, subject, body) {
  if (!isConfigured()) {
    logMock(to, subject, body);
    return { sent: false, mocked: true };
  }
  try {
    await transport().sendMail({ from: FROM, to, subject, text: body });
    return { sent: true, mocked: false };
  } catch (err) {
    console.error('Email send failed, falling back to mock log:', err.message);
    logMock(to, subject, `[SEND FAILED: ${err.message}]\n\n${body}`);
    return { sent: false, mocked: true, error: err.message };
  }
}

module.exports = { send, isConfigured };
