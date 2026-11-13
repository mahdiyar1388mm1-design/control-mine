'use strict';

/**
 * External health monitor — the missing piece between "the panel shows an
 * error" and "somebody is told about it".
 *
 * Runs a set of checks against a *live* server and exits non-zero on failure,
 * so cron, systemd, Uptime Kuma, Zabbix or a CI job can all use it. With
 * --webhook it also posts a JSON alert to Slack/Discord/Telegram-bot style
 * endpoints, so nobody has to watch a dashboard.
 *
 *   node scripts/monitor.js --url https://app.example.com
 *   node scripts/monitor.js --url https://app.example.com --webhook https://hooks.slack.com/…
 *   node scripts/monitor.js --url … --json          # machine-readable output only
 *
 * Checks:
 *   - /health 200 and database integrity ok
 *   - /ready 200 and schema version == migration count
 *   - unauthenticated /api/v1/admin/users is refused (a 200 here is a breach)
 *   - the audit chain still verifies (via the maintenance token, if provided)
 *   - a backup newer than --max-backup-hours exists on this machine
 *
 * Exit: 0 all good · 1 warnings · 2 failures. Ignored failures never page.
 */

require('../server/src/utils/loadEnv').loadEnv();

const fs = require('fs');
const path = require('path');

const config = require('../server/src/config');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (f) => process.argv.includes(`--${f}`);

const results = [];
function check(name, status, detail) {
  results.push({ name, status, detail });
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const base = arg('url', config.publicBaseUrl || '');
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('❌ آدرس سرور لازم است: --url https://app.example.com');
    process.exitCode = 2;
    return;
  }
  const origin = base.replace(/\/$/, '');

  // 1) Liveness + integrity
  try {
    const health = await fetchJson(`${origin}/health`);
    const ok = health.status === 200 && health.body && health.body.db === 'ok';
    const integrity = health.body && health.body.db_integrity;
    check('health', ok && integrity === 'ok' ? 'ok' : 'fail',
      `status=${health.status} db=${health.body && health.body.db} integrity=${integrity}`);
  } catch (err) {
    check('health', 'fail', `unreachable: ${String(err.message).slice(0, 100)}`);
  }

  // 2) Readiness + migration drift
  try {
    const ready = await fetchJson(`${origin}/ready`);
    const migrations = ready.body && ready.body.checks && ready.body.checks.migrations;
    check('ready', ready.status === 200 && migrations ? 'ok' : 'fail',
      `status=${ready.status} migrations_applied=${migrations}`);
  } catch (err) {
    check('ready', 'fail', `unreachable: ${String(err.message).slice(0, 100)}`);
  }

  // 3) Unauthenticated admin API must be refused
  try {
    const probe = await fetchJson(`${origin}/api/v1/admin/users`);
    const refused = [401, 403].includes(probe.status);
    check('auth_wall', refused ? 'ok' : 'fail',
      `/api/v1/admin/users without token → ${probe.status}${refused ? '' : ' (data leak!)'}`);
  } catch (err) {
    check('auth_wall', 'warn', `probe failed: ${String(err.message).slice(0, 100)}`);
  }

  // 4) Audit chain (needs the maintenance token; skipped without it)
  const token = process.env.CM_MAINTENANCE_TOKEN;
  if (token) {
    try {
      const chain = await fetchJson(`${origin}/api/v1/maintenance/audit-chain`, {
        headers: { 'x-maintenance-token': token }
      });
      const ok = chain.status === 200 && chain.body && chain.body.ok;
      check('audit_chain', ok ? 'ok' : 'fail',
        ok ? `checked=${chain.body.checked}` : `status=${chain.status}`);
    } catch (err) {
      check('audit_chain', 'warn', `probe failed: ${String(err.message).slice(0, 100)}`);
    }
  } else {
    check('audit_chain', 'skipped', 'CM_MAINTENANCE_TOKEN تنظیم نشده است');
  }

  // 5) Fresh backup on this machine
  const maxHours = Number(arg('max-backup-hours', '48'));
  const marker = path.join(path.dirname(config.dbPath), 'backups', 'last-backup.json');
  try {
    const info = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const ageHours = (Date.now() - new Date(info.at).getTime()) / 3600000;
    check('backup_freshness', ageHours <= maxHours ? 'ok' : 'fail',
      `${info.file} — ${ageHours.toFixed(1)}h old (limit ${maxHours}h)`);
  } catch {
    check('backup_freshness', 'warn', 'نشانهٔ پشتیبان پیدا نشد (scripts/backup.js اجرا نشده است)');
  }

  const failures = results.filter((r) => r.status === 'fail');
  const warnings = results.filter((r) => r.status === 'warn');
  const code = failures.length ? 2 : warnings.length ? 1 : 0;
  process.exitCode = code;

  if (!has('json')) {
    for (const r of results) {
      const icon = { ok: '✔', warn: '!', fail: '✘', skipped: '·' }[r.status];
      console.log(`${icon} ${r.name.padEnd(18)} ${r.status.toUpperCase().padEnd(8)} ${r.detail}`);
    }
    console.log(`\nنتیجه: ${failures.length} خرابی، ${warnings.length} هشدار از ${results.length} بررسی.`);
  } else {
    console.log(JSON.stringify({ at: new Date().toISOString(), origin, code, results }));
  }

  // Webhook alerting: only failures page, so nobody learns to ignore the alerts.
  const hook = arg('webhook', '');
  if (hook && code === 2) {
    const text = [
      `🚨 CENTRAL MINE — ${failures.length} خرابی در پایش`,
      ...failures.map((f) => `• ${f.name}: ${f.detail}`)
    ].join('\n');
    try {
      await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text, results })
      });
      if (!has('json')) console.log('📣 هشدار به webhook ارسال شد.');
    } catch (err) {
      console.error(`هشدار webhook ارسال نشد: ${String(err.message).slice(0, 120)}`);
    }
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', event: 'monitor.crashed', error: String(err.message).slice(0, 200) }));
  process.exitCode = 2;
});
