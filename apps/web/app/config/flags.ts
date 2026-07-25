/**
 * Feature flags. The open-hands board needs public metadata replication
 * (IPFS) — until then the screen ships an honest empty state.
 */
export const FLAGS = {
  openHandsBoard: false,
  /** Direct give delivery over XMTP (reachability-gated, copy-link fallback). */
  xmtpDelivery: true,
} as const;
