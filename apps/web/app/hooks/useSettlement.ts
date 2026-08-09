import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { AHandSignalsAbi, DeployedAddresses } from "@ahand/abi";
import { scanLogs } from "../lib/logs";

const SETTLED = parseAbiItem(
  "event Settled(uint256 indexed handId, address indexed giver, bytes32 solutionHash, bytes32 routeHash, bytes32 giveHash, address token, uint96 creditedPool, uint96 distributablePool, uint96 giverAllocation, address charityRecipient, uint96 charityAllocation, uint64 usdScale, uint256 charityUsd)",
);
const ROUTE_HOP_SETTLED = parseAbiItem(
  "event RouteHopSettled(uint256 indexed handId, bytes32 indexed routeHash, uint8 position, address parentCapability, address childCapability, uint16 parentClaimBps, uint16 childClaimBps, address shaker, bytes32 shakeHash, bytes32 hopDataHash, uint96 marginAllocation)",
);

const FROM_BLOCK = BigInt((DeployedAddresses as { deployBlock?: number }).deployBlock ?? 0);

export interface SettledHop {
  position: number;
  /** Zero address = anonymous pass. */
  shaker: `0x${string}`;
  marginUsd: number;
}

export interface Settlement {
  giver: `0x${string}`;
  giverUsd: number;
  charityRecipient: `0x${string}`;
  charityUsd: number;
  hops: SettledHop[];
  /** Soulbound receipts already materialized on Signals? */
  receiptsMinted: boolean | null;
}

/**
 * The receipt of a settled hand, rebuilt from the Settled + RouteHopSettled
 * events (chunk-scanned — public RPCs cap ranges) plus the Signals
 * idempotence flag. Chain facts only; null while loading or when the hand
 * isn't settled.
 */
export function useSettlement(id: string, enabled: boolean) {
  const publicClient = usePublicClient();
  const [settlement, setSettlement] = useState<Settlement | null>(null);

  useEffect(() => {
    if (!enabled || !publicClient) {
      setSettlement(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const core = DeployedAddresses.AHandCore;
        const [settled, hops] = await Promise.all([
          scanLogs(publicClient!, FROM_BLOCK, (range) =>
            publicClient!.getLogs({ address: core, event: SETTLED, args: { handId: BigInt(id) }, ...range }),
          ),
          scanLogs(publicClient!, FROM_BLOCK, (range) =>
            publicClient!.getLogs({ address: core, event: ROUTE_HOP_SETTLED, args: { handId: BigInt(id) }, ...range }),
          ),
        ]);
        const s = settled[0];
        if (!s || cancelled) return;

        let receiptsMinted: boolean | null = null;
        try {
          const key = (await publicClient!.readContract({
            address: DeployedAddresses.AHandSignals,
            abi: AHandSignalsAbi,
            functionName: "thankSourceKey",
            args: [BigInt(id)],
          })) as `0x${string}`;
          receiptsMinted = (await publicClient!.readContract({
            address: DeployedAddresses.AHandSignals,
            abi: AHandSignalsAbi,
            functionName: "processedSource",
            args: [key],
          })) as boolean;
        } catch {
          /* signals unreachable — the receipt still shows the money story */
        }

        if (cancelled) return;
        setSettlement({
          giver: s.args.giver!,
          giverUsd: Number(formatUnits(s.args.giverAllocation!, 6)),
          charityRecipient: s.args.charityRecipient!,
          charityUsd: Number(formatUnits(s.args.charityAllocation!, 6)),
          hops: [...hops]
            .sort((a, b) => Number(a.args.position) - Number(b.args.position))
            .map((h) => ({
              position: Number(h.args.position),
              shaker: h.args.shaker!,
              marginUsd: Number(formatUnits(h.args.marginAllocation!, 6)),
            })),
          receiptsMinted,
        });
      } catch (err) {
        console.error("[settlement] event scan failed:", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, publicClient, id]);

  return settlement;
}
