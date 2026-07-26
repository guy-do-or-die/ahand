# Settlement and Giver protection

## Three separate risks

"Protect the Giver" contains three different problems:

1. **Consent** — an address must not be named as Giver without agreeing to the solution commitment and economic terms. Enforced on-chain: `GiverAcceptance` is always required at `thank`.
2. **Settlement-submission liveness** — `thank` is a direct, raiser-only transaction. `THANK_PERMIT_TYPEHASH` is reserved in `AHandSig` for a future relayed submission, but no entry point consumes it.
3. **Freeriding** — the raiser may consume an off-chain answer and refuse to accept it. This cannot be eliminated for subjective work without an oracle or an objectively verifiable task; the protocol makes it observable instead (below).

## Immutable Hand economics

Before any route exists, `raise` snapshots into the Hand: the reward token, the exact credited pool (`creditedReward`), `usdScaleAtRaise`, the allowlisted `charityRecipient` and `charityBps` (within the immutable `[100, 3_000]` bounds), `minGiverClaimBps`, and `expiry`. Later policy changes never alter these. There is no top-up, so every signer authorizes percentages against a fixed pool.

## The Give and GiverAcceptance

```solidity
struct Give {
    uint256 handId;
    bytes32 routeHash;     // binds the complete accepted route — no tail substitution
    address giver;
    bytes32 solutionHash;
    uint16  finalClaimBps; // binds the giver signature to their terminal share
    uint40  deadline;      // never past the Hand expiry
}
```

The terminal capability signs the Give; the giver signs `GiverAcceptance(giveHash)`. `_verifyGive` enforces, in order: `give.handId == handId` (`WrongHand`); `give.routeHash` equal to the hash of the just-verified route (`RouteHashMismatch`); `give.finalClaimBps` equal to that route's terminal claim (`ClaimMismatch`); a non-zero giver (`ZeroAddress`); a deadline neither passed (`TicketExpired`) nor past expiry (`DeadlineExceedsExpiry`); a valid Give signature by the terminal capability (`CapabilityProof`); and a valid giver acceptance (`GiverAcceptanceInvalid`).

Because the Give binds Hand, route, giver identity, solution commitment, terminal share, and deadline, this prevents: unwanted attribution, routing reputation consequences to a random address, substituting a different route or a lower payout after the giver agrees, and claiming a wallet supplied evidence it never saw.

## thank: verification, split, delivery

`_settle` runs three strict phases.

**Phase A — verification (view-only).** Status `Active`, strictly before expiry, raiser authority, route and array length bounds, then the full route walk and Give binding described in [capabilities and routing](capabilities-and-routing.md). No state is touched; the only external calls are staticcalls.

**Phase B — floor math (pure).** With pool `P = creditedReward`:

```text
C (charity)       = floor(P * charityBps / 10_000)
D (distributable) = P − C
hop_i             = floor(D * (parentClaimBps_i − childClaimBps_i) / 10_000)
giver residual    = D − Σ hop_i
```

The giver takes the residual, so `P == C + Σ hop_i + giverResidual` holds exactly — the giver absorbs all flooring dust. Charity is mandatory and success-only; there is no protocol, application, or maintenance fee of any kind.

**Phase C — effects, then interactions.** Status moves to `Settled`, `thankSignalSourceHash` is stored (the commitment `AHandSignals.materializeThank` later verifies), and every event is emitted — `Settled`, one `RouteHopSettled` per hop, and one `PayoutAllocated` per non-zero allocation (`Charity`, `ShakerMargin` per paid hop, `GiverResidual`) — all before the first token moves. The whole entry point is `nonReentrant` (transient-storage lock), so the trailing pushes can neither re-enter nor observe a half-settled Hand.

## Payout delivery: push with pull fallback

Each allocation is delivered by `_pay`: a gas-bounded direct transfer capped at `PUSH_GAS_STIPEND = 120_000` — enough for a USDC-style `transfer` (proxy delegatecall, blacklist check, balance writes), bounded so a pathological recipient wastes at most the stipend. On success `PayoutPushed` is emitted. On any failure — a blacklisted or reverting recipient — only that share is parked as `claims[token][beneficiary] += amount` and `PayoutDeferred` is emitted; every other payout in the same settlement still lands. A failing recipient can never block or roll back settlement.

Deferred value exits through `withdraw(token, beneficiary)`: a permissionless, fixed-destination, full-aggregate drain that zeroes the claim before its transfer and emits `PayoutWithdrawn`. See [core state machine](core-state-machine.md) for its semantics and the known blacklisted-beneficiary limitation.

## Reclaim

`reclaim` is available at or after expiry only, is permissionless, and refunds the full credited pool to the raiser:

```text
raiser refund      = P
charity allocation = 0
earned-Up          = 0
```

Charity stays the cost of a successful interaction, never a fee for an unsolved Hand. The refund uses the same push-with-fallback delivery.

## Freeriding evidence

For subjective solutions, a raiser may see a Give and later reclaim; the protocol cannot know whether the answer was useful. `AHandWitness.witnessGive` can timestamp the signed Give bytes before expiry, so an indexer can combine:

```text
witnessed valid Give + giver consent + later Reclaimed event
= observable freeriding-risk evidence
```

That is evidence, not automatic guilt: the solution may have been invalid, unsafe, duplicate, or unsolicited. Applications may add objective verification where the vertical permits it — a coding task can use tests, a physical handoff a challenge-response — but such mechanisms remain application policy; Core never adjudicates quality.

## Terminal proof hygiene

After the terminal capability signs the Give and the giver accepts, the payload returned to the raiser for review carries the complete signed route and terminal artifacts but no live capability secret, wallet session, or delegated signer handle. It enables verification and `thank` only; it must not hand the raiser fresh route-tail authority. This cannot revoke a root or earlier capability the raiser independently retained — alternate-branch settlement remains possible and is part of the freeriding discussion above.
