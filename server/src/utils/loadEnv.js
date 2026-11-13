'use strict';

/**
 * Minimal `.env` loader (no dependency).
 *
 * Why this exists: the README and `.env.example` tell operators to create a
 * `.env` file, but nothing ever read it — every `CM_*` setting had to be
 * exported by hand, and a forgotten `export` silently fell back to a dev
 * default (e.g. `NODE_ENV=development`, secure cookies off). This loader makes
 * the documented workflow actually work.
 *
 * Rules:
 *  - Real environment variables always win; `.env` never overrides them.
 *  - Looked up in `server/.env`, then the repository root `.env`.
 *  - Only `KEY=VALUE` lines; `#` comments; optional surrounding quotes; a
 *    leading `export ` is tolerated so a shell-style file works too.
 *  - Values are NOT interpolated — keep secrets literal.
 *  - Loaded files are reported (path only, never values) for the boot log.
 */

const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Candidate files, most specific first. */
function envFiles(root) {
  return [path.join(root, 'server', '.env'), path.join(root, '.env')];
}

/**
 * Loads the first `.env` found. Pass `{ override: true }` only for tooling that
 * must re-read the file (never in production boot).
 * @returns {{ loaded: string|null, applied: string[], skipped: string[] }}
 */
function loadEnv({ root = path.join(__dirname, '..', '..'), override = false, silent = false } = {}) {
  const result = { loaded: null, applied: [], skipped: [] };
  const file = envFiles(root).find((f) => {
    try { return fs.statSync(f).isFile(); } catch { return false; }
  });
  if (!file) {
    if (!silent) return result;
    return result;
  }

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return result;
  }

  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    const already = Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== '';
    if (already && !override) {
      result.skipped.push(key);
      continue;
    }
    process.env[key] = value;
    result.applied.push(key);
  }
  result.loaded = file;
  return result;
}

module.exports = { loadEnv, parseEnv, envFiles };
