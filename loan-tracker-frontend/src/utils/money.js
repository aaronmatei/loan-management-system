// Money formatting for the LenderFest staff app.
//
// Pilot scope: introduced for the Dashboard + Loans UX pilot so every KES
// figure on those two surfaces formats the same way instead of each call
// site hand-rolling `KES ${x.toLocaleString()}` with inconsistent decimals.
// Pure presentation helpers — no rounding that changes a stored value, no
// network/DB access. Safe to adopt app-wide later.
//
// Policy: KES is displayed as whole shillings (0 decimals) for at-a-glance
// reading; the exact, fully-grouped value (up to 2 dp) is available via
// `exactKES` for tooltips/`title` attributes so precision is never lost.

const toNumber = (value) => {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Full KES amount, grouped, whole shillings by default.
 *   formatKES(176550)      → "KES 176,550"
 *   formatKES(1234.5, 2)   → "KES 1,234.50"
 */
export function formatKES(value, decimals = 0) {
  const n = toNumber(value);
  return `KES ${n.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Compact KES for cards/KPIs where space is tight. One decimal on the
 * scaled unit; pair with `exactKES(value)` in a `title`/tooltip so the
 * precise figure is one hover away.
 *   abbreviateKES(176550)   → "KES 176.6K"
 *   abbreviateKES(2_400_000)→ "KES 2.4M"
 *   abbreviateKES(950)      → "KES 950"
 *   abbreviateKES(-1500)    → "KES -1.5K"
 */
export function abbreviateKES(value) {
  const n = toNumber(value);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `KES ${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `KES ${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `KES ${sign}${trim(abs / 1e3)}K`;
  return `KES ${sign}${abs.toLocaleString("en-KE")}`;
}

// One decimal, but drop a trailing ".0" so "KES 2M" reads cleaner than
// "KES 2.0M".
function trim(n) {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Exact, fully-grouped value for tooltips — never abbreviated. Keeps up to
 * 2 dp so fractional figures (interest, fines) stay precise on hover.
 *   exactKES(176550.5) → "KES 176,550.50"
 */
export function exactKES(value) {
  const n = toNumber(value);
  return `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}
