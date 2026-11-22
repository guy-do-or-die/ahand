import { isAddressEqual, zeroAddress, type Address, type Hex } from "viem";

import { giveHash } from "./hash.js";
import type { Eip712Domain, Hand, SignedGive, SignedShake } from "./types.js";

/**
 * Re-signed Gives: a later Give for the same Hand whose route drops holders of a route already
 * seen. Judged by Hand and route, never by signer alone, so one-time keys do not defeat it.
 *
 * A route is its keys: the Hand's root key, then each Shake's next key. Keys are fresh at every
 * pass, so a key on two routes is the same link in the same hands. The holder at position k holds
 * keys[k] and signs Shake k, which pays payees[k] if it kept a share.
 *
 *   re-signed  the route rejoins a key of an earlier route after skipping its holders (a middle
 *              cut); or the same payee or signer as an earlier Give appears on a route that drops
 *              holders who kept a share (a tail cut by the same person)
 *   branch     any other route: a holder passed the link to two people, and both lines are fair
 *   same       the Give already seen
 *   first      nothing seen for this Hand yet
 */

/**
 * A Give as the raiser's device has seen it: by Hand and route, never by signer. A Hand is its
 * chain, its Core and its number: the same number on another chain or Core is another Hand.
 */
export interface SeenGive {
  chainId: number;
  core: Address;
  handId: bigint;
  /** The route's keys from the root key on (`routeKeys`). */
  keys: Address[];
  /** The payee of each Shake, in route order (zero where a Shake kept nothing). */
  payees: Address[];
  signer: Address;
  payee: Address;
  giveHash: Hex;
}

/** A holder a later route left out. */
export interface DroppedHolder {
  /** The holder's place on the earlier route: it held `keys[position]` and signed Shake `position`. */
  position: number;
  key: Address;
  /** What that holder's Shake paid; absent where it kept nothing. */
  payee?: Address;
}

export type GiveVerdict = "first" | "same" | "branch" | "re-signed";

/** The root key, then each Shake's next key. */
export function routeKeys(hand: Hand, signedShakes: readonly SignedShake[]): Address[] {
  return [hand.rootKey, ...signedShakes.map(({ shake }) => shake.nextKey)];
}

/** A Give in the form `judgeGive` compares, from what an opened give link holds (`opened.domain`, `opened.hand`, …). */
export function seenGiveOf(
  domain: Eip712Domain,
  hand: Hand,
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
): SeenGive {
  const { give } = signedGive;
  return {
    chainId: domain.chainId,
    core: domain.verifyingContract,
    handId: hand.handId,
    keys: routeKeys(hand, signedShakes),
    payees: signedShakes.map(({ shake }) => (shake.nextClaimBps < shake.claimBps ? shake.payee : zeroAddress)),
    signer: give.signer,
    payee: give.payee,
    giveHash: giveHash(hand, give),
  };
}

function holderAt(route: SeenGive, position: number): DroppedHolder {
  const payee = route.payees[position];
  const holder: DroppedHolder = { position, key: route.keys[position] };
  if (payee !== undefined && !isAddressEqual(payee, zeroAddress)) holder.payee = payee;
  return holder;
}

/** The earlier route's holders that a later route skips before rejoining one of its keys. */
function skippedOnRejoin(earlier: SeenGive, later: SeenGive): DroppedHolder[] {
  const placeOf = new Map(earlier.keys.map((key, position) => [key.toLowerCase(), position]));
  const skipped: DroppedHolder[] = [];
  let last = -1;
  for (const key of later.keys) {
    const place = placeOf.get(key.toLowerCase());
    if (place === undefined) continue;
    for (let position = last + 1; position < place; ++position) skipped.push(holderAt(earlier, position));
    last = Math.max(last, place);
  }
  return skipped;
}

/** The earlier route's holders after the two routes part that kept a share and are not on the later one. */
function droppedPaid(earlier: SeenGive, later: SeenGive): DroppedHolder[] {
  const onLater = new Set(later.keys.map((key) => key.toLowerCase()));
  let common = 0;
  while (common < earlier.keys.length && common < later.keys.length && isAddressEqual(earlier.keys[common], later.keys[common])) ++common;
  const dropped: DroppedHolder[] = [];
  // Holder common-1 signed on both routes; the holders after it on the earlier route are the ones left out.
  for (let position = common; position < earlier.payees.length; ++position) {
    const holder = holderAt(earlier, position);
    if (holder.payee !== undefined && !onLater.has(holder.key.toLowerCase())) dropped.push(holder);
  }
  return dropped;
}

function sharePerson(earlier: SeenGive, later: SeenGive): boolean {
  const them = [earlier.signer, earlier.payee].filter((address) => !isAddressEqual(address, zeroAddress));
  return [later.signer, later.payee].some((address) => them.some((other) => isAddressEqual(address, other)));
}

export function judgeGive(seen: SeenGive[], incoming: SeenGive): { verdict: GiveVerdict; dropped: DroppedHolder[] } {
  const earlier = seen.filter(
    (give) => give.handId === incoming.handId && give.chainId === incoming.chainId && isAddressEqual(give.core, incoming.core),
  );
  if (earlier.length === 0) return { verdict: "first", dropped: [] };
  if (earlier.some((give) => give.giveHash.toLowerCase() === incoming.giveHash.toLowerCase())) return { verdict: "same", dropped: [] };

  const dropped = new Map<string, DroppedHolder>();
  const add = (holders: DroppedHolder[]) => {
    for (const holder of holders) if (!dropped.has(holder.key.toLowerCase())) dropped.set(holder.key.toLowerCase(), holder);
  };
  for (const route of earlier) {
    add(skippedOnRejoin(route, incoming));
    if (sharePerson(route, incoming)) add(droppedPaid(route, incoming));
  }
  if (dropped.size === 0) return { verdict: "branch", dropped: [] };
  return { verdict: "re-signed", dropped: [...dropped.values()].sort((a, b) => a.position - b.position) };
}
