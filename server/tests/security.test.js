'use strict';

/**
 * Security & database-depth acceptance tests (migration 008/009).
 * Every assertion here maps to a hard requirement of the hardening work:
 *  - password policy, lockout, step-up, password history
 *  - rotating refresh tokens, session revocation, CSRF double-submit
 *  - security headers / CSP, upload signature checks
 *  - tamper-evident audit chain and database invariants (triggers)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-sec-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'security-test-secret-0123456789abcdef0123456789abcdef';
process.env.CM_BACKUP_KEY = 'security-test-backup-passphrase-2026';
process.env.NODE_ENV = 'test';

const { seed } = require('../src/db/seed');
const { get, run, all, close } = require('../src/db');
const { backfillAuditChain, verifyAuditChain } = require('../src/modules/platform/service');
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');

let server;
let baseUrl;

async function api(pathname, { method = 'GET', token, body, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = rawBody;
  if (body !== undefined && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof FormData) {
    payload = body;
  }
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers: h, body: payload, redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

/** TOTP code for the *next* step window: enrollment consumes the current one. */
/**
 * A code from the 30-second window AFTER the one used for enrolment.
 *
 * This helper is a workaround kept for the "replay" assertions below: they must
 * present a code that was genuinely already spent, and regenerating on a new
 * window could silently pass. The normal path no longer needs it — see the
 * regression test "enrolment code still works at the first login", which proves
 * the current window is accepted right after enabling.
 */
function nextTotpCode(secret) {
  const totp = require('../src/utils/totp');
  return totp.generateCode(secret, Date.now() + totp.STEP_SECONDS * 1000);
}

async function loginAs(phone, password = 'Cm@Test1405!') {
  resetRateLimits();
  const res = await api('/api/v1/auth/login', { method: 'POST', body: { phone, password } });
  assert.equal(res.status, 200, `login failed for ${phone}: ${JSON.stringify(res.data)}`);
  return res.data;
}

test.before(async () => {
  seed({ silent: true });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('security: strict password policy rejects weak, personal and re-used passwords', async () => {
  const weakRegister = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { phone: '09125550001', full_name: 'کاربر رمز ضعیف', password: 'password123' }
  });
  assert.equal(weakRegister.status, 400);
  assert.equal(weakRegister.data.error.code, 'VALIDATION_ERROR');
  assert.ok(weakRegister.data.error.details.some((d) => d.field === 'password'));

  const personal = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { phone: '09125550002', full_name: 'مهدی رضایی', password: 'Mahdi09125550002!' }
  });
  assert.equal(personal.status, 400, 'password containing the phone number must be rejected');

  const strong = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { phone: '09125550003', full_name: 'کاربر امن', password: 'Vault#Guard2026' }
  });
  assert.equal(strong.status, 201);
  const token = strong.data.token;

  // Re-using a recent password is refused even when it is strong.
  const reuse = await api('/api/v1/auth/change-password', {
    method: 'POST', token, body: { old_password: 'Vault#Guard2026', new_password: 'Vault#Guard2026' }
  });
  assert.equal(reuse.status, 400);
  assert.match(JSON.stringify(reuse.data), /قبلاً استفاده/);

  const changed = await api('/api/v1/auth/change-password', {
    method: 'POST', token, body: { old_password: 'Vault#Guard2026', new_password: 'Titan#Shield2027' }
  });
  assert.equal(changed.status, 200);
  // Password history now holds both hashes and never the plaintext.
  const history = all('SELECT password_hash FROM password_history WHERE user_id = ?', [strong.data.user.id]);
  assert.ok(history.length >= 2);
  assert.ok(history.every((h) => h.password_hash.startsWith('scrypt$')));
});

test('security: account locks after repeated failures and unlocks through the admin center', async () => {
  resetRateLimits();
  const phone = '09120000011';
  for (let i = 0; i < 5; i += 1) {
    const attempt = await api('/api/v1/auth/login', {
      method: 'POST', body: { phone, password: 'WrongPassword!1' }
    });
    assert.equal(attempt.status, 401, `attempt ${i + 1} must be rejected`);
  }
  const locked = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone, password: 'Cm@Test1405!' }
  });
  assert.equal(locked.status, 429, 'correct password is refused while the account is locked');
  assert.ok(Number(locked.headers.get('retry-after')) > 0);

  const admin = await loginAs('09120000001');
  const unlock = await api('/api/v1/admin/console/security/unlock', {
    method: 'POST', token: admin.token,
    body: { phone, reason: 'تأیید هویت کاربر با تماس تلفنی پشتیبانی' }
  });
  assert.equal(unlock.status, 200);
  assert.ok(unlock.data.cleared_attempts >= 5);

  const ok = await api('/api/v1/auth/login', { method: 'POST', body: { phone, password: 'Cm@Test1405!' } });
  assert.equal(ok.status, 200, 'login works immediately after the admin unlock');
});

test('security: Persian digits are accepted in phone numbers on login and OTP', async () => {
  resetRateLimits();
  const persian = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone: '۰۹۱۲۰۰۰۰۰۱۰', password: 'Cm@Test1405!' }
  });
  assert.equal(persian.status, 200);
  assert.equal(persian.data.user.phone, '09120000010');

  const spaced = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone: '0912 000 0010', password: 'Cm@Test1405!' }
  });
  assert.equal(spaced.status, 200);
});

test('security: rotating refresh tokens, session listing and logout-all revocation', async () => {
  resetRateLimits();
  const first = await loginAs('09120000010');
  assert.ok(first.refreshToken, 'login returns a refresh token');

  // Rotation: the old refresh token stops working after one use.
  const rotated = await api('/api/v1/auth/refresh', {
    method: 'POST', body: { refresh_token: first.refreshToken }
  });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
  assert.ok(rotated.data.refreshToken, `refresh payload: ${JSON.stringify(rotated.data).slice(0, 200)}`);
  assert.notEqual(rotated.data.refreshToken, first.refreshToken);
  assert.ok(rotated.data.token);

  const replay = await api('/api/v1/auth/refresh', {
    method: 'POST', body: { refresh_token: first.refreshToken }
  });
  assert.equal(replay.status, 401, 'a used refresh token cannot be replayed');

  // Only hashes are persisted, never the raw token.
  const stored = all('SELECT token_hash FROM auth_refresh_tokens WHERE user_id = ?', [first.user.id]);
  assert.ok(stored.length >= 2);
  assert.ok(stored.every((r) => r.token_hash.length === 64 && !r.token_hash.includes('.')));

  // Sessions endpoint never leaks tokens.
  const sessions = await api('/api/v1/auth/sessions', { token: rotated.data.token });
  assert.equal(sessions.status, 200);
  assert.ok(sessions.data.items.some((s) => s.current));
  assert.ok(sessions.data.items.every((s) => !('token' in s) && !('refresh' in s)));

  // logout-all keeps the current session and kills the others.
  const second = await loginAs('09120000010');
  const closed = await api('/api/v1/auth/logout-all', { method: 'POST', token: second.token });
  assert.equal(closed.status, 200);
  assert.equal((await api('/api/v1/auth/me', { token: second.token })).status, 200, 'current session survives');
  assert.equal((await api('/api/v1/auth/me', { token: rotated.data.token })).status, 401, 'other sessions are revoked');

  // Clean up so later tests can log in normally.
  resetRateLimits();
});

test('security: CSRF double-submit is enforced for cookie sessions and bypassed for Bearer', async () => {
  const session = await loginAs('09120000010');

  // Cookie-authenticated POST without the CSRF header is refused.
  const cookieOnly = await api('/api/v1/auth/logout', {
    method: 'POST',
    headers: { Cookie: `cm_token=${session.token}`, Origin: baseUrl, 'Content-Type': 'application/json' },
    rawBody: '{}'
  });
  assert.equal(cookieOnly.status, 403);
  assert.match(JSON.stringify(cookieOnly.data), /CSRF/);

  // Bearer clients are not CSRF-exposed and therefore exempt.
  const bearer = await api('/api/v1/auth/logout', { method: 'POST', token: session.token });
  assert.equal(bearer.status, 200);
});

test('security: HTTP security headers and strict CSP on HTML and API responses', async () => {
  const page = await api('/');
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors/);
  assert.match(csp, /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.ok(page.headers.get('permissions-policy'));
  assert.equal(page.headers.get('x-powered-by'), null);

  const apiRes = await api('/api/v1/categories');
  assert.equal(apiRes.headers.get('cache-control'), 'no-store');

  const health = await api('/health');
  assert.equal(health.data.db_integrity, 'ok');
  assert.ok(health.data.schema_version >= 9);
});

test('security: uploads are validated by real file signature, not by declared MIME', async () => {
  const cust = await loginAs('09120000010');

  // A text payload disguised as a PDF must be rejected.
  const fakePdf = new FormData();
  fakePdf.append('files', new Blob(['<script>alert(1)</script>'], { type: 'application/pdf' }), 'invoice.pdf');
  const fakeRes = await api('/api/v1/service-requests', { method: 'POST', token: cust.token, body: fakePdf });
  assert.equal(fakeRes.status, 400);
  assert.match(JSON.stringify(fakeRes.data), /هم‌خوانی ندارد|مجاز/);

  // SVG is never accepted (stored-XSS vector).
  const svg = new FormData();
  svg.append('files', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'x.svg');
  const svgRes = await api('/api/v1/service-requests', { method: 'POST', token: cust.token, body: svg });
  assert.equal(svgRes.status, 400);
});

test('security: audit log is a tamper-evident hash chain and admin can verify it', async () => {
  const admin = await loginAs('09120000001');
  const verify = await api('/api/v1/admin/console/security/audit-chain', { token: admin.token });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.ok, true);
  assert.ok(verify.data.checked > 0);

  // Direct UPDATE/DELETE on the audit log is blocked by triggers.
  assert.throws(() => {
    run("UPDATE audit_log SET action = 'tampered' WHERE rowid = (SELECT MIN(rowid) FROM audit_log)");
  }, /append-only/);
  assert.throws(() => {
    run('DELETE FROM audit_log WHERE rowid = (SELECT MIN(rowid) FROM audit_log)');
  }, /append-only/);

  // Simulated out-of-band tampering (as an attacker with DB access) is detected.
  // The attacker has to drop the DB trigger first; the chain still catches it.
  const row = get('SELECT id, entry_hash FROM audit_log LIMIT 1');
  const triggerSql = get("SELECT sql FROM sqlite_master WHERE name = 'trg_audit_log_no_update'").sql;
  run('DROP TRIGGER trg_audit_log_no_update');
  run("UPDATE audit_log SET entry_hash = 'deadbeef' WHERE id = ?", [row.id]);
  const broken = await api('/api/v1/admin/console/security/audit-chain', { token: admin.token });
  assert.equal(broken.data.ok, false);
  assert.equal(broken.data.reason, 'entry_hash_mismatch');
  run('UPDATE audit_log SET entry_hash = ? WHERE id = ?', [row.entry_hash, row.id]);
  run(triggerSql);
  const restored = await api('/api/v1/admin/console/security/audit-chain', { token: admin.token });
  assert.equal(restored.data.ok, true);

  // The one-time legacy backfill is idempotent and re-verifies cleanly.
  assert.equal(backfillAuditChain(), 0);
  assert.equal(verifyAuditChain().ok, true);
});

test('security: database triggers enforce money, stock, refund and address invariants', async () => {
  const admin = await loginAs('09120000001');

  // Order totals must add up.
  assert.throws(() => {
    run(
      `INSERT INTO orders (id, code, user_id, status, subtotal_toman, shipping_toman, discount_toman, total_toman,
         address_snapshot, shipping_method, created_at, updated_at)
       VALUES ('o-bad-1', 'CM-BADTOTAL', ?, 'pending_payment', 100, 0, 0, 999, '{}', 'post', '2026-01-01', '2026-01-01')`,
      [admin.user.id]
    );
  }, /total must equal/);

  // Stock can never go negative.
  const sku = get('SELECT id FROM skus LIMIT 1');
  assert.throws(() => { run('UPDATE skus SET stock = -5 WHERE id = ?', [sku.id]); }, /cannot be negative/);

  // Refunds cannot exceed the paid amount.
  const payment = get("SELECT id, amount_toman FROM payments WHERE status = 'paid' LIMIT 1");
  assert.ok(payment, 'seeded paid payment exists');
  assert.throws(() => {
    run(
      `INSERT INTO refunds (id, payment_id, amount_toman, reason, reference, status, created_at)
       VALUES ('r-bad-1', ?, ?, 'تست', 'REF-1', 'done', '2026-01-01')`,
      [payment.id, payment.amount_toman * 10]
    );
  }, /refund exceeds/);

  // Orders keep a real foreign key to the address, and used addresses cannot be deleted.
  const order = get('SELECT address_id FROM orders WHERE address_id IS NOT NULL LIMIT 1');
  assert.ok(order && order.address_id, 'seeded order references its address row');
  assert.throws(() => { run('DELETE FROM user_addresses WHERE id = ?', [order.address_id]); }, /referenced by an order/);

  // Exactly one default address per person (trigger demotes the previous default).
  const addr = get('SELECT * FROM user_addresses WHERE user_id = (SELECT user_id FROM orders WHERE address_id IS NOT NULL LIMIT 1) LIMIT 1');
  run('UPDATE user_addresses SET is_default = 1 WHERE id = ?', [addr.id]);
  const defaults = get('SELECT COUNT(*) AS c FROM user_addresses WHERE user_id = ? AND is_default = 1', [addr.user_id]);
  assert.equal(defaults.c, 1);
});

test('security: admin security center reports posture and database depth', async () => {
  const admin = await loginAs('09120000001');
  const posture = await api('/api/v1/admin/console/security/posture', { token: admin.token });
  assert.equal(posture.status, 200);
  assert.ok(posture.data.checks.length >= 6);
  assert.ok(posture.data.score >= 0 && posture.data.score <= 100);
  assert.equal(posture.data.policy.password.min_length >= 12, true);
  assert.equal(posture.data.policy.login_max_failures, 5);

  const db = await api('/api/v1/admin/console/security/database', { token: admin.token });
  assert.equal(db.status, 200);
  assert.equal(db.data.integrity.ok, true);
  assert.equal(db.data.foreign_key_violations, 0);
  assert.ok(db.data.counts.tables > 20);
  assert.ok(db.data.counts.indexes > 40, 'query indexes are present');
  assert.ok(db.data.counts.triggers > 10, 'integrity triggers are present');
  assert.equal(db.data.journal_mode, 'wal');
  // MFA depth must be visible and enforced for privileged roles.
  assert.ok(posture.data.checks.some((c) => c.id === 'mfa_privileged'));
  assert.ok(posture.data.checks.some((c) => c.id === 'audit_chain'));
  assert.ok(posture.data.score >= 0 && posture.data.score <= 100);

  // Customers can never read the security center.
  const cust = await loginAs('09120000010');
  assert.equal((await api('/api/v1/admin/console/security/posture', { token: cust.token })).status, 403);
  assert.equal((await api('/api/v1/admin/console/security/database', { token: cust.token })).status, 403);
});

test('security: step-up proof is required for large treasury movements and role changes', async () => {
  const admin = await loginAs('09120000001');

  const withoutProof = await api('/api/v1/admin/console/treasury/adjust', {
    method: 'POST', token: admin.token,
    body: { direction: 'in', amount_toman: 5000000, reason: 'واریز آزمایشی بدون تأیید' }
  });
  assert.equal(withoutProof.status, 401);

  const wrongPassword = await api('/api/v1/auth/verify-identity', {
    method: 'POST', token: admin.token, body: { password: 'WrongPassword!', purpose: 'sensitive' }
  });
  assert.equal(wrongPassword.status, 401);

  const proof = await api('/api/v1/auth/verify-identity', {
    method: 'POST', token: admin.token, body: { password: 'Cm@Test1405!', purpose: 'sensitive' }
  });
  assert.equal(proof.status, 200);
  assert.ok(proof.data.proof);

  const withProof = await api('/api/v1/admin/console/treasury/adjust', {
    method: 'POST', token: admin.token,
    body: { direction: 'in', amount_toman: 5000000, reauth_proof: proof.data.proof, reason: 'واریز تأییدشدهٔ مدیر' }
  });
  assert.equal(withProof.status, 201);

  // Role change accepted with the proof instead of a password.
  const target = get("SELECT id FROM users WHERE phone = '09120000007'");
  const roleChange = await api(`/api/v1/admin/console/people/${target.id}`, {
    method: 'PATCH', token: admin.token,
    body: { role: 'operator', reason: 'تداوم شیفت با تأیید هویت مدیر', reauth_proof: proof.data.proof }
  });
  assert.equal(roleChange.status, 200);

  // A small movement stays frictionless.
  const small = await api('/api/v1/admin/console/treasury/adjust', {
    method: 'POST', token: admin.token,
    body: { direction: 'in', amount_toman: 50000, reason: 'تنخواه جزئی دفتر' }
  });
  assert.equal(small.status, 201);
});

test('security: search input is treated literally (LIKE wildcards escaped)', async () => {
  resetRateLimits();
  const admin = await loginAs('09120000001');
  const wildcard = await api('/api/v1/admin/console/people?q=%25', { token: admin.token });
  assert.equal(wildcard.status, 200);
  // A bare '%' must not behave as "match everything".
  const everything = await api('/api/v1/admin/console/people?limit=100', { token: admin.token });
  assert.ok(wildcard.data.items.length <= everything.data.items.length);
  assert.equal(wildcard.data.items.length, 0);

  const underscore = await api('/api/v1/products?q=_', {});
  assert.equal(underscore.status, 200);
  assert.equal(underscore.data.items.length, 0);
});

// ---------------------------------------------------------------------------
// Two-factor authentication (migration 010) — enrollment policy override
// ---------------------------------------------------------------------------

test('security: the persisted MFA policy governs privileged enrollment enforcement', async () => {
  const { setSetting } = require('../src/modules/platform/service');
  const mfa = require('../src/modules/auth/mfa');
  setSetting('security_mfa_enforced_roles', JSON.stringify(['admin']));
  assert.deepEqual(mfa.enforcedRoles(), ['admin'], 'finance is no longer enforced by policy');

  const admin = await loginAs('09120000001');
  const status = await api('/api/v1/auth/mfa/status', { token: admin.token });
  assert.equal(status.data.enforced_for_role, true);

  setSetting('security_mfa_enforced_roles', JSON.stringify(['admin', 'finance']));
  assert.deepEqual(mfa.enforcedRoles(), ['admin', 'finance'], 'policy is restorable');

  // A malformed setting must fall back to the safe default, never to "nothing".
  setSetting('security_mfa_enforced_roles', 'not-json');
  assert.deepEqual(mfa.enforcedRoles(), ['admin', 'finance']);
  setSetting('security_mfa_enforced_roles', JSON.stringify(['admin', 'finance']));
});

// ---------------------------------------------------------------------------
// Two-factor authentication (migration 010)
// ---------------------------------------------------------------------------

test('security: TOTP enrollment, challenge login, replay defence and recovery codes', async () => {
  const totp = require('../src/utils/totp');
  const user = '09125550003'; // registered with Titan#Shield2027 in the policy test above
  const session = await loginAs(user, 'Titan#Shield2027');

  assert.equal((await api('/api/v1/auth/mfa/status', { token: session.token })).data.enabled, false);

  // Enrollment: intent is stored but the factor stays inactive until confirmed.
  const setup = await api('/api/v1/auth/mfa/setup', { method: 'POST', token: session.token });
  assert.equal(setup.status, 200);
  assert.ok(setup.data.secret.length >= 16);
  assert.match(setup.data.otpauth_uri, /^otpauth:\/\/totp\//);
  assert.equal((await api('/api/v1/auth/mfa/status', { token: session.token })).data.enabled, false);

  // Wrong code never activates the factor.
  const badEnable = await api('/api/v1/auth/mfa/enable', { method: 'POST', token: session.token, body: { code: '000000' } });
  assert.equal(badEnable.status, 400);

  const enable = await api('/api/v1/auth/mfa/enable', {
    method: 'POST', token: session.token, body: { code: totp.generateCode(setup.data.secret) }
  });
  assert.equal(enable.status, 200, JSON.stringify(enable.data));
  assert.equal(enable.data.enabled, true);
  assert.equal(enable.data.recovery_codes.length, 8);

  // The secret is never stored in clear and never returned by the status endpoint.
  const stored = get('SELECT secret_enc, enabled FROM user_mfa WHERE user_id = ?', [session.user.id]);
  assert.equal(stored.enabled, 1);
  assert.ok(stored.secret_enc.startsWith('v1:'));
  assert.ok(!stored.secret_enc.includes(setup.data.secret));
  const statusAgain = await api('/api/v1/auth/mfa/status', { token: session.token });
  assert.equal(JSON.stringify(statusAgain.data).includes(setup.data.secret), false);

  // Password alone no longer yields a session.
  const challengeLogin = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone: user, password: 'Titan#Shield2027' }
  });
  assert.equal(challengeLogin.status, 200);
  assert.equal(challengeLogin.data.mfa_required, true);
  assert.equal(challengeLogin.data.token, undefined, 'no access token before the second factor');
  assert.equal(challengeLogin.data.refreshToken, undefined);
  const challengeToken = challengeLogin.data.challenge_token;

  // Wrong code is rejected and counted.
  const wrong = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: challengeToken, code: '123456' }
  });
  assert.equal(wrong.status, 401);

  // Correct code completes the login (the enrollment step itself is already spent).
  // One code string is captured and reused on purpose: the replay assertions below
  // must present the *same* code, and regenerating it could silently move to a new
  // 30-second window and make the test time-dependent.
  const goodCode = nextTotpCode(setup.data.secret);
  const good = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: challengeToken, code: goodCode }
  });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.ok(good.data.token);
  assert.ok(good.data.refreshToken);
  assert.equal(good.data.user.phone, user);

  // A challenge token is single-use.
  const reuse = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: challengeToken, code: goodCode }
  });
  assert.equal(reuse.status, 401);

  // Replaying the same TOTP step in a new challenge is refused (replay guard).
  const secondChallenge = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone: user, password: 'Titan#Shield2027' }
  });
  const replay = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: secondChallenge.data.challenge_token, code: goodCode }
  });
  assert.equal(replay.status, 401, 'a used TOTP step cannot authorise a second login');

  // Recovery code works exactly once.
  const recovery = await api('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challenge_token: secondChallenge.data.challenge_token, recovery_code: enable.data.recovery_codes[0] }
  });
  assert.equal(recovery.status, 200, JSON.stringify(recovery.data));
  assert.equal((await api('/api/v1/auth/mfa/status', { token: recovery.data.token })).data.recovery_codes_left, 7);

  const third = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone: user, password: 'Titan#Shield2027' }
  });
  const reusedRecovery = await api('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challenge_token: third.data.challenge_token, recovery_code: enable.data.recovery_codes[0] }
  });
  assert.equal(reusedRecovery.status, 401, 'a recovery code cannot be used twice');

  // Disabling requires the password and a live code.
  assert.equal((await api('/api/v1/auth/mfa/disable', {
    method: 'POST', token: recovery.data.token, body: { password: 'wrong-password-here', code: totp.generateCode(setup.data.secret) }
  })).status, 401);
  const disabled = await api('/api/v1/auth/mfa/disable', {
    method: 'POST', token: recovery.data.token,
    body: { password: 'Titan#Shield2027', recovery_code: enable.data.recovery_codes[1] }
  });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
  assert.equal(disabled.data.enabled, false);

  // Login is single-factor again.
  const plain = await api('/api/v1/auth/login', { method: 'POST', body: { phone: user, password: 'Titan#Shield2027' } });
  assert.equal(get('SELECT COUNT(*) AS c FROM user_mfa WHERE user_id = ?', [session.user.id]).c, 0);
  assert.ok(plain.data.token, JSON.stringify(plain.data));
  assert.equal(plain.data.mfa_required, undefined);
});

test('security: privileged roles cannot be locked out of MFA and the security center reports coverage', async () => {
  const totp = require('../src/utils/totp');
  const admin = await loginAs('09120000001');

  const posture = await api('/api/v1/admin/console/security/posture', { token: admin.token });
  assert.equal(posture.status, 200);
  assert.ok(posture.data.mfa.privileged_users >= 1);
  assert.ok(posture.data.mfa.with_mfa + posture.data.mfa.without_mfa === posture.data.mfa.privileged_users);
  assert.equal(typeof posture.data.mfa.without_mfa, 'number');

  // Enroll the admin account, then confirm self-service disable is blocked.
  const setup = await api('/api/v1/auth/mfa/setup', { method: 'POST', token: admin.token });
  const enable = await api('/api/v1/auth/mfa/enable', {
    method: 'POST', token: admin.token, body: { code: totp.generateCode(setup.data.secret) }
  });
  assert.equal(enable.status, 200);

  const after = await api('/api/v1/admin/console/security/posture', { token: admin.token });
  assert.equal(after.data.mfa.without_mfa, posture.data.mfa.without_mfa - 1);

  const blocked = await api('/api/v1/auth/mfa/disable', {
    method: 'POST', token: admin.token,
    body: { password: 'Cm@Test1405!', code: totp.generateCode(setup.data.secret) }
  });
  assert.equal(blocked.status, 403, 'admins cannot drop their own second factor');

  // Admin login from now on needs the second factor.
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { phone: '09120000001', password: 'Cm@Test1405!' } });
  assert.equal(login.data.mfa_required, true);
  const done = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: login.data.challenge_token, code: nextTotpCode(setup.data.secret) }
  });
  assert.equal(done.status, 200);

  // Clean up so the remaining tests can log in with a password only.
  const row = get('SELECT secret_enc FROM user_mfa WHERE user_id = ?', [admin.user.id]);
  run('DELETE FROM user_mfa WHERE user_id = ?', [admin.user.id]);
  run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [admin.user.id]);
  assert.ok(row);
  const plain = await api('/api/v1/auth/login', { method: 'POST', body: { phone: '09120000001', password: 'Cm@Test1405!' } });
  assert.ok(plain.data.token, 'password login works again after MFA removal');
});

test('security: MFA challenges expire, lock after repeated failures and never leak the secret', async () => {
  const totp = require('../src/utils/totp');
  const user = '09125550003';
  const session = await loginAs(user, 'Titan#Shield2027');
  const setup = await api('/api/v1/auth/mfa/setup', { method: 'POST', token: session.token });
  await api('/api/v1/auth/mfa/enable', {
    method: 'POST', token: session.token, body: { code: totp.generateCode(setup.data.secret) }
  });

  // An expired challenge cannot be used, even with the right code.
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { phone: user, password: 'Titan#Shield2027' } });
  const token = login.data.challenge_token;
  run('UPDATE mfa_challenges SET expires_at = ? WHERE token_hash = ?',
    [new Date(Date.now() - 1000).toISOString(), require('crypto').createHash('sha256').update(token).digest('hex')]);
  const expired = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: token, code: nextTotpCode(setup.data.secret) }
  });
  assert.equal(expired.status, 401);

  // Repeated failures burn the challenge (bounded brute force) without locking the account.
  const second = await api('/api/v1/auth/login', { method: 'POST', body: { phone: user, password: 'Titan#Shield2027' } });
  const challengeToken = second.data.challenge_token;
  for (let i = 0; i < 5; i += 1) {
    const attempt = await api('/api/v1/auth/mfa/verify', {
      method: 'POST', body: { challenge_token: challengeToken, code: `${100000 + i}` }
    });
    assert.equal(attempt.status, 401);
  }
  const burned = await api('/api/v1/auth/mfa/verify', {
    method: 'POST', body: { challenge_token: challengeToken, code: nextTotpCode(setup.data.secret) }
  });
  assert.equal(burned.status, 401, 'the challenge itself is locked after too many tries');
  assert.equal(get('SELECT consumed_at FROM mfa_challenges WHERE token_hash = ?',
    [require('crypto').createHash('sha256').update(challengeToken).digest('hex')]).consumed_at !== null, true);

  // The password factor is still healthy: a fresh challenge is issued immediately.
  resetRateLimits(); // the IP limiter above is per-window, not a lockout
  const third = await api('/api/v1/auth/login', { method: 'POST', body: { phone: user, password: 'Titan#Shield2027' } });
  assert.equal(third.status, 200, JSON.stringify(third.data));
  assert.equal(third.data.mfa_required, true);

  // Audit trail records both the challenge and the failures, never the code or secret.
  const rows = all("SELECT action, detail FROM audit_log WHERE action LIKE 'auth.mfa%' AND actor_id = ?", [session.user.id]);
  assert.ok(rows.some((r) => r.action === 'auth.mfa_challenge'));
  assert.ok(rows.some((r) => r.action === 'auth.mfa_failed'));
  for (const row of rows) {
    assert.equal(String(row.detail).includes(setup.data.secret), false);
    assert.equal(/auth\.mfa_failed.*code/.test(String(row.detail)), false);
  }

  // Cleanup: drop the factor so the account stays usable for later runs.
  run('DELETE FROM user_mfa WHERE user_id = ?', [session.user.id]);
  run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [session.user.id]);
  run('DELETE FROM mfa_challenges WHERE user_id = ?', [session.user.id]);
});

test('security: break-glass MFA reset is step-up protected, reason-bound and revokes sessions', async () => {
  const totp = require('../src/utils/totp');
  const admin = await loginAs('09120000001');
  const victim = await loginAs('09125550003', 'Titan#Shield2027');

  // Enroll the victim so there is something to reset.
  const setup = await api('/api/v1/auth/mfa/setup', { method: 'POST', token: victim.token });
  await api('/api/v1/auth/mfa/enable', {
    method: 'POST', token: victim.token, body: { code: totp.generateCode(setup.data.secret) }
  });

  // Customers cannot reach the endpoint at all.
  const asCustomer = await api(`/api/v1/admin/console/security/mfa/${victim.user.id}/reset`, {
    method: 'POST', token: victim.token, body: { reauth_proof: 'x', reason: 'تلاش مشتری برای بازنشانی' }
  });
  assert.equal(asCustomer.status, 403);

  // Without a step-up proof the admin is refused.
  const noProof = await api(`/api/v1/admin/console/security/mfa/${victim.user.id}/reset`, {
    method: 'POST', token: admin.token, body: { reauth_proof: 'not-a-proof', reason: 'کاربر گوشی خود را گم کرده است' }
  });
  assert.equal(noProof.status, 403);

  // A real proof (password re-entry) succeeds and invalidates the victim's tokens.
  const proof = await api('/api/v1/auth/verify-identity', {
    method: 'POST', token: admin.token, body: { password: 'Cm@Test1405!' }
  });
  assert.equal(proof.status, 200, JSON.stringify(proof.data));
  const reset = await api(`/api/v1/admin/console/security/mfa/${victim.user.id}/reset`, {
    method: 'POST', token: admin.token,
    body: { reauth_proof: proof.data.proof, reason: 'کاربر دسترسی به اپلیکیشن احراز هویت را از دست داده است' }
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal(reset.data.was_enabled, true);
  assert.equal(get('SELECT COUNT(*) AS c FROM user_mfa WHERE user_id = ?', [victim.user.id]).c, 0);
  assert.equal((await api('/api/v1/auth/me', { token: victim.token })).status, 401, 'old session is revoked');

  // The target can log in again and re-enroll.
  const fresh = await loginAs('09125550003', 'Titan#Shield2027');
  assert.ok(fresh.token);

  // Self-reset is refused even for the platform admin.
  const self = await api(`/api/v1/admin/console/security/mfa/${admin.user.id}/reset`, {
    method: 'POST', token: admin.token,
    body: { reauth_proof: proof.data.proof, reason: 'تلاش برای دور زدن مرحلهٔ دوم توسط خود مدیر' }
  });
  assert.equal(self.status, 403);

  // The reset is permanently recorded in the audit chain.
  const entry = get("SELECT detail FROM audit_log WHERE action = 'admin.mfa_reset' ORDER BY rowid DESC LIMIT 1");
  assert.ok(entry && entry.detail.includes('mfa_reset') === false && entry.detail.includes('کاربر دسترسی'));
  assert.equal(verifyAuditChain().ok, true);
});

test('security: cookie sessions work end-to-end with the double-submit pair (upload path)', async () => {
  // Regression: the admin image upload used a bare fetch() without the CSRF header,
  // so a valid cookie session got "توکن امنیتی درخواست نامعتبر است (CSRF)".
  // This test proves the browser contract: login sets both cookies, the SPA echoes
  // cm_csrf in x-csrf-token, and cookie-authenticated mutations succeed.
  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '09120000001', password: 'Cm@Test1405!' })
  });
  assert.equal(login.status, 200);
  const setCookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const csrf = /cm_csrf=([^;]+)/.exec(cookieHeader);
  assert.ok(csrf, `login must set the csrf cookie: ${cookieHeader}`);

  const form = new FormData();
  form.append('alt_text', 'آزمون CSRF');
  form.append('images', new Blob([Buffer.from('%PDF-1.4 not an image')], { type: 'image/png' }), 'fake.png');

  const withoutHeader = await fetch(`${baseUrl}/api/v1/admin/products/demo/images`, {
    method: 'POST', headers: { Cookie: cookieHeader }, body: form
  });
  assert.equal(withoutHeader.status, 403);
  assert.match(JSON.stringify(await withoutHeader.json()), /CSRF/);

  // Same request with the token echoed (what the SPA now always does) reaches the
  // route and is rejected for the file signature, not for CSRF.
  const withHeader = await fetch(`${baseUrl}/api/v1/admin/products/demo/images`, {
    method: 'POST', headers: { Cookie: cookieHeader, 'x-csrf-token': csrf[1] }, body: form
  });
  assert.notEqual(withHeader.status, 403, 'a valid double-submit pair must pass the CSRF gate');
});

test('security: a stale session cookie can never lock a user out (CSRF recovery paths)', async () => {
  // Regression for a real lockout: with `cm_token` still present but `cm_csrf`
  // missing, CSRF protection used to reject even POST /auth/login, so the user
  // could not sign in again from the UI and kept seeing
  // "توکن امنیتی درخواست نامعتبر است (CSRF)".
  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '09120000010', password: 'Cm@Test1405!' })
  });
  const staleToken = (login.headers.getSetCookie() || [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('cm_token='));
  assert.ok(staleToken, 'login sets the session cookie');

  // Only the session cookie, no CSRF cookie, no header: logging in again must work.
  const relogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: staleToken },
    body: JSON.stringify({ phone: '09120000010', password: 'Cm@Test1405!' })
  });
  assert.equal(relogin.status, 200, 're-login with a stale cookie must not be blocked by CSRF');

  // Refresh carries its own proof (the httpOnly refresh cookie), so it is reachable too.
  const jar = (login.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  const refresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar }, body: '{}'
  });
  assert.equal(refresh.status, 200, 'the refresh endpoint recovers a cookie-only session');

  // Logout keeps the header requirement: forced logout via CSRF must stay blocked.
  const forcedLogout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar }, body: '{}'
  });
  assert.equal(forcedLogout.status, 403);

  // Real mutations are still guarded: no CSRF pair, no write.
  const write = await fetch(`${baseUrl}/api/v1/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: jar },
    body: JSON.stringify({ sku_id: 'x', quantity: 1 })
  });
  assert.equal(write.status, 403);
  assert.match(JSON.stringify(await write.json()), /CSRF/);
});

test('security: the enrolment code still works at the very next login', async () => {
  // Regression guard. `enable` used to store the enrolling step in last_step;
  // because replay protection is `step > last_step`, the same 6-digit code was
  // rejected for up to 30 seconds right after enabling — the user finished
  // enrolment and could not log back in, burning a challenge attempt per try.
  const totp = require('../src/utils/totp');
  const phone = '09350009988';
  const password = 'Enrol#Guard1405';

  resetRateLimits();
  const registered = await api('/api/v1/auth/register', {
    method: 'POST', body: { phone, password, full_name: 'آزمون کد ثبت‌نام' }
  });
  assert.ok([200, 201].includes(registered.status), JSON.stringify(registered.data));
  const session = registered.data;

  const setup = await api('/api/v1/auth/mfa/setup', { method: 'POST', token: session.token });
  assert.equal(setup.status, 200);

  // The same code string is used to enable and then to log in. Nothing here
  // touches the clock, so a regression is deterministic rather than flaky.
  const enrolmentCode = totp.generateCode(setup.data.secret);
  const enabled = await api('/api/v1/auth/mfa/enable', {
    method: 'POST', token: session.token, body: { code: enrolmentCode }
  });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));

  const stored = get('SELECT last_step FROM user_mfa WHERE user_id = ?', [session.user.id]);
  assert.equal(stored.last_step, null, 'enrolment must not consume a replay window');

  const challengeLogin = await api('/api/v1/auth/login', {
    method: 'POST', body: { phone, password }
  });
  assert.equal(challengeLogin.data.mfa_required, true);

  const verified = await api('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challenge_token: challengeLogin.data.challenge_token, code: enrolmentCode }
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.ok(verified.data.token, 'the enrolment code must authorise the first login');
  assert.equal(verified.data.user.phone, phone);

  // And *now* that step is spent: a second attempt with it must be refused.
  const again = await api('/api/v1/auth/login', { method: 'POST', body: { phone, password } });
  const replay = await api('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challenge_token: again.data.challenge_token, code: enrolmentCode }
  });
  assert.equal(replay.status, 401, 'replay protection still applies after the first login');
});
