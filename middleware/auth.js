'use strict';

const path = require('path');
const jwt  = require('jsonwebtoken');

const VP_EMAIL = 'vicepresident@gorock.org';

// Falls back to SESSION_SECRET so a missing JWT_SECRET doesn't hard-crash the
// app, but this should be set to its own value in production — see the
// final report for why.
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;
if (!process.env.JWT_SECRET) {
  console.warn('Warning: JWT_SECRET not set — falling back to SESSION_SECRET. Set a dedicated JWT_SECRET in production.');
}

const VOLUNTEER_COOKIE = 'volunteer_token';

function signVolunteerToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function volunteerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

// Reads + verifies the volunteer JWT cookie, if present. Returns the decoded
// payload or null — never throws (an expired/tampered token is just treated
// as "not logged in").
function getJwtVolunteer(req) {
  const token = req.cookies?.[VOLUNTEER_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) {
    return null;
  }
}

// Populates req.user the same shape regardless of which path authenticated
// the request, so every existing route that reads req.user.email/role/name
// keeps working unchanged.
function attachUser(req, res, next) {
  if (req.isAuthenticated() && req.user) return next(); // Board, via Google OAuth/Passport session
  const jv = getJwtVolunteer(req);
  if (jv) {
    req.user = {
      email: jv.email, name: jv.name, firstName: jv.firstName,
      role: 'Volunteer', volunteerId: jv.volunteerId, authStatus: jv.authStatus,
      photo: null
    };
    req.isAuthenticated = () => true;
  }
  next();
}

function requireAuth(req, res, next) {
  attachUser(req, res, () => {
    if (req.isAuthenticated() && req.user) return next();
    res.redirect('/?error=login_required');
  });
}

function requireBoard(req, res, next) {
  attachUser(req, res, () => {
    if (req.isAuthenticated() && req.user?.role === 'Board') return next();
    if (req.isAuthenticated() && req.user) return res.redirect('/volunteer');
    res.redirect('/?error=login_required');
  });
}

// A few spec'd board-only routes also accept an "Admin" role.
function requireBoardOrAdmin(req, res, next) {
  attachUser(req, res, () => {
    if (req.isAuthenticated() && ['Board', 'Admin'].includes(req.user?.role)) return next();
    if (req.isAuthenticated() && req.user) return res.status(403).send('Forbidden — Board or Admin access required.');
    res.redirect('/?error=login_required');
  });
}

// Volunteer dashboard/API routes: must be logged in via the volunteer JWT
// (or be Board, who can see anything) AND, if a volunteer, have an Active
// VolunteerAuth status — Pending accounts get redirected to the
// awaiting-approval page instead of a hard 403.
function requireActiveVolunteer(req, res, next) {
  attachUser(req, res, () => {
    if (!req.isAuthenticated() || !req.user) return res.redirect('/?error=login_required');
    if (req.user.role === 'Board') return next();
    if (req.user.authStatus && req.user.authStatus !== 'Active') return res.redirect('/volunteer/pending-approval');
    next();
  });
}

// Restricts a route to the VP account only. Returns 403 for all other
// authenticated users; 401 (or redirect) if not logged in at all.
function requireVP(req, res, next) {
  attachUser(req, res, () => {
    if (!req.isAuthenticated() || !req.user) {
      const isApi = req.baseUrl?.startsWith('/api') || req.path?.startsWith('/api');
      return isApi
        ? res.status(401).json({ error: 'Authentication required.' })
        : res.redirect('/?error=login_required');
    }
    if (req.user.email !== VP_EMAIL) {
      const isApi = req.baseUrl?.startsWith('/api') || req.path?.startsWith('/api');
      return isApi
        ? res.status(403).json({ error: 'Access restricted to administrator.' })
        : res.status(403).sendFile(path.join(__dirname, '../views/403.html'));
    }
    next();
  });
}

// ── Login rate limiting (in-memory; resets on deploy/restart) ──────────────
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS     = 15 * 60 * 1000;
const _attempts = new Map(); // email -> { count, lockUntil }

function loginRateLimiter(req, res, next) {
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return next();
  const rec = _attempts.get(email);
  if (rec?.lockUntil && rec.lockUntil > Date.now()) {
    const minsLeft = Math.ceil((rec.lockUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many failed login attempts. Try again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}.` });
  }
  next();
}

function recordLoginFailure(email) {
  const key = (email || '').toLowerCase().trim();
  if (!key) return;
  const rec = _attempts.get(key) || { count: 0, lockUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.lockUntil = Date.now() + LOCKOUT_MS;
  _attempts.set(key, rec);
}

function recordLoginSuccess(email) {
  _attempts.delete((email || '').toLowerCase().trim());
}

module.exports = {
  VP_EMAIL,
  attachUser,
  requireAuth, requireBoard, requireBoardOrAdmin, requireActiveVolunteer, requireVP,
  signVolunteerToken, volunteerCookieOptions, getJwtVolunteer, VOLUNTEER_COOKIE,
  loginRateLimiter, recordLoginFailure, recordLoginSuccess
};
