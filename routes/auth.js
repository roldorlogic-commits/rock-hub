'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const sheets   = require('../lib/sheets');
const email    = require('../lib/email');
const {
  signVolunteerToken, volunteerCookieOptions, VOLUNTEER_COOKIE,
  loginRateLimiter, recordLoginFailure, recordLoginSuccess
} = require('../middleware/auth');

const VP_EMAIL = 'vicepresident@gorock.org';

function today() { return new Date().toISOString().slice(0, 10); }

module.exports = function (passport) {
  const router = express.Router();
  router.use(express.json());

  // ── Board / Staff — Google OAuth ────────────────────────────────────────
  router.get('/google', passport.authenticate('google', {
    scope: ['email', 'profile'],
    prompt: 'select_account'
  }));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/?error=access_denied' }),
    (req, res) => res.redirect(req.user?.role === 'Board' ? '/board' : '/volunteer')
  );

  // Logout clears both auth paths — Passport session (Board) and the
  // volunteer JWT cookie — so one button works for every role.
  router.post('/logout', (req, res, next) => {
    res.clearCookie(VOLUNTEER_COOKIE);
    req.logout(err => {
      if (err) return next(err);
      res.redirect('/');
    });
  });

  // ── Volunteer registration ──────────────────────────────────────────────
  router.post('/volunteer/register', async (req, res) => {
    try {
      const { firstName, lastName, email: rawEmail, phone, password, confirmPassword, church, agree } = req.body || {};
      const emailNorm = (rawEmail || '').trim().toLowerCase();

      if (!firstName || !lastName || !emailNorm || !phone || !password) {
        return res.status(400).json({ error: 'Please fill in all required fields.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match.' });
      }
      if (!agree) {
        return res.status(400).json({ error: 'Please agree to the volunteer terms to continue.' });
      }

      const existing = await sheets.findVolunteerAuthByEmail(emailNorm);
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists. Try logging in instead.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const volunteerId  = `VOL${Date.now()}`;
      const notes = `Self-registered via hub.${church ? ` Church/Org: ${church}.` : ''}`;

      await sheets.appendRow('Volunteers', {
        VolunteerID: volunteerId, FirstName: firstName, LastName: lastName,
        Email: emailNorm, Phone: phone, Status: 'Pending', JoinDate: today(),
        HoursLogged: '0', Notes: notes
      });
      await sheets.appendRow('VolunteerAuth', {
        Email: emailNorm, PasswordHash: passwordHash, VolunteerID: volunteerId,
        Status: 'Pending', CreatedAt: today(), UpdatedAt: today()
      });

      await email.send(
        emailNorm,
        'Welcome to the ROCK Hub — registration received',
        `Hi ${firstName},\n\nThanks for registering as a volunteer with The ROCK Association! Your account is pending approval. You'll receive an email once a board member confirms your volunteer status.\n\n— The ROCK Association`
      );
      await email.send(
        VP_EMAIL,
        `New volunteer registered: ${firstName} ${lastName}`,
        `New volunteer registered: ${firstName} ${lastName} (${emailNorm}) — please review and confirm in the Hub at /volunteers/pending.`
      );

      res.json({ ok: true, message: "You're registered! Check your email for confirmation. Once approved, you can log in to select events and get involved." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Volunteer login ──────────────────────────────────────────────────────
  router.post('/volunteer/login', loginRateLimiter, async (req, res) => {
    try {
      const emailNorm = (req.body?.email || '').trim().toLowerCase();
      const password  = req.body?.password || '';
      if (!emailNorm || !password) return res.status(400).json({ error: 'Please enter your email and password.' });

      const authRow = await sheets.findVolunteerAuthByEmail(emailNorm);
      const genericError = 'Incorrect email or password.';
      if (!authRow) { recordLoginFailure(emailNorm); return res.status(401).json({ error: genericError }); }

      const match = await bcrypt.compare(password, authRow.PasswordHash || '');
      if (!match) { recordLoginFailure(emailNorm); return res.status(401).json({ error: genericError }); }

      recordLoginSuccess(emailNorm);

      if (authRow.Status === 'Declined') {
        return res.status(403).json({ error: `We're unable to confirm your volunteer registration at this time. Contact ${VP_EMAIL} for more information.` });
      }

      const volunteer = await sheets.getVolunteerById(authRow.VolunteerID);
      const name = [volunteer?.FirstName, volunteer?.LastName].filter(Boolean).join(' ') || emailNorm;

      const token = signVolunteerToken({
        email: authRow.Email, name, firstName: volunteer?.FirstName || '',
        volunteerId: authRow.VolunteerID, authStatus: authRow.Status
      });
      res.cookie(VOLUNTEER_COOKIE, token, volunteerCookieOptions());
      res.json({ ok: true, redirect: authRow.Status === 'Active' ? '/volunteer' : '/volunteer/pending-approval' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Forgot / reset password ─────────────────────────────────────────────
  router.post('/volunteer/forgot-password', async (req, res) => {
    const emailNorm = (req.body?.email || '').trim().toLowerCase();
    const genericMsg = "If that email is registered, you'll receive reset instructions shortly.";
    if (!emailNorm) return res.status(400).json({ error: 'Please enter your email address.' });

    try {
      const authRow = await sheets.findVolunteerAuthByEmail(emailNorm);
      if (authRow) {
        const token  = crypto.randomBytes(24).toString('hex');
        const expiry = Date.now() + 60 * 60 * 1000; // 1 hour
        await sheets.updateRowFields('VolunteerAuth', 'Email', authRow.Email, {
          ResetToken: token, ResetTokenExpiry: String(expiry), UpdatedAt: today()
        });
        const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        const link = `${base}/reset-password?token=${token}&email=${encodeURIComponent(authRow.Email)}`;
        await email.send(authRow.Email, 'Reset your ROCK Hub password',
          `We received a request to reset your password.\n\nThis link is valid for 1 hour:\n${link}\n\nIf you didn't request this, you can ignore this email.`);
      }
      // Always the same response — don't reveal whether the email exists.
      res.json({ ok: true, message: genericMsg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/volunteer/reset-password', async (req, res) => {
    try {
      const emailNorm = (req.body?.email || '').trim().toLowerCase();
      const { token, newPassword, confirmPassword } = req.body || {};
      if (!emailNorm || !token || !newPassword) return res.status(400).json({ error: 'Missing required fields.' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

      const authRow = await sheets.findVolunteerAuthByEmail(emailNorm);
      const invalid = !authRow || authRow.ResetToken !== token || !authRow.ResetTokenExpiry || Date.now() > parseInt(authRow.ResetTokenExpiry, 10);
      if (invalid) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await sheets.updateRowFields('VolunteerAuth', 'Email', authRow.Email, {
        PasswordHash: passwordHash, ResetToken: '', ResetTokenExpiry: '', UpdatedAt: today()
      });
      res.json({ ok: true, message: 'Your password has been reset. You can now log in.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
