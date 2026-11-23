import { getAddress, keccak256, stringToBytes, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import {
  dataHashOf,
  domain,
  signGiveWithKey,
  textValue,
  type Eip712Domain,
  type Give,
  type Hand,
  type SignedGive,
  type Statement,
} from "../src/index.js";
import type { AddressShape } from "../src/address.js";
import {
  LinkError,
  encodeLive,
  keyOfSeed,
  openLink,
  passOn,
  type Attachments,
  type LinkErrorCode,
  type LinkHead,
  type LinkOptions,
  type OpenedLink,
} from "../src/link.js";

/**
 * A Hand of the tests' own, whose root key comes from a seed: the live links that Core's fixtures
 * cannot give, because their keys are not made from seeds.
 */

export const BASE = 8453;
/** A Core of the tests' own, which `ownOptions` makes the canonical one for these tests. */
export const CORE: Address = getAddress("0xc0dec0dec0dec0dec0dec0dec0dec0dec0dec0de");
export const ownDomain: Eip712Domain = domain(BASE, CORE);
export const ownOptions: LinkOptions = { canonicalCore: CORE };

export const rootSeed: Hex = "0x000102030405060708090a0b0c0d0e0f";
export const giverKey: Hex = keccak256(stringToBytes("a giver of the tests"));

export function ownHand(dataHash: Hex = keccak256(stringToBytes("who can fix a 1978 Vespa in Lisbon?")), handId = 123_456n): Hand {
  return {
    handId,
    raiser: "0x1111111111111111111111111111111111111111",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rootKey: privateKeyToAddress(keyOfSeed(rootSeed)),
    payoutGasK: 200,
    minClaimBps: 5_000,
    dataHash,
  };
}

/**
 * What the application gives openLink to read a Hand: the chain and the Core the link names are
 * asked for the Hand the link names, and only this one Hand is there.
 */
export function handOnChain(hand: Hand): (head: LinkHead) => Promise<Hand> {
  return async (head) => {
    if (head.chainId !== ownDomain.chainId || head.core !== CORE || head.handId !== hand.handId) throw new Error("no such Hand");
    return hand;
  };
}

/** How a link fared: opened, refused with the LinkError's code, or failed some other way. */
export async function code(run: Promise<unknown> | (() => Promise<unknown>)): Promise<LinkErrorCode | "opened" | "other error"> {
  try {
    await (typeof run === "function" ? run() : run);
    return "opened";
  } catch (error) {
    return error instanceof LinkError ? error.code : "other error";
  }
}

/** The address a test Shake pays: a different one at every place of the route. */
export function payeeAt(position: number): Address {
  return privateKeyToAddress(keccak256(stringToBytes(`payee ${position}`)));
}

export interface Built {
  link: Uint8Array;
  opened: OpenedLink;
}

/**
 * A live link after `count` Shakes, made the way holders make it: every pass opens the link it
 * got and writes the next. `shape` says what each Shake is: paid (a payee and a margin of 1 %) or
 * anonymous, and with or without a dataHash.
 */
export async function liveLink(
  hand: Hand,
  count: number,
  shape: (position: number) => { paid: boolean; data: boolean } = () => ({ paid: true, data: false }),
): Promise<Built> {
  const getHand = async () => hand;
  let link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
  let opened = await openLink(link, getHand, ownOptions);
  for (let position = 0; position < count; ++position) {
    const { paid, data } = shape(position);
    ({ link } = await passOn(
      opened,
      {
        payee: paid ? payeeAt(position) : zeroAddress,
        nextClaimBps: paid ? opened.end.claimBps - 100 : opened.end.claimBps,
        dataHash: data ? keccak256(stringToBytes(`data of the Shake at ${position}`)) : zeroHash,
      },
      ownOptions,
    ));
    opened = await openLink(link, getHand, ownOptions);
  }
  return { link, opened };
}

/** The Give a giver signs at the end of an opened live link: with the link's key and with its own. */
export async function giveAt(opened: OpenedLink, payee?: Address, dataHash: Hex = zeroHash): Promise<SignedGive> {
  const signer = privateKeyToAccount(giverKey).address;
  const give: Give = {
    signer,
    payee: payee ?? signer,
    claimBps: opened.end.claimBps,
    routeHash: opened.end.routeHash,
    dataHash,
  };
  return {
    give,
    keySig: await signGiveWithKey(opened.linkKey!, opened.domain, opened.hand, give),
    giverSig: await signGiveWithKey(giverKey, opened.domain, opened.hand, give),
  };
}

/* The three ways a Hand is shown, as the study of the link's format arranged them. */

export type Visibility = "public" | "unlisted" | "dark";

export interface Described {
  visibility: Visibility;
  /** What the raiser gives Core at `raise`. */
  dataHash: Hex;
  /** What rides after `#`. */
  linkPart?: Attachments;
  /** What rides before `#`, where a site can see it. */
  publicPart?: Attachments;
  /** What the raiser publishes where the board is (public only). */
  published?: Attachments;
  shape: AddressShape;
}

/**
 * One arrangement of a Hand's description for each option, made of lists of statements and
 * nothing else. The names (`title`, `content`, `salt`, `private`) are the study's, not the SDK's:
 * what an application calls its statements is the application's.
 *
 *   public    the description is published where the board is; the link carries the route alone
 *   unlisted  the title is public and rides before `#`; the rest is a second list behind one
 *             statement of the first, salted, and rides after `#`
 *   dark      the whole description rides after `#`; a salt keeps the dataHash on the chain from
 *             confirming a guess
 */
export function describeHand(visibility: Visibility, title: string, content: string, salt: Hex): Described {
  const titled: Statement = { name: "title", value: textValue(title) };
  const told: Statement = { name: "content", value: textValue(content) };
  const salted: Statement = { name: "salt", value: salt };
  if (visibility === "public") {
    const list = [titled, told];
    return { visibility, dataHash: dataHashOf(list), published: { statements: [list], texts: [title, content] }, shape: "numbered" };
  }
  if (visibility === "unlisted") {
    const hidden = [told, salted];
    const shown: Statement[] = [titled, { name: "private", value: dataHashOf(hidden) }];
    return {
      visibility,
      dataHash: dataHashOf(shown),
      publicPart: { statements: [shown], texts: [title] },
      linkPart: { statements: [hidden], texts: [content] },
      shape: "described",
    };
  }
  const list = [titled, told, salted];
  return { visibility, dataHash: dataHashOf(list), linkPart: { statements: [list], texts: [title, content] }, shape: "bare" };
}

/** A salt for tests: fixed, so that links repeat. */
export function testSalt(label: string): Hex {
  return keccak256(stringToBytes(`aHand link prototype salt: ${label}`));
}
