import { createPublicClient, http, formatUnits } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { activeChain } from "../config/web3";
import { cidFromSha256Hex, gatewayUrl, verifyDiscoveryBytes } from "./discovery";
import { Discovery, b64urlDecode, reopenFromDiscovery, sha256hex } from "./metadata";
import { mapHand, type HandAbiOutput } from "./hand";

/**
 * The open-hands feed, straight from the chain — no indexer. handsCount
 * bounds a newest-first scan; each public+active hand's discoveryCommitment
 * doubles as the sha256 inside its CIDv1 locator, so the doc is fetched
 * from a gateway and verified byte-for-byte against the on-chain anchor
 * before anything renders. Unpinned or unreachable docs simply drop out.
 *
 * Runs wherever the route loader runs (server on first paint, browser on
 * navigation) — both ends can read the chain and GET a public gateway.
 */

export type OpenHand = {
  /** Decimal handId, ready for /h/$id. */
  id: string;
  title: string;
  teaser?: string;
  potUsd: number;
  charityBps: number;
  /** Unix seconds. */
  expiry: number;
  /** True when the doc carries open-hand extras — joinable straight from the board. */
  open: boolean;
};

/** Newest hands considered per refresh — a board, not an archive. */
const SCAN_WINDOW = 24;
const FETCH_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60_000;

let cache: { at: number; hands: OpenHand[] } | null = null;

async function fetchDocBytes(cid: string): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(gatewayUrl(cid), { signal: controller.signal });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Never throws — the board and the landing degrade to "no hands" quietly. */
export async function listOpenHands(limit = 8): Promise<OpenHand[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.hands.slice(0, limit);
  const client = createPublicClient({ chain: activeChain, transport: http() });
  try {
    const count = (await client.readContract({
      address: DeployedAddresses.AHandCore,
      abi: AHandCoreAbi,
      functionName: "handsCount",
    })) as bigint;
    const ids: bigint[] = [];
    for (let id = count; id > 0n && ids.length < SCAN_WINDOW; id--) ids.push(id);

    const nowSec = Math.floor(Date.now() / 1000);
    const found = await Promise.all(
      ids.map(async (id): Promise<OpenHand | null> => {
        try {
          const hand = mapHand(
            (await client.readContract({
              address: DeployedAddresses.AHandCore,
              abi: AHandCoreAbi,
              functionName: "getHand",
              args: [id],
            })) as HandAbiOutput,
          );
          if (hand.visibility !== "public" || hand.status !== "active") return null;
          if (hand.expiry <= nowSec) return null;
          const cid = cidFromSha256Hex(hand.discoveryCommitment);
          const bytes = await fetchDocBytes(cid);
          if (!bytes || !(await verifyDiscoveryBytes(bytes, cid))) return null;
          const doc = Discovery.parse(JSON.parse(new TextDecoder().decode(bytes)));
          // The board lists only verifiably joinable hands: the doc must
          // reopen (open extras present) AND the rebuilt envelope must match
          // the hand's on-chain metadataCommitment — a legacy or doctored
          // doc drops out instead of dead-ending on a locked page.
          const reopened = await reopenFromDiscovery(bytes);
          if (!reopened) return null;
          const envHash = await sha256hex(b64urlDecode(reopened.metaParts.envelopeB64));
          if (envHash !== hand.metadataCommitment) return null;
          return {
            id: id.toString(),
            title: doc.title,
            teaser: doc.teaser,
            potUsd: Number(formatUnits(hand.creditedReward, 6)),
            charityBps: hand.charityBps,
            expiry: hand.expiry,
            open: true,
          };
        } catch {
          return null; // one bad hand never empties the board
        }
      }),
    );

    const hands = found.filter((h): h is OpenHand => h !== null);
    cache = { at: Date.now(), hands };
    return hands.slice(0, limit);
  } catch {
    return cache?.hands.slice(0, limit) ?? [];
  }
}
