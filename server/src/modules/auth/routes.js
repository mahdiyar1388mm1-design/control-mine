'use strict';

const express = require('express');
const authService = require('./service');
const { requireAuth } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');
const config = require('../../config');

const router = express.Router();

function setAuthCookie(res, token) {
  res.cookie('cm_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.tokenTtlSec * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie('cm_token', { path: '/' });
}

router.post('/register', rateLimit({ name: 'register', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    const result = authService.register({ ...req.body, user_agent: req.header('user-agent') });
    setAuthCookie(res, result.token);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/login', rateLimit({ name: 'login', windowSec: 300, max: 20 }), (req, res, next) => {
  try {
    const result = authService.login({ ...req.body, user_agent: req.header('user-agent') });
    setAuthCookie(res, result.token);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/otp/request', rateLimit({ name: 'otp-request', windowSec: 300, max: 10 }), (req, res, next) => {
  try {
    res.json(authService.requestOtp(req.body));
  } catch (err) { next(err); }
});

router.post('/otp/verify', rateLimit({ name: 'otp-verify', windowSec: 300, max: 20 }), (req, res, next) => {
  try {
    const result = authService.verifyOtp({ ...req.body, user_agent: req.header('user-agent') });
    setAuthCookie(res, result.token);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, (req, res, next) => {
  try {
    const out = authService.logout(req.sessionId);
    clearAuthCookie(res);
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res, next) => {
  try {
    res.json({ user: authService.me(req.user.id) });
  } catch (err) { next(err); }
});

router.post('/change-password', requireAuth, (req, res, next) => {
  try {
    res.json(authService.changePassword(req.user.id, req.sessionId, req.body));
  } catch (err) { next(err); }
});

module.exports = router;
