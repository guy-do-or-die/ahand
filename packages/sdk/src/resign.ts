import type { Address, Hex } from "viem";

import type { Hand, SignedShake } from "./types.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-words` writes the bodies in wave 2.

/** A Give as the raiser's device has seen it: by Hand and route, never by signer (R-29). */
export interface SeenGive {
  handId: bigint;
  /** The route's keys from the root key on (`routeKeys`). */
  keys: Address[];
  /** The payee of each Shake, in route order (zero where a Shake kept nothing). */
  payees: Address[];
  signer: Address;
  payee: Address;
  giveHash: Hex;
}

/** A holder a later route left out. */
export interface DroppedHolder {
  position: number;
  key: Address;
  payee?: Address;
}

export type GiveVerdict = "first" | "same" | "branch" | "resigned";

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

/** The root key, then each Shake's next key. */
export function routeKeys(_hand: Hand, _signedShakes: readonly SignedShake[]): Address[] {
  return notBuilt("routeKeys");
}

export function judgeGive(_seen: SeenGive[], _incoming: SeenGive): { verdict: GiveVerdict; dropped: DroppedHolder[] } {
  return notBuilt("judgeGive");
}
