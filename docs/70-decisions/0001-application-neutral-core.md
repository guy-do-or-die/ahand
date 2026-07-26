# ADR-0001: Core has no application identity

Status: accepted

## Context

Earlier designs considered an `appId`, application registry, and application fee so multiple clients could be attributed and paid. That makes applications protocol tenants and assumes an application occupies one privileged position in every route. In practice, a human, UI, agent, indexer, or service can enter wherever it receives a live capability.

## Decision

Core contains no `appId`, `agentId`, application registration, application allowlisting, or application-specific settlement branches.

Software that advances a route uses the same ordinary Shake as a human. The capability signer authorizes the delegation. If the optional stable `shaker` is that same account, the Shake signature also supplies attribution and payout consent; only a distinct Shaker signs `ShakerAcceptance`. A positive claim reduction requires and pays that consented account. A zero-margin occurrence may either attribute a consented account for one factual `SHAKEN` receipt or use `shaker = 0` anonymously. An application may advertise a default Shaker account outside Core (in its profile, metadata, or an ENS record), but such advertisement grants no authority.

## Consequences

### Positive

- Any compatible client can create, forward, Give, or settle without registration.
- Software and humans compose at any route position.
- An application is paid only for its positive-margin occurrences in the accepted route.
- A consented application Shaker account receives exactly one factual `SHAKEN` per successful Hand after materialization, even if it appears more than once; this receipt grants no automatic Up.
- The protocol needs no registry governance or application classification.

### Negative

- Core cannot answer which product rendered or originated a Hand.
- Product analytics require consented Shaker attribution, signed annotations, or application-side metadata.
- An application that only renders a page has no protocol-enforced revenue claim.

## Alternatives rejected

- **Core `appId`:** fixes applications to a privileged origin role and creates registry governance.
- **Separate human/app/agent roles:** operational categories change over time and do not change route authority.
- **ENS name as application authorization:** resolution is mutable metadata, not consent or a capability.

## References

- [Actors and roles](../10-model/actors-and-roles.md)
- [Contract boundaries](../30-architecture/contract-boundaries.md)

## Revisit when

Only if Core must enforce a property that cannot be expressed by signatures, route position, the stable Shaker account, or an optional peripheral policy.
