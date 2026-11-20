import { fromText, getHandFor, peekLink, readDescription, type LinkHead, type LinkOptions, type OpenedAddress } from "@ahand/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { erc20Abi, isAddressEqual, type Address } from "viem";

import { CLIENTS, clientOf, watcherOf } from "../../chain";
import { config } from "../../config";
import { dealDescriptionOf, type DealDescription } from "../../ui";
import { failureOf, openHeld, type Failure, type Held, type Trusts } from "./held";

/**
 * The build's side of opening a link, shared by the Hand view and the pass (both of this
 * package): the SDK's options for this build, `getHandFor` over the build's own trusted list (it
 * fails closed on any other chain or Core), and a hook that opens the link this tab holds.
 */

/** The link format's options for this build: the main contract, when the build names one. */
export const LINK_OPTIONS: LinkOptions = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};

/** `hands(id)` of a trusted Core only; anything else throws `UntrustedCore`. */
export const getHand = getHandFor(CLIENTS, config.cores.trusted);

/** Whether this build reads a chain and a Core: its trusted list, and a client for the chain (as `getHandFor` judges). */
export const trusts: Trusts = (chainId, core) => CLIENTS[chainId] !== undefined && config.cores.trusted.some((entry) => entry.chainId === chainId && isAddressEqual(entry.core, core));

/** What a link names, read from its first bytes with no network; undefined for a link that can't be read. */
export function peekHeld(fragment: string): LinkHead | undefined {
  try {
    return peekLink(fromText(fragment), LINK_OPTIONS);
  } catch {
    return undefined;
  }
}

export type Opening =
  | { status: "checking" }
  | { status: "open"; opened: OpenedAddress }
  /**
   * The network did not answer. Nothing is judged and nothing is lost: the link stays in this
   * tab's memory, and `retry` reads again without asking for it. A try already under way is not
   * started twice.
   */
  | { status: "unreachable"; failure: Failure; retry: () => void }
  | { status: "failed"; failure: Failure };

type Settled = { status: "checking" } | { status: "open"; opened: OpenedAddress } | { status: "unreachable"; failure: Failure } | { status: "failed"; failure: Failure };

/**
 * Opens the held link and proves it against the Hand Core keeps (openAddress, or openLink for a
 * bare link pasted alone). The link's text is only ever a dependency here: it is not logged,
 * stored or sent anywhere but into the SDK in this tab. `held` undefined: nothing to open.
 *
 * A failure of the network is not a verdict (UX-SPEC §15): the status is "unreachable", the held
 * link is untouched, and each `retry` opens it again. While a later try runs, the status stays
 * "unreachable", so the screen does not flicker between the band and the skeleton.
 */
export function useOpening(held: Held | undefined): Opening | undefined {
  const key = held ? `${held.before}#${held.fragment}` : undefined;
  const [state, setState] = useState<{ key?: string; opening: Settled }>({ opening: { status: "checking" } });
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!held) return;
    let live = true;
    busy.current = true;
    setState((before) => (before.key === key && before.opening.status === "unreachable" ? before : { key, opening: { status: "checking" } }));
    const settle = (opening: Settled) => {
      if (!live) return;
      busy.current = false;
      setState({ key, opening });
    };
    openHeld(held, getHand, LINK_OPTIONS, trusts).then(
      (opened) => settle({ status: "open", opened }),
      (error: unknown) => {
        const failure = failureOf(error);
        settle(failure.network ? { status: "unreachable", failure } : { status: "failed", failure });
      },
    );
    return () => {
      live = false;
      busy.current = false;
    };
  }, [key, attempt]); // `key` carries the held link
  const retry = useCallback(() => {
    if (!busy.current) setAttempt((n) => n + 1);
  }, []);
  if (!held) return undefined;
  const opening = state.key === key ? state.opening : { status: "checking" as const };
  return opening.status === "unreachable" ? { ...opening, retry } : opening;
}

/** Asks the block watcher for the latest block now, without waiting for its next poll. */
export function pollNow(): void {
  void watcherOf().refresh();
}

/**
 * Reading a Hand again after the network failed under a link that had already opened. Every new
 * block reads `hands(id)` again by itself (`useHand`), so on its own the screen only asks for
 * the latest block (`pollNow`); "Try again" also starts the Hand's read afresh, for a chain
 * whose blocks have stopped: the number returned is a `key` for the component that reads.
 */
export function useReread(): [number, () => void] {
  const [again, setAgain] = useState(0);
  const reread = useCallback(() => {
    pollNow();
    setAgain((n) => n + 1);
  }, []);
  return [again, reread];
}

/** A token this build knows: its decimals and the label people read. */
export function knownToken(address: Address | undefined) {
  return address ? config.tokens.find((token) => isAddressEqual(token.address, address)) : undefined;
}

/**
 * The token's decimals: from the build's list, or read once from the token itself for one the
 * list does not name. Undefined until known; nothing is shown as money before then.
 */
export function useDecimals(token: Address | undefined, chainId: number = config.chain.id): number | undefined {
  const known = knownToken(token)?.decimals;
  const [read, setRead] = useState<{ token?: Address; decimals?: number }>({});
  useEffect(() => {
    if (!token || known !== undefined) return;
    let live = true;
    clientOf(chainId)
      .readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
      .then((decimals) => live && setRead({ token, decimals }), () => undefined);
    return () => {
      live = false;
    };
  }, [token, known, chainId]);
  return known ?? (read.token === token ? read.decimals : undefined);
}

/**
 * The Deal card's description of an opened link: the asker's own words once they matched the
 * dataHash Core keeps (`readDescription`, which reads `ofHand` only), "none" for a Hand that
 * states nothing, and "lost" for one whose words did not all arrive.
 */
export function cardDescription(opened: OpenedAddress): DealDescription {
  return dealDescriptionOf(readDescription(opened));
}
