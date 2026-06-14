'use strict';

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/?error=login_required');
}

function requireBoard(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'Board') return next();
  if (req.isAuthenticated()) return res.redirect('/volunteer');
  res.redirect('/?error=login_required');
}

module.exports = { requireAuth, requireBoard };
