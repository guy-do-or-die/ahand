/**
 * Raise-only seeder — puts real, public, pinned hands on Base Sepolia so the
 * open-hands board and landing carousel have something true to show.
 *
 * A headless mirror of useRaiseFlow: same buildMetadata, same pinning, same
 * link assembly — byte-identical commitments by construction. Scenario texts
 * are lifted from the v0 seed engine's catalog; the full engine (hops, gives,
 * settles, reputation) targets the previous protocol and ports separately.
 *
 * Run: bun run seed  (from infra/seed; loads ../../.env for PINATA_JWT)
 * Needs: local/demo-key funded with Base Sepolia ETH + USDC.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  stringToHex,
  formatUnits,
  maxUint256,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AHandCoreAbi, AHandSignalsAbi, MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import { buildLiveRoute, newCapability, Visibility as VisibilityOrdinal } from "@ahand/sdk";
import { buildMetadata, assembleLink } from "../../apps/web/app/lib/metadata";
import { publishDiscovery } from "../../apps/web/app/lib/discovery";
import { bearerCapability, handRefFor, packLinkMetadata } from "../../apps/web/app/lib/link";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.SEED_BASE_URL ?? "https://www.ahand.in";
const RPC = process.env.SEED_RPC_URL ?? "https://sepolia.base.org";

/** First line becomes the title; the rest travels in the route body. */
const SCENARIOS: { text: string; rewardUsd: number; giverKeepPct: number; charityBps: number; expiryDays: number }[] = [
  {
    text: "Sublet in central Lisbon for June\nOne bedroom, walkable to Baixa, quiet. Flexible on exact dates. Word-of-mouth beats listing sites for this.",
    rewardUsd: 25, giverKeepPct: 70, charityBps: 100, expiryDays: 35,
  },
  {
    text: "React dev for a 2-day contract, starts Monday\nMigrating a dashboard to TanStack Router, need someone who's done it before. Remote is fine.",
    rewardUsd: 40, giverKeepPct: 75, charityBps: 200, expiryDays: 14,
  },
  {
    text: "Need a Portuguese translator for 30 min tomorrow\nA lease signing at 10am in Príncipe Real. European Portuguese, comfortable with legal terms.",
    rewardUsd: 12, giverKeepPct: 80, charityBps: 100, expiryDays: 7,
  },
  {
    text: "Recommend a dentist in Lisbon who speaks English\nNeed a crown redone, ideally someone a friend actually trusts — not just Google reviews.",
    rewardUsd: 8, giverKeepPct: 70, charityBps: 100, expiryDays: 30,
  },
  {
    text: "Help sourcing 10 refurbished laptops for a school drive\nNeed someone with a supplier contact who can do bulk refurb ThinkPads under budget by end of month.",
    rewardUsd: 30, giverKeepPct: 60, charityBps: 300, expiryDays: 28,
  },
  {
    text: "Two people to help move a couch Saturday morning\nThird floor, no lift, in Graça. Should take an hour, pizza included.",
    rewardUsd: 10, giverKeepPct: 70, charityBps: 100, expiryDays: 6,
  },
  {
    text: "Warm intro to a founder building climate hardware\nRaising a seed round, want to talk to someone who's shipped physical product in the EU. Two hops max, please.",
    rewardUsd: 20, giverKeepPct: 65, charityBps: 150, expiryDays: 40,
  },
];

async function main() {
  const pk = readFileSync(join(HERE, "../../local/demo-key"), "utf8").trim() as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
  const core = DeployedAddresses.AHandCore as `0x${string}`;
  const usd = DeployedAddresses.mockUSD as `0x${string}`;

  if (!process.env.PINATA_JWT && !process.env.WEB3_STORAGE_TOKEN) {
    throw new Error("no pinning key in env — unpinned hands never reach the board");
  }

  const [eth, bal] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: usd, abi: MockUSDAbi, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
  ]);
  const need = SCENARIOS.reduce((s, x) => s + x.rewardUsd, 0);
  console.log(`seeder ${account.address}: ${formatUnits(eth, 18)} ETH, ${formatUnits(bal, 6)} USDC (need ~$${need})`);
  if (bal < parseUnits(String(need), 6)) throw new Error("not enough USDC for the planned pots");

  const allowance = (await pub.readContract({
    address: usd, abi: MockUSDAbi, functionName: "allowance", args: [account.address, core],
  })) as bigint;
  if (allowance < parseUnits(String(need), 6)) {
    const hash = await wallet.writeContract({ address: usd, abi: MockUSDAbi, functionName: "approve", args: [core, maxUint256] });
    await pub.waitForTransactionReceipt({ hash });
    console.log("approved core for USDC");
  }

  const lines: string[] = ["# Seeded hands — links carry the root capability, keep private", ""];
  for (const s of SCENARIOS) {
    // Capability first: public docs embed the bearer secret (open hands),
    // so anyone on the board can join the chain — no link hand-off needed.
    const cap = newCapability();
    const metadata = await buildMetadata({
      text: s.text,
      visibility: "public",
      open: { secret: cap.privateKey },
    });
    const ref = await publishDiscovery(metadata.discoveryBytes);
    if (!ref.pinned) throw new Error(`pin failed for "${metadata.discovery.title}": ${ref.pinError}`);

    const expiry = BigInt(Math.floor(Date.now() / 1000) + s.expiryDays * 24 * 60 * 60);
    const hash = await wallet.writeContract({
      address: core,
      abi: AHandCoreAbi,
      functionName: "raise",
      args: [
        {
          token: usd,
          amount: parseUnits(String(s.rewardUsd), 6),
          expiry: Number(expiry),
          charityRecipient: DeployedAddresses.charity,
          charityBps: s.charityBps,
          minGiverClaimBps: s.giverKeepPct * 100,
          rootCapability: cap.address,
          visibility: VisibilityOrdinal.Public,
          metadataCommitment: metadata.metadataCommitment,
          discoveryCommitment: metadata.discoveryCommitment,
        },
        stringToHex(ref.uri),
        [],
      ],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const raised = parseEventLogs({ abi: AHandCoreAbi, logs: receipt.logs, eventName: "Raised" });
    const handId = (raised[0]?.args as { handId?: bigint })?.handId;
    if (handId === undefined) throw new Error("no Raised event in receipt");

    // RAISED receipt on Signals — anyone can materialize; do it politely here.
    try {
      const mh = await wallet.writeContract({
        address: DeployedAddresses.AHandSignals, abi: AHandSignalsAbi, functionName: "materializeRaised", args: [handId],
      });
      await pub.waitForTransactionReceipt({ hash: mh });
    } catch {
      /* the pocket UI has a retry button for exactly this */
    }

    const url = assembleLink(
      ORIGIN,
      handId,
      { envelopeB64: metadata.envelopeB64, discoveryB64: metadata.discoveryB64, bodyB64: metadata.bodyB64 },
      (meta) =>
        buildLiveRoute({
          handRef: handRefFor(baseSepolia.id, core, handId),
          expiry,
          rootCapability: cap.address,
          shakes: [],
          capability: bearerCapability(cap.privateKey),
          metadata: packLinkMetadata(meta),
        }),
      "public",
      { omitDiscoveryParam: true },
    );
    console.log(`  raised #${handId} "$${s.rewardUsd} ${metadata.discovery.title}" (pinned ${ref.cid.slice(0, 16)}…)`);
    lines.push(`## #${handId} — ${metadata.discovery.title}`, `- pot: $${s.rewardUsd} · expires in ${s.expiryDays}d`, `- ${url}`, "");
  }

  mkdirSync(join(HERE, "out"), { recursive: true });
  const out = join(HERE, "out", "seed-links.md");
  writeFileSync(out, lines.join("\n"));
  console.log(`\ndone: ${SCENARIOS.length} public hands raised · links → ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
