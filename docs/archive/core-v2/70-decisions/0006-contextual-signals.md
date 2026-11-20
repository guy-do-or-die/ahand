# ADR-0006: Keep one global Up with contextual provenance

Status: accepted

## Context

The aHand model has soulbound action receipts plus one Up balance with earned and received portions. A context-free aggregate score hides why a judgment happened, while event-only assertions lose the spendable earned-Up budget and the charity-backed issuance model.

Arbitrary per-context balances are also unsafe: applying the square-root curve independently to tags, apps, or context ids would let a participant increase issuance by splitting identical activity across labels.

## Decision

`AHandSignals` keeps six signal ids:

```text
RAISED = 1, SHAKEN = 2, GIVEN = 3, THANKED = 4, UP = 5, DOWN = 6
```

`DOWN` is reserved: the id and the `DOWN_COST = 3e9` constant exist, but no entrypoint mints it yet.

The ledger is a custom hook-free soulbound multi-token contract. It exposes `balanceOf`, `balanceOfBatch`, a fully on-chain SVG `uri(id)`, and `TransferSingle`-shaped events, but `supportsInterface` claims ERC-165 only — deliberately not ERC-1155 (`0xd9b67a26`). There are no transfers, approvals, or receiver callbacks, so a contract target cannot veto a receipt or a passed Up.

Each deployment is ownerless and bound to exactly one immutable `sourceCore`. Materialization is permissionless, money-independent, and idempotent under typed source keys `keccak256(abi.encode(RAISED_SOURCE | THANK_SOURCE, block.chainid, core, handId))`, so the two bundles for one Hand materialize once each and a caller cannot substitute another Core whose Hand ids collide. Materialization cannot control or block settlement, Reclaim, or withdrawal.

- `materializeRaised(handId)` mints one `RAISED` to the Raiser of any raised Hand — it does not wait for settlement.
- `materializeThank(handId, giver, occShakers, occClaimDeltas)` recomputes `AHandSource.thankCommitment` over the submitted payload and requires equality with the `thankSignalSourceHash` Core stored at settlement. It mints `THANKED` and `GIVEN`, exactly one `SHAKEN` per distinct non-zero attributed Shaker (occurrences deduplicated; anonymous hops get none), and earned Up for the two roles.

Earned Up follows a cumulative-square-root curve. Thank fixes `charityUsd = charityTokenAmount * usdScaleAtRaise` (1e18-scaled). Each of Raiser and Giver is credited `charityUsd / 2` into a global per-address `cumulativeUsd`, and the minted delta is `floor(sqrt(after)) - floor(sqrt(before))`. Floor-sqrt is monotonic and sub-additive, so splitting the same value across many Hands never mints more. There is no emission cap, and no Shaker automatically receives Up.

There is one `UP` token (`ONE_UP = 1e9`, 9 decimals) with two accounting portions: the spendable earned part tracked in `earnedUp`, and the received part (`receivedOf(a) = balanceOf(a, UP) - earnedUp[a]`), which cannot be re-spent — endorsement chains terminate by construction.

```text
up(target, wholeUpCount, ctx)
amount = wholeUpCount * ONE_UP, amount <= earnedUp[msg.sender]
```

`up()` forbids zero and self targets, and requires at least one non-zero `UpContext` field (`handId`, `reasonTag`, `evidenceHash`). It burns from the issuer's earned portion and mints the same amount into the target's received portion, emitting `Upped`. This is the intended recognition path for a helpful zero-margin Shaker: after Thank, anyone may reference the Hand and spend their own earned Up.

Events: `TransferSingle`, `EarnedUpMaterialized`, `ThankSignalsMaterialized`, `Upped`.

## Consequences

### Positive

- The Up terminology and one-hop endorsement budget survive.
- Mandatory charity gives earned Up an external cost.
- Global accumulation preserves same-address Hand-split invariance.
- Context on `Upped` exposes who supported whom, where, and why.
- Received Up cannot recursively multiply endorsements.
- Signal failure cannot freeze money.
- Contract recipients cannot veto materialization through receiver hooks.

### Negative

- `earnedUp` is remaining spendable strength; consumers that need lifetime issuance must read `cumulativeUsd` or mint history.
- A concave per-address curve is not cross-address Sybil-proof; controlled identities can split issuance and direct Up to one target.
- Consumers need an indexer to interpret contextual history efficiently.
- Generic tooling that requires strict ERC-1155 conformance (transfers, approvals, receiver callbacks, `supportsInterface`) cannot treat Signals as ERC-1155.
- Down assertions are not yet possible; negative judgments live off-ledger until a `down()` entrypoint ships.

## Alternatives rejected

- **Event-only Signals:** loses the spendable earned-Up model and onchain balances.
- **Separate earned-Up and received-Up token ids:** invents two assets where provenance accounting inside one Up suffices.
- **Freely transferable Up:** permits recursive delegation and obscures endorsement provenance.
- **Strict ERC-1155 mint semantics:** receiver callbacks let a target contract reject an otherwise objective receipt and make multi-recipient materialization brittle.
- **Independent context curves:** makes tag/app/context splitting inflationary.
- **Context-free universal score:** hides provenance and forces one trust model.
- **Signals as settlement permissions:** lets reputation failures freeze or redirect money.
- **Automatic Up or charity credit for Shakers:** rewards route presence, makes maximum route length attractive, and lets controlled Shaker addresses exploit per-address square-root concavity. A factual `SHAKEN` plus voluntary, supply-conserving `up()` separates participation from scarce judgment.

## References

- [Economics](../10-model/economics.md)
- [Tags, context, and Signals](../10-model/tags-context-and-signals.md)
- [Events and indexing](../20-protocol/events-and-indexing.md)
- [Invariants and threat model](../20-protocol/invariants-and-threat-model.md)

## Revisit when

A `down()` entrypoint is designed, a governance design needs onchain snapshots, or empirical use shows Up cost and display weights need a versioned policy. Any revision must preserve historical provenance and avoid per-context issuance multiplication.
