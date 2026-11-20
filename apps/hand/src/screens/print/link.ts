import {
  carryFor,
  encodeLive,
  fromText,
  openAddress,
  openLink,
  peekLink,
  readDescription,
  toAddress,
  type Hand,
  type LinkHead,
  type LinkOptions,
  type OpenedAddress,
  type ReadDescription,
} from "@ahand/sdk";

/**
 * The link to print, free of React and of the configuration so it is tested offline
 * (print.test.ts). A printed code always carries the bare address with everything inside, as
 * digits (ARCHITECTURE §9, D-44): the part a site could see (`d`) moves inside the link, and the
 * link becomes one decimal number, which a QR code packs in its numeric mode.
 *
 * Nothing here writes a link anywhere: the caller holds what these functions return in memory.
 */

/** What this tab holds (store/memory.ts), as far as printing needs it. */
export interface HeldLink {
  before: string;
  fragment: string;
}

/** Opens a held link: as a whole address when it came with one, as a bare link otherwise. */
export async function openHeldLink(held: HeldLink, getHand: (head: LinkHead) => Promise<Hand>, options: LinkOptions): Promise<OpenedAddress> {
  if (held.before === "") {
    const opened = await openLink(fromText(held.fragment), getHand, options);
    return { ...opened, seen: { shape: "bare" } };
  }
  return openAddress(`${held.before}#${held.fragment}`, getHand, options);
}

/** What a link names, from its first bytes alone; undefined when it can't be read. */
export function peekHeld(fragment: string, options: LinkOptions): LinkHead | undefined {
  try {
    return peekLink(fromText(fragment), options);
  } catch {
    return undefined;
  }
}

/** Why a held link cannot be printed. */
export class NotPrintable extends Error {
  constructor(readonly reason: "not-live") {
    super("only a link that can be passed on is printed");
  }
}

export interface Printable {
  /** `<site>/#<digits>`: what the code carries. */
  address: string;
  shakes: number;
  description: ReadDescription;
}

/**
 * The same route, re-encoded bare with everything inside, in digits. Only a live link (one that
 * holds its seed) is printed: a give link answers the asker and is no use on a wall, and a link
 * without its seed can't be passed on by whoever finds it.
 */
export async function printableOf(opened: OpenedAddress, site: string, options: LinkOptions): Promise<Printable> {
  if (!opened.seed || opened.signedGive) throw new NotPrintable("not-live");
  const { attachments } = carryFor(opened, "bare");
  const link = await encodeLive(
    { domain: opened.domain, hand: opened.hand, signedShakes: opened.signedShakes, seed: opened.seed, attachments },
    options,
  );
  return {
    address: toAddress({ site, link, shape: "bare", form: "digits" }, options),
    shakes: opened.signedShakes.length,
    description: readDescription(opened),
  };
}

/** `/print?receipt=31337/7` → the Hand whose receipt to print. */
export function receiptOfSearch(search: string): { chainId: number; handId: bigint } | undefined {
  // Read by hand: the page only ever reads this one public parameter.
  const match = /(?:^\?|&)receipt=([0-9]{1,15})(?:\/|%2F)([0-9]{1,78})(?:&|$)/i.exec(search);
  if (!match) return undefined;
  return { chainId: Number(match[1]), handId: BigInt(match[2]!) };
}

/** The passport's address, the one the printed receipt's code leads to. */
export function passportAddress(site: string, chainId: number, core: string, handId: bigint, canonical?: string): string {
  const named = canonical && canonical.toLowerCase() === core.toLowerCase() ? "" : `${core.toLowerCase()}/`;
  return `${site}/${chainId}/${named}${handId}/proof`;
}
