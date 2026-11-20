/** Presentation-layer formatting helpers (no protocol logic). */

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** $148 for whole amounts, $148.50 otherwise. */
export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? usdWhole.format(amount) : usdCents.format(amount);
}

/** Always with cents: $105.00 (receipts). */
export function formatUsdCents(amount: number): string {
  return usdCents.format(amount);
}

/** Middle-ellipsis for links/addresses: keeps head and tail. */
export function truncateMiddle(value: string, head = 24, tail = 12): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Short 0x address form used where mocks show names: 0x71c7…976f */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** UTC yyyy-mm-dd — same shape the h.$id SSR loader renders. */
export function formatDateUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Short human date: Aug 9 / 9 Aug. Defaults to en-US when SSR. */
export function formatDateHuman(ms: number): string {
  const d = new Date(ms);
  const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(d);
}

