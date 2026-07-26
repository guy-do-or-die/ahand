# ADR-0010: Single stablecoin policy and hybrid push/pull payouts

Status: accepted

## Context

Unrestricted ERC-20 handling and live price oracles add risk that does not improve the core demonstration, and a second asset would add ambiguity rather than prove generality. On the payout side, pure push settlement lets one failing recipient revert Thank, while pure pull forces every beneficiary to send a second transaction and leaves "allocated" indistinguishable from "paid".

## Decision

Each `AHandCore` deployment has a single immutable `rewardToken` fixed at construction. The live Base Sepolia deployment uses Circle's Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals); local anvil deployments use `MockUSD`; a future Base mainnet deployment will use Base mainnet USDC. The per-Hand `usdScaleAtRaise = 10^(18 - decimals)` snapshot values Signals credit at one USD per whole token; the deployment cannot add assets or change the scale.

`raise` requires the incoming balance delta to equal the requested deposit exactly, which rejects fee-on-transfer and rebasing tokens. There are no top-ups and no price oracles.

Settlement uses hybrid push/pull accounting. `thank` and `reclaim` record every non-zero allocation (`PayoutAllocated`: Charity, ShakerMargin, GiverResidual, RaiserRefund) and immediately attempt a direct transfer bounded at `PUSH_GAS_STIPEND = 120_000` gas that never bubbles a revert. Success emits `PayoutPushed`; any failure parks the exact amount as a deferred claim and emits `PayoutDeferred`, so a hostile or broken recipient can waste at most the stipend and can never block settlement.

`withdraw(token, beneficiary)` drains the aggregate deferred claim in one transfer to the fixed beneficiary and emits `PayoutWithdrawn`. It is permissionless: anyone can pay the gas, nobody can redirect the destination. Allocation and payment are separate events and are never double-counted.

The policy admin's whole authority over money flow is prospective admission: `setTokenEnabled(bool)` gates new Raises on the one preconfigured token, and `setCharityAllowed(address, bool)` edits the charity allowlist. Neither affects live Hands, settlement, or withdrawal (see ADR-0012).

## Consequences

### Positive

- One officially verifiable asset per deployment keeps per-Hand and global conservation straightforward.
- Charity-backed Up uses a deterministic scale that cannot go stale during settlement.
- A recipient cannot block Thank or Reclaim, and the happy path needs no second transaction.
- The deferred path preserves exact amounts for later permissionless withdrawal.
- Signed route percentages always apply to the original credited pool.

### Negative

- The one-dollar valuation is a stated assumption, not depeg protection.
- A beneficiary the token itself rejects (for example a USDC blacklist) is effectively unwithdrawable: `withdraw` retries the same fixed-destination transfer.
- Supporting another asset requires a new deployment, not an admin edit.

## Alternatives rejected

- **Arbitrary ERC-20 parameter:** balance deltas do not solve rebases, outbound taxes, or valuation manipulation.
- **Live oracle:** adds failure modes without improving a stablecoin deployment.
- **Pull-only claims:** every beneficiary needs a second transaction even when a plain transfer would have succeeded.
- **Push-only settlement:** one failing recipient reverts Thank for everyone.
- **Separate token registry contract:** duplicates policy for one admitted asset.
- **Post-route top-up:** changes percentage-derived amounts after participants authorize them.

## References

- [Economics](../10-model/economics.md)
- [Core state machine](../20-protocol/core-state-machine.md)
- [Invariants and threat model](../20-protocol/invariants-and-threat-model.md)

## Revisit when

A concrete second reward asset is required and its governance, valuation, and transfer semantics are specified well enough to preserve per-Hand snapshots and exits.
