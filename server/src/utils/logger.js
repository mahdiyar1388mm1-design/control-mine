'use strict';

/** Minimal structured logger. Phone numbers and tokens are masked. */

function maskPhone(text) {
  return String(text).replace(/(09\d{2})\d{5}(\d{2})/g, '$1*****$2');
}

function maskSecrets(text) {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1***')
    .replace(/("?(?:password|token|secret|code)"?\s*[:=]\s*)"?[^",\s}]+"?/gi, '$1"***"');
}

function log(level, message, meta) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message: maskSecrets(maskPhone(message)),
    ...(meta ? { meta: JSON.parse(maskSecrets(maskPhone(JSON.stringify(meta)))) } : {})
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

module.exports = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta)
};
