'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./index');

const migrationsDir = path.join(__dirname, 'migrations');

function ensureMigrationsTable(d) {
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
}

function migrate(log = () => {}) {
  const d = getDb();
  ensureMigrationsTable(d);
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const already = d.prepare('SELECT 1 AS x FROM schema_migrations WHERE version = ?').get(version);
    if (already) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString());
      d.exec('COMMIT');
      log(`migration applied: ${version}`);
    } catch (err) {
      try { d.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`migration ${version} failed: ${err.message}`);
    }
  }
}

function rollback(steps = 1, log = () => {}) {
  const d = getDb();
  ensureMigrationsTable(d);
  const applied = d.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT ?').all(steps);
  const rolledBack = [];
  for (const row of applied) {
    const downPath = path.join(migrationsDir, `${row.version}.down.sql`);
    if (!fs.existsSync(downPath)) {
      throw new Error(`missing rollback file for migration ${row.version}`);
    }
    const sql = fs.readFileSync(downPath, 'utf8');
    d.exec('PRAGMA foreign_keys = OFF');
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(sql);
      d.prepare('DELETE FROM schema_migrations WHERE version = ?').run(row.version);
      d.exec('COMMIT');
      d.exec('PRAGMA foreign_keys = ON');
      rolledBack.push(row.version);
      log(`migration rolled back: ${row.version}`);
    } catch (err) {
      try { d.exec('ROLLBACK'); } catch { /* ignore */ }
      d.exec('PRAGMA foreign_keys = ON');
      throw new Error(`rollback ${row.version} failed: ${err.message}`);
    }
  }
  return rolledBack;
}

if (require.main === module) {
  if (process.argv[2] === 'down') {
    const steps = Number(process.argv[3] || 1);
    rollback(steps, (m) => console.log(m));
    console.log('rollback complete');
  } else {
    migrate((m) => console.log(m));
    console.log('migrations up to date');
  }
}

module.exports = { migrate, rollback };
