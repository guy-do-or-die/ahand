import { raiserHops, type Hand, type SignedGive, type SignedShake } from "@ahand/sdk";
import { isAddressEqual, zeroAddress, type Address } from "viem";

/*
 * The rail's people, worked out from a signed route. No React here, so screens' pure modules
 * (screens/hand/held.ts) and their tests use it too; ChainRail draws what it returns.
 */

/** One hand on the route. Labels are positions and facts, never relationships (UX-SPEC §8.2). */
export interface RailHand {
  role: "asker" | "passer" | "helper";
  /** Shown short and in mono. Leave it out where no address was named: the rail says "someone". */
  address?: Address;
  /** A name the caller has proved for the address (an ENS name that resolves both ways). */
  name?: string;
  /**
   * "asker": this pass paid its share to, or handed the link to, the asker's own address (the
   * SDK's `raiserHops`; brief 02 duties 11 and 23). Core allows it; the rail says so on the hand
   * and on its back.
   */
  flag?: "asker";
  /**
   * A holder a later, re-signed route left out (R-29, UX-SPEC §7.5.2): drawn crossed out with the
   * share it had kept, and said to screen readers as left out. It is not part of the signed route,
   * so it never turns over and is not counted among the hands.
   */
  dropped?: { share?: string };
}

/** A holder a later route left out, at its place on the earlier route (the SDK's `judgeGive`). */
export interface LeftOut {
  /** It held `keys[position]` of the earlier route and signed its Shake `position`. */
  position: number;
  key: Address;
  payee?: Address;
  /** The share it had kept, already written for the page ("10%"); absent where it kept nothing. */
  share?: string;
}

/**
 * The hands of a signed route, as every screen draws them: the asker, one hand per Shake (named by
 * the payee it wrote, "someone" where it wrote none), and the helper of a Give (named by
 * its payee, or by its signer where the screen speaks about who answered). A pass whose payee or
 * next key is the asker's own address carries the "asker" flag (`raiserHops`, duty 11). Holders a
 * re-signed route left out are put back at their places, crossed out (UX-SPEC §7.5.2).
 */
export function railHandsOf(
  route: { hand: Pick<Hand, "raiser">; signedShakes: readonly SignedShake[]; signedGive?: SignedGive },
  options: { helper?: "payee" | "signer"; leftOut?: readonly LeftOut[] } = {},
): RailHand[] {
  const flagged = new Set(raiserHops(route.hand.raiser, route.signedShakes).map((hop) => hop.position));
  const passes: RailHand[] = route.signedShakes.map(({ shake }, position) => ({
    role: "passer",
    ...(isAddressEqual(shake.payee, zeroAddress) ? {} : { address: shake.payee }),
    ...(flagged.has(position) ? { flag: "asker" as const } : {}),
  }));
  // Walk the earlier route's places: a left-out holder stands at its own place, the later route's
  // passes fill the others in order.
  const left = [...(options.leftOut ?? [])].sort((a, b) => a.position - b.position);
  const merged: RailHand[] = [];
  let next = 0;
  for (let place = 0; next < passes.length || left.some((holder) => holder.position >= place); place++) {
    const out = left.find((holder) => holder.position === place);
    if (out) merged.push({ role: "passer", address: out.payee ?? out.key, dropped: out.share ? { share: out.share } : {} });
    else if (next < passes.length) merged.push(passes[next++]!);
  }
  const hands: RailHand[] = [{ role: "asker", address: route.hand.raiser }, ...merged];
  if (route.signedGive) hands.push({ role: "helper", address: options.helper === "signer" ? route.signedGive.give.signer : route.signedGive.give.payee });
  return hands;
}

