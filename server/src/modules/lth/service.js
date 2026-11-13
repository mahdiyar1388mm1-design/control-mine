'use strict';

const { likeContains } = require('../../utils/dbGuards');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const config = require('../../config');
const { all, get, run, tx } = require('../../db');
const { ApiError } = require('../../utils/errors');
const { uuid, nowIso, validate, parsePagination, hashBody } = require('../../utils/validate');
const { notify, audit, maskPhone, getSetting } = require('../platform/service');
const math = require('./math');
const protocol = require('./protocol');

function normalizeIranPhone(raw) {
  let s = math.normalizeNumericString(raw).replace(/^\+98/, '0').replace(/^98(?=\d{10}$)/, '0');
  if (/^9\d{9}$/.test(s)) s = `0${s}`;
  return /^09\d{9}$/.test(s) ? s : null;
}

const SERVER_INSTANCE_ID = process.env.CM_INSTANCE_ID || `${os.hostname()}-pid${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

const DEFAULT_LTH_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
  <defs>
    <linearGradient id="lthBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff0f7"/>
      <stop offset="100%" stop-color="#ffd6eb"/>
    </linearGradient>
    <linearGradient id="lthStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ec1e79"/>
      <stop offset="100%" stop-color="#c81464"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="148" height="148" rx="34" fill="url(#lthBg)" stroke="url(#lthStroke)" stroke-width="6"/>
  <text x="80" y="50" text-anchor="middle" fill="#c81464" font-family="Tahoma, Arial, sans-serif" font-size="22" font-weight="800">LOTH</text>
  <text x="80" y="76" text-anchor="middle" fill="#c81464" font-family="Tahoma, Arial, sans-serif" font-size="20" font-weight="700">COIN</text>
  <line x1="30" y1="90" x2="130" y2="90" stroke="#ec1e79" stroke-width="2.5" opacity="0.45"/>
  <text x="80" y="130" text-anchor="middle" fill="#ec1e79" font-family="Tahoma, Arial, sans-serif" font-size="36" font-weight="900">LTH</text>
</svg>`;

function ensureDefaultLogo() {
  try {
    const publicDir = path.join(config.storageDir, '..', 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    const logoFile = path.join(publicDir, 'lth-logo-default.svg');
    if (!fs.existsSync(logoFile)) {
      fs.writeFileSync(logoFile, DEFAULT_LTH_LOGO_SVG, 'utf8');
    }
  } catch {
    // Non-fatal in read-only edge environments
  }
}

function makeCode(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}-${out}`;
}

function generateWalletSerial() {
  // Synthetic 16-digit Central Mine LTH wallet serial starting with 5894 (non-bank internal prefix)
  let digits = '5894';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i += 1) {
    digits += String(bytes[i] % 10);
  }
  return digits;
}

function maskWalletSerial(serial) {
  if (!serial || serial.length < 16) return '•••• •••• •••• ••••';
  return `•••• •••• •••• ${serial.slice(-4)}`;
}

function formatWalletSerialSpaced(serial) {
  if (!serial) return '';
  return serial.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function getTreasuryConfigRow() {
  let row = get('SELECT * FROM lth_treasury_config WHERE id = 1');
  if (!row) {
    const now = nowIso();
    run(
      `INSERT OR IGNORE INTO lth_treasury_config (id, total_supply_atoms, transfer_fee_bps, sell_fee_bps, updated_at)
       VALUES (1, '150000000000000000000000', 0, 0, ?)`,
      [now]
    );
    row = get('SELECT * FROM lth_treasury_config WHERE id = 1');
  }
  return row;
}

function sumWalletCirculatingAtoms() {
  const wallets = all('SELECT base_atoms, staked_atoms, withdrawable_reward_atoms, reserved_atoms FROM lth_wallets');
  let marketAtoms = 0n;
  let baseSum = 0n;
  let stakedSum = 0n;
  let withdrawableSum = 0n;
  let reservedSum = 0n;
  for (const w of wallets) {
    const b = BigInt(w.base_atoms);
    const s = BigInt(w.staked_atoms);
    const r = BigInt(w.withdrawable_reward_atoms);
    const v = BigInt(w.reserved_atoms);
    baseSum += b;
    stakedSum += s;
    withdrawableSum += r;
    reservedSum += v;
    marketAtoms += b + s + r + v;
  }
  return { marketAtoms, baseSum, stakedSum, withdrawableSum, reservedSum, walletCount: wallets.length };
}

function sumTreasuryEventsByType() {
  const rows = all('SELECT event_type, atoms FROM lth_treasury_ledger');
  let returnBaseAtoms = 0n;
  let returnStakeAtoms = 0n;
  let returnRewardAtoms = 0n;
  let collectFeeAtoms = 0n;
  let issueBaseAtoms = 0n;
  let taxAccruedAtoms = 0n;
  let taxSettledAtoms = 0n;
  for (const r of rows) {
    const a = BigInt(r.atoms);
    if (r.event_type === 'return_base') returnBaseAtoms += a;
    else if (r.event_type === 'return_stake') returnStakeAtoms += a;
    else if (r.event_type === 'return_reward') returnRewardAtoms += a;
    else if (r.event_type === 'collect_fee') collectFeeAtoms += a;
    else if (r.event_type === 'issue_base') issueBaseAtoms += a;
    else if (r.event_type === 'tax_accrued') taxAccruedAtoms += a;
    else if (r.event_type === 'tax_settled') taxSettledAtoms += a;
  }
  return {
    returnBaseAtoms,
    returnStakeAtoms,
    returnRewardAtoms,
    collectFeeAtoms,
    issueBaseAtoms,
    taxAccruedAtoms,
    taxSettledAtoms,
    totalEvents: rows.length
  };
}

/**
 * Recognises the protocol tax liability inside a collected fee.
 *
 * The fee itself is always booked first (`collect_fee`); this adds the matching
 * `tax_accrued` row so the tax position is never implied — it is a ledger fact.
 * Must be called inside the same transaction as the fee it taxes.
 */
function recordFeeTax(userId, feeAtoms, refType, refId, note, nowStr) {
  const taxBps = Number(getSetting('lth_protocol_tax_bps', '1000'));
  const { taxAtoms } = protocol.splitFeeTax(feeAtoms, taxBps);
  if (taxAtoms <= 0n) return 0n;
  run(
    `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
     VALUES (?, 'tax_accrued', ?, ?, ?, ?, ?, ?)`,
    [uuid(), taxAtoms.toString(), userId, refType, refId, note, nowStr]
  );
  return taxAtoms;
}

function formatTreasuryHeadlineLth(atoms) {
  const b = BigInt(atoms);
  const whole = b / math.ONE_LTH_ATOMS;
  const frac = b % math.ONE_LTH_ATOMS;
  if (frac === 0n) {
    return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  const wholeGroupedCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = math.formatScaledBigInt(frac, math.ATOM_DECIMALS, {
    minDecimals: 8,
    maxDecimals: 12,
    trimTrailingZeros: true
  }).split('.')[1];
  return `${wholeGroupedCommas}.${fracStr}`;
}

/**
 * Returns the 5 approved rows of the LTH Protocol Treasury ("خزانه"):
 * 1. دارایی (starts at 15.000.000 LTH; equals total_supply - market_circulating)
 * 2. مقدار بازار (total LTH across user wallets)
 * 3. جمع بازگشت استیک (cumulative unlocked PoS stake liquidated back to Treasury)
 * 4. جمع بازگشت پایه (cumulative base LTH liquidated back to Treasury)
 * 5. جمع کارمزد (cumulative protocol fees in LTH)
 * Note: "جمع پرداخت" and "پاداش ماین" are intentionally omitted per approved design.
 */
function getTreasuryView() {
  settleDueRewards();
  const settings = getSettingsRow();
  const tConfig = getTreasuryConfigRow();
  const priceIrr = BigInt(settings.price_irr);

  const totalSupplyAtoms = BigInt(tConfig.total_supply_atoms);
  const { marketAtoms, baseSum, stakedSum, withdrawableSum, reservedSum, walletCount } = sumWalletCirculatingAtoms();
  const assetAtoms = totalSupplyAtoms >= marketAtoms ? totalSupplyAtoms - marketAtoms : 0n;
  const conservationOk = assetAtoms + marketAtoms === totalSupplyAtoms;

  const {
    returnBaseAtoms, returnStakeAtoms, returnRewardAtoms, collectFeeAtoms,
    issueBaseAtoms, taxAccruedAtoms, taxSettledAtoms, totalEvents
  } = sumTreasuryEventsByType();
  const taxBps = Number(getSetting('lth_protocol_tax_bps', '1000'));
  const rows = protocol.treasuryRows({
    assetAtoms,
    marketAtoms,
    baseAtoms: baseSum,
    issuedAtoms: issueBaseAtoms,
    returnedAtoms: returnBaseAtoms,
    returnStakeAtoms,
    returnRewardAtoms,
    feeAtoms: collectFeeAtoms,
    taxAccruedAtoms,
    taxSettledAtoms,
    priceIrr
  });
  const baseRow = protocol.baseFlowRow({
    issuedAtoms: issueBaseAtoms,
    returnedAtoms: returnBaseAtoms,
    baseAtoms: baseSum,
    marketAtoms,
    priceIrr
  });

  return {
    title: 'خزانه',
    symbol: 'LTH',
    logo_path: settings.logo_path || '/uploads/lth-logo-default.svg',
    brand_logo_path: '/central-mine-logo.jpg',
    total_supply_atoms: totalSupplyAtoms.toString(),
    total_supply_lth_headline: formatTreasuryHeadlineLth(totalSupplyAtoms),
    total_supply_lth_display_8: math.formatAtomsDisplay8(totalSupplyAtoms),
    total_supply_lth_exact: math.formatAtomsExact(totalSupplyAtoms),
    conservation_ok: conservationOk,
    conservation_label: conservationOk
      ? 'تراز کامل پروتکل برقرار است (دارایی خزانه + مقدار بازار = کل عرضه)'
      : 'هشدار: سقف عرضه با مجموع بازار ناتراز است',

    // 1. دارایی
    asset_atoms: assetAtoms.toString(),
    asset_lth_headline: formatTreasuryHeadlineLth(assetAtoms),
    asset_lth_display_8: math.formatAtomsDisplay8(assetAtoms),
    asset_lth_display_12: math.formatAtomsDisplay12(assetAtoms),
    asset_lth_exact: math.formatAtomsExact(assetAtoms),
    asset_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(assetAtoms, priceIrr).toString()),

    // 2. مقدار بازار
    market_atoms: marketAtoms.toString(),
    market_lth_display_8: math.formatAtomsDisplay8(marketAtoms),
    market_lth_display_12: math.formatAtomsDisplay12(marketAtoms),
    market_lth_exact: math.formatAtomsExact(marketAtoms),
    market_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(marketAtoms, priceIrr).toString()),
    market_breakdown: {
      wallet_count: walletCount,
      base_lth_display_12: math.formatAtomsDisplay12(baseSum),
      staked_lth_display_12: math.formatAtomsDisplay12(stakedSum),
      withdrawable_lth_display_12: math.formatAtomsDisplay12(withdrawableSum),
      reserved_lth_display_12: math.formatAtomsDisplay12(reservedSum)
    },

    // 3. جمع بازگشت استیک
    returned_stake_atoms: returnStakeAtoms.toString(),
    returned_stake_lth_display_8: math.formatAtomsDisplay8(returnStakeAtoms),
    returned_stake_lth_display_12: math.formatAtomsDisplay12(returnStakeAtoms),
    returned_stake_lth_exact: math.formatAtomsExact(returnStakeAtoms),

    // 4. جمع بازگشت پایه
    returned_base_atoms: returnBaseAtoms.toString(),
    returned_base_lth_display_8: math.formatAtomsDisplay8(returnBaseAtoms),
    returned_base_lth_display_12: math.formatAtomsDisplay12(returnBaseAtoms),
    returned_base_lth_exact: math.formatAtomsExact(returnBaseAtoms),

    // 5. جمع کارمزد
    collected_fee_atoms: collectFeeAtoms.toString(),
    collected_fee_lth_display_8: math.formatAtomsDisplay8(collectFeeAtoms),
    collected_fee_lth_display_12: math.formatAtomsDisplay12(collectFeeAtoms),
    collected_fee_lth_exact: math.formatAtomsExact(collectFeeAtoms),

    // 6. میزان پایه — base LTH that moved from the treasury into the market.
    //    This is the row that explains why «دارایی» and «مقدار بازار» moved.
    base_flow: baseRow,
    base_issued_atoms: issueBaseAtoms.toString(),
    base_issued_lth_display_12: math.formatAtomsDisplay12(issueBaseAtoms),
    base_net_atoms: baseRow.net_atoms,
    base_net_lth_display_12: baseRow.net_display_12,
    base_net_irr_equivalent: baseRow.irr_equivalent,
    base_opening_atoms: baseRow.opening_atoms,
    base_opening_lth_display_12: baseRow.opening_lth_display_12,
    base_has_opening_balance: baseRow.has_opening_balance,
    base_unaccounted_atoms: baseRow.unaccounted_atoms,
    base_reconciles_with_opening: baseRow.reconciles_with_opening,
    base_wallet_lth_display_12: baseRow.base_display_12,

    // 7. Tax on collected fees (fees always arrive first, then get taxed).
    protocol_tax_bps: taxBps,
    protocol_tax_percent: taxBps / 100,
    tax_accrued_atoms: taxAccruedAtoms.toString(),
    tax_accrued_lth_display_12: math.formatAtomsDisplay12(taxAccruedAtoms),
    tax_settled_atoms: taxSettledAtoms.toString(),
    tax_settled_lth_display_12: math.formatAtomsDisplay12(taxSettledAtoms),
    tax_outstanding_atoms: (taxAccruedAtoms - taxSettledAtoms).toString(),
    tax_outstanding_lth_display_12: math.formatAtomsDisplay12(taxAccruedAtoms - taxSettledAtoms),
    tax_on_fees_irr_equivalent: math.atomsToIrrExact(taxAccruedAtoms, priceIrr),
    net_fee_atoms: (collectFeeAtoms - taxAccruedAtoms).toString(),
    net_fee_lth_display_12: math.formatAtomsDisplay12(collectFeeAtoms - taxAccruedAtoms),

    // The whole treasury as one ordered, display-ready table.
    rows,

    // Extra audit telemetry for staff
    returned_reward_lth_display_12: math.formatAtomsDisplay12(returnRewardAtoms),
    treasury_events_count: totalEvents,
    transfer_fee_bps: tConfig.transfer_fee_bps,
    transfer_fee_percent: tConfig.transfer_fee_bps / 100,
    sell_fee_bps: tConfig.sell_fee_bps,
    sell_fee_percent: tConfig.sell_fee_bps / 100,
    updated_at: tConfig.updated_at
  };
}

function getSettingsRow() {
  ensureDefaultLogo();
  let row = get('SELECT * FROM lth_settings WHERE id = 1');
  if (!row) {
    const now = nowIso();
    run(
      `INSERT OR IGNORE INTO lth_settings (
        id, price_irr, reward_per_min_unit_atoms, stake_bps, withdrawable_bps,
        lockup_days, reward_interval_sec, packages_toman_json, logo_path, updated_at
      ) VALUES (1, '4840000000', '340000', 7000, 3000, 3285, 86400, '[22000000,11000000,8000000,1000000,220000]', '/uploads/lth-logo-default.svg', ?)`,
      [now]
    );
    row = get('SELECT * FROM lth_settings WHERE id = 1');
  }
  return row;
}

function formatSettingsPayload(row) {
  const priceIrr = BigInt(row.price_irr);
  const packagesToman = JSON.parse(row.packages_toman_json || '[]');
  const calcBench = math.calculateAllMetrics({ mode: 'lth', value: '1', settings: row });

  const packages = packagesToman.map((toman) => {
    const irr = BigInt(toman) * 10n;
    const atoms = (irr * math.ONE_LTH_ATOMS) / priceIrr;
    const daily = math.computeDailyRewardSplit(atoms, row.reward_per_min_unit_atoms, row.stake_bps);
    return {
      amount_toman: toman,
      amount_irr: irr.toString(),
      amount_irr_formatted: math.addThousandSeparators(irr.toString()),
      lth_atoms: atoms.toString(),
      lth_display_8: math.formatAtomsDisplay8(atoms),
      lth_exact: math.formatAtomsCompact(atoms) || '0',
      daily_reward_lth_exact: math.formatAtomsCompact(daily.totalRewardAtoms) || '0',
      daily_reward_irr_exact: math.atomsToIrrExact(daily.totalRewardAtoms, priceIrr)
    };
  });

  return {
    symbol: 'LTH',
    name: 'LOTH COIN',
    pair_label: 'LTH / IRR',
    consensus_label: 'POS',
    price_irr: priceIrr.toString(),
    price_irr_formatted: math.addThousandSeparators(priceIrr.toString()),
    price_toman: (priceIrr / 10n).toString(),
    min_token_unit_lth: '0.00000001',
    subdivisions_per_token: 100000000,
    reward_per_min_unit_lth: math.formatAtomsCompact(row.reward_per_min_unit_atoms),
    reward_per_min_unit_atoms: row.reward_per_min_unit_atoms,
    stake_bps: row.stake_bps,
    withdrawable_bps: row.withdrawable_bps,
    stake_percent: row.stake_bps / 100,
    withdrawable_percent: row.withdrawable_bps / 100,
    lockup_days: row.lockup_days,
    reward_interval_sec: row.reward_interval_sec,
    packages_toman: packagesToman,
    packages,
    logo_path: row.logo_path || '/uploads/lth-logo-default.svg',
    phase_notes: {
      tmn_and_toman_wallet_rows: 'میزان تومن و TMN طبق برنامه در فاز بعدی پیاده‌سازی خواهد شد.'
    },
    benchmarks: calcBench.benchmarks,
    updated_at: row.updated_at
  };
}

function getPublicConfig() {
  return formatSettingsPayload(getSettingsRow());
}

function calculateEndpoint(input) {
  const mode = input && input.mode === 'irr' ? 'irr' : 'lth';
  const rawVal = input && input.value !== undefined && input.value !== null && String(input.value).trim() !== ''
    ? String(input.value)
    : (mode === 'irr' ? '4840000000' : '1');
  const settings = getSettingsRow();
  try {
    return math.calculateAllMetrics({ mode, value: rawVal, settings });
  } catch (err) {
    throw ApiError.validation(err.message || 'ورودی محاسبه‌گر معتبر نیست.', [{ field: 'value', message: err.message }]);
  }
}

function ensureWalletInTx(userId) {
  let wallet = get('SELECT * FROM lth_wallets WHERE user_id = ?', [userId]);
  if (!wallet) {
    const now = nowIso();
    let serial = generateWalletSerial();
    while (get('SELECT 1 AS x FROM lth_wallets WHERE wallet_serial = ?', [serial])) {
      serial = generateWalletSerial();
    }
    run(
      `INSERT INTO lth_wallets (
        user_id, wallet_serial, base_atoms, staked_atoms, withdrawable_reward_atoms,
        reserved_atoms, total_purchased_atoms, total_rewarded_atoms, created_at, updated_at
      ) VALUES (?, ?, '0', '0', '0', '0', '0', '0', ?, ?)`,
      [userId, serial, now, now]
    );
    wallet = get('SELECT * FROM lth_wallets WHERE user_id = ?', [userId]);
  }
  return wallet;
}

/**
 * Multi-server safe, idempotent 24h reward accrual & 3285-day PoS stake maturity engine.
 * - Uses BEGIN IMMEDIATE transaction + UNIQUE(holding_id, cycle_number) so even if multiple
 *   app servers run concurrently, no cycle can ever be double-credited.
 */
function settleDueRewards({ nowMs = Date.now(), userId = null, serverInstanceId = SERVER_INSTANCE_ID } = {}) {
  return tx(() => {
    const settings = getSettingsRow();
    const intervalMs = Number(settings.reward_interval_sec) * 1000;
    const priceIrr = BigInt(settings.price_irr);

    const whereUser = userId ? 'AND user_id = ?' : '';
    const params = userId ? [nowMs, userId] : [nowMs];

    const dueHoldings = all(
      `SELECT * FROM lth_holdings
       WHERE status = 'active' AND next_reward_at_ms <= ? ${whereUser}
       ORDER BY purchased_at_ms ASC`,
      params
    );

    let cyclesSettled = 0;
    for (const h of dueHoldings) {
      const wallet = ensureWalletInTx(h.user_id);
      let baseAtoms = BigInt(wallet.base_atoms);
      let stakedAtoms = BigInt(wallet.staked_atoms);
      let withdrawableAtoms = BigInt(wallet.withdrawable_reward_atoms);
      let totalRewardedAtoms = BigInt(wallet.total_rewarded_atoms);

      const holdingActiveBase = BigInt(h.active_base_atoms);
      let holdingStaked = BigInt(h.accrued_staked_atoms);
      let holdingWithdrawable = BigInt(h.accrued_withdrawable_atoms);
      let cycle = Number(h.last_reward_cycle);
      let nextDueMs = Number(h.purchased_at_ms) + (cycle + 1) * intervalMs;

      // Cap catch-up per tick to 4000 cycles (~11 years) for safety
      let safetyCounter = 0;
      while (nextDueMs <= nowMs && safetyCounter < 4000) {
        safetyCounter += 1;
        cycle += 1;

        const existingCycle = get(
          'SELECT id FROM lth_reward_cycles WHERE holding_id = ? AND cycle_number = ?',
          [h.id, cycle]
        );
        if (!existingCycle && holdingActiveBase > 0n) {
          const split = math.computeDailyRewardSplit(
            holdingActiveBase,
            settings.reward_per_min_unit_atoms,
            settings.stake_bps
          );

          if (split.totalRewardAtoms > 0n) {
            const creditedIso = new Date(nextDueMs).toISOString();
            const alreadyUnlocked = Number(h.stake_unlocked) === 1 || nextDueMs >= Number(h.stake_unlock_at_ms);
            const deltaStaked = alreadyUnlocked ? 0n : split.stakedAtoms;
            const deltaWithdrawable = alreadyUnlocked
              ? (split.stakedAtoms + split.withdrawableAtoms)
              : split.withdrawableAtoms;

            const cycleId = uuid();
            run(
              `INSERT INTO lth_reward_cycles (
                id, holding_id, user_id, cycle_number, base_atoms_snapshot,
                reward_per_min_unit_atoms, stake_bps, withdrawable_bps,
                total_reward_atoms, staked_reward_atoms, withdrawable_reward_atoms,
                server_instance_id, due_at_ms, credited_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                cycleId, h.id, h.user_id, cycle, holdingActiveBase.toString(),
                settings.reward_per_min_unit_atoms, settings.stake_bps, settings.withdrawable_bps,
                split.totalRewardAtoms.toString(), deltaStaked.toString(), deltaWithdrawable.toString(),
                serverInstanceId, nextDueMs, creditedIso
              ]
            );

            run(
              `INSERT INTO lth_ledger (
                id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
                delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
                irr_value_snapshot, ref_type, ref_id, note, created_at
              ) VALUES (?, ?, 'reward_credit', '0', ?, ?, '0', ?, ?, 'reward_cycle', ?, ?, ?)`,
              [
                uuid(), h.user_id, deltaStaked.toString(), deltaWithdrawable.toString(),
                priceIrr.toString(), math.atomsToIrrExact(split.totalRewardAtoms, priceIrr),
                cycleId, `پاداش دوره ۲۴ساعته #${cycle} قرارداد ${h.contract_code}`, creditedIso
              ]
            );

            stakedAtoms += deltaStaked;
            withdrawableAtoms += deltaWithdrawable;
            totalRewardedAtoms += split.totalRewardAtoms;
            holdingStaked += deltaStaked;
            holdingWithdrawable += deltaWithdrawable;
            cyclesSettled += 1;
          }
        }

        nextDueMs = Number(h.purchased_at_ms) + (cycle + 1) * intervalMs;
      }

      const nowStr = nowIso();
      run(
        `UPDATE lth_holdings
         SET accrued_staked_atoms = ?, accrued_withdrawable_atoms = ?,
             last_reward_cycle = ?, next_reward_at_ms = ?, updated_at = ?
         WHERE id = ?`,
        [holdingStaked.toString(), holdingWithdrawable.toString(), cycle, nextDueMs, nowStr, h.id]
      );

      run(
        `UPDATE lth_wallets
         SET base_atoms = ?, staked_atoms = ?, withdrawable_reward_atoms = ?,
             total_rewarded_atoms = ?, updated_at = ?
         WHERE user_id = ?`,
        [
          baseAtoms.toString(),
          stakedAtoms.toString(),
          withdrawableAtoms.toString(),
          totalRewardedAtoms.toString(),
          nowStr,
          h.user_id
        ]
      );
    }

    // Check 3285-day (or configured lockup_days) PoS stake unlock maturity
    const unlockParams = userId ? [nowMs, userId] : [nowMs];
    const maturedHoldings = all(
      `SELECT * FROM lth_holdings
       WHERE stake_unlocked = 0 AND stake_unlock_at_ms <= ? ${whereUser}`,
      unlockParams
    );

    let stakesUnlocked = 0;
    for (const mh of maturedHoldings) {
      const wallet = ensureWalletInTx(mh.user_id);
      const unlockAmount = BigInt(mh.accrued_staked_atoms);
      const currentStaked = BigInt(wallet.staked_atoms);
      const actualUnlock = unlockAmount <= currentStaked ? unlockAmount : currentStaked;
      const nowStr = nowIso();

      if (actualUnlock > 0n) {
        const nextStaked = currentStaked - actualUnlock;
        const nextWithdrawable = BigInt(wallet.withdrawable_reward_atoms) + actualUnlock;
        run(
          `UPDATE lth_wallets
           SET staked_atoms = ?, withdrawable_reward_atoms = ?, updated_at = ?
           WHERE user_id = ?`,
          [nextStaked.toString(), nextWithdrawable.toString(), nowStr, mh.user_id]
        );
        run(
          `INSERT INTO lth_ledger (
            id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
            delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
            irr_value_snapshot, ref_type, ref_id, note, created_at
          ) VALUES (?, ?, 'stake_unlock', '0', ?, ?, '0', ?, ?, 'holding', ?, ?, ?)`,
          [
            uuid(), mh.user_id, (-actualUnlock).toString(), actualUnlock.toString(),
            priceIrr.toString(), math.atomsToIrrExact(actualUnlock, priceIrr),
            mh.id, `آزادسازی استیک پس از پایان دوره ${mh.lockup_days} روزه قرارداد ${mh.contract_code}`, nowStr
          ]
        );
        const existingPool = get('SELECT unlocked_stake_atoms FROM lth_unlocked_stake_pools WHERE user_id = ?', [mh.user_id]);
        const nextPoolAtoms = (existingPool ? BigInt(existingPool.unlocked_stake_atoms) : 0n) + actualUnlock;
        run(
          `INSERT INTO lth_unlocked_stake_pools (user_id, unlocked_stake_atoms, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET unlocked_stake_atoms = excluded.unlocked_stake_atoms, updated_at = excluded.updated_at`,
          [mh.user_id, nextPoolAtoms.toString(), nowStr]
        );
        notify(
          mh.user_id,
          'lth_stake_unlocked',
          'آزادسازی پاداش استیک (PoS)',
          `دورهٔ قفل ${mh.lockup_days} روزهٔ قرارداد ${mh.contract_code} به پایان رسید و موجودی استیک به بخش قابل برداشت منتقل شد.`,
          '/wallet'
        );
      }

      run(
        `UPDATE lth_holdings
         SET stake_unlocked = 1, accrued_staked_atoms = '0',
             accrued_withdrawable_atoms = ?, updated_at = ?
         WHERE id = ?`,
        [(BigInt(mh.accrued_withdrawable_atoms) + actualUnlock).toString(), nowStr, mh.id]
      );
      stakesUnlocked += 1;
    }

    return { cycles_settled: cyclesSettled, stakes_unlocked: stakesUnlocked, server_instance_id: serverInstanceId };
  });
}

/**
 * Reconciles a single user's wallet or all wallets against the immutable double-entry lth_ledger.
 * Powers "نشان سلامت و همخوانی با حسابداری ما".
 */
function reconcileLedger({ userId = null } = {}) {
  const settings = getSettingsRow();
  const bench = math.calculateAllMetrics({ mode: 'lth', value: '1', settings });

  const wallets = userId
    ? all('SELECT * FROM lth_wallets WHERE user_id = ?', [userId])
    : all('SELECT * FROM lth_wallets');

  let mismatchCount = 0;
  let totalLedgerRows = 0;
  let globalBase = 0n;
  let globalStaked = 0n;
  let globalWithdrawable = 0n;
  let globalReserved = 0n;
  const walletChecks = [];

  for (const w of wallets) {
    const entries = all(
      'SELECT delta_base_atoms, delta_staked_atoms, delta_withdrawable_atoms, delta_reserved_atoms FROM lth_ledger WHERE user_id = ?',
      [w.user_id]
    );
    totalLedgerRows += entries.length;

    let sumBase = 0n;
    let sumStaked = 0n;
    let sumWithdrawable = 0n;
    let sumReserved = 0n;
    for (const e of entries) {
      sumBase += BigInt(e.delta_base_atoms);
      sumStaked += BigInt(e.delta_staked_atoms);
      sumWithdrawable += BigInt(e.delta_withdrawable_atoms);
      sumReserved += BigInt(e.delta_reserved_atoms);
    }

    const wBase = BigInt(w.base_atoms);
    const wStaked = BigInt(w.staked_atoms);
    const wWithdrawable = BigInt(w.withdrawable_reward_atoms);
    const wReserved = BigInt(w.reserved_atoms);

    const diffBase = wBase - sumBase;
    const diffStaked = wStaked - sumStaked;
    const diffWithdrawable = wWithdrawable - sumWithdrawable;
    const diffReserved = wReserved - sumReserved;

    const matched = diffBase === 0n && diffStaked === 0n && diffWithdrawable === 0n && diffReserved === 0n;
    if (!matched) mismatchCount += 1;

    globalBase += wBase;
    globalStaked += wStaked;
    globalWithdrawable += wWithdrawable;
    globalReserved += wReserved;

    walletChecks.push({
      user_id: w.user_id,
      matched,
      ledger_entries: entries.length,
      discrepancy_atoms: (diffBase + diffStaked + diffWithdrawable + diffReserved).toString()
    });
  }

  // Also verify reward split conservation across all reward cycles
  const cycleRows = userId
    ? all('SELECT total_reward_atoms, staked_reward_atoms, withdrawable_reward_atoms FROM lth_reward_cycles WHERE user_id = ?', [userId])
    : all('SELECT total_reward_atoms, staked_reward_atoms, withdrawable_reward_atoms FROM lth_reward_cycles');
  let cycleConservationOk = true;
  for (const c of cycleRows) {
    if (BigInt(c.staked_reward_atoms) + BigInt(c.withdrawable_reward_atoms) !== BigInt(c.total_reward_atoms)) {
      cycleConservationOk = false;
      break;
    }
  }

  const healthy = mismatchCount === 0 && cycleConservationOk;
  const priceIrr = BigInt(settings.price_irr);

  return {
    healthy,
    status_label: healthy
      ? 'همخوان با دفتر کل حسابداری (اختلاف: ۰ واحد)'
      : `عدم تطابق در ${mismatchCount} کیف پول مشاهده شد`,
    checked_wallets: wallets.length,
    checked_ledger_entries: totalLedgerRows,
    checked_reward_cycles: cycleRows.length,
    mismatch_count: mismatchCount,
    reward_split_conservation_ok: cycleConservationOk,
    totals: {
      base_lth_exact: math.formatAtomsExact(globalBase),
      staked_lth_exact: math.formatAtomsExact(globalStaked),
      withdrawable_reward_lth_exact: math.formatAtomsExact(globalWithdrawable),
      reserved_lth_exact: math.formatAtomsExact(globalReserved),
      circulating_total_lth_exact: math.formatAtomsExact(globalBase + globalStaked + globalWithdrawable + globalReserved),
      circulating_total_irr_exact: math.atomsToIrrExact(globalBase + globalStaked + globalWithdrawable + globalReserved, priceIrr)
    },
    benchmark_1_lth_24h: {
      lth_unit: '1.00',
      unit_price_irr: priceIrr.toString(),
      unit_price_irr_formatted: math.addThousandSeparators(priceIrr.toString()),
      reward_24h_lth: bench.benchmarks.one_lth_24h_reward_lth,
      reward_24h_irr: bench.benchmarks.one_lth_24h_reward_irr,
      reward_24h_irr_formatted: math.addThousandSeparators(bench.benchmarks.one_lth_24h_reward_irr),
      reward_24h_toman: bench.benchmarks.one_lth_24h_reward_toman,
      reward_24h_toman_formatted: math.addThousandSeparators(bench.benchmarks.one_lth_24h_reward_toman),
      stake_percent: settings.stake_bps / 100,
      withdrawable_percent: settings.withdrawable_bps / 100,
      staked_24h_lth: bench.benchmarks.one_lth_24h_staked_lth,
      withdrawable_24h_lth: bench.benchmarks.one_lth_24h_withdrawable_lth,
      pico_unit_lth: '0.000000000001',
      pico_unit_irr: bench.benchmarks.pico_unit_irr
    },
    checked_at: nowIso(),
    wallets: userId ? walletChecks : undefined
  };
}

/**
 * Builds the complete Wallet & PoS Smart Contract payload for the authenticated user,
 * including all 7 exact wallet titles requested by the specification.
 */
function getWalletView(user) {
  settleDueRewards({ userId: user.id });
  const settings = getSettingsRow();
  const priceIrr = BigInt(settings.price_irr);
  const wallet = tx(() => ensureWalletInTx(user.id));

  const baseAtoms = BigInt(wallet.base_atoms);
  const stakedAtoms = BigInt(wallet.staked_atoms);
  const withdrawableRewardAtoms = BigInt(wallet.withdrawable_reward_atoms);
  const reservedAtoms = BigInt(wallet.reserved_atoms);

  // 7 Wallet Titles formulas:
  // 1. حجم پایه = فقط خریدهای اولیه
  // 2. استیک = ۷۰٪ (یا درصد تنظیمی) پاداش دریافتی به LTH (قابل برداشت ۳۲۸۵ روز بعد از خرید)
  // 3. حجم پاداش قابل برداشت LTH = ۳۰٪ (یا مکمل استیک) از پاداش دریافتی
  // 4. جمع ال تی اچ قابل برداشت = حجم پایه + ۳۰٪ پاداش دریافتی
  // 5. قابل برداشت (به ریال) = حجم پایه به ریال + ۳۰٪ پاداش دریافتی به ریال
  // 6. جمع ریال = جمع پایه و کل پاداش به ریال
  // 7. جمع ال تی اچ = جمع کل ال تی اچ (پایه + کل پاداش)
  const totalWithdrawableAtoms = baseAtoms + withdrawableRewardAtoms;
  const totalLthAtoms = baseAtoms + stakedAtoms + withdrawableRewardAtoms;

  const withdrawableIrrExact = math.atomsToIrrExact(totalWithdrawableAtoms, priceIrr);
  const withdrawableIrrFloor = math.atomsToIrrFloor(totalWithdrawableAtoms, priceIrr);
  const totalIrrExact = math.atomsToIrrExact(totalLthAtoms, priceIrr);
  const totalIrrFloor = math.atomsToIrrFloor(totalLthAtoms, priceIrr);

  const holdings = all(
    'SELECT * FROM lth_holdings WHERE user_id = ? ORDER BY purchased_at_ms DESC',
    [user.id]
  ).map((h) => {
    const nowMs = Date.now();
    const msRemaining = Math.max(0, Number(h.stake_unlock_at_ms) - nowMs);
    const daysRemaining = Math.ceil(msRemaining / 86400000);
    const activeBase = BigInt(h.active_base_atoms);
    const daily = math.computeDailyRewardSplit(activeBase, settings.reward_per_min_unit_atoms, settings.stake_bps);
    return {
      id: h.id,
      contract_code: h.contract_code,
      initial_base_lth_display_8: math.formatAtomsDisplay8(h.initial_base_atoms),
      initial_base_lth_exact: math.formatAtomsExact(h.initial_base_atoms),
      active_base_lth_display_8: math.formatAtomsDisplay8(h.active_base_atoms),
      active_base_lth_exact: math.formatAtomsExact(h.active_base_atoms),
      accrued_staked_lth_display_8: math.formatAtomsDisplay8(h.accrued_staked_atoms),
      accrued_staked_lth_exact: math.formatAtomsExact(h.accrued_staked_atoms),
      accrued_withdrawable_lth_exact: math.formatAtomsExact(h.accrued_withdrawable_atoms),
      daily_reward_lth_exact: math.formatAtomsCompact(daily.totalRewardAtoms) || '0',
      daily_reward_irr_exact: math.atomsToIrrExact(daily.totalRewardAtoms, priceIrr),
      lockup_days: h.lockup_days,
      purchased_at: h.purchased_at,
      stake_unlock_at: h.stake_unlock_at,
      stake_unlocked: Boolean(h.stake_unlocked),
      days_remaining: daysRemaining,
      last_reward_cycle: h.last_reward_cycle,
      next_reward_at: new Date(Number(h.next_reward_at_ms)).toISOString(),
      status: h.status
    };
  });

  const withdrawals = all(
    'SELECT * FROM lth_sheba_withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [user.id]
  ).map(withdrawalToJson);

  const transfers = all(
    `SELECT t.*, s.full_name AS sender_name, r.full_name AS recipient_name
     FROM lth_transfers t
     JOIN users s ON s.id = t.sender_id
     JOIN users r ON r.id = t.recipient_id
     WHERE t.sender_id = ? OR t.recipient_id = ?
     ORDER BY t.created_at DESC LIMIT 20`,
    [user.id, user.id]
  ).map((t) => ({
    id: t.id,
    code: t.code,
    direction: t.sender_id === user.id ? 'out' : 'in',
    counterparty_name: t.sender_id === user.id ? t.recipient_name : t.sender_name,
    lth_display_8: math.formatAtomsDisplay8(t.total_atoms),
    lth_exact: math.formatAtomsExact(t.total_atoms),
    irr_equivalent: t.irr_equivalent,
    irr_formatted: math.addThousandSeparators(t.irr_equivalent),
    note: t.note,
    created_at: t.created_at
  }));

  const recentLedger = all(
    'SELECT * FROM lth_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 25',
    [user.id]
  ).map((l) => ({
    id: l.id,
    entry_type: l.entry_type,
    delta_base_lth: math.formatAtomsCompact(l.delta_base_atoms) || '0',
    delta_staked_lth: math.formatAtomsCompact(l.delta_staked_atoms) || '0',
    delta_withdrawable_lth: math.formatAtomsCompact(l.delta_withdrawable_atoms) || '0',
    irr_value_snapshot: l.irr_value_snapshot,
    note: l.note,
    created_at: l.created_at
  }));

  const reconciliation = reconcileLedger({ userId: user.id });

  return {
    config: formatSettingsPayload(settings),
    wallet: {
      wallet_serial: formatWalletSerialSpaced(wallet.wallet_serial),
      wallet_serial_raw: wallet.wallet_serial,
      wallet_serial_masked: maskWalletSerial(wallet.wallet_serial),

      // 1. حجم پایه
      base_atoms: baseAtoms.toString(),
      base_lth_display_8: math.formatAtomsDisplay8(baseAtoms),
      base_lth_display_12: math.formatAtomsDisplay12(baseAtoms),
      base_lth_exact: math.formatAtomsExact(baseAtoms),
      base_irr_exact: math.atomsToIrrExact(baseAtoms, priceIrr),

      // 2. استیک (PoS)
      staked_atoms: stakedAtoms.toString(),
      staked_lth_display_8: math.formatAtomsDisplay8(stakedAtoms),
      staked_lth_display_12: math.formatAtomsDisplay12(stakedAtoms),
      staked_lth_exact: math.formatAtomsExact(stakedAtoms),
      staked_irr_exact: math.atomsToIrrExact(stakedAtoms, priceIrr),

      // 3. حجم پاداش قابل برداشت LTH
      withdrawable_reward_atoms: withdrawableRewardAtoms.toString(),
      withdrawable_reward_lth_display_8: math.formatAtomsDisplay8(withdrawableRewardAtoms),
      withdrawable_reward_lth_display_12: math.formatAtomsDisplay12(withdrawableRewardAtoms),
      withdrawable_reward_lth_exact: math.formatAtomsExact(withdrawableRewardAtoms),
      withdrawable_reward_irr_exact: math.atomsToIrrExact(withdrawableRewardAtoms, priceIrr),

      // 4. جمع ال تی اچ قابل برداشت
      total_withdrawable_atoms: totalWithdrawableAtoms.toString(),
      total_withdrawable_lth_display_8: math.formatAtomsDisplay8(totalWithdrawableAtoms),
      total_withdrawable_lth_display_12: math.formatAtomsDisplay12(totalWithdrawableAtoms),
      total_withdrawable_lth_exact: math.formatAtomsExact(totalWithdrawableAtoms),

      // 5. قابل برداشت (به ریال)
      withdrawable_irr_exact: withdrawableIrrExact,
      withdrawable_irr_formatted: math.addThousandSeparators(withdrawableIrrFloor.toString()),
      withdrawable_irr_floor: withdrawableIrrFloor.toString(),
      withdrawable_toman_floor: Number(withdrawableIrrFloor / 10n),

      // 6. جمع ریال
      total_irr_exact: totalIrrExact,
      total_irr_formatted: math.addThousandSeparators(totalIrrFloor.toString()),
      total_irr_floor: totalIrrFloor.toString(),

      // 7. جمع ال تی اچ
      total_lth_atoms: totalLthAtoms.toString(),
      total_lth_display_8: math.formatAtomsDisplay8(totalLthAtoms),
      total_lth_display_12: math.formatAtomsDisplay12(totalLthAtoms),
      total_lth_exact: math.formatAtomsExact(totalLthAtoms),

      // در انتظار تسویه شبا (رزروشده)
      reserved_atoms: reservedAtoms.toString(),
      reserved_lth_display_8: math.formatAtomsDisplay8(reservedAtoms),
      reserved_lth_display_12: math.formatAtomsDisplay12(reservedAtoms),
      reserved_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(reservedAtoms, priceIrr).toString()),

      updated_at: wallet.updated_at
    },
    reconciliation,
    holdings,
    withdrawals,
    transfers,
    recent_ledger: recentLedger
  };
}

/**
 * Initiates an LTH package or custom amount purchase, creating both lth_purchase_orders and a sandbox payment.
 */
function createPurchase(user, input, idempotencyKey) {
  const data = validate(input)
    .int('amount_toman', { min: 10000, max: 5000000000 })
    .int('package_toman', { required: false, min: 10000, max: 5000000000, default: null })
    .done();

  return tx(() => {
    if (idempotencyKey) {
      const prev = get(
        'SELECT response_json FROM idempotency_keys WHERE key = ? AND user_id = ? AND endpoint = ?',
        [idempotencyKey, user.id, 'POST /lth/purchases']
      );
      if (prev) {
        return { ...JSON.parse(prev.response_json), idempotent_replay: true };
      }
    }

    const settings = getSettingsRow();
    const packages = JSON.parse(settings.packages_toman_json || '[]');
    if (data.package_toman !== null && (!packages.includes(data.package_toman) || data.package_toman !== data.amount_toman)) {
      throw ApiError.validation('پکیج انتخاب‌شده در فهرست پکیج‌های فعال نیست.', [{ field: 'package_toman', message: 'پکیج نامعتبر است.' }]);
    }

    const priceIrr = BigInt(settings.price_irr);
    const amountIrr = BigInt(data.amount_toman) * 10n;
    const lthAtoms = (amountIrr * math.ONE_LTH_ATOMS) / priceIrr;
    if (lthAtoms <= 0n) {
      throw ApiError.validation('مبلغ انتخابی برای خرید حداقل واحد LTH کافی نیست.', [{ field: 'amount_toman', message: 'مبلغ بسیار کوچک است.' }]);
    }

    const tConfig = getTreasuryConfigRow();
    const { marketAtoms } = sumWalletCirculatingAtoms();
    if (marketAtoms + lthAtoms > BigInt(tConfig.total_supply_atoms)) {
      throw ApiError.invalidState('ظرفیت دارایی خزانهٔ LTH برای صدور این حجم خرید کافی نیست.');
    }

    const now = nowIso();
    const paymentId = uuid();
    const purchaseId = uuid();
    const code = makeCode('LP');
    const callbackToken = crypto.randomBytes(24).toString('hex');

    run(
      `INSERT INTO payments (
        id, order_id, service_request_id, lth_purchase_id, amount_toman, status, gateway,
        gateway_ref, callback_token, paid_at, failure_reason, created_at, updated_at
      ) VALUES (?, NULL, NULL, ?, ?, 'pending', 'sandbox', NULL, ?, NULL, NULL, ?, ?)`,
      [paymentId, purchaseId, data.amount_toman, callbackToken, now, now]
    );

    run(
      `INSERT INTO lth_purchase_orders (
        id, code, user_id, payment_id, package_toman, amount_toman, amount_irr,
        unit_price_irr, lth_atoms, lockup_days, status, fulfilled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', NULL, ?, ?)`,
      [
        purchaseId, code, user.id, paymentId, data.package_toman, data.amount_toman,
        amountIrr.toString(), priceIrr.toString(), lthAtoms.toString(), settings.lockup_days, now, now
      ]
    );

    const payload = {
      purchase: {
        id: purchaseId,
        code,
        amount_toman: data.amount_toman,
        amount_irr: amountIrr.toString(),
        lth_display_8: math.formatAtomsDisplay8(lthAtoms),
        lth_exact: math.formatAtomsExact(lthAtoms),
        lockup_days: settings.lockup_days,
        status: 'pending_payment'
      },
      payment: {
        id: paymentId,
        amount_toman: data.amount_toman,
        status: 'pending',
        gateway: 'sandbox',
        pay_url: `/api/v1/payments/${paymentId}/gateway`
      }
    };

    if (idempotencyKey) {
      run(
        'INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_json, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [idempotencyKey, user.id, 'POST /lth/purchases', hashBody(data), JSON.stringify(payload), 201, now]
      );
    }

    audit(user.id, user.role, 'lth.purchase.create', 'lth_purchase', purchaseId, {
      code,
      amount_toman: data.amount_toman,
      lth_exact: math.formatAtomsCompact(lthAtoms)
    });

    return payload;
  });
}

/**
 * Called inside payments.sandboxCallback transaction when an LTH purchase payment settles.
 */
function handlePaymentOutcomeInTx(paymentId, outcome, nowStr) {
  const purchase = get('SELECT * FROM lth_purchase_orders WHERE payment_id = ?', [paymentId]);
  if (!purchase) return null;

  if (outcome === 'success') {
    if (purchase.status !== 'pending_payment') return purchase;
    const settings = getSettingsRow();
    const wallet = ensureWalletInTx(purchase.user_id);
    const lthAtoms = BigInt(purchase.lth_atoms);
    const nextBase = BigInt(wallet.base_atoms) + lthAtoms;
    const nextPurchased = BigInt(wallet.total_purchased_atoms) + lthAtoms;

    const purchasedMs = Date.parse(nowStr) || Date.now();
    const intervalMs = Number(settings.reward_interval_sec) * 1000;
    const unlockMs = purchasedMs + Number(purchase.lockup_days) * 86400000;
    const unlockIso = new Date(unlockMs).toISOString();
    const contractCode = makeCode('POS');
    const holdingId = uuid();

    run(
      `UPDATE lth_purchase_orders
       SET status = 'fulfilled', fulfilled_at = ?, updated_at = ?
       WHERE id = ?`,
      [nowStr, nowStr, purchase.id]
    );

    run(
      `INSERT INTO lth_holdings (
        id, contract_code, user_id, purchase_order_id, initial_base_atoms, active_base_atoms,
        accrued_staked_atoms, accrued_withdrawable_atoms, unit_price_irr_snapshot, lockup_days,
        purchased_at_ms, purchased_at, stake_unlock_at_ms, stake_unlock_at, stake_unlocked,
        last_reward_cycle, next_reward_at_ms, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '0', '0', ?, ?, ?, ?, ?, ?, 0, 0, ?, 'active', ?, ?)`,
      [
        holdingId, contractCode, purchase.user_id, purchase.id,
        lthAtoms.toString(), lthAtoms.toString(), purchase.unit_price_irr, purchase.lockup_days,
        purchasedMs, nowStr, unlockMs, unlockIso, purchasedMs + intervalMs, nowStr, nowStr
      ]
    );

    run(
      `UPDATE lth_wallets
       SET base_atoms = ?, total_purchased_atoms = ?, updated_at = ?
       WHERE user_id = ?`,
      [nextBase.toString(), nextPurchased.toString(), nowStr, purchase.user_id]
    );

    run(
      `INSERT INTO lth_ledger (
        id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
        delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
        irr_value_snapshot, ref_type, ref_id, note, created_at
      ) VALUES (?, ?, 'purchase_base', ?, '0', '0', '0', ?, ?, 'lth_purchase', ?, ?, ?)`,
      [
        uuid(), purchase.user_id, lthAtoms.toString(), purchase.unit_price_irr,
        purchase.amount_irr, purchase.id, `خرید اولیه LTH (${purchase.code}) — قرارداد ${contractCode}`, nowStr
      ]
    );

    // Base LTH leaves the treasury and enters the market. Without this row the
    // «مقدار بازار» would grow while «دارایی» shrank with no accounting trail.
    run(
      `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
       VALUES (?, 'issue_base', ?, ?, 'lth_purchase', ?, ?, ?)`,
      [
        uuid(), lthAtoms.toString(), purchase.user_id, purchase.id,
        `صدور حجم پایه از خزانه به کیف پول (خرید ${purchase.code})`, nowStr
      ]
    );

    notify(
      purchase.user_id,
      'lth_purchase_fulfilled',
      'افزایش حجم پایهٔ کیف پول LTH',
      `خرید ${math.formatAtomsDisplay8(lthAtoms)} LTH تأیید شد و قرارداد هوشمند ${contractCode} فعال گردید.`,
      '/wallet'
    );
  } else if (outcome === 'fail' || outcome === 'expired') {
    if (purchase.status === 'pending_payment') {
      run(
        `UPDATE lth_purchase_orders SET status = 'failed', updated_at = ? WHERE id = ?`,
        [nowStr, purchase.id]
      );
    }
  }
  return get('SELECT * FROM lth_purchase_orders WHERE id = ?', [purchase.id]);
}

function normalizeSheba(raw) {
  const cleaned = String(raw || '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^IR\d{24}$/.test(cleaned)) {
    throw ApiError.validation('شماره شبا باید با IR شروع شده و دقیقاً ۲۴ رقم داشته باشد (مجموعاً ۲۶ کاراکتر).', [
      { field: 'sheba_iban', message: 'فرمت شماره شبا نامعتبر است (مثال: IR062960000000100324200001).' }
    ]);
  }
  return cleaned;
}

function deductBaseFromHoldingsFifo(userId, baseAtomsToDeduct, nowStr) {
  let remaining = BigInt(baseAtomsToDeduct);
  if (remaining <= 0n) return;
  const holdings = all(
    `SELECT * FROM lth_holdings WHERE user_id = ? AND status = 'active' ORDER BY purchased_at_ms ASC`,
    [userId]
  );
  for (const h of holdings) {
    if (remaining <= 0n) break;
    const active = BigInt(h.active_base_atoms);
    if (active <= 0n) continue;
    const cut = active >= remaining ? remaining : active;
    const nextActive = active - cut;
    remaining -= cut;
    run(
      `UPDATE lth_holdings SET active_base_atoms = ?, updated_at = ? WHERE id = ?`,
      [nextActive.toString(), nowStr, h.id]
    );
  }
}

function restoreBaseToHoldings(userId, baseAtomsToRestore, nowStr) {
  const restore = BigInt(baseAtomsToRestore);
  if (restore <= 0n) return;
  const latest = get(
    `SELECT * FROM lth_holdings WHERE user_id = ? ORDER BY purchased_at_ms DESC LIMIT 1`,
    [userId]
  );
  if (latest) {
    const nextActive = BigInt(latest.active_base_atoms) + restore;
    run(
      `UPDATE lth_holdings SET active_base_atoms = ?, status = 'active', updated_at = ? WHERE id = ?`,
      [nextActive.toString(), nowStr, latest.id]
    );
  }
}

function withdrawalToJson(row) {
  return {
    id: row.id,
    code: row.code,
    user_id: row.user_id,
    kind: row.kind,
    kind_label: row.kind === 'sell_lth' ? 'فروش LTH و تسویه شبا' : 'برداشت شبا از کیف پول',
    sheba_iban: row.sheba_iban,
    sheba_masked: row.sheba_iban ? `${row.sheba_iban.slice(0, 6)}••••••••••••••${row.sheba_iban.slice(-4)}` : '',
    account_holder_name: row.account_holder_name,
    lth_display_8: math.formatAtomsDisplay8(row.total_atoms),
    lth_exact: math.formatAtomsExact(row.total_atoms),
    from_reward_lth: math.formatAtomsExact(row.from_reward_atoms),
    from_base_lth: math.formatAtomsExact(row.from_base_atoms),
    amount_irr: row.amount_irr,
    amount_irr_formatted: math.addThousandSeparators(row.amount_irr),
    amount_toman: row.amount_toman,
    status: row.status,
    status_label: {
      pending: 'در انتظار بررسی و واریز مالی',
      paid: 'واریزشده به شبا',
      rejected: 'ردشده (برگشت به کیف پول)',
      canceled: 'لغوشده توسط کاربر'
    }[row.status] || row.status,
    bank_ref: row.bank_ref,
    review_note: row.review_note,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at
  };
}

/**
 * Creates a Sheba withdrawal ("برداشت شبا") or Sell LTH ("فروش") request.
 * Enforces server-side that locked PoS staked LTH (before 3285 days) CANNOT be withdrawn or sold.
 */
function createShebaWithdrawalOrSell(user, input) {
  const kind = input && input.kind === 'sell_lth' ? 'sell_lth' : 'sheba_withdrawal';
  const shebaIban = normalizeSheba(input && input.sheba_iban);
  const holderData = validate(input)
    .string('account_holder_name', { min: 2, max: 120 })
    .done();

  settleDueRewards({ userId: user.id });

  return tx(() => {
    const settings = getSettingsRow();
    const priceIrr = BigInt(settings.price_irr);
    const tConfig = getTreasuryConfigRow();
    const wallet = ensureWalletInTx(user.id);

    const baseAtoms = BigInt(wallet.base_atoms);
    const withdrawableRewardAtoms = BigInt(wallet.withdrawable_reward_atoms);
    const maxWithdrawableAtoms = baseAtoms + withdrawableRewardAtoms;

    if (maxWithdrawableAtoms <= 0n) {
      throw ApiError.invalidState('موجودی قابل برداشت شما صفر است (موجودی استیک تا پایان دورهٔ ۳۲۸۵ روزه قفل است).');
    }

    let requestedAtoms = 0n;
    if (input.withdraw_all === true) {
      requestedAtoms = maxWithdrawableAtoms;
    } else if (input.lth_amount !== undefined && input.lth_amount !== null && String(input.lth_amount).trim() !== '') {
      try {
        requestedAtoms = math.parseLthToAtoms(input.lth_amount, { allowZero: false });
      } catch (err) {
        throw ApiError.validation(err.message, [{ field: 'lth_amount', message: err.message }]);
      }
    } else if (input.amount_irr !== undefined && input.amount_irr !== null && String(input.amount_irr).trim() !== '') {
      try {
        requestedAtoms = math.irrToAtoms(input.amount_irr, priceIrr);
      } catch (err) {
        throw ApiError.validation(err.message, [{ field: 'amount_irr', message: err.message }]);
      }
    } else {
      throw ApiError.validation('مقدار LTH یا مبلغ ریالی برداشت را مشخص کنید.', [{ field: 'amount_irr', message: 'الزامی است.' }]);
    }

    if (requestedAtoms <= 0n) {
      throw ApiError.validation('مقدار درخواستی باید بزرگ‌تر از صفر باشد.', [{ field: 'lth_amount', message: 'بزرگ‌تر از صفر وارد کنید.' }]);
    }
    if (requestedAtoms > maxWithdrawableAtoms) {
      throw ApiError.invalidState(
        `مقدار درخواستی بیش از سقف قابل برداشت (${math.formatAtomsExact(maxWithdrawableAtoms)} LTH) است. بخش استیک تا پایان ۳۲۸۵ روز قابل برداشت نیست.`
      );
    }

    const feeBps = kind === 'sell_lth' ? BigInt(tConfig.sell_fee_bps || 0) : 0n;
    const feeAtoms = feeBps > 0n ? (requestedAtoms * feeBps) / 10000n : 0n;
    const netSettlementAtoms = requestedAtoms - feeAtoms;

    const settlementIrr = math.atomsToIrrFloor(netSettlementAtoms, priceIrr);
    const settlementToman = Number(settlementIrr / 10n);
    if (settlementToman < 1000) {
      throw ApiError.validation('حداقل مبلغ قابل تسویه از طریق شبکهٔ شبا ۱۰٬۰۰۰ ریال (۱٬۰۰۰ تومان) است.', [
        { field: 'amount_irr', message: 'کمتر از حداقل تسویهٔ بانکی است.' }
      ]);
    }

    // Deduct from withdrawable_reward_atoms first, then from base_atoms
    const fromReward = withdrawableRewardAtoms >= requestedAtoms ? requestedAtoms : withdrawableRewardAtoms;
    const fromBase = requestedAtoms - fromReward;

    const nextReward = withdrawableRewardAtoms - fromReward;
    const nextBase = baseAtoms - fromBase;
    const nextReserved = BigInt(wallet.reserved_atoms) + requestedAtoms;
    const now = nowIso();

    if (fromBase > 0n) {
      deductBaseFromHoldingsFifo(user.id, fromBase, now);
    }

    run(
      `UPDATE lth_wallets
       SET base_atoms = ?, withdrawable_reward_atoms = ?, reserved_atoms = ?, updated_at = ?
       WHERE user_id = ?`,
      [nextBase.toString(), nextReward.toString(), nextReserved.toString(), now, user.id]
    );

    const id = uuid();
    const code = makeCode('SW');
    run(
      `INSERT INTO lth_sheba_withdrawals (
        id, code, user_id, kind, sheba_iban, account_holder_name,
        from_reward_atoms, from_base_atoms, total_atoms, unit_price_irr,
        amount_irr, amount_toman, status, bank_ref, review_note,
        reviewed_by, reviewed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?)`,
      [
        id, code, user.id, kind, shebaIban, holderData.account_holder_name,
        fromReward.toString(), fromBase.toString(), requestedAtoms.toString(), priceIrr.toString(),
        settlementIrr.toString(), settlementToman, now, now
      ]
    );

    const ledgerType = kind === 'sell_lth' ? 'sell_liquidate_reserve' : 'sheba_withdraw_reserve';
    run(
      `INSERT INTO lth_ledger (
        id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
        delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
        irr_value_snapshot, ref_type, ref_id, note, created_at
      ) VALUES (?, ?, ?, ?, '0', ?, ?, ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
      [
        uuid(), user.id, ledgerType, (-fromBase).toString(), (-fromReward).toString(),
        requestedAtoms.toString(), priceIrr.toString(), settlementIrr.toString(),
        id, `ثبت درخواست ${kind === 'sell_lth' ? 'فروش LTH' : 'برداشت شبا'} (${code})`, now
      ]
    );

    audit(user.id, user.role, `lth.${kind}.request`, 'lth_withdrawal', id, {
      code,
      amount_irr: settlementIrr.toString(),
      sheba_masked: `${shebaIban.slice(0, 6)}...${shebaIban.slice(-4)}`
    });

    const created = get('SELECT * FROM lth_sheba_withdrawals WHERE id = ?', [id]);
    return { withdrawal: withdrawalToJson(created) };
  });
}

function cancelOwnWithdrawal(user, code) {
  return tx(() => {
    const row = get('SELECT * FROM lth_sheba_withdrawals WHERE code = ?', [code]);
    if (!row) throw ApiError.notFound('درخواست برداشت یافت نشد.');
    if (row.user_id !== user.id) throw ApiError.forbidden();
    if (row.status !== 'pending') {
      throw ApiError.invalidState('فقط درخواست‌های در انتظار بررسی قابل لغو هستند.');
    }

    const wallet = ensureWalletInTx(user.id);
    const fromBase = BigInt(row.from_base_atoms);
    const fromReward = BigInt(row.from_reward_atoms);
    const total = BigInt(row.total_atoms);
    const now = nowIso();

    if (fromBase > 0n) {
      restoreBaseToHoldings(user.id, fromBase, now);
    }

    run(
      `UPDATE lth_wallets
       SET base_atoms = ?, withdrawable_reward_atoms = ?, reserved_atoms = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        (BigInt(wallet.base_atoms) + fromBase).toString(),
        (BigInt(wallet.withdrawable_reward_atoms) + fromReward).toString(),
        (BigInt(wallet.reserved_atoms) - total).toString(),
        now,
        user.id
      ]
    );

    run(
      `UPDATE lth_sheba_withdrawals
       SET status = 'canceled', review_note = 'لغو توسط کاربر', updated_at = ?
       WHERE id = ?`,
      [now, row.id]
    );

    run(
      `INSERT INTO lth_ledger (
        id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
        delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
        irr_value_snapshot, ref_type, ref_id, note, created_at
      ) VALUES (?, ?, 'sheba_withdraw_refund', ?, '0', ?, ?, ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
      [
        uuid(), user.id, fromBase.toString(), fromReward.toString(), (-total).toString(),
        row.unit_price_irr, row.amount_irr, row.id, `لغو درخواست برداشت ${row.code} توسط کاربر`, now
      ]
    );

    return { withdrawal: withdrawalToJson(get('SELECT * FROM lth_sheba_withdrawals WHERE id = ?', [row.id])) };
  });
}

/**
 * Finance / Admin review of pending Sheba withdrawals & LTH sales.
 */
function listStaffWithdrawals(staffUser, query) {
  if (!['admin', 'finance'].includes(staffUser.role)) throw ApiError.forbidden();
  const { page, limit, offset } = parsePagination(query);
  const where = [];
  const params = [];
  if (query.status) {
    where.push('w.status = ?');
    params.push(query.status);
  }
  const whereSql = where.length ? where.join(' AND ') : '1 = 1';
  const rows = all(
    `SELECT w.*, u.full_name AS user_name, u.phone AS user_phone
     FROM lth_sheba_withdrawals w
     JOIN users u ON u.id = w.user_id
     WHERE ${whereSql}
     ORDER BY CASE WHEN w.status = 'pending' THEN 0 ELSE 1 END, w.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = get(`SELECT COUNT(*) AS c FROM lth_sheba_withdrawals w WHERE ${whereSql}`, params).c;
  return {
    items: rows.map((r) => ({
      ...withdrawalToJson(r),
      user_name: r.user_name,
      user_phone_masked: maskPhone(r.user_phone)
    })),
    page,
    limit,
    total
  };
}

function reviewWithdrawal(staffUser, code, input) {
  if (!['admin', 'finance'].includes(staffUser.role)) throw ApiError.forbidden();
  const data = validate(input)
    .string('action', { enum: ['approve_paid', 'reject'] })
    .string('bank_ref', { required: false, max: 100, default: '' })
    .string('review_note', { required: false, max: 500, default: '' })
    .done();

  if (data.action === 'approve_paid' && data.bank_ref.trim().length < 4) {
    throw ApiError.validation('برای تأیید واریز شبا، ثبت شماره مرجع بانکی (پایا/ساتنا) الزامی است.', [
      { field: 'bank_ref', message: 'حداقل ۴ کاراکتر الزامی است.' }
    ]);
  }
  if (data.action === 'reject' && data.review_note.trim().length < 3) {
    throw ApiError.validation('برای رد درخواست برداشت، ثبت علت الزامی است.', [
      { field: 'review_note', message: 'حداقل ۳ کاراکتر الزامی است.' }
    ]);
  }

  return tx(() => {
    const row = get('SELECT * FROM lth_sheba_withdrawals WHERE code = ?', [code]);
    if (!row) throw ApiError.notFound('درخواست برداشت یافت نشد.');
    if (row.status !== 'pending') {
      throw ApiError.invalidState('این درخواست قبلاً تعیین تکلیف شده است.');
    }

    const wallet = ensureWalletInTx(row.user_id);
    const total = BigInt(row.total_atoms);
    const fromBase = BigInt(row.from_base_atoms);
    const fromReward = BigInt(row.from_reward_atoms);
    const now = nowIso();

    if (data.action === 'approve_paid') {
      const tConfig = getTreasuryConfigRow();
      const sellFeeBps = row.kind === 'sell_lth' ? BigInt(tConfig.sell_fee_bps || 0) : 0n;
      const feeAtoms = sellFeeBps > 0n ? (total * sellFeeBps) / 10000n : 0n;

      run(
        `UPDATE lth_wallets SET reserved_atoms = ?, updated_at = ? WHERE user_id = ?`,
        [(BigInt(wallet.reserved_atoms) - total).toString(), now, row.user_id]
      );
      run(
        `UPDATE lth_sheba_withdrawals
         SET status = 'paid', bank_ref = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
        [data.bank_ref.trim(), data.review_note.trim() || 'تسویه انجام شد', staffUser.id, now, now, row.id]
      );
      run(
        `INSERT INTO lth_ledger (
          id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
          delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
          irr_value_snapshot, ref_type, ref_id, note, created_at
        ) VALUES (?, ?, 'sheba_withdraw_paid', '0', '0', '0', ?, ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
        [
          uuid(), row.user_id, (-total).toString(), row.unit_price_irr, row.amount_irr,
          row.id, `تسویه نهایی شبا (${row.code}) — مرجع بانکی ${data.bank_ref.trim()}`, now
        ]
      );

      // Record Protocol Treasury ("خزانه") return accounting:
      // 1) جمع بازگشت پایه (from_base_atoms)
      if (fromBase > 0n) {
        run(
          `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
           VALUES (?, 'return_base', ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
          [uuid(), fromBase.toString(), row.user_id, row.id, `بازگشت حجم پایه به خزانه (${row.code})`, now]
        );
      }
      // 2) جمع بازگشت استیک (portion of from_reward_atoms originating from unlocked post-3285d stake)
      if (fromReward > 0n) {
        const poolRow = get('SELECT unlocked_stake_atoms FROM lth_unlocked_stake_pools WHERE user_id = ?', [row.user_id]);
        const poolAtoms = poolRow ? BigInt(poolRow.unlocked_stake_atoms) : 0n;
        const returnedStake = poolAtoms >= fromReward ? fromReward : poolAtoms;
        const returnedRegularReward = fromReward - returnedStake;
        if (returnedStake > 0n) {
          run(
            `UPDATE lth_unlocked_stake_pools SET unlocked_stake_atoms = ?, updated_at = ? WHERE user_id = ?`,
            [(poolAtoms - returnedStake).toString(), now, row.user_id]
          );
          run(
            `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
             VALUES (?, 'return_stake', ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
            [uuid(), returnedStake.toString(), row.user_id, row.id, `بازگشت استیک آزادشده به خزانه (${row.code})`, now]
          );
        }
        if (returnedRegularReward > 0n) {
          run(
            `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
             VALUES (?, 'return_reward', ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
            [uuid(), returnedRegularReward.toString(), row.user_id, row.id, `تسویه پاداش قابل برداشت (${row.code})`, now]
          );
        }
      }
      // 3) جمع کارمزد (if sell_fee_bps > 0)
      if (feeAtoms > 0n) {
        run(
          `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
           VALUES (?, 'collect_fee', ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
          [uuid(), feeAtoms.toString(), row.user_id, row.id, `کارمزد تسویه فروش (${row.code})`, now]
        );
        recordFeeTax(row.user_id, feeAtoms, 'sheba_withdrawal', row.id, `مالیات کارمزد تسویه فروش (${row.code})`, now);
      }
      notify(
        row.user_id,
        'lth_withdrawal_paid',
        'واریز شبا انجام شد',
        `درخواست ${row.code} به مبلغ ${math.addThousandSeparators(row.amount_irr)} ریال با مرجع ${data.bank_ref.trim()} تسویه شد.`,
        '/wallet'
      );
    } else {
      if (fromBase > 0n) {
        restoreBaseToHoldings(row.user_id, fromBase, now);
      }
      run(
        `UPDATE lth_wallets
         SET base_atoms = ?, withdrawable_reward_atoms = ?, reserved_atoms = ?, updated_at = ?
         WHERE user_id = ?`,
        [
          (BigInt(wallet.base_atoms) + fromBase).toString(),
          (BigInt(wallet.withdrawable_reward_atoms) + fromReward).toString(),
          (BigInt(wallet.reserved_atoms) - total).toString(),
          now,
          row.user_id
        ]
      );
      run(
        `UPDATE lth_sheba_withdrawals
         SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
        [data.review_note.trim(), staffUser.id, now, now, row.id]
      );
      run(
        `INSERT INTO lth_ledger (
          id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
          delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
          irr_value_snapshot, ref_type, ref_id, note, created_at
        ) VALUES (?, ?, 'sheba_withdraw_refund', ?, '0', ?, ?, ?, ?, 'sheba_withdrawal', ?, ?, ?)`,
        [
          uuid(), row.user_id, fromBase.toString(), fromReward.toString(), (-total).toString(),
          row.unit_price_irr, row.amount_irr, row.id, `رد درخواست برداشت ${row.code}: ${data.review_note.trim()}`, now
        ]
      );
      notify(
        row.user_id,
        'lth_withdrawal_rejected',
        'برگشت درخواست برداشت شبا به کیف پول',
        `درخواست ${row.code} رد شد (${data.review_note.trim()}) و موجودی به کیف پول شما بازگشت.`,
        '/wallet'
      );
    }

    audit(staffUser.id, staffUser.role, `lth.withdrawal.${data.action}`, 'lth_withdrawal', row.id, {
      code: row.code,
      bank_ref: data.bank_ref.trim() || null,
      review_note: data.review_note.trim() || null
    });

    return { withdrawal: withdrawalToJson(get('SELECT * FROM lth_sheba_withdrawals WHERE id = ?', [row.id])) };
  });
}

/**
 * Account-to-Account transfer ("حساب به حساب") of withdrawable LTH.
 * Note: Credits recipient's withdrawable balance so "حجم پایه = فقط خریدهای اولیه" remains strictly true.
 */
function createAccountTransfer(sender, input) {
  const data = validate(input)
    .string('recipient', { min: 4, max: 40 })
    .string('lth_amount', { min: 1, max: 32 })
    .string('note', { required: false, max: 240, default: '' })
    .done();

  let atoms = 0n;
  try {
    atoms = math.parseLthToAtoms(data.lth_amount, { allowZero: false });
  } catch (err) {
    throw ApiError.validation(err.message, [{ field: 'lth_amount', message: err.message }]);
  }

  settleDueRewards({ userId: sender.id });

  return tx(() => {
    const cleanRecipient = data.recipient.replace(/\s+/g, '');
    let recipientUser = null;
    if (/^\d{16}$/.test(cleanRecipient)) {
      const w = get('SELECT user_id FROM lth_wallets WHERE wallet_serial = ?', [cleanRecipient]);
      if (w) recipientUser = get('SELECT id, full_name, status FROM users WHERE id = ?', [w.user_id]);
    } else {
      const phone = normalizeIranPhone(cleanRecipient);
      if (phone) {
        recipientUser = get('SELECT id, full_name, status FROM users WHERE phone = ?', [phone]);
      }
    }

    if (!recipientUser || recipientUser.status !== 'active') {
      throw ApiError.notFound('حساب مقصد با این شماره موبایل یا شماره کیف پول یافت نشد.');
    }
    if (recipientUser.id === sender.id) {
      throw ApiError.validation('انتقال حساب به حساب به کیف پول خودتان مجاز نیست.', [
        { field: 'recipient', message: 'حساب مقصد باید کاربر دیگری باشد.' }
      ]);
    }

    const settings = getSettingsRow();
    const priceIrr = BigInt(settings.price_irr);
    const senderWallet = ensureWalletInTx(sender.id);
    const recipientWallet = ensureWalletInTx(recipientUser.id);

    const sBase = BigInt(senderWallet.base_atoms);
    const sReward = BigInt(senderWallet.withdrawable_reward_atoms);
    const maxTransferable = sBase + sReward;

    if (atoms > maxTransferable) {
      throw ApiError.invalidState(
        `موجودی قابل انتقال شما (${math.formatAtomsExact(maxTransferable)} LTH) کافی نیست. موجودی استیک قفل‌شده قابل انتقال نیست.`
      );
    }

    const fromReward = sReward >= atoms ? atoms : sReward;
    const fromBase = atoms - fromReward;
    const now = nowIso();

    if (fromBase > 0n) {
      deductBaseFromHoldingsFifo(sender.id, fromBase, now);
    }

    const tConfig = getTreasuryConfigRow();
    const transferFeeBps = BigInt(tConfig.transfer_fee_bps || 0);
    const feeAtoms = transferFeeBps > 0n ? (atoms * transferFeeBps) / 10000n : 0n;
    const netRecipientAtoms = atoms - feeAtoms;

    run(
      `UPDATE lth_wallets
       SET base_atoms = ?, withdrawable_reward_atoms = ?, updated_at = ?
       WHERE user_id = ?`,
      [(sBase - fromBase).toString(), (sReward - fromReward).toString(), now, sender.id]
    );

    run(
      `UPDATE lth_wallets
       SET withdrawable_reward_atoms = ?, updated_at = ?
       WHERE user_id = ?`,
      [(BigInt(recipientWallet.withdrawable_reward_atoms) + netRecipientAtoms).toString(), now, recipientUser.id]
    );

    const transferId = uuid();
    const code = makeCode('TR');
    const irrEq = math.atomsToIrrExact(atoms, priceIrr);

    run(
      `INSERT INTO lth_transfers (
        id, code, sender_id, recipient_id, from_reward_atoms, from_base_atoms,
        total_atoms, unit_price_irr, irr_equivalent, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transferId, code, sender.id, recipientUser.id,
        fromReward.toString(), fromBase.toString(), atoms.toString(),
        priceIrr.toString(), irrEq, data.note || null, now
      ]
    );

    run(
      `INSERT INTO lth_ledger (
        id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
        delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
        irr_value_snapshot, ref_type, ref_id, note, created_at
      ) VALUES (?, ?, 'p2p_transfer_out', ?, '0', ?, '0', ?, ?, 'lth_transfer', ?, ?, ?)`,
      [
        uuid(), sender.id, (-fromBase).toString(), (-fromReward).toString(),
        priceIrr.toString(), irrEq, transferId, `انتقال حساب به حساب (${code}) به ${recipientUser.full_name}`, now
      ]
    );

    run(
      `INSERT INTO lth_ledger (
        id, user_id, entry_type, delta_base_atoms, delta_staked_atoms,
        delta_withdrawable_atoms, delta_reserved_atoms, price_irr_snapshot,
        irr_value_snapshot, ref_type, ref_id, note, created_at
      ) VALUES (?, ?, 'p2p_transfer_in', '0', '0', ?, '0', ?, ?, 'lth_transfer', ?, ?, ?)`,
      [
        uuid(), recipientUser.id, netRecipientAtoms.toString(),
        priceIrr.toString(), math.atomsToIrrExact(netRecipientAtoms, priceIrr), transferId, `دریافت انتقال حساب به حساب (${code}) از ${sender.full_name}`, now
      ]
    );

    if (feeAtoms > 0n) {
      run(
        `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
         VALUES (?, 'collect_fee', ?, ?, 'lth_transfer', ?, ?, ?)`,
        [uuid(), feeAtoms.toString(), sender.id, transferId, `کارمزد انتقال حساب به حساب (${code})`, now]
      );
      recordFeeTax(sender.id, feeAtoms, 'lth_transfer', transferId, `مالیات کارمزد انتقال (${code})`, now);
    }

    notify(
      recipientUser.id,
      'lth_transfer_received',
      'دریافت حساب به حساب LTH',
      `مقدار ${math.formatAtomsDisplay8(atoms)} LTH از طرف ${sender.full_name} به موجودی قابل برداشت کیف پول شما واریز شد.`,
      '/wallet'
    );

    audit(sender.id, sender.role, 'lth.transfer.create', 'lth_transfer', transferId, {
      code,
      recipient_id: recipientUser.id,
      lth_exact: math.formatAtomsCompact(atoms)
    });

    return {
      transfer: {
        id: transferId,
        code,
        recipient_name: recipientUser.full_name,
        lth_display_8: math.formatAtomsDisplay8(atoms),
        lth_exact: math.formatAtomsExact(atoms),
        irr_equivalent: irrEq,
        created_at: now
      }
    };
  });
}

/**
 * Admin-only update of LTH Engine settings including coupled 100% Stake/Withdrawable Regulator.
 */
function updateSettings(adminUser, input) {
  if (adminUser.role !== 'admin') throw ApiError.forbidden();
  const current = getSettingsRow();

  const reasonData = validate(input)
    .string('reason', { min: 3, max: 300 })
    .done();

  let nextPriceIrr = BigInt(current.price_irr);
  if (input.price_irr !== undefined && input.price_irr !== null && String(input.price_irr).trim() !== '') {
    const cleanPrice = math.normalizeNumericString(input.price_irr);
    if (!/^\d+$/.test(cleanPrice) || BigInt(cleanPrice) < 1000n) {
      throw ApiError.validation('قیمت ریالی هر ۱ LTH باید عدد صحیح معتبر (حداقل ۱٬۰۰۰ ریال) باشد.', [
        { field: 'price_irr', message: 'مقدار نامعتبر است.' }
      ]);
    }
    nextPriceIrr = BigInt(cleanPrice);
  }

  let nextRewardAtoms = BigInt(current.reward_per_min_unit_atoms);
  if (input.reward_per_min_unit_lth !== undefined && input.reward_per_min_unit_lth !== null && String(input.reward_per_min_unit_lth).trim() !== '') {
    try {
      nextRewardAtoms = math.parseLthToAtoms(input.reward_per_min_unit_lth, { allowZero: false });
    } catch (err) {
      throw ApiError.validation(err.message, [{ field: 'reward_per_min_unit_lth', message: err.message }]);
    }
  }

  // Coupled 100% regulator ("ریگلاژ حد تناسب از ۱۰۰ درصد مثلا ۷۱ درصد به ۲۹ درصد")
  let nextStakeBps = current.stake_bps;
  let nextWithdrawableBps = current.withdrawable_bps;

  const hasStakePct = input.stake_percent !== undefined && input.stake_percent !== null && input.stake_percent !== '';
  const hasWithdrawablePct = input.withdrawable_percent !== undefined && input.withdrawable_percent !== null && input.withdrawable_percent !== '';

  if (hasStakePct && !hasWithdrawablePct) {
    const s = Number(input.stake_percent);
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      throw ApiError.validation('درصد استیک باید بین ۰ تا ۱۰۰ باشد.', [{ field: 'stake_percent', message: 'بین ۰ تا ۱۰۰ وارد کنید.' }]);
    }
    nextStakeBps = Math.round(s * 100);
    nextWithdrawableBps = 10000 - nextStakeBps;
  } else if (!hasStakePct && hasWithdrawablePct) {
    const w = Number(input.withdrawable_percent);
    if (!Number.isFinite(w) || w < 0 || w > 100) {
      throw ApiError.validation('درصد قابل برداشت باید بین ۰ تا ۱۰۰ باشد.', [{ field: 'withdrawable_percent', message: 'بین ۰ تا ۱۰۰ وارد کنید.' }]);
    }
    nextWithdrawableBps = Math.round(w * 100);
    nextStakeBps = 10000 - nextWithdrawableBps;
  } else if (hasStakePct && hasWithdrawablePct) {
    const sBps = Math.round(Number(input.stake_percent) * 100);
    const wBps = Math.round(Number(input.withdrawable_percent) * 100);
    if (!Number.isFinite(sBps) || !Number.isFinite(wBps) || sBps < 0 || wBps < 0 || sBps + wBps !== 10000) {
      throw ApiError.validation('جمع درصد استیک و درصد پاداش قابل برداشت باید دقیقاً ۱۰۰٪ باشد.', [
        { field: 'stake_percent', message: 'مجموع دو نسبت باید ۱۰۰٪ باشد.' }
      ]);
    }
    nextStakeBps = sBps;
    nextWithdrawableBps = wBps;
  }

  let nextLockupDays = current.lockup_days;
  if (input.lockup_days !== undefined && input.lockup_days !== null && input.lockup_days !== '') {
    const d = Number(input.lockup_days);
    if (!Number.isInteger(d) || d < 1 || d > 36500) {
      throw ApiError.validation('دورهٔ قفل استیک (روز) باید عدد صحیح بین ۱ تا ۳۶۵۰۰ باشد.', [
        { field: 'lockup_days', message: 'مقدار نامعتبر است.' }
      ]);
    }
    nextLockupDays = d;
  }

  let nextPackages = JSON.parse(current.packages_toman_json || '[]');
  if (Array.isArray(input.packages_toman) && input.packages_toman.length > 0) {
    const parsed = input.packages_toman.map((x) => Number(x));
    if (parsed.length > 12 || parsed.some((n) => !Number.isInteger(n) || n < 10000 || n > 5000000000)) {
      throw ApiError.validation('پکیج‌های تومان باید اعداد صحیح معتبر (حداقل ۱۰٬۰۰۰ تومان) باشند.', [
        { field: 'packages_toman', message: 'مقادیر پکیج نامعتبر است.' }
      ]);
    }
    nextPackages = parsed;
  }

  const now = nowIso();
  tx(() => {
    run(
      `UPDATE lth_settings
       SET price_irr = ?, reward_per_min_unit_atoms = ?, stake_bps = ?, withdrawable_bps = ?,
           lockup_days = ?, packages_toman_json = ?, updated_at = ?
       WHERE id = 1`,
      [
        nextPriceIrr.toString(),
        nextRewardAtoms.toString(),
        nextStakeBps,
        nextWithdrawableBps,
        nextLockupDays,
        JSON.stringify(nextPackages),
        now
      ]
    );

    audit(adminUser.id, adminUser.role, 'lth.settings.update', 'lth_settings', '1', {
      reason: reasonData.reason,
      before: {
        price_irr: current.price_irr,
        stake_percent: current.stake_bps / 100,
        withdrawable_percent: current.withdrawable_bps / 100,
        lockup_days: current.lockup_days
      },
      after: {
        price_irr: nextPriceIrr.toString(),
        stake_percent: nextStakeBps / 100,
        withdrawable_percent: nextWithdrawableBps / 100,
        lockup_days: nextLockupDays
      }
    });
  });

  return { config: getPublicConfig() };
}

function detectImageSignature(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: '.png', mime: 'image/png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ext: '.webp', mime: 'image/webp' };
  }
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') {
    return { ext: '.gif', mime: 'image/gif' };
  }
  const headText = buffer.slice(0, 512).toString('utf8').trim();
  if ((headText.startsWith('<?xml') || headText.startsWith('<svg')) && headText.includes('<svg')) {
    const fullSvg = buffer.toString('utf8');
    if (/<script|onload\s*=|onerror\s*=|javascript:/i.test(fullSvg)) {
      return null;
    }
    return { ext: '.svg', mime: 'image/svg+xml' };
  }
  return null;
}

function updateLogo(adminUser, file) {
  if (adminUser.role !== 'admin') throw ApiError.forbidden();
  if (!file || !file.buffer) {
    throw ApiError.validation('فایل تصویر لوگوی LTH انتخاب نشده است.', [{ field: 'logo', message: 'فایل تصویر الزامی است.' }]);
  }
  const sig = detectImageSignature(file.buffer);
  if (!sig) {
    throw ApiError.validation('فرمت فایل لوگو معتبر نیست (فقط PNG، JPG، WEBP، GIF یا SVG ایمن مجاز است).', [
      { field: 'logo', message: 'امضای باینری تصویر معتبر نیست.' }
    ]);
  }

  const publicDir = path.join(config.storageDir, '..', 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const filename = `lth-logo-${uuid()}${sig.ext}`;
  fs.writeFileSync(path.join(publicDir, filename), file.buffer);
  const logoPath = `/uploads/${filename}`;
  const now = nowIso();

  tx(() => {
    run('UPDATE lth_settings SET logo_path = ?, updated_at = ? WHERE id = 1', [logoPath, now]);
    audit(adminUser.id, adminUser.role, 'lth.logo.upload', 'lth_settings', '1', { logo_path: logoPath });
  });

  return { logo_path: logoPath, config: getPublicConfig() };
}

function getClusterSchedulerStatus() {
  const lease = get('SELECT * FROM distributed_scheduler_leases WHERE job_name = ?', ['lth_24h_rewards']);
  return {
    current_server_instance_id: SERVER_INSTANCE_ID,
    lease: lease || null
  };
}

/**
 * Admin-only update of Protocol Treasury ("خزانه") total supply cap & fee bps, logged in audit_log.
 */
function updateTreasurySettings(adminUser, input) {
  if (adminUser.role !== 'admin') throw ApiError.forbidden();
  const reasonData = validate(input)
    .string('reason', { min: 3, max: 300 })
    .done();

  const current = getTreasuryConfigRow();
  let nextTotalSupplyAtoms = BigInt(current.total_supply_atoms);
  if (input.total_supply_lth !== undefined && input.total_supply_lth !== null && String(input.total_supply_lth).trim() !== '') {
    try {
      nextTotalSupplyAtoms = math.parseLthToAtoms(input.total_supply_lth, { allowZero: false });
    } catch (err) {
      throw ApiError.validation(err.message, [{ field: 'total_supply_lth', message: err.message }]);
    }
    const { marketAtoms } = sumWalletCirculatingAtoms();
    if (nextTotalSupplyAtoms < marketAtoms) {
      throw ApiError.invalidState(
        `کل عرضهٔ خزانه نمی‌تواند کمتر از مقدار فعلی در گردش بازار (${math.formatAtomsDisplay12(marketAtoms)} LTH) باشد.`
      );
    }
  }

  let nextTransferFeeBps = current.transfer_fee_bps;
  if (input.transfer_fee_percent !== undefined && input.transfer_fee_percent !== null && input.transfer_fee_percent !== '') {
    const num = Number(input.transfer_fee_percent);
    if (!Number.isFinite(num) || num < 0 || num > 20) {
      throw ApiError.validation('درصد کارمزد انتقال باید بین ۰ تا ۲۰ درصد باشد.', [{ field: 'transfer_fee_percent', message: 'بین ۰ تا ۲۰ وارد کنید.' }]);
    }
    nextTransferFeeBps = Math.round(num * 100);
  }

  let nextSellFeeBps = current.sell_fee_bps;
  if (input.sell_fee_percent !== undefined && input.sell_fee_percent !== null && input.sell_fee_percent !== '') {
    const num = Number(input.sell_fee_percent);
    if (!Number.isFinite(num) || num < 0 || num > 20) {
      throw ApiError.validation('درصد کارمزد فروش باید بین ۰ تا ۲۰ درصد باشد.', [{ field: 'sell_fee_percent', message: 'بین ۰ تا ۲۰ وارد کنید.' }]);
    }
    nextSellFeeBps = Math.round(num * 100);
  }

  const now = nowIso();
  tx(() => {
    run(
      `UPDATE lth_treasury_config
       SET total_supply_atoms = ?, transfer_fee_bps = ?, sell_fee_bps = ?, updated_at = ?
       WHERE id = 1`,
      [nextTotalSupplyAtoms.toString(), nextTransferFeeBps, nextSellFeeBps, now]
    );
    audit(adminUser.id, adminUser.role, 'lth.treasury.update', 'lth_treasury_config', '1', {
      reason: reasonData.reason,
      before: {
        total_supply_lth: math.formatAtomsDisplay8(current.total_supply_atoms),
        transfer_fee_percent: current.transfer_fee_bps / 100,
        sell_fee_percent: current.sell_fee_bps / 100
      },
      after: {
        total_supply_lth: math.formatAtomsDisplay8(nextTotalSupplyAtoms),
        transfer_fee_percent: nextTransferFeeBps / 100,
        sell_fee_percent: nextSellFeeBps / 100
      }
    });
  });

  return { treasury: getTreasuryView() };
}

function normalizeSearchTerm(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function buildWalletMetricsSummary(walletRow, priceIrr) {
  const baseAtoms = BigInt(walletRow.base_atoms);
  const stakedAtoms = BigInt(walletRow.staked_atoms);
  const withdrawableRewardAtoms = BigInt(walletRow.withdrawable_reward_atoms);
  const reservedAtoms = BigInt(walletRow.reserved_atoms);
  const totalWithdrawableAtoms = baseAtoms + withdrawableRewardAtoms;
  const totalLthAtoms = baseAtoms + stakedAtoms + withdrawableRewardAtoms;
  const withdrawableIrrFloor = math.atomsToIrrFloor(totalWithdrawableAtoms, priceIrr);
  const totalIrrFloor = math.atomsToIrrFloor(totalLthAtoms, priceIrr);

  return {
    wallet_serial: formatWalletSerialSpaced(walletRow.wallet_serial),
    wallet_serial_raw: walletRow.wallet_serial,
    // 1. حجم پایه
    base_lth_display_12: math.formatAtomsDisplay12(baseAtoms),
    base_lth_exact: math.formatAtomsExact(baseAtoms),
    // 2. استیک
    staked_lth_display_12: math.formatAtomsDisplay12(stakedAtoms),
    staked_lth_exact: math.formatAtomsExact(stakedAtoms),
    // 3. حجم پاداش قابل برداشت LTH
    withdrawable_reward_lth_display_12: math.formatAtomsDisplay12(withdrawableRewardAtoms),
    withdrawable_reward_lth_exact: math.formatAtomsExact(withdrawableRewardAtoms),
    // 4. جمع ال تی اچ قابل برداشت
    total_withdrawable_lth_display_12: math.formatAtomsDisplay12(totalWithdrawableAtoms),
    total_withdrawable_lth_exact: math.formatAtomsExact(totalWithdrawableAtoms),
    // 5. قابل برداشت (به ریال)
    withdrawable_irr_formatted: math.addThousandSeparators(withdrawableIrrFloor.toString()),
    withdrawable_irr_exact: math.atomsToIrrExact(totalWithdrawableAtoms, priceIrr),
    // 6. جمع ریال
    total_irr_formatted: math.addThousandSeparators(totalIrrFloor.toString()),
    total_irr_exact: math.atomsToIrrExact(totalLthAtoms, priceIrr),
    // 7. جمع ال تی اچ
    total_lth_atoms: totalLthAtoms.toString(),
    total_lth_display_12: math.formatAtomsDisplay12(totalLthAtoms),
    total_lth_exact: math.formatAtomsExact(totalLthAtoms),
    // در رزرو شبا
    reserved_lth_display_12: math.formatAtomsDisplay12(reservedAtoms),
    updated_at: walletRow.updated_at
  };
}

/**
 * Unified Backend Protocol Search, Metrics Inspector & Quantity Control
 * ("سرچ پروتکل در بک‌اند برای بررسی راحت‌تر موازین و کنترل مقادیر")
 * Restricted to admin and finance roles.
 */
function searchProtocol(staffUser, query = {}) {
  if (!['admin', 'finance'].includes(staffUser.role)) throw ApiError.forbidden();
  settleDueRewards();

  const settings = getSettingsRow();
  const priceIrr = BigInt(settings.price_irr);
  const treasury = getTreasuryView();
  const reconciliation = reconcileLedger();

  const rawQ = normalizeSearchTerm(query.q || '');
  const compactQ = rawQ.replace(/\s+/g, '');
  const scope = ['all', 'wallets', 'contracts', 'withdrawals', 'transfers', 'ledger', 'treasury'].includes(query.scope)
    ? query.scope
    : 'all';
  const limit = Math.min(100, Math.max(5, Number.parseInt(query.limit, 10) || 40));

  let minAtoms = null;
  let maxAtoms = null;
  if (query.min_lth !== undefined && String(query.min_lth).trim() !== '') {
    try {
      minAtoms = math.parseLthToAtoms(query.min_lth, { allowZero: true });
    } catch (err) {
      throw ApiError.validation(err.message, [{ field: 'min_lth', message: err.message }]);
    }
  }
  if (query.max_lth !== undefined && String(query.max_lth).trim() !== '') {
    try {
      maxAtoms = math.parseLthToAtoms(query.max_lth, { allowZero: true });
    } catch (err) {
      throw ApiError.validation(err.message, [{ field: 'max_lth', message: err.message }]);
    }
  }

  const onlyWithBalance = query.only_with_balance === 'true' || query.only_with_balance === true;
  const onlyMismatch = query.only_mismatch === 'true' || query.only_mismatch === true;
  const projectionDays = Math.min(3650, Math.max(1, Number.parseInt(query.projection_days, 10) || 30));

  // Global active base & N-day reward obligation projection ("کنترل مقادیر و موازین")
  const allActiveHoldings = all(`SELECT active_base_atoms, stake_unlock_at_ms FROM lth_holdings WHERE status = 'active'`);
  let totalActiveBaseAtoms = 0n;
  let globalDailyRewardAtoms = 0n;
  let globalDailyStakedAtoms = 0n;
  let globalDailyWithdrawableAtoms = 0n;
  let unlockingWithinProjectionAtoms = 0n;
  const horizonMs = Date.now() + projectionDays * 86400000;

  for (const h of allActiveHoldings) {
    const ab = BigInt(h.active_base_atoms);
    if (ab <= 0n) continue;
    totalActiveBaseAtoms += ab;
    const split = math.computeDailyRewardSplit(ab, settings.reward_per_min_unit_atoms, settings.stake_bps);
    globalDailyRewardAtoms += split.totalRewardAtoms;
    globalDailyStakedAtoms += split.stakedAtoms;
    globalDailyWithdrawableAtoms += split.withdrawableAtoms;
  }

  const upcomingUnlockRows = all(
    `SELECT accrued_staked_atoms FROM lth_holdings WHERE stake_unlocked = 0 AND stake_unlock_at_ms <= ?`,
    [horizonMs]
  );
  for (const u of upcomingUnlockRows) {
    unlockingWithinProjectionAtoms += BigInt(u.accrued_staked_atoms);
  }

  const projectedRewardAtoms = globalDailyRewardAtoms * BigInt(projectionDays);
  const projectedStakedAtoms = globalDailyStakedAtoms * BigInt(projectionDays);
  const projectedWithdrawableAtoms = globalDailyWithdrawableAtoms * BigInt(projectionDays);
  const treasuryAssetAtoms = BigInt(treasury.asset_atoms);
  const treasuryCoversProjection = treasuryAssetAtoms >= projectedRewardAtoms;

  const metricsControl = {
    active_contracts_count: allActiveHoldings.length,
    active_earning_base_lth_display_12: math.formatAtomsDisplay12(totalActiveBaseAtoms),
    active_earning_base_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(totalActiveBaseAtoms, priceIrr).toString()),
    daily_24h_obligation: {
      total_reward_lth_display_12: math.formatAtomsDisplay12(globalDailyRewardAtoms),
      staked_reward_lth_display_12: math.formatAtomsDisplay12(globalDailyStakedAtoms),
      withdrawable_reward_lth_display_12: math.formatAtomsDisplay12(globalDailyWithdrawableAtoms),
      total_reward_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(globalDailyRewardAtoms, priceIrr).toString()),
      withdrawable_reward_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(globalDailyWithdrawableAtoms, priceIrr).toString())
    },
    projection: {
      days: projectionDays,
      projected_total_reward_lth_display_12: math.formatAtomsDisplay12(projectedRewardAtoms),
      projected_staked_lth_display_12: math.formatAtomsDisplay12(projectedStakedAtoms),
      projected_withdrawable_lth_display_12: math.formatAtomsDisplay12(projectedWithdrawableAtoms),
      projected_total_reward_irr_formatted: math.addThousandSeparators(math.atomsToIrrFloor(projectedRewardAtoms, priceIrr).toString()),
      stakes_unlocking_in_window_lth_display_12: math.formatAtomsDisplay12(unlockingWithinProjectionAtoms),
      treasury_covers_projection: treasuryCoversProjection
    }
  };

  // 1) Wallets search & balance/reconciliation check
  let wallets = [];
  if (scope === 'all' || scope === 'wallets') {
    const wWhere = [];
    const wParams = [];
    if (rawQ) {
      wWhere.push(
        "(u.full_name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR w.wallet_serial LIKE ? ESCAPE '\\' OR u.id = ?)"
      );
      wParams.push(likeContains(rawQ), likeContains(compactQ), likeContains(rawQ), likeContains(compactQ), rawQ);
    }
    const wSql = wWhere.length ? `WHERE ${wWhere.join(' AND ')}` : '';
    const rawWallets = all(
      `SELECT w.*, u.full_name, u.phone, u.email, u.role, u.status AS user_status
       FROM lth_wallets w
       JOIN users u ON u.id = w.user_id
       ${wSql}
       ORDER BY w.updated_at DESC
       LIMIT 200`,
      wParams
    );

    for (const rw of rawWallets) {
      const totalAtoms = BigInt(rw.base_atoms) + BigInt(rw.staked_atoms) + BigInt(rw.withdrawable_reward_atoms) + BigInt(rw.reserved_atoms);
      if (onlyWithBalance && totalAtoms === 0n) continue;
      if (minAtoms !== null && totalAtoms < minAtoms) continue;
      if (maxAtoms !== null && totalAtoms > maxAtoms) continue;

      const userRec = reconcileLedger({ userId: rw.user_id });
      if (onlyMismatch && userRec.healthy) continue;

      const activeContractsCount = get(
        `SELECT COUNT(*) AS c FROM lth_holdings WHERE user_id = ? AND status = 'active'`,
        [rw.user_id]
      ).c;

      wallets.push({
        user_id: rw.user_id,
        full_name: rw.full_name,
        phone_masked: maskPhone(rw.phone),
        role: rw.role,
        user_status: rw.user_status,
        ledger_healthy: userRec.healthy,
        ledger_entries_count: userRec.checked_ledger_entries,
        active_contracts_count: activeContractsCount,
        metrics: buildWalletMetricsSummary(rw, priceIrr)
      });
      if (wallets.length >= limit) break;
    }
  }

  // 2) Smart Contracts (POS-... & LP-...) search
  let contracts = [];
  if (scope === 'all' || scope === 'contracts') {
    const cWhere = [];
    const cParams = [];
    if (rawQ) {
      cWhere.push(
        "(h.contract_code LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')"
      );
      cParams.push(likeContains(compactQ.toUpperCase()), likeContains(compactQ.toUpperCase()), likeContains(rawQ), likeContains(compactQ));
    }
    if (query.contract_status === 'unlocked') {
      cWhere.push('h.stake_unlocked = 1');
    } else if (query.contract_status && ['active', 'redeemed'].includes(query.contract_status)) {
      cWhere.push('h.status = ?');
      cParams.push(query.contract_status);
    }
    const cSql = cWhere.length ? `WHERE ${cWhere.join(' AND ')}` : '';
    const cRows = all(
      `SELECT h.*, p.code AS purchase_code, p.amount_toman AS purchase_toman,
              u.full_name AS user_name, u.phone AS user_phone
       FROM lth_holdings h
       JOIN lth_purchase_orders p ON p.id = h.purchase_order_id
       JOIN users u ON u.id = h.user_id
       ${cSql}
       ORDER BY h.purchased_at_ms DESC
       LIMIT ?`,
      [...cParams, limit]
    );
    contracts = cRows
      .filter((h) => {
        const ab = BigInt(h.active_base_atoms);
        if (minAtoms !== null && ab < minAtoms) return false;
        if (maxAtoms !== null && ab > maxAtoms) return false;
        return true;
      })
      .map((h) => {
        const daysRemaining = Math.max(0, Math.ceil((Number(h.stake_unlock_at_ms) - Date.now()) / 86400000));
        const daily = math.computeDailyRewardSplit(h.active_base_atoms, settings.reward_per_min_unit_atoms, settings.stake_bps);
        return {
          id: h.id,
          contract_code: h.contract_code,
          purchase_code: h.purchase_code,
          purchase_toman: h.purchase_toman,
          user_id: h.user_id,
          user_name: h.user_name,
          user_phone_masked: maskPhone(h.user_phone),
          initial_base_lth_display_12: math.formatAtomsDisplay12(h.initial_base_atoms),
          active_base_lth_display_12: math.formatAtomsDisplay12(h.active_base_atoms),
          accrued_staked_lth_display_12: math.formatAtomsDisplay12(h.accrued_staked_atoms),
          accrued_withdrawable_lth_display_12: math.formatAtomsDisplay12(h.accrued_withdrawable_atoms),
          daily_reward_lth_display_12: math.formatAtomsDisplay12(daily.totalRewardAtoms),
          lockup_days: h.lockup_days,
          days_remaining: daysRemaining,
          stake_unlocked: Boolean(h.stake_unlocked),
          last_reward_cycle: h.last_reward_cycle,
          purchased_at: h.purchased_at,
          stake_unlock_at: h.stake_unlock_at,
          status: h.status
        };
      });
  }

  // 3) Sheba Withdrawals & Sell LTH (SW-...)
  let withdrawals = [];
  if (scope === 'all' || scope === 'withdrawals') {
    const swWhere = [];
    const swParams = [];
    if (rawQ) {
      swWhere.push(
        "(w.code LIKE ? ESCAPE '\\' OR w.sheba_iban LIKE ? ESCAPE '\\' OR w.bank_ref LIKE ? ESCAPE '\\' OR w.account_holder_name LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')"
      );
      swParams.push(
        likeContains(compactQ.toUpperCase()),
        likeContains(compactQ.toUpperCase()),
        likeContains(rawQ),
        likeContains(rawQ),
        likeContains(rawQ),
        likeContains(compactQ)
      );
    }
    if (query.withdrawal_status && ['pending', 'paid', 'rejected', 'canceled'].includes(query.withdrawal_status)) {
      swWhere.push('w.status = ?');
      swParams.push(query.withdrawal_status);
    }
    const swSql = swWhere.length ? `WHERE ${swWhere.join(' AND ')}` : '';
    withdrawals = all(
      `SELECT w.*, u.full_name AS user_name, u.phone AS user_phone
       FROM lth_sheba_withdrawals w
       JOIN users u ON u.id = w.user_id
       ${swSql}
       ORDER BY w.created_at DESC
       LIMIT ?`,
      [...swParams, limit]
    ).map((r) => ({
      ...withdrawalToJson(r),
      lth_display_12: math.formatAtomsDisplay12(r.total_atoms),
      user_name: r.user_name,
      user_phone_masked: maskPhone(r.user_phone)
    }));
  }

  // 4) Account-to-Account Transfers (TR-...)
  let transfers = [];
  if (scope === 'all' || scope === 'transfers') {
    const trWhere = [];
    const trParams = [];
    if (rawQ) {
      trWhere.push("(t.code LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\' OR s.full_name LIKE ? ESCAPE '\\' OR r.full_name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR r.phone LIKE ? ESCAPE '\\')");
      trParams.push(likeContains(compactQ.toUpperCase()), likeContains(rawQ), likeContains(rawQ), likeContains(rawQ), likeContains(compactQ), likeContains(compactQ));
    }
    const trSql = trWhere.length ? `WHERE ${trWhere.join(' AND ')}` : '';
    transfers = all(
      `SELECT t.*, s.full_name AS sender_name, s.phone AS sender_phone,
              r.full_name AS recipient_name, r.phone AS recipient_phone
       FROM lth_transfers t
       JOIN users s ON s.id = t.sender_id
       JOIN users r ON r.id = t.recipient_id
       ${trSql}
       ORDER BY t.created_at DESC
       LIMIT ?`,
      [...trParams, limit]
    ).map((t) => ({
      id: t.id,
      code: t.code,
      sender_id: t.sender_id,
      sender_name: t.sender_name,
      sender_phone_masked: maskPhone(t.sender_phone),
      recipient_id: t.recipient_id,
      recipient_name: t.recipient_name,
      recipient_phone_masked: maskPhone(t.recipient_phone),
      lth_display_12: math.formatAtomsDisplay12(t.total_atoms),
      lth_exact: math.formatAtomsExact(t.total_atoms),
      irr_formatted: math.addThousandSeparators(t.irr_equivalent),
      note: t.note,
      created_at: t.created_at
    }));
  }

  // 5) Double-Entry Ledger (lth_ledger)
  let ledgerEntries = [];
  if (scope === 'all' || scope === 'ledger') {
    const lWhere = [];
    const lParams = [];
    if (rawQ) {
      lWhere.push("(l.note LIKE ? ESCAPE '\\' OR l.ref_id LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')");
      lParams.push(likeContains(rawQ), likeContains(compactQ), likeContains(rawQ), likeContains(compactQ));
    }
    if (query.ledger_type) {
      lWhere.push('l.entry_type = ?');
      lParams.push(query.ledger_type);
    }
    const lSql = lWhere.length ? `WHERE ${lWhere.join(' AND ')}` : '';
    ledgerEntries = all(
      `SELECT l.*, u.full_name AS user_name, u.phone AS user_phone
       FROM lth_ledger l
       JOIN users u ON u.id = l.user_id
       ${lSql}
       ORDER BY l.created_at DESC
       LIMIT ?`,
      [...lParams, limit]
    ).map((l) => ({
      id: l.id,
      user_id: l.user_id,
      user_name: l.user_name,
      user_phone_masked: maskPhone(l.user_phone),
      entry_type: l.entry_type,
      delta_base_lth: math.formatAtomsCompact(l.delta_base_atoms) || '0',
      delta_staked_lth: math.formatAtomsCompact(l.delta_staked_atoms) || '0',
      delta_withdrawable_lth: math.formatAtomsCompact(l.delta_withdrawable_atoms) || '0',
      delta_reserved_lth: math.formatAtomsCompact(l.delta_reserved_atoms) || '0',
      irr_value_snapshot: l.irr_value_snapshot,
      ref_type: l.ref_type,
      ref_id: l.ref_id,
      note: l.note,
      created_at: l.created_at
    }));
  }

  // 6) Treasury Return & Fee Events (lth_treasury_ledger)
  let treasuryEvents = [];
  if (scope === 'all' || scope === 'treasury') {
    const tWhere = [];
    const tParams = [];
    if (rawQ) {
      tWhere.push("(tl.note LIKE ? ESCAPE '\\' OR tl.ref_id LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\')");
      tParams.push(likeContains(rawQ), likeContains(compactQ), likeContains(rawQ));
    }
    const tSql = tWhere.length ? `WHERE ${tWhere.join(' AND ')}` : '';
    treasuryEvents = all(
      `SELECT tl.*, u.full_name AS user_name
       FROM lth_treasury_ledger tl
       LEFT JOIN users u ON u.id = tl.user_id
       ${tSql}
       ORDER BY tl.created_at DESC
       LIMIT ?`,
      [...tParams, limit]
    ).map((tl) => ({
      id: tl.id,
      event_type: tl.event_type,
      event_label: {
        issue_base: 'صدور حجم پایه از خزانه به بازار',
        return_base: 'بازگشت حجم پایه به خزانه',
        return_stake: 'بازگشت استیک آزادشده به خزانه',
        return_reward: 'تسویه پاداش قابل برداشت',
        collect_fee: 'وصول کارمزد پروتکل به خزانه',
        tax_accrued: 'شناسایی مالیات روی کارمزد',
        tax_settled: 'تسویه مالیات با مرجع'
      }[tl.event_type] || tl.event_type,
      lth_display_12: math.formatAtomsDisplay12(tl.atoms),
      lth_exact: math.formatAtomsExact(tl.atoms),
      user_name: tl.user_name || 'سیستم',
      note: tl.note,
      created_at: tl.created_at
    }));
  }

  return {
    query: { q: rawQ, scope, projection_days: projectionDays },
    treasury,
    reconciliation,
    metrics_control: metricsControl,
    results: {
      wallets,
      contracts,
      withdrawals,
      transfers,
      ledger_entries: ledgerEntries,
      treasury_events: treasuryEvents
    }
  };
}

/**
 * Full 360-degree Protocol & 7-Metric Wallet Inspector for a single user ("بازرسی کامل موازین کاربر").
 */
function inspectUserProtocol(staffUser, targetUserId) {
  if (!['admin', 'finance'].includes(staffUser.role)) throw ApiError.forbidden();
  const targetUser = get('SELECT id, full_name, phone, email, role, status, created_at FROM users WHERE id = ?', [targetUserId]);
  if (!targetUser) throw ApiError.notFound('کاربر مورد نظر در پروتکل یافت نشد.');

  const view = getWalletView({ id: targetUser.id });
  const poolRow = get('SELECT unlocked_stake_atoms FROM lth_unlocked_stake_pools WHERE user_id = ?', [targetUser.id]);
  const purchases = all(
    'SELECT * FROM lth_purchase_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
    [targetUser.id]
  ).map((p) => ({
    id: p.id,
    code: p.code,
    amount_toman: p.amount_toman,
    amount_irr_formatted: math.addThousandSeparators(p.amount_irr),
    lth_display_12: math.formatAtomsDisplay12(p.lth_atoms),
    status: p.status,
    fulfilled_at: p.fulfilled_at,
    created_at: p.created_at
  }));

  return {
    user: {
      id: targetUser.id,
      full_name: targetUser.full_name,
      phone_masked: maskPhone(targetUser.phone),
      email: targetUser.email,
      role: targetUser.role,
      status: targetUser.status,
      created_at: targetUser.created_at
    },
    unlocked_stake_pool_lth_display_12: math.formatAtomsDisplay12(poolRow ? poolRow.unlocked_stake_atoms : '0'),
    wallet: view.wallet,
    reconciliation: view.reconciliation,
    holdings: view.holdings,
    purchases,
    withdrawals: view.withdrawals,
    transfers: view.transfers,
    recent_ledger: view.recent_ledger
  };
}


// ---------------------------------------------------------------------------
// Market reward projection (staff / admin analytics)
// ---------------------------------------------------------------------------

/**
 * «میزان کل پاداش بازار» — how much reward the current market produces per
 * interval, and what the whole supply would produce at a given split.
 *
 * Every number here is derived, never stored: wallets + settings in, exact
 * BigInt arithmetic out. The optional `target_reward_lth` back-solves the market
 * size required to produce a desired reward, which is how an operator engineers
 * the column ("given a total reward, this is the market value it implies").
 */
function getMarketRewardProjection(rawQuery = {}) {
  settleDueRewards();
  const settings = getSettingsRow();
  const priceIrr = BigInt(settings.price_irr);
  const tConfig = getTreasuryConfigRow();

  const { marketAtoms, baseSum, stakedSum, withdrawableSum, reservedSum, walletCount } = sumWalletCirculatingAtoms();
  const totalSupplyAtoms = BigInt(tConfig.total_supply_atoms);

  // Splits to compare: the live regulator plus whatever the operator passes in.
  const splits = [];
  const liveStakeBps = Number(settings.stake_bps);
  splits.push({ stake_bps: liveStakeBps, label: `ریگلاژ فعلی (${liveStakeBps / 100}٪ / ${(10000 - liveStakeBps) / 100}٪)` });

  const requestedStake = rawQuery.stake_percent !== undefined
    ? Number(rawQuery.stake_percent)
    : (rawQuery.stake_bps !== undefined ? Number(rawQuery.stake_bps) / 100 : null);
  if (requestedStake !== null && Number.isFinite(requestedStake) && requestedStake >= 0 && requestedStake <= 100) {
    const bps = Math.round(requestedStake * 100);
    if (!splits.some((x) => x.stake_bps === bps)) {
      splits.push({ stake_bps: bps, label: `سناریوی ${requestedStake}٪ / ${(100 - requestedStake)}٪` });
    }
  }

  const rate = settings.reward_per_min_unit_atoms;
  const buildScenario = (baseAtoms, stakeBps, label) => {
    const split = protocol.projectRewards(baseAtoms, {
      rewardPerMinUnitAtoms: rate,
      stakeBps,
      withdrawableBps: 10000 - stakeBps
    });
    return {
      label,
      stake_bps: stakeBps,
      stake_percent: stakeBps / 100,
      withdrawable_bps: 10000 - stakeBps,
      withdrawable_percent: (10000 - stakeBps) / 100,
      base_atoms: BigInt(baseAtoms).toString(),
      base_lth_display_12: math.formatAtomsDisplay12(baseAtoms),
      total_reward_atoms: split.total_atoms.toString(),
      total_reward_lth_display_12: math.formatAtomsDisplay12(split.total_atoms),
      total_reward_lth_exact: math.formatAtomsCompact(split.total_atoms) || '0',
      total_reward_irr_exact: math.atomsToIrrExact(split.total_atoms, priceIrr),
      staked_reward_atoms: split.staked_atoms.toString(),
      staked_reward_lth_display_12: math.formatAtomsDisplay12(split.staked_atoms),
      staked_reward_irr_exact: math.atomsToIrrExact(split.staked_atoms, priceIrr),
      withdrawable_reward_atoms: split.withdrawable_atoms.toString(),
      withdrawable_reward_lth_display_12: math.formatAtomsDisplay12(split.withdrawable_atoms),
      withdrawable_reward_irr_exact: math.atomsToIrrExact(split.withdrawable_atoms, priceIrr)
    };
  };

  // Live market under each split, plus the full-supply ceiling.
  const marketScenarios = splits.map((sp) =>
    buildScenario(marketAtoms, sp.stake_bps, `${sp.label} — بازار فعلی`)
  );
  const supplyScenarios = splits.map((sp) =>
    buildScenario(totalSupplyAtoms, sp.stake_bps, `${sp.label} — کل عرضه`)
  );

  // Back-solve: a desired reward implies a market size.
  let target = null;
  const rawTarget = rawQuery.target_reward_lth;
  if (rawTarget !== undefined && rawTarget !== null && String(rawTarget).trim() !== '') {
    let targetAtoms = 0n;
    try {
      targetAtoms = math.parseLthToAtoms(String(rawTarget), { allowZero: false });
    } catch (err) {
      throw ApiError.validation(err.message, [{ field: 'target_reward_lth', message: err.message }]);
    }
    const requiredMarket = protocol.marketForReward(targetAtoms, rate);
    const achievable = requiredMarket <= totalSupplyAtoms;
    target = {
      requested_reward_atoms: targetAtoms.toString(),
      requested_reward_lth_exact: math.formatAtomsCompact(targetAtoms) || '0',
      required_market_atoms: requiredMarket.toString(),
      required_market_lth_display_12: math.formatAtomsDisplay12(requiredMarket),
      required_market_irr_equivalent: math.atomsToIrrExact(requiredMarket, priceIrr),
      market_share_of_supply_percent: totalSupplyAtoms > 0n
        ? Number((requiredMarket * 10000n) / totalSupplyAtoms) / 100
        : 0,
      achievable_within_supply: achievable,
      note: achievable
        ? 'این مقدار پاداش با عرضهٔ فعلی پروتکل قابل تولید است.'
        : 'برای این مقدار پاداش، بازار بزرگ‌تر از کل عرضهٔ پروتکل لازم است.'
    };
  }

  const taxBps = Number(getSetting('lth_protocol_tax_bps', '1000'));
  const liveReward = marketScenarios[0];
  const liveFeeOnReward = protocol.splitFeeTax(BigInt(liveReward.total_reward_atoms), taxBps);

  return {
    generated_at: nowIso(),
    formula: {
      reward_atoms: '(market_atoms × reward_per_min_unit_atoms) ÷ 10^8',
      split: '(total × stake_bps) ÷ 10000  ⇒  withdrawable = total − staked',
      back_solve: '(target_reward_atoms × 10^8) ÷ reward_per_min_unit_atoms',
      tax: '(fee_atoms × tax_bps) ÷ 10000',
      note: 'همهٔ محاسبات با BigInt و بدون خطای ممیز شناور انجام می‌شود.'
    },
    unit_price_irr: priceIrr.toString(),
    reward_per_min_unit_atoms: rate,
    reward_per_min_unit_lth: math.formatAtomsCompact(rate),
    reward_interval_sec: settings.reward_interval_sec,
    protocol_tax_bps: taxBps,
    protocol_tax_percent: taxBps / 100,
    supply: {
      total_supply_atoms: totalSupplyAtoms.toString(),
      total_supply_lth_display_12: math.formatAtomsDisplay12(totalSupplyAtoms),
      total_supply_lth_headline: formatTreasuryHeadlineLth(totalSupplyAtoms)
    },
    market: {
      wallet_count: walletCount,
      market_atoms: marketAtoms.toString(),
      market_lth_display_12: math.formatAtomsDisplay12(marketAtoms),
      market_lth_headline: formatTreasuryHeadlineLth(marketAtoms),
      market_irr_equivalent: math.atomsToIrrExact(marketAtoms, priceIrr),
      base_atoms: baseSum.toString(),
      base_lth_display_12: math.formatAtomsDisplay12(baseSum),
      staked_atoms: stakedSum.toString(),
      staked_lth_display_12: math.formatAtomsDisplay12(stakedSum),
      withdrawable_atoms: withdrawableSum.toString(),
      withdrawable_lth_display_12: math.formatAtomsDisplay12(withdrawableSum),
      reserved_atoms: reservedSum.toString(),
      reserved_lth_display_12: math.formatAtomsDisplay12(reservedSum),
      share_of_supply_percent: totalSupplyAtoms > 0n
        ? Number((marketAtoms * 10000n) / totalSupplyAtoms) / 100
        : 0
    },
    live_market_reward: liveReward,
    scenarios: {
      live_market: marketScenarios,
      full_supply: supplyScenarios
    },
    // Engineering column: what the live reward is worth, and what tax it carries.
    reward_value: {
      reward_atoms: liveReward.total_reward_atoms,
      reward_irr_exact: liveReward.total_reward_irr_exact,
      reward_tax_atoms: liveFeeOnReward.taxAtoms.toString(),
      reward_tax_lth_display_12: math.formatAtomsDisplay12(liveFeeOnReward.taxAtoms),
      reward_tax_irr_exact: math.atomsToIrrExact(liveFeeOnReward.taxAtoms, priceIrr),
      reward_net_of_tax_atoms: liveFeeOnReward.netFeeAtoms.toString(),
      reward_net_of_tax_lth_display_12: math.formatAtomsDisplay12(liveFeeOnReward.netFeeAtoms),
      reward_net_of_tax_irr_exact: math.atomsToIrrExact(liveFeeOnReward.netFeeAtoms, priceIrr)
    },
    target_engineering: target,
    projection_days: 30
  };
}

/**
 * Records that accrued tax was actually paid to the authority.
 * Staff-only, audited, and refused when there is nothing to settle — the
 * liability must never be reduced below what was really paid.
 */
function settleProtocolTax(adminUser, input) {
  if (!['admin', 'finance'].includes(adminUser.role)) throw ApiError.forbidden();
  const data = validate(input)
    .string('lth_amount', { min: 1, max: 40 })
    .string('reference', { min: 3, max: 120 })
    .string('reason', { min: 3, max: 300 })
    .done();

  let atoms = 0n;
  try {
    atoms = math.parseLthToAtoms(data.lth_amount, { allowZero: false });
  } catch (err) {
    throw ApiError.validation(err.message, [{ field: 'lth_amount', message: err.message }]);
  }

  return tx(() => {
    const { taxAccruedAtoms, taxSettledAtoms } = sumTreasuryEventsByType();
    const outstanding = taxAccruedAtoms - taxSettledAtoms;
    if (outstanding <= 0n) {
      throw ApiError.invalidState('ماندهٔ مالیاتی برای تسویه وجود ندارد؛ ابتدا باید کارمزدی وصول شود.');
    }
    if (atoms > outstanding) {
      throw ApiError.invalidState(
        `مبلغ تسویه از ماندهٔ مالیات (${math.formatAtomsDisplay12(outstanding)} LTH) بیشتر است.`
      );
    }

    const now = nowIso();
    const id = uuid();
    run(
      `INSERT INTO lth_treasury_ledger (id, event_type, atoms, user_id, ref_type, ref_id, note, created_at)
       VALUES (?, 'tax_settled', ?, ?, 'tax_settlement', ?, ?, ?)`,
      [id, atoms.toString(), adminUser.id, id, `تسویه مالیات — مرجع ${data.reference} — ${data.reason}`, now]
    );
    audit(adminUser.id, adminUser.role, 'lth.tax.settle', 'tax_settlement', id, {
      lth_exact: math.formatAtomsCompact(atoms) || '0',
      reference: data.reference,
      reason: data.reason,
      outstanding_before: math.formatAtomsCompact(outstanding) || '0',
      outstanding_after: math.formatAtomsCompact(outstanding - atoms) || '0'
    });

    return {
      settlement: {
        id,
        lth_exact: math.formatAtomsCompact(atoms) || '0',
        lth_display_12: math.formatAtomsDisplay12(atoms),
        reference: data.reference,
        settled_at: now
      },
      tax: {
        accrued_atoms: taxAccruedAtoms.toString(),
        settled_atoms: (taxSettledAtoms + atoms).toString(),
        outstanding_atoms: (outstanding - atoms).toString(),
        outstanding_lth_display_12: math.formatAtomsDisplay12(outstanding - atoms)
      },
      treasury: getTreasuryView()
    };
  });
}

/** Updates the protocol tax rate (bps) with an audit trail. */
function updateProtocolTax(adminUser, input) {
  if (adminUser.role !== 'admin') throw ApiError.forbidden();
  const data = validate(input)
    .string('reason', { min: 3, max: 300 })
    .done();
  const rawBps = input.tax_percent !== undefined ? Number(input.tax_percent) * 100 : Number(input.tax_bps);
  if (!Number.isFinite(rawBps) || !Number.isInteger(rawBps) || rawBps < 0 || rawBps > 10000) {
    throw ApiError.validation('درصد مالیات پروتکل باید بین ۰ تا ۱۰۰ باشد.', [
      { field: 'tax_percent', message: 'مقدار نامعتبر است.' }
    ]);
  }
  const now = nowIso();
  const before = getSetting('lth_protocol_tax_bps', '1000');
  tx(() => {
    run(
      "INSERT INTO settings (key, value) VALUES ('lth_protocol_tax_bps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(rawBps)]
    );
    audit(adminUser.id, adminUser.role, 'lth.tax.rate_update', 'settings', 'lth_protocol_tax_bps', {
      reason: data.reason,
      before_bps: Number(before),
      after_bps: rawBps
    });
  });
  return {
    protocol_tax_bps: rawBps,
    protocol_tax_percent: rawBps / 100,
    updated_at: now,
    treasury: getTreasuryView()
  };
}

module.exports = {
  SERVER_INSTANCE_ID,
  ensureDefaultLogo,
  getSettingsRow,
  getTreasuryConfigRow,
  getTreasuryView,
  getMarketRewardProjection,
  settleProtocolTax,
  updateProtocolTax,
  getPublicConfig,
  calculateEndpoint,
  ensureWalletInTx,
  settleDueRewards,
  reconcileLedger,
  getWalletView,
  createPurchase,
  handlePaymentOutcomeInTx,
  createShebaWithdrawalOrSell,
  cancelOwnWithdrawal,
  listStaffWithdrawals,
  reviewWithdrawal,
  createAccountTransfer,
  updateSettings,
  updateTreasurySettings,
  updateLogo,
  getClusterSchedulerStatus,
  searchProtocol,
  inspectUserProtocol
};
