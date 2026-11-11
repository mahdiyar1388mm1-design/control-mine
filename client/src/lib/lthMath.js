/**
 * Exact BigInt Fixed-Point Client Math for LOTH COIN (LTH) & IRR.
 * Mirrors server/src/modules/lth/math.js so bidirectional calculator inputs
 * never suffer from IEEE-754 floating-point drift (e.g. 0.000000000001 LTH === 0.00484 IRR).
 */

export const ATOM_DECIMALS = 16;
export const ONE_LTH_ATOMS = 10n ** 16n;
export const MIN_TOKEN_UNIT_ATOMS = 10n ** 8n; // 0.00000001 LTH
const IRR_PARSE_DECIMALS = 8;

export function normalizeNumericInput(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  s = s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/[,٬_\s]/g, '');

  const parts = s.split('.');
  if (parts.length > 2 && parts.slice(1).every((p) => /^\d{3}$/.test(p))) {
    s = parts.join('');
  }
  return s;
}

export function parseDecimalBigInt(raw, scaleDecimals) {
  const s = normalizeNumericInput(raw);
  if (!s) return 0n;
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const [wholePart, fracRaw = ''] = s.split('.');
  const cleanWhole = wholePart.replace(/^0+(?=\d)/, '') || '0';
  if (cleanWhole.length > 22) return null;
  const fracPart = fracRaw.slice(0, scaleDecimals).padEnd(scaleDecimals, '0');
  return BigInt(cleanWhole) * (10n ** BigInt(scaleDecimals)) + BigInt(fracPart || '0');
}

export function formatScaledBigInt(val, scaleDecimals, { minDecimals = 0, maxDecimals = scaleDecimals, trimTrailingZeros = true } = {}) {
  const v = BigInt(val);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(scaleDecimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(scaleDecimals, '0');
  if (maxDecimals < scaleDecimals) frac = frac.slice(0, maxDecimals);
  if (trimTrailingZeros) {
    while (frac.length > minDecimals && frac.endsWith('0')) {
      frac = frac.slice(0, -1);
    }
  } else if (frac.length < minDecimals) {
    frac = frac.padEnd(minDecimals, '0');
  }
  const sign = neg ? '-' : '';
  return frac.length > 0 ? `${sign}${whole.toString()}.${frac}` : `${sign}${whole.toString()}`;
}

export function addCommas(numStr) {
  if (numStr === null || numStr === undefined || numStr === '') return '0';
  const [w, f] = String(numStr).split('.');
  const formattedWhole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f !== undefined && f !== '' ? `${formattedWhole}.${f}` : formattedWhole;
}

export function formatDotGrouped(numStr) {
  if (numStr === null || numStr === undefined || numStr === '') return '0';
  const [w, f] = String(numStr).split('.');
  const formattedWhole = w.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return f !== undefined && f !== '' ? `${formattedWhole}.${f}` : formattedWhole;
}

export function computeLocalMetrics({ mode, rawValue, config }) {
  if (!config) return null;
  const priceIrr = BigInt(config.price_irr || '4840000000');
  const rewardRateAtoms = BigInt(config.reward_per_min_unit_atoms || '340000');
  const stakeBps = BigInt(config.stake_bps ?? 7000);

  let baseAtoms = 0n;
  let irrExact = '0';
  let lthExact = '0';

  if (mode === 'irr') {
    const irrScaled = parseDecimalBigInt(rawValue, IRR_PARSE_DECIMALS);
    if (irrScaled === null) return { valid: false };
    irrExact = formatScaledBigInt(irrScaled, IRR_PARSE_DECIMALS, { minDecimals: 0, maxDecimals: 8, trimTrailingZeros: true });
    baseAtoms = (irrScaled * (10n ** BigInt(ATOM_DECIMALS - IRR_PARSE_DECIMALS))) / priceIrr;
    lthExact = formatScaledBigInt(baseAtoms, ATOM_DECIMALS, { minDecimals: 0, maxDecimals: ATOM_DECIMALS, trimTrailingZeros: true });
  } else {
    const parsedAtoms = parseDecimalBigInt(rawValue, ATOM_DECIMALS);
    if (parsedAtoms === null) return { valid: false };
    baseAtoms = parsedAtoms;
    lthExact = formatScaledBigInt(baseAtoms, ATOM_DECIMALS, { minDecimals: 0, maxDecimals: ATOM_DECIMALS, trimTrailingZeros: true });
    irrExact = formatScaledBigInt(baseAtoms * priceIrr, ATOM_DECIMALS, { minDecimals: 0, maxDecimals: 12, trimTrailingZeros: true });
  }

  const totalRewardAtoms = (baseAtoms * rewardRateAtoms) / MIN_TOKEN_UNIT_ATOMS;
  const stakedAtoms = (totalRewardAtoms * stakeBps) / 10000n;
  const withdrawableAtoms = totalRewardAtoms - stakedAtoms;

  const totalAfter24hAtoms = baseAtoms + totalRewardAtoms;
  const withdrawableAfter24hAtoms = baseAtoms + withdrawableAtoms;

  const toIrrStr = (a) => formatScaledBigInt(BigInt(a) * priceIrr, ATOM_DECIMALS, { minDecimals: 0, maxDecimals: 12, trimTrailingZeros: true });
  const toTomanStr = (a) => formatScaledBigInt(BigInt(a) * priceIrr, ATOM_DECIMALS + 1, { minDecimals: 0, maxDecimals: 10, trimTrailingZeros: true });
  const toDisp8 = (a) => formatScaledBigInt(BigInt(a), ATOM_DECIMALS, { minDecimals: 8, maxDecimals: 8, trimTrailingZeros: false });
  const toExactLth = (a) => formatScaledBigInt(BigInt(a), ATOM_DECIMALS, { minDecimals: 0, maxDecimals: ATOM_DECIMALS, trimTrailingZeros: true });

  return {
    valid: true,
    baseAtoms,
    irrExact,
    irrCommas: addCommas(irrExact),
    tomanExact: toTomanStr(baseAtoms),
    tomanCommas: addCommas(toTomanStr(baseAtoms)),
    lthExact,
    lthDisplay8: toDisp8(baseAtoms),
    reward24h: {
      totalLthExact: toExactLth(totalRewardAtoms),
      totalLthDisplay8: toDisp8(totalRewardAtoms),
      totalIrrCommas: addCommas(toIrrStr(totalRewardAtoms)),
      totalTomanCommas: addCommas(toTomanStr(totalRewardAtoms)),

      stakedLthExact: toExactLth(stakedAtoms),
      stakedLthDisplay8: toDisp8(stakedAtoms),
      stakedIrrCommas: addCommas(toIrrStr(stakedAtoms)),

      withdrawableLthExact: toExactLth(withdrawableAtoms),
      withdrawableLthDisplay8: toDisp8(withdrawableAtoms),
      withdrawableIrrCommas: addCommas(toIrrStr(withdrawableAtoms)),

      after24hTotalLthExact: toExactLth(totalAfter24hAtoms),
      after24hTotalIrrCommas: addCommas(toIrrStr(totalAfter24hAtoms)),

      after24hWithdrawableLthExact: toExactLth(withdrawableAfter24hAtoms),
      after24hWithdrawableIrrCommas: addCommas(toIrrStr(withdrawableAfter24hAtoms))
    }
  };
}
