# Tags, context, and Signals

## Public tags

A Public or Preview Raise may declare up to eight (`MAX_PUBLIC_TAGS`) permanent tag ids:

- each tag is an opaque `bytes32`;
- the array is strictly ascending by raw value, which enforces uniqueness and non-zero in one pass;
- tags are emitted in the `HandTagged` event rather than stored as a dynamic Core array;
- Dark Hands forbid tags entirely.

Core never resolves or interprets a tag; no vocabulary registry can censor a Hand. Any labeling convention — human-readable vocabularies, hashed labels — is an application choice layered on the opaque ids.

Tags are currently a protocol facility the web app does not yet surface: the raise flow passes an empty tag array and no route displays tags.

## Context is fields and provenance

There is no minted context object, context owner, or authoritative list of contexts. A Hand already has an identity (`HandRef = chainId + sourceCore + handId`); context is the derived join of typed fields on the action it qualifies — which Hand, which role, what reason, what evidence. Indexers and applications may compute contextual views from Core and Signals events, but such views must preserve the raw components.

The one on-chain context shape is `UpContext`:

```text
UpContext = { handId, reasonTag, evidenceHash }
```

`up()` requires at least one non-zero field. A non-zero `handId` implicitly refers to `HandRef(block.chainid, sourceCore, handId)` of the ledger's bound Core.

## Signal set

| Id | Signal | Meaning |
|---|---|---|
| 1 | `RAISED` | the address raised a Hand |
| 2 | `SHAKEN` | the address consented to Shaker attribution on a winning Hand |
| 3 | `GIVEN` | the address is the accepted Giver |
| 4 | `THANKED` | the Raiser successfully completed Thank |
| 5 | `UP` | charity-backed earned or explicitly received positive strength (9 decimals) |
| 6 | `DOWN` | reserved — no entrypoint mints it |

`AHandSignals` is a soulbound multi-token ledger shaped like ERC-1155 for indexing: `balanceOf`, `balanceOfBatch`, `TransferSingle`-shaped events, and a `uri(id)` that returns a fully on-chain SVG data URI. It deliberately does **not** claim ERC-1155 conformance through `supportsInterface` (ERC-165 only), has no transfer or approval entry points, and invokes no receiver callbacks — a contract target cannot veto a receipt or an Up. The ledger is ownerless with zero privileges and bound to one immutable `sourceCore`.

Constants: `ONE_UP = 1e9`; `DOWN_COST = 3e9` (reserved for a future `down()`).

Events: `TransferSingle`, `EarnedUpMaterialized`, `ThankSignalsMaterialized`, `Upped`.

## Materialization

Both materialization calls are permissionless and idempotent through typed source keys:

```text
raisedKey = keccak256(RAISED_SOURCE, chainId, sourceCore, handId)
thankKey  = keccak256(THANK_SOURCE,  chainId, sourceCore, handId)
```

A caller cannot substitute another Core with a colliding local `handId`, and each fact bundle materializes exactly once without consuming the other.

`materializeRaised(handId)` mints one `RAISED` to the raiser for any Hand that exists in the source Core — Active, Settled, or Reclaimed; the raise happened regardless of how the Hand later resolved.

`materializeThank(handId, giver, occShakers, occClaimDeltas)` requires a Settled Hand. Nothing supplied is trusted: the ledger recomputes the charity amount from the Hand snapshot and rebuilds the exact commitment (`thankSignalSourceHash`) Core stored at settlement; a mismatched payload reverts. It then mints `THANKED` to the raiser, `GIVEN` to the giver, and one `SHAKEN` per distinct non-zero attributed shaker — anonymous hops mint nothing, and repeated attribution of one address within the Hand does not multiply its balance. Finally it credits each of raiser and giver with `roleCredit = charityUsd / 2` on the lifetime accumulator and mints the floor-square-root earned-Up delta (see [Economics](economics.md)); a raiser who is also the giver gets both halves in one atomic update.

Per-Hand deduplication prevents one account from multiplying `SHAKEN` by inserting itself repeatedly, while Core events preserve every occurrence. It cannot stop one operator from using several consented addresses, so `SHAKEN` is a factual participation receipt, not a trust score or an earned-Up source.

## One Up, two accounting portions

There are not separate earned-Up and received-Up tokens:

```text
totalUp(a) = earnedUp(a) + receivedUp(a)
```

- `earnedUp` is the remaining spendable Up earned from successful Thanks.
- `receivedUp` is Up explicitly passed to the address by others; it cannot be passed onward.

`up(target, wholeUpCount, ctx)` requires a positive `wholeUpCount`, spends `wholeUpCount * ONE_UP` from the sender's earned portion, and re-mints the same amount into the target's received portion. The target cannot be the zero address or the sender, and the context must be non-empty. Total supply is conserved and endorsement chains terminate by construction, because only earned Up is spendable.

An application can offer `up()` as the explicit recognition path for a helpful zero-margin Shaker after Thank — prefilling the Hand id and a reason tag while the issuer chooses the target and spends its own earned Up. The protocol never mints route-length rewards: splitting credit per attributed hop would create a Sybil incentive.

## Down is reserved

Signal id 6 and `DOWN_COST = 3 * ONE_UP` are reserved constants for a possible future `down()` action. No entrypoint or event mints, burns, or counts Down today.

## Objective facts versus attributed Signals

| Data | Provenance | Interpretation |
|---|---|---|
| `Settled`/Thank fact | Core | objective protocol fact |
| `HandTagged` | Raiser | self-classification |
| winning route margin | Core-verified route | objective settlement fact |
| earned Up materialization | successful Thank plus static charity valuation | deterministic protocol-derived fact |
| passed Up | Up issuer | costly positive attribution |
| trust score | application | derived opinion, never Core truth |

## Money-independent and retryable

Signals failure cannot revert, delay, or alter Thank, Reclaim, or withdrawal. Thank stores the authenticated source commitment and emits its facts; materialization is a separate call that anyone may retry later. It records the processed key before any mint, uses checked arithmetic so an overflow reverts atomically, and performs no external calls beyond read-only staticcalls to the immutable `sourceCore` — there are no recipient hooks that could reject it. Reclaim is never eligible for charity-backed Up.

## Sybil boundary

Mandatory charity gives earned Up a real external cost, cumulative square-root issuance limits whales, and received Up cannot recurse. These mechanisms do not prove unique humans. The curve is concave — `sqrt(x) + sqrt(y) > sqrt(x + y)` for positive inputs — so splitting value among controlled addresses still yields more aggregate issuance; a split-neutral linear curve would lose the anti-whale effect. Without an external uniqueness assumption, one scalar formula cannot provide both. The protocol therefore exposes earned/received provenance and endorsement edges for application policy, claiming economic resistance and legibility rather than Sybil-proof identity.
