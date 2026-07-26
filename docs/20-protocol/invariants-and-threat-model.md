# Invariants and threat model

The invariants below are enforced by the code in `contracts/src` and verified by the Foundry suite in `contracts/test`; the file map at the end names which test covers what.

## Value invariants

### Per-Hand conservation

For a successful `thank`:

```text
creditedReward = charityAllocation + Σ hopAllocations + giverAllocation
```

Exact by construction: the giver residual is computed as `distributable − Σ hopAllocations` and absorbs all flooring dust. For `reclaim`, `creditedReward` refunds to the raiser in full. Exactly one terminal path applies per Hand, and no fee term of any kind exists. `AHand.conservation.t.sol` asserts the equality across route shapes and rounding cases.

### Per-token solvency

At every point:

```text
Core token balance >= Σ (creditedReward of Active Hands) + Σ (claims[token][beneficiary])
```

Settlement and reclaim push most value out in the same transaction; each failed push converts exactly its share of escrow liability into claim liability; `withdraw` reduces the claim and the balance by the same amount. Unsolicited direct transfers are inert surplus attributed to neither liability class. `AHand.invariant.t.sol` fuzzes this statefully, with ghost accounting of pushed versus deferred value.

### Escrow isolation and terminality

- Settling one Hand never consumes another Hand's escrow.
- Unexpected token transfers never increase any Hand's obligation.
- A Hand becomes `Settled` or `Reclaimed` exactly once (`NotActive` on any second attempt).
- Terminal Hands retain no active escrow liability. `creditedReward` is never zeroed — liability keys on `status`.

## Policy snapshot invariants

- Every raise escrows the single immutable `rewardToken`, and the measured deposit delta equals the declared amount exactly (`InexactDeposit` otherwise).
- `usdScaleAtRaise`, `charityRecipient`, `charityBps`, `minGiverClaimBps`, and `expiry` are snapshotted at raise and immutable per Hand.
- `charityBps` sits within the immutable `[MIN_CHARITY_BPS = 100, MAX_CHARITY_BPS = 3_000]`, and both the floored charity allocation and the distributable pool are non-zero at raise.
- `setTokenEnabled` and `setCharityAllowed` affect future raises only. Disabling the token or emptying the allowlist suspends new admission and nothing else; `withdraw` is never gated. `AHand.policy.t.sol` covers the admin surface, including the two-step transfer.

## Route invariants

- Verification starts at the committed `rootCapability` with a `10_000` bps claim; every later signer is the previous hop's `childCapability`; a zero-shake route requires the root to sign the Give with `finalClaimBps = 10_000`.
- Each `parentClaimBps` equals the previous child claim; child claims never grow (`ClaimMustNotGrow`) and never dip below `minGiverClaimBps` (`ClaimBelowFloor`).
- Every non-zero shaker has consent — the Shake signature itself when self-attributed, a `ShakerAcceptance` when distinct — and anonymous or self hops must carry empty acceptance bytes. Every positive margin has a non-zero shaker and a non-zero floored allocation (`MarginRoundsToZero`).
- The Give binds `handId`, the exact verified `routeHash`, and the terminal `finalClaimBps`; the giver's acceptance binds `giveHash`. No route prefix or tail can be substituted (`AHand.routehash.t.sol`, `AHand.attacks.t.sol`).
- `thank` runs strictly before expiry, `reclaim` at or after; every artifact deadline is bounded by expiry (`AHand.windows.t.sol`); routes carry at most `MAX_SHAKES = 6`.

## Payout invariants (push with pull fallback)

- All state — status, source commitment, every event — is finalized before the first token transfer (checks-effects-interactions), and every mutating entry point is `nonReentrant`.
- Each settlement push is bounded at `PUSH_GAS_STIPEND = 120_000` and never bubbles a revert: exactly one of `PayoutPushed` / `PayoutDeferred` follows each `PayoutAllocated`.
- A failing push defers only its own share into `claims[token][beneficiary]`; it cannot roll back or delay settlement, and every other payout in the same transaction still lands.
- `withdraw` zeroes the aggregate claim before its transfer, pays only the fixed beneficiary, and has no partial mode. Aggregate withdrawals carry no per-Hand attribution.

## Signals invariants

- For every address, `balanceOf(a, SIGNAL_UP) = earnedUp[a] + receivedOf(a)`, and only the earned part is spendable.
- Charity-backed issuance: only a settled `thank` creates automatic earned-Up eligibility, and only for its raiser and giver. Each role's credit is `charityUsd / 2` added to one global per-address `cumulativeUsd` curve, and the mint delta is `floor(sqrt(after)) − floor(sqrt(before))` in raw nine-decimal units (`ONE_UP = 1e9`). If one address holds both roles, both half-credits enter the same curve in one atomic update.
- Materialization is permissionless and idempotent: typed `raisedKey`/`thankKey` source keys bind `block.chainid` and the immutable `sourceCore`, the processed flag is set before any mint, and `materializeThank` must rebuild the exact `thankSignalSourceHash` Core stored at settlement (`SourceCommitmentMismatch` otherwise) — a caller cannot substitute another core whose local Hand number happens to match. Apart from the read-only `getHand` staticcall, materialization performs no external call, so no recipient can veto it, and an outage or replay never changes settlement. `materializeRaised` works for any existing Hand status, terminal ones included.
- One `SHAKEN` per distinct attributed shaker per Hand; anonymous occurrences mint nothing; repeated occurrences of one account remain event provenance only.
- `up(target, wholeUpCount, ctx)` spends `wholeUpCount * ONE_UP` from `earnedUp` only, forbids zero and self targets and an all-zero `UpContext`, and burns from the issuer while minting to the target — total `SIGNAL_UP` supply is conserved and received Up cannot be re-spent, so endorsement chains terminate by construction.
- Not implemented: `SIGNAL_DOWN = 6` and `DOWN_COST = 3e9` are reserved constants; no `down()` entry point exists.

`Signals.materialize.t.sol` covers idempotence, commitment rejection, sqrt deltas, the both-roles-one-address path, shaker deduplication, and contract recipients (the ledger invokes no receiver hooks, so a reverting ERC-1155 receiver cannot veto a mint).

## Authority invariants

- Signals reads Core one-way through `getHand` and can never redirect or freeze money; Witness has zero Core connectivity.
- No indexer, application, or agent can settle without valid signed artifacts; there is no privileged application role, fee, or routing path.
- No contract resolves ENS; name and avatar display is a client-side concern.
- The policy admin is bounded exactly as listed in [core state machine](core-state-machine.md).

## Threats and mitigations

### Capability theft and route branching

Anyone who obtains a bearer link can act as its current holder, and earlier holders retain authority to authorize alternate suffixes. Mitigations: narrow delivery, short deadlines, personal capabilities for sensitive hops, fresh child keys with parent-secret stripping, and explicit UI warnings. Branching is a property of the design, not a bug — exclusive transfer is not claimed.

### Payload tampering

Every route artifact and metadata disclosure verifies against signed fields or commitments; clients fail closed when verification fails. The web app, for example, verifies the discovery document byte-for-byte against `discoveryCommitment` before rendering it.

### Raiser freeriding and Giver misattribution

Giver consent binds identity, solution, route, and residual claim, and the terminal proof carries no route-tail secret. Alternate-branch settlement and refusal after receiving a subjective answer remain possible; witnessed Gives plus a later `Reclaimed` make the behavior observable (see [settlement](settlement-and-giver-protection.md)) without claiming to adjudicate it.

### Sybil routing versus Signals

Splitting one route margin across self-controlled hops cannot increase routing payout — per-hop flooring may reduce it. Receipt counts are not trust scores: distinct controlled shaker addresses can still each collect a `SHAKEN` on one winning route; deduplication only prevents same-address multiplication. The cumulative square root is split-invariant only within one address: splitting charity-backed activity across controlled addresses can increase aggregate Up issuance, and those addresses can direct their earned Up at one target. That concavity is exactly why only raiser and giver receive automatic charity-backed credit — per-shaker credit would turn route length and address splitting into an issuance strategy. Mandatory charity imposes real external cost only under the assumption that the allowlisted recipient is independently controlled and does not rebate. The protocol claims economic resistance and legibility, not proof of unique humans.

### Self-attribution and recursion

Self-Up is forbidden (`SelfTarget`), and received Up is not spendable — the recursion cut lives in the `earnedUp` accounting, so endorsement chains cannot multiply strength.

### Tag and context splitting

Tags are opaque `bytes32` ids, capped at `MAX_PUBLIC_TAGS = 8`, and confer no ownership or truth. `UpContext` annotates events only; arbitrary contexts never create separate cumulative Up curves.

### Signal spam and retaliation

`up()` consumes earned Up, so endorsement is costly. Costs do not make claims true: interfaces expose issuer, evidence, and earned/received components rather than a single net score.

### Policy-admin compromise

A compromised admin can damage future admission — disable the token, empty the charity allowlist, or allowlist a false or colluding charity — but cannot touch live Hands, claims, settlement arithmetic, or code. A rebating charity recipient defeats the external-cost assumption for Hands raised under it. Two-step transfer reduces accidental handover; a timelock and governed policy are future work, not current claims.

### Privacy leakage

`Dark` emits no discovery ref, commitment, or tags; commitments must use randomized canonical payloads because deterministic hashes of low-entropy data are enumerable. Dark Hands still expose ordinary on-chain economic and transaction facts.

### Malicious tokens and recipients

Core binds one known reward token, demands an exact deposit delta, and settles with gas-bounded pushes that defer instead of reverting: a hostile recipient wastes at most `PUSH_GAS_STIPEND` and strands only its own share. `withdraw` zeroes before transfer, and a failed withdrawal retries without altering history. Arbitrary-token compatibility is not claimed. `AHand.attacks.t.sol` exercises reentrancy and hostile-recipient scenarios.

### Signature replay

The EIP-712 domain binds `block.chainid` and the Core address; `handRef` binds chain, core, and `handId`; `routeHash` binds the ordered hops; deadlines bound every artifact by expiry; and terminal status makes settlement single-use. The fork-safe `DOMAIN_SEPARATOR` recompute prevents cross-fork replay (`AHand.forksafety.t.sol`).

## Test suite map

| File | Covers |
| --- | --- |
| `AHand.raise.t.sol` | the full raise validation matrix: policy gates, bounds, visibility coherence, tags, exact-delta deposit |
| `AHand.policy.t.sol` | `setTokenEnabled` / `setCharityAllowed` prospective-only semantics, `policyRevision`, two-step admin transfer |
| `AHand.acceptance.t.sol` | shaker consent modes and the settlement acceptance matrix |
| `AHand.windows.t.sol` | expiry windows, disjoint thank/reclaim, artifact deadlines |
| `AHand.routehash.t.sol` | route-hash binding: Give/route equality, hop reordering |
| `AHand.attacks.t.sol` | reentrancy, route prefix/tail substitution, hostile recipients, cross-Hand isolation |
| `AHand.conservation.t.sol` | exact per-Hand conservation across splits and rounding |
| `AHand.withdraw.t.sol` | deferred-claim accounting and the fixed-destination drain |
| `AHand.erc1271.t.sol` | contract signers across all four signature families |
| `AHand.forksafety.t.sol` | cached versus recomputed `DOMAIN_SEPARATOR` across chain-id changes |
| `AHand.invariant.t.sol` | stateful fuzz: solvency, conservation, push/defer ghost accounting |
| `Signals.materialize.t.sol` | `materializeRaised` / `materializeThank` idempotence, commitment checks, sqrt curve, `SHAKEN` dedupe |
| `GenVectors.t.sol` | generates the cross-language EIP-712 vectors consumed by `packages/sdk` |

The SDK carries its own Vitest suite, including signature-tampering cases; see [testing](../50-implementation/testing.md).
