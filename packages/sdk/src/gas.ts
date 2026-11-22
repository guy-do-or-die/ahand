import { aHandCoreAbi } from "@ahand/abi";
import { encodeFunctionData, hexToBytes, zeroHash, type Hex } from "viem";

import type { Hand, SignedGive, SignedShake } from "./types.js";

/**
 * The gas a `thank` can need at worst, counted before the raiser sends it.
 *
 * Core bounds neither the length of a route nor what payees do with the gas of their payouts:
 * each payout may use the Hand's limit, `payoutGasK` thousand gas. So the raiser's application
 * counts the worst case itself, sends the thank with that much gas, and tells when a route has
 * grown past what one transaction can carry.
 *
 * The worst case: every payee burns its whole limit and its payout stays pending. Core then spends
 *
 *   base + shake * shakes + (limit * 64 / 63 + payout) * payouts [+ stating]
 *
 * and a transaction needs 21 000 and the gas of its calldata on top. `limit * 64 / 63` is what
 * must be left when a payout is called for the call to get its whole limit: sent with less gas, a
 * thank can still go through and hand a payee less than the Hand promised, leaving its payout
 * pending. Gas that is not used is not paid for.
 *
 * The four numbers are measured on Core itself (contracts/test/SdkGas.t.sol writes them to
 * contracts/test/fixtures/sdk-gas.json) under the gas prices of one set of network rules; other
 * rules are other numbers. A transaction never costs less than the floor price of its calldata
 * (EIP-7623); routes signed by keys stay far above it, a contract giver's signature of several
 * thousand bytes reaches it.
 */
export interface ThankGasRules {
  /**
   * A thank without Shakes, before its one payout; counted as the first thank on its Core, and
   * with a giver whose key signs for an account with an EIP-7702 delegation, the costlier of the
   * two ways a key signs.
   */
  base: number;
  /** Each Shake of the route. */
  shake: number;
  /** Around each payout that uses its whole limit and stays pending, beyond the limit itself. */
  payout: number;
  /** The raiser states something with the thank. */
  stating: number;
}

/** The rules of Prague (Ethereum and Base in 2026), as Core's own test measured them. */
export const THANK_GAS_PRAGUE: ThankGasRules = { base: 80_990, shake: 12_197, payout: 24_969, stating: 22_180 };

/** The gas one transaction may use (EIP-7825). */
export const TX_GAS_LIMIT = 16_777_216;
/** The largest transaction ordinary nodes accept, and the bytes of a signed transaction around its calldata. */
export const TX_BYTES_LIMIT = 131_072;
export const TX_ENVELOPE_BYTES = 256;

const TX_BASE_GAS = 21_000;
const ZERO_BYTE_GAS = 4;
const NONZERO_BYTE_GAS = 16;
/** The floor price of calldata is this many times its ordinary price (EIP-7623: 10 and 40 a byte). */
const FLOOR_TIMES = 2.5;
/** The calldata of a thank without Shakes, and what each Shake adds, when every signature is a key's. */
const DIRECT_THANK_BYTES = 644;
const SHAKE_BYTES = 352;
/** A key's signature in the calldata: 65 bytes, in whole words. */
const KEY_SIGNATURE_BYTES = 96;

/** The longest route one transaction can carry by its size alone: no longer route can ever be thanked. */
export const LONGEST_ROUTE = Math.floor((TX_BYTES_LIMIT - TX_ENVELOPE_BYTES - DIRECT_THANK_BYTES) / SHAKE_BYTES);

/** The calldata of `thank`; `dataHash` is what the raiser states with it, zero for nothing. */
export function thankCalldata(
  handId: bigint,
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
  dataHash: Hex = zeroHash,
): Hex {
  return encodeFunctionData({ abi: aHandCoreAbi, functionName: "thank", args: [handId, signedShakes, signedGive, dataHash] });
}

/** A Shake that keeps a margin is a payout, and so is the Give; a payout of zero costs less, which the count ignores. */
function payoutsOf(signedShakes: readonly SignedShake[]): number {
  return signedShakes.filter(({ shake }) => shake.nextClaimBps < shake.claimBps).length + 1;
}

/** What a payout needs to be handed its whole limit, and what is spent around it. */
function payoutGas(hand: Hand, rules: ThankGasRules): number {
  return Math.ceil((hand.payoutGasK * 1_000 * 64) / 63) + rules.payout;
}

/** The formula: what Core itself may spend on a thank with so many Shakes and payouts. */
function worstExecution(hand: Hand, rules: ThankGasRules, shakes: number, payouts: number, stating: boolean): number {
  return rules.base + rules.shake * shakes + payoutGas(hand, rules) * payouts + (stating ? rules.stating : 0);
}

export interface ThankGasOptions {
  /** What the raiser states with the thank; zero or left out for nothing. */
  dataHash?: Hex;
  /** The network's rules; Prague's if left out. */
  rules?: ThankGasRules;
  /**
   * For a giver that is a contract: the gas that checking its signature takes beyond a key's, its
   * code's answer and the carrying of a longer signature. Core asks the code without a limit, so
   * only the application can know this number, from a call to the chain.
   */
  giverCodeGas?: number;
}

export interface ThankGas {
  /** The gas to send the thank with: at worst all of it is used, and no payout gets less than its limit. */
  gasLimit: number;
  /** The part of it Core itself may spend. */
  execution: number;
  /** The size of the calldata. */
  calldataBytes: number;
  /** Whether one transaction can carry this thank: its gas and its size are within the network's limits. */
  fits: boolean;
}

/** The worst gas of thanking this Give along this route. */
export function worstThankGas(
  hand: Hand,
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
  options: ThankGasOptions = {},
): ThankGas {
  const rules = options.rules ?? THANK_GAS_PRAGUE;
  const dataHash = options.dataHash ?? zeroHash;

  let execution = worstExecution(hand, rules, signedShakes.length, payoutsOf(signedShakes), dataHash !== zeroHash);
  if (options.giverCodeGas) execution += Math.ceil((options.giverCodeGas * 64) / 63);

  const calldata = hexToBytes(thankCalldata(hand.handId, signedShakes, signedGive, dataHash));
  const zeros = calldata.reduce((count, byte) => (byte === 0 ? count + 1 : count), 0);
  const bytesGas = ZERO_BYTE_GAS * zeros + NONZERO_BYTE_GAS * (calldata.length - zeros);
  const gasLimit = TX_BASE_GAS + Math.max(bytesGas + execution, FLOOR_TIMES * bytesGas);

  return {
    gasLimit,
    execution,
    calldataBytes: calldata.length,
    fits: gasLimit <= TX_GAS_LIMIT && calldata.length + TX_ENVELOPE_BYTES <= TX_BYTES_LIMIT,
  };
}

/**
 * How many more times a route can be passed on and still be thanked in one transaction, counting
 * each further Shake at its worst: it keeps a margin, and its payee burns the payout's limit.
 * Every byte of the calldata is counted at its highest price, so the answer never promises a pass
 * that the worst gas would then refuse. The Give is counted as signed by a key, unless the
 * application names what a contract giver needs: the gas of its check and the size of its
 * signature. Zero when the route is already at the limit, or past it.
 */
export function passesLeft(
  hand: Hand,
  signedShakes: readonly SignedShake[],
  options: { rules?: ThankGasRules; giverCodeGas?: number; giverSigBytes?: number } = {},
): number {
  const rules = options.rules ?? THANK_GAS_PRAGUE;
  const giverSigBytes = Math.ceil((options.giverSigBytes ?? 65) / 32) * 32;
  const bytes = DIRECT_THANK_BYTES - KEY_SIGNATURE_BYTES + giverSigBytes + SHAKE_BYTES * signedShakes.length;
  const gas =
    TX_BASE_GAS +
    NONZERO_BYTE_GAS * bytes +
    worstExecution(hand, rules, signedShakes.length, payoutsOf(signedShakes), true) +
    Math.ceil(((options.giverCodeGas ?? 0) * 64) / 63);
  const perPass = NONZERO_BYTE_GAS * SHAKE_BYTES + rules.shake + payoutGas(hand, rules);

  const byGas = Math.floor((TX_GAS_LIMIT - gas) / perPass);
  const bySize = Math.floor((TX_BYTES_LIMIT - TX_ENVELOPE_BYTES - bytes) / SHAKE_BYTES);
  return Math.max(0, Math.min(byGas, bySize));
}
