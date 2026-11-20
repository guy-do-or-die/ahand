import type { Address } from "viem";
import { english, generateMnemonic, mnemonicToAccount, type HDAccount } from "viem/accounts";

/**
 * "Where the money lands" (UX-SPEC §8.6): what a person chose, and how a Give would then be
 * confirmed. The kit only describes the choice; the screen does the signing.
 *
 * - `account`: the connected account receives; for a Give it also confirms, on its own screen.
 * - `one-time`: a pasted address receives; for a Give the screen makes a one-time key, uses it
 *   once and drops it. `keep` says the person asked for that key as a file.
 * - `words`: a new address made from twelve words receives and, for a Give, confirms. The
 *   account object lives in memory only, for as long as the caller holds it.
 */
export type GiveSigning =
  | { kind: "account"; address: Address }
  | { kind: "one-time"; keep: boolean }
  | { kind: "words"; account: HDAccount };

export interface Landing {
  choice: "account" | "address" | "fresh";
  payee: Address;
  signing: GiveSigning;
  /** The payee is the asker's or the token's own address: allowed, and the person was asked. */
  flagged?: "raiser" | "token";
}

export interface FreshWords {
  words: string[];
  account: HDAccount;
}

/**
 * Twelve words from viem's English list (128 bits from the browser's own random source) and
 * the first address they open, at the path every crypto app uses. Nothing is stored anywhere.
 */
export function makeWords(): FreshWords {
  const mnemonic = generateMnemonic(english);
  return { words: mnemonic.split(" "), account: mnemonicToAccount(mnemonic) };
}
