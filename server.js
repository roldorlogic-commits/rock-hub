'use strict';

require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const fs   = require('fs');
const path = require('path');
const sheetsLib = require('./lib/sheets');

const app  = express();
const PORT = process.env.PORT;

// OAuth credentials: env vars take precedence (required on Railway); fall back to local gcloud ADC file for dev
let ADC = { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET };
if (!ADC.client_id) {
  try {
    Object.assign(ADC, JSON.parse(
      fs.readFileSync(path.join(process.env.HOME, '.config/gcloud/application_default_credentials.json'), 'utf8')
    ));
  } catch (_) { console.warn('Warning: GOOGLE_CLIENT_ID not set and gcloud ADC file not found.'); }
}

// ── Google OAuth strategy ────────────────────────────────────────────────────
const CALLBACK_BASE = process.env.APP_URL || `http://localhost:${PORT}`;

passport.use(new GoogleStrategy(
  {
    clientID:     ADC.client_id     || 'UNCONFIGURED',
    clientSecret: ADC.client_secret || 'UNCONFIGURED',
    callbackURL:  `${CALLBACK_BASE}/auth/google/callback`,
    hd:           'gorock.org'
  },
  async (_accessToken, _refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value ?? '';
    if (!email.endsWith('@gorock.org')) {
      return done(null, false, { message: 'Access restricted to @gorock.org accounts.' });
    }
    try {
      const role = await sheetsLib.getUserRole(email);
      return done(null, {
        email,
        name:      profile.displayName,
        firstName: profile.name?.givenName ?? email.split('@')[0],
        photo:     profile.photos?.[0]?.value ?? null,
        role:      role || 'Volunteer'
      });
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',    require('./routes/auth')(passport));
app.use('/api',     require('./routes/api'));
app.use('/social',  require('./routes/social'));

const { requireAuth, requireBoard } = require('./middleware/auth');

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect(req.user.role === 'Board' ? '/board' : '/volunteer');
  }
  res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.get('/board',        requireBoard, (req, res) => res.sendFile(path.join(__dirname, 'views/board.html')));
app.get('/volunteer',    requireAuth,  (req, res) => res.sendFile(path.join(__dirname, 'views/volunteer.html')));
app.get('/social-feed',  requireBoard, (req, res) => res.sendFile(path.join(__dirname, 'views/social.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ROCK Hub  →  http://0.0.0.0:${PORT}\n`);
});
