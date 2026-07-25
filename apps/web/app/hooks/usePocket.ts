import { useEffect, useState } from "react";
import { useConnection, usePublicClient, useReadContract } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { MockERC20Abi, DeployedAddresses } from "@ahand/abi";

export type PocketReceiptKind = "solved" | "passed" | "raised" | "thanked";

export interface PocketReceipt {
  key: string;
  kind: PocketReceiptKind;
  handId: string;
  /** Signed amount in display units (+ received, − pledged). */
  amount: number;
  timestamp: number;
}

const RAISED = parseAbiItem(
  "event Raised(uint256 indexed handId, address indexed raiser, address token, uint96 amount, uint40 expiry, bytes32 metadataHash)",
);
const SHAKEN = parseAbiItem("event Shaken(uint256 indexed handId, address indexed payout, uint16 marginBps)");
const SETTLED = parseAbiItem("event Settled(uint256 indexed handId, address indexed solver, bytes32 solutionHash)");
const PAYOUT_PUSHED = parseAbiItem("event PayoutPushed(address indexed token, address indexed to, uint96 amount)");

/**
 * Pocket = the viewer's balance + receipts, derived ONLY from chain events
 * for the connected address (stateless server, no storage). Receipt roles:
 * a PayoutPushed to me correlates by tx with Settled(solver=me) → "solved",
 * with Shaken(payout=me) → "passed". My Raised events are money out; once
 * their hand settles they become "thanked".
 *
 * Scans from block 0 — fine on the local chain; a public deployment
 * would bound the range or use an indexer.
 */
export function usePocket() {
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();

  const [receipts, setReceipts] = useState<PocketReceipt[] | null>(null);

  const { data: balanceRaw } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  useEffect(() => {
    if (!address || !publicClient) {
      setReceipts(null);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const core = DeployedAddresses.AHandCore;
        const [pushed, shaken, settledMine, raisedMine] = await Promise.all([
          publicClient!.getLogs({ address: core, event: PAYOUT_PUSHED, args: { to: address }, fromBlock: 0n }),
          publicClient!.getLogs({ address: core, event: SHAKEN, args: { payout: address }, fromBlock: 0n }),
          publicClient!.getLogs({ address: core, event: SETTLED, args: { solver: address }, fromBlock: 0n }),
          publicClient!.getLogs({ address: core, event: RAISED, args: { raiser: address }, fromBlock: 0n }),
        ]);

        // settlements of hands I raised (to relabel raises as "thanked")
        const myHandIds = raisedMine.map((l) => l.args.handId!);
        const settledOfMine = myHandIds.length
          ? await publicClient!.getLogs({ address: core, event: SETTLED, args: { handId: myHandIds }, fromBlock: 0n })
          : [];
        const settledHandIds = new Set(settledOfMine.map((l) => String(l.args.handId)));

        const blockNumbers = [...new Set([...pushed, ...raisedMine].map((l) => l.blockNumber))];
        const blocks = await Promise.all(blockNumbers.map((bn) => publicClient!.getBlock({ blockNumber: bn })));
        const tsByBlock = new Map(blocks.map((b) => [b.number, Number(b.timestamp) * 1000]));

        const solvedTx = new Map(settledMine.map((l) => [l.transactionHash, l]));
        const shakenTx = new Map(shaken.map((l) => [l.transactionHash, l]));

        const rows: PocketReceipt[] = [];
        for (const log of pushed) {
          const solved = solvedTx.get(log.transactionHash);
          const passed = shakenTx.get(log.transactionHash);
          const handId = String(solved?.args.handId ?? passed?.args.handId ?? "");
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            kind: solved ? "solved" : "passed",
            handId,
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
            amount: -Number(formatUnits(log.args.amount!, 6)),
            timestamp: tsByBlock.get(log.blockNumber) ?? 0,
          });
        }
        rows.sort((a, b) => b.timestamp - a.timestamp);
        if (!cancelled) setReceipts(rows);
      } catch (err) {
        console.error("[pocket] event scan failed:", err);
        if (!cancelled) setReceipts([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  const balance = balanceRaw !== undefined ? Number(formatUnits(balanceRaw as bigint, 6)) : null;
  const thanksCount = receipts?.filter((r) => r.amount > 0).length ?? 0;

  return { isConnected, address, balance, receipts, thanksCount };
}
