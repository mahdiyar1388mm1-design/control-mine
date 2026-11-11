'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { getDb, close } = require('./index');

/**
 * Online safe SQLite backup using VACUUM INTO + optional AES-256-GCM encryption
 * when CM_BACKUP_KEY (64-char hex / passphrase) is provided (§19).
 */
function createBackup({ destDir, encryptionPassphrase } = {}) {
  const outDir = destDir || path.join(path.dirname(config.dbPath), 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawFile = path.join(outDir, `central-mine-${stamp}.db`);
  const d = getDb();
  const escaped = rawFile.replace(/'/g, "''");
  d.exec(`VACUUM INTO '${escaped}'`);

  const pass = encryptionPassphrase || process.env.CM_BACKUP_KEY || '';
  if (!pass) {
    return { path: rawFile, encrypted: false, size_bytes: fs.statSync(rawFile).size };
  }

  const key = crypto.scryptSync(pass, 'cm-backup-v1', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = fs.readFileSync(rawFile);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encFile = `${rawFile}.enc`;
  fs.writeFileSync(encFile, Buffer.concat([Buffer.from('CMBK1'), iv, tag, enc]), { mode: 0o600 });
  fs.unlinkSync(rawFile);
  return { path: encFile, encrypted: true, size_bytes: fs.statSync(encFile).size };
}

function restoreEncryptedBackup(encFile, destDbPath, passphrase) {
  const buf = fs.readFileSync(encFile);
  if (buf.subarray(0, 5).toString('utf8') !== 'CMBK1') {
    throw new Error('invalid encrypted backup header');
  }
  const iv = buf.subarray(5, 17);
  const tag = buf.subarray(17, 33);
  const ciphertext = buf.subarray(33);
  const key = crypto.scryptSync(passphrase, 'cm-backup-v1', 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(destDbPath, plain, { mode: 0o600 });
  return { restored_to: destDbPath, size_bytes: plain.length };
}

if (require.main === module) {
  const info = createBackup();
  console.log(JSON.stringify(info));
  close();
}

module.exports = { createBackup, restoreEncryptedBackup };
