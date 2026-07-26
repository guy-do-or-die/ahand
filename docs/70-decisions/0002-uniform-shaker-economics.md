# ADR-0002: Use uniform, success-only Shaker economics

Status: accepted

## Context

Separate application, agent, maintenance, and protocol fees make the displayed reward difficult to understand and charge actors before value exists. They also duplicate the economic role already performed by an intermediary that improves a route.

## Decision

Every intermediary — human or software — may reserve a disclosed margin by reducing the downstream claim in its Shake. A positive margin requires a non-zero Shaker account to consent to the exact Shake: through the Shake signature itself when it is the authorizing capability signer, or through `ShakerAcceptance` when it is distinct. The margin is allocated only if that occurrence appears in the accepted route and is paid only on successful Thank.

Core levies no mandatory maintenance fee, application fee, or origin fee of any kind. An application or agent operator funds itself by acting as an ordinary Shaker when it performs a real routing service. A zero-margin Shake remains valid: it may be anonymous with `shaker = 0`, or carry a non-zero consented Shaker account for durable attribution.

On a successful Hand, Signals materializes one factual `SHAKEN` for every distinct non-zero consented Shaker account, regardless of margin or number of occurrences. Route events still preserve every occurrence and claim delta. `SHAKEN` does not mint Up and is not a trust score; recognition beyond participation uses voluntary contextual `up()` from an actor's scarce earned Up.

All fixed deductions and the distributable route pool are committed and displayed before Raise. Every Hand names an allowlisted charity, and the Raiser selects the rate within the immutable inclusive 1%–30% range (`MIN_CHARITY_BPS = 100`, `MAX_CHARITY_BPS = 3_000`). The recipient and rate are frozen in the Hand at Raise; charity is allocated only on successful Thank; Reclaim refunds the full pool with no charity cut; top-ups are unsupported. Settlement pays each allocation by a gas-bounded direct push, deferring to a pull claim only when the push fails (see ADR-0010).

## Consequences

### Positive

- Payment corresponds to a successful causal route.
- Every hop can see its margin and the amount protected downstream.
- The reference client is replaceable and has no tax privilege.
- Failed branches earn nothing.
- A volunteer may retain factual credit without taking a margin, while anonymous pay-it-forward forwarding remains possible.

### Negative

- Protocol maintenance has no guaranteed revenue.
- Applications must decide when their service genuinely merits a Shake.
- Attributed zero-margin routing still requires Shaker consent, supplied by the Shake signature in self mode or separate acceptance in explicit mode.
- Very long routes need caps and user-visible economics (Core caps at `MAX_SHAKES = 6`).

## Alternatives rejected

- **Mandatory protocol fee:** taxes every Hand regardless of protocol operator contribution.
- **Application fee selected at Raise:** assumes one application owns the interaction.
- **Fees removed only at Thank:** advertises a gross reward whose eventual split was not committed.
- **Payment for attempted branches:** cannot establish their contribution to the accepted solution.

## References

- [Economics](../10-model/economics.md)
- [Settlement and Giver protection](../20-protocol/settlement-and-giver-protection.md)
- [Shaker attribution and acceptance](0011-shaker-attribution-and-acceptance.md)

## Revisit when

Only if a concrete protocol-wide cost cannot be funded voluntarily or by route participants, and the full deduction can be committed before funding without introducing privileged applications.
