import { fromText, getHandFor, peekLink, readDescription, type LinkHead, type LinkOptions, type OpenedAddress } from "@ahand/sdk";
import { useEffect, useState } from "react";
import { erc20Abi, isAddressEqual, type Address } from "viem";

import { CLIENTS, clientOf } from "../../chain";
import { config } from "../../config";
import type { DealDescription } from "../../ui";
import { failureOf, openHeld, type Failure, type Held } from "./held";

/**
 * The build's side of opening a link, shared by the Hand view and the pass (both of this
 * package): the SDK's options for this build, `getHandFor` over the build's own trusted list (it
 * fails closed on any other chain or Core), and a hook that opens the link this tab holds.
 */

/** The link format's options for this build: the main contract, when the build names one. */
export const LINK_OPTIONS: LinkOptions = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};

/** `hands(id)` of a trusted Core only; anything else throws `UntrustedCore`. */
export const getHand = getHandFor(CLIENTS, config.cores.trusted);

/** What a link names, read from its first bytes with no network; undefined for a link that can't be read. */
export function peekHeld(fragment: string): LinkHead | undefined {
  try {
    return peekLink(fromText(fragment), LINK_OPTIONS);
  } catch {
    return undefined;
  }
}

export type Opening = { status: "checking" } | { status: "open"; opened: OpenedAddress } | { status: "failed"; failure: Failure };

/**
 * Opens the held link and proves it against the Hand Core keeps (openAddress, or openLink for a
 * bare link pasted alone). The link's text is only ever a dependency here: it is not logged,
 * stored or sent anywhere but into the SDK in this tab. `held` undefined: nothing to open.
 */
export function useOpening(held: Held | undefined): Opening | undefined {
  const key = held ? `${held.before}#${held.fragment}` : undefined;
  const [state, setState] = useState<{ key?: string; opening: Opening }>({ opening: { status: "checking" } });
  useEffect(() => {
    if (!held) return;
    let live = true;
    setState({ key, opening: { status: "checking" } });
    openHeld(held, getHand, LINK_OPTIONS).then(
      (opened) => live && setState({ key, opening: { status: "open", opened } }),
      (error: unknown) => live && setState({ key, opening: { status: "failed", failure: failureOf(error) } }),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` carries the held link
  if (!held) return undefined;
  return state.key === key ? state.opening : { status: "checking" };
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
  const description = readDescription(opened);
  if (description.status === "attached" && description.title !== undefined) {
    return { status: "attached", title: description.title, ...(description.content ? { content: description.content } : {}) };
  }
  return description.status === "none" ? { status: "none" } : { status: "lost" };
}
