# Primitive and lifecycle

## Hand identity

Every Hand has a monotonic local `handId`. External references include chain and Core deployment:

```text
HandRef = (chainId, sourceCore, handId)
```

`sourceCore` is the exact Core contract that owns the Hand state. Signed artifacts may omit `chainId` and `sourceCore` from their struct only because the EIP-712 domain binds both.

## Lifecycle

```text
                         accepted Give
Prepared ──raise──► Active ───────────────► Settled
                      │
                      └──expiry/reclaim──► Reclaimed
```

On-chain status is the enum `None → Active → Settled | Reclaimed`; both end states are terminal.

### Prepared

The client constructs:

- public terms and optional public tags;
- the deposit in the deployment's single reward token (Base Sepolia USDC on the live deployment; MockUSD on local anvil);
- an allowlisted charity and a Raiser-selected charity share within the immutable 1%–30% bounds;
- canonical metadata and its commitment (`metadataCommitment` is mandatory in every visibility mode);
- visibility-specific payloads;
- a fresh root capability;
- any proposed first-Shaker margin, disclosed before funding but not yet signed.

Prepared is an application state, not a Core status. Because Core assigns monotonic ids, a Hand-bound first Shake cannot be signed until the Raise receipt supplies `handId`.

### Active

`raise` escrows the exact deposit (fee-on-transfer tokens are rejected), commits the root capability, and snapshots the reward token, its `usdScale = 10^(18 - decimals)`, the charity address and rate, the Giver floor, and expiry (between 1 and 180 days out). An Active Hand may be transported, Shaken, witnessed, Given, or discovered according to its visibility; later policy changes apply only to future Raises.

Intermediate routing stays offchain. A capability is branch authority: a sender may retain its parent key and create an alternate branch until the Hand expires or settles. Optional witnesses (`AHandWitness`) may publish timestamps but cannot alter Core state.

### Settled

The Raiser calls `thank` before expiry with the winning route and accepted Give. Core verifies the EIP-712 route chain and Give, changes status, allocates charity, Shaker margins, and the Giver residual with exact conservation, and commits the deterministic Signal source (`thankSignalSourceHash`).

Payouts are pushed immediately: each allocation is delivered by a gas-bounded transfer (120,000-gas stipend). If a recipient's push fails — a blacklisted or hostile address — only that share is deferred into a pull claim; every other payout still lands in the same transaction. `withdraw(token, beneficiary)` later drains a deferred claim; it is permissionless with a fixed destination, so anyone can pay the gas but nobody can redirect the funds.

Separately, permissionless and idempotent Signals materialization mints `THANKED`, `GIVEN`, one `SHAKEN` per distinct non-zero attributed Shaker, and the cumulative-square-root earned-Up delta for the Raiser and Giver. Signals availability cannot revert or delay money settlement. `materializeRaised` works for any raised Hand, not only settled ones.

### Reclaimed

At or after expiry, anyone may call `reclaim`; the entire credited pool is pushed back to the Raiser (deferring to a claim on push failure). Charity is success-only: Reclaim allocates none. Reclaim is terminal and mutually exclusive with settlement.

## Ordinary sequence

1. The Raiser reviews the fixed Raise terms and any proposed first-Shaker margin, then funds a Hand.
2. After Core assigns `handId`, the Raiser signs any optional first Shake and shares the resulting link through any channel.
3. A capability holder either Gives directly or signs a Shake to a fresh child capability.
4. Shaker consent follows the compact matrix: `shaker = 0` is anonymous and valid only at zero margin; a `shaker` equal to the authorizing capability signer needs no second signature; a distinct non-zero `shaker` signs `ShakerAcceptance` over that exact Shake. A positive margin requires one of the two attributed modes.
5. Each live forwarding payload carries the accumulated signed route and only the latest bearer secret.
6. The final holder uses that terminal capability locally to create a Give binding the exact route, solution, Giver, and final claim.
7. The Giver signs acceptance of that Give.
8. The Giver-side client exports a terminal proof containing the route, signed Give, and Giver acceptance — but no capability secret.
9. The Raiser verifies that proof and calls `thank` directly. Thank is raiser-only; a `THANK_PERMIT` typehash is reserved in `AHandTypes`, but no relayed-thank entrypoint exists.
10. Core validates the route, allocates, and pushes payouts atomically before expiry, deferring any failed push to a pull claim.
11. Anyone may later materialize the Core-authenticated Signals: role receipts, one `SHAKEN` per distinct attributed Shaker, and the Raiser/Giver earned-Up delta. Route presence creates no automatic Shaker Up; an earned-Up holder may recognize a helpful zero-margin Shaker through contextual `up()`.

## What "serverless" means here

The protocol can settle from the onchain Hand plus a complete valid route payload. No aHand database is authoritative. Applications may operate servers, gateways, indexers, and messaging relays for availability and UX; those services can be replaced without changing Core truth.
