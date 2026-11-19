import { getAddress, isAddressEqual, type Address } from "viem";

import {
  LinkError,
  fromBase64Url,
  fromText,
  openLink,
  openOutside,
  packAttachments,
  peekLink,
  toDigits,
  toText,
  type Attachments,
  type LinkHead,
  type LinkOptions,
  type MatchedData,
  type OpenedLink,
} from "./link.js";
import type { Hand } from "./types.js";

/**
 * The aHand link inside a web address.
 *
 * The link itself is everything after `#`: a browser never sends that part to a site, and a
 * messenger's preview robot never sees it. What stands before `#` is what a site and the robots
 * may see. It has three shapes, and nothing in the link's bytes tells them apart:
 *
 *   bare      <site>/#<link>                                nothing is seen
 *   numbered  <site>/<chainId>/<handId>#<link>              which Hand it is
 *   faced     <site>/<chainId>/<handId>?d=<data>#<link>     which Hand, and the part of its
 *                                                           description its raiser made public
 *
 * With a Core other than the canonical one its address stands in the path too:
 * <site>/<chainId>/<core>/<handId>.
 *
 * `d` is attachments, written exactly as inside a link (their number, then kind, length and bytes
 * of each), in base64url. A site checks them against the `dataHash` Core keeps for the Hand
 * before showing a word of them; a reader checks them again together with the link. The number
 * in the path must be the link's.
 *
 * Which shape a Hand's links take is its raiser's and the application's choice. Whoever holds a
 * link can write it in another shape: the shape of an address says what its sender showed, not
 * what the raiser wanted shown.
 */

export type AddressShape = "bare" | "numbered" | "faced";

/** What stands before `#`: what a site, a proxy or a preview robot can read. */
export interface SeenAddress {
  shape: AddressShape;
  chainId?: number;
  core?: Address;
  handId?: bigint;
  /** Attachments in the open, still to be checked against the Hand's dataHash. */
  data?: Uint8Array;
}

function decimal(text: string, what: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new LinkError("non-canonical", `${what} is written as a plain number`);
  return BigInt(text);
}

/**
 * Reads the part of an address before `#`, as it is written: nothing is decoded, trimmed or
 * resolved, so each address has one spelling. The site (scheme, host, a path of its own) is not
 * the link's and is not judged. Query parameters other than `d` are someone else's and are skipped.
 */
export function seenIn(address: string, options: LinkOptions = {}): SeenAddress {
  if (/[\s\\#\u0000-\u001f\u007f]/.test(address)) {
    throw new LinkError("malformed", "white space, a backslash or a control character in an address");
  }
  const mark = address.indexOf("?");
  const path = mark < 0 ? address : address.slice(0, mark);
  const data = (mark < 0 ? [] : address.slice(mark + 1).split("&")).filter((part) => part.startsWith("d=")).map((part) => part.slice(2));
  if (data.length > 1) throw new LinkError("non-canonical", "the public part is given twice");
  if (!/^https?:\/\/[^/]+\//.test(path)) throw new LinkError("malformed", "not a web address");

  const numbered = /\/([0-9]+)\/(?:(0x[0-9a-fA-F]{40})\/)?([0-9]+)$/.exec(path);
  if (!numbered) {
    if (!path.endsWith("/")) throw new LinkError("malformed", "not an aHand address");
    if (data.length > 0) throw new LinkError("malformed", "a public part without the Hand it belongs to");
    return { shape: "bare" };
  }
  const chainId = decimal(numbered[1], "the chain's number");
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LinkError("malformed", "a chain number out of range");
  const handId = decimal(numbered[3], "the Hand's number");
  let core: Address;
  if (numbered[2]) {
    if (!/^0x[0-9a-f]{40}$/.test(numbered[2])) throw new LinkError("non-canonical", "Core's address is written in lower case");
    core = getAddress(numbered[2]);
    if (options.canonicalCore && isAddressEqual(core, options.canonicalCore)) {
      throw new LinkError("non-canonical", "the canonical Core is named by leaving its address out");
    }
  } else {
    if (!options.canonicalCore) throw new LinkError("unsupported", "the address names the canonical Core and none is known");
    core = options.canonicalCore;
  }
  const seen: SeenAddress = { shape: "numbered", chainId: Number(chainId), core, handId };
  if (data.length === 1) {
    seen.shape = "faced";
    seen.data = fromBase64Url(data[0]);
  }
  return seen;
}

/**
 * The site's side: what it may show of a Hand from the address alone, each word checked against
 * the dataHash Core keeps. `getHand` is the site's own and answers only for the chains and Cores
 * the site trusts: the Core an address names is a claim, and a contract of the claimant's own
 * would confirm any description.
 */
export async function faceOf(
  address: string,
  getHand: (seen: SeenAddress) => Promise<Hand>,
  options: LinkOptions = {},
): Promise<{ seen: SeenAddress; hand?: Hand; face?: MatchedData }> {
  const seen = seenIn(address.split("#")[0], options);
  if (seen.shape === "bare") return { seen };
  const hand = await getHand(seen);
  if (hand.handId !== seen.handId) throw new LinkError("another-hand", "the Hand given is not the one the address names");
  if (seen.shape === "numbered") return { seen, hand };
  return { seen, hand, face: openOutside(seen.data!, hand) };
}

export interface AddressParts {
  /** Scheme, host and, if the site has one, a path of its own, without a slash at the end. */
  site: string;
  link: Uint8Array;
  shape: AddressShape;
  /** For the faced shape: the attachments to show in the open. */
  outside?: Attachments;
  /** `digits` for a QR code. */
  form?: "text" | "digits";
}

/** Writes the address. The number before `#` is taken from the link itself, so the two cannot differ. */
export function toAddress(parts: AddressParts, options: LinkOptions = {}): string {
  const head = peekLink(parts.link, options);
  const fragment = parts.form === "digits" ? toDigits(parts.link) : toText(parts.link);
  if (parts.shape === "bare") {
    if (parts.outside) throw new LinkError("malformed", "a bare address shows nothing");
    return `${parts.site}/#${fragment}`;
  }
  const canonical = options.canonicalCore && isAddressEqual(options.canonicalCore, head.core);
  const path = canonical ? `${head.chainId}/${head.handId}` : `${head.chainId}/${head.core.toLowerCase()}/${head.handId}`;
  if (parts.shape === "numbered") {
    if (parts.outside) throw new LinkError("malformed", "a numbered address shows only the number");
    return `${parts.site}/${path}#${fragment}`;
  }
  const data = packAttachments(parts.outside);
  if (data.length === 0) throw new LinkError("malformed", "a faced address shows something");
  return `${parts.site}/${path}?d=${toText(data)}#${fragment}`;
}

export interface OpenedAddress extends OpenedLink {
  seen: SeenAddress;
}

/** The reader's side: the whole address. What is seen before `#` must agree with the link after it. */
export async function openAddress(
  address: string,
  getHand: (head: LinkHead) => Promise<Hand>,
  options: LinkOptions = {},
): Promise<OpenedAddress> {
  const hash = address.indexOf("#");
  if (hash < 0) throw new LinkError("malformed", "an address without a link");
  const seen = seenIn(address.slice(0, hash), options);
  const bytes = fromText(address.slice(hash + 1));
  const opened = await openLink(bytes, getHand, { ...options, outside: seen.data });
  if (seen.shape !== "bare") {
    const { chainId, core, handId } = opened.head;
    if (seen.chainId !== chainId || seen.handId !== handId || !isAddressEqual(seen.core!, core)) {
      throw new LinkError("another-hand", "the address shows one Hand and the link is for another");
    }
  }
  return { ...opened, seen };
}
