import type { Address, Hex, PublicClient } from "viem";

import type { CoreRefusal } from "./errors.js";
import type { SignedGive, SignedShake } from "./types.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-chain` writes the bodies in wave 2.

/** One call, the same bytes for wagmi, EIP-5792 batches, exit.html and cast. */
export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
}

/** What it takes to set up a smart account that is not deployed yet (ERC-6492). */
export interface AccountSetup {
  forwarder: Address;
  factory: Address;
  factoryData: Hex;
}

/** The terms of `raise`. The reward may be zero. */
export interface RaiseTerms {
  token: Address;
  reward: bigint;
  expiry: number;
  rootKey: Address;
  payoutGasK: number;
  minClaimBps: number;
  dataHash: Hex;
}

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

export function approveCall(_token: Address, _spender: Address, _amount: bigint): Call {
  return notBuilt("approveCall");
}

export function raiseCall(_core: Address, _terms: RaiseTerms): Call {
  return notBuilt("raiseCall");
}

export function fundCall(_core: Address, _handId: bigint, _amount: bigint): Call {
  return notBuilt("fundCall");
}

export function extendCall(_core: Address, _handId: bigint, _expiry: number): Call {
  return notBuilt("extendCall");
}

/** Always writes the inner signature of a 6492-wrapped Give (viem's parser). */
export function thankCall(
  _core: Address,
  _handId: bigint,
  _signedShakes: readonly SignedShake[],
  _signedGive: SignedGive,
  _dataHash?: Hex,
): Call {
  return notBuilt("thankCall");
}

export function refundCall(_core: Address, _handId: bigint): Call {
  return notBuilt("refundCall");
}

export function withdrawCall(_core: Address, _token: Address, _payee: Address, _to: Address): Call {
  return notBuilt("withdrawCall");
}

/** forwarder.aggregate3([{ factory, factoryData }]): never a call in the sender's own name. */
export function setupCall(_setup: AccountSetup): Call {
  return notBuilt("setupCall");
}

/** "cast send <to> <data> --rpc-url $RPC" */
export function castLine(_call: Call, _opts?: { rpc?: string; from?: string }): string {
  return notBuilt("castLine");
}

export function simulate(
  _client: PublicClient,
  _call: Call,
  _from: Address,
): Promise<{ ok: true; gas: bigint } | { ok: false; refusal: CoreRefusal }> {
  return notBuilt("simulate");
}
