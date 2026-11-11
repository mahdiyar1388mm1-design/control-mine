'use strict';

const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db = null;

function getDb() {
  if (!db) {
    db = new DatabaseSync(config.dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
  }
  return db;
}

function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

/** Run fn inside an IMMEDIATE transaction (single level). */
function tx(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

function close() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

module.exports = { getDb, all, get, run, tx, close };
