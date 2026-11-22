import { acksNeeded } from "@ahand/deliver/relays";

/**
 * Whether an outbox entry read straight from storage still waits for acknowledgements, by the
 * outbox's own rule (@ahand/deliver `acksNeeded`, the same one `deliveryState` in flow.ts uses):
 * nothing acknowledged yet, or fewer than needed while a relay is left to try. main.tsx asks it at
 * app start to decide whether to open the outbox on any screen; this module imports nothing else,
 * so the first load carries no delivery code.
 */
export function stillDelivering(entry: { acks?: unknown; of?: unknown; nextTryMs?: unknown } | undefined): boolean {
  if (!entry) return false;
  const acks = Number(entry.acks);
  if (!(acks >= 1)) return true;
  return acks < acksNeeded(Number(entry.of) || 0) && entry.nextTryMs !== undefined;
}
