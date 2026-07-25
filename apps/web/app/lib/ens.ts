/** Pure identity-display helpers — resolution lives in hooks/useEnsIdentity. */
import { truncateAddress } from "./format";

/** Prefer a resolved primary name; fall back to a shortened address. */
export function displayIdentity(
  name: string | null | undefined,
  address: string | null | undefined,
): string {
  if (name) return name;
  if (address) return truncateAddress(address);
  return "";
}

/** Loose check: does the input look like an ENS name rather than an address? */
export function looksLikeEnsName(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("0x")) return false;
  return /^[a-z0-9-_]+(\.[a-z0-9-_]+)*\.[a-z]{2,}$/.test(v);
}
