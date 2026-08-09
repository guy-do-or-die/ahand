import { useCallback, useEffect, useState } from "react";
import { useConnection, usePublicClient, useReadContract } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { AHandSignalsAbi, MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import { useSender } from "./useSender";
import { useClaims } from "./useClaims";
import { humanizeChainError } from "../lib/errors";
import { scanLogs } from "../lib/logs";

export type PocketReceiptKind =
  | "gave" // GiverResidual credited to me
  | "passed" // ShakerMargin credited to me
  | "charity" // Charity allocation credited to me
  | "refund" // RaiserRefund credited to me (reclaimed hand)
  | "raised" // my raise — money held
  | "thanked" // my raise, settled — money paid out
  | "tookOut"; // PayoutWithdrawn — claims moved to my pocket

export interface PocketReceipt {
  key: string;
  kind: PocketReceiptKind;
  handId: string;
  /** Display units; sign handling lives in the presentation layer. */
  amount: number;
  timestamp: number;
}

const RAISED = parseAbiItem(
  "event Raised(uint256 indexed handId, address indexed raiser, address indexed token, uint96 credited, uint64 usdScaleAtRaise, uint64 policyRevision, uint40 expiry, address rootCapability, uint8 visibility, bytes32 metadataCommitment, bytes32 discoveryCommitment, bytes discoveryRef, uint16 minGiverClaimBps, address charityRecipient, uint16 charityBps)",
);
const SETTLED = parseAbiItem(
  "event Settled(uint256 indexed handId, address indexed giver, bytes32 solutionHash, bytes32 routeHash, bytes32 giveHash, address token, uint96 creditedPool, uint96 distributablePool, uint96 giverAllocation, address charityRecipient, uint96 charityAllocation, uint64 usdScale, uint256 charityUsd)",
);
const PAYOUT_ALLOCATED = parseAbiItem(
  "event PayoutAllocated(uint256 indexed handId, address indexed token, address indexed beneficiary, uint8 kind, uint8 routePosition, uint96 amount)",
);
const PAYOUT_WITHDRAWN = parseAbiItem(
  "event PayoutWithdrawn(address indexed token, address indexed beneficiary, uint256 amount)",
);
const ROUTE_HOP_SETTLED = parseAbiItem(
  "event RouteHopSettled(uint256 indexed handId, bytes32 indexed routeHash, uint8 position, address parentCapability, address childCapability, uint16 parentClaimBps, uint16 childClaimBps, address shaker, bytes32 shakeHash, bytes32 hopDataHash, uint96 marginAllocation)",
);

const ALLOCATION_KIND: PocketReceiptKind[] = ["charity", "passed", "gave", "refund"];

const FROM_BLOCK = BigInt((DeployedAddresses as { deployBlock?: number }).deployBlock ?? 0);

/**
 * Pocket = the viewer's balances + receipts, derived ONLY from chain events
 * for the connected address (stateless server, no storage). Receipts come
 * straight from PayoutAllocated kinds — no tx-hash correlation games; my
 * Raised events are money held, relabelled "thanked" once their hand
 * settles; PayoutWithdrawn rows are the aggregate take-outs (a withdrawal
 * has no hand — claims pool across hands by design).
 *
 * Also watches my settled raises for unmaterialized Signals receipts —
 * thankSourceKey → processedSource — and offers the permissionless
 * materializeThank retry (payload rebuilt from Settled + RouteHopSettled).
 */
export function usePocket() {
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();
  const { send } = useSender();
  const claims = useClaims();

  const [receipts, setReceipts] = useState<PocketReceipt[] | null>(null);
  /** Settled hands of mine whose THANK receipts are not yet materialized. */
  const [unreceipted, setUnreceipted] = useState<string[]>([]);
  const [materializing, setMaterializing] = useState<string | null>(null);
  const [materializeError, setMaterializeError] = useState("");
  const [scanNonce, setScanNonce] = useState(0);

  const { data: balanceRaw } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockUSDAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  useEffect(() => {
    if (!address || !publicClient) {
      setReceipts(null);
      setUnreceipted([]);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const core = DeployedAddresses.AHandCore;
        const [allocated, withdrawn, raisedMine] = await Promise.all([
          scanLogs(publicClient!, FROM_BLOCK, (range) => publicClient!.getLogs({ address: core, event: PAYOUT_ALLOCATED, args: { beneficiary: address }, ...range })),
          scanLogs(publicClient!, FROM_BLOCK, (range) => publicClient!.getLogs({ address: core, event: PAYOUT_WITHDRAWN, args: { beneficiary: address }, ...range })),
          scanLogs(publicClient!, FROM_BLOCK, (range) => publicClient!.getLogs({ address: core, event: RAISED, args: { raiser: address }, ...range })),
        ]);

        // settlements of hands I raised (to relabel raises as "thanked")
        const myHandIds = raisedMine.map((l) => l.args.handId!);
        const settledOfMine = myHandIds.length
          ? await scanLogs(publicClient!, FROM_BLOCK, (range) => publicClient!.getLogs({ address: core, event: SETTLED, args: { handId: myHandIds }, ...range }))
          : [];
        const settledHandIds = new Set(settledOfMine.map((l) => String(l.args.handId)));

        const blockNumbers = [
          ...new Set([...allocated, ...withdrawn, ...raisedMine].map((l) => l.blockNumber)),
        ];
        const blocks = await Promise.all(blockNumbers.map((bn) => publicClient!.getBlock({ blockNumber: bn })));
        const tsByBlock = new Map(blocks.map((b) => [b.number, Number(b.timestamp) * 1000]));

        const rows: PocketReceipt[] = [];
        for (const log of allocated) {
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            kind: ALLOCATION_KIND[Number(log.args.kind)] ?? "gave",
            handId: String(log.args.handId),
            amount: Number(formatUnits(log.args.amount!, 6)),
            timestamp: tsByBlock.get(log.blockNumber) ?? 0,
          });
        }
        for (const log of withdrawn) {
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            kind: "tookOut",
            handId: "",
            amount: Number(formatUnits(log.args.amount!, 6)),
            timestamp: tsByBlock.get(log.blockNumber) ?? 0,
          });
        }
        for (const log of raisedMine) {
          const handId = String(log.args.handId);
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            kind: settledHandIds.has(handId) ? "thanked" : "raised",
            handId,
            amount: Number(formatUnits(log.args.credited!, 6)),
            timestamp: tsByBlock.get(log.blockNumber) ?? 0,
          });
        }
        rows.sort((a, b) => b.timestamp - a.timestamp);
        if (cancelled) return;
        setReceipts(rows);

        // Signals receipts: which of my settled hands still owe theirs?
        const settledIds = [...settledHandIds];
        if (settledIds.length > 0) {
          const pending: string[] = [];
          await Promise.all(
            settledIds.map(async (hid) => {
              try {
                const key = (await publicClient!.readContract({
                  address: DeployedAddresses.AHandSignals,
                  abi: AHandSignalsAbi,
                  functionName: "thankSourceKey",
                  args: [BigInt(hid)],
                })) as `0x${string}`;
                const processed = (await publicClient!.readContract({
                  address: DeployedAddresses.AHandSignals,
                  abi: AHandSignalsAbi,
                  functionName: "processedSource",
                  args: [key],
                })) as boolean;
                if (!processed) pending.push(hid);
              } catch {
                /* signals not reachable — no button, no noise */
              }
            }),
          );
          if (!cancelled) setUnreceipted(pending.sort());
        } else if (!cancelled) {
          setUnreceipted([]);
        }
      } catch (err) {
        console.error("[pocket] event scan failed:", err);
        if (!cancelled) setReceipts([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [address, publicClient, scanNonce]);

  /** Permissionless materializeThank — payload rebuilt from settlement events. */
  const materialize = useCallback(
    async (handId: string) => {
      if (!publicClient) return;
      setMaterializing(handId);
      setMaterializeError("");
      try {
        const core = DeployedAddresses.AHandCore;
        const [settled, hops] = await Promise.all([
          scanLogs(publicClient, FROM_BLOCK, (range) => publicClient.getLogs({ address: core, event: SETTLED, args: { handId: BigInt(handId) }, ...range })),
          scanLogs(publicClient, FROM_BLOCK, (range) => publicClient.getLogs({ address: core, event: ROUTE_HOP_SETTLED, args: { handId: BigInt(handId) }, ...range })),
        ]);
        const settlement = settled[0];
        if (!settlement) throw new Error("settlement not found on chain");
        const ordered = [...hops].sort((a, b) => Number(a.args.position) - Number(b.args.position));
        await send([
          {
            address: DeployedAddresses.AHandSignals,
            abi: AHandSignalsAbi,
            functionName: "materializeThank",
            args: [
              BigInt(handId),
              settlement.args.giver!,
              ordered.map((h) => h.args.shaker!),
              ordered.map((h) => Number(h.args.parentClaimBps!) - Number(h.args.childClaimBps!)),
            ],
          },
        ]);
        setScanNonce((n) => n + 1);
      } catch (err: any) {
        console.error(err);
        setMaterializeError(humanizeChainError(err).message);
      } finally {
        setMaterializing(null);
      }
    },
    [publicClient, send],
  );

  const balance = balanceRaw !== undefined ? Number(formatUnits(balanceRaw as bigint, 6)) : null;
  const thanksCount = receipts?.filter((r) => r.kind === "gave" || r.kind === "passed").length ?? 0;

  return {
    isConnected,
    address,
    balance,
    receipts,
    thanksCount,
    claims,
    unreceipted,
    materialize,
    materializing,
    materializeError,
  };
}
