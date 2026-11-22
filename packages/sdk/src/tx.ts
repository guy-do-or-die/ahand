import {
  encodeFunctionData,
  isErc6492Signature,
  parseAbi,
  parseErc6492Signature,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { decodeCoreError, type CoreRefusal } from "./errors.js";
import { thankCalldata } from "./gas.js";
import { toCoreSignature } from "./sign.js";
import type { SignedGive, SignedShake } from "./types.js";

/**
 * Every call that moves money or changes a Hand, as plain `{ to, data, value }`: the same bytes
 * go to a wallet through wagmi, into an EIP-5792 batch, into `exit.html` and into a `cast send`
 * line. Nothing here signs or sends.
 */

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

/**
 * The parts of AHandCore's ABI the SDK calls and reads, byte for byte as in AHandCore.sol.
 *
 * The SDK keeps its own copy of Core's ABI for now, here, in gas.ts (`thank` alone) and in
 * errors.ts (Core's errors); tests/tx.test.ts and tests/errors.test.ts compare them with the
 * contracts' build. They are to be taken from the ABI package once it is built from this Core.
 */
export const CORE_ABI = parseAbi([
  "struct Shake { address nextKey; address payee; uint16 claimBps; uint16 nextClaimBps; bytes32 dataHash; }",
  "struct SignedShake { Shake shake; bytes keySig; }",
  "struct Give { address signer; address payee; uint16 claimBps; bytes32 routeHash; bytes32 dataHash; }",
  "struct SignedGive { Give give; bytes keySig; bytes giverSig; }",
  "function raise(address token, uint256 reward, uint40 expiry, address rootKey, uint16 payoutGasK, uint16 minClaimBps, bytes32 dataHash) returns (uint256 handId)",
  "function extend(uint256 handId, uint40 newExpiry)",
  "function fund(uint256 handId, uint256 amount)",
  "function thank(uint256 handId, SignedShake[] signedShakes, SignedGive signedGive, bytes32 dataHash)",
  "function refund(uint256 handId)",
  "function withdraw(address token, address payee, address to)",
  "function checkRoute(uint256 handId, SignedShake[] signedShakes) view returns (address lastKey, uint16 claimBps, bytes32 routeHash)",
  "function checkGive(uint256 handId, SignedShake[] signedShakes, SignedGive signedGive) view returns (bytes32 giveHash)",
  "function hands(uint256 handId) view returns (address raiser, uint40 expiry, uint40 openedAt, uint40 closedAt, address token, uint16 payoutGasK, uint16 minClaimBps, uint256 reward, address rootKey, bytes32 dataHash)",
  "function thanks(uint256 handId) view returns (bytes32 giveHash, bytes32 dataHash)",
  "function pending(address token, address payee) view returns (uint256)",
  "function handsCount() view returns (uint256)",
  "function MAX_EXPIRY_PERIOD() view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "event Raised(uint256 indexed handId, address indexed raiser, address indexed token, uint256 reward, uint40 expiry, address rootKey, uint16 payoutGasK, uint16 minClaimBps, bytes32 dataHash)",
  "event Extended(uint256 indexed handId, uint40 expiry)",
  "event Funded(uint256 indexed handId, uint256 amount, uint256 reward)",
  "event Shaken(uint256 indexed handId, address indexed payee, uint256 position, uint256 margin, address nextKey, uint16 claimBps, uint16 nextClaimBps, bytes32 dataHash)",
  "event Given(uint256 indexed handId, address indexed signer, address indexed payee, uint256 amount, uint16 claimBps, bytes32 routeHash, bytes32 dataHash)",
  "event Thanked(uint256 indexed handId, address indexed token, uint256 reward, bytes32 dataHash)",
  "event Refunded(uint256 indexed handId, address indexed token, uint256 reward)",
  "event Paid(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount)",
  "event Pending(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount)",
  "event Withdrawn(address indexed token, address indexed payee, uint256 amount, address to)",
]);

const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** Multicall3's `aggregate3`: on real networks Multicall3 itself, on the stand a test contract with the same signature. */
export const FORWARDER_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) returns (Result[] returnData)",
]);

/** Lets Core take `amount` of `token` from the raiser: the step before `raise` or `fund`. Not needed for a reward of zero. */
export function approveCall(token: Address, spender: Address, amount: bigint): Call {
  return { to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }) };
}

/** Raises a Hand. A reward of zero is valid: Core then never touches the token. */
export function raiseCall(core: Address, terms: RaiseTerms): Call {
  const { token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash } = terms;
  if (reward < 0n) throw new RangeError("a reward is not negative");
  return {
    to: core,
    data: encodeFunctionData({
      abi: CORE_ABI,
      functionName: "raise",
      args: [token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash],
    }),
  };
}

/** Adds `amount` to an open Hand's reward. Only the raiser, only before expiry. */
export function fundCall(core: Address, handId: bigint, amount: bigint): Call {
  return { to: core, data: encodeFunctionData({ abi: CORE_ABI, functionName: "fund", args: [handId, amount] }) };
}

/** Moves an open Hand's expiry later. Only the raiser, only before the current expiry. */
export function extendCall(core: Address, handId: bigint, expiry: number): Call {
  return { to: core, data: encodeFunctionData({ abi: CORE_ABI, functionName: "extend", args: [handId, expiry] }) };
}

/**
 * The giver's signature as Core must receive it: an ERC-6492 wrapper (an account that is not
 * deployed yet) is opened with viem's parser and only the account's own signature is kept. Core
 * has no ERC-6492; the account must exist by the time `thank` runs (`setupCall` first).
 */
export function innerGiverSig(giverSig: Hex): Hex {
  return isErc6492Signature(giverSig) ? parseErc6492Signature(giverSig).signature : giverSig;
}

/**
 * A link key's signature in the one form Core takes (65 bytes, v 27 or 28, low s), when it is a
 * key's signature written another way (ERC-2098's 64 bytes, v 0 or 1, the higher s): the signer
 * stays the same. Bytes that are no key's signature in any form are returned as they came, so
 * that Core refuses them with its own error and position instead of the SDK guessing.
 */
export function keySigForCore(keySig: Hex): Hex {
  try {
    return toCoreSignature(keySig);
  } catch {
    return keySig;
  }
}

/**
 * The route and the Give exactly as Core must receive them: every link key's signature (each
 * Shake's and the Give's) in Core's 65-byte form, and the giver's signature unwrapped from
 * ERC-6492. The giver's own signature is otherwise left as it is: it may be a contract's, whose
 * bytes only its code may judge. What `thankCall` writes and what `checkGiveOnChain` asks are the
 * same bytes.
 */
export function forCore(
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
): { signedShakes: SignedShake[]; signedGive: SignedGive } {
  return {
    signedShakes: signedShakes.map(({ shake, keySig }) => ({ shake, keySig: keySigForCore(keySig) })),
    signedGive: { ...signedGive, keySig: keySigForCore(signedGive.keySig), giverSig: innerGiverSig(signedGive.giverSig) },
  };
}

/**
 * Thanks a Give. Always writes the inner signature of a 6492-wrapped Give (viem's parser) and
 * every link key's signature in Core's 65-byte form (`forCore`).
 */
export function thankCall(
  core: Address,
  handId: bigint,
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
  dataHash?: Hex,
): Call {
  const written = forCore(signedShakes, signedGive);
  return { to: core, data: thankCalldata(handId, written.signedShakes, written.signedGive, dataHash) };
}

/** Returns an expired Hand's whole reward to its raiser. Anyone may send it. */
export function refundCall(core: Address, handId: bigint): Call {
  return { to: core, data: encodeFunctionData({ abi: CORE_ABI, functionName: "refund", args: [handId] }) };
}

/** Sends what waits for `payee` in `token` to `to`. Anyone may send it to the payee; only the payee elsewhere. */
export function withdrawCall(core: Address, token: Address, payee: Address, to: Address): Call {
  return {
    to: core,
    data: encodeFunctionData({ abi: CORE_ABI, functionName: "withdraw", args: [token, payee, to] }),
  };
}

/**
 * forwarder.aggregate3([{ factory, factoryData }]): never a call in the sender's own name. The
 * wrapper names any "factory" and any calldata; sent from the raiser's account, "the token,
 * transfer to me" would spend the raiser's money. The forwarder holds nothing and has no
 * allowance, so the call can only act as a stranger. A failing setup fails the whole call.
 */
export function setupCall(setup: AccountSetup): Call {
  return {
    to: setup.forwarder,
    data: encodeFunctionData({
      abi: FORWARDER_ABI,
      functionName: "aggregate3",
      args: [[{ target: setup.factory, allowFailure: false, callData: setup.factoryData }]],
    }),
  };
}

const SHELL_SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/;

function shellWord(text: string): string {
  return SHELL_SAFE.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * "cast send <to> <data> --rpc-url $RPC": the same call for a terminal, with `--value` when it
 * carries ether and `--from` when a sender is named. How it signs (`--ledger`, `--account`,
 * `--private-key`) is left to the person who runs it.
 */
export function castLine(call: Call, opts: { rpc?: string; from?: string } = {}): string {
  const words = ["cast", "send", call.to, call.data];
  if (call.value !== undefined && call.value !== 0n) words.push("--value", call.value.toString());
  if (opts.from) words.push("--from", shellWord(opts.from));
  words.push("--rpc-url", opts.rpc === undefined ? "$RPC" : shellWord(opts.rpc));
  return words.join(" ");
}

/**
 * Asks the chain what the call would do if `from` sent it now: an `eth_call`, then an estimate of
 * its gas. A refusal by Core comes back decoded; anything else (a token's own error, a network
 * that cannot be reached) is thrown as viem threw it.
 */
export async function simulate(
  client: PublicClient,
  call: Call,
  from: Address,
): Promise<{ ok: true; gas: bigint } | { ok: false; refusal: CoreRefusal }> {
  const request = { account: from, to: call.to, data: call.data, ...(call.value ? { value: call.value } : {}) };
  try {
    await client.call(request);
    const gas = await client.estimateGas(request);
    return { ok: true, gas };
  } catch (error) {
    const refusal = decodeCoreError(error);
    if (refusal) return { ok: false, refusal };
    throw error;
  }
}
