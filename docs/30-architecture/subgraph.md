# Subgraph

`packages/subgraph` is a Graph subgraph indexing `AHandCore` on Base Sepolia (manifest network `base-sepolia`, Subgraph Studio target `ahand-base-sepolia`). It has a single datasource — Core; there is no Signals or Witness datasource. It is an application-layer convenience: Core events are the facts, the subgraph is one queryable projection of them, and its outage affects nothing user-facing today.

**Honest status:** the web app reads chain state directly over RPC and does not query the subgraph yet.

## Entities (`schema.graphql`)

- **`Hand`** — id `"<core hex>-<handId hex>"` (lowercase, 0x-prefixed). The full raise snapshot: raiser, status (`Active`/`Settled`/`Reclaimed`), token, `creditedReward`, `usdScaleAtRaise`, `policyRevision`, expiry, `rootCapability`, visibility, `metadataCommitment`, `discoveryCommitment`, `discoveryRef` (opaque bytes, e.g. an `ipfs://` locator; empty for Dark), `minGiverClaimBps`, charity recipient and bps, plus reclaim fields and create/update provenance. `handRef` is `keccak256(abi.encode(chainId, core, handId))`, byte-identical to the contract/SDK `HandRef` hash; the chainId derives from the manifest network name and `handRef` is null rather than guessed on unknown networks.
- **`HandTag`** — immutable join entity per tag, id `"<hand id>-<tagId hex>"`, keeping the position within the `HandTagged` array. Tags are opaque `bytes32`.
- **`Settlement`** — immutable, 1:1 with the Hand (same id): giver, `solutionHash`, `routeHash`, `giveHash`, pools, giver/charity allocations, `usdScale`, and `charityUsd` (uint256-exact).
- **`RouteHop`** — immutable, id `"<hand id>-<position>"`. One entity per settled route occurrence — occurrences are never collapsed: anonymous hops (`shaker = 0x0`) and repeated use of one Shaker account each remain distinct rows. Carries capability linkage, claim bps, exact `marginBps`, `shakeHash`, `hopDataHash`, and `marginAllocation`; `shakerActor` links an `Actor` only for attributed shakers.
- **`PayoutAllocation`** — immutable, id `"<tx hash>-<logIndex>"`; kind `Charity | ShakerMargin | GiverResidual | RaiserRefund`, route position for shaker margins.
- **`Withdrawal`** — immutable, id `"<tx hash>-<logIndex>"`. Deliberately carries no Hand link: on-chain claims pool across Hands per `(token, beneficiary)`, so attributing a withdrawal to a single Hand would be an invention.
- **`Actor`** — id = lowercase address hex. Protocol-fact counters only (`raisedCount`, `reclaimedCount`, `giverSettlementCount`, `shakerHopCount` — hop occurrences, not distinct Hands — allocation/withdrawal counts and totals) with provenance. No scores, no ENS, no Signals data.
- **`TokenPolicy`** / **`CharityPolicy`** — mutable current prospective-policy state; latest event wins, provenance is the last update.

All monetary amounts are `BigInt` in raw reward-token units; the mappings use no floating point.

## Handlers (`src/mapping.ts`)

`handleRaised`, `handleHandTagged`, `handleSettled`, `handleRouteHopSettled`, `handleReclaimed`, `handlePayoutAllocated`, `handlePayoutWithdrawn`, `handleTokenPolicyUpdated`, `handleCharityPolicyUpdated`. They rely on Core's in-transaction event ordering (`Raised` before `HandTagged`; `Settled` before `RouteHopSettled` and `PayoutAllocated`), so parent entities exist when children arrive and missing parents are only logged defensively. `PayoutPushed`/`PayoutDeferred` are not indexed at this baseline — allocations and withdrawals already carry the exact amounts.

## Build and deploy

```text
bun run prepare:manifest    # scripts/prepare.ts → subgraph.base-sepolia.yaml
bun run codegen             # graph codegen
bun run build               # graph build
bun run deploy:studio       # graph deploy ahand-base-sepolia
```

`subgraph.<chain>.yaml` is generated from `subgraph.template.yaml` — never hand-edited. `scripts/prepare.ts` fills network, `AHandCore` address, and `startBlock` from `packages/abi/src/addresses.<chain>.json` (the deployment registry; `deployBlock` there becomes `startBlock`), and prefers the generated full ABI from `packages/abi` when it declares all nine indexed events with the frozen signatures, falling back to the package's hand-written events-only fragments otherwise.

## Not built

No Signals indexing (receipts, Up balances), no Witness indexing, no derived trust views, and no client consumes the subgraph yet. If Signals indexing is added, Core-authenticated receipts must stay distinguishable from user-issued `up()` actions, and no projection may present receipt counts or margins as a universal trust score. Event semantics live in [events and indexing](../20-protocol/events-and-indexing.md).
