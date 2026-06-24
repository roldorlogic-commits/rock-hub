'use strict';

require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const cookieParser = require('cookie-parser');
const passport      = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const fs   = require('fs');
const path = require('path');
const sheetsLib = require('./lib/sheets');

const app  = express();
const PORT = process.env.PORT;

// Railway sits behind a proxy — trust first hop so req.ip reflects the client IP.
app.set('trust proxy', 1);

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  // httpOnly (default, stated explicitly) keeps the session cookie out of
  // reach of client-side JS; sameSite:'lax' allows the Google OAuth redirect
  // back into the app to still carry the cookie. 7 days so a board/volunteer
  // signing in once stays signed in across normal browser sessions.
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Activity logging middleware ───────────────────────────────────────────────
// Runs after static files (already handled above) so we only capture
// authenticated app requests. Writes are batched; never blocks the request.
const { attachUser } = require('./middleware/auth');

const SKIP_LOG_PATHS = new Set([
  '/api/me',             // called on every page load — low signal, high noise
  '/api/admin/activity'  // avoid recursive self-logging
]);

function deriveAction(method, urlPath) {
  const m = method.toUpperCase();
  if (m === 'GET')               return 'View';
  if (m === 'POST')              return 'Create';
  if (m === 'PATCH' || m === 'PUT') return 'Update';
  if (m === 'DELETE')            return 'Delete';
  return m;
}

app.use((req, res, next) => {
  if (SKIP_LOG_PATHS.has(req.path)) return next();
  attachUser(req, res, () => {
    if (req.user) {
      sheetsLib.logActivity({
        email:     req.user.email,
        action:    deriveAction(req.method, req.path),
        route:     req.path,
        method:    req.method,
        ip:        req.ip || '',
        userAgent: (req.headers['user-agent'] || '').slice(0, 200)
      });
    }
    next();
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',       require('./routes/auth')(passport));
app.use('/api',        require('./routes/api'));
app.use('/api',        require('./routes/events'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/social',     require('./routes/social'));

const { requireAuth, requireBoard, requireBoardOrAdmin, requireActiveVolunteer, requireVP, getJwtVolunteer } = require('./middleware/auth');

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect(req.user.role === 'Board' ? '/board' : '/volunteer');
  }
  const jv = getJwtVolunteer(req);
  if (jv) return res.redirect(jv.authStatus === 'Active' ? '/volunteer' : '/volunteer/pending-approval');
  res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.get('/register',       (req, res) => res.redirect('/?tab=volunteer&mode=new'));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'views/reset-password.html')));

app.get('/board',        requireBoard, (req, res) => res.sendFile(path.join(__dirname, 'views/board.html')));
app.get('/volunteer',    requireActiveVolunteer, (req, res) => res.sendFile(path.join(__dirname, 'views/volunteer.html')));
app.get('/social-feed',  requireBoard, (req, res) => res.sendFile(path.join(__dirname, 'views/social.html')));

app.get('/volunteer/pending-approval', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/pending-approval.html')));
app.get('/admin/usage', requireVP, (req, res) => res.sendFile(path.join(__dirname, 'views/admin-usage.html')));
app.get('/volunteers/pending', requireBoardOrAdmin, (req, res) => res.sendFile(path.join(__dirname, 'views/pending-volunteers.html')));

// Detail pages — open to both roles; the API endpoints behind them filter
// which fields come back based on req.user.role.
app.get('/members/:id',    requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/member-detail.html')));
app.get('/volunteers/:id', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/volunteer-detail.html')));
app.get('/events/:id',     requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views/event-detail.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
sheetsLib.ensureAllAppSheets()
  .then(created => { if (created.length) console.log('Created missing sheet tabs:', created.join(', ')); })
  .catch(err => console.error('Could not verify/create app sheet tabs on boot:', err.message))
  .finally(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  ROCK Hub  →  http://0.0.0.0:${PORT}\n`);
    });
  });

sheetsLib.ensureColumns('Events', ['PhotoURL'])
  .catch(err => console.error('Could not add PhotoURL column to Events:', err.message));

sheetsLib.ensureColumns('Members', ['Tags'])
  .catch(err => console.error('Could not add Tags column to Members:', err.message));

sheetsLib.ensureColumns('Documents', ['DocumentID', 'UploadedBy', 'Tags', 'Source'])
  .catch(err => console.error('Could not add columns to Documents:', err.message));

sheetsLib.ensureColumns('EventRegistrations', ['Category'])
  .catch(err => console.error('Could not add Category column to EventRegistrations:', err.message));
