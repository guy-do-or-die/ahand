import { CORE_ABI, readLogWindows } from "@ahand/sdk";
import { erc20Abi, getAbiItem, isAddressEqual, type AbiEvent, type Address, type Hex, type Log, type PublicClient } from "viem";

import type { Probe } from "../chain/finality";

/**
 * Each money action's own effect on the chain, looked for when its transaction's fate is not
 * known: the nonce was used by another transaction (a speed-up, a cancel), or the wallet's answer
 * was lost before the page learnt the hash (`fateOf` in chain/finality.ts). Each probe reads the
 * logs from the block the send was asked at, window by window, and returns the hash of the
 * transaction that carried the effect. The windows are the SDK's (`readLogWindows`): they start
 * at the client's window (the chain's `logWindow`, else 2 000 blocks) and shrink when a node
 * refuses one for its range, so a send more than 200 blocks (40 s) old is still found on Base
 * Sepolia's public RPC. A probe remembers how far it has read for a send, so asking it again
 * (every tick, or after a failure partway through) goes on from there rather than from the send's
 * block. These are reads only: nothing here sends.
 */

const coreEvent = (name: "Raised" | "Funded" | "Extended" | "Thanked" | "Refunded" | "Withdrawn") => getAbiItem({ abi: CORE_ABI, name }) as AbiEvent;
const APPROVAL = getAbiItem({ abi: erc20Abi, name: "Approval" }) as AbiEvent;

type Found = Log<bigint, number, false, AbiEvent, true>;

/**
 * Blocks a probe reads again below where it stopped: near the tip they could still be replaced
 * (a reorg), so its memory never skips them. 64 blocks is about 13 s on Base, 64 s on the stand.
 */
export const PROBE_REREAD = 64n;

/** Thrown out of a read once the effect is found, so the rest of the range is not read. */
const FOUND = Symbol("found");

/**
 * A probe of one event: reads its logs from the send's block to the tip and returns the first
 * transaction whose log `matches`. It keeps, for the send it was last asked about (its block and
 * sender), the block it has read up to with nothing found, less `PROBE_REREAD`, and the next call
 * for the same send starts there. A window that fails leaves the memory at the last window read.
 */
function probeOf(address: Address, event: AbiEvent, argsFor: (from: Address) => Record<string, unknown> | undefined, matches: (log: Found) => boolean = () => true): Probe {
  let sent: string | undefined;
  let next = 0n;
  return async (client: PublicClient, { fromBlock, from }) => {
    const key = `${fromBlock}:${from.toLowerCase()}`;
    if (sent !== key) {
      sent = key;
      next = fromBlock;
    }
    const toBlock = await client.getBlockNumber({ cacheTime: 0 });
    const args = argsFor(from);
    let hit: Hex | undefined;
    try {
      await readLogWindows(client, { fromBlock: next, toBlock }, async (start, end) => {
        const logs = (await client.getLogs({ address, event, ...(args ? { args } : {}), fromBlock: start, toBlock: end, strict: true } as never)) as unknown as Found[];
        hit = logs.find(matches)?.transactionHash;
        if (hit) throw FOUND;
        if (end - PROBE_REREAD + 1n > next) next = end - PROBE_REREAD + 1n;
        return [];
      });
    } catch (error) {
      if (error !== FOUND) throw error;
    }
    return hit;
  };
}

const argsOf = (log: Found) => (log as unknown as { args: Record<string, unknown> }).args;

/** A `Raised` by this raiser with this root key and description. */
export function raisedProbe(core: Address, terms: { rootKey: Address; dataHash: Hex }): Probe {
  return probeOf(core, coreEvent("Raised"), (from) => ({ raiser: from }), (log) => {
    const args = argsOf(log);
    return isAddressEqual(args.rootKey as Address, terms.rootKey) && String(args.dataHash).toLowerCase() === terms.dataHash.toLowerCase();
  });
}

/** A `Funded` for this Hand (of this amount, when it is known). Only its raiser can fund it. */
export function fundedProbe(core: Address, handId: bigint, amount?: bigint): Probe {
  return probeOf(core, coreEvent("Funded"), () => ({ handId }), (log) => amount === undefined || argsOf(log).amount === amount);
}

/** An `Extended` for this Hand (to this expiry, when it is known). Only its raiser can extend it. */
export function extendedProbe(core: Address, handId: bigint, expiry?: number): Probe {
  return probeOf(core, coreEvent("Extended"), () => ({ handId }), (log) => expiry === undefined || Number(argsOf(log).expiry) === expiry);
}

/** A `Withdrawn` of this token for this payee: whoever sent it, the money left Core for the payee. */
export function withdrawnProbe(core: Address, token: Address, payee: Address): Probe {
  return probeOf(core, coreEvent("Withdrawn"), () => ({ token, payee }));
}

/** A `Refunded` for this Hand: it closes once, whoever sent it. */
export function refundedProbe(core: Address, handId: bigint): Probe {
  return probeOf(core, coreEvent("Refunded"), () => ({ handId }));
}

/** A `Thanked` for this Hand: only its raiser can thank it, and it closes once. */
export function thankedProbe(core: Address, handId: bigint): Probe {
  return probeOf(core, coreEvent("Thanked"), () => ({ handId }));
}

/** An `Approval` by this account for this spender: the permission step of a raise or a fund. */
export function approvalProbe(token: Address, spender: Address): Probe {
  return probeOf(token, APPROVAL, (from) => ({ owner: from, spender }));
}
