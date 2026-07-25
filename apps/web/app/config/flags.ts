/**
 * Feature flags. The open-hands board needs public metadata replication
 * (IPFS) — until then the screen ships an honest empty state.
 */
export const FLAGS = {
  openHandsBoard: false,
} as const;
