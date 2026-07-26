/**
 * Feature flags. The open-hands board reads public discovery docs off
 * IPFS (pinned via /api/pin, verified against the on-chain commitment).
 */
export const FLAGS = {
  openHandsBoard: true,
  /** Direct give delivery over XMTP (reachability-gated, copy-link fallback). */
  xmtpDelivery: true,
} as const;
