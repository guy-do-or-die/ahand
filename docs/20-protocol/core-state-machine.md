# Core state machine

`AHandCore` is the escrow and settlement engine. One deployment binds a single immutable `rewardToken` (an ERC-20 whose `decimals` is read once at construction) and its `usdScale = 10**(18 - decimals)`, snapshotted into every Hand at raise. There is no proxy, no pause switch, no protocol fee, and no `receive()` or `fallback()`. Four entry points mutate state — `raise`, `thank`, `reclaim`, `withdraw` — and all four are guarded by a transient-storage reentrancy lock (`Reentrancy`).

## Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `BPS_DENOMINATOR` | `10_000` | every bps value is out of 10000 |
| `MIN_CHARITY_BPS` | `100` (1%) | minimum charity share of a raise |
| `MAX_CHARITY_BPS` | `3_000` (30%) | maximum charity share of a raise |
| `MAX_SHAKES` | `6` | maximum route hops per settlement |
| `MIN_EXPIRY` | `1 days` | minimum Hand lifetime |
| `MAX_EXPIRY` | `180 days` | maximum Hand lifetime |
| `MAX_PUBLIC_TAGS` | `8` | maximum discovery tags per raise |
| `MAX_DISCOVERY_REF` | `128` bytes | maximum discovery ref length |
| `ERC1271_GAS` | `350_000` | gas cap per ERC-1271 signature check |
| `PUSH_GAS_STIPEND` | `120_000` | gas forwarded to each settlement push |

None of these change after deployment.

## Hand storage

The `Hand` struct (`AHandTypes.sol`) is hand-packed into seven storage slots; field order and widths are frozen:

```solidity
struct Hand {
    // slot 0
    address    raiser;
    uint40     expiry;
    uint16     charityBps;
    uint16     minGiverClaimBps;
    Visibility visibility;
    Status     status;
    // slot 1
    address    rewardToken;
    uint96     creditedReward;
    // slot 2
    address    charityRecipient;
    uint64     usdScaleAtRaise;
    // slot 3
    address    rootCapability;
    // slots 4–6
    bytes32    metadataCommitment;
    bytes32    discoveryCommitment;
    bytes32    thankSignalSourceHash; // zero until thank; stays zero on reclaim
}
```

`creditedReward` is written once at raise and never zeroed: the outstanding liability keys on `status`, and `AHandSignals` rereads the amount after settlement. `rewardToken`, `usdScaleAtRaise`, `charityRecipient`, `charityBps`, and `minGiverClaimBps` are snapshots — later policy changes cannot alter them. Public tags and the discovery ref are event data only and occupy no storage. `getHand(handId)` returns the full struct by value (zeroed if the Hand was never raised); it is the read surface Signals depends on.

## Status

```solidity
enum Status { None, Active, Settled, Reclaimed }
```

Transitions are one-way: `None → Active` (raise), `Active → Settled` (thank), `Active → Reclaimed` (reclaim). `Settled` and `Reclaimed` are terminal. There is no intermediate "solved" state: a signed Give is off-chain evidence until `thank` accepts it. The terminal windows are disjoint:

```text
thank allowed:   block.timestamp <  expiry
reclaim allowed: block.timestamp >= expiry
```

## raise

`raise(RaiseParams calldata p, bytes calldata discoveryRef, bytes32[] calldata publicTags)` escrows exactly `p.amount` of the reward token and returns a monotonic `handId` (`++handsCount`). Validation runs in a fixed order:

1. **Token identity and prospective policy** — `p.token` equals the immutable `rewardToken` (`TokenMismatch`) and `tokenEnabled` is set (`TokenNotEnabled`).
2. **Non-degenerate participants** — non-zero `p.amount` (`ZeroAmount`), non-zero `p.rootCapability` (`ZeroAddress`), allowlisted `p.charityRecipient` (`CharityNotWhitelisted`).
3. **Bps bounds** — `MIN_CHARITY_BPS <= p.charityBps <= MAX_CHARITY_BPS` and `0 < p.minGiverClaimBps <= BPS_DENOMINATOR` (`BoundsViolated`).
4. **Split viability** — the floored charity allocation is non-zero (`ZeroCharityAllocation`) and the remaining distributable pool is non-zero (`ZeroDistributable`), so a later settlement can always pay both charity and route.
5. **Expiry window** — `block.timestamp + MIN_EXPIRY <= p.expiry <= block.timestamp + MAX_EXPIRY` (`BoundsViolated`).
6. **Visibility coherence** — `p.metadataCommitment` is mandatory (non-zero) in every mode. `Dark` forbids `discoveryRef`, `p.discoveryCommitment`, and `publicTags` entirely; `Public` and `Preview` require a non-empty `discoveryRef` of at most `MAX_DISCOVERY_REF` bytes plus a non-zero `p.discoveryCommitment` (`InvalidVisibilityData`).
7. **Tags** — at most `MAX_PUBLIC_TAGS`, strictly ascending, which enforces uniqueness and non-zero ids in one pass (`TagsInvalid`). Tags are optional in both `Public` and `Preview`.
8. **Exact-delta deposit** — the measured balance delta of the `safeTransferFrom` must equal `p.amount` exactly (`InexactDeposit`); fee-on-transfer and rebasing surprises are rejected, not absorbed.
9. **Effects and events** — the Hand is stored with `status = Active`, `Raised` is emitted with the full policy snapshot plus the current `policyRevision`, and `HandTagged` follows if any tags were supplied.

## thank

`thank(handId, shakes, shakeSigs, shakerAcceptances, give, giveSig, giverAcceptanceSig)` settles a successful Hand. Only the raiser may call it (`NotRaiser`), only while the Hand is `Active` (`NotActive`), and only strictly before expiry (`Expired`). It verifies the whole route and Give (see [capabilities and routing](capabilities-and-routing.md)), splits the pool, and delivers every allocation (see [settlement](settlement-and-giver-protection.md)). A Hand settles at most once.

## reclaim

`reclaim(handId)` refunds an expired, unsettled Hand. It is permissionless — anyone may finalize once `block.timestamp >= expiry` (`NotExpired` before that) — but the refund destination is fixed to the raiser. The full pool refunds: no charity cut on failure and no earned-Up eligibility. Status moves to `Reclaimed`, the `Reclaimed` event and a `RaiserRefund` `PayoutAllocated` are emitted, and the refund is pushed to the raiser, deferring to a claim if the push fails.

## withdraw

`withdraw(token, beneficiary)` drains the aggregate claim `claims[token][beneficiary]` accumulated from deferred payouts. It is permissionless with a fixed destination: anyone may pay the gas, nobody can redirect the funds. An empty claim reverts (`ZeroClaim`). The claim is zeroed before the transfer, and there is no partial withdrawal. `withdraw` is deliberately not gated by `tokenEnabled`: disabling the token never strands accrued claims. Because claims aggregate across Hands, a withdrawal has no per-Hand attribution.

Known limitation: a claim whose original push failed because the token blocks transfers to the beneficiary (a USDC blacklist, for example) is effectively unwithdrawable — `withdraw` retries the same fixed-destination transfer, which fails for the same reason. Adding a redirect would reintroduce exactly the theft vector the fixed destination prevents, so this is accepted in v1.

## Policy administration

The policy surface is deliberately narrow — two switches, prospective only:

- `setTokenEnabled(bool)` — gates admission of new raises; it never affects live Hands, settlements, or withdrawals.
- `setCharityAllowed(address, bool)` — edits the charity allowlist for future raises; a Hand raised under an allowed charity settles to it even if the charity is later removed.

Both bump `policyRevision` (seeded at `1` in the constructor), and the counter is snapshotted into every `Raised` event for provenance. Admin handover is two-step: `transferPolicyAdmin(newAdmin)` nominates the successor (passing the zero address cancels a pending nomination), and `acceptPolicyAdmin()` must be called by the nominee (`NotPendingOwner` otherwise).

The admin cannot: touch an Active or terminal Hand; pause `thank`, `reclaim`, or `withdraw`; select a winner or approve a route; alter settlement arithmetic or redirect escrow; add any fee or asset; change any constant; upgrade the contract; rescue token balances; or mint, erase, or reinterpret Signals. Every value an Active Hand needs is already snapshotted.
