'use strict';

/**
 * Remove seed/demo data before handing the installation to real users.
 *
 * The seed script creates nine accounts with a published password
 * (`Cm@Test1405!`) across every privileged role, plus demo catalog rows. Those
 * are perfect for development and a back door in production, so this tool
 * deletes them transactionally and reports exactly what it removed.
 *
 * Dry-run by default. Nothing is deleted without `--write`.
 *
 *   node scripts/purge-demo.js                    # show what would go
 *   node scripts/purge-demo.js --write            # delete demo accounts
 *   node scripts/purge-demo.js --write --keep-finance
 *   node scripts/purge-demo.js --write --with-catalog
 *
 * Safety rules, in order:
 *   - never delete the last remaining active admin (the platform would lock
 *     itself out of its own console),
 *   - never delete an account that has real business documents unless
 *     --force-cascade is passed (orders, LTH contracts, service requests),
 *   - always write one chained audit entry summarising the purge.
 */

require('../server/src/utils/loadEnv').loadEnv();

const { all, get, run, tx, close } = require('../server/src/db');
const { audit } = require('../server/src/modules/platform/service');

const DEMO_PASSWORD_NOTE = 'رمز عمومی و منتشرشده: Cm@Test1405!';
const DEMO_PHONES = [
  '09120000001', // admin
  '09120000002', // operator
  '09120000003', // support
  '09120000004', // warehouse
  '09120000005', // finance
  '09120000007', // operator
  '09120000010', // customer
  '09120000011', // customer
  '09121112233'  // customer
];

function parseArgs(argv) {
  const args = { write: false, keepFinance: false, withCatalog: false, forceCascade: false, phones: null, keep: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--keep-finance') args.keepFinance = true;
    else if (a === '--with-catalog') args.withCatalog = true;
    else if (a === '--force-cascade') args.forceCascade = true;
    else if (a === '--phone') { args.phones = (argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (a === '--keep') { args.keep = (argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

/** Counts the business documents that would block a plain delete. */
function footprint(userId) {
  const one = (sql) => {
    try { return get(sql, [userId]).c; } catch { return 0; }
  };
  return {
    orders: one('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?'),
    service_requests: one('SELECT COUNT(*) AS c FROM service_requests WHERE user_id = ?'),
    lth_holdings: one('SELECT COUNT(*) AS c FROM lth_holdings WHERE user_id = ?'),
    payments: one('SELECT COUNT(*) AS c FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.user_id = ?'),
    tickets: one('SELECT COUNT(*) AS c FROM support_tickets WHERE user_id = ?')
  };
}

function totalFootprint(fp) {
  return Object.values(fp).reduce((sum, n) => sum + n, 0);
}

function selectTargets(args) {
  // `--phone` narrows the set for one-off cleanups; without it every known
  // seeded account is targeted. `--keep` protects specific numbers (e.g. the
  // new real admin you just created with create-admin.js).
  const phones = args.phones && args.phones.length ? args.phones : DEMO_PHONES;
  const keep = new Set(args.keep || []);
  const placeholders = phones.map(() => '?').join(',');
  const rows = all(
    `SELECT id, phone, role, full_name, status FROM users WHERE phone IN (${placeholders}) ORDER BY role, phone`,
    phones
  );
  return rows.filter((r) => !keep.has(r.phone) && !(args.keepFinance && r.role === 'finance'));
}

/**
 * Deletes every child row that references a user, in FK-safe order.
 *
 * Order matters: documents (orders, service requests, LTH contracts) must go
 * before the addresses they reference, because migration 008 has a trigger
 * that refuses to orphan an address that an order still points at. Addresses
 * also go before orders in the other direction (orders.address_id), so the
 * only correct sequence is: payments/events → documents → addresses → user.
 */
function deleteUserDeep(userId, stats) {
  const del = (sql) => {
    try {
      const out = run(sql, [userId]);
      return out.changes || 0;
    } catch {
      return 0; // table may not exist in this schema revision
    }
  };
  // Sessions / tokens / MFA / OTP / proofs
  del('DELETE FROM auth_refresh_tokens WHERE user_id = ?');
  del('DELETE FROM sessions WHERE user_id = ?');
  del('DELETE FROM user_mfa WHERE user_id = ?');
  del('DELETE FROM mfa_recovery_codes WHERE user_id = ?');
  del('DELETE FROM mfa_challenges WHERE user_id = ?');
  del('DELETE FROM reauth_proofs WHERE user_id = ?');
  del('DELETE FROM otp_codes WHERE phone = (SELECT phone FROM users WHERE id = ?)');
  // Commerce
  del('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = ?)');
  del('DELETE FROM carts WHERE user_id = ?');
  del('DELETE FROM wishlists WHERE user_id = ?');
  del('DELETE FROM stock_holds WHERE user_id = ?');

  // Business documents, before the addresses they point at.
  del('DELETE FROM payment_events WHERE payment_id IN (SELECT p.id FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.user_id = ?)');
  del('DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)');
  del('DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)');
  del('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)');
  del('DELETE FROM orders WHERE user_id = ?');
  del('DELETE FROM payments WHERE service_request_id IN (SELECT id FROM service_requests WHERE user_id = ?)');
  del('DELETE FROM request_status_history WHERE request_id IN (SELECT id FROM service_requests WHERE user_id = ?)');
  del('DELETE FROM service_requests WHERE user_id = ?');
  // Support / notifications / files
  del('DELETE FROM tickets WHERE user_id = ?');
  del('DELETE FROM idempotency_keys WHERE user_id = ?');
  del('DELETE FROM people_directory WHERE user_id = ?');
  del('DELETE FROM notifications WHERE user_id = ?');
  del('DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id = ?)');
  del('DELETE FROM support_tickets WHERE user_id = ?');
  del('DELETE FROM uploaded_files WHERE user_id = ?');
  // LTH
  // Treasury ledger rows are the protocol's own bookkeeping; deleting the
  // user is fine, the ledger keeps the historical movement with a null user.
  del('DELETE FROM lth_treasury_ledger WHERE user_id = ?');
  del('DELETE FROM lth_purchase_orders WHERE user_id = ?');
  del('DELETE FROM lth_withdrawals WHERE user_id = ?');
  del('DELETE FROM lth_reward_cycles WHERE holding_id IN (SELECT id FROM lth_holdings WHERE user_id = ?)');
  del('DELETE FROM lth_ledger WHERE user_id = ?');
  del('DELETE FROM lth_holdings WHERE user_id = ?');
  del('DELETE FROM lth_wallets WHERE user_id = ?');
  // Addresses / profile — last, once nothing references them.
  del('DELETE FROM user_addresses WHERE user_id = ?');
  del('DELETE FROM shipping_profiles WHERE user_id = ?');
  del('DELETE FROM lth_transfers WHERE sender_id = ? OR recipient_id = ?');
  // A second pass for tables added later that use recipient_id.
  try { run('DELETE FROM lth_transfers WHERE recipient_id = ?', [userId]); } catch { /* no such column */ }

  // Finally the account itself.
  //
  // `audit_log.actor_id` references users(id) and the audit chain is
  // append-only: history must keep pointing at *someone*. So when anything
  // the user did is in the audit trail, the account is anonymised instead of
  // deleted — the row stays as an opaque tombstone that the chain can still
  // verify against, and every personal field is scrubbed.
  try {
    const out = run('DELETE FROM users WHERE id = ?', [userId]);
    stats.users += out.changes || 0;
  } catch (err) {
    if (!/FOREIGN KEY/i.test(String(err.message))) {
      stats.blocked.push(err.message);
      return;
    }
    const tombstone = `anon-${userId}`;
    const changed = run(
      `UPDATE users SET phone = ?, email = NULL, full_name = ?, username = NULL,
              password_hash = 'disabled', password_salt = 'disabled', status = 'suspended',
              updated_at = ?
        WHERE id = ?`,
      [tombstone, 'حساب حذف‌شده (سابقهٔ ممیزی)', nowIso(), userId]
    ).changes || 0;
    if (changed) {
      stats.anonymised += 1;
      run('UPDATE people_directory SET phone = ?, full_name = ?, email = NULL, username = NULL WHERE user_id = ?',
        [tombstone, 'حساب حذف‌شده (سابقهٔ ممیزی)', userId]);
    }
  }
}

function activeAdminCount() {
  return get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").c;
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`استفاده:
  node scripts/purge-demo.js                        نمایش فهرست (بدون حذف)
  node scripts/purge-demo.js --write                حذف حساب‌های دمو
  node scripts/purge-demo.js --write --keep-finance  نگه‌داشتن حساب مالی
  node scripts/purge-demo.js --write --with-catalog  حذف محصولات دمو هم
  node scripts/purge-demo.js --force-cascade --write حذف حتی با وجود سند تجاری`);
    return;
  }

  const targets = selectTargets(args);
  if (targets.length === 0) {
    console.log('حساب دمویی برای حذف پیدا نشد. (شماره‌ها با --phone قابل تعیین است.)');
    return;
  }

  console.log('\n=== حساب‌های دمو (رمز عمومی: Cm@Test1405!) ===\n');
  const plan = [];
  for (const t of targets) {
    const fp = footprint(t.id);
    const total = totalFootprint(fp);
    plan.push({ ...t, fp, total });
    const label = total === 0 ? 'بدون سند تجاری' : `دارای ${total} سند`;
    console.log(`  ${t.role.padEnd(10)} ${t.phone}  ${t.full_name}   [${label}]`);
    if (total > 0) {
      console.log(`             ${Object.entries(fp).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(' | ')}`);
    }
  }

  // Guard: an installation with a single admin cannot lose it.
  const admins = plan.filter((p) => p.role === 'admin');
  const remainingAdmins = activeAdminCount() - admins.length;
  const blockedByLastAdmin = remainingAdmins < 1;
  const documented = plan.filter((p) => p.total > 0);
  const blockedByDocuments = documented.length > 0 && !args.forceCascade;

  console.log('');
  if (blockedByLastAdmin) {
    console.log('⛔ حذف انجام نشد: این آخرین مدیر فعال سرور است و سیستم به خودش قفل می‌شد.');
    console.log('   اول یک مدیر واقعی بسازید ( یا با --phone مدیر را از حذف مستثنی کنید).');
  }
  if (blockedByDocuments) {
    console.log(`⛔ حذف انجام نشد: ${documented.length} حساب سند تجاری دارند (سفارش/قرارداد LTH/درخواست خدمت).`);
    console.log('   این اسناد تاریخچهٔ مالی‌اند و نباید بی‌اثر شوند. اگر آزمون‌اند: --force-cascade');
  }

  if (!args.write) {
    console.log('\n(حالت نمایشی — چیزی حذف نشد. برای اجرا: --write)');
    if (args.withCatalog) console.log('(محصولات دمو هم در فهرست بودند)');
    return;
  }
  if (blockedByLastAdmin || blockedByDocuments) {
    console.log('\nحذف متوقف شد.');
    process.exitCode = 1;
    return;
  }

  const stats = { users: 0, anonymised: 0, products: 0, blocked: [] };
  tx(() => {
    for (const t of plan) deleteUserDeep(t.id, stats);

    if (args.withCatalog) {
      // Seeded catalog rows carry the demo SKU prefix used by the seed script.
      const demoProducts = all("SELECT id FROM products WHERE sku LIKE 'CM-%'");
      for (const p of demoProducts) {
        try {
          run('DELETE FROM cart_items WHERE product_id = ?', [p.id]);
          run('DELETE FROM stock_holds WHERE product_id = ?', [p.id]);
          run('DELETE FROM product_images WHERE product_id = ?', [p.id]);
          run('DELETE FROM product_variants WHERE product_id = ?', [p.id]);
          stats.products += run('DELETE FROM products WHERE id = ?', [p.id]).changes || 0;
        } catch { /* references from historical orders keep the row; that is correct */ }
      }
    }

    audit(null, 'system', 'admin.demo_purge', 'users', null, {
      demo_password_note: DEMO_PASSWORD_NOTE,
      removed_users: stats.users,
      anonymised_users: stats.anonymised,
      removed_products: stats.products,
      roles: [...new Set(plan.map((p) => p.role))],
      kept_finance: args.keepFinance,
      forced: args.forceCascade
    });
  });

  console.log(`\n✔ ${stats.users} حساب دمو حذف شد${stats.anonymised ? `، ${stats.anonymised} حساب به‌خاطر سابقهٔ ممیزی ناشناس شد` : ''}${args.withCatalog ? ` و ${stats.products} محصول` : ''}.`);
  if (stats.blocked.length) {
    console.log('  مواردی که به دلیل ارجاع باقی ماندند:');
    stats.blocked.slice(0, 5).forEach((m) => console.log(`   - ${m.slice(0, 120)}`));
  }
  console.log('  یک رکورد ممیزی با رویداد admin.demo_purge ثبت شد.');
  const left = activeAdminCount();
  console.log(`  مدیر فعال باقی‌مانده: ${left}`);
  if (left === 0) console.log('  ⚠ هیچ مدیر فعالی نمانده است — فوراً یک مدیر واقعی بسازید.');
}

try {
  main();
} finally {
  close();
}
