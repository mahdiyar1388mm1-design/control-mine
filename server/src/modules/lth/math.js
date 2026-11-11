'use strict';

/**
 * CENTRAL MINE — Exact Fixed-Point BigInt Math Engine for LOTH COIN (LTH) & IRR.
 *
 * Rules & Precision:
 * - Zero IEEE-754 floating-point math anywhere in token or currency calculations.
 * - Legal token display unit: 1.00 LTH = 100,000,000 sub-units (0.00000001 LTH = 10^-8).
 * - Internal atomic precision: 1 LTH = 10^16 atoms (supports exact micro-calculations
 *   such as 0.000000000001 LTH = 0.00484 IRR and 0.00000001 LTH -> 0.000000000034 LTH
 *   with any 0–100% regulator split without rounding drift).
 */

const ATOM_DECIMALS = 16;
const ONE_LTH_ATOMS = 10n ** 16n; // 10,000,000,000,000,000n
const MIN_TOKEN_UNIT_ATOMS = 10n ** 8n; // 0.00000001 LTH in atoms
const IRR_PARSE_DECIMALS = 8;
const IRR_PARSE_SCALE = 10n ** 8n;

function normalizeNumericString(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  // Convert Persian & Arabic-Indic digits to ASCII
  s = s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/[,٬_\s]/g, '');

  // Handle grouped dots like "4.840.000.000" (more than one dot, all trailing groups 3 digits)
  const parts = s.split('.');
  if (parts.length > 2 && parts.slice(1).every((p) => /^\d{3}$/.test(p))) {
    s = parts.join('');
  }
  return s;
}

function parseDecimalToScaledBigInt(raw, scaleDecimals, { allowZero = true, maxWholeDigits = 20 } = {}) {
  const s = normalizeNumericString(raw);
  if (!s || !/^\d+(\.\d+)?$/.test(s)) {
    throw new Error('مقدار عددی نامعتبر است.');
  }
  const [wholePart, fracPart = ''] = s.split('.');
  const cleanWhole = wholePart.replace(/^0+(?=\d)/, '');
  if (cleanWhole.length > maxWholeDigits) {
    throw new Error('مقدار واردشده خارج از محدودهٔ مجاز است.');
  }
  if (fracPart.length > scaleDecimals) {
    throw new Error(`حداکثر ${scaleDecimals} رقم اعشار مجاز است.`);
  }
  const paddedFrac = fracPart.padEnd(scaleDecimals, '0');
  const combined = BigInt(cleanWhole) * (10n ** BigInt(scaleDecimals)) + BigInt(paddedFrac || '0');
  if (!allowZero && combined <= 0n) {
    throw new Error('مقدار باید بزرگ‌تر از صفر باشد.');
  }
  return combined;
}

function parseLthToAtoms(raw, opts = {}) {
  return parseDecimalToScaledBigInt(raw, ATOM_DECIMALS, opts);
}

function formatScaledBigInt(valueBigInt, scaleDecimals, { minDecimals = 0, maxDecimals = scaleDecimals, trimTrailingZeros = true } = {}) {
  const v = BigInt(valueBigInt);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const base = 10n ** BigInt(scaleDecimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(scaleDecimals, '0');

  if (maxDecimals < scaleDecimals) {
    frac = frac.slice(0, maxDecimals);
  }
  if (trimTrailingZeros) {
    while (frac.length > minDecimals && frac.endsWith('0')) {
      frac = frac.slice(0, -1);
    }
  } else if (frac.length < minDecimals) {
    frac = frac.padEnd(minDecimals, '0');
  }

  const sign = negative ? '-' : '';
  return frac.length > 0 ? `${sign}${whole.toString()}.${frac}` : `${sign}${whole.toString()}`;
}

/**
 * Standard 8-decimal LTH display (0.00000000) for wallet rows.
 */
function formatAtomsDisplay8(atoms) {
  return formatScaledBigInt(BigInt(atoms), ATOM_DECIMALS, {
    minDecimals: 8,
    maxDecimals: 8,
    trimTrailingZeros: false
  });
}

/**
 * Exact LTH string (at least 8 decimals, or up to 16 decimals if sub-10^-8 precision is non-zero).
 */
function formatAtomsExact(atoms, { minDecimals = 8 } = {}) {
  return formatScaledBigInt(BigInt(atoms), ATOM_DECIMALS, {
    minDecimals,
    maxDecimals: ATOM_DECIMALS,
    trimTrailingZeros: true
  });
}

/**
 * Compact exact LTH string (no forced trailing zeros, e.g. "0.0034" or "0.000000000034").
 */
function formatAtomsCompact(atoms) {
  return formatScaledBigInt(BigInt(atoms), ATOM_DECIMALS, {
    minDecimals: 0,
    maxDecimals: ATOM_DECIMALS,
    trimTrailingZeros: true
  });
}

/**
 * Exact IRR string for a given LTH atom count and 1 LTH IRR price.
 * e.g. atoms = 10_000n (0.000000000001 LTH), priceIrr = 4_840_000_000n -> "0.00484"
 */
function atomsToIrrExact(atoms, priceIrr) {
  const a = BigInt(atoms);
  const p = BigInt(priceIrr);
  const scaledProduct = a * p; // scaled by 10^16
  return formatScaledBigInt(scaledProduct, ATOM_DECIMALS, {
    minDecimals: 0,
    maxDecimals: 12,
    trimTrailingZeros: true
  });
}

/**
 * Nearest integer IRR (half-up at 10^-16 atom scale) so repeating fractions like 1/22 LTH
 * (= 220,000,000 / 4,840,000,000) map back to exact 220,000,000 IRR without a 1-rial truncation artifact.
 */
function atomsToIrrFloor(atoms, priceIrr) {
  const a = BigInt(atoms);
  if (a <= 0n) return 0n;
  return (a * BigInt(priceIrr) + (ONE_LTH_ATOMS / 2n)) / ONE_LTH_ATOMS;
}

/**
 * Exact Toman string (1 Toman = 10 IRR).
 */
function irrScaledProductToTomanExact(atoms, priceIrr) {
  const scaledProduct = BigInt(atoms) * BigInt(priceIrr); // 10^16 IRR
  // 1 Toman = 10 IRR => divide by 10^17
  return formatScaledBigInt(scaledProduct, ATOM_DECIMALS + 1, {
    minDecimals: 0,
    maxDecimals: 10,
    trimTrailingZeros: true
  });
}

/**
 * Convert IRR string (supports decimals like "0.00484" or integers like "2200000") to LTH atoms.
 */
function irrToAtoms(irrRaw, priceIrr) {
  const p = BigInt(priceIrr);
  if (p <= 0n) throw new Error('نرخ ریالی LTH نامعتبر است.');
  const irrScaled = parseDecimalToScaledBigInt(irrRaw, IRR_PARSE_DECIMALS, { allowZero: true, maxWholeDigits: 22 });
  // irrScaled is IRR * 10^8; we want LTH * 10^16 = (IRR * 10^16) / p = (irrScaled * 10^8) / p
  return (irrScaled * (10n ** BigInt(ATOM_DECIMALS - IRR_PARSE_DECIMALS))) / p;
}

/**
 * Daily (24h) reward calculation with exact conservation:
 * stakedAtoms + withdrawableAtoms === totalRewardAtoms
 */
function computeDailyRewardSplit(baseAtoms, rewardPerMinUnitAtoms, stakeBps) {
  const base = BigInt(baseAtoms);
  const rate = BigInt(rewardPerMinUnitAtoms);
  const bps = BigInt(stakeBps);
  if (base <= 0n || rate <= 0n) {
    return { totalRewardAtoms: 0n, stakedAtoms: 0n, withdrawableAtoms: 0n };
  }
  const totalRewardAtoms = (base * rate) / MIN_TOKEN_UNIT_ATOMS;
  const stakedAtoms = (totalRewardAtoms * bps) / 10000n;
  const withdrawableAtoms = totalRewardAtoms - stakedAtoms;
  return { totalRewardAtoms, stakedAtoms, withdrawableAtoms };
}

function addThousandSeparators(numStr) {
  const [whole, frac] = String(numStr).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined && frac !== '' ? `${withCommas}.${frac}` : withCommas;
}

/**
 * Full bidirectional calculation of all metrics ("محاسبه تمام موازین نسبت به عدد وارده").
 */
function calculateAllMetrics({ mode = 'lth', value = '1', settings }) {
  const priceIrr = BigInt(settings.price_irr);
  const rewardPerMinUnitAtoms = BigInt(settings.reward_per_min_unit_atoms);
  const stakeBps = Number(settings.stake_bps);
  const withdrawableBps = Number(settings.withdrawable_bps);

  let baseAtoms = 0n;
  let exactIrrStr = '0';

  if (mode === 'irr') {
    const irrScaled = parseDecimalToScaledBigInt(value, IRR_PARSE_DECIMALS, { allowZero: true, maxWholeDigits: 22 });
    exactIrrStr = formatScaledBigInt(irrScaled, IRR_PARSE_DECIMALS, { minDecimals: 0, maxDecimals: 8, trimTrailingZeros: true });
    baseAtoms = (irrScaled * (10n ** BigInt(ATOM_DECIMALS - IRR_PARSE_DECIMALS))) / priceIrr;
  } else {
    baseAtoms = parseLthToAtoms(value, { allowZero: true, maxWholeDigits: 12 });
    exactIrrStr = atomsToIrrExact(baseAtoms, priceIrr);
  }

  const daily = computeDailyRewardSplit(baseAtoms, rewardPerMinUnitAtoms, stakeBps);
  const totalAfter24hAtoms = baseAtoms + daily.totalRewardAtoms;
  const withdrawableAfter24hAtoms = baseAtoms + daily.withdrawableAtoms;

  // Reference benchmarks ("نشان سلامت و شاخص ۱.۰۰ LTH")
  const benchOneLth = computeDailyRewardSplit(ONE_LTH_ATOMS, rewardPerMinUnitAtoms, stakeBps);
  const picoLthAtoms = 10000n; // 0.000000000001 LTH (10^-12)

  return {
    mode,
    unit_price_irr: priceIrr.toString(),
    unit_price_irr_formatted: addThousandSeparators(priceIrr.toString()),
    unit_price_toman: (priceIrr / 10n).toString(),
    stake_percent: stakeBps / 100,
    withdrawable_percent: withdrawableBps / 100,
    lockup_days: settings.lockup_days,

    input_summary: {
      lth_atoms: baseAtoms.toString(),
      lth_display_8: formatAtomsDisplay8(baseAtoms),
      lth_exact: formatAtomsCompact(baseAtoms) || '0',
      irr_exact: exactIrrStr,
      irr_formatted: addThousandSeparators(exactIrrStr),
      toman_exact: irrScaledProductToTomanExact(baseAtoms, priceIrr)
    },

    metrics_24h: {
      total_reward_lth_exact: formatAtomsCompact(daily.totalRewardAtoms) || '0',
      total_reward_lth_display_8: formatAtomsDisplay8(daily.totalRewardAtoms),
      total_reward_irr_exact: atomsToIrrExact(daily.totalRewardAtoms, priceIrr),
      total_reward_toman_exact: irrScaledProductToTomanExact(daily.totalRewardAtoms, priceIrr),

      staked_reward_lth_exact: formatAtomsCompact(daily.stakedAtoms) || '0',
      staked_reward_lth_display_8: formatAtomsDisplay8(daily.stakedAtoms),
      staked_reward_irr_exact: atomsToIrrExact(daily.stakedAtoms, priceIrr),

      withdrawable_reward_lth_exact: formatAtomsCompact(daily.withdrawableAtoms) || '0',
      withdrawable_reward_lth_display_8: formatAtomsDisplay8(daily.withdrawableAtoms),
      withdrawable_reward_irr_exact: atomsToIrrExact(daily.withdrawableAtoms, priceIrr),

      total_lth_after_24h_exact: formatAtomsCompact(totalAfter24hAtoms) || '0',
      total_lth_after_24h_display_8: formatAtomsDisplay8(totalAfter24hAtoms),
      total_irr_after_24h_exact: atomsToIrrExact(totalAfter24hAtoms, priceIrr),

      total_withdrawable_lth_after_24h_exact: formatAtomsCompact(withdrawableAfter24hAtoms) || '0',
      total_withdrawable_lth_after_24h_display_8: formatAtomsDisplay8(withdrawableAfter24hAtoms),
      total_withdrawable_irr_after_24h_exact: atomsToIrrExact(withdrawableAfter24hAtoms, priceIrr)
    },

    benchmarks: {
      one_lth_24h_reward_lth: formatAtomsCompact(benchOneLth.totalRewardAtoms),
      one_lth_24h_reward_irr: atomsToIrrExact(benchOneLth.totalRewardAtoms, priceIrr),
      one_lth_24h_reward_toman: irrScaledProductToTomanExact(benchOneLth.totalRewardAtoms, priceIrr),
      one_lth_24h_staked_lth: formatAtomsCompact(benchOneLth.stakedAtoms),
      one_lth_24h_withdrawable_lth: formatAtomsCompact(benchOneLth.withdrawableAtoms),
      min_token_unit_lth: '0.00000001',
      min_token_unit_24h_reward_lth: formatAtomsCompact(rewardPerMinUnitAtoms),
      pico_unit_lth: '0.000000000001',
      pico_unit_irr: atomsToIrrExact(picoLthAtoms, priceIrr)
    }
  };
}

module.exports = {
  ATOM_DECIMALS,
  ONE_LTH_ATOMS,
  MIN_TOKEN_UNIT_ATOMS,
  normalizeNumericString,
  parseDecimalToScaledBigInt,
  parseLthToAtoms,
  formatScaledBigInt,
  formatAtomsDisplay8,
  formatAtomsExact,
  formatAtomsCompact,
  atomsToIrrExact,
  atomsToIrrFloor,
  irrScaledProductToTomanExact,
  irrToAtoms,
  computeDailyRewardSplit,
  addThousandSeparators,
  calculateAllMetrics
};
