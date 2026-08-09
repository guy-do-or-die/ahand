import { createAPIFileRoute } from "@tanstack/start/api";
import { createPublicClient, http } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { activeChain } from "../config/web3";
import { mapHand, type HandAbiOutput } from "../lib/hand";
import { fetchDiscoveryByCommitment } from "../lib/discovery";
import { reopenFromDiscovery, sha256hex, b64urlDecode } from "../lib/metadata";
import { buildAppHop } from "../lib/appHop";

/**
 * The app's first-Shaker hop for open board hands. The client sends a handId;
 * the server re-derives everything from chain + the pinned doc (nothing the
 * caller says is trusted), then returns the root→child Shake signed by the
 * root capability, aHand's ShakerAcceptance, and the child bearer secret for
 * this visitor's branch. APP_SHAKER_KEY stays server-side; without it the
 * endpoint reports unavailable and clients fall back to the bare root.
 */
const client = createPublicClient({ chain: activeChain, transport: http() });

export const APIRoute = createAPIFileRoute("/api/app-hop")({
  POST: async ({ request }) => {
    try {
      const appKey = process.env.APP_SHAKER_KEY as `0x${string}` | undefined;
      if (!appKey || !/^0x[0-9a-fA-F]{64}$/.test(appKey)) {
        return Response.json({ error: "app hop unavailable" }, { status: 503 });
      }

      const { handId: rawId } = (await request.json()) as { handId?: string };
      if (typeof rawId !== "string" || !/^\d{1,18}$/.test(rawId)) {
        return Response.json({ error: "bad request" }, { status: 400 });
      }
      const handId = BigInt(rawId);

      const hand = mapHand(
        (await client.readContract({
          address: DeployedAddresses.AHandCore,
          abi: AHandCoreAbi,
          functionName: "getHand",
          args: [handId],
        })) as HandAbiOutput,
      );
      const nowSec = Math.floor(Date.now() / 1000);
      if (hand.status !== "active" || hand.visibility !== "public" || hand.expiry <= nowSec) {
        return Response.json({ error: "not an open active hand" }, { status: 409 });
      }

      const docBytes = await fetchDiscoveryByCommitment(hand.discoveryCommitment);
      if (!docBytes) return Response.json({ error: "doc unavailable" }, { status: 404 });
      const reopened = await reopenFromDiscovery(docBytes);
      if (!reopened) return Response.json({ error: "not an open hand" }, { status: 409 });
      // Fail closed exactly like the client: the rebuilt envelope must be the
      // committed one, and the root secret must control the committed root.
      const envHash = await sha256hex(b64urlDecode(reopened.metaParts.envelopeB64));
      if (envHash !== hand.metadataCommitment) {
        return Response.json({ error: "doc does not match commitment" }, { status: 409 });
      }

      const charity =
        (hand.creditedReward * BigInt(hand.charityBps)) / 10000n;
      const hop = await buildAppHop({
        handId,
        expiry: BigInt(hand.expiry),
        rootSecret: reopened.secret,
        minGiverClaimBps: hand.minGiverClaimBps,
        distributable: hand.creditedReward - charity,
        chainId: activeChain.id,
        core: DeployedAddresses.AHandCore,
        appKey,
      });

      return Response.json({
        shake: {
          handId: rawId,
          childCapability: hop.signedShake.shake.childCapability,
          shaker: hop.signedShake.shake.shaker,
          parentClaimBps: hop.signedShake.shake.parentClaimBps,
          childClaimBps: hop.signedShake.shake.childClaimBps,
          hopDataHash: hop.signedShake.shake.hopDataHash,
          deadline: hop.signedShake.shake.deadline.toString(),
        },
        signature: hop.signedShake.signature,
        acceptanceSig: hop.signedShake.acceptanceSig,
        childSecret: hop.childSecret,
        marginBps: hop.marginBps,
      });
    } catch (err: any) {
      return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
    }
  },
});
