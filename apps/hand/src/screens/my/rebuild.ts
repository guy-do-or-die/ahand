import { describeHand, encodeLive, keyOfSeed, packAttachments, toAddress, type DescribeMode, type Described, type Eip712Domain, type Hand, type LinkOptions } from "@ahand/sdk";
import { isAddressEqual, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

/**
 * Writing a raiser's own link again (ARCHITECTURE §5, D-17), with nothing but what the device
 * keeps and what the chain says. Pure: the caller hands in the Hand's terms as Core keeps them
 * (`hands(id)`), the 16-byte link seed it derived, and the words its list holds.
 *
 * What recovery honestly gives: on the device that raised the Hand, the whole link (its words
 * hang on the dataHash Core keeps, so they are checked here before they are attached). Anywhere
 * else, a bare link whose words did not arrive: the words are never on the chain.
 */

export interface KeptWords {
  mode: DescribeMode;
  title: string;
  content?: string;
  /** Unlisted and dark only. */
  salt?: Hex;
}

export interface Rebuilt {
  address: string;
  /** "attached": the kept words match Core's dataHash and ride along; "mismatch": they do not, so the link is bare. */
  words: "attached" | "mismatch" | "none";
}

/** Whether a seed is the one behind the root key Core keeps: `keyOfSeed(seed)` → address = `hands(id).rootKey`. */
export function seedFitsRoot(seed: Hex, rootKey: Hex): boolean {
  return isAddressEqual(privateKeyToAddress(keyOfSeed(seed)), rootKey);
}

/** The first link (0 Shakes) with no words: bare, everything inside. */
export async function rebuildBare(args: { domain: Eip712Domain; hand: Hand; seed: Hex; site: string; options: LinkOptions }): Promise<string> {
  const link = await encodeLive({ domain: args.domain, hand: args.hand, signedShakes: [], seed: args.seed }, args.options);
  return toAddress({ site: args.site, link, shape: "bare" }, args.options);
}

/**
 * The first link with the raiser's own words, in the shape they chose, if those words (with the
 * Hand's inbox key, or without one for a Hand raised with none) give the dataHash Core keeps.
 * Otherwise the bare link, and `words: "mismatch"` so the screen can say why the words are missing.
 */
export async function rebuildWithWords(args: {
  domain: Eip712Domain;
  hand: Hand;
  seed: Hex;
  /** The Hand's inbox key (x-only, 32 bytes), when this device can derive or keeps it. */
  inbox?: Hex;
  words: KeptWords;
  site: string;
  options: LinkOptions;
}): Promise<Rebuilt> {
  const { domain, hand, seed, words, site, options } = args;
  const described = describeKept(words, args.inbox, hand.dataHash);
  if (described) {
    const outside = described.outside && packAttachments(described.outside);
    const link = await encodeLive(
      { domain, hand, signedShakes: [], seed, ...(described.inside ? { attachments: described.inside } : {}) },
      { ...options, ...(outside ? { outside } : {}) },
    );
    const address = toAddress({ site, link, shape: described.shape, ...(described.outside ? { outside: described.outside } : {}) }, options);
    return { address, words: "attached" };
  }
  return { address: await rebuildBare({ domain, hand, seed, site, options }), words: "mismatch" };
}

/**
 * The kept words described as the Hand was raised, if they give the dataHash Core keeps: tried
 * with the Hand's inbox key, then without one (a Hand raised where no relay was set up). A salt is
 * random when none was kept, so an unlisted or dark Hand without its salt never matches.
 */
export function describeKept(words: KeptWords, inbox: Hex | undefined, dataHash: Hex): Described | undefined {
  for (const key of inbox ? [inbox, undefined] : [undefined]) {
    try {
      const described = describeHand({
        mode: words.mode,
        title: words.title,
        ...(words.content !== undefined ? { content: words.content } : {}),
        ...(key ? { inbox: key } : {}),
        ...(words.mode !== "public" && words.salt ? { salt: words.salt } : {}),
      });
      if (described.dataHash.toLowerCase() === dataHash.toLowerCase()) return described;
    } catch {
      // words that cannot describe a Hand (an empty title) cannot match either
    }
  }
  return undefined;
}
