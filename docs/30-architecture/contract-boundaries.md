# Contract boundaries

Four Solidity files in `contracts/src`: `AHandCore.sol`, `AHandSignals.sol`, `AHandWitness.sol`, and `AHandTypes.sol` (shared structs and the EIP-712 library).

## AHandCore

Owns:

- Hand ids (monotonic) and the lifecycle `Status`: `None → Active → Settled | Reclaimed`;
- escrowed value: `raise` pulls the exact deposit and rejects fee-on-transfer behavior by checking the balance delta;
- the immutable per-Hand snapshot: reward token, `usdScale`, expiry, visibility, commitments, `discoveryRef`, tags, charity recipient and rate, `minGiverClaimBps`, `rootCapability`, `policyRevision`;
- route and signature verification in `thank`: the EIP-712 Shake chain, `ShakerAcceptance`/`GiverAcceptance`, and an ERC-1271 fallback capped at `ERC1271_GAS = 350_000` per verification;
- settlement allocation: charity cut, per-hop shaker margins, giver residual absorbing dust, exact conservation;
- payout delivery: each allocation is pushed with a `PUSH_GAS_STIPEND = 120_000` bounded transfer (`PayoutPushed`); a failed push defers the amount into a claim (`PayoutDeferred`) that `withdraw(token, beneficiary)` later drains — permissionless, always to the fixed beneficiary;
- `reclaim(handId)` — permissionless after expiry, full refund to the raiser, no charity cut;
- the protocol-fact events: `Raised`, `HandTagged`, `Settled`, `RouteHopSettled`, `Reclaimed`, `PayoutAllocated`, `PayoutPushed`, `PayoutDeferred`, `PayoutWithdrawn`, `TokenPolicyUpdated`, `CharityPolicyUpdated`, `PolicyAdminTransferStarted`, `PolicyAdminTransferred`.

Does not own:

- application or agent registration;
- ENS or any name resolution;
- discovery, boards, or metadata content (only commitments and the opaque `discoveryRef`, at most `MAX_DISCOVERY_REF = 128` bytes);
- trust scores or Signals balances;
- message delivery.

Constants, all immutable: `BPS_DENOMINATOR = 10_000`, `MIN_CHARITY_BPS = 100`, `MAX_CHARITY_BPS = 3_000`, `MAX_SHAKES = 6`, `MIN_EXPIRY = 1 day`, `MAX_EXPIRY = 180 days`, `MAX_PUBLIC_TAGS = 8`.

`thank` is direct and raiser-only. A `THANK_PERMIT` typehash is reserved in `AHandTypes`, but no relayed-thank entrypoint exists.

## AHandSignals

A soulbound ERC-1155-shaped ledger: no transfers, no approvals, no receiver hooks, and it deliberately does not claim the ERC-1155 interface id (`supportsInterface` answers ERC-165 only). Ownerless, zero privileges, bound to one immutable `sourceCore`.

Owns:

- signal ids `RAISED = 1`, `SHAKEN = 2`, `GIVEN = 3`, `THANKED = 4`, `UP = 5`, and the reserved `DOWN = 6` (constant and `DOWN_COST = 3e9` exist; no `down()` entrypoint);
- permissionless, idempotent materialization guarded by typed source keys — `RAISED_SOURCE` and `THANK_SOURCE` are independent, so neither path can suppress the other:
  - `materializeRaised(handId)` mints `RAISED` to the raiser of any raised Hand, settled or not;
  - `materializeThank(handId, giver, occShakers, occClaimDeltas)` verifies the settlement commitment (`thankSignalSourceHash`) Core stored, then mints `THANKED`/`GIVEN`, one `SHAKEN` per distinct attributed shaker (anonymous hops get none), and earned Up;
- the earned-Up curve: raiser and giver each add `charityUsd / 2` to a lifetime `cumulativeUsd`; the mint is the delta of `floor(sqrt(cumulativeUsd))` — cumulative-square-root, sub-additive;
- `up(target, wholeUpCount, UpContext)` — spends earned Up only (`amount = wholeUpCount * ONE_UP`, `ONE_UP = 1e9`); received Up is not re-spendable; requires a non-zero context; no self-target;
- fully on-chain SVG metadata via `uri(id)`.

Events: `TransferSingle`, `EarnedUpMaterialized`, `ThankSignalsMaterialized`, `Upped`.

Must not:

- be required for Core settlement — Core never calls Signals; missing or failed materialization cannot affect `thank`;
- custody Hand escrow or select a Giver;
- convert any Signal into a Core permission.

Materialization performs no external calls to recipients, so no contract actor can veto a receipt.

## AHandWitness

Peripheral timestamping only: `witness(hash)`, `witnessShake(shake, sig)`, `witnessGive(give, sig)`, `witnessRoot(root, leaves)`; events `Witnessed`, `ShakeWitnessed`, `GiveWitnessed`, `EpochRoot`. First write wins. It reads Core's `DOMAIN_SEPARATOR` to verify artifact signatures but has no write path into Core, and Core never reads it. Signature validity alone does not prove that an artifact belongs to a winning route.

## No application registry

There is no application registry contract. Signatures provide authority; the winning Shake route provides accepted Shaker participation and, where margin is positive, economic attribution. An application is an ordinary participant — Core does not whitelist or classify it.

## Contract-to-contract dependencies

```text
AHandCore    ── depends on nothing but the reward token
AHandSignals ── immutable sourceCore; reads settled facts ──► AHandCore
AHandWitness ── reads DOMAIN_SEPARATOR only ──► AHandCore
```

## Reward-token boundary

Core holds a single immutable `rewardToken` per deployment, with `usdScale = 10^(18 - decimals)` fixed at construction. The Base Sepolia deployment uses Circle's Base Sepolia USDC (6 decimals, scale `10^12`); the local anvil stand deploys MockUSD. There is no asset-admission path, no oracle, and no protocol fee. USDC is statically treated as one dollar for the Up curve's USD input.

Charity is mandatory, frozen at Raise, and success-only; `reclaim` returns the full credited pool. The rate is bounded by the immutable `MIN_CHARITY_BPS`/`MAX_CHARITY_BPS`, which guarantees positive distributable value for every accepted Hand.

## Administration inventory

`AHandCore` has exactly one administrative role: `policyAdmin`, transferred only through the two-step `transferPolicyAdmin`/`acceptPolicyAdmin`. It may call exactly two methods:

- `setTokenEnabled(bool)` — gate NEW raises on the single preconfigured token;
- `setCharityAllowed(address, bool)` — edit charity eligibility for NEW raises.

Every change bumps `policyRevision`. Both are prospective only: no admin action can pause or alter an existing Hand, `thank`, `reclaim`, or `withdraw`. Disabling the token or leaving no eligible charity suspends admission of new Raises and nothing else. There is no proxy upgrade, rescue, winner selection, settlement mutation, or retrospective configuration path anywhere in the three contracts. `AHandSignals` and `AHandWitness` have no admin at all.

The current `policyAdmin` address is recorded with the deployment in `packages/abi/src/addresses.base-sepolia.json`; see [Deployment and trust](deployment-and-trust.md).
