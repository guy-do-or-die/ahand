# ADR-0011: Bind Shaker consent to the exact Shake

Status: accepted

## Context

A capability signature proves authority to extend a route, but it does not identify the person, application, or agent performing the routing work. An ephemeral capability is also a poor durable recipient for a `SHAKEN` receipt. If the holder could name any stable Shaker account without consent, an attacker could frame an uninvolved address as a paid or unpaid participant.

## Decision

Every Shake contains an optional `shaker` account. The authorizing capability signer is already determined by the route: the root capability for the first Shake and the previous child capability thereafter.

```text
anonymous => shaker == 0; zero margin only; no ShakerAcceptance
self      => shaker == authorizing capability signer; Shake signature is consent
explicit  => distinct non-zero shaker; valid ShakerAcceptance(shakeHash)
```

Positive margin requires self or explicit attribution. In self mode, the Shake signature proves route authority, account control, attribution consent, and consent to the bound payout terms; another signature would add no fact. In explicit mode, `ShakerAcceptance` signs the canonical `shakeHash` and proves the distinct account's control and consent. Signatures verify as ECDSA with an ERC-1271 fallback for contract accounts, gas-capped at `ERC1271_GAS = 350_000` per verification so a hostile wallet cannot gas-bomb settlement.

On a successful Hand, Signals materializes exactly one `SHAKEN` receipt for each distinct non-zero consented `shaker`, regardless of how many winning route occurrences attribute the same address. Per-occurrence Core events preserve every position, claim delta, and margin. Only positive deltas create payouts. No Shaker receives automatic Up.

A zero-margin Shake with `shaker == 0` preserves wallet-free anonymous pay-it-forward forwarding. A zero-margin participant who wants durable recognition uses self attribution or supplies an explicit non-zero Shaker account.

A profile or record may advertise a default Shaker account, but no resolution proves the relationship. Each Shake establishes it cryptographically through self equality or a distinct account's `ShakerAcceptance`.

## Consequences

### Positive

- A paid or unpaid attributed address cannot be framed as an unwilling route participant.
- Apps, agents, and people can separate ephemeral route authority from a stable Shaker account.
- A zero-margin contributor can receive a factual `SHAKEN` receipt without pretending to have taken a fee.
- Repeated self-insertion by one address cannot multiply its `SHAKEN` balance within one Hand; route events still preserve every occurrence.
- Anonymous zero-margin forwarding remains possible.
- Recognition through voluntary contextual `up()` preserves Up supply and issuer provenance instead of creating route-length-based issuance.

### Negative

- Explicit attribution to an account distinct from the capability signer requires an additional signature and address in the route payload.
- Paying an unrelated third party requires that party's explicit acceptance.
- Acceptance proves address control and consent, not the truth or value of application metadata or service claims.
- Distinct Sybil addresses may still collect factual receipts; `SHAKEN` count is not a trust score or an Up source.

## Alternatives rejected

- **Always require a second Shaker signature:** adds bytes without adding consent when the capability signer attributes and pays itself.
- **Treat a distinct payout or Shaker account as consenting without its signature:** conflates route authority with another account's durable attribution and enables framing.
- **Require identity for every zero-margin pass:** damages link-only forwarding; anonymous `shaker == 0` remains valid.
- **Exclude zero-margin participants from `SHAKEN`:** makes a participation receipt depend on taking money and hides genuine pay-it-forward contribution.
- **Mint automatic Up for attributed Shakers:** makes route length and address splitting an issuance strategy; voluntary `up()` already provides scarce, non-recursive recognition.
- **Use ENS resolution as consent:** a mutable record is not authorization for one Shake.

## References

- [Actors and roles](../10-model/actors-and-roles.md)
- [Capabilities and routing](../20-protocol/capabilities-and-routing.md)
- [Events and indexing](../20-protocol/events-and-indexing.md)

## Revisit when

If a privacy-preserving proof can supply equivalent per-hop consent with less payload/gas, if production data shows explicit attribution blocks legitimate routing, or if one-per-Hand receipt semantics prove too coarse for real multi-contribution routes.
