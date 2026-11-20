import type { Address, Hex, TypedDataDefinition } from "viem";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4, §5);
// the module `sdk-words` writes the bodies in wave 2.

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

/** The EIP-712 keys message: domain {name: "aHand keys", version: "1", chainId, verifyingContract: core}. */
export function keysTypedData(_chainId: number, _core: Address, _raiser: Address): TypedDataDefinition {
  return notBuilt("keysTypedData");
}

/** HKDF extract over the wallet's signature of the keys message. */
export function masterOf(_signature: Hex): Promise<Hex> {
  return notBuilt("masterOf");
}

/** The link seed of the raiser's Hand number `n` in `book`: 16 bytes. */
export function rootSeed(_master: Hex, _book: Hex, _n: number): Promise<Hex> {
  return notBuilt("rootSeed");
}

/** The inbox secret of the raiser's Hand number `n` in `book`: 32 bytes, another HKDF info. */
export function inboxSecret(_master: Hex, _book: Hex, _n: number): Promise<Hex> {
  return notBuilt("inboxSecret");
}

/** 8 random bytes, one per device and raiser. */
export function newBook(): Hex {
  return notBuilt("newBook");
}

/** The `n` whose root key is `rootKey`, searching 0 to `maxN`. */
export function matchRoot(_master: Hex, _book: Hex, _rootKey: Address, _maxN?: number): Promise<number | undefined> {
  return notBuilt("matchRoot");
}
