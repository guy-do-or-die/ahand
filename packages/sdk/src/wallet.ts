import type { Address, Hex, PublicClient } from "viem";

import type { GiveSigner } from "./sign.js";
import type { Eip712Domain, Give, Hand } from "./types.js";
import type { AskSignerCode } from "./verify.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-words` writes the bodies in wave 2.

/** A plain key, an EIP-7702 delegated key (code starts 0xef0100), or a contract. */
export type WalletKind = "key" | "delegated" | "code";

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

export function walletKind(_client: PublicClient, _address: Address): Promise<WalletKind> {
  return notBuilt("walletKind");
}

export function isErc6492(_signature: Hex): boolean {
  return notBuilt("isErc6492");
}

/** viem's parser: the factory, its data and the inner signature; undefined for a plain signature. */
export function unwrap6492(_signature: Hex): { factory: Address; factoryData: Hex; signature: Hex } | undefined {
  return notBuilt("unwrap6492");
}

/** viem's verifyHash: ERC-1271 for a deployed account, ERC-6492 for one that is not. */
export function askSigner(_client: PublicClient): AskSignerCode {
  return notBuilt("askSigner");
}

/** Core's 65-byte form for a key or a delegated account; a contract's answer as it came. */
export function signGive(_signer: GiveSigner, _kind: WalletKind, _domain: Eip712Domain, _hand: Hand, _give: Give): Promise<Hex> {
  return notBuilt("signGive");
}
