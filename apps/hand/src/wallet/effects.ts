import { CORE_ABI, LOG_WINDOW } from "@ahand/sdk";
import { erc20Abi, getAbiItem, isAddressEqual, type AbiEvent, type Address, type Hex, type Log, type PublicClient } from "viem";

import type { Probe } from "../chain/finality";

/**
 * Each money action's own effect on the chain, looked for when its transaction's fate is not
 * known: the nonce was used by another transaction (a speed-up, a cancel), or the wallet's answer
 * was lost before the page learnt the hash (`fateOf` in chain/finality.ts). Each probe reads the
 * logs from the block the send was asked at, window by window, and returns the hash of the
 * transaction that carried the effect. These are reads only: nothing here sends.
 */

const coreEvent = (name: "Raised" | "Funded" | "Extended" | "Thanked" | "Refunded" | "Withdrawn") => getAbiItem({ abi: CORE_ABI, name }) as AbiEvent;
const APPROVAL = getAbiItem({ abi: erc20Abi, name: "Approval" }) as AbiEvent;

type Found = Log<bigint, number, false, AbiEvent, true>;

/** The logs of one event from `fromBlock` to the tip, in windows the RPCs accept. */
async function logsSince(client: PublicClient, address: Address, event: AbiEvent, args: Record<string, unknown> | undefined, fromBlock: bigint): Promise<Found[]> {
  const tip = await client.getBlockNumber({ cacheTime: 0 });
  const size = BigInt(LOG_WINDOW);
  const found: Found[] = [];
  for (let from = fromBlock; from <= tip; from += size) {
    const to = from + size - 1n < tip ? from + size - 1n : tip;
    const logs = (await client.getLogs({ address, event, ...(args ? { args } : {}), fromBlock: from, toBlock: to, strict: true } as never)) as unknown as Found[];
    found.push(...logs);
  }
  return found;
}

const argsOf = (log: Found) => (log as unknown as { args: Record<string, unknown> }).args;

/** A `Raised` by this raiser with this root key and description. */
export function raisedProbe(core: Address, terms: { rootKey: Address; dataHash: Hex }): Probe {
  return async (client, { fromBlock, from }) => {
    const logs = await logsSince(client, core, coreEvent("Raised"), { raiser: from }, fromBlock);
    return logs.find((log) => {
      const args = argsOf(log);
      return isAddressEqual(args.rootKey as Address, terms.rootKey) && String(args.dataHash).toLowerCase() === terms.dataHash.toLowerCase();
    })?.transactionHash;
  };
}

/** A `Funded` for this Hand (of this amount, when it is known). Only its raiser can fund it. */
export function fundedProbe(core: Address, handId: bigint, amount?: bigint): Probe {
  return async (client, { fromBlock }) => {
    const logs = await logsSince(client, core, coreEvent("Funded"), { handId }, fromBlock);
    return logs.find((log) => amount === undefined || argsOf(log).amount === amount)?.transactionHash;
  };
}

/** An `Extended` for this Hand (to this expiry, when it is known). Only its raiser can extend it. */
export function extendedProbe(core: Address, handId: bigint, expiry?: number): Probe {
  return async (client, { fromBlock }) => {
    const logs = await logsSince(client, core, coreEvent("Extended"), { handId }, fromBlock);
    return logs.find((log) => expiry === undefined || Number(argsOf(log).expiry) === expiry)?.transactionHash;
  };
}

/** A `Withdrawn` of this token for this payee: whoever sent it, the money left Core for the payee. */
export function withdrawnProbe(core: Address, token: Address, payee: Address): Probe {
  return async (client, { fromBlock }) => (await logsSince(client, core, coreEvent("Withdrawn"), { token, payee }, fromBlock))[0]?.transactionHash;
}

/** A `Refunded` for this Hand: it closes once, whoever sent it. */
export function refundedProbe(core: Address, handId: bigint): Probe {
  return async (client, { fromBlock }) => (await logsSince(client, core, coreEvent("Refunded"), { handId }, fromBlock))[0]?.transactionHash;
}

/** A `Thanked` for this Hand: only its raiser can thank it, and it closes once. */
export function thankedProbe(core: Address, handId: bigint): Probe {
  return async (client, { fromBlock }) => (await logsSince(client, core, coreEvent("Thanked"), { handId }, fromBlock))[0]?.transactionHash;
}

/** An `Approval` by this account for this spender: the permission step of a raise or a fund. */
export function approvalProbe(token: Address, spender: Address): Probe {
  return async (client, { fromBlock, from }) => (await logsSince(client, token, APPROVAL, { owner: from, spender }, fromBlock))[0]?.transactionHash;
}
