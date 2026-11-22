import { getAddress, isAddressEqual, maxUint256, type Address } from "viem";

import {
  LinkError,
  MAX_LINK_BYTES,
  canonicalOf,
  fromBase64Url,
  fromText,
  openLink,
  openPublicPart,
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
 *   described <site>/<chainId>/<handId>?d=<data>#<link>     which Hand, and the part of its
 *                                                           description its raiser made public
 *
 * With a Core other than the canonical one its address stands in the path too:
 * <site>/<chainId>/<core>/<handId>.
 *
 * `d`, the public part, is attachments, written exactly as inside a link (their number, then kind,
 * length and bytes of each), in base64url. A site checks them against the `dataHash` Core keeps
 * for the Hand before showing a word of them; a reader checks them again together with the link.
 * The number in the path must be the link's.
 *
 * Which shape a Hand's links take is its raiser's and the application's choice. Whoever holds a
 * link can write it in another shape: the shape of an address says what its sender showed, not
 * what the raiser wanted shown.
 */

export type AddressShape = "bare" | "numbered" | "described";

/** What stands before `#`: what a site, a proxy or a preview robot can read. */
export interface SeenAddress {
  shape: AddressShape;
  chainId?: number;
  core?: Address;
  handId?: bigint;
  /** The public part (`d`): attachments in the open, still to be checked against the Hand's dataHash. */
  publicPart?: Uint8Array;
}

function decimal(text: string, what: string, maxDigits: number): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new LinkError("non-canonical", `${what} is written as a plain number`);
  // Bounded before BigInt, whose cost grows with the digits: an address is untrusted text.
  if (text.length > maxDigits) throw new LinkError("malformed", `${what} has more digits than it can`);
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
  // A chain's number fits 2^53 (16 digits), a Hand's a uint256 (78 digits).
  const chainId = decimal(numbered[1], "the chain's number", 16);
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LinkError("malformed", "a chain number out of range");
  const handId = decimal(numbered[3], "the Hand's number", 78);
  if (handId > maxUint256) throw new LinkError("malformed", "a Hand number out of range");
  const canonical = canonicalOf(options);
  let core: Address;
  if (numbered[2]) {
    if (!/^0x[0-9a-f]{40}$/.test(numbered[2])) throw new LinkError("non-canonical", "Core's address is written in lower case");
    core = getAddress(numbered[2]);
    if (canonical && isAddressEqual(core, canonical)) {
      throw new LinkError("non-canonical", "the canonical Core is named by leaving its address out");
    }
  } else {
    if (!canonical) throw new LinkError("no-canonical-core", "the address names the canonical Core and none is known");
    core = canonical;
  }
  const seen: SeenAddress = { shape: "numbered", chainId: Number(chainId), core, handId };
  if (data.length === 1) {
    seen.shape = "described";
    const max = options.maxBytes ?? MAX_LINK_BYTES;
    if (data[0].length > Math.ceil((max * 4) / 3)) throw new LinkError("too-long", "a public part longer than a link may be");
    seen.publicPart = fromBase64Url(data[0]);
  }
  return seen;
}

/**
 * The site's side: what it may show of a Hand from the address alone, each word checked against
 * the dataHash Core keeps. `getHand` is the site's own and answers only for the chains and Cores
 * the site trusts: the Core an address names is a claim, and a contract of the claimant's own
 * would confirm any description. For a described address, `publicPart` is the public part of the
 * description, matched.
 */
export async function viewOf(
  address: string,
  getHand: (seen: SeenAddress) => Promise<Hand>,
  options: LinkOptions = {},
): Promise<{ seen: SeenAddress; hand?: Hand; publicPart?: MatchedData }> {
  const seen = seenIn(address.split("#")[0], options);
  if (seen.shape === "bare") return { seen };
  const hand = await getHand(seen);
  if (hand.handId !== seen.handId) throw new LinkError("another-hand", "the Hand given is not the one the address names");
  if (seen.shape === "numbered") return { seen, hand };
  return { seen, hand, publicPart: openPublicPart(seen.publicPart!, hand, options) };
}

export interface AddressParts {
  /** Scheme, host and, if the site has one, a path of its own, without a slash at the end. */
  site: string;
  link: Uint8Array;
  shape: AddressShape;
  /** For the described shape: the public part, the attachments to show in the open. */
  publicPart?: Attachments;
  /** `digits` for a QR code. */
  form?: "text" | "digits";
}

/**
 * Writes the address. The number before `#` is taken from the link itself, so the two cannot
 * differ. A site whose own address has a query, a fragment or white space is refused: the number
 * or the link would be lost in it.
 */
export function toAddress(parts: AddressParts, options: LinkOptions = {}): string {
  const head = peekLink(parts.link, options);
  const fragment = parts.form === "digits" ? toDigits(parts.link) : toText(parts.link);
  let before: string;
  if (parts.shape === "bare") {
    if (parts.publicPart) throw new LinkError("malformed", "a bare address shows nothing");
    before = `${parts.site}/`;
  } else {
    const canonical = canonicalOf(options);
    const path = canonical && isAddressEqual(canonical, head.core) ? `${head.chainId}/${head.handId}` : `${head.chainId}/${head.core.toLowerCase()}/${head.handId}`;
    if (parts.shape === "numbered") {
      if (parts.publicPart) throw new LinkError("malformed", "a numbered address shows only the number");
      before = `${parts.site}/${path}`;
    } else {
      const data = packAttachments(parts.publicPart);
      if (data.length === 0) throw new LinkError("malformed", "a described address shows something");
      before = `${parts.site}/${path}?d=${toText(data)}`;
    }
  }
  // What was written must read back in the shape it was given: a last guard against the site's own address.
  if (seenIn(before, options).shape !== parts.shape) throw new LinkError("malformed", "this site's address cannot carry the shape");
  return `${before}#${fragment}`;
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
  const bytes = fromText(address.slice(hash + 1), options);
  const opened = await openLink(bytes, getHand, { ...options, publicPart: seen.publicPart });
  if (seen.shape !== "bare") {
    const { chainId, core, handId } = opened.head;
    if (seen.chainId !== chainId || seen.handId !== handId || !isAddressEqual(seen.core!, core)) {
      throw new LinkError("another-hand", "the address shows one Hand and the link is for another");
    }
  }
  return { ...opened, seen };
}
