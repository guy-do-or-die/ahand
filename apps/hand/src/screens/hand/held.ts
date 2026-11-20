import {
  BPS,
  LinkError,
  UntrustedCore,
  carryFor,
  encodeLive,
  fromText,
  isCoreRefusal,
  isDataOf,
  messageIdOf,
  openAddress,
  openLink,
  packAttachments,
  passOn,
  toAddress,
  type AddressShape,
  type Hand,
  type LinkHead,
  type LinkOptions,
  type OpenedAddress,
  type Statement,
} from "@ahand/sdk";
import { BaseError, ContractFunctionRevertedError, isAddressEqual, zeroAddress, type Address } from "viem";

/**
 * The logic of the Hand view and the pass, kept free of React, of the configuration and of the
 * network, so it is tested offline (held.test.ts). Both screens of this package import it; no
 * other screen does.
 *
 * Nothing here writes a link anywhere: the caller holds what these functions return in memory.
 */

/** What this tab holds (store/memory.ts), as far as this module needs it. */
export interface Held {
  /** What stood before `#`: the site, the path and any `?d=`; empty for a bare link pasted alone. */
  before: string;
  fragment: string;
}

/** What the router matched: the path and its params (`chain`, `core`, `hand`), and the query. */
export interface PlaceOf {
  path: string;
  search: string;
  params: Record<string, string>;
}

/** Which of the three arrivals of UX-SPEC §8.2 a place is. */
export type Arrival =
  /** A link this tab holds belongs to this place. */
  | { kind: "link"; held: Held }
  /** A numbered or faced address with no link: the public view. */
  | { kind: "public"; chainId: number; core?: Address; handId: bigint; search: string }
  /** Nothing to show: no link held, no Hand in the path. */
  | { kind: "nothing" };

/** The path of what stood before `#`, or undefined when it is not a web address. */
export function pathOf(before: string): string | undefined {
  if (before === "") return undefined;
  try {
    return new URL(before).pathname;
  } catch {
    return undefined;
  }
}

/**
 * Whether the held link is the one this place shows. A link that arrived with an address belongs
 * to the path it arrived on; a bare link pasted alone belongs to "/" and to the Hand it names.
 * Anything else (a newer Hand's public view opened from a closed one, say) is the public view:
 * the link held for another Hand is never shown under this one's number.
 */
export function arrivalOf(place: PlaceOf, held: Held | undefined, peek?: (fragment: string) => LinkHead | undefined): Arrival {
  const { chain, core, hand } = place.params;
  const numbered = chain !== undefined && hand !== undefined;
  if (held && held.fragment !== "") {
    const path = pathOf(held.before);
    if (!numbered && (held.before === "" || path === "/")) return { kind: "link", held };
    if (numbered && path === place.path) return { kind: "link", held };
    if (numbered && held.before === "" && peek) {
      const head = peek(held.fragment);
      if (head && String(head.chainId) === chain && head.handId.toString() === hand && (core === undefined || isAddressEqual(head.core, core as Address))) {
        return { kind: "link", held };
      }
    }
  }
  if (numbered) {
    return { kind: "public", chainId: Number(chain), ...(core ? { core: core as Address } : {}), handId: BigInt(hand), search: place.search };
  }
  return { kind: "nothing" };
}

/**
 * Opens a held link against the Hand it names: as a whole address when it came with one (what
 * stands before `#` must agree with the link), as a bare link otherwise. `getHand` is the SDK's
 * `getHandFor`, which fails closed on any chain or Core outside the build's list.
 */
export async function openHeld(held: Held, getHand: (head: LinkHead) => Promise<Hand>, options: LinkOptions): Promise<OpenedAddress> {
  if (held.before === "") {
    const opened = await openLink(fromText(held.fragment), getHand, options);
    return { ...opened, seen: { shape: "bare" } };
  }
  return openAddress(`${held.before}#${held.fragment}`, getHand, options);
}

/**
 * A failure as the screen says it: a message id (UX-SPEC §12), the label over it, and, for the
 * lens only, the error's own class name.
 */
export interface Failure {
  id: string;
  /**
   * The label in mono, as written in English: Core's own names (`CORE · NotRaised`) or the app's
   * (`LINK · NOT-THIS-HAND`, `NETWORK`). Tests and the lens read it.
   */
  code: string;
  /** The app-made label in the reader's language (hand/en.ts, ru.ts); absent when the label is Core's own. */
  label?: { id: string; values?: Record<string, string> };
  /** The error's own class name (viem's, say): shown in the lens only, never as the label. */
  detail?: string;
}

/** The label of a failure that the network caused: the reader can try again. */
export const NETWORK = "NETWORK";

/** The LinkError codes the SDK has; each one has its label in hand/en.ts and ru.ts. */
export const LINK_CODES = ["malformed", "unsupported", "non-canonical", "too-long", "another-hand", "not-this-hand", "invalid", "unmatched-data"] as const;

/** Whether a reverted call is somewhere in the error's chain: that is an answer, not the network. */
function reverted(error: BaseError): boolean {
  return error.walk((cause) => cause instanceof ContractFunctionRevertedError) !== null;
}

/**
 * The sentence for anything that stopped a link from opening or a call from going through.
 * "names a contract this site doesn't read", "made by a newer app" and "doesn't know a main
 * contract" are three ids (the SDK's messageIdOf). A route that leaves the helper less than the
 * asker's minimum has its own sentence, Core's `BelowMinClaim`. A transport failure is the
 * network's: labelled NETWORK, said as "your link is still open in this tab" when the tab holds
 * one (`held`), with viem's class name kept for the lens (FINDINGS F2). Anything else is said as
 * unknown, never as a verdict on the link.
 */
export function failureOf(error: unknown, { held = true }: { held?: boolean } = {}): Failure {
  if (error instanceof UntrustedCore) {
    const values = { chain: String(error.chainId), core: error.core };
    return { id: messageIdOf(error), code: `UNTRUSTED · CHAIN ${values.chain} · CORE ${values.core}`, label: { id: "hand.code.untrusted", values } };
  }
  if (error instanceof LinkError) {
    if (error.code === "invalid" && /less than the Hand's minimum/.test(error.message)) {
      return { id: "core.BelowMinClaim", code: "LINK · INVALID · BELOWMINCLAIM", label: { id: "hand.code.belowMinClaim" } };
    }
    return { id: messageIdOf(error), code: `LINK · ${error.code.toUpperCase()}`, label: { id: `hand.code.link.${error.code}` } };
  }
  if (isCoreRefusal(error)) return { id: messageIdOf(error), code: `CORE · ${error.name}` };
  if (error instanceof BaseError && !reverted(error)) {
    return { id: held ? "hand.offline.opening" : "common.time.offline", code: NETWORK, label: { id: "hand.code.network" }, detail: error.name };
  }
  return { id: "common.error.unknown", code: "ERROR", label: { id: "hand.code.error" }, ...(error instanceof Error ? { detail: error.name } : {}) };
}

/** Whether trying again could change the answer: the network's failures and unknown ones, never a verdict on the link. */
export function canRetry(failure: Failure): boolean {
  return failure.code === NETWORK || failure.id === "common.error.unknown";
}

/**
 * The passport's path of a Hand (UX-SPEC §10.1): `/<chain>/<hand>/proof`, with the Core named
 * only when it is not the main contract (the route table has both forms).
 */
export function proofPathOf(chainId: number, core: Address, handId: bigint, canonical: Address | null | undefined): string {
  const named = canonical && isAddressEqual(canonical, core) ? "" : `${core.toLowerCase()}/`;
  return `/${chainId}/${named}${handId}/proof`;
}

/** One hand on the rail (ui/ChainRail's RailHand, kept structural so this module needs no UI). */
export interface RouteHand {
  role: "asker" | "passer" | "helper";
  address?: Address;
}

/**
 * The route as people: the asker, each pass, and the helper of a give link. A pass that named
 * where its share lands shows that address; one that kept nothing is "someone". Positions and
 * facts, never relationships.
 */
export function routeHands(opened: Pick<OpenedAddress, "hand" | "signedShakes" | "signedGive">): RouteHand[] {
  const hands: RouteHand[] = [{ role: "asker", address: opened.hand.raiser }];
  for (const { shake } of opened.signedShakes) {
    hands.push(isAddressEqual(shake.payee, zeroAddress) ? { role: "passer" } : { role: "passer", address: shake.payee });
  }
  if (opened.signedGive) hands.push({ role: "helper", address: opened.signedGive.give.payee });
  return hands;
}

/** One list of statements a holder hung on its own pass (or a giver on its Give), for the lens only. */
export interface HolderStatements {
  /** The pass's position on the route, or "give". */
  at: number | "give";
  statements: Statement[];
}

/**
 * Lists that hang on a pass's or the Give's own dataHash: holders' words, not the asker's. They
 * are shown only in the lens, under "added by a holder, not the asker" (D-36).
 */
export function holderStatements(opened: Pick<OpenedAddress, "signedShakes" | "signedGive" | "statements">): HolderStatements[] {
  const found: HolderStatements[] = [];
  const zero = /^0x0+$/;
  opened.signedShakes.forEach(({ shake }, at) => {
    if (zero.test(shake.dataHash)) return;
    const list = opened.statements.find((candidate) => isDataOf(shake.dataHash, candidate));
    if (list) found.push({ at, statements: list });
  });
  const give = opened.signedGive?.give;
  if (give && !zero.test(give.dataHash)) {
    const list = opened.statements.find((candidate) => isDataOf(give.dataHash, candidate));
    if (list) found.push({ at: "give", statements: list });
  }
  return found;
}

/** The step of the share slider, in basis points: half a percent. */
export const KEEP_STEP = 50;

/**
 * The most a holder can keep: the claim that reached it, less the asker's minimum for the
 * helper (Core refuses a route that leaves less). Rounded down to the slider's step, so the
 * slider's last stop is a share Core takes.
 */
export function keepMax(claimBps: number, minClaimBps: number): number {
  const room = Math.max(0, claimBps - minClaimBps);
  return room - (room % KEEP_STEP);
}

/** The share of the reward a keep of `keepBps` would be if the route is thanked: reward × keep / 10 000. */
export function shareOf(reward: bigint, keepBps: number): bigint {
  return (reward * BigInt(keepBps)) / BigInt(BPS);
}

/** What the written link says about the pass just made, read back from its own bytes. */
export interface ReadBack {
  /** Where the share lands; undefined when the pass keeps nothing. */
  payee?: Address;
  keptBps: number;
  /** The claim the new link passes on. */
  nextClaimBps: number;
  /** How many passes the new link carries. */
  shakes: number;
}

/** Reads the last pass back out of an opened link. */
export function readBackOf(opened: Pick<OpenedAddress, "signedShakes">): ReadBack {
  const last = opened.signedShakes.at(-1);
  if (!last) throw new Error("the link carries no pass to read back");
  const { payee, claimBps, nextClaimBps } = last.shake;
  return {
    ...(isAddressEqual(payee, zeroAddress) ? {} : { payee }),
    keptBps: claimBps - nextClaimBps,
    nextClaimBps,
    shakes: opened.signedShakes.length,
  };
}

/** A pass made: the new address in its shape, the bare digits for a QR, and what it says. */
export interface Made {
  address: string;
  /** The bare address with everything inside, as digits: what a QR carries (D-38, ARCHITECTURE §9). */
  qr: string;
  shape: AddressShape;
  readBack: ReadBack;
}

/**
 * Passes the opened link on (ARCHITECTURE §6 step 6): a new Shake signed by the link key, in
 * this page, with no account. The public part travels on as it came, or everything goes inside
 * for a darker, bare address; never lighter (`carryFor` refuses). The written address is then
 * opened again from its own bytes, against the same Hand, and what it says is returned: the
 * screen shows that, not what was asked for.
 */
export async function makePass(
  opened: OpenedAddress,
  terms: { keepBps: number; payee?: Address },
  shape: AddressShape,
  site: string,
  options: LinkOptions,
): Promise<Made> {
  const { keepBps, payee } = terms;
  if (!Number.isInteger(keepBps) || keepBps < 0) throw new RangeError("a share is a whole number of basis points");
  if (keepBps > 0 && !payee) throw new Error("a share needs an address to land at");
  const claim = opened.end.claimBps;
  if (claim - keepBps < opened.hand.minClaimBps) throw new LinkError("invalid", "the route leaves the giver less than the Hand's minimum");

  const carry = carryFor(opened, shape);
  const outside = carry.outside && packAttachments(carry.outside);
  const passTerms = keepBps === 0 ? { payee: zeroAddress, nextClaimBps: claim } : { payee: payee!, nextClaimBps: claim - keepBps };
  const { link } = await passOn(opened, passTerms, { ...options, ...(outside ? { outside } : {}) }, carry.attachments);
  const address = toAddress({ site, link, shape, ...(carry.outside ? { outside: carry.outside } : {}) }, options);

  // Read back from what was written, with no network: the Hand is the one just proven.
  const written = await openAddress(address, async () => opened.hand, options);
  const bare = shape === "bare" ? link : await encodeLive({ domain: written.domain, hand: written.hand, signedShakes: written.signedShakes, seed: written.seed!, attachments: carryFor(written, "bare").attachments }, options);
  const qr = toAddress({ site, link: bare, shape: "bare", form: "digits" }, options);
  return { address, qr, shape, readBack: readBackOf(written) };
}

/** What a look for a newer Hand by the same asker will read, said before it runs (D-64). */
export interface LaterPlan {
  fromBlock: bigint;
  toBlock: bigint;
  /** The blocks the look covers, at most `maxWindows` windows. */
  blocks: bigint;
  /** The network's time those blocks span, in minutes, at the chain's block time. */
  minutes: number;
}

/** The stretch after a Hand ended that `findLaterHands` reads: from the block it ended in to the latest. */
export function laterPlan(endedBlock: bigint, latest: bigint, blockTimeMs: number, maxWindows = 216, chunk = 2_000): LaterPlan {
  const span = latest >= endedBlock ? latest - endedBlock + 1n : 0n;
  const cap = BigInt(maxWindows) * BigInt(chunk);
  const blocks = span < cap ? span : cap;
  return { fromBlock: endedBlock, toBlock: latest, blocks, minutes: Math.max(1, Math.ceil((Number(blocks) * blockTimeMs) / 60_000)) };
}
