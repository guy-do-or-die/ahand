# Protocol

## Core v2 — branch `core-v2`, [ADR-0015](../70-decisions/0015-core-v2.md) proposed

- [Core v2 design](core-v2-design.md) — the binding specification of the next Core: one immutable `AHandCore` (`raise` / `thank` / `reclaim` / `withdraw`, facts through `IAHandFacts`), the frozen `AHandTypes` / `AHandSig` / `AHandFacts` surface, the three extension seams, the invariants with their enforcement sites and tests, the threat model, the owner-delegated decisions (§18) and the measured gas.
- [Core v2 requirements ledger](core-v2-requirements.md) — every hard invariant (H), owner decision (D), open question (Q), use case (U), security finding (S) and non-goal (N) the design answers, by id.

`AHandSignalsV2.sol` is the reference reader of the facts seam and ships beside Core v2; `AHandWitness` is not deployed (owner decision of 2026-09-26). Until ADR-0015 is accepted the documents below remain the specification of the v1 Core deployed from `main`; ADR-0015 lists the clauses it supersedes.

## Core v1 — `main`

The contract-facing specification of aHand v1 as implemented in `contracts/src` on `main`: `AHandCore.sol` (escrow and settlement), `AHandSignals.sol` (soulbound receipts and Up), `AHandWitness.sol` (peripheral timestamping), and `AHandTypes.sol` (shared types plus the `AHandSig` EIP-712 library).

- [Core state machine](core-state-machine.md) — the `Hand` struct as stored, the `Status` lifecycle, `raise` / `thank` / `reclaim` / `withdraw`, the policy admin surface, and the frozen constants.
- [Capabilities and routing](capabilities-and-routing.md) — the `Shake` delegation chain, the EIP-712 signature families and hash construction, shaker consent modes, and route verification.
- [Settlement and Giver protection](settlement-and-giver-protection.md) — `Give` and `GiverAcceptance` binding, the pool split, push-with-pull-fallback payouts, and the giver risk model.
- [Events and indexing](events-and-indexing.md) — the exact events of all three contracts and the subgraph entities.
- [Invariants and threat model](invariants-and-threat-model.md) — the properties the code enforces and the test files that verify them.

Authority in one paragraph: the Raiser funds a Hand and later settles it; capabilities extend the route off-chain by signature; `AHandCore` verifies the entire signed chain at `thank` and pays every party. `AHandSignals` reads Core one-way (the read-only `getHand` view) and can be retried permissionlessly; `AHandWitness` verifies the same EIP-712 signatures but has zero connectivity to Core. Neither peripheral can touch escrow, and a bounded `policyAdmin` can only gate future raises.
