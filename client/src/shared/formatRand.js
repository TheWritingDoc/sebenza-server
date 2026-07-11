/**
 * Format an amount in Rand for display: thousands separators, no decimals
 * for whole amounts, two decimals otherwise. formatRand(12500) → "R12,500",
 * formatRand(99.5) → "R99.50", formatRand(null) → "R0".
 *
 * Uses en-US grouping (comma thousands, dot decimals) — the style SA fintech
 * apps use; en-ZA's comma-as-decimal would render "R99,50".
 */
export default function formatRand(amount) {
  const n = Number(amount);
  if (!isFinite(n)) return 'R0';
  const opts = Number.isInteger(n)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return 'R' + n.toLocaleString('en-US', opts);
}
