'use strict';

const crypto = require('crypto');

function requestId(req, res, next) {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };
