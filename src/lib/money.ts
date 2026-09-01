export function fmt(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

// Signed amounts read better with an explicit + on credits.
export function fmtDelta(cents: number, currency = "usd") {
  const s = fmt(Math.abs(cents), currency);
  if (cents === 0) return s;
  return cents > 0 ? `+${s}` : `-${s}`;
}
