# Protocol

The contract-facing specification of aHand as implemented in `contracts/src`: `AHandCore.sol` (escrow and settlement), `AHandSignals.sol` (soulbound receipts and Up), `AHandWitness.sol` (peripheral timestamping), and `AHandTypes.sol` (shared types plus the `AHandSig` EIP-712 library).

- [Core state machine](core-state-machine.md) — the `Hand` struct as stored, the `Status` lifecycle, `raise` / `thank` / `reclaim` / `withdraw`, the policy admin surface, and the frozen constants.
- [Capabilities and routing](capabilities-and-routing.md) — the `Shake` delegation chain, the EIP-712 signature families and hash construction, shaker consent modes, and route verification.
- [Settlement and Giver protection](settlement-and-giver-protection.md) — `Give` and `GiverAcceptance` binding, the pool split, push-with-pull-fallback payouts, and the giver risk model.
- [Events and indexing](events-and-indexing.md) — the exact events of all three contracts and the subgraph entities.
- [Invariants and threat model](invariants-and-threat-model.md) — the properties the code enforces and the test files that verify them.

Authority in one paragraph: the Raiser funds a Hand and later settles it; capabilities extend the route off-chain by signature; `AHandCore` verifies the entire signed chain at `thank` and pays every party. `AHandSignals` reads Core one-way (the read-only `getHand` view) and can be retried permissionlessly; `AHandWitness` verifies the same EIP-712 signatures but has zero connectivity to Core. Neither peripheral can touch escrow, and a bounded `policyAdmin` can only gate future raises.
