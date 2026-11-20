import type { Address, Hex, PublicClient } from "viem";

import type { HandLog, HandView } from "./chain.js";
import type { SignedGive, SignedShake } from "./types.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-proof` writes the bodies in wave 3.

/** Facts of the build that served the page, when known. */
export interface BuildFacts {
  commit?: string;
  dirty?: boolean;
  /** sha256 of the build's files, from build.json. */
  buildHash?: Hex;
}

/** Everything the passport needs, collected once, so a saved record can be checked offline. */
export interface HandRecord {
  chainId: number;
  core: Address;
  handId: bigint;
  /** The block the views were read at. */
  block: bigint;
  view: HandView;
  thank?: { giveHash: Hex; dataHash: Hex };
  logs: HandLog[];
  /** The thank transaction's input, when found. */
  thankInput?: Hex;
  giveLink?: Uint8Array;
  build?: BuildFacts;
}

export type CheckSource =
  | { event: string; block: bigint; tx: Hex; logIndex: number }
  | { view: string; block: bigint }
  | "computed here";

export interface Check {
  id: string;
  sentence: string;
  formula?: string;
  inputs: Record<string, string>;
  expected: string;
  actual: string;
  ok: boolean | "not-checkable";
  source: CheckSource;
}

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

export function collect(
  _client: PublicClient,
  _core: Address,
  _handId: bigint,
  _extra?: { giveLink?: Uint8Array; build?: BuildFacts },
): Promise<HandRecord> {
  return notBuilt("collect");
}

export function passportOf(_record: HandRecord): Check[] {
  return notBuilt("passportOf");
}

export function exportBundle(_record: HandRecord): string {
  return notBuilt("exportBundle");
}

export function verifyBundle(_json: string): Check[] {
  return notBuilt("verifyBundle");
}

/** The `thank` selector at any offset of a transaction's input, accepted only if its Give hashes to `giveHash`. */
export function thankInputOf(
  _txInput: Hex,
  _handId: bigint,
  _giveHash: Hex,
): { signedShakes: SignedShake[]; signedGive: SignedGive } | undefined {
  return notBuilt("thankInputOf");
}
