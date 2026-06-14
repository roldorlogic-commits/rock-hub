'use strict';

const express = require('express');

module.exports = function (passport) {
  const router = express.Router();

  router.get('/google', passport.authenticate('google', {
    scope: ['email', 'profile'],
    prompt: 'select_account'
  }));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/?error=access_denied' }),
    (req, res) => res.redirect(req.user?.role === 'Board' ? '/board' : '/volunteer')
  );

  router.post('/logout', (req, res, next) => {
    req.logout(err => {
      if (err) return next(err);
      res.redirect('/');
    });
  });

  return router;
};
