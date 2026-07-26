# Economics

## Current policy

- Core charges no maintenance, application, or protocol fee.
- Applications, agents, and humans have no special revenue path: any route payout is an ordinary Shaker margin on a winning route.
- A Shaker margin is success-contingent, committed before downstream authority is delivered, and consented to by the non-zero Shaker account attributed to that hop. The authorizing Shake signature supplies that consent in self mode; a distinct Shaker supplies `ShakerAcceptance`.
- The Giver is protected by a minimum downstream claim (`minGiverClaimBps`), expressed as a share of the post-charity distributable pool and selected at Raise.
- Charity is mandatory; the Raiser chooses its rate within the immutable inclusive 1%–30% range, and the rate and recipient are frozen at Raise. It is allocated only on successful Thank.
- Each deployment has a single immutable reward token. The live Base Sepolia deployment uses Circle's Base Sepolia USDC (6 decimals); local anvil uses MockUSD.
- Each Hand snapshots the token address and its `usdScale = 10^(18 - decimals)` — `10^12` for the live USDC — at Raise.
- Raise accepts only an exact incoming token balance delta; fee-on-transfer behavior is rejected. Top-ups are not supported.
- Settlement and reclaim push tokens directly to recipients with a gas-bounded transfer; a failed push defers only that share into a pull claim (see below).

The implementation assumes one whole USDC equals one USD. There is no oracle or depeg check; this static valuation is a disclosed assumption, not hidden scope.

## Token and charity policy

Core contains two small policy maps, not separate registry contracts:

- `setTokenEnabled(bool)` can suspend or resume admission of new Raises in the one immutable token. It cannot add another asset or change the scale.
- `setCharityAllowed(address, bool)` maintains the charity allowlist for future Raises.
- The policy admin transfers via a two-step handover; `policyRevision` bumps on every change.
- Policy is prospective only. Every Active Hand retains its snapshotted token scale, charity address, charity rate, and all other settlement terms. Disabling the token or removing every charity stops new Raises but never pauses an existing Hand, settlement, reclaim, or withdrawal.

The charity-rate bounds are immutable Core constants:

```text
BPS_DENOMINATOR = 10_000
MIN_CHARITY_BPS = 100
MAX_CHARITY_BPS = 3_000
MIN_CHARITY_BPS <= charityBps <= MAX_CHARITY_BPS
```

The Raiser selects the allowlisted `charityRecipient` and `charityBps` at Raise; both are frozen in the Hand. A Hand cannot opt out of charity. Raise rejects any amount/rate combination whose floored charity allocation or post-charity distributable pool is zero, and requires `0 < minGiverClaimBps <= BPS_DENOMINATOR`.

No administrator action can move the 1% floor or the 30% ceiling; a different range requires a new deployment.

## When economics become fixed

Raise fixes the pool, the mandatory charity terms, and the minimum Giver claim. It does not invent an application fee or predict intermediaries. Each positive-margin hop commits one visible claim reduction and a consented non-zero Shaker account when the capability is forwarded; a zero-margin hop leaves the claim unchanged and may either carry attribution or remain anonymous. The next holder sees the remaining claim, the Giver accepts the final claim, and the Raiser reviews the complete winning route before Thank.

The public amount is therefore always the deposited pool, not a promise that the Giver receives all of it. Clients show the charity split and Giver floor before funding, each new margin while routing, and the exact final allocations before Thank.

## Settlement arithmetic

```text
P = exact credited escrow pool
B = 10_000 basis points
C = floor(P * charityBps / B)
D = P - C, the distributable route pool
q0 = B
qi = downstream claim after Shake i
```

Every route (at most `MAX_SHAKES = 6` hops) must satisfy the telescoping chain:

```text
B = q0 >= q1 >= ... >= qn >= minGiverClaimBps
```

Each hop's margin allocation is floored:

```text
marginAllocation(i) = floor(D * (q(i-1) - qi) / B)
```

A positive margin with a zero floored allocation reverts (`MarginRoundsToZero`), as does a positive margin on an anonymous hop (`AnonymousShakerWithMargin`). The Giver receives the residual, which absorbs all rounding dust:

```text
giverAllocation = D - sum(marginAllocations)
```

Conservation is exact by construction:

```text
P = C + sum(marginAllocations) + giverAllocation
```

Reclaim instead returns the complete `P` to the Raiser: no charity, no earned Up.

## Payout delivery

Thank and Reclaim push every allocation directly, each through a transfer capped at a 120,000-gas stipend (`PUSH_GAS_STIPEND`), emitting `PayoutPushed` on success. A recipient that reverts — a blacklisted address, a hostile contract — defers only its own share: the amount is parked as a claim and `PayoutDeferred` is emitted, while every other payout in the same transaction still lands.

`withdraw(token, beneficiary)` drains a deferred claim to its fixed beneficiary and emits `PayoutWithdrawn`. It is permissionless: anyone can pay the gas, nobody can redirect the funds. Claims survive policy changes.

## Charity-backed Up issuance

Mandatory charity is the economic backing for automatically earned Up. It makes self-solving and collusive reputation creation costly only if the allowlisted recipient is independently controlled and does not return the funds. That is an explicit policy trust assumption, not a cryptographic fact.

For a successful Thank, the Hand's snapshotted scale converts the charity token amount to 18-decimal USD:

```text
charityUsd = charityTokenAmountRaw * usdScaleAtRaise
roleCredit = floor(charityUsd / 2)
```

The same `roleCredit` is credited once to the Raiser and once to the Giver. Each address has one global cumulative curve in the Signals ledger:

```text
newCumulativeUsd(a) = cumulativeUsd(a) + roleCredit
earnedDelta(a) = floorSqrt(newCumulativeUsd(a)) - floorSqrt(previousCumulativeUsd(a))
```

`earnedDelta` is a raw Up amount with `ONE_UP = 10^9`, so the displayed lifetime issuance curve is the square root of cumulative attributed dollars — the cost of building Up strength is quadratic. There is no emission cap.

For fresh addresses:

```text
$1.00 successful charity
  -> $0.50 attributed to each role
  -> floor(sqrt(0.5e18)) = 0.707106781 Up each

$20.00 successful charity
  -> $10.00 attributed to each role
  -> floor(sqrt(10e18)) = 3.162277660 Up each
```

These are cumulative examples, not a per-Hand award table: only the difference between the new and previous square roots is minted.

The square root is applied after global per-address accumulation, never per tag, context, application, or Hand. Contextual views may slice the evidence but must not create additional issuance curves.

At settlement, Core stores `thankSignalSourceHash` — a commitment over the raiser, giver, charity amount, scale snapshot, and every ordered hop's attributed shaker (or zero) and claim delta. Signals materialization rebuilds that exact commitment from caller-supplied facts, dedupes non-zero attributed shakers within the Hand, and mints one `SHAKEN` each. If the same address is both Raiser and Giver, it receives `2 * roleCredit` as one atomic curve input while still receiving both role receipts.

Across multiple sources for one actor, the marginal delta attributed to an individual Hand depends on materialization order, but the eventual totals do not:

```text
sum(all processed earnedDelta for actor) = floorSqrt(sum(all processed role credits for actor))
```

Applications should treat the fixed `roleCredit` and source provenance — not the order-dependent marginal delta — as a Hand's intrinsic contribution.

## Up accounting

There is one Up balance in the soulbound Signals ledger:

```text
totalUp(a) = earnedUp(a) + receivedUp(a)
```

`earnedUp` is the remaining spendable portion earned through successful Thanks. `receivedUp` is the portion received through explicit Up actions and cannot be spent again.

```text
ONE_UP = 1_000_000_000
up(target, wholeUpCount, context)
amount = wholeUpCount * ONE_UP
```

requires positive `wholeUpCount` and `amount <= earnedUp(sender)`. It burns `amount` from the sender's earned portion and re-mints the same amount as the target's received Up. Zero-address and self targets are forbidden, and the context must be non-empty. This preserves total Up supply and cuts recursive re-delegation.

Down is reserved: the `DOWN_COST = 3 * ONE_UP` constant and signal id exist, but no `down()` entrypoint is implemented. No Down can be cast today.

## Why telescopic claims

The route carries a monotonically shrinking downstream claim instead of independent fees. This provides:

- a visible remaining reward at every hop;
- a hard Giver floor;
- no over-allocation;
- coalition non-amplification for routing payouts;
- settlement from one verifiable route.

Because each hop is floored independently, splitting a fixed claim delta can reduce a coalition's allocation by rounding dust; that dust remains in the Giver residual. A positive claim reduction is valid only when its floored allocation is non-zero and its non-zero Shaker account has consented. A holder that wants no economic claim uses a true zero-margin Shake — attributed or anonymous; a dust-sized positive delta cannot masquerade as a zero-margin contribution.

`SHAKEN` means a consented address participated as a Shaker in a successful Hand; it is not a payment receipt, Up, or an independent trust weight. Materialization creates exactly one `SHAKEN` per distinct `(Hand, shaker)`; every route occurrence and its actual margin remain visible in Core events.

## Worked example

One route with a distinct Raiser, three Shakers, a Giver, and a charity. The first Shaker is a distinct attributed account (the capability signer differs), so it supplies explicit `ShakerAcceptance`; the second Shaker forwards at zero margin but also opts into attribution with its own `ShakerAcceptance`; the third Shaker's capability signer equals its attributed account, so its single Shake signature suffices:

```text
P = $20.00
charityBps = 1_000
C = $2.00
D = $18.00
minGiverClaimBps = 9_000
q = [10_000, 9_500, 9_500, 9_000]

first Shaker margin   = $18 * (10_000 - 9_500) / 10_000 = $0.90
second Shaker margin  = $18 * ( 9_500 - 9_500) / 10_000 = $0.00
third Shaker margin   = $18 * ( 9_500 - 9_000) / 10_000 = $0.90
Giver residual        = $16.20
charity               = $2.00
total                 = $20.00
```

The route has three Shake signatures, two explicit `ShakerAcceptance` signatures, two positive allocations, and exactly three `SHAKEN` receipts. Each fresh Raiser/Giver address receives `$1` of role credit and therefore exactly `ONE_UP`. The Raiser may later pass that one earned Up to the zero-margin second Shaker via `up()` with this Hand as context; no additional Up is minted and the received Up cannot be spent again.

## Application monetization

An application may be the first Shaker when it creates a useful route entry point. It must:

1. disclose its proposed origin margin before the route is shared;
2. use the same self-or-explicit Shaker-consent rules as every other attributed participant;
3. receive nothing when another route wins or the Hand is reclaimed;
4. receive no Core privilege of any kind.

Applications therefore monetize successful contribution rather than taxing every Hand.

## Honest display

Clients distinguish:

- deposited pool and token;
- mandatory charity share and recipient;
- distributable route pool;
- current downstream claim;
- current Shaker margin and attributed account, or an explicit anonymous zero-margin state;
- minimum amount protected for the Giver;
- amounts pushed versus amounts deferred to claims;
- earned Up versus received Up.

The UI must not advertise the gross pool as the Giver's reward or collapse reputation components into an unexplained score.

## Deferred extensions

Not implemented, and applicable to future Raises only if ever added:

- reward assets beyond the per-deployment immutable token;
- external USD oracles;
- a `down()` entrypoint;
- a relayed `thankWithPermit` (the `THANK_PERMIT` typehash is reserved);
- governance, timelocks, and migration between Core versions.

## Rejected alternatives

- optional charity for a Signal-bearing successful Hand;
- `maintenanceFeeBps`, `appFeeBps`, or any protocol fee;
- an `appId` mapping to a privileged recipient;
- separate token or charity registry contracts;
- arbitrary unverified ERC-20 support;
- oracle-dependent settlement;
- post-authorization top-ups.
