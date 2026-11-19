import { getAddress, keccak256, stringToBytes, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import { domain, signGiveWithKey, type Eip712Domain, type Give, type Hand, type SignedGive } from "../src/index.js";
import { encodeLive, keyOfSeed, openLink, passOn, type LinkOptions, type OpenedLink } from "../src/link.js";

/**
 * A Hand of the tests' own, whose root key comes from a seed: the live links that Core's fixtures
 * cannot give, because their keys are not made from seeds.
 */

export const BASE = 8453;
/** A stand-in for the canonical Core: none is deployed yet. */
export const CORE: Address = getAddress("0xc0dec0dec0dec0dec0dec0dec0dec0dec0dec0de");
export const ownDomain: Eip712Domain = domain(BASE, CORE);
export const ownOptions: LinkOptions = { canonicalCore: CORE };

export const rootSeed: Hex = "0x000102030405060708090a0b0c0d0e0f";
export const giverKey: Hex = keccak256(stringToBytes("a giver of the tests"));

export function ownHand(dataHash: Hex = keccak256(stringToBytes("who can fix a 1978 Vespa in Lisbon?"))): Hand {
  return {
    handId: 123_456n,
    raiser: "0x1111111111111111111111111111111111111111",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rootKey: privateKeyToAddress(keyOfSeed(rootSeed)),
    payoutGasK: 200,
    minClaimBps: 5_000,
    dataHash,
  };
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
