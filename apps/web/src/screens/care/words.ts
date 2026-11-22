import { readDescription, type Hand, type LinkHead, type LinkOptions } from "@ahand/sdk";
import { useEffect, useState } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";

import { handKey } from "../../store/db";
import { useOpened } from "../../store/memory";
import type { DealDescription } from "../../ui";
import { useMyHand, useSecrets } from "../my/hooks";
import { openHeldLink, peekHeld } from "../print/link";
import { checkKept, type DeviceCheck } from "./kept";

type GetHand = (head: LinkHead) => Promise<Hand>;

/**
 * Where /care finds a Hand's words. The network keeps only their hash (dataHash), so the words
 * come from one of two places on this device, and each is checked against that hash:
 *
 * - a link of this very Hand held in this tab's memory (arriving from the raise, say): opened
 *   against the trusted Core, which checks the words inside it;
 * - the device's own list of Hands it raised (the store /my reads): the kept words are described
 *   again as at the raise and must give the dataHash Core keeps, exactly as /my checks them.
 *
 * Without the Hand's inbox key (known only once the raiser's account is unlocked, here or on /my)
 * words that were described with one cannot be checked yet: they are shown as this device keeps
 * them, framed so, and never as the Hand's own.
 */

export type CareWords =
  | { from: "link"; description: DealDescription }
  | { from: "device"; check: DeviceCheck; title: string; content?: string; raiser: Address }
  | { from: "none" };

/** The words of a held link of this Hand, opened against the trusted Core; "none" otherwise. */
function useLinkWords(place: { chainId: number; core: Address; handId: bigint }, getHand: GetHand, options: LinkOptions): DealDescription {
  const held = useOpened();
  const [description, setDescription] = useState<DealDescription>({ status: "none" });
  const head = held ? peekHeld(held.fragment, options) : undefined;
  const ours = head !== undefined && head.chainId === place.chainId && head.handId === place.handId && isAddressEqual(head.core, place.core);
  useEffect(() => {
    if (!held || !ours) return;
    let live = true;
    openHeldLink(held, getHand, options)
      .then((opened) => {
        const read = readDescription(opened);
        if (live && read.status === "attached" && read.title !== undefined) {
          setDescription({ status: "attached", title: read.title, ...(read.content ? { content: read.content } : {}) });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [held, ours]); // `getHand` and `options` are the build's own and never change
  return ours ? description : { status: "none" };
}

/** The Hand's words for /care: a held link first, then the device's list, each checked. */
export function useCareWords(args: {
  chainId: number;
  core: Address;
  handId: bigint;
  dataHash: Hex | undefined;
  connected: Address | undefined;
  getHand: GetHand;
  options: LinkOptions;
}): CareWords {
  const { chainId, core, handId, dataHash, connected } = args;
  const link = useLinkWords({ chainId, core, handId }, args.getHand, args.options);
  const stored = useMyHand(handKey(chainId, core, handId));
  const record = stored.status === "ok" ? stored.value : undefined;
  const secrets = useSecrets(record, connected);

  if (link.status === "attached") return { from: "link", description: link };
  if (!record?.title || !dataHash) return { from: "none" };
  const check = checkKept(record, secrets?.inbox?.pub, secrets !== undefined, dataHash);
  return { from: "device", check, title: record.title, ...(record.content ? { content: record.content } : {}), raiser: record.raiser as Address };
}
