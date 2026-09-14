import { createPublicClient, http, formatUnits } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { activeChain } from "../config/web3";
import { fetchDiscoveryByCommitment } from "./discovery";
import {
  Discovery,
  b64urlDecode,
  reopenFromDiscovery,
  sha256hex,
} from "./metadata";
import { mapHand, type HandAbiOutput } from "./hand";

/**
 * The open-hands feed, straight from the chain — no indexer. handsCount
 * bounds a newest-first scan; each public+active hand's discoveryCommitment
 * doubles as the sha256 inside its CIDv1 locator, so the doc is fetched
 * from a gateway and verified byte-for-byte against the on-chain anchor
 * before anything renders. A failed load is distinct from an empty board.
 *
 * Loaded in the browser after first paint, without blocking the page.
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
const CACHE_TTL_MS = 60_000;

let cache: { at: number; hands: OpenHand[] } | null = null;

/** Throws if reads fail and no verified cards are available; failures are never cached. */
export async function listOpenHands(limit = 8): Promise<OpenHand[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.hands
      .filter((hand) => hand.expiry > Math.floor(Date.now() / 1000))
      .slice(0, limit);
  }
  const client = createPublicClient({
    chain: activeChain,
    transport: http(import.meta.env.VITE_RPC_URL as string | undefined),
  });
  const count = (await client.readContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "handsCount",
  })) as bigint;
  const ids: bigint[] = [];
  for (let id = count; id > 0n && ids.length < SCAN_WINDOW; id--) ids.push(id);

  const nowSec = Math.floor(Date.now() / 1000);
  const found = await Promise.allSettled(
    ids.map(async (id): Promise<OpenHand | null> => {
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
      const bytes = await fetchDiscoveryByCommitment(hand.discoveryCommitment);
      if (!bytes) throw new Error(`Could not load discovery for hand ${id}`);
      const doc = Discovery.parse(JSON.parse(new TextDecoder().decode(bytes)));
      // The board lists only verifiably joinable hands: the doc must
      // reopen (open extras present) AND the rebuilt envelope must match
      // the hand's on-chain metadataCommitment — a legacy or doctored
      // doc drops out instead of dead-ending on a locked page.
      const reopened = await reopenFromDiscovery(bytes);
      if (!reopened) return null;
      const envHash = await sha256hex(
        b64urlDecode(reopened.metaParts.envelopeB64),
      );
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
    }),
  );

  const hands = found.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const incomplete = found.some((result) => result.status === "rejected");
  if (incomplete && hands.length === 0)
    throw new Error("Could not load open hands");
  // One unavailable hand must not hide the others or cache a partial scan.
  if (!incomplete) cache = { at: Date.now(), hands };
  return hands.slice(0, limit);
}
