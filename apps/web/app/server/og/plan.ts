import { createPublicClient, http } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { activeChain } from "../../config/web3";
import { Discovery, b64urlDecode, verifyDiscoveryParam } from "../../lib/metadata";
import type { HandAbiOutput } from "../../lib/hand";

/**
 * What /api/og/$id may draw, decided before any rendering. ?e= is caller
 * controlled: a hand card shows its text only when ?e= hashes to that hand's
 * on-chain discoveryCommitment. The raise page's draft card has no anchor
 * yet, so it is served to same-origin requests only and never cached.
 */

export type OgCardPlan =
  | {
      status: 200;
      /** Discovery text to draw; null draws the generic card. */
      preview: { title: string; teaser?: string } | null;
      headers: Record<string, string>;
    }
  | { status: 403 | 404 };

/** base64url of /api/pin's 4096-byte discovery doc ceiling. */
const MAX_E_CHARS = 5462;

// discoveryCommitment is fixed at raise, so a verified card never changes; a
// generic one may turn into a titled card once the hand is raised.
const VERIFIED = { "Cache-Control": "public, max-age=31536000, immutable" };
const GENERIC = { "Cache-Control": "public, max-age=300" };
const DRAFT = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

const client = createPublicClient({ chain: activeChain, transport: http() });

/**
 * A page's own <img> load says Sec-Fetch-Site: same-origin; a scraper or a
 * foreign page cannot make a browser say that. Browsers predating Fetch
 * Metadata still send a same-host Referer for their own images.
 */
function isSameOrigin(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const referer = headers.get("referer");
  const host = headers.get("host");
  if (!referer || !host) return false;
  try {
    return new URL(referer).host === host;
  } catch {
    return false;
  }
}

function parseDraft(e: string): { title: string; teaser?: string } | null {
  try {
    const doc = Discovery.parse(JSON.parse(new TextDecoder().decode(b64urlDecode(e))));
    return { title: doc.title, teaser: doc.teaser };
  } catch {
    return null;
  }
}

/** `file` is the $id segment: "<handId>.png" or "draft.png". */
export async function planOgCard(file: string, e: string | null, headers: Headers): Promise<OgCardPlan> {
  const param = e && e.length <= MAX_E_CHARS ? e : null;

  if (file === "draft.png") {
    if (!isSameOrigin(headers)) return { status: 403 };
    return { status: 200, preview: param ? parseDraft(param) : null, headers: DRAFT };
  }

  const handId = /^(\d{1,18})\.png$/.exec(file)?.[1];
  if (!handId) return { status: 404 };
  if (!param) return { status: 200, preview: null, headers: GENERIC };

  let discoveryCommitment: `0x${string}`;
  try {
    const hand = (await client.readContract({
      address: DeployedAddresses.AHandCore,
      abi: AHandCoreAbi,
      functionName: "getHand",
      args: [BigInt(handId)],
    })) as HandAbiOutput;
    discoveryCommitment = hand.discoveryCommitment;
  } catch {
    // No anchor to check against right now: generic, and nobody keeps it.
    return { status: 200, preview: null, headers: { "Cache-Control": "no-store" } };
  }

  const doc = await verifyDiscoveryParam(param, discoveryCommitment);
  return doc
    ? { status: 200, preview: { title: doc.title, teaser: doc.teaser }, headers: VERIFIED }
    : { status: 200, preview: null, headers: GENERIC };
}
