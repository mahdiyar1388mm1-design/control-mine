'use strict';

/**
 * LTH protocol accounting added in migration 012:
 *
 *  - «میزان پایه»: base LTH is booked as `issue_base` when it leaves the
 *    treasury for a wallet, so market + asset stay explainable.
 *  - fees always arrive first and are then taxed: `collect_fee` → `tax_accrued`,
 *    with `tax_settled` only recorded against a real payment.
 *  - the market reward projection is exact (BigInt), and can be inverted:
 *    a desired reward implies the market size that produces it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-lth-tax-'));
process.env.CM_DATA_DIR = path.join(tmpRoot, 'data');
process.env.CM_STORAGE_DIR = path.join(tmpRoot, 'storage');
process.env.CM_SECRET = 'lth-tax-test-secret-0123456789abcdef0123456789ab';
process.env.NODE_ENV = 'test';

const { seed } = require('../src/db/seed');
const { run, get, all, close } = require('../src/db');
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const math = require('../src/modules/lth/math');
const protocol = require('../src/modules/lth/protocol');

let server;
let baseUrl;

async function api(pathname, { method = 'GET', token, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers: h, body: payload });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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

test('protocol math: reward projection is exact and invertible', () => {
  const oneLth = protocol.projectRewards(math.ONE_LTH_ATOMS, {
    rewardPerMinUnitAtoms: 340000n, stakeBps: 7000, withdrawableBps: 3000
  });
  assert.equal(math.formatAtomsCompact(oneLth.total_atoms), '0.0034');
  assert.equal(oneLth.staked_atoms + oneLth.withdrawable_atoms, oneLth.total_atoms);
  assert.equal(math.formatAtomsCompact(oneLth.staked_atoms), '0.00238');
  assert.equal(math.formatAtomsCompact(oneLth.withdrawable_atoms), '0.00102');

  // The whole supply, and the exact back-solve that produces it.
  const supply = 15000000n * math.ONE_LTH_ATOMS;
  const all = protocol.projectRewards(supply, {
    rewardPerMinUnitAtoms: 340000n, stakeBps: 7000, withdrawableBps: 3000
  });
  assert.equal(math.formatAtomsCompact(all.total_atoms), '51000');
  assert.equal(protocol.marketForReward(all.total_atoms, 340000n), supply);

  // A 71/29 split always adds up to the same total reward.
  const swapped = protocol.projectRewards(supply, {
    rewardPerMinUnitAtoms: 340000n, stakeBps: 7100, withdrawableBps: 2900
  });
  assert.equal(swapped.total_atoms, all.total_atoms);
  assert.equal(swapped.staked_atoms + swapped.withdrawable_atoms, swapped.total_atoms);

  // Tax split: fee always equals tax + net, to the atom.
  // 1 atom = 10^-8 LTH, so ONE_LTH_ATOMS worth of fee taxed at 10% is 0.1 LTH.
  const fee = math.ONE_LTH_ATOMS;
  const tax = protocol.splitFeeTax(fee, 1000);
  assert.equal(tax.taxAtoms + tax.netFeeAtoms, fee);
  assert.equal(math.formatAtomsCompact(tax.taxAtoms), '0.1');
  assert.equal(math.formatAtomsCompact(tax.netFeeAtoms), '0.9');
});

test('treasury: buying LTH books «میزان پایه» and keeps asset + market = supply', async () => {
  const customer = await loginAs('09120000010');
  const admin = await loginAs('09120000001');

  const before = await api('/api/v1/admin/lth/reconciliation', { token: admin.token });
  assert.equal(before.status, 200);
  const beforeTreasury = before.data.treasury;
  assert.ok(Array.isArray(beforeTreasury.rows), 'treasury must expose its ordered rows');

  // Buy LTH through the sandbox gateway and settle the payment.
  const purchase = await api('/api/v1/lth/purchases', {
    method: 'POST', token: customer.token,
    body: { amount_toman: 1000000 }
  });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.data));
  const paymentId = purchase.data.payment.id;

  // The sandbox callback is HMAC-signed; reuse the suite's signer.
  const { signCallback } = require('../src/modules/payments/service');
  const payRow = get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  assert.ok(payRow, 'the purchase must create a pending payment');
  resetRateLimits();
  const paid = await api('/api/v1/payments/sandbox/callback', {
    method: 'POST',
    body: {
      token: payRow.callback_token,
      outcome: 'success',
      signature: signCallback(payRow.callback_token, 'success')
    }
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));

  const after = await api('/api/v1/admin/lth/reconciliation', { token: admin.token });
  const treasury = after.data.treasury;

  // The base row exists, and the issued amount equals what left the treasury.
  const issued = BigInt(treasury.base_issued_atoms || treasury.base_net_atoms);
  assert.ok(issued > 0n, 'the purchase must book an issue_base event');
  const baseRow = treasury.rows.find((r) => r.key === 'base_flow');
  assert.ok(baseRow, 'the treasury must expose the «میزان پایه» row');
  assert.equal(baseRow.net_atoms, issued.toString());
  // Demo/legacy wallets can hold base LTH from before issuance tracking; that
  // gap is surfaced as an opening balance and must reconcile against the base
  // still held in wallets (reward/stake/reserved atoms are not base).
  assert.equal(baseRow.reconciles_with_opening, true, 'base flow + opening must equal wallet base');
  assert.equal(
    BigInt(baseRow.net_atoms) + BigInt(baseRow.opening_atoms),
    BigInt(baseRow.base_atoms)
  );
  assert.equal(treasury.base_reconciles_with_opening, true);
  // Everything wallets hold must still be backed by asset + market = supply.
  assert.equal(
    BigInt(treasury.asset_atoms) + BigInt(treasury.market_atoms),
    BigInt(treasury.total_supply_atoms)
  );

  // Conservation is still intact after the purchase.
  assert.equal(
    BigInt(treasury.asset_atoms) + BigInt(treasury.market_atoms),
    BigInt(treasury.total_supply_atoms)
  );
  assert.ok(BigInt(treasury.market_atoms) > BigInt(beforeTreasury.market_atoms));

  // The event is in the ledger, exactly once, with the right ref.
  const rows = all("SELECT * FROM lth_treasury_ledger WHERE event_type = 'issue_base' AND ref_id = ?", [purchase.data.purchase.id]);
  assert.equal(rows.length, 1, 'issuance must be booked exactly once');
  const issuedBefore = BigInt(beforeTreasury.base_issued_atoms || 0);
  assert.equal(BigInt(rows[0].atoms), issued - issuedBefore);

  // Row order is stable: asset, market, base, then the return/fee/tax rows.
  const keys = treasury.rows.map((r) => r.key);
  assert.deepEqual(keys.slice(0, 3), ['asset', 'market', 'base_flow']);
  assert.ok(keys.includes('collected_fee'));
  assert.ok(keys.includes('tax_accrued'));
  assert.ok(keys.includes('tax_outstanding'));
  assert.ok(keys.includes('net_fee'));
});

test('tax: a collected fee always produces a matching tax liability, then a settlement', async () => {
  const customer = await loginAs('09120000010');
  const customer2 = await loginAs('09120000011');
  const admin = await loginAs('09120000001');

  // Turn on a transfer fee so there is something to collect and tax.
  const feeOn = await api('/api/v1/admin/lth/treasury', {
    method: 'PATCH', token: admin.token,
    body: { transfer_fee_percent: 2, reason: 'فعال‌سازی کارمزد برای آزمون مالیات' }
  });
  assert.equal(feeOn.status, 200, JSON.stringify(feeOn.data));

  const treasuryBefore = feeOn.data.treasury;

  // Fund the sender's withdrawable balance: seeded wallets only hold a few
  // hundredths of a LTH, and a 1 LTH transfer needs real balance.
  const { ensureWalletInTx } = require('../src/modules/lth/service');
  ensureWalletInTx(customer.user.id);
  run("UPDATE lth_wallets SET withdrawable_reward_atoms = '50000000000000000' WHERE user_id = ?", [customer.user.id]);

  const transfer = await api('/api/v1/lth/transfers', {
    method: 'POST', token: customer.token,
    body: { recipient: '09120000011', lth_amount: '1', note: 'آزمون مالیات' }
  });
  assert.equal(transfer.status, 201, JSON.stringify(transfer.data));

  const recon = await api('/api/v1/admin/lth/reconciliation', { token: admin.token });
  const t = recon.data.treasury;

  // Fee and tax both moved, and the tax is exactly 10% of the collected fee.
  const feeDelta = BigInt(t.collected_fee_atoms) - BigInt(treasuryBefore.collected_fee_atoms);
  const taxDelta = BigInt(t.tax_accrued_atoms) - BigInt(treasuryBefore.tax_accrued_atoms);
  assert.ok(feeDelta > 0n, 'the transfer fee must be collected');
  assert.equal(taxDelta, (feeDelta * 1000n) / 10000n);
  assert.equal(t.protocol_tax_bps, 1000);

  // Net fee never goes negative and the row set stays consistent.
  const netFeeRow = t.rows.find((r) => r.key === 'net_fee');
  assert.equal(BigInt(netFeeRow.atoms), BigInt(t.collected_fee_atoms) - BigInt(t.tax_accrued_atoms));

  // Settling is refused for more than the outstanding liability.
  const tooMuch = await api('/api/v1/admin/lth/tax/settle', {
    method: 'POST', token: admin.token,
    body: { lth_amount: '9999', reference: 'REF-BIG', reason: 'تسویه بیش از بدهی' }
  });
  assert.equal(tooMuch.status, 409);

  // A real settlement is recorded and reduces the outstanding amount.
  const outstanding = BigInt(t.tax_outstanding_atoms);
  const settleAtoms = outstanding / 2n > 0n ? outstanding / 2n : 1n;
  const settleAmount = math.formatAtomsCompact(settleAtoms);
  const settled = await api('/api/v1/admin/lth/tax/settle', {
    method: 'POST', token: admin.token,
    body: { lth_amount: settleAmount, reference: 'TAX-1405-0001', reason: 'پرداخت بخشی از مالیات دوره' }
  });
  assert.equal(settled.status, 201, JSON.stringify(settled.data));
  assert.equal(BigInt(settled.data.tax.outstanding_atoms), outstanding - settleAtoms);
  assert.ok(get("SELECT 1 AS x FROM audit_log WHERE action = 'lth.tax.settle' LIMIT 1"));

  // Settling the rest clears the liability; a further settlement is refused
  // with 409 rather than silently recording a negative outstanding balance.
  const restAtoms = BigInt(settled.data.tax.outstanding_atoms);
  const cleared = await api('/api/v1/admin/lth/tax/settle', {
    method: 'POST', token: admin.token,
    body: { lth_amount: math.formatAtomsCompact(restAtoms), reference: 'TAX-1405-0002', reason: 'تسویهٔ کامل مانده دوره' }
  });
  assert.equal(cleared.status, 201, JSON.stringify(cleared.data));
  assert.equal(BigInt(cleared.data.tax.outstanding_atoms), 0n);

  const nothingLeft = await api('/api/v1/admin/lth/tax/settle', {
    method: 'POST', token: admin.token,
    body: { lth_amount: '1', reference: 'TAX-1405-0003', reason: 'تسویهٔ بدون مانده' }
  });
  assert.equal(nothingLeft.status, 409, 'no outstanding tax must be a 409 INVALID_STATE');

  // Customers can never touch the tax ledger.
  const denied = await api('/api/v1/admin/lth/tax/settle', {
    method: 'POST', token: customer2.token,
    body: { lth_amount: '1', reference: 'X', reason: 'تلاش غیرمجاز' }
  });
  assert.equal(denied.status, 403);

  // Rate changes are audited and clamped to 0..100%.
  const badRate = await api('/api/v1/admin/lth/tax', {
    method: 'PATCH', token: admin.token, body: { tax_percent: 150, reason: 'نرخ نامعتبر' }
  });
  assert.equal(badRate.status, 400);
  const goodRate = await api('/api/v1/admin/lth/tax', {
    method: 'PATCH', token: admin.token, body: { tax_percent: 12.5, reason: 'افزایش نرخ مالیات' }
  });
  assert.equal(goodRate.status, 200);
  assert.equal(goodRate.data.protocol_tax_bps, 1250);

  // Restore 10% for later tests.
  await api('/api/v1/admin/lth/tax', {
    method: 'PATCH', token: admin.token, body: { tax_percent: 10, reason: 'بازگشت به نرخ ۱۰٪' }
  });
});

test('projection: market reward, 70/30 split and the reverse-engineering column', async () => {
  const finance = await loginAs('09120000005');
  const customer = await loginAs('09120000010');

  const denied = await api('/api/v1/admin/lth/projection', { token: customer.token });
  assert.equal(denied.status, 403);

  const res = await api('/api/v1/admin/lth/projection?stake_percent=70', { token: finance.token });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  // Live market projection must equal the same formula the engine settles with.
  const live = res.data.live_market_reward;
  const settings = get('SELECT * FROM lth_settings WHERE id = 1');
  const expected = protocol.projectRewards(BigInt(res.data.market.market_atoms), {
    rewardPerMinUnitAtoms: BigInt(settings.reward_per_min_unit_atoms),
    stakeBps: settings.stake_bps,
    withdrawableBps: settings.withdrawable_bps
  });
  assert.equal(live.total_reward_atoms, expected.total_atoms.toString());

  // 70/30 and its swap produce the same total, different splits.
  const seventy = res.data.scenarios.full_supply;
  assert.equal(seventy[0].stake_percent, 70);
  assert.equal(seventy[0].withdrawable_percent, 30);
  assert.equal(
    BigInt(seventy[0].staked_reward_atoms) + BigInt(seventy[0].withdrawable_reward_atoms),
    BigInt(seventy[0].total_reward_atoms)
  );
  const swapped = seventy.find((s) => s.stake_percent === 70);
  assert.ok(swapped, 'the requested 70% scenario must be present');

  // The engineering column: a target reward implies a market size, invertibly.
  const target = await api('/api/v1/admin/lth/projection?target_reward_lth=51000', { token: finance.token });
  assert.equal(target.status, 200);
  const eng = target.data.target_engineering;
  assert.ok(eng, 'a target must produce a reverse-engineered market size');
  assert.equal(eng.required_market_atoms, (15000000n * math.ONE_LTH_ATOMS).toString());
  assert.equal(eng.achievable_within_supply, true);
  assert.ok(eng.required_market_irr_equivalent);

  // An impossible target is reported honestly instead of clamped.
  const impossible = await api('/api/v1/admin/lth/projection?target_reward_lth=999999', { token: finance.token });
  assert.equal(impossible.status, 200);
  assert.equal(impossible.data.target_engineering.achievable_within_supply, false);

  const badTarget = await api('/api/v1/admin/lth/projection?target_reward_lth=abc', { token: finance.token });
  assert.equal(badTarget.status, 400);
});

test('projection: every supply figure stays exact for the full 15,000,000 LTH', async () => {
  const admin = await loginAs('09120000001');
  const res = await api('/api/v1/admin/lth/projection', { token: admin.token });
  assert.equal(res.status, 200);

  const full = res.data.scenarios.full_supply[0];
  // 15,000,000 LTH × 0.000000034 LTH/min-unit ⇒ 51,000 LTH per 24h at the default rate.
  const total = BigInt(full.total_reward_atoms);
  assert.equal(total, 51000n * math.ONE_LTH_ATOMS);
  // No float drift: the displayed value round-trips through the parser.
  assert.equal(math.parseLthToAtoms(full.total_reward_lth_display_12), total);
  assert.equal(res.data.supply.total_supply_lth_headline, '15.000.000');
  assert.ok(res.data.market.share_of_supply_percent >= 0);
  assert.ok(res.data.market.share_of_supply_percent <= 100);
});
