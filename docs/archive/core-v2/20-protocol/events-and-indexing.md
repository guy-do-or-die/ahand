# Events and indexing

Events let an independent indexer reconstruct lifecycle, economics, policy history, route attribution, and payout state without trusting any application database. The signatures below are copied from the Solidity in `contracts/src`. Enum-typed parameters (`Visibility`, `AllocationKind`) appear as `uint8` in the ABI.

## AHandCore events

### Raised

```solidity
event Raised(
    uint256 indexed handId,
    address indexed raiser,
    address indexed token,
    uint96     credited,
    uint64     usdScaleAtRaise,
    uint64     policyRevision,
    uint40     expiry,
    address    rootCapability,
    Visibility visibility,
    bytes32    metadataCommitment,
    bytes32    discoveryCommitment,
    bytes      discoveryRef,
    uint16     minGiverClaimBps,
    address    charityRecipient,
    uint16     charityBps
);
```

Once per raise, carrying the full immutable policy snapshot plus the `policyRevision` observed at raise, so indexers need no extra reads. These snapshot fields stay true for the Hand even if prospective policy later changes. `discoveryRef` is empty and `discoveryCommitment` zero for `Dark` Hands.

### HandTagged

```solidity
event HandTagged(uint256 indexed handId, address indexed raiser, bytes32[] tagIds);
```

Emitted only when the raise carried tags; `tagIds` is strictly ascending, unique, and non-zero. Tags are opaque `bytes32` labels to Core.

### Settled

```solidity
event Settled(
    uint256 indexed handId,
    address indexed giver,
    bytes32 solutionHash,
    bytes32 routeHash,
    bytes32 giveHash,
    address token,
    uint96  creditedPool,
    uint96  distributablePool,
    uint96  giverAllocation,
    address charityRecipient,
    uint96  charityAllocation,
    uint64  usdScale,
    uint256 charityUsd
);
```

Summarizes the pool split of a successful `thank`: `creditedPool = P`, `distributablePool = P − charityAllocation`, and `charityUsd = charityAllocation * usdScale` (1e18-scaled USD). The same `giver` owns the residual, the later `GIVEN` receipt, and giver earned Up. It does not imply Signals materialized in the same transaction.

### RouteHopSettled

```solidity
event RouteHopSettled(
    uint256 indexed handId,
    bytes32 indexed routeHash,
    uint8   position,
    address parentCapability,
    address childCapability,
    uint16  parentClaimBps,
    uint16  childClaimBps,
    address shaker,
    bytes32 shakeHash,
    bytes32 hopDataHash,
    uint96  marginAllocation
);
```

One per winning hop, including anonymous (`shaker == 0`) and zero-margin occurrences. A non-zero `shaker` has validated consent: the Shake signature itself when it equals the signing capability, otherwise a `ShakerAcceptance`. This proves address control and consent — not a real-world identity or contribution weight.

### Reclaimed

```solidity
event Reclaimed(uint256 indexed handId, address indexed raiser, address token, uint96 refund);
```

The terminal refund fact. Reclaim produces no charity allocation and no earned-Up source.

### PayoutAllocated

```solidity
event PayoutAllocated(
    uint256 indexed handId,
    address indexed token,
    address indexed beneficiary,
    AllocationKind kind,
    uint8   routePosition,
    uint96  amount
);
```

One per non-zero claim credit. `kind` is `Charity`, `ShakerMargin`, or `GiverResidual` at settlement and `RaiserRefund` on reclaim; `routePosition` is meaningful for `ShakerMargin` only.

### PayoutPushed / PayoutDeferred

```solidity
event PayoutPushed(uint256 indexed handId, address indexed token, address indexed beneficiary, uint96 amount);
event PayoutDeferred(uint256 indexed handId, address indexed token, address indexed beneficiary, uint96 amount);
```

Exactly one of the two follows every `PayoutAllocated`: `PayoutPushed` when the gas-bounded direct transfer succeeded, `PayoutDeferred` when it failed and the amount was parked in `claims[token][beneficiary]`.

### PayoutWithdrawn

```solidity
event PayoutWithdrawn(address indexed token, address indexed beneficiary, uint256 amount);
```

A deferred claim drained via `withdraw`. Aggregate per `(token, beneficiary)` — it deliberately carries no `handId`, because claims pool across Hands. Indexers must not attribute a withdrawal to individual Hands or invent a consumption order; allocation events retain the per-Hand provenance.

### TokenPolicyUpdated / CharityPolicyUpdated

```solidity
event TokenPolicyUpdated(address indexed token, bool enabled, uint64 policyRevision);
event CharityPolicyUpdated(address indexed charity, bool allowed, uint64 policyRevision);
```

Prospective-only policy changes with the post-change `policyRevision`. Both are also emitted at construction for the genesis state (token enabled, seed charities). When reconstructing an existing Hand, use the snapshot in its `Raised` event, never later policy.

### PolicyAdminTransferStarted / PolicyAdminTransferred

```solidity
event PolicyAdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);
event PolicyAdminTransferred(address indexed previousAdmin, address indexed newAdmin);
```

The two-step admin handover. `Started` with a zero `newAdmin` cancels a pending nomination; `Transferred` also fires at construction from the zero address.

## AHandSignals events

```solidity
event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
```

ERC-1155-shaped mint/burn record (`from == 0` on mint, `to == 0` on burn). The ledger is soulbound — no transfer or approval entry points exist, and `supportsInterface` deliberately does not claim ERC-1155 — so every `TransferSingle` comes from materialization or from `up()` burning and re-minting.

```solidity
event EarnedUpMaterialized(
    bytes32 indexed sourceKey,
    address indexed actor,
    uint8   roleMask,
    uint256 credit,
    uint256 cumulativeBefore,
    uint256 cumulativeAfter,
    uint256 delta
);
```

One per role credit when a Thank materializes earned Up. `roleMask` carries `ROLE_RAISER = 1` and/or `ROLE_GIVER = 2` bits (one combined event when raiser and giver are the same address); `delta = floor(sqrt(cumulativeAfter)) − floor(sqrt(cumulativeBefore))` in raw nine-decimal Up units.

```solidity
event ThankSignalsMaterialized(
    bytes32 indexed sourceKey,
    uint256 indexed handId,
    address raiser,
    address giver,
    uint96  charityTokenAmount,
    uint256 charityUsd,
    uint256 uniqueShakers
);
```

Once per settled Hand's materialization; `uniqueShakers` counts the distinct attributed shakers that received a `SHAKEN` receipt.

```solidity
event Upped(
    address indexed issuer,
    address indexed target,
    uint256 indexed handId,
    uint256 wholeUpCount,
    uint256 amount,
    bytes32 reasonTag,
    bytes32 evidenceHash
);
```

A voluntary endorsement: `amount = wholeUpCount * ONE_UP` (with `ONE_UP = 1e9`) burned from the issuer's earned Up and re-minted to the target as received Up; supply is conserved. `handId` zero means no Hand context.

Idempotence source keys, re-exposed as views `raisedSourceKey(handId)` / `thankSourceKey(handId)`:

```text
raisedKey = keccak256(abi.encode(RAISED_SOURCE, block.chainid, sourceCore, handId))
thankKey  = keccak256(abi.encode(THANK_SOURCE,  block.chainid, sourceCore, handId))
```

Not implemented: `SIGNAL_DOWN = 6` and `DOWN_COST = 3e9` are reserved constants only — there is no `down()` entry point and no Down event.

## AHandWitness events

```solidity
event Witnessed(bytes32 indexed hash, address indexed by, uint40 timestamp);
event ShakeWitnessed(uint256 indexed handId, address indexed parentCapability,
                     address childCapability, address shaker, uint16 marginBps,
                     bytes32 hopDataHash, uint40 timestamp);
event GiveWitnessed(uint256 indexed handId, address indexed capability,
                    address indexed giver, bytes32 routeHash, bytes32 solutionHash,
                    uint40 timestamp);
event EpochRoot(address indexed relay, bytes32 root, uint256 leaves);
```

First-write-wins timestamps (`witnessedAt[key] == 0` sentinel; repeats are silent no-ops). A typed witness proves authorship of bytes — the signer recovered from the signature — but not chain membership: anyone can sign any Shake struct with their own key, so tree builders must verify capability linkage themselves instead of trusting a single event. `EpochRoot` is pure telemetry: emit-only, no storage, no verification.

## Public versus private data

Only explicitly public tags, Public/Preview discovery refs, economic snapshots, and commitments enter logs. Preview route bodies, Dark semantic data, exact locations, contact data, and bearer secrets never do. Deterministic hashes of low-entropy data can be dictionary-enumerated; sensitive commitments use randomized canonical payloads.

## The subgraph

`packages/subgraph` defines a Graph subgraph over **AHandCore only** — there is no Signals or Witness datasource. The manifest handles `Raised`, `HandTagged`, `Settled`, `RouteHopSettled`, `Reclaimed`, `PayoutAllocated`, `PayoutWithdrawn`, `TokenPolicyUpdated`, and `CharityPolicyUpdated`; `PayoutPushed`/`PayoutDeferred` and the admin-transfer events are not indexed. It targets Base Sepolia through Graph Studio (`ahand-base-sepolia`). The web app currently reads chain state directly over RPC and does not query the subgraph. See [subgraph](../30-architecture/subgraph.md) for deployment details.

Entities in `schema.graphql`:

- `Hand` — one per raise, id `<core>-<handId>`; the full raise snapshot plus mutable `status`, a 1:1 `settlement` link, and reclaim fields.
- `HandTag` — immutable join entity per `(hand, tag)` with its position in the `HandTagged` array.
- `Settlement` — 1:1 with a settled Hand; the `Settled` event fields.
- `RouteHop` — one per settled route occurrence, never collapsed: anonymous hops and repeated shaker accounts stay distinct rows.
- `PayoutAllocation` — one per `PayoutAllocated`, with kind and route position.
- `Withdrawal` — one per `PayoutWithdrawn`; deliberately carries no Hand link.
- `Actor` — address-keyed counters (hands raised/reclaimed, giver settlements, shaker hop occurrences, allocation and withdrawal totals) derived from Core events only — no scores, no ENS, no Signals.
- `TokenPolicy` / `CharityPolicy` — current prospective-policy state; latest event wins.

## Indexer authority

The subgraph improves access and composition; it creates no truth. Clients verify high-value settlement facts against Core when necessary and treat indexing outages as availability failures, not evidence that a Hand never existed.
