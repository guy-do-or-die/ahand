import type { Address, PublicClient } from "viem";

import { isNetworkError } from "./errors";

/**
 * Is Core on this network at all? A build names its Core by address before that address holds
 * anything (the address is derived: create2(factory, salt, initcodeHash), ARCHITECTURE §3), so a
 * public build can be served before Core is put on its chain. Then every read of Core comes back
 * empty, and viem says "returned no data" — which is neither the network failing nor Core refusing.
 * This file tells the three apart, so a screen says "This contract is not on <network> yet" instead
 * of "Can't reach the network right now", and keeps the network sentence for the network alone.
 *
 * The test is `eth_getCode` at the address: empty means absent. A read that fails on the way is
 * the network's failure (`isNetworkError`) and decides nothing.
 */

export type Presence = "here" | "absent";

/** `eth_getCode` at the latest block: "absent" when the address holds no code. Network failures throw. */
export async function presenceOf(client: Pick<PublicClient, "getCode">, address: Address): Promise<Presence> {
  const code = await client.getCode({ address });
  return code && code !== "0x" ? "here" : "absent";
}

/** viem's errors for a call that came back with no data: what every read of an empty address ends in. */
const NO_DATA = new Set(["ContractFunctionZeroDataError", "AbiDecodingZeroDataError"]);

/** Whether a failed read of a contract failed because the address answered with nothing at all. */
export function isNoDataError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const { name } = node as { name?: unknown };
    if (typeof name === "string" && NO_DATA.has(name)) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

/** What a failed read of Core means, given what `eth_getCode` said (undefined when not yet asked). */
export type ReadFailure = "offline" | "absent" | "failed";

export function readFailureOf(error: unknown, presence: Presence | undefined): ReadFailure {
  if (isNetworkError(error)) return "offline";
  if (presence === "absent") return "absent";
  return "failed";
}

/**
 * Core's presence as a screen follows it:
 *  - "unknown": not asked yet;
 *  - "checking": `eth_getCode` is on its way;
 *  - "here": Core's code is there (final: code at a CREATE2 address does not leave on its own);
 *  - "absent": the address holds nothing on this network;
 *  - "offline": the network did not answer, so nothing is known; the screens' own offline band
 *    speaks, and the next subscriber or `recheck` asks again.
 */
export type PresenceState = "unknown" | "checking" | Presence | "offline";

/**
 * One check shared by every screen of the tab: the first listener starts it, every listener sees
 * the same answer. "absent" stays while it is asked again. "here" is kept; "absent" and "offline" are asked again by `recheck` (the
 * "Check again" button) and, for "offline", by the next screen that listens.
 */
export class PresenceStore {
  private current: PresenceState = "unknown";
  private readonly listeners = new Set<() => void>();
  private asking: Promise<void> | undefined;

  constructor(private readonly check: () => Promise<Presence>) {}

  readonly state = (): PresenceState => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.current === "unknown" || this.current === "offline") void this.recheck();
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Asks `eth_getCode` again (once at a time); resolves when the answer is in. */
  recheck(): Promise<void> {
    if (this.current === "here") return Promise.resolve();
    this.asking ??= (async () => {
      // An "absent" stays on screen while it is asked again: no flash of the screen behind it.
      if (this.current !== "absent") this.set("checking");
      try {
        this.set(await this.check());
      } catch (error) {
        // Anything but the network failing is not a verdict on Core either: say nothing about it.
        this.set(isNetworkError(error) ? "offline" : "unknown");
      } finally {
        this.asking = undefined;
      }
    })();
    return this.asking;
  }

  private set(next: PresenceState): void {
    if (next === this.current) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}
