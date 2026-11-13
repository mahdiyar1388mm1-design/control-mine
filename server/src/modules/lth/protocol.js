'use strict';

/**
 * Protocol accounting helpers for the LTH treasury.
 *
 * Three ideas live here, all of them BigInt-exact:
 *
 * 1. **Base flow** — the 6th treasury row the operator asked for:
 *    «میزان پایه» = base LTH that moved from the treasury into the market
 *    (issued, net of what came back). Market + asset must still equal supply.
 *
 * 2. **Tax on fees** — every collected fee carries a protocol tax liability
 *    (`tax_bps`). Unsettled tax is always derivable and never guessed.
 *
 * 3. **Market reward projection** — «میزان کل پاداش بازار» for any stake /
 *    withdrawable split, plus the engineered work-backwards table:
 *    given a target reward, how much market value (LTH and IRR) it implies,
 *    and how much of that is burned as tax.
 *
 * Rewards are linear in the base amount, so every aggregate below is computed
 * as `sum(base) * rate / 10^8 * bps / 10^4` with integer rounding at the end —
 * never by summing per-wallet rounded values, and never with floats.
 */

const math = require('./math');

const BPS_DENOMINATOR = 10000n;

function bpsOf(atoms, bps) {
  const value = typeof atoms === 'bigint' ? atoms : BigInt(atoms || 0);
  const rate = BigInt(bps || 0);
  if (value <= 0n || rate <= 0n) return 0n;
  return (value * rate) / BPS_DENOMINATOR;
}

/**
 * Total 24h reward for a base amount, split by the regulator.
 * Delegates to the same function the settlement engine uses, so a projection
 * can never drift from what is actually credited.
 */
function projectRewards(baseAtoms, { rewardPerMinUnitAtoms, stakeBps, withdrawableBps }) {
  const split = math.computeDailyRewardSplit(baseAtoms, rewardPerMinUnitAtoms, stakeBps);
  const total = split.totalRewardAtoms;
  const staked = bpsOf(total, stakeBps);
  // The withdrawable side is the remainder, so the two shares always add to 100%.
  const withdrawable = total - staked;
  return {
    total_atoms: total,
    staked_atoms: staked,
    withdrawable_atoms: withdrawable,
    stake_bps: Number(stakeBps),
    withdrawable_bps: Number(withdrawableBps)
  };
}

/**
 * Back-solves the market size that produces a given reward.
 * `market * rate / 1e8 = target`  ⇒  `market = target * 1e8 / rate`
 * (integer division, so the returned market always yields *at most* the target).
 */
function marketForReward(targetRewardAtoms, rewardPerMinUnitAtoms) {
  const target = BigInt(targetRewardAtoms || 0);
  const rate = BigInt(rewardPerMinUnitAtoms || 0);
  if (target <= 0n || rate <= 0n) return 0n;
  return (target * math.MIN_TOKEN_UNIT_ATOMS) / rate;
}

/** Tax split of a fee amount: `tax_bps` of the fee, remainder stays as net fee. */
function splitFeeTax(feeAtoms, taxBps) {
  const fee = BigInt(feeAtoms || 0);
  const tax = bpsOf(fee, taxBps);
  return { feeAtoms: fee, taxAtoms: tax, netFeeAtoms: fee - tax, taxBps: Number(taxBps || 0) };
}

/** Formats an atoms value for display, keeping the protocol's 8–12 decimals. */
function display(atoms) {
  return math.formatAtomsDisplay12(atoms);
}

function exact(atoms) {
  return math.formatAtomsCompact(atoms) || '0';
}

function irr(atoms, priceIrr) {
  return math.atomsToIrrExact(atoms, priceIrr);
}

/**
 * Builds «میزان پایه» — the base-flow row.
 *
 * @param {bigint} issuedAtoms  base LTH issued from treasury into the market
 * @param {bigint} returnedAtoms base LTH liquidated back into the treasury
 * @param {bigint} marketAtoms  current market (wallets) total
 */
/**
 * «میزان پایه» row: base LTH released by the treasury minus base returned to it.
 * It must reconcile against the *base* still held in wallets — not against the
 * whole circulating market, which also contains accrued rewards, reserved sums
 * and staked rewards that the treasury never issued as base.
 */
function baseFlowRow({ issuedAtoms, returnedAtoms, baseAtoms, marketAtoms, priceIrr }) {
  const issued = BigInt(issuedAtoms || 0);
  const returned = BigInt(returnedAtoms || 0);
  const net = issued - returned;
  // Kept for backwards compatibility with older callers that only pass market.
  const market = BigInt(baseAtoms !== undefined && baseAtoms !== null ? baseAtoms : (marketAtoms || 0));
  // A wallet that existed before issuance was tracked (legacy/demo data) still
  // holds base LTH with no `issue_base` row. That gap is reported as an explicit
  // opening balance instead of being silently folded into the issuance figure.
  const opening = market > net ? market - net : 0n;
  const surplus = net > market ? net - market : 0n;
  return {
    key: 'base_flow',
    label: 'میزان پایه',
    description: 'حجم پایهٔ LTH که از خزانه وارد بازار شده است (صدور منهای بازگشت به خزانه)',
    issued_atoms: issued.toString(),
    returned_atoms: returned.toString(),
    net_atoms: net.toString(),
    net_display_12: display(net),
    net_exact: exact(net),
    issued_display_12: display(issued),
    returned_display_12: display(returned),
    base_atoms: market.toString(),
    base_display_12: display(market),
    market_atoms: BigInt(marketAtoms || 0).toString(),
    irr_equivalent: irr(net, priceIrr),
    // Untracked base LTH already in wallets before issuance was recorded.
    opening_atoms: opening.toString(),
    opening_lth_display_12: display(opening),
    has_opening_balance: opening > 0n,
    // Issued more than the market holds: only possible if base was destroyed.
    unaccounted_atoms: surplus.toString(),
    matches_market: net === market,
    reconciles_with_opening: net + opening === market
  };
}

/**
 * Builds the full treasury row set, in the order the operator asked for:
 * asset, market, base, stake returns, base returns, fees, tax, net fee.
 */
function treasuryRows({
  assetAtoms, marketAtoms, baseAtoms, issuedAtoms, returnedAtoms, returnStakeAtoms,
  returnRewardAtoms, feeAtoms, taxAccruedAtoms, taxSettledAtoms, priceIrr
}) {
  const asset = BigInt(assetAtoms || 0);
  const market = BigInt(marketAtoms || 0);
  const walletBase = BigInt(baseAtoms !== undefined && baseAtoms !== null ? baseAtoms : market);
  const fee = BigInt(feeAtoms || 0);
  const taxAccrued = BigInt(taxAccruedAtoms || 0);
  const taxSettled = BigInt(taxSettledAtoms || 0);
  const taxOutstanding = taxAccrued - taxSettled;

  const row = (key, label, atoms, extra = {}) => ({
    key,
    label,
    atoms: BigInt(atoms || 0).toString(),
    display_12: display(atoms),
    exact: exact(atoms),
    irr_equivalent: irr(atoms, priceIrr),
    ...extra
  });

  return [
    row('asset', 'دارایی', asset, { description: 'باقی‌ماندهٔ عرضهٔ کل در خزانهٔ پروتکل' }),
    row('market', 'مقدار بازار', market, { description: 'مجموع LTH در کیف پول‌های کاربران' }),
    (() => {
      // The base row is the one that explains *why* asset and market moved.
      const issued = BigInt(issuedAtoms || 0);
      const returned = BigInt(returnedAtoms || 0);
      const net = issued - returned;
      return {
        key: 'base_flow',
        label: 'میزان پایه',
        atoms: net.toString(),
        net_atoms: net.toString(),
        display_12: display(net),
        exact: exact(net),
        irr_equivalent: irr(net, priceIrr),
        issued_atoms: issued.toString(),
        returned_atoms: returned.toString(),
        issued_display_12: display(issued),
        returned_display_12: display(returned),
        // A correct ledger always has net base flow + opening == wallet base.
        base_atoms: walletBase.toString(),
        base_display_12: display(walletBase),
        market_atoms: market.toString(),
        opening_atoms: (walletBase > net ? walletBase - net : 0n).toString(),
        matches_base: net === walletBase,
        reconciles_with_opening: (walletBase > net ? walletBase - net : 0n) + net === walletBase,
        description: 'حجم پایهٔ واردشده به بازار از خزانه (صدور منهای بازگشت پایه)'
      };
    })(),
    row('returned_stake', 'جمع بازگشت استیک', returnStakeAtoms, {
      description: 'استیک آزادشده پس از پایان قفل که به خزانه بازگشته است'
    }),
    row('returned_base', 'جمع بازگشت پایه', returnedAtoms, {
      description: 'حجم پایهٔ تسویه‌شده که به خزانه بازگشته است'
    }),
    row('returned_reward', 'جمع تسویهٔ پاداش', returnRewardAtoms, {
      description: 'پاداش قابل برداشت که در تسویه به خزانه بازگشته است'
    }),
    row('collected_fee', 'جمع کارمزد', fee, { description: 'کل کارمزد دریافتی پروتکل' }),
    row('tax_accrued', 'مالیات تعلق‌گرفته', taxAccrued, {
      description: 'سهم مالیات از کارمزدهای دریافتی (بدهی شناسایی‌شده)'
    }),
    row('tax_settled', 'مالیات پرداخت‌شده', taxSettled, {
      description: 'مالیات تسویه‌شده با مرجع مالیاتی'
    }),
    row('tax_outstanding', 'ماندهٔ مالیات', taxOutstanding < 0n ? 0n : taxOutstanding, {
      description: 'مالیات تعلق‌گرفته که هنوز پرداخت نشده است',
      warning: taxOutstanding < 0n ? 'مالیات پرداخت‌شده بیش از تعلق‌گرفته است' : null
    }),
    row('net_fee', 'کارمزد خالص', fee - taxAccrued, {
      description: 'کارمزد پس از کسر مالیات (درآمد خالص پروتکل)',
      warning: fee - taxAccrued < 0n ? 'مالیات از کارمزد بیشتر است' : null
    })
  ];
}

module.exports = {
  BPS_DENOMINATOR,
  bpsOf,
  projectRewards,
  marketForReward,
  splitFeeTax,
  baseFlowRow,
  treasuryRows
};
