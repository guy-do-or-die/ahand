# ADR-0012: Bound policy authority to future Raises

Status: accepted

## Context

An ownerless deployment cannot respond when a charity becomes unsafe or the reward token should stop accepting new deposits. An unbounded owner is worse: pause, upgrade, rescue, winner-selection, or retroactive configuration could freeze or redirect existing Hands. The protocol needs a narrow operational policy boundary, not a governance system.

## Decision

`AHandCore` has a `policyAdmin` with a two-step handover through `pendingPolicyAdmin` (`PolicyAdminTransferStarted`, `PolicyAdminTransferred`). Policy actions have no timelock; they take effect immediately, and only prospectively.

The `rewardToken` is immutable per deployment (Base Sepolia USDC on the live deployment; see ADR-0010). The policy admin may, for future Raises only:

- enable or disable the preconfigured token (`setTokenEnabled`, emitting `TokenPolicyUpdated`);
- add or remove eligible charity addresses (`setCharityAllowed`, emitting `CharityPolicyUpdated`).

Every change bumps the `policyRevision` counter (seeded at 1), and each `Raised` event records the revision in force, so policy at Raise is provable from event history alone.

`BPS_DENOMINATOR = 10_000`, `MIN_CHARITY_BPS = 100`, and `MAX_CHARITY_BPS = 3_000` are immutable. The Raiser selects a rate within that inclusive range at Raise. The admin cannot add another asset, change the valuation scale, or change either charity bound.

The admin may suspend admission of new Raises by disabling the token or leaving no eligible charity. That is the full availability impact. Every Raise snapshots its token, scale, charity recipient, charity rate, and all other economic terms; prospective policy changes never affect Active or terminal Hands, Signal valuation for an existing Thank, or withdrawal claims.

The policy admin has no authority to:

- pause Thank, Reclaim, or withdrawal;
- upgrade Core or replace validation logic;
- rescue or redirect token balances;
- select a winner, approve a route, or forge consent;
- alter a Hand, claim, deadline, or settlement calculation;
- alter `MIN_CHARITY_BPS`, `MAX_CHARITY_BPS`, or `BPS_DENOMINATOR`;
- add maintenance, application, or protocol fees;
- mint, erase, or reinterpret Signals.

A timelock, earned-Up-informed governance, new assets, and oracle policy are future work; if governance ever exists, it inherits this prospective-eligibility boundary, not settlement control.

## Consequences

### Positive

- Unsafe charities or a troubled token can stop receiving new Hands, up to a complete temporary stop of new Raise admission.
- Existing escrow and exits remain independent of admin cooperation.
- The authority surface is small enough to explain and test exhaustively.

### Negative

- The admin is trusted to configure future Raises honestly.
- A compromised admin can deny new Raise admission.
- Policy actions are immediate because no timelock exists.
- A deployment with an incorrect immutable token or charity bound requires replacement, not an admin edit.
- Users and indexers must distinguish policy at Raise (via `policyRevision`) from current policy.

## Alternatives rejected

- **Ownerless Core:** cannot stop new Raises to a compromised charity or troubled token.
- **Unbounded owner:** threatens escrow, exits, and route neutrality.
- **Global lifecycle pause:** turns incident response into potential indefinite fund freezing; blocking new admission is the narrower control.
- **Upgrade proxy:** expands authority and storage-layout risk.
- **Token rescue:** cannot safely distinguish surplus from disputed liabilities.
- **Mutable asset addition or valuation:** turns the narrow stablecoin assumption into an oracle/governance system.
- **Mutable mandatory charity floor:** lets an administrator force new economic terms on users of the same Core; a different range belongs in an explicit future version.
- **Full governance and timelock now:** heavy machinery the current authority surface does not need.

## References

- [Economics](../10-model/economics.md)
- [Core state machine](../20-protocol/core-state-machine.md)
- [Contract boundaries](../30-architecture/contract-boundaries.md)
- [Deployment and trust boundaries](../30-architecture/deployment-and-trust.md)

## Revisit when

Production governance specifies a timelock, proposal eligibility, earned-Up snapshot semantics, emergency limits, migration, and oracle/asset admission without compromising existing Hands or exits.
